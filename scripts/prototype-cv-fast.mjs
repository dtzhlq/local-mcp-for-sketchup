import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';

const INPUT = '/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/test/手柄/IMG_0152.jpeg';
const OUTDIR = '/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/projects/image-structured-modeler/docs/prototype-output';
fs.mkdirSync(OUTDIR, { recursive: true });

const img = await loadImage(INPUT);
const MAX_W = 800;
const scale = MAX_W / img.width;
const W = MAX_W;
const H = Math.round(img.height * scale);

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.drawImage(img, 0, 0, W, H);

const imgData = ctx.getImageData(0, 0, W, H);
const data = imgData.data;

const gray = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  gray[i] = Math.round(0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2]);
}

// Fast Sobel
const edges = [];
const threshold = 80;
for (let y = 1; y < H-1; y++) {
  for (let x = 1; x < W-1; x++) {
    const i = y*W+x;
    const gx = -gray[i-W-1] + gray[i-W+1] - 2*gray[i-1] + 2*gray[i+1] - gray[i+W-1] + gray[i+W+1];
    const gy = -gray[i-W-1] - 2*gray[i-W] - gray[i-W+1] + gray[i+W-1] + 2*gray[i+W] + gray[i+W+1];
    const mag = gx*gx + gy*gy;
    if (mag > threshold*threshold) edges.push({x, y});
  }
}

console.log(`Resized: ${W}x${H} | Edges: ${edges.length}`);

// Symmetry
let sumX = 0;
for (const e of edges) sumX += e.x;
const centerX = Math.round(sumX / edges.length);
let symmetryScore = 0;
for (const e of edges) {
  const mx = 2 * centerX - e.x;
  if (mx >= 0 && mx < W) symmetryScore++;
}
const score = symmetryScore / edges.length;
console.log(`Symmetry: x=${centerX}, score=${score.toFixed(3)}`);

// Clear and redraw
ctx.clearRect(0, 0, W, H);
ctx.drawImage(img, 0, 0, W, H);

// Darken
ctx.fillStyle = 'rgba(0,0,0,0.4)';
ctx.fillRect(0, 0, W, H);

// Edges in cyan
ctx.fillStyle = '#00ffff';
for (const e of edges) ctx.fillRect(e.x, e.y, 1, 1);

// Symmetry axis
ctx.strokeStyle = '#ff0000';
ctx.lineWidth = 2;
ctx.setLineDash([8, 6]);
ctx.beginPath(); ctx.moveTo(centerX, 0); ctx.lineTo(centerX, H); ctx.stroke();
ctx.setLineDash([]);

// Stats
ctx.fillStyle = 'rgba(0,0,0,0.8)';
ctx.fillRect(8, 8, 280, 70);
ctx.fillStyle = '#fff';
ctx.font = '12px monospace';
ctx.fillText(`IMG_0152.jpeg (${W}x${H})`, 16, 26);
ctx.fillText(`Edges: ${edges.length}  |  Thresh: ${threshold}`, 16, 44);
ctx.fillText(`Symmetry: x=${centerX}, score=${score.toFixed(3)}`, 16, 62);

fs.writeFileSync(OUTDIR + '/cv-overlay-0152-fast.png', canvas.toBuffer('image/png'));
console.log('Saved: cv-overlay-0152-fast.png');
