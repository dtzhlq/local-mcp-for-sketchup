import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';
import path from 'path';

const INPUT = '/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/test/手柄/IMG_0152.jpeg';
const OUTDIR = '/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/projects/image-structured-modeler/docs/prototype-output';
fs.mkdirSync(OUTDIR, { recursive: true });

const img = await loadImage(INPUT);
const W = img.width, H = img.height;
console.log(`Image: ${W}x${H}`);

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.drawImage(img, 0, 0);

const imgData = ctx.getImageData(0, 0, W, H);
const data = imgData.data;

// Grayscale
const gray = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) {
  gray[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2];
}

// Sobel edges
const edges = [];
const threshold = 60;
for (let y = 1; y < H-1; y++) {
  for (let x = 1; x < W-1; x++) {
    const gx = -gray[(y-1)*W+x-1] + gray[(y-1)*W+x+1]
             - 2*gray[y*W+x-1]     + 2*gray[y*W+x+1]
             - gray[(y+1)*W+x-1] + gray[(y+1)*W+x+1];
    const gy = -gray[(y-1)*W+x-1] - 2*gray[(y-1)*W+x] - gray[(y-1)*W+x+1]
             + gray[(y+1)*W+x-1] + 2*gray[(y+1)*W+x] + gray[(y+1)*W+x+1];
    const mag = Math.sqrt(gx*gx + gy*gy);
    if (mag > threshold) edges.push({x, y, mag});
  }
}

console.log(`Edges detected: ${edges.length}`);

// Symmetry axis
let sumX = 0;
for (const e of edges) sumX += e.x;
const centerX = Math.round(sumX / edges.length);

let symmetryScore = 0;
for (const e of edges) {
  const mirrorX = 2 * centerX - e.x;
  if (mirrorX >= 0 && mirrorX < W) symmetryScore++;
}
const score = symmetryScore / edges.length;
console.log(`Symmetry axis: x=${centerX}, score=${score.toFixed(3)}`);

// Draw overlay
ctx.globalAlpha = 0.3;
ctx.drawImage(img, 0, 0);
ctx.globalAlpha = 1.0;

// Green edges
ctx.fillStyle = '#00ff00';
for (const e of edges) ctx.fillRect(e.x, e.y, 1, 1);

// Red symmetry axis
ctx.strokeStyle = '#ff0000';
ctx.lineWidth = 3;
ctx.setLineDash([15, 10]);
ctx.beginPath(); ctx.moveTo(centerX, 0); ctx.lineTo(centerX, H); ctx.stroke();
ctx.setLineDash([]);

ctx.fillStyle = '#ff0000';
ctx.font = 'bold 24px sans-serif';
ctx.fillText(`SYMMETRY (score: ${score.toFixed(2)})`, centerX + 10, 40);

// Edge density regions
const regionSize = 50;
const regions = [];
for (let ry = 0; ry < H; ry += regionSize) {
  for (let rx = 0; rx < W; rx += regionSize) {
    let count = 0;
    for (const e of edges) {
      if (e.x >= rx && e.x < rx+regionSize && e.y >= ry && e.y < ry+regionSize) count++;
    }
    regions.push({x: rx, y: ry, density: count/(regionSize*regionSize)});
  }
}
const highDensity = regions.filter(r => r.density > 0.01);
ctx.strokeStyle = '#ffff00';
ctx.lineWidth = 2;
for (const r of highDensity) ctx.strokeRect(r.x, r.y, regionSize, regionSize);

// Stats box
ctx.fillStyle = 'rgba(0,0,0,0.7)';
ctx.fillRect(10, H-130, 380, 120);
ctx.fillStyle = '#fff';
ctx.font = '14px monospace';
ctx.fillText(`Image: ${W}x${H}`, 20, H-110);
ctx.fillText(`Edges: ${edges.length}`, 20, H-90);
ctx.fillText(`Symmetry: x=${centerX}, score=${score.toFixed(3)}`, 20, H-70);
ctx.fillText(`High-density regions: ${highDensity.length}`, 20, H-50);
ctx.fillText(`Sobel threshold=${threshold}`, 20, H-30);

const outPath = path.join(OUTDIR, 'cv-overlay-0152.png');
fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
console.log(`Saved: ${outPath}`);
