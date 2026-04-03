/**
 * Generates minimal valid PNG icons without any native dependencies.
 * Creates solid violet (#7c3aed) squares with a simple camera silhouette.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import zlib from 'zlib';

const sizes = [16, 48, 128];
if (!existsSync('icons')) mkdirSync('icons');

function uint32BE(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = uint32BE(data.length);
  const crcBuf = Buffer.concat([typeBytes, data]);
  const crc = crc32(crcBuf);
  return Buffer.concat([len, typeBytes, data, uint32BE(crc)]);
}

// CRC32 table
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createPNG(size) {
  // Draw pixels: violet background with a white camera icon
  const pixels = new Uint8Array(size * size * 4);

  // Fill background with violet #7c3aed
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4 + 0] = 0x7c;
    pixels[i * 4 + 1] = 0x3a;
    pixels[i * 4 + 2] = 0xed;
    pixels[i * 4 + 3] = 0xff;
  }

  // Draw a simple camera shape in white
  const s = size / 16; // scale factor (base design is 16x16)

  function setPixel(x, y, r, g, b) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = 255;
  }

  function fillRect(x, y, w, h, r, g, b) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        setPixel(Math.round(x + dx), Math.round(y + dy), r, g, b);
      }
    }
  }

  function fillCircle(cx, cy, radius, r, g, b) {
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= r2) {
          setPixel(Math.round(cx + dx), Math.round(cy + dy), r, g, b);
        }
      }
    }
  }

  // Camera body (white rectangle)
  fillRect(2 * s, 5 * s, 12 * s, 8 * s, 255, 255, 255);
  // Bump on top
  fillRect(5 * s, 3 * s, 4 * s, 3 * s, 255, 255, 255);
  // Lens (violet circle on white body)
  fillCircle(8 * s, 9 * s, 2.5 * s, 0x7c, 0x3a, 0xed);
  // Inner lens (lighter)
  fillCircle(8 * s, 9 * s, 1.2 * s, 0xa7, 0x8b, 0xfa);

  // Build PNG
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB... but we have RGBA, use 6
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Raw image data: filter byte (0) + row bytes
  const rawRows = [];
  for (let y = 0; y < size; y++) {
    rawRows.push(0); // filter type None
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      rawRows.push(pixels[i], pixels[i+1], pixels[i+2], pixels[i+3]);
    }
  }
  const rawData = Buffer.from(rawRows);
  const compressed = zlib.deflateSync(rawData);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of sizes) {
  const png = createPNG(size);
  writeFileSync(`icons/icon${size}.png`, png);
  console.log(`Generated icons/icon${size}.png (${png.length} bytes)`);
}
