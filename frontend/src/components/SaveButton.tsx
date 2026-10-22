import { useState } from "react";

import { useProjects } from "../context/ProjectContext";

// Shows whether the work is safely in the cloud, and lets the user save right
// now instead of waiting. Work that could not be saved yet is also kept in
// this browser and retried (see lib/localDraft.ts), so nothing is lost.

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function SaveButton() {
  const { syncStatus, lastSavedAt, saveNow } = useProjects();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const saving = busy || syncStatus === "saving";
  const problem = failed || syncStatus === "error";

  let label: string;
  let tone: string;
  if (saving) {
    label = "Saving…";
    tone = "text-white/50";
  } else if (problem) {
    label = "Not saved yet · kept on this device, retrying";
    tone = "text-amber-300/80";
  } else if (syncStatus === "loading") {
    label = "Connecting…";
    tone = "text-white/40";
  } else {
    label = lastSavedAt
      ? `All changes saved · ${clock(lastSavedAt)}`
      : "All changes saved";
    tone = "text-white/40";
  }

  async function handleSave() {
    setBusy(true);
    setFailed(false);
    const ok = await saveNow();
    setFailed(!ok);
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-3">
      <span className={`text-xs ${tone}`} role="status" aria-live="polite">
        {label}
      </span>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || syncStatus === "loading"}
        className="cursor-pointer rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.15em] text-white/60 transition hover:border-white/25 hover:text-white disabled:cursor-default disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:text-white/60"
      >
        Save now
      </button>
    </div>
  );
}

export default SaveButton;
