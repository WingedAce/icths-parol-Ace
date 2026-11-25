import { useEffect, useState } from "react";

import { ensureSession, supabase } from "./supabase";

// True only for a developer who is signed in (through the Developer Window's
// sign-in) on this browser. It only decides what the page SHOWS: every
// developer action is checked again by the database (is_admin()), and the
// TEST RUN state itself is only ever sent to developers, so hiding or
// editing this in the browser gives a regular user nothing.
export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        await ensureSession();
        const { data } = await supabase.auth.getUser();
        if (!data.user || data.user.is_anonymous) {
          if (!cancelled) setIsAdmin(false);
          return;
        }
        const { data: ok } = await supabase.rpc("is_admin");
        if (!cancelled) setIsAdmin(ok === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    }

    void check();
    // Signing in or out (Developer Window) changes the answer.
    // (Deferred: supabase-js advises against calling it from inside the callback.)
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      window.setTimeout(() => void check(), 0);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return isAdmin;
}
