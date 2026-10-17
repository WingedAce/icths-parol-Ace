import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
);

// Every visitor gets a session. Students are anonymous; admins sign in later.
// Returns true when a session is ready, false when it could not be started
// (so callers can retry instead of treating "no session" as "no data").
export async function ensureSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) return true;

    const { data: signedIn, error } = await supabase.auth.signInAnonymously();
    if (error) return false;
    return !!signedIn.session;
  } catch {
    return false;
  }
}
