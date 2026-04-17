# Qikshot

A lightweight Chrome extension for capturing, annotating, and downloading screenshots.

## Install in Chrome

> No Chrome Web Store listing yet — load it manually in under a minute.

1. **Download this repo** — click the green **Code** button on GitHub, then **Download ZIP**, and unzip it anywhere on your computer
2. **Build the extension:**
   - Install [Node.js](https://nodejs.org) (v18 or newer) if you don't have it
   - Open a terminal in the unzipped folder and run:
     ```bash
     npm install
     npm run build
     ```
   - This creates a `dist/` folder — that's the extension
3. **Load into Chrome:**
   - Go to `chrome://extensions` in your browser
   - Enable **Developer Mode** using the toggle in the top-right corner
   - Click **Load unpacked**
   - Select the `dist/` folder you just built
4. The **Qikshot** icon will appear in your toolbar — click it to start capturing

> The extension stays loaded until you remove it. If you update the code and rebuild, click the refresh icon on the extension card in `chrome://extensions`.

---

## Features

- **Full page capture** — captures the visible viewport instantly
- **Full page scroll capture** — stitches together a full-height screenshot of long pages
- **Crop region** — click and drag to select any area of the page
- **Annotation editor** — draw arrows, rectangles, text, freehand, and erase on your screenshots
  - Zoom and pan with scroll wheel / trackpad pinch, or hold **Space** to drag
  - Fit-to-screen button to reset the view
- **PNG / JPEG format toggle** — choose your export format in the popup footer or annotation editor
- **Gallery** — browse all captures with thumbnails, relative timestamps, and bulk selection
- **Download** — export individual screenshots or a ZIP of all selected ones

## Usage

### Capture

- **Full page** — click the camera button in the popup to capture the current tab's visible area
- **Scroll capture** — click the scroll-capture button to auto-scroll and stitch a full-page screenshot
- **Crop region** — click the crop button; the popup closes and a selection overlay appears. Click and drag to draw your selection. Press `Esc` to cancel.

### Annotate

- Double-click any screenshot in the gallery, or click its pencil icon
- The annotation editor opens in a new tab
- Choose a tool from the sidebar: arrow, rectangle, text, freehand, eraser
- Pick a color and stroke width
- Zoom with the scroll wheel or trackpad pinch; hold **Space** and drag to pan
- Use Undo / Redo / Reset as needed
- Click **Save annotation** to persist the annotated version back to the gallery

### Download

- Click the download icon on any row to save that screenshot
- Use checkboxes to select screenshots, then click **Download selected**
- Click **Download all** to export everything as a ZIP archive
- Toggle **PNG / JPEG** in the footer to set the export format
- Click the trash icon to delete a screenshot

---

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Build

```bash
npm install
npm run build
```

For hot-rebuild during development:

```bash
npm run dev
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer Mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `dist/` folder from this project

## Project structure

```
src/
  popup/          — Extension popup (React)
  annotation/     — Annotation editor page (React)
  background/     — Service worker (handles capture + crop logic)
  content/        — Crop overlay (injected on-demand, no framework)
  lib/            — Shared utilities (IndexedDB, download, screenshot)
  components/     — Shared UI components
dist/             — Built extension (load this in Chrome)
```

## Tech stack

- Vite + React + TypeScript
- Tailwind CSS v3
- IndexedDB for local storage (no external server)
- JSZip for batch downloads
- Manifest V3
