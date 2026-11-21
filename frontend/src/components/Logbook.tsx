import { useEffect, useState } from "react";

import CodeGenerator from "./CodeGenerator";
import ConfirmDialog from "./ConfirmDialog";
import SequenceEditor from "./SequenceEditor";
import { LOGBOOK_MAX, logbookAudioId } from "../lib/logbook";
import type { Frame, LogbookEntry, ProjectNode } from "../types";

const when = (ms: number) =>
  new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

const describe = (entry: LogbookEntry) =>
  `${entry.songName} · ${entry.minutes} minute timer · ${entry.frames.length} keyframe${
    entry.frames.length === 1 ? "" : "s"
  }`;

const noop = () => {};

// The song node the preview and the code read from. It is only a copy of what
// was saved, so nothing here can touch the real rounds.
function entryNode(entry: LogbookEntry, groupId: string): ProjectNode {
  return {
    id: logbookAudioId(entry.id),
    name: entry.songName,
    type: "animation",
    parentId: groupId,
    round: 6,
    audioFileName: entry.songName,
    audioAnalysis: entry.audioAnalysis,
    frames: entry.frames,
    timingMode: entry.timingMode,
    bpmChanges: entry.bpmChanges,
  };
}

// The logbook: the (up to three) Timed mode attempts the group kept. Each one
// can be played and turned into code.
export default function Logbook({
  groupNode,
  entries,
  onDelete,
  onSaveTransition,
  existingTransitionNames,
}: {
  groupNode: ProjectNode;
  entries: LogbookEntry[];
  onDelete: (id: string) => void;
  // Saves picked keyframes as a transition in the group's transition library.
  // The library is separate from the attempt, so deleting the attempt later
  // doesn't remove it.
  onSaveTransition?: (name: string, frames: Frame[]) => void;
  existingTransitionNames?: string[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"play" | "code">("play");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const open = entries.find((e) => e.id === openId);

  if (open) {
    const node = entryNode(open, groupNode.id);
    return (
      <section aria-label="Logbook attempt">
        <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2">
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="cursor-pointer rounded-lg bg-surface px-4 py-2 text-sm font-medium text-fg-soft transition hover:bg-elevated hover:text-fg"
          >
            &larr; All attempts
          </button>
          <p className="text-sm text-fg-muted">
            {describe(open)} · saved {when(open.savedAt)}
          </p>
        </div>

        <div role="tablist" aria-label="Attempt" className="ws-tabs mb-8">
          {(["play", "code"] as const).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className="ws-tab"
            >
              {id === "play" ? "Play" : "Code"}
            </button>
          ))}
        </div>

        {tab === "play" ? (
          <div className="mx-auto max-w-3xl">
            <SequenceEditor
              key={node.id}
              groupNode={groupNode}
              animationNode={node}
              audioSourceId={node.id}
              readOnly
              onFramesChange={noop}
              onTimingChange={noop}
              onSaveTransition={onSaveTransition}
              existingTransitionNames={existingTransitionNames}
            />
          </div>
        ) : (
          <CodeGenerator
            key={node.id}
            round={6}
            pinMappings={groupNode.pinMappings ?? []}
            tricolorGroups={groupNode.tricolorGroups ?? []}
            zones={groupNode.zones ?? []}
            frames={open.frames}
            audioAnalysis={open.audioAnalysis}
            bpmChanges={open.bpmChanges}
            songName={open.songName}
          />
        )}
      </section>
    );
  }

  return (
    <section aria-label="Logbook" className="mx-auto max-w-2xl">
      <p className="mb-6 text-sm text-fg-muted">
        The Timed mode attempts you chose to keep. The logbook holds up to{" "}
        {LOGBOOK_MAX}.
      </p>

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface px-8 py-14 text-center">
          <p className="text-fg">Nothing saved yet.</p>
          <p className="mt-2 text-sm text-fg-muted">
            When a Timed mode attempt ends, choose Save to logbook to keep it
            here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {entries.map((entry, index) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-5"
            >
              <div className="min-w-0">
                <p className="font-medium text-fg">Attempt {index + 1}</p>
                <p className="mt-1 text-sm text-fg-muted">{describe(entry)}</p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Saved {when(entry.savedAt)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTab("play");
                    setOpenId(entry.id);
                  }}
                  className="cursor-pointer rounded-lg bg-pine px-5 py-2 text-sm font-medium text-fg transition hover:bg-pine/80"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteId(entry.id)}
                  className="cursor-pointer rounded-lg bg-elevated px-4 py-2 text-sm text-fg-soft transition hover:bg-line-strong hover:text-fg"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete this attempt?"
          checkboxLabel="I understand"
          confirmLabel="Delete"
          onCancel={() => setDeleteId(null)}
          onConfirm={() => {
            onDelete(deleteId);
            setDeleteId(null);
          }}
        >
          <p>This attempt will be removed from the logbook for good.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

// The logbook is full: pick which saved attempt the new one replaces.
export function LogbookReplaceDialog({
  entries,
  onPick,
  onCancel,
}: {
  entries: LogbookEntry[];
  onPick: (id: string) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Logbook is full"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl bg-surface p-8"
      >
        <h2 className="text-lg font-medium text-fg">The logbook is full</h2>
        <p className="mt-2 text-sm text-fg-muted">
          It keeps {LOGBOOK_MAX} attempts. Pick the one this attempt should
          replace.
        </p>
        <ul className="mt-6 flex flex-col gap-3">
          {entries.map((entry, index) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onPick(entry.id)}
                className="w-full cursor-pointer rounded-xl bg-elevated px-5 py-3 text-left transition hover:bg-line-strong"
              >
                <span className="block text-sm font-medium text-fg">
                  Replace Attempt {index + 1}
                </span>
                <span className="mt-0.5 block text-xs text-fg-muted">
                  {describe(entry)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-lg px-5 py-2 text-sm text-fg-soft transition hover:text-fg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
