import { useState } from "react";

import { verifyAdminCredentials } from "../lib/supabase";

type AdminReauthDialogProps = {
  // What the admin is about to open, shown in the popup.
  designLabel: string;
  onCancel: () => void;
  // Called only after the email and password were checked and are correct.
  onVerified: () => void;
};

const MESSAGES = {
  "bad-credentials": "Wrong email or password.",
  "wrong-account":
    "That is not the account signed in to the Developer Window. Use the same email and password you signed in with.",
  "not-admin": "This account is not an admin.",
  error: "Couldn't check the login. Check your connection and try again.",
} as const;

// Extra security before an admin opens a design from the Developer Window:
// the email and password used to sign in to this window must be typed again.
function AdminReauthDialog({
  designLabel,
  onCancel,
  onVerified,
}: AdminReauthDialogProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function submit() {
    if (checking || !email.trim() || !password) return;
    setChecking(true);
    setError("");
    const result = await verifyAdminCredentials(email, password);
    if (result === "ok") {
      onVerified();
      return;
    }
    setPassword("");
    setError(MESSAGES[result]);
    setChecking(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reauth-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && !checking) onCancel();
      }}
    >
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#0b0b0b] p-8">
        <h2 id="reauth-title" className="font-serif text-3xl">
          Confirm it's you
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-white/55">
          To open <span className="text-white/85">{designLabel}</span>, enter
          the email and password you used to sign in to the Developer Window.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <input
            autoFocus
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white outline-none placeholder:text-white/20 focus:border-white/30"
          />
          <input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            placeholder="Password"
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white outline-none placeholder:text-white/20 focus:border-white/30"
          />
        </div>

        {error && (
          <p role="alert" className="mt-4 text-xs text-[#ff8a8e]">
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            disabled={checking}
            className="flex-1 cursor-pointer rounded-lg border border-white/10 px-4 py-3 text-white/60 transition hover:border-white/25 hover:text-white disabled:cursor-default disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={checking || !email.trim() || !password}
            className="flex-1 cursor-pointer rounded-lg bg-white px-4 py-3 text-black transition hover:bg-white/90 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-white"
          >
            {checking ? "Checking…" : "Verify and open"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdminReauthDialog;
