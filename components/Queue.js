"use client";

export default function Queue({ queue, isHost, onPlayNext, onRemove }) {
  if (!queue || queue.length === 0) return null;

  return (
    <div className="rounded-xl bg-neutral-900 border border-neutral-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium">
          Up next <span className="text-neutral-500">({queue.length})</span>
        </p>
        {isHost && (
          <button
            onClick={onPlayNext}
            className="text-xs px-3 py-1.5 rounded-lg bg-accent hover:opacity-90"
          >
            ▶️ Play next
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {queue.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between text-xs bg-neutral-950 rounded-lg px-3 py-2"
          >
            <span className="truncate">
              {item.video_title || item.video_url}
              {item.added_by && <span className="text-neutral-600"> · added by {item.added_by}</span>}
            </span>
            {isHost && (
              <button
                onClick={() => onRemove(item.id)}
                className="text-neutral-600 hover:text-red-400 ml-2 shrink-0"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
