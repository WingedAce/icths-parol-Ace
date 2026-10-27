import { useState } from "react";

const MAX_LENGTH = 60;

type RenameParolDialogProps = {
  // The name shown right now.
  currentName: string;
  // The original group name ("Group 3"), used when the name is cleared.
  originalName: string;
  onCancel: () => void;
  // An empty string means "go back to the original name".
  onSave: (name: string) => void;
};

function RenameParolDialog({
  currentName,
  originalName,
  onCancel,
  onSave,
}: RenameParolDialogProps) {
  const [name, setName] = useState(currentName);
  const trimmed = name.trim();
  // Typing the original name again is the same as clearing the custom one.
  const value = trimmed === originalName ? "" : trimmed;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#0b0b0b] p-8">
        <h2 id="rename-title" className="font-serif text-3xl">
          Rename parol
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-white/55">
          This only changes the name shown here. Students still open their
          design with the same group number ({originalName}).
        </p>

        <input
          autoFocus
          value={name}
          maxLength={MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSave(value);
          }}
          placeholder={originalName}
          className="mt-6 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white outline-none placeholder:text-white/20 focus:border-white/30"
        />
        <p className="mt-2 text-[11px] text-white/30">
          Leave it empty to go back to "{originalName}".
        </p>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 cursor-pointer rounded-lg border border-white/10 px-4 py-3 text-white/60 transition hover:border-white/25 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(value)}
            className="flex-1 cursor-pointer rounded-lg bg-white px-4 py-3 text-black transition hover:bg-white/90"
          >
            Save name
          </button>
        </div>
      </div>
    </div>
  );
}

export default RenameParolDialog;
