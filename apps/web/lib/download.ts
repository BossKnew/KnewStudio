export type DownloadItem = { url: string; name: string };

export type DownloadResult = {
  completed: number;
  failed: string[];
};

export async function downloadFiles(items: DownloadItem[], onProgress?: (completed: number, total: number) => void): Promise<DownloadResult> {
  const failed: string[] = [];
  let completed = 0;
  onProgress?.(0, items.length);
  for (const item of items) {
    try {
      const response = await fetch(item.url, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = item.name;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      completed += 1;
    } catch {
      failed.push(item.name);
    }
    onProgress?.(completed, items.length);
  }
  return { completed, failed };
}

export function extensionForMime(mimeType?: string) {
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  return '.png';
}
