# Script Semantic Reviewer Calibrated Distribution

Date: 2026-05-05

## 1. Run Context

- Purpose: measure semantic reviewer distribution after first-pass acceptance calibration.
- Runtime provider: `LLM_PROVIDER=openai`
- Runner: one-off runner using the current `runScriptGeneration()` path.
- Output directory: `harness/scripts/runtime/output/script-semantic-reviewer-calibrated-distribution-2026-05-05`
- Sample count: 10
- Patch / regen request flags: `allowPatch=false`, `allowRegen=false`
- Reviewer mode: shadow-only.

This run used the same 10 fixed topic records as the previous semantic distribution baseline. The only intended behavioral difference is the calibrated reviewer prompt, which now says a structurally complete first-pass draft should receive `pass` even if it has polish opportunities.

## 2. Aggregate Result

| Metric | Before calibration | After calibration |
|---|---:|---:|
| Completed runtime calls | 10 / 10 | 10 / 10 |
| Runtime errors | 0 / 10 | 0 / 10 |
| Local validation pass | 10 / 10 | 10 / 10 |
| Semantic `pass` | 0 / 10 | 10 / 10 |
| Semantic `patch_once` | 10 / 10 | 0 / 10 |
| Semantic `regen_once` | 0 / 10 | 0 / 10 |
| Semantic `return_topic` | 0 / 10 | 0 / 10 |
| Semantic `skipped` | 0 / 10 | 0 / 10 |
| Main-chain `patch-once` step present | 0 / 10 | 0 / 10 |

The reviewer no longer treats every structurally valid first pass as `patch_once/lift`. It also remains shadow-only: no sample entered the main-chain patch step.

## 3. Per-sample Record

| ID | Title | Opening span | Semantic decision | Hard issues | Soft issues | Patch targets |
|---|---|---|---|---:|---:|---:|
| baseline-01-yanzi | 晏子使楚 | 楚王设宴，故意不开大门，让晏子从狗洞钻入。楚王冷笑：'齐国无人吗？竟派你这样的使臣？' | `pass` | 0 | 3 | 0 |
| baseline-02-zhuzhiwu | 烛之武退秦师 | 夜色沉沉，秦晋大军把郑国围得水泄不通。郑国危在旦夕，能出城谈判的人，只有烛之武。 | `pass` | 0 | 2 | 0 |
| baseline-03-zhuanzhu | 专诸刺王僚 | 最危险的刺杀，不在战场，而在一桌饭局上。公元前515年，公子光设宴邀请王僚，表面上是君臣欢聚，实则是一场精心策划的刺杀陷阱。 | `pass` | 0 | 2 | 0 |
| baseline-04-jingke | 荆轲刺秦王 | 荆轲捧着地图走进秦殿，匕首就藏在卷轴尽头。 | `pass` | 0 | 2 | 0 |
| baseline-05-xuanwumen | 玄武门之变 | 玄武门前伏兵已定，李建成和李元吉正一步步走入门内。 | `pass` | 0 | 2 | 0 |
| baseline-06-duomen | 夺门之变 | 深夜，南宫的围墙外传来一阵急促的脚步声。被幽禁多年的明英宗，此刻正不安地等待着命运的转折。 | `pass` | 0 | 2 | 0 |
| baseline-07-feishui | 淝水之战 | 淝水两岸，前秦大军压境，东晋面临生死存亡的危机。 | `pass` | 0 | 2 | 0 |
| baseline-08-julu | 巨鹿之战 | 秦军围巨鹿，诸侯军却都在观望，谁也不愿第一个出阵。 | `pass` | 0 | 2 | 0 |
| baseline-09-lisi | 李斯之死 | 咸阳刑场之上，曾经权倾朝野的李斯被推向腰斩的刑具。 | `pass` | 0 | 2 | 0 |
| baseline-10-hanxin | 韩信之死 | 韩信最刺痛的结局，是他没倒在敌人手里。长乐宫内，韩信一步步走入早已设好的圈套。 | `pass` | 0 | 2 | 0 |

## 4. Interpretation

The calibration solved the immediate over-triggering symptom: the previous 10 / 10 `patch_once/lift` distribution became 10 / 10 `pass` on the same style of first-pass samples.

This is a better first-pass acceptance signal, but it may now be under-sensitive. The reviewer still reports minor soft issues in every sample, yet treats them as non-blocking. That is consistent with the new prompt, but this run does not prove the reviewer will still catch clearly weak drafts.

Current conclusions:

- Local first-pass structure remains stable: 10 / 10 local pass.
- Reviewer output remains parseable: 0 / 10 skipped.
- Reviewer is no longer driving patch behavior: 0 / 10 patch step present.
- Reviewer calibration needs a weak-draft contrast set before it can be called a trustworthy quality ruler.

## 5. Next Follow-up

Do not enable semantic patch behavior yet. The next smallest task should add a small controlled contrast test set:

- good-enough first-pass fixtures that should receive `pass`
- deliberately weak first-pass fixtures that should receive `patch_once/lift`
- off-contract drafts that should receive `regen_once` or `return_topic`

Keep these as reviewer calibration fixtures and shadow metrics. Do not connect them to automatic patching in this round.
