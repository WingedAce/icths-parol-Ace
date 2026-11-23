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
  const { syncStatus, lastSavedAt, rejectedCount, saveNow } = useProjects();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const saving = busy || syncStatus === "saving";
  const problem = failed || syncStatus === "error";

  let label: string;
  let tone: string;
  if (saving) {
    label = "Saving…";
    tone = "text-fg-muted";
  } else if (rejectedCount > 0) {
    label = `${rejectedCount} item${rejectedCount === 1 ? "" : "s"} could not be saved (no permission) · your changes are kept on this device`;
    tone = "text-warn";
  } else if (problem) {
    label = "Not saved yet · kept on this device, retrying";
    tone = "text-warn";
  } else if (syncStatus === "loading") {
    label = "Connecting…";
    tone = "text-fg-muted";
  } else {
    label = lastSavedAt
      ? `All changes saved · ${clock(lastSavedAt)}`
      : "All changes saved";
    tone = "text-fg-muted";
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
        className="cursor-pointer rounded-full px-4 py-2 text-xs text-fg-soft transition hover:text-fg disabled:cursor-default disabled:opacity-40 disabled:hover:border-line disabled:hover:text-fg-soft bg-elevated hover:bg-line-strong"
      >
        Save now
      </button>
    </div>
  );
}

export default SaveButton;
