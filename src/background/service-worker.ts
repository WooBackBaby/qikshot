import { saveScreenshot, type Screenshot } from '../lib/db';

// Message types
type Message =
  | { type: 'CAPTURE_FULL' }
  | { type: 'CAPTURE_REGION'; dataUrl: string; cropRect: CropRect }
  | { type: 'OPEN_ANNOTATION'; screenshotId: string }
  | { type: 'START_CROP' }
  | { type: 'CROP_CAPTURE'; cropRect: CropRect }
  | { type: 'CROP_DISMISSED' }
  | { type: 'SCROLL_START'; totalHeight: number; viewportWidth: number }
  | { type: 'SCROLL_CAPTURE_CHUNK'; scrollY: number }
  | { type: 'SCROLL_PROGRESS'; current: number; total: number }
  | { type: 'SCROLL_FINALIZE' }
  | { type: 'SCROLL_ERROR'; error: string };

// Long-lived port from the popup for scroll capture progress/control.
// Keeping the port open prevents the service worker from going idle mid-capture.
let scrollCapturePort: chrome.runtime.Port | null = null;

// Incremental stitch canvas — built chunk-by-chunk in the service worker so we
// never pass large data URLs through runtime messages (which have size limits).
let stitchCanvas: OffscreenCanvas | null = null;
let stitchCtx: OffscreenCanvasRenderingContext2D | null = null;
let stitchTotalHeight = 0;
let stitchViewportWidth = 0;
let stitchActualScale = 0; // CSS px → canvas px (includes any clamp factor)
let stitchBitmapScale = 1; // scale applied to each bitmap's drawn dimensions

// Chrome's GPU texture dimension limit — canvases taller than this fail silently.
const MAX_CANVAS_HEIGHT = 16384;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'scroll-capture') return;

  scrollCapturePort = port;

  port.onMessage.addListener((msg: { type: string; tabId?: number }) => {
    if (msg.type === 'START_SCROLL_CAPTURE') {
      if (!msg.tabId) {
        port.postMessage({ type: 'SCROLL_ERROR', error: 'No tab ID provided.' });
        return;
      }
      startScrollCapture(msg.tabId).catch((err) => {
        port.postMessage({ type: 'SCROLL_ERROR', error: String(err) });
      });
    }
  });

  port.onDisconnect.addListener(() => {
    scrollCapturePort = null;
  });
});

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'CAPTURE_FULL') {
    captureFullTab()
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((err) => sendResponse({ error: String(err) }));
    return true;
  }

  if (message.type === 'CAPTURE_REGION') {
    cropImage(message.dataUrl, message.cropRect)
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((err) => sendResponse({ error: String(err) }));
    return true;
  }

  if (message.type === 'OPEN_ANNOTATION') {
    const url = chrome.runtime.getURL('annotation/index.html') + '?id=' + message.screenshotId;
    chrome.tabs.create({ url });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'START_CROP') {
    startCrop().catch(console.error);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'CROP_CAPTURE') {
    handleCropCapture(message.cropRect)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: String(err) }));
    return true;
  }

  if (message.type === 'CROP_DISMISSED') {
    chrome.storage.session.remove(['cropTabId', 'cropRect']).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'SCROLL_START') {
    // Reset stitch state for new capture session
    stitchCanvas = null;
    stitchCtx = null;
    stitchActualScale = 0;
    stitchBitmapScale = 1;
    stitchTotalHeight = message.totalHeight;
    stitchViewportWidth = message.viewportWidth;
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'SCROLL_CAPTURE_CHUNK') {
    // Capture the visible tab and draw directly onto the stitch canvas.
    // This avoids passing large data URLs through runtime messages, which
    // can exceed Chrome's message size limit on long pages ("failed to fetch").
    const { scrollY } = message;
    captureFullTab()
      .then(async (dataUrl) => {
        const blob = await fetch(dataUrl).then((r) => r.blob());
        const bitmap = await createImageBitmap(blob);

        if (!stitchCanvas) {
          // Derive the actual pixel scale from the real bitmap dimensions.
          // captureVisibleTab uses the ACTUAL screen DPR, not window.devicePixelRatio
          // (which reflects the emulated DPR in DevTools mobile emulation).
          const dpr = bitmap.width / stitchViewportWidth;
          const rawHeight = Math.round(stitchTotalHeight * dpr);
          if (rawHeight <= MAX_CANVAS_HEIGHT) {
            // Normal case: full retina resolution.
            stitchActualScale = dpr;
            stitchBitmapScale = 1;
          } else if (stitchTotalHeight <= MAX_CANVAS_HEIGHT) {
            // Long page: drop to 1× (CSS pixels). Sharp output, just not retina density.
            stitchActualScale = 1;
            stitchBitmapScale = 1 / dpr;
          } else {
            // Extremely long page (>16384 CSS px): scale to fit — unavoidable quality loss.
            stitchActualScale = MAX_CANVAS_HEIGHT / stitchTotalHeight;
            stitchBitmapScale = stitchActualScale / dpr;
          }
          stitchCanvas = new OffscreenCanvas(
            Math.round(bitmap.width * stitchBitmapScale),
            Math.round(stitchTotalHeight * stitchActualScale),
          );
          stitchCtx = stitchCanvas.getContext('2d')!;
        }

        stitchCtx!.drawImage(
          bitmap,
          0, 0, bitmap.width, bitmap.height,
          0, Math.round(scrollY * stitchActualScale),
          Math.round(bitmap.width * stitchBitmapScale),
          Math.round(bitmap.height * stitchBitmapScale),
        );
        bitmap.close();
        sendResponse({ ok: true });
      })
      .catch((err) => sendResponse({ error: String(err) }));
    return true;
  }

  if (message.type === 'SCROLL_PROGRESS') {
    scrollCapturePort?.postMessage({ type: 'SCROLL_PROGRESS', current: message.current, total: message.total });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'SCROLL_FINALIZE') {
    if (!stitchCanvas) {
      sendResponse({ error: 'No canvas to finalise' });
      return false;
    }
    stitchCanvas.convertToBlob({ type: 'image/png' })
      .then(async (blob) => {
        const dataUrl = await blobToDataUrl(blob);
        const screenshot: Screenshot = {
          id: crypto.randomUUID(),
          dataUrl,
          createdAt: Date.now(),
        };
        await saveScreenshot(screenshot);
        await chrome.storage.session.set({ lastSaved: Date.now() });
        scrollCapturePort?.postMessage({ type: 'SCROLL_COMPLETE' });
        stitchCanvas = null;
        stitchCtx = null;
        sendResponse({ ok: true });
      })
      .catch((err) => {
        scrollCapturePort?.postMessage({ type: 'SCROLL_ERROR', error: String(err) });
        sendResponse({ error: String(err) });
      });
    return true;
  }

  if (message.type === 'SCROLL_ERROR') {
    scrollCapturePort?.postMessage({ type: 'SCROLL_ERROR', error: message.error });
    sendResponse({ ok: true });
    return false;
  }
});

// Re-inject overlay when the active crop tab finishes navigating to a new page
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  try {
    const data = await chrome.storage.session.get(['cropTabId', 'cropRect']) as {
      cropTabId?: number;
      cropRect?: { x: number; y: number; w: number; h: number };
    };
    if (data.cropTabId !== tabId) return;
    await injectOverlay(tabId, data.cropRect ?? null);
  } catch {
    // ignore
  }
});

async function startScrollCapture(tabId: number) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/full-page-capture.js'],
  });
}

async function captureFullTab(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(dataUrl);
    });
  });
}

async function startCrop() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const tabUrl = tab.url ?? '';
  if (
    tabUrl.startsWith('chrome://') ||
    tabUrl.startsWith('chrome-extension://') ||
    tabUrl.startsWith('about:')
  ) return;
  // Fresh start — clear any saved rect and record the tab
  try { await chrome.storage.session.remove('cropRect'); } catch {}
  try { await chrome.storage.session.set({ cropTabId: tab.id }); } catch {}
  await injectOverlay(tab.id, null);
}

// Inject the overlay, optionally pre-seeding a saved rect via a tiny inline initializer.
// Passing the rect this way avoids any async reads inside the content script itself,
// which would cause Rollup to wrap the IIFE as async and break event registration.
async function injectOverlay(
  tabId: number,
  savedRect: { x: number; y: number; w: number; h: number } | null
) {
  try {
    if (savedRect) {
      // Set a sync global the content script reads immediately on load
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (r: unknown) => { (window as any).__cropInitRect = r; },
        args: [savedRect],
      });
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/crop-overlay.js'],
    });
  } catch {
    try { await chrome.storage.session.remove(['cropTabId', 'cropRect']); } catch {}
  }
}

async function handleCropCapture(cropRect: CropRect) {
  const fullDataUrl = await captureFullTab();
  const croppedDataUrl = await cropImage(fullDataUrl, cropRect);
  const screenshot: Screenshot = {
    id: crypto.randomUUID(),
    dataUrl: croppedDataUrl,
    createdAt: Date.now(),
  };
  await saveScreenshot(screenshot);
  await chrome.storage.session.set({ lastSaved: Date.now() });
}

async function cropImage(dataUrl: string, rect: CropRect): Promise<string> {
  const { x, y, width, height, devicePixelRatio: dpr } = rect;
  const img = await loadImageBitmap(dataUrl);

  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(img, Math.round(x * dpr), Math.round(y * dpr), w, h, 0, 0, w, h);
  img.close();

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return blobToDataUrl(blob);
}

function loadImageBitmap(dataUrl: string): Promise<ImageBitmap> {
  return fetch(dataUrl).then((r) => r.blob()).then((b) => createImageBitmap(b));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
