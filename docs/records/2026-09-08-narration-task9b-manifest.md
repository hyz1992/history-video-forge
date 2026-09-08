# Task9B：资产执行引用整篇口播

固定BASE：2401dca8d6e0f0e3f83e57e262e5e8ea8e7b3f02；dev；T2。初始时计数：整改0、final0、额外授权0。

## 中文设计与实施计划

依据正式设计§6及实施计划Task9B，复用已有AssetManifestV2定义并迁入正式assets目录，AssetManifest联合保留v1。v2强校验全局音频只有一个、无chunk/付费TTS执行、字幕provider_timestamp及narration/audio/timing/revision/settings来源完整，真实range连续覆盖。

先实现口播导入器：完整校验记录/时间图/计划/字幕revision及磁盘bundle，复用既有视觉骨架和SFX/BGM行为，不调用旧TTS chunking。一个全局merged audio artifact供所有镜头以range引用；字幕完整resolvedStyle与revision来源直接映射。

再接资产run与execution：捕获DB权威script/narration/active storyboard/asset plan/subtitle revision身份，每次外部submit及最终manifest激活前复查；配置不得重新选voice。旧结果可以保留历史，不能恢复旧active。视频prepare优先v2range实际长度，沿用既有规格档和split plan，不改变audio参数。

最后覆盖完整导入、零TTS/ASR、117秒音频中6.4秒镜头、超上限拆分/短素材/fallback、冷实例换源/字幕revision变化/迟到job，以及v1回归和typecheck，再T2双审与终审。默认开关及Task9C字幕保存编排、compose/render不在本任务修改。

## 初审与第一轮整改

初审 diff：0 Critical、2 Important、0 Minor；合同：0 Critical、2 Important、0 Minor。

- D1：重试基线必须来自同一数据库来源快照，禁止从冷/旧Map重复派发完成素材。真实SQLite同实例和清空manifest缓存后重试，整改前图片job由2变4，整改后均保持2。
- D2：来源失效不得抹去已提交的付费调用；派发前保持零记录，submit后、poll后和拆分部分派发保留usage，仍停止下载/激活。
- C1：正式共享v2正例补齐全局音频字幕及来源，保留缺引用、越界、音频终点等原验收，不放松schema。共享合同从78通过2失败变为80通过0失败。
- C2：v2直接覆盖110.6秒镜头拆8段14秒、短素材/供应商失败显式fallback、视频探测失败拒绝、范围及WAV hash保持。短素材新增实测长度消费，复用已有fallback状态机。视频探测测试采用离线mock，不代表真实视频成品验收。
- 补强：真实SQLite完整入口到激活；最后候选落库后更换口播/字幕拒绝；SQLite触发器使第二项project写入报Prisma P2003，激活标记回滚，删除触发器后成功恢复。

R1时计数：整改1、final0、额外授权0。R1累计diff与合同均0 Critical、0 Important、0 Minor，初审四项闭环。

## 验证证据

证据目录：`harness/scripts/runtime/output/narration-task9b-evidence-20260908/`。

- 初始回归`regression-initial.json`：8文件184通过0失败。
- 第一轮回归`regression-r1.json`：9文件278通过0失败；包含共享合同及Task9B专项。
- `npx tsc --noEmit -p backend/tsconfig.json`：exit 0。
- 红测报告：`red-r1-retry.json`（两项重复派发）、`red-r1-usage.json`（两项漏记费用）、`red-r1-video.json`（短素材错误接受）。
- 默认开关/TTS默认/用户文件未改；未运行paid/live、浏览器、Remotion或成品验收。

## 第二轮整改

R1收敛后、终审前的自审补查，经diff reviewer只读确认新增Important：历史completed短视频可在missingOnly/其他任务重试绕过新产出检查。此项不计为R1已覆盖。

不变量：最终使用的视频路线不论新产出或历史复用，长度都必须覆盖该镜头range；不足显式阻塞或fallback，不改音轨。local validator按绑定producer的去重artifact集合核验长度；两种历史重试红测均无长度错误，整改后均blocked；足长split正例仍通过。

R2时计数：整改2、final0、额外授权0。R2 diff与合同各0 Critical、1 Important、0 Minor，指向同一选中视频集合问题。

`regression-r2.json`：9文件281通过0失败，专项30；`npx tsc --noEmit -p backend/tsconfig.json` exit 0。红测`red-r2-history.json`含两项真实重试路径反例。视频probe与provider仍仅离线验证。

## 第三轮整改

R2两审发现同一Important：producer产物ID可包含历次重试候选，不能相加冒充连续片段。

不变量：普通视频只计算当前primary；split必须同一`video_split_group_id`、同task、完整且唯一的0..total-1分段、全部绑定producer，不能混入其他批次。v2视频provider用run/execution/attempt生成分组标识；成功重试只替换该视频任务在当前manifest的旧引用，历史manifest和其他镜头保留。未通过集合验证的历史split显式blocked。

反向组合覆盖短primary+长旧候选、长primary+无关短候选、跨批次split、重复分段、缺批次；正例覆盖足长split及实际run的split重试不污染其他镜头/历史记录。

R3停止时计数：整改3、final0、额外授权0。第三轮diff未收敛，当时停止等待授权。

`regression-r3.json`实际9文件287通过0失败，专项36；后端tsc exit 0。`red-r3-selected.json`和`red-r3-split-retry.json`保留失败证据。未扩大paid/live/UI验收声明。

## 第三轮审查结果与停止点

R3合同：0 Critical、0 Important、0 Minor；R3 diff：0 Critical、1 Important、0 Minor。整体未收敛，未进入final，未声明Task9B完成。

剩余Important：engine先追加短split产物，再因长度不足抛错，产物未登记到execution output IDs；后续成功重试仅清理旧output IDs，遗漏失败孤立split。validator检测到旧失败组与新成功组并存，导致足长重试仍blocked。该恢复组合未被现有287项回归覆盖。

所需下一步范围：未接受的旧产物不得污染下一次成功播放集合；补“首次短split失败→成功恢复”和“已有成功组→短split失败→成功恢复”两类序列测试，再完整累计双审并在收敛后终审。依独立审查协议默认3轮上限，目前不执行此修改；需Task9B单独额外一轮授权。此前Task6额外授权不挪用到本任务。产品候选维持R3文件内容，尚未提交。

## 第四轮受限授权与整改

用户明确回复“允许授权，请继续”，授权Task9B额外一轮R4，仅修复失败split恢复、补两类序列测试并复审；若仍不收敛则停止。本次额外授权累计1，不挪用其他任务授权。前节等待授权状态为R3历史停止点。

不变量：未被接受的新视频产物不得进入当前候选播放集合。engine将v2视频长度检查移至artifact替换/追加之前；短split失败保留既有fallback行为，不发布孤立产物。

两类完整run序列：首次短split失败→足长恢复；已有成功组→短split失败→足长恢复。红测均在恢复阶段错误blocked，绿测恢复video_clip、无失败组残留、WAV hash保持。

当前计数：整改4、final0、额外授权1。R4待完整累计复审。

`regression-r4.json`实际9文件289通过0失败，专项38；后端tsc exit 0；`red-r4-recovery.json`保留两项恢复失败证据。仅离线验证，未运行paid/live/UI/成品。
