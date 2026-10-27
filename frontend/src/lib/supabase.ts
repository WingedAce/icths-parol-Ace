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

// Extra security check for the Developer Window: confirms that the email and
// password typed in belong to the admin who is signed in right now. It uses a
// separate, temporary client, so the real session is never touched or signed
// out.
export type AdminCheck =
  | "ok"
  | "bad-credentials"
  | "wrong-account"
  | "not-admin"
  | "error";

export async function verifyAdminCredentials(
  email: string,
  password: string,
): Promise<AdminCheck> {
  try {
    const { data: current } = await supabase.auth.getUser();
    const currentEmail = current.user?.email?.toLowerCase();
    if (!current.user || current.user.is_anonymous || !currentEmail) {
      return "not-admin";
    }
    if (email.trim().toLowerCase() !== currentEmail) return "wrong-account";

    const checker = createClient(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: "parol-admin-reauth",
        },
      },
    );

    const { error } = await checker.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) return "bad-credentials";

    const { data: isAdmin } = await checker.rpc("is_admin");
    // "local" only ends this temporary session, never the real one.
    await checker.auth.signOut({ scope: "local" });
    return isAdmin ? "ok" : "not-admin";
  } catch {
    return "error";
  }
}
