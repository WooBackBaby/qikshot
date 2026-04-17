import { useCallback, useEffect, useRef, useState } from 'react';
import { getAllScreenshots, deleteScreenshot, clearAll, type Screenshot } from '../lib/db';
import { captureAndSave } from '../lib/screenshot';
import { downloadSingle, downloadAll } from '../lib/download';
import { ScreenshotCard } from '../components/ScreenshotCard';
import { Button } from '../components/Button';

type ToastType = 'success' | 'error';

interface Toast {
  message: string;
  type: ToastType;
}

export function Popup() {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [capturing, setCapturing] = useState(false);
  const [scrollCapturing, setScrollCapturing] = useState(false);
  const [scrollProgress, setScrollProgress] = useState<{ current: number; total: number } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const scrollPortRef = useRef<chrome.runtime.Port | null>(null);

  const loadScreenshots = useCallback(async () => {
    const all = await getAllScreenshots();
    setScreenshots(all);
  }, []);

  useEffect(() => {
    loadScreenshots();
  }, [loadScreenshots]);

  // Poll chrome.storage.session for annotation saves and crop captures
  useEffect(() => {
    let lastKnown = 0;
    const interval = setInterval(async () => {
      const data = await chrome.storage.session.get('lastSaved');
      const ts = data.lastSaved as number | undefined;
      if (ts && ts !== lastKnown) {
        lastKnown = ts;
        await loadScreenshots();
      }
    }, 500);
    return () => clearInterval(interval);
  }, [loadScreenshots]);

  function showToast(message: string, type: ToastType = 'success') {
    setToast({ message, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }

  async function captureVisible() {
    setCapturing(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? '';
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
        showToast("Can't capture this page type.", 'error');
        return;
      }
      const resp = await chrome.runtime.sendMessage({ type: 'CAPTURE_FULL' }) as { dataUrl?: string; error?: string };
      if (resp.error) throw new Error(resp.error);
      await captureAndSave(resp.dataUrl!);
      await loadScreenshots();
      showToast('Screenshot saved ✓');
    } catch (e) {
      showToast(String(e), 'error');
    } finally {
      setCapturing(false);
    }
  }

  async function captureScrollPage() {
    try {
      // Query the tab here in the popup context — `currentWindow: true` correctly
      // resolves to the browser window when called from a popup. If we let the
      // service worker do this query while the popup is open, `currentWindow`
      // resolves to the popup window (no tabs) and the query returns empty.
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? '';
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
        showToast("Can't capture this page type.", 'error');
        return;
      }
      if (!tab?.id) {
        showToast('No active tab found.', 'error');
        return;
      }

      setScrollCapturing(true);
      setScrollProgress(null);

      const port = chrome.runtime.connect({ name: 'scroll-capture' });
      scrollPortRef.current = port;

      let finished = false;

      function teardown() {
        if (finished) return;
        finished = true;
        scrollPortRef.current = null;
        setScrollCapturing(false);
        setScrollProgress(null);
      }

      port.onMessage.addListener((msg: { type: string; current?: number; total?: number; error?: string }) => {
        if (msg.type === 'SCROLL_PROGRESS') {
          setScrollProgress({ current: msg.current!, total: msg.total! });
        } else if (msg.type === 'SCROLL_COMPLETE') {
          teardown();
          port.disconnect();
          loadScreenshots();
          showToast('Screenshot saved ✓');
        } else if (msg.type === 'SCROLL_ERROR') {
          teardown();
          port.disconnect();
          showToast(msg.error ? `Capture failed: ${msg.error}` : 'Capture failed — please try again', 'error');
        }
      });

      port.onDisconnect.addListener(() => {
        teardown();
      });

      port.postMessage({ type: 'START_SCROLL_CAPTURE', tabId: tab.id });
    } catch (e) {
      showToast('Capture failed — please try again', 'error');
      setScrollCapturing(false);
      setScrollProgress(null);
    }
  }

  async function captureCrop() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? '';
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
        showToast("Can't capture this page type.", 'error');
        return;
      }
      // Send START_CROP to background (fire-and-forget), then close popup so user can interact with the page.
      // Background will save screenshot to IndexedDB and set storage.session.lastSaved.
      chrome.runtime.sendMessage({ type: 'START_CROP' });
      window.close();
    } catch (e) {
      showToast(String(e), 'error');
    }
  }

  async function handleAnnotate(id: string) {
    await chrome.runtime.sendMessage({ type: 'OPEN_ANNOTATION', screenshotId: id });
    window.close();
  }

  async function handleDelete(id: string) {
    await deleteScreenshot(id);
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
    await loadScreenshots();
  }

  async function handleClearAll() {
    await clearAll();
    setSelected(new Set());
    await loadScreenshots();
    setShowSettings(false);
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleSelectAll() {
    if (selected.size === screenshots.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(screenshots.map((s) => s.id)));
    }
  }

  async function handleDeleteSelected() {
    await Promise.all([...selected].map((id) => deleteScreenshot(id)));
    setSelected(new Set());
    await loadScreenshots();
  }

  async function handleDownloadSelected() {
    const items = screenshots.filter((s) => selected.has(s.id));
    if (items.length === 1) {
      await downloadSingle(items[0]);
    } else {
      await downloadAll(items);
    }
  }

  async function handleDownloadAll() {
    if (screenshots.length === 1) {
      await downloadSingle(screenshots[0]);
    } else {
      await downloadAll(screenshots);
    }
  }

  return (
    <div className="w-[380px] h-[520px] bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <CameraIcon className="text-violet-400" />
          <span className="font-semibold text-sm tracking-wide">Qikshot</span>
        </div>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className={[
            'p-1.5 rounded transition-colors',
            showSettings ? 'text-violet-400 bg-zinc-800' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800',
          ].join(' ')}
        >
          <GearIcon />
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900 flex-shrink-0">
          <Button variant="danger" size="sm" onClick={handleClearAll}>
            <TrashIcon />
            Clear all screenshots
          </Button>
        </div>
      )}

      {/* Capture buttons */}
      <div className="px-4 py-3 flex gap-2 flex-shrink-0">
        <button
          onClick={captureVisible}
          disabled={capturing || scrollCapturing}
          className="flex-1 flex flex-col items-center gap-2 py-3 px-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-violet-500/50 hover:bg-zinc-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          <CameraIcon className="text-zinc-400 group-hover:text-violet-400 transition-colors w-5 h-5" />
          <span className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors font-medium">
            Visible
          </span>
        </button>
        <button
          onClick={captureScrollPage}
          disabled={capturing || scrollCapturing}
          className="flex-1 flex flex-col items-center gap-2 py-3 px-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-violet-500/50 hover:bg-zinc-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          <ScrollPageIcon className="text-zinc-400 group-hover:text-violet-400 transition-colors w-5 h-5" />
          <span className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors font-medium">
            {scrollCapturing
              ? scrollProgress
                ? `Capturing ${scrollProgress.current} of ${scrollProgress.total}`
                : 'Starting…'
              : 'Full page'}
          </span>
        </button>
        <button
          onClick={captureCrop}
          disabled={capturing || scrollCapturing}
          className="flex-1 flex flex-col items-center gap-2 py-3 px-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-violet-500/50 hover:bg-zinc-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          <CropIcon className="text-zinc-400 group-hover:text-violet-400 transition-colors w-5 h-5" />
          <span className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors font-medium">
            Crop region
          </span>
        </button>
      </div>


      {/* Divider + count */}
      <div className="flex items-center gap-2 px-4 mb-1 flex-shrink-0">
        <span className="text-xs text-zinc-500 font-medium">
          {screenshots.length === 0 ? 'No screenshots' : `${screenshots.length} screenshot${screenshots.length === 1 ? '' : 's'}`}
        </span>
        <div className="flex-1 h-px bg-zinc-800" />
      </div>

      {/* Gallery */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
        {screenshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
            <CameraIcon className="w-10 h-10" />
            <span className="text-sm">No screenshots yet</span>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {screenshots.map((s) => (
              <ScreenshotCard
                key={s.id}
                screenshot={s}
                selected={selected.has(s.id)}
                onToggle={() => toggleSelect(s.id)}
                onAnnotate={() => handleAnnotate(s.id)}
                onDownload={() => downloadSingle(s)}
                onDelete={() => handleDelete(s.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-zinc-800 flex-shrink-0 bg-zinc-950">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={screenshots.length > 0 && selected.size === screenshots.length}
            onChange={toggleSelectAll}
            disabled={screenshots.length === 0}
            className="w-3.5 h-3.5 rounded accent-violet-500 cursor-pointer disabled:cursor-not-allowed"
          />
          {selected.size > 0 && (
            <span className="text-xs text-violet-400 font-medium">{selected.size} selected</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {selected.size > 0 && (
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteSelected}
            >
              <TrashIcon />
              Delete selected
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownloadSelected}
            disabled={selected.size === 0}
          >
            <DownloadIcon />
            Selected
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleDownloadAll}
            disabled={screenshots.length === 0}
          >
            <DownloadIcon />
            All
          </Button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={[
            'absolute bottom-14 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-xs font-medium shadow-lg pointer-events-none z-50',
            toast.type === 'error'
              ? 'bg-red-900 text-red-200 border border-red-800'
              : 'bg-zinc-800 text-zinc-100 border border-zinc-700',
          ].join(' ')}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function CameraIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function CropIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 2 6 16 20 16" />
      <polyline points="2 6 16 6 16 20" />
    </svg>
  );
}

function ScrollPageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <polyline points="9 13 12 16 15 13" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
