import { ReactNode, useRef, useState } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  function handleEnter() {
    if (!wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.top });
  }

  return (
    <div
      ref={wrapRef}
      className="inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && (
        // position: fixed escapes overflow:hidden/auto ancestors — no clipping
        <div
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y - 6,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
            pointerEvents: 'none',
          }}
        >
          <div className="bg-zinc-800 text-zinc-100 text-xs px-2 py-1 rounded whitespace-nowrap border border-zinc-700 shadow-lg">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}
