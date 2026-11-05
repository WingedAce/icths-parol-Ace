import { useGroupPresence } from "../lib/groupPresence";

type GroupPresenceProps = {
  // The Group node's id.
  groupId: string;
};

// A small "N here now" badge. Developers are not included in the number.
function GroupPresence({ groupId }: GroupPresenceProps) {
  const count = useGroupPresence(groupId);

  // Hidden until the live connection is ready (or if it can't connect).
  if (count === null) return null;

  const label =
    count === 0
      ? "No students here now"
      : count === 1
        ? "1 person here now"
        : `${count} people here now`;

  return (
    <span
      title="Students who have this design open right now. Developers are not counted."
      className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs text-white/70"
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${
          count > 0 ? "bg-emerald-400" : "bg-white/30"
        }`}
      />
      {label}
    </span>
  );
}

export default GroupPresence;
