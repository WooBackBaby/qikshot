import JSZip from 'jszip';
import type { Screenshot } from './db';

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function downloadSingle(screenshot: Screenshot, filename?: string): Promise<void> {
  const url = screenshot.annotatedUrl ?? screenshot.dataUrl;
  const name = filename ?? `snapshot-${formatTimestamp(screenshot.createdAt)}.png`;
  await chrome.downloads.download({ url, filename: name, saveAs: false });
}

export async function downloadAll(screenshots: Screenshot[]): Promise<void> {
  if (screenshots.length === 0) return;

  const zip = new JSZip();
  const folder = zip.folder('snapshots')!;

  for (const s of screenshots) {
    const url = s.annotatedUrl ?? s.dataUrl;
    const name = `snapshot-${formatTimestamp(s.createdAt)}.png`;

    // Convert dataUrl to Uint8Array
    const base64 = url.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    folder.file(name, bytes, { binary: true });
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const zipUrl = URL.createObjectURL(blob);
  const timestamp = formatTimestamp(Date.now());

  await chrome.downloads.download({
    url: zipUrl,
    filename: `snapshots-${timestamp}.zip`,
    saveAs: false,
  });

  // Revoke after a delay to allow download to start
  setTimeout(() => URL.revokeObjectURL(zipUrl), 5000);
}
