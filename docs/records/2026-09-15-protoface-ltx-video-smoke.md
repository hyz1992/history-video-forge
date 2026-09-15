# Protoface LTX 2.5 Fast 单分镜真实试调记录

日期：2026-09-15。用户授权一次 720P 档、约 10 秒的付费生成测试，复用已有分镜的原始提示词与原始参考图，不修改正式视频生成链路、设置页或默认模型。

## 样本与输入

- 项目：装病十年的野心家，一朝发难尽诛曹氏。
- 原运行：`assets_run_a98c3500-22a0-49ea-bde1-1a3281bd0bd9`；分镜任务：`video_029`。
- 原视频：`storage/projects/2026-08-05/装病十年的野心家，一朝发难尽诛曹氏 [p_e115c849]/assets-runs/assets_run_a98c3500-22a0-49ea-bde1-1a3281bd0bd9/videos/dashscope_video_029.mp4`。
- 原始模型与参数：`wan2.7-i2v-2026-04-25`，720P、10 秒、`prompt_extend=true`、`watermark=false`；首帧参考图角色为 `first_frame`。
- 选样理由：库内 10 秒档候选中唯一同时满足“原参数即 720P+10 秒、单镜头连续动作、提示词自述约 10 秒”的分镜；另两个 10 秒候选为 1080P 且提示词自述时长与 10 秒矛盾。
- 参考图：原记录 PNG 字节原样复用，1080×1920，sha256 `133140cc2ccab9d6fd109f72494c183359938c25280af6313fdf3eb084d530f9`。
- 提示词：原提示词逐字复用，仅在末尾追加一行 `【音频约束】仅环境音和动作音效，无旁白、对白、歌声及其他人声。`；脚本在 `prepare` 阶段断言“去掉音频行后与原提示词逐字相等”。正式副本见 `prompts/asset/protoface-ltx-video-smoke.prompt.md`；旁白仍由项目 TTS 单独生成。

## 平台参数（以 `GET /v1/models/lightricks/ltx-2.5-fast` 实测为准，未猜接口）

- 端点：`POST https://api.protoface.com/v1/run/lightricks/ltx-2.5-fast`；鉴权 `Authorization: Bearer sk_live_…`。
- 模型 revision `2026-08-20`，operation `video.general`，输出模态 `video` + `audio`。
- 首帧字段是 **`image_url`**（不是 `first_frame`），取值可为公开 URL、data URI 或 `asset_...` ID。首次实测误用 `first_frame` 命名假设未发生，实际按 schema 解析为 `image_url`。
- `quality` 枚举是 **档位名 `480p/720p/1080p`**，不是实际画布名；`output_quality_descriptions` 映射 `720p → 768p`。因此 720P 档必须传 `"720p"`，实际输出 768p。
- `duration_seconds`：schema 范围 6–20 秒（`default=6`），各档最短 6 秒、无每档上限；10 秒合法，无需取近似值。
- `aspect_ratio` 枚举 `16:9/9:16`；`generate_audio` 默认 `true`（音频与画面同一次推理产出，关掉不降价）；`enhance_prompt` 默认 `false`。
- 计费单位是 credit，**1 credit = $0.01**；720p 档 `0.6 credits/秒`、`minimum_credits=3.6`、`rounding=ceil_per_job`、`meter=output_seconds`、`duration_basis=requested`。

## 本次请求规格

`duration_seconds=10`、`quality="720p"`、`aspect_ratio="9:16"`、`generate_audio=true`、`image_url=<上传资产ID>`、`prompt=<原文+音频约束>`。

已知差异：`enhance_prompt` 保持默认 `false`，以保留含音频约束的提示词原文；原 dashscope 请求为 `prompt_extend=true`，两者在“是否由平台改写提示词”上不同。

## 两次提交

### 第 1 次：失败，实扣 0 credits

- 任务 ID `run_01M2J4V518CPJPZS5DYKM3K2XG`；错误 `provider.failed`：`This image format is not supported. Use JPEG, PNG, or WebP.`
- 根因：参考图上传时把 multipart 文件 MIME 声明成 `application/octet-stream`，平台按不透明二进制入库（`media_type=application/octet-stream`、宽高 `null`、对象键 `source.bin`），下游供应商因此拒收。本地文件本身是合法 8bit RGB PNG。
- 计费：`credits.reserved=6`、`credits.charged=0`，`GET /v1/usage` 的 `credits_charged=0`、`recent_charges=[]`，即**未产生费用**。
- 修正：上传改为声明 `image/png`，并新增“平台未识别为图片即拒绝提交”的前置断言，避免再次白跑。

### 第 2 次：成功

- 任务 ID `run_01M2J5683D0J4R3WM3RH3VXM72`；单次提交，后续仅轮询。
- 平台时间：09:08:25 创建，09:17:29 开始（排队约 9 分钟），09:22:53 完成；生成耗时 324.5 秒，端到端约 14.5 分钟。
- 计费：`reserved=6`、`charged=6`；`GET /v1/runs/{id}/events` 的 `run.completed` 事件携带 `credits_charged=6`。即 **6 credits = $0.06**，与 10 秒 × $0.006/秒 的预估一致。这是实扣值，不是估算。

## 产物与验证

- 产物：`harness/scripts/runtime/output/protoface-ltx-s029/protoface-ltx-s029.mp4`（Git 忽略），8021294 字节，sha256 `95f28268cafb2d511515372c073ef63fbb8e2606cb7dc0067d616e57a5020f84`。
- 原样保存下载流，未静音、未裁剪、未改音轨。
- `ffprobe`：768×1344、24 fps、241 帧、H.264 + AAC 48kHz 立体声、实际时长 10.041667 秒。
- `ffmpeg -i … -f null -`：全片解码无错误。
- 对比原视频：720×1280、30 fps、300 帧、AAC 44.1kHz 立体声、10.030998 秒；时长差 +0.011 秒。
- 水印：**新视频整帧带 Protoface 平铺“P”水印**（原视频无）。实扣 6 credits 无法证明额度来源；平台未暴露该笔是否消耗赠送额度，故不能把实付金额当成单价结论。

## 音频与人声核验

- 音量：新视频 mean −14.6 dB / max −4.9 dB；原视频 mean −22.3 dB / max 0.0 dB（有削顶）。两者在 −45dB/0.5s 阈值下均无静音段，即都有连续音床。
- 人声（DashScope `qwen3-asr-flash-filetrans` 转写抽取音轨副本，源视频未改）：
  - 新视频 `no_valid_speech_fragment`，识别词数 0 → **未检出有效人声片段**，与音频约束一致。
  - 原视频识别出 5 词：`大势已去也` → **原 dashscope 成片自带一句人声台词**，这正是本次要规避的多余人声。
- 限制：ASR 只能覆盖可识别为语音/歌词的内容，不能完全排除非词汇发声（喘息、闷哼等）；未经人工听感复核，故“无任何人声”只能表述为“ASR 未检出有效人声片段”。

## 画面效果对比（抽帧并排，左=本次 LTX，右=原视频）

- 0.3 秒：两者都贴合首帧；LTX 大帐、烛台、印绶、竹简、剑的构图与首帧高度一致。
- 6.0 秒：LTX 仍在大帐内、构图稳定；原视频已切到帐外城楼前、改拿印绶，场景漂移更大但动作叙事更明确。
- 9.5 秒：LTX 出现一名参考图中没有的披甲人物俯身入画，提示词要求的“最后定格在印绶上”未落实；原视频停在人物与案上金印、紫绶，接近提示词结尾要求。
- 结论：LTX 首帧一致性与场景稳定性更好、更“贴图”，但对“三次踱步+拔剑循环、拍印绶、定格印绶”的动作叙事推进较弱，末段引入了额外人物。

## 自审与限制

本次只证明鉴权、模型参数解析、资产上传、提交、轮询、下载、解码、账单对齐与人声核验链路可用，且只覆盖一个样本，不能推出长期稳定性与模型整体质量结论。未修改正式供应商配置、设置页、默认模型或业务数据库（DB 只读打开）。水印来源（赠送额度或该档默认水印）未证实。prompt_extend/enhance_prompt 的差异未做对照实验。
