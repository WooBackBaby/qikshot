import { saveScreenshot, type Screenshot } from '../lib/db';

// Message types
type Message =
  | { type: 'CAPTURE_FULL' }
  | { type: 'CAPTURE_REGION'; dataUrl: string; cropRect: CropRect }
  | { type: 'OPEN_ANNOTATION'; screenshotId: string }
  | { type: 'START_CROP' }
  | { type: 'CROP_CAPTURE'; cropRect: CropRect }
  | { type: 'CROP_DISMISSED' };

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
