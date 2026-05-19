#!/usr/bin/env node
/**
 * 快速原型：几何约束检测（参考 Free2CAD 方法学）
 * 
 * Free2CAD 核心思想（从论文提取）：
 * 1. Stroke Grouping → 将相邻/共线/平行的笔画聚合为 feature（线/圆/弧）
 * 2. Geometric Constraint Detection → 检测对称轴、平行、垂直、同心、等距
 * 3. Constraint Propagation → 已知一个尺寸约束，传播到其他相关特征
 * 4. CAD Command Fitting → 将约束后的特征匹配到 CAD 命令
 * 
 * 我们的 adaptation：
 * - 输入不是手绘笔画，而是照片轮廓（边缘检测结果）
 * - 特征从"笔画"变成"轮廓线段"
 * - 目标不是 CAD 命令，而是 overlay 约束标注
 */

import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';
import path from 'path';

const INPUT_DIR = '/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/test/手柄';
const OUTPUT_DIR = '/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/projects/image-structured-modeler/docs/prototype-output';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * 1. 轮廓提取（边缘检测 + 轮廓简化）
 * 使用简单的阈值/边缘检测，因为 canvas 没有 OpenCV 的 Canny
 * 在实际实现中会用 OpenCV 的 cv.Canny + cv.findContours + cv.approxPolyDP
 */
async function extractContours(imagePath) {
  const img = await loadImage(imagePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  
  // 简单的灰度 + Sobel 边缘检测（快速原型用）
  // 实际实现用 OpenCV Canny
  const edges = sobelEdgeDetect(imageData);
  
  return {
    width: img.width,
    height: img.height,
    edges,
    // 轮廓简化后的线段列表
    segments: [] // TODO: 用 Douglas-Peucker 简化
  };
}

function sobelEdgeDetect(imageData) {
  const { width, height, data } = imageData;
  const gray = new Float32Array(width * height);
  
  // 灰度化
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      gray[y * width + x] = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    }
  }
  
  // Sobel 算子（简化版）
  const edges = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx = 
        -1 * gray[(y-1)*width+(x-1)] + 1 * gray[(y-1)*width+(x+1)] +
        -2 * gray[y*width+(x-1)]     + 2 * gray[y*width+(x+1)] +
        -1 * gray[(y+1)*width+(x-1)] + 1 * gray[(y+1)*width+(x+1)];
      
      const gy = 
        -1 * gray[(y-1)*width+(x-1)] - 2 * gray[(y-1)*width+x] - 1 * gray[(y-1)*width+(x+1)] +
        1 * gray[(y+1)*width+(x-1)] + 2 * gray[(y+1)*width+x] + 1 * gray[(y+1)*width+(x+1)];
      
      const mag = Math.sqrt(gx*gx + gy*gy);
      if (mag > 80) edges.push({x, y, mag});
    }
  }
  
  return edges;
}

/**
 * 2. 对称轴检测
 * 核心思路（来自 Free2CAD）：
 * - 找到物体的主方向（PCA 或最长线段方向）
 * - 对于产品类物体，通常有一条垂直/水平对称轴
 * - 验证：沿候选轴翻转，重合度高则为真对称轴
 */
function detectSymmetryAxis(edges, width, height) {
  // 简化版：假设产品照片有垂直/水平对称轴
  // 实际实现：用镜像重合度计算
  
  const candidates = [
    { type: 'vertical', x: width / 2, confidence: 0 },
    { type: 'horizontal', y: height / 2, confidence: 0 },
  ];
  
  // 计算对称度：沿轴镜像后像素重合比例
  for (const edge of edges) {
    const mirrorX = width - edge.x;
    const mirrorY = height - edge.y;
    // 检查镜像位置是否有边缘点
    // 简化：统计重合度
  }
  
  // 返回最可能的对称轴
  return candidates[0]; // 简化：默认垂直对称轴
}

/**
 * 3. 平行边检测
 * 核心思路：
 * - 提取所有近似直线段
 * - 计算每条线段的方向角
 * - 方向角相近（差 < 阈值）的线段为平行
 */
function detectParallelLines(segments) {
  const parallelGroups = [];
  
  for (const seg of segments) {
    const angle = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1);
    // 归一化到 [0, π)
    const normAngle = ((angle % Math.PI) + Math.PI) % Math.PI;
    
    let found = false;
    for (const group of parallelGroups) {
      if (Math.abs(normAngle - group.angle) < 0.1) { // ~5.7 degrees
        group.segments.push(seg);
        found = true;
        break;
      }
    }
    
    if (!found) {
      parallelGroups.push({ angle: normAngle, segments: [seg] });
    }
  }
  
  return parallelGroups.filter(g => g.segments.length >= 2);
}

/**
 * 4. 同心圆/等距圆检测
 * 核心思路：
 * - 检测圆形/弧形特征（Hough Circle Transform）
 * - 圆心相近的归为同心圆组
 * - 半径呈等差/等比序列的标记为等距
 */
function detectConcentricCircles(circles) {
  const groups = [];
  
  for (const circle of circles) {
    let found = false;
    for (const group of groups) {
      const dist = Math.sqrt(
        (circle.cx - group.cx)**2 + (circle.cy - group.cy)**2
      );
      if (dist < 10) { // 圆心距离阈值
        group.circles.push(circle);
        found = true;
        break;
      }
    }
    
    if (!found) {
      groups.push({ cx: circle.cx, cy: circle.cy, circles: [circle] });
    }
  }
  
  return groups.filter(g => g.circles.length >= 2);
}

/**
 * 5. 约束传播
 * 已知一个尺寸，自动推断其他相关尺寸
 * 例如：已知总宽 280mm，推断按钮间距 = 总宽 / 比例
 */
function propagateConstraints(features, knownDimension) {
  const { totalWidth, componentRatios } = knownDimension;
  
  const constraints = [];
  
  for (const [component, ratio] of Object.entries(componentRatios)) {
    constraints.push({
      component,
      estimatedSize: totalWidth * ratio,
      source: 'ratio_propagation',
      confidence: 0.8
    });
  }
  
  return constraints;
}

/**
 * 6. 生成 overlay
 */
async function generateOverlay(imagePath, detections, outputPath) {
  const img = await loadImage(imagePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  
  // 原图
  ctx.drawImage(img, 0, 0);
  
  // 半透明覆盖层
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(0, 0, img.width, img.height);
  
  // 画对称轴
  if (detections.symmetryAxis) {
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(detections.symmetryAxis.x, 0);
    ctx.lineTo(detections.symmetryAxis.x, img.height);
    ctx.stroke();
    ctx.setLineDash([]);
    
    ctx.fillStyle = '#00ff00';
    ctx.font = '16px sans-serif';
    ctx.fillText('SYMMETRY AXIS', detections.symmetryAxis.x + 5, 20);
  }
  
  // 画平行线组
  ctx.strokeStyle = '#ffff00';
  ctx.lineWidth = 1;
  for (const group of detections.parallelGroups || []) {
    for (const seg of group.segments) {
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }
  }
  
  // 画同心圆
  ctx.strokeStyle = '#00ffff';
  for (const group of detections.concentricGroups || []) {
    for (const circle of group.circles) {
      ctx.beginPath();
      ctx.arc(circle.cx, circle.cy, circle.r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  
  // 画约束传播结果
  ctx.fillStyle = '#ff6600';
  ctx.font = '12px monospace';
  let y = img.height - 20;
  for (const c of detections.constraints || []) {
    ctx.fillText(`${c.component}: ~${c.estimatedSize.toFixed(1)}mm (${c.source})`, 10, y);
    y -= 16;
  }
  
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);
  console.log(`Overlay saved: ${outputPath}`);
}

// ===== 主流程 =====
async function main() {
  const photos = fs.readdirSync(INPUT_DIR)
    .filter(f => f.endsWith('.jpeg') || f.endsWith('.jpg') || f.endsWith('.png'));
  
  console.log(`Found ${photos.length} photos`);
  
  for (const photo of photos) {
    const imagePath = path.join(INPUT_DIR, photo);
    console.log(`\nProcessing: ${photo}`);
    
    // 1. 轮廓提取
    const contours = await extractContours(imagePath);
    console.log(`  Edges detected: ${contours.edges.length}`);
    
    // 2. 对称轴检测（简化版）
    const symmetryAxis = detectSymmetryAxis(contours.edges, contours.width, contours.height);
    console.log(`  Symmetry axis: ${symmetryAxis.type} at ${symmetryAxis.x || symmetryAxis.y}`);
    
    // 3. 生成 overlay（使用简化检测结果）
    const detections = {
      symmetryAxis,
      parallelGroups: [], // TODO: 需要完整线段提取
      concentricGroups: [], // TODO: 需要 Hough Circle
      constraints: propagateConstraints({}, {
        totalWidth: 280,
        componentRatios: {
          left_joycon: 0.35,
          center_grip: 0.30,
          right_joycon: 0.35,
          thumbstick: 0.07,
          abxy_button: 0.04
        }
      })
    };
    
    const outputPath = path.join(OUTPUT_DIR, `overlay-${photo}`);
    await generateOverlay(imagePath, detections, outputPath);
  }
  
  console.log('\nPrototype complete! Check output in:', OUTPUT_DIR);
}

main().catch(console.error);
