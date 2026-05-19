# 调研技术笔记 — Free2CAD + Img2CAD + 相关项目

> 日期：2026-05-11  
> 调研人：Alma  
> 用途：Image Structured Modeler Sprint 0 快速原型验证

---

## 一、Free2CAD (SIGGRAPH 2022)

### 项目信息
- **作者**：Changjian Li, Hao Pan, Adrien Bousseau, Niloy Mitra
- **论文**：[ACM TOG 41(4), 2022](https://enigma-li.github.io/projects/free2cad/Free2CAD_SIG_2022.pdf)
- **代码**：[github.com/Enigma-li/Free2CAD](https://github.com/Enigma-li/Free2CAD) (MIT)
- **训练数据**：~160k 训练 + 50k 测试，26.5GB（TFRecord 压缩后）

### 核心算法流程

```
笔画集合 S = {s₁, s₂, ..., sₙ}
    ↓
[笔画分组 Grouper] → 将相邻/共线/平行的笔画聚合为特征组 G = {g₁, g₂, ...}
    ↓ 每组包含：线段、圆、弧
[几何约束检测] → 检测：对称轴、平行、垂直、同心、等距、相切
    ↓ 约束以图的形式传播
[约束传播 Constraint Propagation] → 已知一个尺寸约束，传播到其他相关特征
    ↓
[CAD 命令拟合 Fitter] → 将约束后的特征匹配到 CAD 命令序列
    ↓
可编辑 CAD 模型
```

### 关键技术细节

#### 1. 笔画分组 (Stroke Grouping)
- **输入**：有序笔画集合（手绘时产生的笔画序列）
- **分组依据**：
  - 空间邻近性：笔画端点距离 < 阈值
  - 方向一致性：笔画方向角差 < 阈值
  - 共线性：延长线重合度高
  - 闭合性：形成闭合环的优先聚为一组
- **输出**：特征组（Feature Group），每组对应一个 CAD 特征：
  - 直线段（line segment）
  - 圆/圆弧（circle/arc）
  - 复合曲线（composite curve）

#### 2. 几何约束检测
Free2CAD 检测的约束类型：

| 约束类型 | 检测方法 | 对我们的启发 |
|---------|---------|-----------|
| **对称轴 (Symmetry)** | 镜像重合度：沿候选轴翻转，计算像素/笔画重合比例 | 产品照片通常有垂直对称轴，可用同样方法 |
| **平行 (Parallel)** | 线段方向角归一化到 [0, π)，差值 < 阈值 | 外壳长边、按钮排列方向 |
| **垂直 (Perpendicular)** | 方向角差 ≈ π/2 | 外壳转角、三视图正交关系 |
| **同心 (Concentric)** | 圆心距离 < 阈值 | 摇杆底座和帽、螺丝和垫圈 |
| **等距 (Equal distance)** | 平行线间距一致 | 按钮网格排列 |
| **相切 (Tangent)** | 圆到直线距离 ≈ 半径 | 圆角过渡 |

**关键创新**：约束检测和 CAD 拟合是**耦合**的，不是分离的两步。
- 拟合出的 CAD 命令提供几何上下文
- 几何上下文反过来纠正笔画分组的错误
- 这是一个**交替优化**过程

#### 3. 约束传播
- **输入**：用户指定的或检测到的约束
- **传播规则**：
  - 对称约束：已知一侧尺寸，另一侧自动相等
  - 平行约束：已知一条线长度，平行线可推断比例关系
  - 等距约束：间距一致，可推断排列规律
- **实现**：约束图（Constraint Graph），节点是特征，边是约束关系
- **求解**：图传播 + 数值优化

### Adaptation 到我们的产品照片场景

| Free2CAD 概念 | 我们的产品照片场景 |
|--------------|------------------|
| 笔画 (stroke) | 边缘检测后的轮廓线段 |
| 笔画顺序 | 无（照片没有绘制顺序），需用空间关系替代 |
| 手绘噪声 | 照片透视畸变、光照不均、遮挡 |
| 特征组 | 部件边界（bounding box / contour） |
| 约束图 | 部件关系树 + 几何约束 |
| CAD 命令 | SketchUp DSL JSON |

**挑战**：
1. 照片没有笔画顺序信息 → 需要额外的空间聚类
2. 透视畸变 → 需要先校正或做透视不变检测
3. 光照和材质反射 → 边缘检测可能断裂
4. 遮挡 → 部分部件不可见，需要推断

**可行方案**：
1. 先用 Canny 边缘检测 + 轮廓提取
2. 用 Douglas-Peucker 简化轮廓为多段线
3. 简化后的多段线段 ≈ Free2CAD 的笔画
4. 复用 Free2CAD 的分组 + 约束检测逻辑
5. 加入 VLM 辅助判断"这是什么部件"

### 代码可用性评估

| 方面 | 状态 | 说明 |
|------|------|------|
| 训练代码 | ✅ 开源 | Python + TensorFlow，有 Docker |
| 推理代码 | ✅ 开源 | C++ TensorFlow 部署 |
| 训练数据 | ⚠️ 链接失效 | 作者说在找新托管 |
| 预训练模型 | ⚠️ 链接失效 | 同上 |
| 直接运行 | ❌ 困难 | 需要 26GB 数据 + TensorFlow 编译 |

**结论**：代码结构可以参考，但很难直接跑通。重点是**提取算法思路**，不是直接复用代码。

---

## 二、Img2CAD (ECCV 2024)

### 项目信息
- **作者**：Yujia Zheng, Xiangyu Xu, Yiqun Zhao, Yang Liu, Niloy Mitra 等
- **论文**：[arXiv:2408.01437v2](https://arxiv.org/html/2408.01437v2)
- **模型**：[Hugging Face: qq456cvb/img2cad](https://huggingface.co/qq456cvb/img2cad)
- **方法**：VLM 辅助的条件分解

### 核心架构

```
产品照片
    ↓
[VLM: 部件类型判断] → "这是外壳" "这是按钮" "这是摇杆"
    ↓
[条件分解网络] → 根据部件类型选择分解策略
    ↓
[参数化拟合] → 每个部件匹配最佳 primitive
    ↓
CAD 命令序列
```

### 关键技术

1. **VLM 辅助的部件分解**
   - 用大模型（GPT-4V / Gemini）做"部件是什么"的判断
   - 不是端到端训练，而是**条件化**的：VLM 输出作为条件输入到分解网络

2. **条件分解策略**
   - 不同部件类型用不同 primitive 集合
   - 外壳 → extrude + fillet
   - 按钮 → revolve + cut
   - 摇杆 → revolve + extrude

3. **参数化表示**
   - 每个 primitive 有可调参数
   - 参数从图像中估计（尺寸、位置、方向）

### 对我们的启发

1. **VLM 不是替代传统 CV，而是辅助**
   - VLM 负责"语义"（这是什么部件）
   - 传统 CV 负责"几何"（轮廓、位置、尺寸）
   - 两者融合，不是二选一

2. **条件分解降低复杂度**
   - 不是训练一个万能网络
   - 而是"判断类型 → 选择策略 → 执行拟合"
   - 更容易扩展到新部件类型

3. **部件类型 → primitive 的映射表**
   - 我们需要建立类似的映射：
     - `rounded_rect_body` → rounded_box primitive
     - `analog_stick` → revolve + cylinder
     - `button_cluster` → repeated button_on_panel

---

## 三、CSGNet (CVPR 2018)

### 项目信息
- **代码**：[github.com/Hippogriff/CSGNet](https://github.com/Hippogriff/CSGNet) (⭐ ~200)
- **方法**：RNN + Attention 生成 CSG 程序

### 核心思想
- 输入：2D/3D 形状图像
- 输出：CSG 程序（union/difference/intersection of primitives）
- 可解释性：每个 primitive 对应一个可识别的几何部件

### 对我们的启发
- CSG-like 中间表示 → 我们的 Model Plan JSON
- union → group/container
- difference → boolean_cutout / recess
- intersection → 复杂交线（少用）

---

## 四、PartNet (CVPR 2019)

### 项目信息
- **代码**：[github.com/FENGGENYU/CVPR2019_PartNet](https://github.com/FENGGENYU/CVPR2019_PartNet)
- **数据集**：~27k 3D 模型，细粒度部件标注

### 核心思想
- 3D 形状 → 递归部件分解树
- 每个节点：继续细分 or 到达叶子部件
- 层次：对象 → 大部件 → 子部件 → 细节

### 对我们的启发
- **递归部件树数据结构**：
  ```json
  {
    "id": "root",
    "type": "switch_controller",
    "children": [
      { "id": "left_joycon", "type": "joycon", "children": [
        { "id": "left_stick", "type": "analog_stick" },
        { "id": "d_pad", "type": "button_cluster" }
      ]},
      { "id": "right_joycon", "type": "joycon", "children": [
        { "id": "abxy", "type": "button_cluster" },
        { "id": "right_stick", "type": "analog_stick" }
      ]},
      { "id": "center_grip", "type": "grip" }
    ]
  }
  ```
- 参考 PartNet 的树节点设计，完善我们的 model-plan.schema.json

---

## 五、快速原型验证结论

### 5.1 技术选型决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 边缘检测 | OpenCV (Canny + findContours) | 成熟、快、可调参数多 |
| 轮廓简化 | Douglas-Peucker (approxPolyDP) | 将轮廓转为多段线，≈ Free2CAD 笔画 |
| 约束检测 | 规则-based (参考 Free2CAD) | 不需要训练，产品场景约束类型有限 |
| 部件语义 | VLM (Gemini/GPT-4V) + 规则兜底 | VLM 负责判断类型，规则负责几何 |
| 参数推断 | 约束传播 + 比例推算 | 参考 Free2CAD 约束传播 |
| 中间表示 | Model Plan JSON (CSG-like) | 可解释、可审查、可编辑 |

### 5.2 混合策略架构

```
照片 (3-6张)
    ↓
[传统 CV 管线]
  ├─ Canny 边缘检测
  ├─ 轮廓提取 + 简化
  ├─ 线段/圆弧检测
  ├─ 对称轴检测
  ├─ 平行/垂直/同心约束
  └─ 透视校正 (可选)
    ↓
[VLM 辅助]
  ├─ "这是什么产品？"
  ├─ "能看到哪些部件？"
  ├─ "这个部件是什么类型？"
  └─ "整体尺寸比例？"
    ↓
[融合]
  ├─ CV 提供：几何位置、轮廓、约束
  ├─ VLM 提供：部件类型、语义标签
  └─ 冲突解决：CV 优先（几何），VLM 优先（语义）
    ↓
[结构化 Model Plan]
    ↓
[SketchUp DSL]
```

### 5.3 风险与缓解

| 风险 | 可能性 | 缓解 |
|------|--------|------|
| CV 边缘检测在产品照片上效果差 | 中 | 多参数调优 + VLM 辅助定位 ROI |
| VLM 成本过高 | 低 | 只用于部件类型判断，不用每张图都调 |
| 约束检测精度不够 | 中 | 先做半自动：人工标 4-6 关键点 |
| 部件类型映射不完整 | 中 | MVP 只做 Switch 手柄，后续扩展 |

### 5.4 下一步行动

1. ✅ 调研完成（本文档）
2. ⬜ 写可行性报告（混合策略精度/延迟/成本）
3. ⬜ 搭建传统 CV 原型（Canny + 轮廓 + 对称轴）
4. ⬜ 测试 VLM 部件识别（Gemini on Switch 手柄照片）
5. ⬜ 更新 PLAN.md 和 tech-stack.md

---

## 附录：Free2CAD 约束检测伪代码

```python
def detect_constraints(features):
    """
    features: List[Feature] where Feature = Line | Circle | Arc
    """
    constraints = []
    
    # 1. 对称轴
    for axis_candidate in generate_symmetry_candidates(features):
        score = mirror_overlap_score(features, axis_candidate)
        if score > 0.8:
            constraints.append(Symmetry(axis=axis_candidate, score=score))
    
    # 2. 平行
    for i, fi in enumerate(features):
        for fj in features[i+1:]:
            if isinstance(fi, Line) and isinstance(fj, Line):
                angle_diff = abs(normalize_angle(fi.angle) - normalize_angle(fj.angle))
                if angle_diff < PARALLEL_THRESHOLD:
                    constraints.append(Parallel(fi, fj))
    
    # 3. 垂直
    for i, fi in enumerate(features):
        for fj in features[i+1:]:
            if isinstance(fi, Line) and isinstance(fj, Line):
                angle_diff = abs(normalize_angle(fi.angle - fj.angle))
                if abs(angle_diff - PI/2) < PERPENDICULAR_THRESHOLD:
                    constraints.append(Perpendicular(fi, fj))
    
    # 4. 同心
    circles = [f for f in features if isinstance(f, Circle)]
    for i, ci in enumerate(circles):
        for cj in circles[i+1:]:
            dist = distance(ci.center, cj.center)
            if dist < CONCENTRIC_THRESHOLD:
                constraints.append(Concentric(ci, cj))
    
    return constraints

def propagate_constraints(constraints, known_dimensions):
    """
    已知某些尺寸，通过约束传播推断其他尺寸
    """
    inferred = {}
    
    for c in constraints:
        if isinstance(c, Symmetry):
            # 对称约束：一侧尺寸 = 另一侧尺寸
            inferred[c.mirror_feature] = known_dimensions[c.source_feature]
        
        elif isinstance(c, Parallel) and c.ratio_hint:
            # 平行约束：长度比例
            inferred[c.fj] = known_dimensions[c.fi] * c.ratio_hint
        
        elif isinstance(c, EqualDistance):
            # 等距约束：间距相等
            inferred[c.target] = known_dimensions[c.reference]
    
    return inferred
```

---

*文档完成于 2026-05-11。基于 Free2CAD 论文、项目页、代码仓库分析。*
