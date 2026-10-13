# 通用装配输入

这些文件是公共 Agent Gateway 的轻量输入。对象名只用于示例标识，编译器没有直廊、亭或院落的整屋类型白名单。单位均为 mm；尺寸为工程选择。

| 文件 | 公共输入字段 | 用途 |
| --- | --- | --- |
| `a-reference.json` | `inputs.task` | A 的独立 500 mm 参照物 |
| `a-corridor.json` | `inputs.task` | 两个共享定义的四跨直廊；只改 `sample-a-selected` 第二跨 3000→3300 |
| `b-pavilion.json` | `inputs.task` | 3600 方亭、四柱、单檐方攒尖 |
| `c-corner-corridor.json` | `inputs.task` | 独立的同标高、等宽 90° L 廊 |
| `c-courtyard.json` | `inputs.scene_plan` | 八个独立根的小院；只改入口 `opening_mm` 1600→1900 |
| `d-unpreset.json` | `inputs.scene_plan` | 方亭接带坐凳的廊，旁设月洞景墙；复用同一组族 |
| `d-unsupported.json` | `inputs.task` | 双层六角歇山请求；预检返回缺项与需明确接受的简化提案，不执行 |

先调用 `preflight_model`。创建时明确 `runtime` 和稳定幂等键；queue 连接、原任务恢复、来源发现与审阅流程见 [调用文档](../../docs/traditional-timber/ASSEMBLY.md)。同一 document 不要重复创建同名示例根。已有根的改变走参数修改入口。

房屋示例保留敞开的侧面和背面，表示方案单元；门扇、格栅及隐蔽节点均有简化说明。它们不表示完整居住建筑、结构认证或历史复原。
