export { grayscale, autoEdgeThreshold, sobelEdges, percentileBounds, traceObjectContour };
function grayscale(data, width, height) {
  const gray = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    gray[index] = Math.round(0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2]);
  }
  return gray;
}

function autoEdgeThreshold(gray) {
  let sum = 0;
  for (const value of gray) sum += value;
  const mean = sum / gray.length;
  let variance = 0;
  for (const value of gray) variance += (value - mean) ** 2;
  const std = Math.sqrt(variance / gray.length);
  return clamp(Math.round(std * 1.25), 42, 96);
}

function sobelEdges(gray, width, height, threshold) {
  const thresholdSquared = threshold * threshold;
  const edges = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx = -gray[index - width - 1] + gray[index - width + 1]
        - 2 * gray[index - 1] + 2 * gray[index + 1]
        - gray[index + width - 1] + gray[index + width + 1];
      const gy = -gray[index - width - 1] - 2 * gray[index - width] - gray[index - width + 1]
        + gray[index + width - 1] + 2 * gray[index + width] + gray[index + width + 1];
      const magnitudeSquared = gx * gx + gy * gy;
      if (magnitudeSquared > thresholdSquared) edges.push({ x, y, magnitude: Math.sqrt(magnitudeSquared) });
    }
  }
  return edges;
}

function percentileBounds(edges, width, height) {
  if (edges.length === 0) return null;
  const xs = edges.map((edge) => edge.x).sort((a, b) => a - b);
  const ys = edges.map((edge) => edge.y).sort((a, b) => a - b);
  const minX = xs[Math.floor(xs.length * 0.02)];
  const maxX = xs[Math.floor(xs.length * 0.98)];
  const minY = ys[Math.floor(ys.length * 0.02)];
  const maxY = ys[Math.floor(ys.length * 0.98)];
  return {
    x: clamp(minX, 0, width - 1),
    y: clamp(minY, 0, height - 1),
    width: clamp(maxX - minX, 1, width),
    height: clamp(maxY - minY, 1, height)
  };
}

function traceObjectContour(edges, bounds, width, height) {
  if (!bounds || edges.length === 0) {
    return [[0, 0], [width, 0], [width, height], [0, height], [0, 0]];
  }
  const slices = 18;
  const left = [];
  const right = [];
  for (let index = 0; index < slices; index += 1) {
    const y0 = bounds.y + (bounds.height * index) / slices;
    const y1 = bounds.y + (bounds.height * (index + 1)) / slices;
    const rowEdges = edges.filter((edge) => edge.y >= y0 && edge.y < y1 && edge.x >= bounds.x && edge.x <= bounds.x + bounds.width);
    if (rowEdges.length === 0) continue;
    const xs = rowEdges.map((edge) => edge.x).sort((a, b) => a - b);
    const y = round((y0 + y1) / 2);
    left.push([round(xs[Math.floor(xs.length * 0.08)]), y]);
    right.push([round(xs[Math.floor(xs.length * 0.92)]), y]);
  }
  const contour = [...left, ...right.reverse()];
  if (contour.length < 6) {
    const { x, y } = bounds;
    contour.push([x, y], [x + bounds.width, y], [x + bounds.width, y + bounds.height], [x, y + bounds.height]);
  }
  contour.push(contour[0]);
  return contour.map(([x, y]) => [round(clamp(x, 0, width)), round(clamp(y, 0, height))]);
}


function clamp(v,a,b) { return Math.max(a, Math.min(b,v)); }
function round(v) { return Math.round(v*1000)/1000; }
