# AutoDL 单分镜真实试调记录

日期：2026-09-14。用户授权使用已充值账号，复用已有分镜提示词和参考图进行单次试调。

## 样本与调用

- 项目：禁军反戈江都宫：隋炀帝最后的笼中抉择。
- 原运行：9595720c-5a95-4593-a654-ffd5002a4984；分镜任务：video_s005_01。
- 原始模型：wan2.7-i2v-2026-04-25；原参数：5 秒、720P、prompt_extend=true。
- 试调工作流：minimax_h3_lightx2v_v5；请求：5 秒、768p竖。
- 提示词与参考图 data URI 已逐字比较，完全相同；不改写提示词。
- 任务ID：15c9c838-8769-4cf9-aa8a-313eb8d74b8f。
- 单次提交，后续仅轮询；最终状态 SUCCESS。
- 平台时间：19:15:11 创建，19:15:12 开始，19:16:49 完成；返回 duration=98 秒。

## 验证结果

- `node --check harness/scripts/runtime/autodl-video-smoke.mjs`：通过。
- `ffprobe -v error -show_entries stream=codec_name,codec_type,width,height,r_frame_rate,duration:format=duration,size -of json harness/scripts/runtime/output/autodl-s005/autodl-s005.mp4`：768×1344，24 fps，H.264 视频 + AAC 音轨，实际时长 5.166667 秒，6594038 字节。
- `ffmpeg -v error -i harness/scripts/runtime/output/autodl-s005/autodl-s005.mp4 -f null -`：全片解码无错误。
- 产物和请求记录：`harness/scripts/runtime/output/autodl-s005/`（Git 忽略）。令牌不进入提交。

## 自审与限制

本次仅证明鉴权、提交、轮询、下载、解码链路可用。未修改正式供应商配置或业务数据库。返回值未包含实扣金额，实际费用未验证；人物一致性、动作质量、音轨内容和与原视频的主观质量对比未验证。仅一个样本，不能推出长期稳定性。

H3 使用多图参考工作流中的一张参考图，原模型使用首帧模式；分辨率与比例也不同。实际成片比请求的5秒长约0.167秒，正式接入需处理时间轴适配。
