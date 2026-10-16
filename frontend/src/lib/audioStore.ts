
import { supabase } from "./supabase";

const BUCKET = "audio";

export async function saveAudio(id: string, file: Blob): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(id, file, { upsert: true, contentType: file.type || "audio/mpeg" });
  if (error) throw error;
}

export async function loadAudio(id: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(id);
  return error ? null : data;
}

export async function deleteAudio(id: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([id]);
  if (error) throw error;
}
