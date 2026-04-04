import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

export default defineConfig({
  root: 'src',
  plugins: [
    react(),
    {
      name: 'copy-manifest-and-icons',
      closeBundle() {
        // manifest.json
        copyFileSync('manifest.json', 'dist/manifest.json');
        // icons
        if (!existsSync('dist/icons')) mkdirSync('dist/icons', { recursive: true });
        for (const size of ['16', '48', '128']) {
          const src = `icons/icon${size}.png`;
          if (existsSync(src)) copyFileSync(src, `dist/icons/icon${size}.png`);
        }
      },
    },
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        annotation: resolve(__dirname, 'src/annotation/index.html'),
        'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'content/crop-overlay': resolve(__dirname, 'src/content/crop-overlay.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background/service-worker') return 'background/service-worker.js';
          if (chunkInfo.name === 'content/crop-overlay') return 'content/crop-overlay.js';
          return '[name]/index.js';
        },
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
