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
        className="absolute inset-0 w-full cursor-pointer rounded-xl bg-surface p-7 text-left transition duration-200 hover:border-line-strong hover:bg-elevated"
      >
        <div className="flex h-full flex-col justify-end">
          <p className="text-xs text-fg-muted">
            {workspace.type}
          </p>

          <h2 className="mt-2 font-semibold tracking-tight text-3xl">
            {workspace.name}
          </h2>
        </div>
      </button>

      <div className="absolute right-4 top-4 flex gap-2 opacity-0 transition group-hover:opacity-100">
        <button
          onClick={onRename}
          className="cursor-pointer rounded-lg bg-canvas/90 px-3 py-2 text-xs text-fg-muted transition hover:text-fg"
        >
          Rename
        </button>

        <button
          onClick={onDelete}
          className="cursor-pointer rounded-lg bg-canvas/90 px-3 py-2 text-xs text-fg-muted transition hover:text-fg"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default WorkspaceCard;