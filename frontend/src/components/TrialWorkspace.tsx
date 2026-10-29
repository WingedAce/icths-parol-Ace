import { useEffect, useState } from "react";

import ConfirmDialog from "./ConfirmDialog";
import PinSetup from "./PinSetup";
import SequenceEditor from "./SequenceEditor";
import ZoneMapper from "./ZoneMapper";
import { stable } from "../lib/cloudSync";
import { localDelete, localGet, localSet } from "../lib/localDraft";
import { describeParts, mergeDesign, mergeRound } from "../utils/trialMerge";
import type {
  BpmChange,
  Frame,
  PinMapping,
  ProjectNode,
  TimingMode,
  TricolorGroup,
  Zone,
} from "../types";

type Round = 1 | 2 | 3;
type SubTab = "zones" | "pins" | "preview";

const ROUNDS: Round[] = [1, 2, 3];

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "zones", label: "Zone Map" },
  { id: "pins", label: "Pins" },
  { id: "preview", label: "Preview" },
];

const EMPTY_FRAMES: Frame[] = [];

// The part of a group that all three rounds share.
export type DesignPiece = {
  zones?: Zone[];
  imageWidth?: number;
  imageHeight?: number;
  pinMappings: PinMapping[];
  tricolorGroups: TricolorGroup[];
};

// The part that belongs to one round (its keyframes and timing).
export type RoundPiece = {
  frames: Frame[];
  timingMode?: TimingMode;
  bpmChanges?: BpmChange[];
};

// A trial piece is only stored once the user actually edits it. `base` is
// what the real piece looked like at that moment, so we can tell (a) whether
// the trial really differs and (b) whether the real one changed meanwhile.
type DesignOverride = DesignPiece & { base: string };
type RoundOverride = RoundPiece & { base: string };

// A frozen copy of the real project. While live sync is off, the trial shows
// THIS for every piece the user hasn't edited, so changes other people make
// in Round 1/2/3 don't move the trial around. It is only refreshed on "Sync now".
type Snapshot = {
  design: DesignPiece;
  rounds: Partial<Record<Round, RoundPiece>>;
};

type TrialDraft = {
  design: DesignOverride | null;
  rounds: Partial<Record<Round, RoundOverride>>;
  previewRound: Round;
  sub: SubTab;
  // Off by default: the trial only follows the real rounds when told to.
  liveSync: boolean;
  snapshot: Snapshot | null;
};

const EMPTY_DRAFT: TrialDraft = {
  design: null,
  rounds: {},
  previewRound: 1,
  sub: "zones",
  liveSync: false,
  snapshot: null,
};

const designOf = (node: ProjectNode): DesignPiece => ({
  zones: node.zones,
  imageWidth: node.imageWidth,
  imageHeight: node.imageHeight,
  pinMappings: node.pinMappings ?? [],
  tricolorGroups: node.tricolorGroups ?? [],
});

const roundPieceOf = (node: ProjectNode): RoundPiece => ({
  frames: node.frames ?? EMPTY_FRAMES,
  timingMode: node.timingMode,
  bpmChanges: node.bpmChanges,
});

function withoutBase<T extends { base: string }>(piece: T): Omit<T, "base"> {
  const { base, ...rest } = piece;
  void base;
  return rest;
}

const draftKey = (groupId: string) => `trial-v1:${groupId}`;
const historyKeyOf = (songId: string) => `history-v1:trial:${songId}`;

function readDraft(saved: unknown): TrialDraft {
  const d = saved as Partial<TrialDraft> | undefined;
  if (!d || typeof d !== "object") return EMPTY_DRAFT;
  return {
    design: d.design && typeof d.design.base === "string" ? d.design : null,
    rounds: d.rounds && typeof d.rounds === "object" ? d.rounds : {},
    previewRound:
      d.previewRound === 2 || d.previewRound === 3 ? d.previewRound : 1,
    sub: d.sub === "pins" || d.sub === "preview" ? d.sub : "zones",
    liveSync: d.liveSync === true,
    snapshot:
      d.snapshot &&
      typeof d.snapshot === "object" &&
      d.snapshot.design &&
      typeof d.snapshot.design === "object"
        ? {
            design: d.snapshot.design,
            rounds:
              d.snapshot.rounds && typeof d.snapshot.rounds === "object"
                ? d.snapshot.rounds
                : {},
          }
        : null,
  };
}

type TrialWorkspaceProps = {
  // The real group (owns the drawing, zones, pins and tricolor merges).
  groupNode: ProjectNode;
  // The real song slot of each round, if it exists yet.
  songNodes: Partial<Record<Round, ProjectNode>>;
  // Writes trial pieces into the REAL project. Only called after the user
  // has been through the "are you sure" popup.
  onApply: (args: {
    round: Round;
    design: DesignPiece | null;
    roundPiece: RoundPiece | null;
  }) => void;
};

// A sandbox copy of the Zone Map, Pins and Preview tabs. Nothing in here
// touches the real rounds: every edit goes into `draft` (kept in this
// browser), and the real project only changes through onApply.
function TrialWorkspace({ groupNode, songNodes, onApply }: TrialWorkspaceProps) {
  const [draft, setDraft] = useState<TrialDraft>(EMPTY_DRAFT);
  const [ready, setReady] = useState(false);
  // Bumped when the trial is reset or applied, so the editors start fresh.
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<
    { kind: "apply"; round: Round } | { kind: "discard" } | { kind: "reset" } | null
  >(null);
  const [notice, setNotice] = useState("");

  function takeSnapshot(): Snapshot {
    const rounds: Partial<Record<Round, RoundPiece>> = {};
    for (const r of ROUNDS) {
      const song = songNodes[r];
      if (song) rounds[r] = roundPieceOf(song);
    }
    return { design: designOf(groupNode), rounds };
  }

  // Bring the saved trial back (so a reload doesn't lose it).
  useEffect(() => {
    let cancelled = false;
    void localGet<unknown>(draftKey(groupNode.id)).then((saved) => {
      if (cancelled) return;
      const loaded = readDraft(saved);
      // First time (or an older saved trial): freeze the real project now.
      setDraft(
        loaded.snapshot ? loaded : { ...loaded, snapshot: takeSnapshot() },
      );
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupNode.id]);

  // A round whose song slot is created after the snapshot was taken joins the
  // snapshot once, so it is frozen too instead of following the real one.
  useEffect(() => {
    if (!ready) return;
    setDraft((prev) => {
      if (!prev.snapshot) return prev;
      let rounds = prev.snapshot.rounds;
      for (const r of ROUNDS) {
        const song = songNodes[r];
        if (song && !rounds[r]) rounds = { ...rounds, [r]: roundPieceOf(song) };
      }
      return rounds === prev.snapshot.rounds
        ? prev
        : { ...prev, snapshot: { ...prev.snapshot, rounds } };
    });
  }, [ready, songNodes]);

  useEffect(() => {
    if (!ready) return;
    void localSet(draftKey(groupNode.id), draft);
  }, [ready, draft, groupNode.id]);

  if (!ready) {
    return <p className="text-sm text-white/30">Opening trial…</p>;
  }

  const { previewRound, sub, liveSync } = draft;

  // The pieces the trial starts from: the real project right now (live sync
  // on) or the frozen copy (live sync off, the default).
  const realDesign = designOf(groupNode);
  const sourceDesign: DesignPiece =
    liveSync || !draft.snapshot ? realDesign : draft.snapshot.design;
  const sourceRound = (r: Round): RoundPiece | undefined => {
    const song = songNodes[r];
    if (!song) return undefined;
    return liveSync ? roundPieceOf(song) : draft.snapshot?.rounds[r] ?? roundPieceOf(song);
  };

  // ---- What the trial looks like right now ----
  const design: DesignPiece = draft.design
    ? withoutBase(draft.design)
    : sourceDesign;
  const trialGroup: ProjectNode = { ...groupNode, ...design };

  const realSong = songNodes[previewRound];
  const roundOverride = draft.rounds[previewRound];
  const trialSong: ProjectNode | undefined = realSong
    ? {
        ...realSong,
        id: `trial:${realSong.id}`,
        ...(roundOverride
          ? withoutBase(roundOverride)
          : sourceRound(previewRound) ?? roundPieceOf(realSong)),
      }
    : undefined;

  const designChanged =
    draft.design !== null &&
    stable(withoutBase(draft.design)) !== draft.design.base;
  const designStale =
    draft.design !== null && stable(designOf(groupNode)) !== draft.design.base;

  const roundChanged = (r: Round) => {
    const o = draft.rounds[r];
    return o !== undefined && stable(withoutBase(o)) !== o.base;
  };
  const roundStale = (r: Round) => {
    const o = draft.rounds[r];
    const song = songNodes[r];
    return (
      o !== undefined && song !== undefined && stable(roundPieceOf(song)) !== o.base
    );
  };

  const changedRounds = ROUNDS.filter(roundChanged);
  const hasAnyChange = designChanged || changedRounds.length > 0;

  // ---- Editing (all of it stays inside the trial) ----
  function editDesign(fn: (current: DesignPiece) => DesignPiece) {
    setDraft((prev) => {
      const current = prev.design
        ? withoutBase(prev.design)
        : sourceDesign;
      return {
        ...prev,
        design: {
          ...fn(current),
          base: prev.design?.base ?? stable(sourceDesign),
        },
      };
    });
  }

  function editRound(r: Round, patch: Partial<RoundPiece>) {
    const song = songNodes[r];
    if (!song) return;
    const start = sourceRound(r) ?? roundPieceOf(song);
    setDraft((prev) => {
      const current: RoundOverride = prev.rounds[r] ?? {
        ...start,
        base: stable(start),
      };
      return {
        ...prev,
        rounds: { ...prev.rounds, [r]: { ...current, ...patch } },
      };
    });
  }

  // How far the real project has moved away from what the trial is showing.
  const realMoved =
    !liveSync &&
    draft.snapshot !== null &&
    (stable(realDesign) !== stable(draft.snapshot.design) ||
      ROUNDS.some((r) => {
        const song = songNodes[r];
        const snap = draft.snapshot?.rounds[r];
        return song !== undefined && snap !== undefined && stable(roundPieceOf(song)) !== stable(snap);
      }));

  function setLiveSync(on: boolean) {
    setDraft((prev) => ({
      ...prev,
      liveSync: on,
      // Turning it off freezes whatever the real project looks like right now.
      snapshot: on ? prev.snapshot : takeSnapshot(),
    }));
    setVersion((v) => v + 1);
    setNotice(
      on
        ? "Live sync is on. Parts you haven't changed here follow the real rounds."
        : "Live sync is off. The trial stays as it is until you press Sync now.",
    );
  }

  // One-time refresh: pull in the real project's latest. Pieces you edited in
  // the trial keep your edits (use "Take out trial changes" to drop those).
  function syncNow() {
    setDraft((prev) => ({ ...prev, snapshot: takeSnapshot() }));
    setVersion((v) => v + 1);
    setNotice(
      "Synced. Parts you haven't changed here now match the real rounds. Parts you edited in the trial were kept.",
    );
  }

  const setSub = (next: SubTab) => setDraft((prev) => ({ ...prev, sub: next }));
  const setPreviewRound = (next: Round) =>
    setDraft((prev) => ({ ...prev, previewRound: next }));

  // ---- Leaving the trial: add it to a real round, or take it out ----
  function applyToRound(r: Round) {
    const useDesign = designChanged && draft.design !== null;
    const roundDraft = draft.rounds[r];
    const useRound = roundChanged(r) && roundDraft !== undefined;

    // Only what the trial changed is added on top of what the real round has
    // now; everything the trial never touched is left exactly as it is.
    const realSong = songNodes[r];
    const designMerged =
      useDesign && draft.design
        ? mergeDesign(draft.design.base, withoutBase(draft.design), designOf(groupNode))
        : null;
    const roundMerged =
      useRound && roundDraft && realSong
        ? mergeRound(roundDraft.base, withoutBase(roundDraft), roundPieceOf(realSong))
        : null;

    onApply({
      round: r,
      design: designMerged ? designMerged.piece : null,
      roundPiece: roundMerged ? roundMerged.piece : null,
    });

    // What was added is now real, so it leaves the trial.
    setDraft((prev) => {
      const rounds = { ...prev.rounds };
      if (useRound) delete rounds[r];
      return {
        ...prev,
        design: useDesign ? null : prev.design,
        rounds,
        // What was just written is now the real thing (the real project hasn't
        // re-rendered yet), so the frozen copy takes those values.
        snapshot: prev.snapshot
          ? {
              design:
                useDesign && draft.design
                  ? withoutBase(draft.design)
                  : prev.snapshot.design,
              rounds:
                useRound && roundDraft
                  ? { ...prev.snapshot.rounds, [r]: withoutBase(roundDraft) }
                  : prev.snapshot.rounds,
            }
          : prev.snapshot,
      };
    });
    const song = songNodes[r];
    if (song) void localDelete(historyKeyOf(song.id));
    setVersion((v) => v + 1);
    setNotice(
      `Only the changes you made in the trial were added to Round ${r}. Everything else in Round ${r} was left as it was.`,
    );
    setDialog(null);
  }

  function discardTrial() {
    for (const r of ROUNDS) {
      const song = songNodes[r];
      if (song) void localDelete(historyKeyOf(song.id));
    }
    setDraft((prev) => ({
      ...EMPTY_DRAFT,
      previewRound: prev.previewRound,
      sub: prev.sub,
      liveSync: prev.liveSync,
      snapshot: takeSnapshot(),
    }));
    setVersion((v) => v + 1);
    setNotice("Trial changes were taken out. Everything matches the real rounds again.");
    setDialog(null);
  }

  // A full fresh start: drops every trial change AND puts the trial view back
  // to how it looks the first time it is opened (Zone Map, Round 1).
  function resetTrial() {
    for (const r of ROUNDS) {
      const song = songNodes[r];
      if (song) void localDelete(historyKeyOf(song.id));
    }
    setDraft({ ...EMPTY_DRAFT, snapshot: takeSnapshot() });
    setVersion((v) => v + 1);
    setNotice("Trial was reset. You are starting a new trial.");
    setDialog(null);
  }

  const summary = hasAnyChange
    ? [
        designChanged ? "Zone map / pins (shared by all rounds)" : null,
        ...changedRounds.map((r) => `Round ${r} keyframes & timing`),
      ]
        .filter(Boolean)
        .join(" · ")
    : "No trial changes yet";

  const applyRound = dialog?.kind === "apply" ? dialog.round : null;

  // What adding the trial to the chosen round would actually change.
  const applyDesignMerge =
    applyRound !== null && designChanged && draft.design
      ? mergeDesign(draft.design.base, withoutBase(draft.design), designOf(groupNode))
      : null;
  const applyRoundSong = applyRound !== null ? songNodes[applyRound] : undefined;
  const applyRoundDraft = applyRound !== null ? draft.rounds[applyRound] : undefined;
  const applyRoundMerge =
    applyRound !== null && roundChanged(applyRound) && applyRoundDraft && applyRoundSong
      ? mergeRound(applyRoundDraft.base, withoutBase(applyRoundDraft), roundPieceOf(applyRoundSong))
      : null;
  const applyConflicts =
    (applyDesignMerge?.conflicts ?? 0) + (applyRoundMerge?.conflicts ?? 0);

  return (
    <div>
      {/* Banner */}
      <div className="mb-6 rounded-2xl border border-amber-200/20 bg-amber-200/[0.04] px-5 py-4">
        <p className="text-[10px] uppercase tracking-[0.3em] text-amber-200/70">
          Trial
        </p>
        <p className="mt-1 text-sm leading-relaxed text-white/55">
          This is a safe copy. Change the zone map, the pins or the keyframes
          here and nothing in Round 1, 2 or 3 changes. If you like the result,
          add it to a round below; if not, take it out.
        </p>
        <p
          className={`mt-3 text-xs ${
            hasAnyChange ? "text-amber-200/80" : "text-white/30"
          }`}
        >
          {summary}
        </p>
      </div>

      {/* Sync with the real rounds */}
      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-3">
        <label className="flex cursor-pointer items-center gap-3 text-[11px] uppercase tracking-wider text-white/60">
          <button
            type="button"
            role="switch"
            aria-checked={liveSync}
            aria-label="Live sync with the real rounds"
            onClick={() => setLiveSync(!liveSync)}
            className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full border transition ${
              liveSync
                ? "border-amber-200/60 bg-amber-200/30"
                : "border-white/20 bg-white/[0.06]"
            }`}
          >
            <span
              className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all ${
                liveSync ? "left-[18px]" : "left-0.5"
              }`}
            />
          </button>
          Live sync {liveSync ? "on" : "off"}
        </label>

        <button
          disabled={liveSync || !realMoved}
          onClick={() => {
            setNotice("");
            syncNow();
          }}
          className="cursor-pointer rounded-full border border-white/15 px-4 py-1.5 text-[11px] uppercase tracking-wider text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:border-white/15 disabled:hover:text-white/70"
        >
          Sync now
        </button>

        <p className="text-xs text-white/35">
          {liveSync
            ? "The trial follows changes made in the real rounds."
            : realMoved
              ? "The real rounds changed since you started. Press Sync now to bring them in."
              : "The trial won't follow the real rounds unless you sync."}
        </p>
      </div>

      {/* Trial actions */}
      <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-white/40">
            Add trial changes to
          </span>
          {ROUNDS.map((r) => {
            const canApply = designChanged || roundChanged(r);
            return (
              <button
                key={r}
                disabled={!canApply}
                onClick={() => {
                  setNotice("");
                  setDialog({ kind: "apply", round: r });
                }}
                className="cursor-pointer rounded-full border border-white/15 px-4 py-1.5 text-[11px] uppercase tracking-wider text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:border-white/15 disabled:hover:text-white/70"
              >
                Round {r}
                {roundChanged(r) ? " •" : ""}
              </button>
            );
          })}
        </div>

        <button
          disabled={!hasAnyChange}
          onClick={() => {
            setNotice("");
            setDialog({ kind: "discard" });
          }}
          className="cursor-pointer rounded-full border border-red-400/20 px-4 py-1.5 text-[11px] uppercase tracking-wider text-red-300/70 transition hover:border-red-400/40 hover:text-red-300 disabled:cursor-default disabled:opacity-30 disabled:hover:border-red-400/20 disabled:hover:text-red-300/70"
        >
          Take out trial changes
        </button>

        <button
          onClick={() => {
            setNotice("");
            setDialog({ kind: "reset" });
          }}
          className="cursor-pointer rounded-full border border-white/15 px-4 py-1.5 text-[11px] uppercase tracking-wider text-white/60 transition hover:border-white/40 hover:text-white"
        >
          Reset trial
        </button>
      </div>

      {notice && <p className="mb-6 text-xs text-emerald-300/80">{notice}</p>}

      {/* Trial tabs */}
      <div
        role="tablist"
        aria-label="Trial steps"
        className="mb-10 flex gap-1 overflow-x-auto border-b border-white/10 sm:overflow-visible"
      >
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={sub === tab.id}
            onClick={() => setSub(tab.id)}
            className={`relative -mb-px shrink-0 cursor-pointer whitespace-nowrap rounded-t-xl border border-b-0 px-5 py-3 text-xs uppercase tracking-[0.2em] transition sm:px-7 ${
              sub === tab.id
                ? "border-white/20 bg-gradient-to-b from-white/[0.09] to-[#050505] text-white shadow-[inset_0_2px_0_0_rgba(253,230,138,0.8)]"
                : "border-transparent text-white/40 hover:bg-white/[0.04] hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {sub === "zones" &&
        (!groupNode.imageDataUrl ? (
          <p className="mx-auto max-w-xl text-center text-sm text-white/40">
            There is no drawing yet. Upload one in Round 1 → Zone Map first,
            then the trial can use a copy of it.
          </p>
        ) : (
          <ZoneMapper
            key={version}
            node={trialGroup}
            onZonesReady={(zones, imageWidth, imageHeight) =>
              editDesign(() => ({
                zones,
                imageWidth,
                imageHeight,
                pinMappings: [],
                tricolorGroups: [],
              }))
            }
            onPinMappingsChange={(pinMappings) =>
              editDesign((d) => ({ ...d, pinMappings }))
            }
            onTricolorGroupsChange={(tricolorGroups) =>
              editDesign((d) => ({ ...d, tricolorGroups }))
            }
            onClearZones={() =>
              editDesign(() => ({
                zones: undefined,
                imageWidth: undefined,
                imageHeight: undefined,
                pinMappings: [],
                tricolorGroups: [],
              }))
            }
          />
        ))}

      {sub === "pins" && (
        <PinSetup
          key={version}
          node={trialGroup}
          onPinMappingsChange={(pinMappings) =>
            editDesign((d) => ({ ...d, pinMappings }))
          }
          onGoToZoneMap={() => setSub("zones")}
        />
      )}

      {sub === "preview" && (
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <span className="text-[11px] uppercase tracking-wider text-white/40">
              Preview
            </span>
            <div
              role="tablist"
              aria-label="Round to preview"
              className="inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1"
            >
              {ROUNDS.map((r) => (
                <button
                  key={r}
                  role="tab"
                  aria-selected={previewRound === r}
                  onClick={() => setPreviewRound(r)}
                  className={`cursor-pointer rounded-xl px-5 py-2 font-serif text-sm tracking-wide transition ${
                    previewRound === r
                      ? "bg-white text-black"
                      : "text-white/50 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  Round {r}
                </button>
              ))}
            </div>
          </div>

          {realSong && trialSong ? (
            <SequenceEditor
              key={`${trialSong.id}-${version}`}
              groupNode={trialGroup}
              animationNode={trialSong}
              audioSourceId={realSong.id}
              onFramesChange={(frames) => editRound(previewRound, { frames })}
              onTimingChange={(timing) => editRound(previewRound, timing)}
            />
          ) : (
            <p className="text-center text-sm text-white/40">
              Round {previewRound} has no song yet. Open Round {previewRound}{" "}
              and add its song on the Song tab, then come back to preview it
              here.
            </p>
          )}
        </div>
      )}

      {applyRound !== null && (
        <ConfirmDialog
          title={`Add trial changes to Round ${applyRound}?`}
          checkboxLabel={`I understand this permanently adds these changes to Round ${applyRound}${
            designChanged ? " and the shared design" : ""
          }`}
          confirmLabel={`Yes, add to Round ${applyRound}`}
          onCancel={() => setDialog(null)}
          onConfirm={() => applyToRound(applyRound)}
        >
          <p>
            Are you sure you want to continue? Only the changes you made in
            the trial are added. Everything you did not change in the trial
            stays exactly as Round {applyRound} has it now.
          </p>
          {applyDesignMerge && (
            <p>
              • Zone map, pins and tricolor merges
              {applyDesignMerge.parts.length > 0
                ? ` (${describeParts(applyDesignMerge.parts)})`
                : ""}
              . The design is shared by all three rounds, so Round 1, Round 2
              and Round 3 are all affected. Keyframes in the other rounds may
              point to pins that no longer exist.
            </p>
          )}
          {applyRoundMerge && (
            <p>
              • Round {applyRound} keyframes and timing
              {applyRoundMerge.parts.length > 0
                ? ` (${describeParts(applyRoundMerge.parts)})`
                : ""}
              . Keyframes you did not touch are kept.
            </p>
          )}
          {((designStale && designChanged) || roundStale(applyRound)) && (
            <p className="text-white/50">
              The real {designStale && designChanged ? "design" : ""}
              {designStale && designChanged && roundStale(applyRound) ? " and " : ""}
              {roundStale(applyRound) ? `Round ${applyRound}` : ""} was changed
              after you started this trial. Those other changes are kept.
            </p>
          )}
          {applyConflicts > 0 && (
            <p className="text-amber-200/80">
              Careful: {applyConflicts} {applyConflicts === 1 ? "item was" : "items were"}{" "}
              changed in both the trial and the real round. For those, the
              trial's version is used.
            </p>
          )}
          <p>This can't be undone.</p>
        </ConfirmDialog>
      )}

      {dialog?.kind === "discard" && (
        <ConfirmDialog
          title="Take out trial changes?"
          checkboxLabel="I want to throw away my trial changes"
          confirmLabel="Yes, take them out"
          onCancel={() => setDialog(null)}
          onConfirm={discardTrial}
        >
          <p>
            Everything you changed in the trial ({summary}) will be thrown
            away and the trial goes back to a fresh copy of the real project.
          </p>
          <p>Round 1, Round 2 and Round 3 are not touched.</p>
        </ConfirmDialog>
      )}

      {dialog?.kind === "reset" && (
        <ConfirmDialog
          title="Reset trial and start a new one?"
          checkboxLabel="I want to reset everything in the trial"
          confirmLabel="Yes, reset trial"
          onCancel={() => setDialog(null)}
          onConfirm={resetTrial}
        >
          <p>
            Everything you did in the trial ({summary}) will be thrown away,
            and the trial goes back to a fresh copy of the real project,
            opened on the Zone Map and Round 1.
          </p>
          <p>Round 1, Round 2 and Round 3 are not touched.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

export default TrialWorkspace;
