import JSZip from 'jszip';
import type { Screenshot } from './db';

export type ImageFormat = 'png' | 'jpeg';

export const FORMAT_STORAGE_KEY = 'downloadFormat';

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function toJpegBlob(dataUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      // JPEG has no alpha — fill white before drawing
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('JPEG encode failed'))),
        'image/jpeg',
        0.92,
      );
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = dataUrl;
  });
}

export async function downloadSingle(
  screenshot: Screenshot,
  format: ImageFormat = 'png',
  filename?: string,
): Promise<void> {
  const srcUrl = screenshot.annotatedUrl ?? screenshot.dataUrl;
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const name = filename ?? `snapshot-${formatTimestamp(screenshot.createdAt)}.${ext}`;

  if (format === 'jpeg') {
    const blob = await toJpegBlob(srcUrl);
    const objectUrl = URL.createObjectURL(blob);
    await chrome.downloads.download({ url: objectUrl, filename: name, saveAs: false });
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  } else {
    await chrome.downloads.download({ url: srcUrl, filename: name, saveAs: false });
  }
}

export async function downloadAll(
  screenshots: Screenshot[],
  format: ImageFormat = 'png',
): Promise<void> {
  if (screenshots.length === 0) return;

  const zip = new JSZip();
  const folder = zip.folder('snapshots')!;
  const ext = format === 'jpeg' ? 'jpg' : 'png';

  for (const s of screenshots) {
    const srcUrl = s.annotatedUrl ?? s.dataUrl;
    const name = `snapshot-${formatTimestamp(s.createdAt)}.${ext}`;

    if (format === 'jpeg') {
      const blob = await toJpegBlob(srcUrl);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      folder.file(name, bytes, { binary: true });
    } else {
      const base64 = srcUrl.split(',')[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      folder.file(name, bytes, { binary: true });
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const zipUrl = URL.createObjectURL(blob);
  const timestamp = formatTimestamp(Date.now());

  await chrome.downloads.download({
    url: zipUrl,
    filename: `snapshots-${timestamp}.zip`,
    saveAs: false,
  });

  setTimeout(() => URL.revokeObjectURL(zipUrl), 5000);
}
