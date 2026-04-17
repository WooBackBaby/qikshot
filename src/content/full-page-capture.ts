// Injected on demand for full-page scroll capture. Self-contained — no imports.
(async () => {
  // Guard against double-injection
  if ((window as any).__qikshotScrollCapture) return;
  (window as any).__qikshotScrollCapture = true;

  const originalScrollY = window.scrollY;
  const originalScrollBehavior = document.documentElement.style.scrollBehavior;
  let scrollbarStyle: HTMLStyleElement | null = null;

  interface SavedElement {
    el: HTMLElement;
    position: string;
    transform: string;
    top: string;
    bottom: string;
    left: string;
    right: string;
  }
  const savedElements: SavedElement[] = [];

  function instantScrollTo(y: number) {
    window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
  }

  function wait(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  function waitFrame() {
    return new Promise<void>((r) => requestAnimationFrame(() => r()));
  }

  async function run() {
    // Force instant scroll behavior and go to top
    document.documentElement.style.scrollBehavior = 'instant';
    instantScrollTo(0);
    await waitFrame();
    await wait(300);

    // Hide scrollbars during capture
    scrollbarStyle = document.createElement('style');
    scrollbarStyle.textContent =
      '* { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }';
    document.head.appendChild(scrollbarStyle);

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Silent pre-scroll pass to trigger lazy-loaded content
    {
      let y = 0;
      while (y < document.documentElement.scrollHeight) {
        instantScrollTo(y);
        await wait(100);
        y += viewportHeight;
      }
      instantScrollTo(0);
      await wait(300);
    }

    // Hide all fixed/sticky elements so they only appear once
    const allEls = document.querySelectorAll<HTMLElement>('*');
    for (const el of Array.from(allEls)) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        savedElements.push({
          el,
          position: el.style.position,
          transform: el.style.transform,
          top: el.style.top,
          bottom: el.style.bottom,
          left: el.style.left,
          right: el.style.right,
        });
        el.style.position = 'absolute';
        el.style.transform = 'none';
      }
    }

    const totalHeight = document.documentElement.scrollHeight;

    // Tell the background to prepare for this capture session.
    // Each chunk is captured and drawn directly in the service worker so we never
    // pass large data URLs through runtime messages (which have size limits and
    // cause "failed to fetch" errors on long pages).
    await chrome.runtime.sendMessage({ type: 'SCROLL_START', totalHeight, viewportWidth });

    // Calculate chunk scroll positions.
    // Every chunk except the last uses i * viewportHeight.
    // The final chunk always uses totalHeight - viewportHeight so the page bottom
    // aligns perfectly with no gap and no duplicated strip.
    const numChunks = Math.max(1, Math.ceil(totalHeight / viewportHeight));
    const scrollPositions: number[] = [];
    for (let i = 0; i < numChunks; i++) {
      if (i === numChunks - 1) {
        scrollPositions.push(Math.max(0, totalHeight - viewportHeight));
      } else {
        scrollPositions.push(i * viewportHeight);
      }
    }

    // Capture each chunk. The background handles the actual captureVisibleTab call
    // and draws directly onto its OffscreenCanvas — no data URL is returned here.
    for (let i = 0; i < scrollPositions.length; i++) {
      const scrollY = scrollPositions[i];
      instantScrollTo(scrollY);
      await wait(200);

      const resp = (await chrome.runtime.sendMessage({
        type: 'SCROLL_CAPTURE_CHUNK',
        scrollY,
      })) as { ok?: boolean; error?: string };
      if (resp?.error) throw new Error(resp.error);

      // Non-blocking progress update to popup
      chrome.runtime
        .sendMessage({ type: 'SCROLL_PROGRESS', current: i + 1, total: scrollPositions.length })
        .catch(() => {});
    }

    // Ask the background to finalise: convert canvas → PNG → save to DB
    const finalResp = (await chrome.runtime.sendMessage({
      type: 'SCROLL_FINALIZE',
    })) as { ok?: boolean; error?: string };
    if (finalResp?.error) throw new Error(finalResp.error);
  }

  try {
    await run();
  } catch (e) {
    chrome.runtime.sendMessage({ type: 'SCROLL_ERROR', error: String(e) }).catch(() => {});
  } finally {
    // Restore all fixed/sticky elements
    for (const saved of savedElements) {
      saved.el.style.position = saved.position;
      saved.el.style.transform = saved.transform;
      saved.el.style.top = saved.top;
      saved.el.style.bottom = saved.bottom;
      saved.el.style.left = saved.left;
      saved.el.style.right = saved.right;
    }
    // Remove scrollbar hide style
    if (scrollbarStyle?.parentNode) {
      scrollbarStyle.parentNode.removeChild(scrollbarStyle);
    }
    // Restore original scroll behavior and position
    document.documentElement.style.scrollBehavior = originalScrollBehavior;
    instantScrollTo(originalScrollY);
    delete (window as any).__qikshotScrollCapture;
  }
})();
