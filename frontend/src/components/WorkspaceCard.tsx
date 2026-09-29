import type { Workspace } from "../types";

type WorkspaceCardProps = {
  workspace: Workspace;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
};

function WorkspaceCard({
  workspace,
  onClick,
  onRename,
  onDelete,
}: WorkspaceCardProps) {
  return (
    <div className="group relative aspect-[4/3]">
      <button
        onClick={onClick}
        className="absolute inset-0 w-full cursor-pointer rounded-2xl border border-white/10 bg-white/[0.03] p-7 text-left transition duration-500 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.06]"
      >
        <div className="flex h-full flex-col justify-end">
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">
            {workspace.type}
          </p>

          <h2 className="mt-2 font-serif text-3xl font-light">
            {workspace.name}
          </h2>
        </div>
      </button>

      <div className="absolute right-4 top-4 flex gap-2 opacity-0 transition group-hover:opacity-100">
        <button
          onClick={onRename}
          className="cursor-pointer rounded-full bg-black/70 px-3 py-2 text-xs text-white/50 backdrop-blur transition hover:text-white"
        >
          Rename
        </button>

        <button
          onClick={onDelete}
          className="cursor-pointer rounded-full bg-black/70 px-3 py-2 text-xs text-white/50 backdrop-blur transition hover:text-white"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default WorkspaceCard;