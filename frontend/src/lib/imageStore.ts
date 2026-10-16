
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

export async function loadAllImages(): Promise<Record<string, string>> {
  const { data: files, error } = await supabase.storage
    .from(BUCKET)
    .list("", { limit: 1000 });

  if (error) throw error;

  const result: Record<string, string> = {};

  await Promise.all(
    (files ?? []).map(async (file) => {
      const { data, error: dlError } = await supabase.storage
        .from(BUCKET)
        .download(file.name);

      if (dlError) {
        console.error(
          "Failed to download drawing:",
          file.name,
          dlError,
        );
      } else if (data) {
        result[file.name] = await blobToDataUrl(data);
      }
    }),
  );

  return result;
}
