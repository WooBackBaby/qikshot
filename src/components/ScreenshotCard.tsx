import { Screenshot } from '../lib/db';
import { Tooltip } from './Tooltip';

interface Props {
  screenshot: Screenshot;
  selected: boolean;
  onToggle: () => void;
  onAnnotate: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ScreenshotCard({ screenshot, selected, onToggle, onAnnotate, onDownload, onDelete }: Props) {
  const thumbUrl = screenshot.annotatedUrl ?? screenshot.dataUrl;

  return (
    <div
      className={[
        'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group cursor-default',
        selected ? 'bg-zinc-800/80 ring-1 ring-violet-500/40' : 'hover:bg-zinc-800/50',
      ].join(' ')}
      // Double-click anywhere on the card (outside action buttons) opens annotate
      onDoubleClick={onAnnotate}
    >
      {/* Checkbox — stop double-click bubbling to avoid opening annotate */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="w-3.5 h-3.5 rounded accent-violet-500 flex-shrink-0 cursor-pointer"
      />

      {/* Thumbnail */}
      <div className="w-[60px] h-[40px] flex-shrink-0 rounded overflow-hidden bg-zinc-800 border border-zinc-700">
        <img
          src={thumbUrl}
          alt="Screenshot thumbnail"
          className="w-full h-full object-cover"
        />
      </div>

      {/* Meta */}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-zinc-100 truncate">
          {screenshot.label ?? 'Screenshot'}
        </div>
        <div className="text-xs text-zinc-500 mt-0.5">
          {relativeTime(screenshot.createdAt)}
        </div>
        {screenshot.annotatedUrl && (
          <div className="text-xs text-violet-400 mt-0.5">annotated</div>
        )}
      </div>

      {/* Actions — stop double-click on each button so they don't open annotate */}
      <div
        className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <Tooltip content="Annotate">
          <button
            onClick={onAnnotate}
            className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            <PencilIcon />
          </button>
        </Tooltip>
        <Tooltip content="Download">
          <button
            onClick={onDownload}
            className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            <DownloadIcon />
          </button>
        </Tooltip>
        <Tooltip content="Delete">
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-red-950 text-zinc-400 hover:text-red-400 transition-colors"
          >
            <TrashIcon />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
