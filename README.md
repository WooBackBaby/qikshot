# Qikshot

A lightweight Chrome extension for capturing, annotating, and downloading screenshots.

## Features

- **Full page capture** — captures the visible viewport instantly
- **Crop region** — click and drag to select any area of the page
- **Annotation editor** — draw arrows, rectangles, text, freehand, and erase on your screenshots
- **Gallery** — browse all captures with thumbnails, relative timestamps, and bulk selection
- **Download** — export individual screenshots or a ZIP of all selected ones

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

The Qikshot icon will appear in your toolbar. Click it to open the popup.

## Usage

### Capture

- **Full page** — click the camera button in the popup to capture the current tab's visible area
- **Crop region** — click the crop button; the popup closes and a selection overlay appears on the page. Click and drag to draw your selection. Press `Esc` to cancel.

### Annotate

- Click the pencil icon on any screenshot in the gallery
- The annotation editor opens in a new tab
- Choose a tool from the sidebar (arrow, rectangle, text, freehand, eraser)
- Pick a color and stroke width
- Use Undo / Redo / Reset as needed
- Click **Save annotation** to persist the annotated version back to the gallery

### Download

- Click the trash icon to delete a screenshot
- Use checkboxes to select screenshots, then click **Download selected**
- Click **Download all** to export everything as a ZIP archive

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
