# LLM Flash 选项与默认配置设计

## 用户要求与验收

1. 核心 LLM 可选 DeepSeek V4 Flash。
2. DeepSeek V4 Flash 默认勾选，保存并刷新后仍保留；新项目继承。
3. 新增 GLM-5.3-Flash，可选择并按对应 provider/model 解析。

## 方案

沿用服务端候选目录、tier 环境配置和用户默认配置，不新增阶段或 schema。`llm.smart` 与 `llm.flash` 表示任务用途，允许同一个 Flash 模型同时承担两个档位。

- `deepseek:deepseek-v4-flash` 在两槽可选；保留原有 Pro、GLM-5、GLM-4 选项。
- `zhipu:glm-5.3-flash` 在两槽可选，沿用智谱供应商注册与凭据配置。
- `.env.example` 给出两槽 DeepSeek V4 Flash 默认映射。本机 `.env` 同步；运行服务重新启动后，auto 解析到该模型。
- 内置浏览器将当前用户的两槽默认保存为 fixed DeepSeek V4 Flash，明确显示勾选。新项目通过既有用户偏好复制机制继承。
- 既有项目显式配置及冻结的历史 run 不迁移。shared 默认仍为 auto，保持 stub 和其他部署的兼容性。

## 边界与验证

不修改 prompt、全局 operation 思考策略、视觉质量流程或媒体供应商；不发起付费生成。GLM-5.3-Flash 官方仅支持 thinking enabled，provider 两种入口在合并参数后对此精确模型做能力归一化，并让日志记录真实发送值，避免现有 disabled override 引发不兼容请求。其他模型不变。

候选注册和凭据检查不能证明远端模型可用，GLM 新模型真实调用单独标为未验证；未核实价格保持 unpriced。

回归验证生产 seed 两槽可选、默认唯一且去重、auto/fixed 解析不串模型、旧选项与 stub 保留。浏览器验证展示、切换、保存、刷新和项目设置入口；新项目继承由既有 repository 测试验证。

模型名称与参数参考：[智谱官方模型卡](https://huggingface.co/zai-org/GLM-5.3-Flash)、[官方接口说明](https://docs.z.ai/guides/vlm/glm-5.3-flash)。此来源不作为本机国内 API 实测证据。
