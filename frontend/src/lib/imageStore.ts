import { supabase } from "./supabase";

const BUCKET = "drawings";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function saveImage(
  id: string,
  dataUrl: string,
): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(id, blob, {
      upsert: true,
      contentType: blob.type || "image/png",
    });

  if (error) throw error;
}

export async function deleteImage(id: string): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([id]);

  if (error) throw error;
}

// "name -> last-changed time" for every drawing in the bucket. Cheap (no
// downloads), so every device can check it often to notice new/changed
// drawings made on another device.
export async function listImageStamps(): Promise<Map<string, string>> {
  const { data: files, error } = await supabase.storage
    .from(BUCKET)
    .list("", { limit: 1000 });

  if (error) throw error;

  const stamps = new Map<string, string>();
  for (const file of files ?? []) {
    if (!file.name) continue;
    stamps.set(file.name, file.updated_at ?? file.created_at ?? "");
  }
  return stamps;
}

export async function loadImage(id: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(id);
  if (error || !data) return null;
  return blobToDataUrl(data);
}

export async function loadAllImages(): Promise<{
  images: Record<string, string>;
  stamps: Map<string, string>;
}> {
  const listed = await listImageStamps();

  const images: Record<string, string> = {};
  const stamps = new Map<string, string>();

  await Promise.all(
    [...listed].map(async ([name, stamp]) => {
      try {
        const url = await loadImage(name);
        if (url) {
          images[name] = url;
          // Only remember it once we really have it, so a failed download
          // gets retried on the next check.
          stamps.set(name, stamp);
        }
      } catch (error) {
        console.error("Failed to download drawing:", name, error);
      }
    }),
  );

  return { images, stamps };
}