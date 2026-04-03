// Self-contained content script — no imports allowed
// Injected on-demand via chrome.scripting.executeScript

(function () {
  // Prevent double-injection
  if (document.getElementById('__snapshot-overlay__')) return;

  const dpr = window.devicePixelRatio || 1;

  // ── Overlay structure ──────────────────────────────────────────────────────
  // We use 4 surrounding divs to create the "spotlight" cut-out effect:
  //  [top][    ]
  //  [lft][sel][rgt]
  //  [bot][    ]

  const root = document.createElement('div');
  root.id = '__snapshot-overlay__';
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    userSelect: 'none',
    cursor: 'crosshair',
  });

  // Four dark panels
  const top = makeDark();
  const bot = makeDark();
  const lft = makeDark();
  const rgt = makeDark();

  // Selection border
  const sel = document.createElement('div');
  Object.assign(sel.style, {
    position: 'fixed',
    display: 'none',
    boxSizing: 'border-box',
    border: '2px solid #8b5cf6',
    boxShadow: '0 0 0 1px rgba(139,92,246,0.5)',
    pointerEvents: 'none',
  });

  // Tooltip
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

  root.append(top, bot, lft, rgt, sel, tip);
  document.body.appendChild(root);

  // Initial: cover entire viewport with dark panels, selection invisible
  setDarkLayout(0, 0, 0, 0);

  // ── Drag state ─────────────────────────────────────────────────────────────
  let startX = 0, startY = 0;
  let dragging = false;

  root.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    sel.style.display = 'block';
    updateSelection(e.clientX, e.clientY);
  });

  root.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    updateSelection(e.clientX, e.clientY);
  });

  root.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;

    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    cleanup();

    if (w < 4 || h < 4) return; // too small, ignore

    chrome.runtime.sendMessage({
      type: 'CROP_SELECTED',
      cropRect: { x, y, width: w, height: h, devicePixelRatio: dpr },
    });
  });

  document.addEventListener('keydown', onKeyDown, true);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      cleanup();
    }
  }

  function updateSelection(mx: number, my: number) {
    const x = Math.min(startX, mx);
    const y = Math.min(startY, my);
    const w = Math.abs(mx - startX);
    const h = Math.abs(my - startY);

    Object.assign(sel.style, {
      left: x + 'px',
      top: y + 'px',
      width: w + 'px',
      height: h + 'px',
    });

    setDarkLayout(x, y, w, h);
  }

  function setDarkLayout(x: number, y: number, w: number, h: number) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Top panel: full width, from top to selection top
    Object.assign(top.style, {
      left: '0', top: '0',
      width: vw + 'px', height: y + 'px',
    });
    // Bottom panel: full width, from selection bottom to viewport bottom
    Object.assign(bot.style, {
      left: '0', top: (y + h) + 'px',
      width: vw + 'px', height: (vh - y - h) + 'px',
    });
    // Left panel: from selection top to selection bottom, left of selection
    Object.assign(lft.style, {
      left: '0', top: y + 'px',
      width: x + 'px', height: h + 'px',
    });
    // Right panel: from selection top to selection bottom, right of selection
    Object.assign(rgt.style, {
      left: (x + w) + 'px', top: y + 'px',
      width: (vw - x - w) + 'px', height: h + 'px',
    });
  }

  function makeDark() {
    const div = document.createElement('div');
    Object.assign(div.style, {
      position: 'fixed',
      background: 'rgba(0,0,0,0.55)',
      pointerEvents: 'none',
    });
    return div;
  }

  function cleanup() {
    document.removeEventListener('keydown', onKeyDown, true);
    root.remove();
  }
})();
