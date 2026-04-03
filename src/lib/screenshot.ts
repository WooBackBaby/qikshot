import { saveScreenshot, type Screenshot } from './db';

export function generateId(): string {
  return crypto.randomUUID();
}

export async function captureAndSave(dataUrl: string, label?: string): Promise<Screenshot> {
  const screenshot: Screenshot = {
    id: generateId(),
    dataUrl,
    createdAt: Date.now(),
    label,
  };
  await saveScreenshot(screenshot);
  return screenshot;
}
