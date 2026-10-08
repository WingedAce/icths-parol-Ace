import { useState } from "react";
import { useNavigate } from "react-router";

import { useProjects } from "./context/ProjectContext";

const AUTH_API_URL = "http://localhost:8000";

function App() {
  const navigate = useNavigate();

  const { workspaces, addWorkspace, getChildren, addNode } =
    useProjects();

  const [batch, setBatch] = useState("");
  const [section, setSection] = useState("");
  const [groupNumber, setGroupNumber] = useState("");

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  const [step, setStep] = useState<"group" | "email" | "code">("group");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lockedMessage, setLockedMessage] = useState("");

  function handleGroupSubmit(event: React.FormEvent) {
    event.preventDefault();

    const batchName = batch.trim();
    const sectionName = section.trim();
    const groupNumberValue = groupNumber.trim();

    if (!batchName || !sectionName || !groupNumberValue) {
      return;
    }

    setError("");
    setStep("email");
  }

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

      const batchName = batch.trim();
      const sectionName = section.trim();
      const groupNumberValue = groupNumber.trim();

      const groupLabel = `Group ${groupNumberValue}`;

      let workspace = workspaces.find(
        (item) =>
          item.type === "batch" &&
          item.name.toLowerCase() === batchName.toLowerCase(),
      );

      const workspaceId =
        workspace?.id ?? addWorkspace(batchName, "batch");

      const sectionChildren = getChildren(workspaceId);

      let sectionNode = sectionChildren.find(
        (item) =>
          item.type === "section" &&
          item.name.toLowerCase() === sectionName.toLowerCase(),
      );

      const sectionNodeId =
        sectionNode?.id ??
        addNode(workspaceId, sectionName, "section");

      const groupChildren = getChildren(sectionNodeId);

      let groupNode = groupChildren.find(
        (item) =>
          item.type === "group" &&
          item.name.toLowerCase() === groupLabel.toLowerCase(),
      );

      if (groupNode?.locked) {
        setLockedMessage(
          `${groupLabel} (${sectionName}, Batch ${batchName}) is locked. Ask your teacher to unlock it.`,
        );
        return;
      }

      setLockedMessage("");

      const groupNodeId =
        groupNode?.id ??
        addNode(sectionNodeId, groupLabel, "group");

      navigate(
        `/workspace/${workspaceId}/${sectionNodeId}/${groupNodeId}`,
      );
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
    <main className="flex min-h-screen items-center justify-center bg-[#050505] px-6 text-white">
      <div className="w-full max-w-sm">

        <div className="mb-12 text-center">
          <p className="mb-5 text-[10px] uppercase tracking-[0.45em] text-white/30">
            Lighting Design System
          </p>

          <h1 className="font-serif text-5xl font-light tracking-[-0.04em]">
            Parol Editor
          </h1>
        </div>

        {step === "group" && (
          <form
            onSubmit={handleGroupSubmit}
            className="flex flex-col gap-4"
          >
            <div>
              <label className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/30">
                Batch
              </label>

              <input
                autoFocus
                value={batch}
                onChange={(event) =>
                  setBatch(event.target.value)
                }
                placeholder="e.g. 2026"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white outline-none placeholder:text-white/20 focus:border-white/30"
              />
            </div>

            <div>
              <label className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/30">
                Section
              </label>

              <input
                value={section}
                onChange={(event) =>
                  setSection(event.target.value)
                }
                placeholder="Enter your section"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white outline-none placeholder:text-white/20 focus:border-white/30"
              />
            </div>

            <div>
              <label className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/30">
                Group Number
              </label>

              <input
                value={groupNumber}
                onChange={(event) =>
                  setGroupNumber(event.target.value)
                }
                placeholder="Enter your group number"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white outline-none placeholder:text-white/20 focus:border-white/30"
              />
            </div>

            {lockedMessage && (
              <p
                role="alert"
                className="rounded-xl border border-[#ff3b41]/60 bg-[#ff3b41]/10 px-4 py-3 text-xs leading-relaxed text-[#ff8a8e]"
              >
                🔒 {lockedMessage}
              </p>
            )}

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
              className="mt-4 w-full cursor-pointer rounded-xl bg-white px-4 py-3 text-black transition hover:bg-white/90"
            >
              Continue
            </button>
          </form>
        )}

        {step === "email" && (
          <form
            onSubmit={handleSendCode}
            className="flex flex-col gap-4"
          >
            <div>
              <label className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/30">
                Gmail Address
              </label>

              <input
                autoFocus
                type="text"
                inputMode="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                placeholder="Enter your Gmail address"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white outline-none placeholder:text-white/20 focus:border-white/30"
              />
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

            <button
              type="button"
              onClick={() => {
                setError("");
                setStep("group");
              }}
              className="w-full cursor-pointer rounded-xl border border-white/15 px-4 py-3 text-sm text-white/60 transition hover:border-white/40 hover:text-white"
            >
              Back
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

              <input
                autoFocus
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(event) =>
                  setCode(
                    event.target.value.replace(/\D/g, ""),
                  )
                }
                placeholder="Enter 6-digit code"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-center text-xl tracking-[0.4em] text-white outline-none placeholder:text-white/20 focus:border-white/30"
              />
            </div>

            <p className="text-center text-xs leading-relaxed text-white/40">
              We sent a verification code to
              <br />
              <span className="text-white/70">{email}</span>
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
                setError("");
                setStep("email");
              }}
              className="w-full cursor-pointer rounded-xl border border-white/15 px-4 py-3 text-sm text-white/60 transition hover:border-white/40 hover:text-white"
            >
              Back
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => navigate("/developer")}
          className="mt-3 w-full cursor-pointer rounded-xl border border-white/15 px-4 py-3 text-sm text-white/60 transition hover:border-white/40 hover:text-white"
        >
          Developer Window
        </button>

      </div>
    </main>
  );
}

export default App;