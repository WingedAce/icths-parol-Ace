import { formatPin } from "../utils/pins";
import type { PinRemapSummary } from "../utils/pinRemap";

type PinRemapNoticeProps = {
  summary: PinRemapSummary;
  // The round number of each entry in summary.keyframesPerList.
  rounds: number[];
  onApply: () => void;
  onKeep: () => void;
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// Asks whether to turn zones back on after they were given new pins. The
// keyframes only remember pin numbers, so a zone that moved to another pin
// would otherwise go dark in every keyframe where it used to be on.
function PinRemapNotice({
  summary,
  rounds,
  onApply,
  onKeep,
}: PinRemapNoticeProps) {
  const perRound = summary.keyframesPerList
    .map((count, i) => (count > 0 ? `Round ${rounds[i]}: ${count}` : null))
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mb-8 rounded-xl border border-warn/25 bg-warn/5 px-5 py-4">
      <p className="text-xs text-warn">
        Zones got new pins
      </p>
      <p className="mt-2 text-sm leading-relaxed text-fg-soft">
        {plural(summary.zoneCount, "zone")} that used to be on in your
        keyframes {summary.zoneCount === 1 ? "has" : "have"} a different pin
        now. Want the new {summary.moves.length === 1 && summary.moves[0].to.length === 1 ? "pin" : "pins"}{" "}
        turned on in the {plural(summary.keyframeCount, "keyframe")} where
        they used to be on?
      </p>
      <ul className="mt-3 space-y-1 text-xs text-fg-muted">
        {summary.moves.map((move) => (
          <li key={move.from}>
            Pin {formatPin(move.from)} →{" "}
            {move.to.map((pin) => formatPin(pin)).join(", ")} (
            {plural(move.zoneIds.length, "zone")})
          </li>
        ))}
      </ul>
      {perRound && <p className="mt-3 text-xs text-fg-muted">{perRound}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={onApply}
          className="cursor-pointer rounded-lg bg-fg px-5 py-2 text-xs text-canvas transition hover:bg-fg/90"
        >
          Turn them on
        </button>
        <button
          onClick={onKeep}
          className="cursor-pointer rounded-full px-5 py-2 text-xs text-fg-soft transition hover:text-fg bg-elevated hover:bg-line-strong"
        >
          No, leave the keyframes
        </button>
      </div>
    </div>
  );
}

export default PinRemapNotice;
