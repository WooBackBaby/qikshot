// Self-contained content script — no imports allowed
// Injected on-demand via chrome.scripting.executeScript

(function () {
  if (document.getElementById('__snapshot-overlay__')) return;

  const dpr = window.devicePixelRatio || 1;

  type Phase = 'drawing' | 'selected';
  type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

  let phase: Phase = 'drawing';
  let rect = { x: 0, y: 0, w: 0, h: 0 };

  // ── Root container ─────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = '__snapshot-overlay__';
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    userSelect: 'none',
    cursor: 'crosshair',
    pointerEvents: 'auto',
  });

  // ── Dark panels ────────────────────────────────────────────────────────────
  function makeDark() {
    const div = document.createElement('div');
    Object.assign(div.style, {
      position: 'fixed',
      background: 'rgba(0,0,0,0.55)',
      pointerEvents: 'none',
    });
    return div;
  }

  const panelTop = makeDark();
  const panelBot = makeDark();
  const panelLft = makeDark();
  const panelRgt = makeDark();

  // ── Selection box ──────────────────────────────────────────────────────────
  const sel = document.createElement('div');
  Object.assign(sel.style, {
    position: 'fixed',
    display: 'none',
    boxSizing: 'border-box',
    border: '2px solid #8b5cf6',
    boxShadow: '0 0 0 1px rgba(139,92,246,0.5)',
    pointerEvents: 'none',
  });

  // ── Tip ────────────────────────────────────────────────────────────────────
  const tip = document.createElement('div');
  Object.assign(tip.style, {
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.75)',
    color: '#fff',
    fontSize: '13px',
    padding: '6px 14px',
    borderRadius: '20px',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    backdropFilter: 'blur(4px)',
  });
  tip.textContent = 'Click and drag to select area  •  Esc to cancel';

  // ── Resize handles ─────────────────────────────────────────────────────────
  const handleIds: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const handleCursors: Record<HandleId, string> = {
    nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize', e: 'e-resize',
    se: 'se-resize', s: 's-resize', sw: 'sw-resize', w: 'w-resize',
  };

  const handleEls = new Map<HandleId, HTMLElement>();
  for (const id of handleIds) {
    const h = document.createElement('div');
    Object.assign(h.style, {
      position: 'fixed',
      width: '10px',
      height: '10px',
      background: '#8b5cf6',
      border: '2px solid #fff',
      borderRadius: '2px',
      boxSizing: 'border-box',
      cursor: handleCursors[id],
      display: 'none',
      zIndex: '1',
      pointerEvents: 'auto',
    });
    handleEls.set(id, h);
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  Object.assign(toolbar.style, {
    position: 'fixed',
    display: 'none',
    alignItems: 'center',
    gap: '4px',
    background: 'rgba(18,18,18,0.95)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    padding: '4px',
    backdropFilter: 'blur(8px)',
    zIndex: '2',
    boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
    pointerEvents: 'auto',
  });

  function makeBtn(
    label: string,
    bg: string,
    hoverBg: string,
    svg: string
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: label ? '5px 10px' : '5px 7px',
      border: 'none',
      borderRadius: '5px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '500',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#fff',
      background: bg,
      outline: 'none',
      whiteSpace: 'nowrap',
    });
    btn.innerHTML = svg + (label ? `<span>${label}</span>` : '');
    btn.addEventListener('mouseover', () => { btn.style.background = hoverBg; });
    btn.addEventListener('mouseout',  () => { btn.style.background = bg; });
    return btn;
  }

  const captureBtn = makeBtn('Capture', '#8b5cf6', '#7c3aed', svgCamera());
  const redrawBtn  = makeBtn('Redraw',  'transparent', 'rgba(255,255,255,0.1)', svgRedraw());
  const doneBtn    = makeBtn('',        'transparent', 'rgba(255,255,255,0.1)', svgX());

  toolbar.append(captureBtn, redrawBtn, doneBtn);

  // ── Assemble DOM ───────────────────────────────────────────────────────────
  root.append(panelTop, panelBot, panelLft, panelRgt, sel, tip, toolbar);
  for (const h of handleEls.values()) root.appendChild(h);
  document.body.appendChild(root);
  setDarkLayout(0, 0, 0, 0);

  // ── Drawing phase ──────────────────────────────────────────────────────────
  let startX = 0, startY = 0, dragging = false;

  function enterDrawingPhase() {
    phase = 'drawing';
    root.style.cursor = 'crosshair';
    root.style.pointerEvents = 'auto';
    tip.style.display = 'block';
    sel.style.display = 'none';
    toolbar.style.display = 'none';
    hideHandles();
    setDarkLayout(0, 0, 0, 0);
    rect = { x: 0, y: 0, w: 0, h: 0 };
    chrome.storage.session.remove('cropRect').catch(() => {});
  }

  root.addEventListener('mousedown', (e) => {
    if (phase !== 'drawing') return;
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    sel.style.display = 'block';
    applyDraw(e.clientX, e.clientY);
  });

  root.addEventListener('mousemove', (e) => {
    if (phase !== 'drawing' || !dragging) return;
    applyDraw(e.clientX, e.clientY);
  });

  root.addEventListener('mouseup', (e) => {
    if (phase !== 'drawing' || !dragging) return;
    dragging = false;
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    if (w < 4 || h < 4) return;
    rect = { x, y, w, h };
    enterSelectedPhase();
  });

  function applyDraw(mx: number, my: number) {
    const x = Math.min(startX, mx);
    const y = Math.min(startY, my);
    const w = Math.abs(mx - startX);
    const h = Math.abs(my - startY);
    setSelBox(x, y, w, h);
    setDarkLayout(x, y, w, h);
  }

  // ── Selected phase ─────────────────────────────────────────────────────────
  function enterSelectedPhase() {
    phase = 'selected';
    root.style.cursor = 'default';
    root.style.pointerEvents = 'none';
    tip.style.display = 'none';
    sel.style.display = 'block';
    setSelBox(rect.x, rect.y, rect.w, rect.h);
    setDarkLayout(rect.x, rect.y, rect.w, rect.h);
    showHandles();
    showToolbar();
    chrome.storage.session.set({ cropRect: rect }).catch(() => {});
  }

  // ── Handle dragging ────────────────────────────────────────────────────────
  let activeHandle: HandleId | null = null;
  let handleDragOrigin = { mx: 0, my: 0, rect: { x: 0, y: 0, w: 0, h: 0 } };

  for (const [id, el] of handleEls) {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      activeHandle = id;
      handleDragOrigin = { mx: e.clientX, my: e.clientY, rect: { ...rect } };
      document.addEventListener('mousemove', onHandleMove);
      document.addEventListener('mouseup', onHandleUp);
    });
  }

  function onHandleMove(e: MouseEvent) {
    if (!activeHandle) return;
    const dx = e.clientX - handleDragOrigin.mx;
    const dy = e.clientY - handleDragOrigin.my;
    rect = applyHandleDrag(activeHandle, dx, dy, handleDragOrigin.rect);
    setSelBox(rect.x, rect.y, rect.w, rect.h);
    setDarkLayout(rect.x, rect.y, rect.w, rect.h);
    positionHandles();
    positionToolbar();
  }

  function onHandleUp() {
    activeHandle = null;
    document.removeEventListener('mousemove', onHandleMove);
    document.removeEventListener('mouseup', onHandleUp);
    chrome.storage.session.set({ cropRect: rect }).catch(() => {}); // persist after resize
  }

  function applyHandleDrag(
    id: HandleId,
    dx: number,
    dy: number,
    r: { x: number; y: number; w: number; h: number }
  ) {
    let { x, y, w, h } = r;
    switch (id) {
      case 'nw': x += dx; y += dy; w -= dx; h -= dy; break;
      case 'n':             y += dy;          h -= dy; break;
      case 'ne':            y += dy; w += dx; h -= dy; break;
      case 'e':                      w += dx;          break;
      case 'se':                     w += dx; h += dy; break;
      case 's':                               h += dy; break;
      case 'sw': x += dx;            w -= dx; h += dy; break;
      case 'w':  x += dx;            w -= dx;          break;
    }
    w = Math.max(4, w);
    h = Math.max(4, h);
    return { x, y, w, h };
  }

  // ── Toolbar actions ────────────────────────────────────────────────────────
  captureBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    doCapture().catch(console.error);
  });

  redrawBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    enterDrawingPhase();
  });

  doneBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    cleanup();
  });

  async function doCapture() {
    // 1. Hide entire overlay container
    root.style.visibility = 'hidden';

    // 2. Wait for browser to repaint (rAF + 50ms guarantees it)
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => setTimeout(resolve, 50))
    );

    // 3. Ask service worker to capture, crop, and save
    try {
      await chrome.runtime.sendMessage({
        type: 'CROP_CAPTURE',
        cropRect: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, devicePixelRatio: dpr },
      });
    } catch (_) {
      // Extension context may have been invalidated; swallow
    }

    // 4. Restore overlay
    root.style.visibility = 'visible';

    // 5. Flash to confirm capture
    flashSelection();
  }

  function flashSelection() {
    sel.style.borderColor = '#fff';
    sel.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.5), inset 0 0 30px rgba(255,255,255,0.15)';
    setTimeout(() => {
      sel.style.borderColor = '#8b5cf6';
      sel.style.boxShadow = '0 0 0 1px rgba(139,92,246,0.5)';
    }, 300);
  }

  // ── Layout helpers ─────────────────────────────────────────────────────────
  function setSelBox(x: number, y: number, w: number, h: number) {
    Object.assign(sel.style, {
      left: x + 'px', top: y + 'px',
      width: w + 'px', height: h + 'px',
    });
  }

  function setDarkLayout(x: number, y: number, w: number, h: number) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    Object.assign(panelTop.style, { left: '0', top: '0', width: vw + 'px', height: y + 'px' });
    Object.assign(panelBot.style, { left: '0', top: (y + h) + 'px', width: vw + 'px', height: (vh - y - h) + 'px' });
    Object.assign(panelLft.style, { left: '0', top: y + 'px', width: x + 'px', height: h + 'px' });
    Object.assign(panelRgt.style, { left: (x + w) + 'px', top: y + 'px', width: (vw - x - w) + 'px', height: h + 'px' });
  }

  function positionHandles() {
    const { x, y, w, h } = rect;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const pos: Record<HandleId, [number, number]> = {
      nw: [x,     y    ], n: [cx,    y    ], ne: [x + w, y    ],
      e:  [x + w, cy   ],
      se: [x + w, y + h], s: [cx,    y + h], sw: [x,     y + h],
      w:  [x,     cy   ],
    };
    for (const [id, el] of handleEls) {
      const [hx, hy] = pos[id];
      Object.assign(el.style, { left: (hx - 5) + 'px', top: (hy - 5) + 'px' });
    }
  }

  function positionToolbar() {
    toolbar.style.display = 'flex';
    const tbW = toolbar.offsetWidth || 180;
    const tbH = toolbar.offsetHeight || 36;
    const GAP = 8;
    let tbTop = rect.y - tbH - GAP;
    if (tbTop < 4) tbTop = rect.y + rect.h + GAP;
    let tbLeft = rect.x + rect.w / 2 - tbW / 2;
    tbLeft = Math.max(4, Math.min(tbLeft, window.innerWidth - tbW - 4));
    Object.assign(toolbar.style, { left: tbLeft + 'px', top: tbTop + 'px' });
  }

  function showHandles() {
    for (const el of handleEls.values()) el.style.display = 'block';
    positionHandles();
  }

  function hideHandles() {
    for (const el of handleEls.values()) el.style.display = 'none';
  }

  function showToolbar() {
    positionToolbar();
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────
  document.addEventListener('keydown', onKeyDown, true);
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') cleanup();
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  function cleanup() {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('mousemove', onHandleMove);
    document.removeEventListener('mouseup', onHandleUp);
    root.remove();
    chrome.storage.session.remove('cropRect').catch(() => {});
    chrome.runtime.sendMessage({ type: 'CROP_DISMISSED' }).catch(() => {});
  }

  // ── Restore saved rect from previous navigation ────────────────────────────
  // The service worker injects a tiny inline script that sets window.__cropInitRect
  // before this file runs — reading it here is synchronous, so Rollup never needs
  // to make this IIFE async, and all event listeners above are guaranteed registered.
  const initRect = (window as any).__cropInitRect as
    | { x: number; y: number; w: number; h: number }
    | undefined;
  if (initRect) {
    delete (window as any).__cropInitRect;
    rect = initRect;
    enterSelectedPhase();
  }

  // ── SVG icons ──────────────────────────────────────────────────────────────
  function svgCamera() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  }

  function svgRedraw() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.17"/></svg>`;
  }

  function svgX() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  }
})();
