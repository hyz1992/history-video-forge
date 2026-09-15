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
- 水印：**首轮（免费额度）新视频整帧带 Protoface 平铺“P”水印**（原视频无）。来源已定位到计费口径而非模型或档位：官网定价页写明 “For accounts with no payment history, videos generated with free credits are for evaluation purposes only and will be watermarked.”，免费额度为 50 credits。模型参数面（`prompt/image_url/last_image_url/quality/aspect_ratio/duration_seconds/seed/generate_audio/enhance_prompt`）中不存在任何水印开关，故无法在请求侧关闭。平台未提供账户/余额接口（实测 `/v1/account`、`/v1/me`、`/v1/billing`、`/v1/credits`、`/v1/balance` 等 9 个路径均 404），剩余额度无法从 API 读取。**用户充值后重跑同规格，水印消失**，见下节，该口径推断由此被实测确认。

## 充值后同规格重跑（水印复核）

用户充值后授权再跑一次完全相同的规格，用于确认水印归属。

- 任务 ID `run_01M2JFKSWXPN8CXQNRHQP7EE9X`；规格与首轮逐字相同（同分镜、同提示词、同参考图资产、同 10 秒 / 720p / 9:16 / `generate_audio=true`）。
- 产物：`protoface-ltx-s029.mp4`，3609614 字节，sha256 `12dee1b68f8b8853b3ba457e5cd5f20ef00caf87c1bc76046467d6aa9e57b8ee`。
- `ffprobe`：768×1344、24 fps、241 帧、H.264 + AAC 48kHz 立体声、10.041667 秒；全片解码无错误。
- 平台时间：12:10:34 创建，12:12:47 开始（排队约 2.2 分钟），12:17:46 完成；生成 298.6 秒。
- 计费：`reserved=6`、`charged=6`，即再次实扣 **6 credits = $0.06**，与 10 秒 × $0.006/秒 一致。
- 水印：**同一裁切区域（`crop=360:360:60:60`）从满幅“P”平铺变为完全干净**，取证图 `frames/watermark-before-after.png`（左=充值前、右=充值后）；整帧亦无水印。码率从 6.39 Mbps 降到 2.88 Mbps，与叠加层移除一致。
- 首轮带水印成片已单独保留为 `watermarked-01M2J5683D0J4R3WM3RH3VXM72.mp4`，`frames-watermarked/` 保留其抽帧，未被覆盖。

## 付费成片的人声复核（ASR 假阳性判定）

- 单模型 ASR（`qwen3-asr-flash-filetrans`）对付费成片报出 2 词 `Thank you`（2420–3060ms），若直接采信会得出“混入英文人声”的错误结论。
- 复核一：该结果本身可疑——`Thank` 仅占 80ms，非正常词长。
- 复核二：把原视频真实台词 `大势已去也`（0–1920ms）作为阳性对照，绘制频谱图 `frames/spec-old-zoom.png`，可见清晰的下滑式谐波堆叠与共振峰起伏（典型浊音语音）。
- 复核三：同一时间窗（1.8–3.6 秒）对付费成片绘制同尺度频谱图 `frames/spec-paid-zoom.png`，为均匀宽带噪声纹理，**无任何谐波堆叠或共振峰结构**；ASR 定位处对应的是一个约 2.5–2.9 秒的宽带音效瞬态，并无语音。
- 结论：付费成片**未含可辨识人声**，ASR 报出的 `Thank you` 判为单模型在宽带瞬态上的假阳性。音频约束成立。
- 限制：本条结论由频谱结构比对与 ASR 行为得出，仍非人工听感复核，故表述为“未检出人声”而非“已证明绝对无人声”。


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

本次只证明鉴权、模型参数解析、资产上传、提交、轮询、下载、解码、账单对齐与人声核验链路可用，且只覆盖一个分镜的两个样本，不能推出长期稳定性与模型整体质量结论。未修改正式供应商配置、设置页、默认模型或业务数据库（DB 只读打开）。水印已由充值前后同规格对照实测确认属“无付款记录 + 免费额度”的计费口径限制，付费后可去除；但单次对照不能证明所有档位/模型均无水印。付费额度余额与付款记录均无法通过 API 查询。prompt_extend/enhance_prompt 的差异未做对照实验。画面质量评价基于抽帧比对，未做逐帧审看。
