# 默认生图模型切换决策记录：wan2.6-t2i → wan2.7-image

- 日期：2026-09-22
- 决策：用户拍板（"价格是一样的是吧，那当然要切换到 wan2.7"）
- 性质：配置默认值翻转（目录默认行 + env 兜底默认 + 前端展示口径），非新功能；不改变任何共享 schema 合同

## 1. 决策输入

1. **价格持平且不按尺寸分档**（2026-09-22 官方[模型价格页](https://help.aliyun.com/zh/model-studio/model-pricing)核实）：wan2.7-image 北京 0.20 元/张 = wan2.6-t2i 0.20 元/张；仅输出计费、按成功张数计费、不按 1K/2K 分档——定妆图 2K 画幅无价格惩罚。切换的边际成本为零。
2. **效果对照占优**（[角色 sheet live check 记录](./2026-09-21-asset-character-sheet-live-check.md) §3.4）：wan2.7-image 电影感写实、画面无现代器物；对照的 wan2.6-image 偏半插画且引入现代玻璃瓶/玻璃杯（对历史题材是实质缺陷）。wan2.7 官方定位"文字渲染、主体一致性、复杂指令遵循更强"。
3. **能力覆盖更宽**：wan2.7-image 支持 0~9 图参考图调用，是角色 sheet 一致性（候选 (c)）唯一可用的参考模型位；wan2.6-t2i 不支持参考图注入。切换后 sheet 特性的生效前提（运行快照冻结 image 模型为 wan2.7-image）对新项目自动成立。

## 2. 兼容性核实（付费探针，约 0.2 元）

- **资产执行链路**（异步 image-generation 端点）：T2/T6 已实测 10+ 张全部成功（含 9:16 竖版 1080*1920、2K 横版 2048*1152、参考图注入），无需重验。
- **cover 服务链路**（`multimodal-generation/generation` 端点 + **同步**调用、无异步头）：官方文档仅有 wan2.7 的异步端点记载，同步兼容性无文档依据 → 2026-09-22 实测探针（与 cover 服务完全相同的请求形态）：HTTP 200、`output.choices[].message.content[].image` 形态带图、15.7s。**同步端点兼容成立**，cover 可直接切。

## 3. 实施范围（本次提交）

| 位置 | 改动 |
|---|---|
| `assets-run.service.ts` readDashscopeConfig | image 兜底默认 `"wan2.6-t2i"` → `"wan2.7-image"` |
| `cover-generate.service.ts` | `DEFAULT_MODEL` → `"wan2.7-image"`（同步端点兼容探针留档于注释） |
| `pricing-catalog.seed.ts` | `image.generate` 默认行翻转（isDefault 仍恰好一项，readiness 硬合同保持）；wan2.6-t2i 转为**非默认候选**（前端高级选择仍可选）并按同页核实价登记（0.20 元/张）；singapore 两行均保持 unpriced（dashscope-intl 口径待运营核实） |
| `frontend/src/utils/pricing.ts` | 展示 label → wan2.7-image（client_preview_only 单价 0.20 不变） |
| `.env.example` | `ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL=wan2.7-image` |
| 本地 `.env`（未跟踪） | 同步改为 wan2.7-image——该文件显式设置会覆盖代码默认值，不改则运行时仍在旧模型 |

目录行数不变（默认行翻转 + wan2.6-t2i 从默认位转候选位），catalog/公开能力/bootstrap 行数断言全部不变；`resolveGenerationCostBootstrapInput` 的 registeredModels 5→6（内置候选 +1）。

## 4. 验证

- `npx tsc -p backend/tsconfig.json --noEmit` 0 error。
- config/cost/db/runtime/assets/asset-planning/api/frontend 全量 2000 条：**45 failed 与切换前基线逐文件一致**（均为既有红灯，见 roadmap 已知项），零新增失败；其中 pricing/catalog/bootstrap/quote 相关 232 条全绿。
- `prisma-toolchain` 在全量跑中出现一次 spawnSync 瞬时错，单独复跑通过（环境性，与本次改动无关）。

## 5. 边界与遗留

- **不追溯**：既有项目/历史 run 的快照冻结旧模型（快照权威），仅新生成走新默认；已存产物不变。
- wan2.6-t2i 保留为可选候选，用户可在设置 > Provider/Model 高级选择中切回。
- singapore（dashscope-intl）两行维持 unpriced/unbounded；官方页已有国际行数字（wan2.6-t2i 0.220177、wan2.7-image 0.224826 元/张），待运营确认主机与币种口径后登记。
- **下一步关联决策（未做）**：默认模型切换后，角色 sheet 开关 `ASSET_CHARACTER_SHEET_ENABLED` 的生效前提已满足；是否把该开关默认值翻转为开（每次资产运行对达标角色 +0.20 元/角色）按计划 §1 T6 门禁属下一个独立评估项，本记录不代决策。

### 补录（2026-09-22，同日第二次决策）：sheet 开关默认值翻转为开启

用户拍板"开"。`ASSET_CHARACTER_SHEET_ENABLED` env 默认值 false → true（`env.ts`，
唯一 env 读取点），`.env.example` 同步；`readBooleanEnv` 仍只接受 true/false（未知值
启动失败）。生效前提（默认 image 模型为 wan2.7-image）已随本记录主决策满足，
live check 效果/成本达标（§1 T6 门禁）。

成本影响：每个达标角色（label 命中 ≥3 个有分镜图的 segment）+1 张定妆图 = +0.20 元/角色；
命中分镜图任务注入参考图不改变单张计费。回滚面：显式 `ASSET_CHARACTER_SHEET_ENABLED=false`
（纯文本锚点），或 `ASSET_PLANNING_GENERATION_MODE=legacy`（不产 sheet 任务）。

验证：typecheck 0 error；全量 2000 条测试 48 failed 与翻转前基线逐文件一致
（45 既有 + harness topic 域 3 既有），零新增失败；新增 env 默认值测试 3 条
（默认开 / 显式 false 可回滚 / 非法值启动失败），`tests/backend/config/env.test.ts` 6 条全绿。
