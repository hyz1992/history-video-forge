# 2026-05-16 Assets DashScope Live Check

## 目的

记录 assets 阶段真实 DashScope provider 的一次受控 live check。

本检查只验证 assets 主入口在显式 `provider_mode=dashscope` 下可以调用真实 TTS/image provider，并产出本地 artifact。它不是默认自动化 gate，也不代表 compose/video 阶段完成。

## 运行入口

```bash
npm run harness:assets-dashscope-live-check
```

本地环境：

- DashScope 配置来自未跟踪的根目录 `.env` 或 `backend/.env`
- 运行输出写入 `harness/scripts/runtime/output/assets-dashscope-live-check/`
- 输出目录被 `.gitignore` 忽略
- 记录与摘要不输出 API key

## 本次结果

- `status_code`: `200`
- `local_validation_decision`: `partial`
- `local_validation_errors`: `[]`
- `local_validation_warnings`: `["assets_bgm_missing_optional"]`
- `provider_names`: `["dashscope_tts", "dashscope_image"]`
- `artifact_types`: `["tts_chunk_audio", "tts_merged_audio", "subtitle_track", "image"]`

## 判断

DashScope TTS 与 image 在 assets 主入口的显式模式下已经可用。

`partial` 不是 DashScope 失败导致；本次 fixture 未配置 BGM，validator 给出可选 BGM warning。当前证据支持继续把 assets 阶段收口到“真实 TTS/image 可显式运行，默认 fake 链路仍稳定”的状态。

## 剩余边界

- 还没有验证 compose/video。
- 还没有引入真实 BGM/SFX provider。
- 真实 live check 不进入默认 CI 或自动回归。
- 生成产物只保留在 ignored runtime output 中，不能作为仓库真相源。

## 下一步建议

下一步应补一个 assets 阶段完成度清单：按 `asset planning -> assets -> compose` 边界列出已完成、可验收、未开始项，并明确 assets 阶段到 compose 阶段的移交条件。
