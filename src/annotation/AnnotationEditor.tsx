import { useEffect, useRef, useState } from 'react';
import { getScreenshot, updateScreenshot, type Screenshot } from '../lib/db';
import { downloadSingle, type ImageFormat, FORMAT_STORAGE_KEY } from '../lib/download';

type Tool = 'select' | 'arrow' | 'rect' | 'text' | 'freehand' | 'eraser' | 'hand';

const PRESET_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#ffffff'];
const MAX_HISTORY = 30;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;
const ZOOM_STEP_BTN = 0.25;
const ZOOM_STEP_WHEEL = 0.08;

export function AnnotationEditor() {
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null);
  const [tool, setTool] = useState<Tool>('freehand');
  const [color, setColor] = useState('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [format, setFormat] = useState<ImageFormat>('png');

  // View state (zoom + pan) — stored in both state (for render) and refs (for event handlers)
  const [viewState, setViewState] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const [fitScale, setFitScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [spacebarHeld, setSpacebarHeld] = useState(false);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const fitScaleRef = useRef(1);
  const spacebarRef = useRef(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<ImageData[]>([]);
  const historyIndexRef = useRef(-1);
  const drawingRef = useRef(false);
  const startPosRef = useRef({ x: 0, y: 0 });
  const snapshotRef = useRef<ImageData | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  // ── View helpers ─────────────────────────────────────────────────────────

  function applyView(zoom: number, pan: { x: number; y: number }) {
    const z = Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX);
    zoomRef.current = z;
    panRef.current = pan;
    setViewState({ zoom: z, pan });
  }

  function resetView() {
    applyView(1, { x: 0, y: 0 });
  }

  function zoomIn() {
    applyView(+(zoomRef.current + ZOOM_STEP_BTN).toFixed(2), panRef.current);
  }

  function zoomOut() {
    applyView(+(zoomRef.current - ZOOM_STEP_BTN).toFixed(2), panRef.current);
  }

  // ── Load screenshot ───────────────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) return;
    getScreenshot(id).then((s) => { if (s) setScreenshot(s); });
    chrome.storage.local.get(FORMAT_STORAGE_KEY).then((data) => {
      const saved = data[FORMAT_STORAGE_KEY] as ImageFormat | undefined;
      if (saved === 'png' || saved === 'jpeg') setFormat(saved);
    });
  }, []);

  function saveFormat(f: ImageFormat) {
    setFormat(f);
    chrome.storage.local.set({ [FORMAT_STORAGE_KEY]: f });
  }

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
      setFitScale(scale);
      // Canvas internal resolution = image natural size
      canvas.width = img.width;
      canvas.height = img.height;
      // CSS size = natural px so transform handles all display scaling
      canvas.style.width = img.width + 'px';
      canvas.style.height = img.height + 'px';
      ctx.drawImage(img, 0, 0);
      pushHistory();
      resetView();
    };
    img.src = screenshot.annotatedUrl ?? screenshot.dataUrl;
  }, [screenshot]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll-wheel / trackpad zoom+pan (non-passive so preventDefault works) ─

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      if (e.ctrlKey) {
        // Pinch-to-zoom (trackpad) or Ctrl+scroll — smooth proportional zoom
        const factor = 1 - e.deltaY * 0.008;
        const newZoom = Math.min(Math.max(+(zoomRef.current * factor).toFixed(3), ZOOM_MIN), ZOOM_MAX);
        const rect = container.getBoundingClientRect();
        const dx = e.clientX - rect.left - rect.width / 2;
        const dy = e.clientY - rect.top - rect.height / 2;
        const ratio = newZoom / zoomRef.current;
        applyView(newZoom, {
          x: dx * (1 - ratio) + panRef.current.x * ratio,
          y: dy * (1 - ratio) + panRef.current.y * ratio,
        });
      } else if (e.deltaX !== 0) {
        // Trackpad two-finger scroll with a horizontal component → pan
        applyView(zoomRef.current, {
          x: panRef.current.x - e.deltaX,
          y: panRef.current.y - e.deltaY,
        });
      } else {
        // Vertical-only scroll (mouse wheel or pure-vertical trackpad) → zoom
        const rect = container.getBoundingClientRect();
        const dx = e.clientX - rect.left - rect.width / 2;
        const dy = e.clientY - rect.top - rect.height / 2;
        const delta = e.deltaY < 0 ? ZOOM_STEP_WHEEL : -ZOOM_STEP_WHEEL;
        const newZoom = Math.min(Math.max(+(zoomRef.current + delta).toFixed(3), ZOOM_MIN), ZOOM_MAX);
        const ratio = newZoom / zoomRef.current;
        applyView(newZoom, {
          x: dx * (1 - ratio) + panRef.current.x * ratio,
          y: dy * (1 - ratio) + panRef.current.y * ratio,
        });
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []); // refs are always current — empty deps is intentional

  // ── Spacebar pan (hold space = temporary pan mode) ────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is inside a text input or the text tool's floating input
      if (e.code !== 'Space' || e.repeat) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      spacebarRef.current = true;
      setSpacebarHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spacebarRef.current = false;
      setSpacebarHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // ── History ───────────────────────────────────────────────────────────────

  function pushHistory() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
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

  // ── Canvas coordinate transform (accounts for CSS scale via transform) ───

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

  // ── Pan (hand tool) ───────────────────────────────────────────────────────

  function startPan(clientX: number, clientY: number) {
    setIsPanning(true);
    const startX = clientX, startY = clientY;
    const startPanX = panRef.current.x, startPanY = panRef.current.y;

    const onMove = (e: MouseEvent) => {
      applyView(zoomRef.current, {
        x: startPanX + e.clientX - startX,
        y: startPanY + e.clientY - startY,
      });
    };

    const onUp = () => {
      setIsPanning(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  function setupCtx(ctx: CanvasRenderingContext2D) {
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    ctx.fillStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'source-over';
    if (tool === 'eraser') ctx.strokeStyle = '#ffffff';
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (tool === 'hand' || spacebarRef.current) { startPan(e.clientX, e.clientY); return; }
    if (tool === 'text') { handleTextTool(e); return; }
    const pos = toCanvasCoords(e);
    startPosRef.current = pos;
    drawingRef.current = true;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
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
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === 'Escape') commit(); });
    input.addEventListener('blur', commit);
    document.body.appendChild(input);
    input.focus();
    textInputRef.current = input;
  }

  // ── Save / Download ───────────────────────────────────────────────────────

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
    await downloadSingle({ ...screenshot, annotatedUrl }, format);
  }

  // ── Tool definitions ──────────────────────────────────────────────────────

  const drawTools: { id: Tool; label: string; icon: JSX.Element }[] = [
    { id: 'select', label: 'Select', icon: <SelectIcon /> },
    { id: 'arrow', label: 'Arrow', icon: <ArrowIcon /> },
    { id: 'rect', label: 'Rectangle', icon: <RectIcon /> },
    { id: 'text', label: 'Text', icon: <TextIcon /> },
    { id: 'freehand', label: 'Draw', icon: <PenIcon /> },
    { id: 'eraser', label: 'Eraser', icon: <EraserIcon /> },
  ];

  const totalScale = fitScale * viewState.zoom;
  const canvasCursor = (tool === 'hand' || spacebarHeld)
    ? (isPanning ? 'grabbing' : 'grab')
    : tool === 'text' ? 'text'
    : tool === 'select' ? 'default'
    : 'crosshair';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen w-screen bg-zinc-100 overflow-hidden">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <div className="w-[240px] flex-shrink-0 bg-zinc-800 flex flex-col text-zinc-100 overflow-y-auto">
        <div className="px-4 py-4 border-b border-zinc-700">
          <div className="text-sm font-semibold text-zinc-200">Annotation Tools</div>
        </div>

        {/* Draw tools (2-col grid) */}
        <div className="px-3 py-3 grid grid-cols-2 gap-1.5">
          {drawTools.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={[
                'flex flex-col items-center gap-1 py-2.5 rounded-lg text-xs font-medium transition-colors',
                tool === t.id ? 'bg-violet-600 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300',
              ].join(' ')}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
          {/* Hand/Pan tool — full width so it stands apart from draw tools */}
          <button
            onClick={() => setTool('hand')}
            className={[
              'col-span-2 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-medium transition-colors',
              tool === 'hand' ? 'bg-violet-600 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300',
            ].join(' ')}
          >
            <HandIcon />
            Pan / Move
          </button>
        </div>

        <div className="h-px bg-zinc-700 mx-3" />

        {/* View / Zoom controls */}
        <div className="px-3 py-3">
          <div className="text-xs text-zinc-400 mb-2 font-medium">Zoom</div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <button
              onClick={zoomOut}
              title="Zoom out"
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white transition-colors flex-shrink-0"
            >
              <ZoomOutIcon />
            </button>
            {/* Zoom % — click to reset to fit */}
            <button
              onClick={resetView}
              title="Reset to fit"
              className="flex-1 h-8 flex items-center justify-center rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white text-xs font-medium transition-colors tabular-nums"
            >
              {Math.round(viewState.zoom * 100)}%
            </button>
            <button
              onClick={zoomIn}
              title="Zoom in"
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white transition-colors flex-shrink-0"
            >
              <ZoomInIcon />
            </button>
          </div>
          <button
            onClick={resetView}
            title="Fit image to window"
            className="w-full h-8 flex items-center justify-center gap-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white text-xs font-medium transition-colors"
          >
            <FitScreenIcon />
            Fit to screen
          </button>
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
            type="range" min={1} max={8} value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-full accent-violet-500"
          />
        </div>

        <div className="h-px bg-zinc-700 mx-3" />

        {/* History controls */}
        <div className="px-3 py-3 grid grid-cols-2 gap-1.5">
          <button onClick={undo} disabled={!canUndo}
            className="flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <UndoIcon /> Undo
          </button>
          <button onClick={redo} disabled={!canRedo}
            className="flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <RedoIcon /> Redo
          </button>
          <button onClick={reset}
            className="col-span-2 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium bg-zinc-700 hover:bg-red-900 text-zinc-300 hover:text-red-300 transition-colors">
            Reset all annotations
          </button>
        </div>

        <div className="h-px bg-zinc-700 mx-3" />

        {/* Save / Download */}
        <div className="px-3 py-3 flex flex-col gap-2 mt-auto">
          <button onClick={handleSave} disabled={saving}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 transition-colors">
            {saveMsg || (saving ? 'Saving…' : 'Save annotation')}
          </button>
          {/* Format toggle */}
          <div className="flex rounded overflow-hidden border border-zinc-600 text-xs">
            <button
              onClick={() => saveFormat('png')}
              className={[
                'flex-1 py-1.5 transition-colors',
                format === 'png' ? 'bg-violet-600 text-white' : 'bg-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600',
              ].join(' ')}
            >
              PNG
            </button>
            <div className="w-px bg-zinc-600" />
            <button
              onClick={() => saveFormat('jpeg')}
              className={[
                'flex-1 py-1.5 transition-colors',
                format === 'jpeg' ? 'bg-violet-600 text-white' : 'bg-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600',
              ].join(' ')}
            >
              JPG
            </button>
          </div>
          <button onClick={handleDownload}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors">
            Download {format === 'jpeg' ? 'JPG' : 'PNG'}
          </button>
        </div>
      </div>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-zinc-200 flex-shrink-0">
          <button onClick={() => window.close()}
            className="flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-900 transition-colors">
            <BackIcon /> Back
          </button>
          <div className="text-sm text-zinc-500">{screenshot?.label ?? 'Screenshot'}</div>
          <button onClick={handleDownload}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-zinc-100 hover:bg-zinc-200 text-zinc-700 transition-colors">
            <DownloadIconSmall /> Download {format === 'jpeg' ? 'JPG' : 'PNG'}
          </button>
        </div>

        {/* Canvas area — transform-based zoom+pan, no overflow-auto needed */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden bg-zinc-200 relative select-none"
          style={{ minHeight: 0 }}
        >
          {!screenshot ? (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-sm">
              Loading…
            </div>
          ) : (
            <div
              ref={canvasWrapRef}
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                // Center in container, then apply user pan + zoom.
                // transform-origin defaults to the element's own center.
                transform: `translate(-50%, -50%) translate(${viewState.pan.x}px, ${viewState.pan.y}px) scale(${totalScale})`,
              }}
            >
              <canvas
                ref={canvasRef}
                style={{ cursor: canvasCursor, display: 'block' }}
                className="shadow-2xl"
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={(e) => { if (drawingRef.current) onMouseUp(e); }}
              />
            </div>
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
function HandIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>;
}
function ZoomInIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>;
}
function ZoomOutIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>;
}
function FitScreenIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>;
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
