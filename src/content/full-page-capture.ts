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
  let aborted = false;

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
    const dpr = window.devicePixelRatio;

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

    // Measure total height after pre-scroll (lazy content may have expanded page)
    let totalHeight = document.documentElement.scrollHeight;

    // Ask user to confirm capture of very tall pages
    if (totalHeight > 15000) {
      const confirmed = await chrome.runtime.sendMessage({
        type: 'SCROLL_CONFIRM_LARGE',
        totalHeight,
      });
      if (!confirmed) {
        aborted = true;
        return;
      }
    }

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

    // Capture all chunks
    const chunks: Array<{ dataUrl: string; scrollY: number }> = [];
    let measuredHeight = totalHeight;
    let i = 0;

    while (i < scrollPositions.length) {
      const scrollY = scrollPositions[i];
      instantScrollTo(scrollY);
      await wait(200);

      const resp = (await chrome.runtime.sendMessage({
        type: 'SCROLL_CAPTURE_CHUNK',
      })) as { dataUrl: string };
      chunks.push({ dataUrl: resp.dataUrl, scrollY });

      // Non-blocking progress update to popup
      chrome.runtime
        .sendMessage({ type: 'SCROLL_PROGRESS', current: i + 1, total: scrollPositions.length })
        .catch(() => {});

      // If page grew (infinite scroll / dynamic content) extend the queue
      const newHeight = document.documentElement.scrollHeight;
      if (newHeight > measuredHeight && i === scrollPositions.length - 1) {
        let nextY = scrollPositions[i] + viewportHeight;
        while (nextY < newHeight - viewportHeight) {
          scrollPositions.push(nextY);
          nextY += viewportHeight;
        }
        scrollPositions.push(Math.max(0, newHeight - viewportHeight));
        measuredHeight = newHeight;
      }

      i++;
    }

    // Hand off to the background for stitching (done in OffscreenCanvas)
    await chrome.runtime.sendMessage({
      type: 'SCROLL_STITCH_CHUNKS',
      chunks,
      totalHeight: measuredHeight,
      viewportWidth,
      dpr,
    });
  }

  try {
    await run();
  } catch (e) {
    if (!aborted) {
      chrome.runtime.sendMessage({ type: 'SCROLL_ERROR', error: String(e) }).catch(() => {});
    }
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
