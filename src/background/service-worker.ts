import { saveScreenshot, type Screenshot } from '../lib/db';

// Message types
type Message =
  | { type: 'CAPTURE_FULL' }
  | { type: 'CAPTURE_REGION'; dataUrl: string; cropRect: CropRect }
  | { type: 'OPEN_ANNOTATION'; screenshotId: string }
  | { type: 'START_CROP' }
  | { type: 'CROP_SELECTED'; cropRect: CropRect };

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
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
    // Fire-and-forget: popup will close, we save to DB and signal via session storage
    handleCropFlow(sender).catch(console.error);
    // Acknowledge immediately so the popup can close
    sendResponse({ ok: true });
    return false;
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

async function handleCropFlow(_sender: chrome.runtime.MessageSender) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const tabId = tab.id;
  const tabUrl = tab.url ?? '';
  if (tabUrl.startsWith('chrome://') || tabUrl.startsWith('chrome-extension://') || tabUrl.startsWith('about:')) {
    return;
  }

  // Inject overlay
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/crop-overlay.js'],
    });
  } catch {
    return;
  }

  // Wait for CROP_SELECTED from the content script
  const cropRect = await waitForCropSelected(tabId);
  if (!cropRect) return; // user cancelled

  // Capture + crop
  const fullDataUrl = await captureFullTab();
  const croppedDataUrl = await cropImage(fullDataUrl, cropRect);

  // Save to IndexedDB
  const screenshot: Screenshot = {
    id: crypto.randomUUID(),
    dataUrl: croppedDataUrl,
    createdAt: Date.now(),
  };
  await saveScreenshot(screenshot);

  // Signal popup to refresh
  await chrome.storage.session.set({ lastSaved: Date.now() });
}

function waitForCropSelected(tabId: number): Promise<CropRect | null> {
  return new Promise((resolve) => {
    // Timeout after 2 minutes (user might not draw a selection)
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve(null);
    }, 120_000);

    function listener(msg: Message, msgSender: chrome.runtime.MessageSender) {
      if (msg.type !== 'CROP_SELECTED') return;
      if (msgSender.tab?.id !== tabId) return;
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
      resolve(msg.cropRect);
    }

    chrome.runtime.onMessage.addListener(listener);
  });
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
