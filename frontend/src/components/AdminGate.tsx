
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";

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
    return <p className="p-8">Checking access…</p>;
  }

  if (status === "ok") return <>{children}</>;

  return (
    <div className="mx-auto mt-24 max-w-sm space-y-3 rounded-xl border p-6">
      <h1 className="text-lg font-semibold">Developer sign-in</h1>
      {status === "denied" ? (
        <>
          <p>This account is not an admin.</p>
          <button className="rounded border px-3 py-1" onClick={signOut}>
            Sign out
          </button>
        </>
      ) : (
        <>
          <input
            className="w-full rounded border p-2"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full rounded border p-2"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="rounded border px-3 py-1" onClick={signIn}>
            Sign in
          </button>
        </>
      )}
    </div>
  );
}
