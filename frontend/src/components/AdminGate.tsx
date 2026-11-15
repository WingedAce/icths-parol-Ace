
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import Brand from "./Brand";
import WinterBackdrop from "./WinterBackdrop";

type Status = "loading" | "out" | "denied" | "ok";

async function checkStatus(): Promise<Status> {
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.is_anonymous) return "out";
  const { data: isAdmin } = await supabase.rpc("is_admin");
  return isAdmin ? "ok" : "denied";
}

export default function AdminGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    checkStatus().then(setStatus).catch(() => setStatus("out"));
  }, []);

  useEffect(refresh, [refresh]);

  async function signIn() {
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (err) setError(err.message);
    else refresh();
  }

  async function signOut() {
    await supabase.auth.signOut();
    await supabase.auth.signInAnonymously();
    setStatus("out");
  }

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p role="status" className="text-sm text-fg-muted">
          Checking access…
        </p>
      </main>
    );
  }

  if (status === "ok") {
    return (
      <>
        {children}
        <div className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-lg bg-surface px-3 py-1.5 text-sm text-fg-soft shadow-float">
          <span>Signed in as admin</span>
          <button
            className="rounded-full px-2.5 py-1 text-xs text-fg-soft transition hover:text-fg bg-elevated hover:bg-line-strong"
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      </>
    );
  }

  const inputClass =
    "h-11 w-full rounded-lg border px-3.5 text-fg outline-none transition placeholder:text-fg-muted/60 focus:border-line-hover border-transparent bg-elevated";
  const primaryClass =
    "h-11 w-full rounded-lg bg-fg px-4 text-sm font-medium text-canvas transition hover:bg-fg/90";
  const secondaryClass =
    "h-11 w-full rounded-lg border px-4 text-sm text-fg-soft transition hover:text-fg border-transparent bg-elevated hover:bg-line-strong";

  return (
    <main className="winter-app relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      <WinterBackdrop variant="calm" />
      <div className="relative z-10 w-full max-w-sm">
        <Brand className="mb-6" />
        <h1 className="text-3xl font-semibold tracking-tight">
          Developer sign-in
        </h1>
        <div className="mt-8 flex flex-col gap-4">
          {status === "denied" ? (
            <>
              <p className="text-sm leading-relaxed text-fg-muted">
                This account is not an admin.
              </p>
              <button className={secondaryClass} onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <div>
                <label
                  htmlFor="admin-email"
                  className="mb-2 block text-sm font-medium text-fg-soft"
                >
                  Email
                </label>
                <input
                  id="admin-email"
                  type="email"
                  autoComplete="username"
                  className={inputClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label
                  htmlFor="admin-password"
                  className="mb-2 block text-sm font-medium text-fg-soft"
                >
                  Password
                </label>
                <input
                  id="admin-password"
                  className={inputClass}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") signIn();
                  }}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-holly-soft">
                  {error}
                </p>
              )}
              <button className={primaryClass} onClick={signIn}>
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
