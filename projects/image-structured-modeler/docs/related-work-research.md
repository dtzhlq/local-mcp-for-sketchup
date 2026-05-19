# Image Structured Modeler — 相关项目调研

> 调研日期：2026-05-11
> 调研目标：找 GitHub/学术界里跟"图片→结构化/参数化/可编辑3D模型"思路相近的项目，提取可借鉴点。

---

## 一、最相关的项目（直接对标）

### 1. Img2CAD — Reverse Engineering CAD from Images (ECCV 2024 / arXiv 2408.01437)

**作者**：Yujia Zheng, Xiangyu Xu, Yiqun Zhao, Yang Liu, Niloy Mitra 等  
**代码/模型**：`qq456cvb/img2cad` on Hugging Face  
**论文**：[arXiv:2408.01437v2](https://arxiv.org/html/2408.01437v2)

**核心思路**：
- 输入单张产品照片（或渲染图）
- 用 VLM (Visual Language Model) 辅助条件分解
- 输出参数化的 CAD 命令序列（extrude/revolve/fillet等）
- 最终得到可编辑的 CAD 模型，不是 mesh

**跟我们的对比**：
| 维度 | Img2CAD | Image Structured Modeler |
|------|---------|-------------------------|
| 输入 | 单张图 | 3-6 张多角度照片 |
| 输出 | CAD 命令序列 | SketchUp MCP JSON DSL |
| 中间表示 | 参数化体素/CSG | 结构化 Model Plan |
| 人工确认 | 无 | 有 review overlay |
| 目标平台 | 通用 CAD | SketchUp + 插件 |
| 部件语义 | 有（primitive分解） | 有（component tree） |

**可借鉴点**：
- ✅ VLM 辅助的部件分解策略：让大模型先判断"这是外壳/按钮/摇杆"，再分配 primitive
- ✅ 条件分解架构：不是端到端黑盒，而是"识别→分解→参数化"三步
- ✅ 用 primitive fitting 而非 mesh 重建：跟我们"先结构后几何"一致

---

### 2. Free2CAD — Parsing Freehand Drawings into CAD Commands (SIGGRAPH 2022)

**作者**：Changjian Li, Hao Pan, Adrien Bousseau, Niloy J. Mitra  
**代码**：[github.com/Enigma-li/Free2CAD](https://github.com/Enigma-li/Free2CAD)  ⭐ ~200+ stars  
**论文**：ACM Trans. Graph. (SIGGRAPH 2022)

**核心思路**：
- 输入手绘草图（不是照片）
- 识别笔画 → 检测几何约束（平行、垂直、同心、对称）
- 解析为 CAD 命令序列（line/circle/arc/extrude）
- 输出可编辑的 CAD 模型

**可借鉴点**：
- ✅ **几何约束检测**：平行边、对称轴、同心圆、等距线 —— 这正是我们 photos→overlay 阶段需要的
- ✅ **stroke grouping → feature recognition**：把零散笔画聚合成"这是圆角矩形外壳"、"这是4个按钮"
- ✅ **约束传播**：已知一个尺寸，自动推断其他尺寸（跟我们"已知总宽280mm"思路一致）
- ⚠️ 输入是手绘笔画，不是照片像素，需要 adaptation

---

### 3. DeepCAD — Deep Generative Network for Computer-Aided Design (ICCV 2021)

**作者**：Xiangyu Xu, Wenzheng Chen, Hao Pan, Daniel Cohen-Or, Niloy J. Mitra  
**代码**：未找到官方开源，但 paper 影响力大，被大量引用  
**论文**：ICCV 2021

**核心思路**：
- 学习 CAD 命令序列的深层表示（类似 NLP 中的程序合成）
- 输入可以是草图或文本描述
- 输出 CAD 命令序列（extrude、revolve、fillet 等）
- 基于 DeepCAD 数据集（约 180k 真实 CAD 模型）

**可借鉴点**：
- ✅ CAD 命令序列作为中间表示：跟我们的 Model Plan → DSL 思路一致
- ✅ 数据集规模：180k 真实 CAD 模型训练出的先验知识
- ⚠️ 不是从照片生成，是从草图/文本；但 primitive 分解思想通用

---

## 二、部件分解与结构化建模（半相关）

### 4. PartNet — Recursive Part Decomposition Network (CVPR 2019)

**代码**：[github.com/FENGGENYU/CVPR2019_PartNet](https://github.com/FENGGENYU/CVPR2019_PartNet)  
**论文**：CVPR 2019

**核心思路**：
- 3D 形状（体素/mesh）→ 递归部件分解树
- 每个节点：继续细分 or 到达叶子部件
- 输出层次化的部件语义树

**可借鉴点**：
- ✅ **递归部件树**：跟我们 component tree（grip→joycon→buttons→screws）完全对应
- ✅ **细粒度分割**：不只分"大部件"，还能分"按钮上的文字"这种细节
- ⚠️ 输入是 3D 形状，不是 2D 照片；但树结构可直接复用

---

### 5. VoxAttention — Attention-based Part Assembly (CVPRW 2023)

**代码**：[github.com/JunweiZheng93/VoxAttention](https://github.com/JunweiZheng93/VoxAttention)  
**论文**：CVPR Workshop 2023

**核心思路**：
- 从体素数据中用注意力机制做部件组装
- 输入：部分观测的 3D 体素
- 输出：完整 3D 形状的部件分解

**可借鉴点**：
- ✅ 注意力机制识别"哪些 voxel 属于同一个部件"
- ⚠️ 输入是 3D 体素，不是 2D 照片

---

### 6. CSGNet — Neural Shape Parser for Constructive Solid Geometry

**代码**：[github.com/Hippogriff/CSGNet](https://github.com/Hippogriff/CSGNet)  ⭐ ~200+ stars  
**论文**：CVPR 2018

**核心思路**：
- 输入 2D/3D 形状（可以是图像！）
- 用 RNN + attention 生成 CSG 程序（union/difference/intersection of primitives）
- 输出：程序化、可编辑的 3D 形状

**可借鉴点**：
- ✅ **CSG 作为中间表示**：cylinder union box difference sphere = 外壳开洞放按钮
- ✅ 从 2D 图像直接生成：输入可以是 shape 渲染图或轮廓图
- ✅ 可解释性强：每个 primitive 对应一个语义部件
- ⚠️ 原论文用简单几何图（字母、简单形状）测试，复杂产品需扩展

---

## 三、建筑/平面图重建（建筑向参考）

### 7. floorplan-detection — CubiCasa5k + MMDetection

**代码**：[github.com/meterup/floorplan-detection](https://github.com/meterup/floorplan-detection)  
**数据集**：CubiCasa5k（大规模平面图数据集）

**核心思路**：
- 输入建筑平面图图像
- 检测 walls、rooms、doors、windows
- 输出结构化布局数据

**可借鉴点**：
- ✅ **图像→结构化建筑元素**：walls/rooms/doors/windows 检测，跟我们 Calgary 建筑项目思路一致
- ✅ MMDetection 框架：成熟的检测 pipeline 可直接复用
- ✅ 数据集标注格式：可作为我们 schema 设计的参考

---

## 四、基本体素拟合（点云后处理参考）

### 8. PrimitivesFittingLib — Point Cloud Primitive Fitting

**代码**：[github.com/yuecideng/PrimitivesFittingLib](https://github.com/yuecideng/PrimitivesFittingLib)  
**技术**：RANSAC + 分割，C++ & Python API

**支持的基本体**：
- Plane, Sphere, Cylinder, Cone, Torus

**可借鉴点**：
- ✅ 如果未来引入点云/深度作为参考，可用这个从点云拟合基本体
- ✅ RANSAC 分割策略：先找大平面（外壳），再找圆柱（按钮、摇杆），再找球面（圆顶）
- ⚠️ 纯几何，无语义；需要跟我们部件识别结合

---

## 五、不太相关但知名的项目（排除说明）

| 项目 | 为什么不太相关 |
|------|---------------|
| CRM (thu-ml/CRM) | 单图→纹理 mesh，不可编辑，无部件语义 |
| PaMIR | 参数化人体重建，领域特定 |
| DreamCraft3D | 文本/图→3D 生成，mesh 输出，不可编辑 |
| Debevec SIGGRAPH96 | 建筑照片→3D，但做纹理映射而非结构化模型 |
| Image2CAD (adityaintwala) | 工程图纸→DXF，不是产品照片→3D |

---

## 六、对我们的直接启发

### 6.1 架构层面

```
Img2CAD 的 VLM 辅助分解  ─┐
Free2CAD 的几何约束检测  ─┼→  Image Structured Modeler 的混合架构
PartNet 的部件递归树    ─┘
         ↓
CSGNet 的程序化表示     ──→  Model Plan JSON（我们的中间层）
         ↓
DeepCAD 的命令序列规范  ──→  SketchUp MCP JSON DSL
```

### 6.2 具体可借鉴的技术

| 我们的阶段 | 可借鉴项目 | 借鉴内容 |
|-----------|-----------|---------|
| 视角分类 | Free2CAD | 对称轴、平行边检测 |
| 轮廓提取 | Free2CAD | stroke grouping → feature |
| 部件语义 | Img2CAD + PartNet | VLM 判断部件类型 + 递归树 |
| 参数推断 | DeepCAD | 尺寸约束传播 |
| 人工确认 | Free2CAD | 约束高亮、不确定标红 |
| 模型计划 | CSGNet | CSG-like 中间表示 |
| DSL 编译 | DeepCAD | 命令序列规范 |

### 6.3 数据/训练层面

- **DeepCAD 数据集**（~180k CAD 模型）：可作为 primitive 先验，训练"这是什么部件"分类器
- **CubiCasa5k**：建筑平面图检测训练数据
- **PartNet 数据集**：3D 部件分割标注，可用于验证我们的 component tree 是否合理

### 6.4 工具链层面

- **PrimitivesFittingLib**：如果引入点云，做基本体拟合
- **MMDetection / Detectron2**：如果做 2D 图像中的部件检测（bounding box + class）
- **OpenCV / skimage**：轮廓提取、对称轴检测、透视校正

---

## 七、差距与我们的独特性

| 维度 | 现有项目 | Image Structured Modeler |
|------|---------|-------------------------|
| 输入 |  mostly 单张图/草图 | 多视角照片（3-6张） |
| 中间确认 |  mostly 端到端黑盒 | 人工 review overlay（必须环节） |
| 输出平台 |  generic CAD / mesh | SketchUp（特定生态） |
| 部件复用 |  mostly 无 | component_definition/instance |
| 材质/场景 |  mostly 无 | 支持 SketchUp 材质、scene、style |
| 产品领域 |  通用几何 | 聚焦产品/工业设计 + 建筑 |
| 可编辑性 |  有（CAD命令） | 有（SketchUp 组件层级） |

**核心差异**：
- 现有项目追求"自动化"，我们追求"可审查+可修正"
- 现有项目输出通用 CAD，我们输出特定平台（SketchUp）的 DSL
- 我们强调 component 复用和文件体积控制（这对 SketchUp 很重要）

---

## 八、推荐阅读优先级

1. ⭐⭐⭐ **Free2CAD 代码**（github.com/Enigma-li/Free2CAD）
   - 最直接可借鉴：几何约束检测、笔画分组、CAD命令解析
   - 建议：clone 下来跑一遍 demo，看约束检测怎么做的

2. ⭐⭐⭐ **Img2CAD 论文 + HuggingFace 模型**
   - VLM 辅助分解的最新方法
   - 建议：读论文的 Section 3（条件分解架构），看能否复用到我们的 analyze 阶段

3. ⭐⭐ **PartNet 代码**
   - 递归部件树的实现参考
   - 建议：看他们的 tree data structure 怎么设计的

4. ⭐⭐ **CSGNet 代码**
   - CSG 程序化表示的神经网络实现
   - 建议：看 parser 怎么把图像映射到 program

5. ⭐ **PrimitivesFittingLib**
   - 如果后续引入深度/点云，基本体拟合工具

---

## 九、下一步行动建议

1. **Clone Free2CAD**：跑通手绘→CAD demo，提取约束检测模块的思路
2. **读 Img2CAD 论文**：重点看 VLM 怎么辅助部件分解
3. **调研 Detectron2/MMDetection**：看是否可用于照片中的部件检测（button/stick/screw class）
4. **设计我们的 overlay 格式**：参考 Free2CAD 的约束可视化，设计 SVG/PNG overlay 规范
5. **评估是否需要训练**：如果规则+传统 CV 不够，再考虑用 DeepCAD 数据集训练部件分类器

---

*调研完成于 2026-05-11。下次更新：Sprint 1 中期（发现新项目时补充）。*
