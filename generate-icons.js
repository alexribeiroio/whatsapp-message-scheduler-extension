/**
 * Generates PNG icons for the Chrome extension.
 * Run with: node generate-icons.js
 * Requires: npm install canvas
 */
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.join(__dirname, 'icons');

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const r = size / 2;

  // Background circle
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fillStyle = '#075e54';
  ctx.fill();

  // Inner ring
  ctx.beginPath();
  ctx.arc(r, r, r * 0.85, 0, Math.PI * 2);
  ctx.fillStyle = '#128c7e';
  ctx.fill();

  // White chat bubble
  const bx = size * 0.15, by = size * 0.18;
  const bw = size * 0.55, bh = size * 0.44;
  const br = size * 0.08;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, br);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Bubble tail
  ctx.beginPath();
  ctx.moveTo(size * 0.22, size * 0.60);
  ctx.lineTo(size * 0.15, size * 0.74);
  ctx.lineTo(size * 0.36, size * 0.62);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Clock circle (bottom-right)
  const cx = size * 0.64, cy = size * 0.62, cr = size * 0.22;
  ctx.beginPath();
  ctx.arc(cx, cy, cr, 0, Math.PI * 2);
  ctx.fillStyle = '#25d366';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, cr * 0.82, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Clock hands
  ctx.strokeStyle = '#075e54';
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - cr * 0.42, cy - cr * 0.38);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + cr * 0.48, cy - cr * 0.18);
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, size * 0.03), 0, Math.PI * 2);
  ctx.fillStyle = '#075e54';
  ctx.fill();

  return canvas;
}

SIZES.forEach(size => {
  const canvas = drawIcon(size);
  const buf = canvas.toBuffer('image/png');
  const outPath = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`✔ icons/icon${size}.png`);
});

console.log('\nIcones gerados com sucesso!');
