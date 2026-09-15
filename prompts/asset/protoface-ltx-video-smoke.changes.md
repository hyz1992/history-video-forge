# asset.protoface-ltx-video-smoke 变更记录

## v1.0.0 - 2026-09-15
- 新增：用于 Protoface `lightricks/ltx-2.5-fast` 单次付费试调的正式 prompt，正文逐字复用分镜 video_029 的原 dashscope `wan2.7-i2v-2026-04-25` 提示词（画面、动作、运镜、风格约束不变），仅在末尾追加一行音频约束。
- 追加行为 `【音频约束】仅环境音和动作音效，无旁白、对白、歌声及其他人声。`；旁白由项目 TTS 单独生成，不在视频模型侧生成。
- 该 prompt 只服务独立试调脚本 `harness/scripts/runtime/protoface-ltx-video-smoke.mjs`，不接入正式视频生成链路、设置页或默认模型。
