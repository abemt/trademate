/** Client-side image compression + upload to the worker's R2 bucket. */

export async function compressImage(file: File, maxW = 1400, quality = 0.82): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxW / bmp.width);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/webp", quality),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

export async function uploadScreenshot(file: File): Promise<string> {
  const blob = await compressImage(file);
  const res = await fetch("/api/screenshots", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": blob.type || "image/webp" },
    body: blob,
  });
  if (!res.ok) throw new Error("Upload failed");
  const data = (await res.json()) as { id: string };
  return data.id;
}

export function screenshotUrl(id: string): string {
  return `/api/screenshots/${id}`;
}
