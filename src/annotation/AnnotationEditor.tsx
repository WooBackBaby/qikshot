import { useCallback, useEffect, useRef, useState } from 'react';
import { getScreenshot, updateScreenshot, type Screenshot } from '../lib/db';
import { downloadSingle } from '../lib/download';

type Tool = 'select' | 'arrow' | 'rect' | 'text' | 'freehand' | 'eraser';

const PRESET_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#ffffff'];
const MAX_HISTORY = 30;

export function AnnotationEditor() {
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null);
  const [tool, setTool] = useState<Tool>('freehand');
  const [color, setColor] = useState('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [zoomLevel, setZoomLevel] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<ImageData[]>([]);
  const historyIndexRef = useRef(-1);
  const drawingRef = useRef(false);
  const startPosRef = useRef({ x: 0, y: 0 });
  const snapshotRef = useRef<ImageData | null>(null); // snapshot before current stroke
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const fitScaleRef = useRef(1); // initial scale that fits the image to the container

  // Load screenshot on mount
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) return;
    getScreenshot(id).then((s) => {
      if (s) setScreenshot(s);
    });
  }, []);

  // Draw image onto canvas once loaded
  useEffect(() => {
    if (!screenshot || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const img = new Image();
    img.onload = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const scale = Math.min(cw / img.width, ch / img.height, 1);
      fitScaleRef.current = scale;
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.style.width = img.width * scale + 'px';
      canvas.style.height = img.height * scale + 'px';

      ctx.drawImage(img, 0, 0);
      pushHistory();
    };
    img.src = screenshot.annotatedUrl ?? screenshot.dataUrl;
  }, [screenshot]);

  // Apply zoom whenever zoomLevel changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fitScaleRef.current) return;
    const s = fitScaleRef.current * zoomLevel;
    canvas.style.width = canvas.width * s + 'px';
    canvas.style.height = canvas.height * s + 'px';
  }, [zoomLevel]);

  function pushHistory() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Trim redo history
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(data);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    historyIndexRef.current = historyRef.current.length - 1;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }

  function undo() {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current--;
    restoreHistory();
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(true);
  }

  function redo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current++;
    restoreHistory();
    setCanUndo(true);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }

  function restoreHistory() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const data = historyRef.current[historyIndexRef.current];
    if (data) ctx.putImageData(data, 0, 0);
  }

  function reset() {
    if (historyRef.current.length === 0) return;
    historyIndexRef.current = 0;
    restoreHistory();
    historyRef.current = [historyRef.current[0]];
    setCanUndo(false);
    setCanRedo(false);
  }

  // Canvas coordinate transform (CSS scale → actual canvas pixels)
  function toCanvasCoords(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function setupCtx(ctx: CanvasRenderingContext2D) {
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    ctx.fillStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#ffffff';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (tool === 'text') {
      handleTextTool(e);
      return;
    }
    const pos = toCanvasCoords(e);
    startPosRef.current = pos;
    drawingRef.current = true;

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    // Snapshot current state for shape preview
    snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (tool === 'freehand' || tool === 'eraser') {
      setupCtx(ctx);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    }
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const pos = toCanvasCoords(e);
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const start = startPosRef.current;

    if (tool === 'freehand' || tool === 'eraser') {
      setupCtx(ctx);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else if (tool === 'rect' || tool === 'arrow') {
      // Restore snapshot and redraw preview
      if (snapshotRef.current) ctx.putImageData(snapshotRef.current, 0, 0);
      setupCtx(ctx);
      ctx.beginPath();
      if (tool === 'rect') {
        ctx.strokeRect(start.x, start.y, pos.x - start.x, pos.y - start.y);
      } else {
        drawArrow(ctx, start.x, start.y, pos.x, pos.y);
      }
    }
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const pos = toCanvasCoords(e);
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const start = startPosRef.current;

    if (tool === 'rect') {
      if (snapshotRef.current) ctx.putImageData(snapshotRef.current, 0, 0);
      setupCtx(ctx);
      ctx.beginPath();
      ctx.strokeRect(start.x, start.y, pos.x - start.x, pos.y - start.y);
    } else if (tool === 'arrow') {
      if (snapshotRef.current) ctx.putImageData(snapshotRef.current, 0, 0);
      setupCtx(ctx);
      drawArrow(ctx, start.x, start.y, pos.x, pos.y);
    }

    pushHistory();
  }

  function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    const headLen = Math.min(20, Math.hypot(x2 - x1, y2 - y1) * 0.4);
    const angle = Math.atan2(y2 - y1, x2 - x1);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }

  function handleTextTool(e: React.MouseEvent<HTMLCanvasElement>) {
    const pos = toCanvasCoords(e);
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = rect.width / canvasRef.current!.width;
    const scaleY = rect.height / canvasRef.current!.height;

    // Remove existing text input if any
    textInputRef.current?.remove();

    const input = document.createElement('input');
    input.style.cssText = `
      position: fixed;
      left: ${rect.left + pos.x * scaleX}px;
      top: ${rect.top + pos.y * scaleY - 14}px;
      background: rgba(0,0,0,0.7);
      color: ${color};
      border: 1px solid ${color};
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 16px;
      font-family: system-ui, sans-serif;
      outline: none;
      z-index: 9999;
      min-width: 120px;
    `;

    const commit = () => {
      const text = input.value.trim();
      if (text) {
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.font = `${Math.round(strokeWidth * 5 + 10)}px system-ui, sans-serif`;
        ctx.fillStyle = color;
        ctx.fillText(text, pos.x, pos.y);
        pushHistory();
      }
      input.remove();
      textInputRef.current = null;
    };

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === 'Escape') commit();
    });
    input.addEventListener('blur', commit);
    document.body.appendChild(input);
    input.focus();
    textInputRef.current = input;
  }

  async function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas || !screenshot) return;
    setSaving(true);
    try {
      const dataUrl = canvas.toDataURL('image/png');
      await updateScreenshot(screenshot.id, { annotatedUrl: dataUrl });
      await chrome.storage.session.set({ lastSaved: Date.now() });
      setSaveMsg('Saved ✓');
      setTimeout(() => setSaveMsg(''), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas || !screenshot) return;
    const annotatedUrl = canvas.toDataURL('image/png');
    await downloadSingle({ ...screenshot, annotatedUrl });
  }

  const tools: { id: Tool; label: string; icon: JSX.Element }[] = [
    { id: 'select', label: 'Select', icon: <SelectIcon /> },
    { id: 'arrow', label: 'Arrow', icon: <ArrowIcon /> },
    { id: 'rect', label: 'Rectangle', icon: <RectIcon /> },
    { id: 'text', label: 'Text', icon: <TextIcon /> },
    { id: 'freehand', label: 'Draw', icon: <PenIcon /> },
    { id: 'eraser', label: 'Eraser', icon: <EraserIcon /> },
  ];

  return (
    <div className="flex h-screen w-screen bg-zinc-100 overflow-hidden">
      {/* Sidebar */}
      <div className="w-[240px] flex-shrink-0 bg-zinc-800 flex flex-col text-zinc-100 overflow-y-auto">
        <div className="px-4 py-4 border-b border-zinc-700">
          <div className="text-sm font-semibold text-zinc-200">Annotation Tools</div>
        </div>

        {/* Tools */}
        <div className="px-3 py-3 grid grid-cols-2 gap-1.5">
          {tools.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={[
                'flex flex-col items-center gap-1 py-2.5 rounded-lg text-xs font-medium transition-colors',
                tool === t.id
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300',
              ].join(' ')}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="h-px bg-zinc-700 mx-3" />

        {/* Color picker */}
        <div className="px-4 py-3">
          <div className="text-xs text-zinc-400 mb-2 font-medium">Color</div>
          <div className="flex flex-wrap gap-2 mb-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{ background: c }}
                className={[
                  'w-6 h-6 rounded-full border-2 transition-transform hover:scale-110',
                  color === c ? 'border-white scale-110' : 'border-transparent',
                ].join(' ')}
              />
            ))}
          </div>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-full h-7 rounded cursor-pointer border border-zinc-600 bg-zinc-700"
          />
        </div>

        {/* Stroke width */}
        <div className="px-4 py-2">
          <div className="text-xs text-zinc-400 mb-2 font-medium">Stroke — {strokeWidth}px</div>
          <input
            type="range"
            min={1}
            max={8}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-full accent-violet-500"
          />
        </div>

        <div className="h-px bg-zinc-700 mx-3" />

        {/* History controls */}
        <div className="px-3 py-3 grid grid-cols-2 gap-1.5">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <UndoIcon /> Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RedoIcon /> Redo
          </button>
          <button
            onClick={reset}
            className="col-span-2 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium bg-zinc-700 hover:bg-red-900 text-zinc-300 hover:text-red-300 transition-colors"
          >
            Reset all annotations
          </button>
        </div>

        <div className="h-px bg-zinc-700 mx-3" />

        {/* Save / Download */}
        <div className="px-3 py-3 flex flex-col gap-2 mt-auto">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 transition-colors"
          >
            {saveMsg || (saving ? 'Saving…' : 'Save annotation')}
          </button>
          <button
            onClick={handleDownload}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
          >
            Download PNG
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-zinc-200 flex-shrink-0 gap-4">
          <button
            onClick={() => window.close()}
            className="flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-900 transition-colors flex-shrink-0"
          >
            <BackIcon /> Back
          </button>

          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-zinc-100 rounded-md px-1 py-0.5">
            <button
              onClick={() => setZoomLevel((z) => Math.max(+(z - 0.25).toFixed(2), 0.25))}
              className="w-6 h-6 flex items-center justify-center rounded text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 transition-colors text-base font-medium leading-none"
              title="Zoom out"
            >
              −
            </button>
            <button
              onClick={() => setZoomLevel(1)}
              className="min-w-[44px] text-center text-xs font-medium text-zinc-600 hover:text-zinc-900 transition-colors px-1"
              title="Reset zoom"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <button
              onClick={() => setZoomLevel((z) => Math.min(+(z + 0.25).toFixed(2), 4))}
              className="w-6 h-6 flex items-center justify-center rounded text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 transition-colors text-base font-medium leading-none"
              title="Zoom in"
            >
              +
            </button>
          </div>

          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-zinc-100 hover:bg-zinc-200 text-zinc-700 transition-colors flex-shrink-0"
          >
            <DownloadIconSmall /> Download
          </button>
        </div>

        {/* Canvas area */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto bg-zinc-200 flex items-center justify-center"
          style={{ minHeight: 0 }}
        >
          {!screenshot ? (
            <div className="text-zinc-400 text-sm">Loading…</div>
          ) : (
            <canvas
              ref={canvasRef}
              style={{ cursor: tool === 'text' ? 'text' : tool === 'select' ? 'default' : 'crosshair', display: 'block' }}
              className="shadow-2xl"
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={(e) => { if (drawingRef.current) onMouseUp(e); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function SelectIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l14 9-7 1-3 7z"/></svg>;
}
function ArrowIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="12 5 19 5 19 12"/></svg>;
}
function RectIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>;
}
function TextIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>;
}
function PenIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>;
}
function EraserIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20H7L3 16l13-13 7 7-3 3z"/><path d="M6 17l1-1"/></svg>;
}
function UndoIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>;
}
function RedoIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>;
}
function BackIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>;
}
function DownloadIconSmall() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
}
