
import { useState } from "react";

const AUTH_API_URL = "http://localhost:8000";

type GmailVerificationProps = {
  onVerified: () => void;
};

function GmailVerification({
  onVerified,
}: GmailVerificationProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  const [showEmail, setShowEmail] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const [step, setStep] = useState<"email" | "code">("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSendCode(event: React.FormEvent) {
    event.preventDefault();

    const emailAddress = email.trim().toLowerCase();

    if (!emailAddress) {
      setError("Please enter your Gmail address.");
      return;
    }

    if (!emailAddress.endsWith("@gmail.com")) {
      setError("Please enter a Gmail address.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${AUTH_API_URL}/auth/send-code`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: emailAddress,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Failed to send verification code.",
        );
      }

      setCode("");
      setShowCode(false);
      setStep("code");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to send verification code.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(event: React.FormEvent) {
    event.preventDefault();

    const emailAddress = email.trim().toLowerCase();
    const verificationCode = code.trim();

    if (!verificationCode) {
      setError("Please enter the verification code.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${AUTH_API_URL}/auth/verify-code`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: emailAddress,
            code: verificationCode,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Verification failed.",
        );
      }

      if (!data.verified) {
        throw new Error("Verification failed.");
      }

      onVerified();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Verification failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      {step === "email" && (
        <form
          onSubmit={handleSendCode}
          className="flex flex-col gap-4"
        >
          <div>
            <label className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/30">
              Gmail Address
            </label>

            <div className="relative">
              <input
                autoFocus
                type={showEmail ? "text" : "password"}
                inputMode="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                placeholder="Enter your Gmail address"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 pr-14 text-white outline-none placeholder:text-white/20 focus:border-white/30"
              />

              <button
                type="button"
                onClick={() =>
                  setShowEmail((current) => !current)
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-lg text-white/50 transition hover:text-white"
                aria-label={
                  showEmail
                    ? "Hide Gmail address"
                    : "Show Gmail address"
                }
              >
                {showEmail ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full cursor-pointer rounded-xl bg-white px-4 py-3 text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Sending..." : "Send Verification Code"}
          </button>
        </form>
      )}

      {step === "code" && (
        <form
          onSubmit={handleVerifyCode}
          className="flex flex-col gap-4"
        >
          <div>
            <label className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/30">
              Verification Code
            </label>

            <div className="relative">
              <input
                autoFocus
                type={showCode ? "text" : "password"}
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(event) =>
                  setCode(
                    event.target.value.replace(/\D/g, ""),
                  )
                }
                placeholder="Enter 6-digit code"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 pr-14 text-center text-xl tracking-[0.4em] text-white outline-none placeholder:text-white/20 focus:border-white/30"
              />

              <button
                type="button"
                onClick={() =>
                  setShowCode((current) => !current)
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-lg text-white/50 transition hover:text-white"
                aria-label={
                  showCode
                    ? "Hide verification code"
                    : "Show verification code"
                }
              >
                {showCode ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          <p className="text-center text-xs leading-relaxed text-white/40">
            We sent a verification code to
            <br />
            <span className="text-white/70">
              {email}
            </span>
          </p>

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full cursor-pointer rounded-xl bg-white px-4 py-3 text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Verifying..." : "Verify Gmail"}
          </button>

          <button
            type="button"
            onClick={() => {
              setCode("");
              setShowCode(false);
              setError("");
              setStep("email");
            }}
            className="w-full cursor-pointer rounded-xl border border-white/15 px-4 py-3 text-sm text-white/60 transition hover:border-white/40 hover:text-white"
          >
            Back
          </button>
        </form>
      )}
    </div>
  );
}
export default GmailVerification;
