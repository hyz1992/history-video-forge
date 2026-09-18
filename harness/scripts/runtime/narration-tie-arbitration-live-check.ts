/**
 * 口播对齐仲裁 live check（显式付费验证，须用户授权后运行）。
 *
 * 目的：验证"同成本多解确定性仲裁"在真实 DashScope WS 链路上的行为——
 * 每条文案采集原生事件 → normalizeNarrationTiming → 立即用同一份事件重放复算，
 * 断言两次结果 canonicalStringify 逐字节相等（仲裁确定性），并记录全部对齐诊断。
 *
 * 用法（仓库根目录）：
 *   npx --no-install tsx harness/scripts/runtime/narration-tie-arbitration-live-check.ts           # 全部 5 条
 *   npx --no-install tsx harness/scripts/runtime/narration-tie-arbitration-live-check.ts --only=t3 # 单条
 *
 * 产物：harness/scripts/runtime/output/narration-tie-live-20260917/<id>/ 下
 *   events.json（原始 WS 事件）、audio.wav、timing.json、summary.json。
 * 需要环境变量 ALIYUN_DASHSCOPE_API_KEY（或仓库根目录 .env 中提供）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canonicalStringify, NarrationTimingMapV1 } from '../../../shared/src/index.js';
import { DashScopeNarrationProvider } from '../../../backend/src/modules/narration/providers/dashscope-narration-provider.js';
import { DashScopeSpeechWsClient } from '../../../backend/src/modules/narration/providers/dashscope-speech-ws-client.js';
import { normalizeNarrationTiming, type NarrationTimingDiagnostic } from '../../../backend/src/modules/narration/narration-timing-normalizer.js';

/** 5 条压测文案：对照 / 破折号省略号 / 阿拉伯数字（净变长读法）/ CRLF 分段 / 生僻字。 */
const TEXTS: Array<{ id: string; label: string; text: string }> = [
  { id: 't1', label: '对照：普通叙事标点', text:
    '靖康元年冬，汴京城破。金军没有立刻入城，他们在等一件事——宋钦宗亲自出城请降。' +
    '这个场面比刀兵更伤人：一个皇帝，代表整个王朝，跪在了敌人的面前。宗庙社稷，从此易主。' },
  { id: 't2', label: '破折号与省略号密集', text:
    '风停了——帐篷外只剩下马蹄的余音。他望着远处的火光，忽然想起父亲说过的一句话：' +
    '草原上没有永远的盟友……只有永远的利益。第二天清晨，使者到了——带来的不是盟约，而是最后通牒。' +
    '他握紧了刀，却始终没有拔出来……' },
  { id: 't3', label: '阿拉伯数字（一对多读法，净变长）', text:
    '公元208年，曹操率军南下，号称80万大军，实际兵力约20余万。孙刘联军的总兵力不过5万：' +
    '刘备部众约2万，周瑜率领的江东精锐3万。双方兵力相差10倍以上，长江成了唯一的屏障。' },
  { id: 't4', label: 'CRLF 空行分段（本次修复路径）', text:
    '垓下之围的第三夜，四面响起了楚歌。\r\n项羽从帐中坐起，问左右：汉军已经把楚地全占了吗？为什么汉营里这么多楚人？' +
    '\r\n那一夜他没有再睡。帐外，八百骑已经备好了马，只等突围的号令。' },
  { id: 't5', label: '生僻字（同音归一化路径）', text:
    '澶州城下，辽军前锋已抵北岸。宰相寇准力请真宗渡河亲征，侍从莫不惶恐。当御辇登上城楼，' +
    '宋军将士望见黄龙旗，山呼万岁，声闻数十里——士气在这一刻逆转了整个战局。和议的种子，也就此埋下。' },
  // 2026-09-18 第二轮：针对第一轮未闭合问题
  { id: 't6', label: '公元+阿拉伯数字换年份（触发稳定性）', text:
    '公元756年六月，哥舒翰被逼出潼关，二十万唐军在灵宝西原坠入隘道。火起于两侧山上，' +
    '箭落如雨，大军一日之间崩溃，关中门户就此洞开。' },
  { id: 't7', label: '汉字年份对照 + 2万/2千（两候选真实链路）', text:
    '公元七五六年，安史叛军势大。河北2万守军望风而降，唯有张巡率2千人死守雍丘，' +
    '以草人借箭，以奇兵夜袭，硬是把叛军拖在城下数月不得西进。' },
  { id: 't8', label: '多位数字（两千/两百 读法探测）', text:
    '汴京城外的仓库里存着2000万石粮食，守军却拿不出200两白银犒赏部队。户部官员算了三天账，' +
    '最后只批下1000贯——平均到每个士兵头上，不过几十文钱。' },
  { id: 't9', label: '标点密集（tie_arbitrated 触发探测）', text:
    '捷报传到御前——真的吗？！他连问三遍……满殿寂静。良久，皇帝才开口：好，好，好！！' +
    '传旨，摆驾庆功——不，先祭太庙。' },
  { id: 't10', label: '生僻字集中（同音归一化覆盖面）', text:
    '鄢郢之地既失，楚国东迁于陈。白起封武安君，威震天下；而阏与之战里赵奢证明，' +
    '秦军并非不可战胜——狭路相逢勇者胜，就是从这一仗传下来的。' },
];

const SETTINGS = {
  model: 'qwen-audio-3.0-tts-plus', voice: 'qwen-audio-3.0-tts-plus-longyimuling', region: 'cn-beijing',
  protocol: 'dashscope_ws', parametersVersion: 'neutral-pcm24k-v1', tone: 'neutral', rate: 1,
  pitch: 1, volume: 50, sampleRate: 24000, format: 'pcm', textType: 'PlainText',
  wordTimestampEnabled: true, enableSsml: false, seed: 0, inputMode: 'natural_paragraphs_single_task',
} as const;

/** 逐句公共前后缀聚焦差异区（与后端诊断同构，限长输出）。 */
function sentenceDiff(original: string, normalized: string): { src: string; norm: string } {
  let pre = 0;
  while (pre < Math.min(original.length, normalized.length) && original[pre] === normalized[pre]) pre += 1;
  let suf = 0;
  while (suf < Math.min(original.length, normalized.length) - pre &&
    original[original.length - 1 - suf] === normalized[normalized.length - 1 - suf]) suf += 1;
  const clip = (s: string) => s.length > 24 ? s.slice(0, 24) + '…' : s;
  return { src: clip(original.slice(pre, original.length - suf)), norm: clip(normalized.slice(pre, normalized.length - suf)) };
}

async function runOne(provider: DashScopeNarrationProvider, item: { id: string; label: string; text: string }, outDir: string): Promise<boolean> {
  const events: NarrationTimingDiagnostic[] = [];
  const startedAt = Date.now();
  try {
    const result = await provider.generate({ sourceText: item.text, settings: SETTINGS }) as any;
    // generate 内部不带 onDiagnostic；诊断由 provider 落盘到 storage/，
    // 这里另跑一次纯重放以在本脚本内收集诊断并断言逐字节一致（见下）。
    const elapsedMs = Date.now() - startedAt;
    const dir = join(outDir, item.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'events.json'), JSON.stringify(result.rawEvents, null, 1));
    await writeFile(join(dir, 'audio.wav'), result.wav);
    const timingJson = JSON.parse(canonicalStringify(result.timingMap)) as unknown;
    await writeFile(join(dir, 'timing.json'), JSON.stringify(timingJson, null, 1));
    // 重放复算：同一份 sentences 再跑一遍归一化，断言与 generate 产出的图逐字节一致（仲裁确定性）。
    const replayDiagnostics: NarrationTimingDiagnostic[] = [];
    const replay = normalizeNarrationTiming({
      sourceText: item.text, durationMs: result.durationMs, audioHash: result.audioHash, sentences: result.sentences,
    }, { onDiagnostic: e => replayDiagnostics.push(e) });
    const byteEqual = canonicalStringify(replay) === canonicalStringify(result.timingMap);
    const parseOk = NarrationTimingMapV1.safeParse(replay).success;
    const normLenDiff = result.sentences.map((s: { originalText: string; normalizedText: string }) =>
      Array.from(s.normalizedText).length - Array.from(s.originalText).length);
    const diffs = result.sentences.map((s: { originalText: string; normalizedText: string }) => sentenceDiff(s.originalText, s.normalizedText))
      .filter((d: { src: string; norm: string }) => d.src !== d.norm);
    const summary = {
      id: item.id, label: item.label, ok: true, elapsedMs, characters: result.usageCharacters,
      sourceLen: item.text.length, spokenLen: result.timingMap.spokenText.length,
      durationMs: result.durationMs, sentences: result.sentences.length, tokens: result.timingMap.tokens.length,
      normLenDiff, diffs, byteEqualReplay: byteEqual, contractParseOk: parseOk,
      diagnostics: replayDiagnostics,
      providerTaskId: result.providerTaskId,
    };
    await writeFile(join(dir, 'summary.json'), JSON.stringify(summary, null, 1));
    console.log('[live-check]', JSON.stringify(summary));
    return byteEqual && parseOk;
  } catch (error) {
    const err = error as { code?: string; receipt?: unknown; remoteOutcome?: string; message?: string };
    console.log('[live-check]', JSON.stringify({ id: item.id, ok: false, elapsedMs: Date.now() - startedAt,
      code: err.code ?? 'unknown', remoteOutcome: err.remoteOutcome, receipt: err.receipt, message: err.message }));
    return false;
  }
}

async function main() {
  const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
  const items = only ? TEXTS.filter(t => t.id === only) : TEXTS;
  if (!items.length) throw new Error(`--only=${only} 未匹配任何文案`);
  let apiKey = process.env.ALIYUN_DASHSCOPE_API_KEY ?? '';
  if (!apiKey.trim()) {
    const envPath = resolve(process.cwd(), '.env');
    if (existsSync(envPath)) {
      const content = await readFile(envPath, 'utf8');
      apiKey = content.split(/\r?\n/).find(l => l.startsWith('ALIYUN_DASHSCOPE_API_KEY'))?.split('=')[1]?.trim() ?? '';
    }
  }
  if (!apiKey.trim()) throw new Error('api_key_missing：环境变量或 .env 中缺少 ALIYUN_DASHSCOPE_API_KEY');
  const outDir = resolve(process.cwd(), 'harness/scripts/runtime/output/narration-tie-live-20260917');
  await mkdir(outDir, { recursive: true });
  const provider = new DashScopeNarrationProvider({ client: new DashScopeSpeechWsClient({ apiKey }) });
  let allOk = true;
  for (const item of items) {
    allOk = (await runOne(provider, item, outDir)) && allOk;
  }
  console.log('[live-check]', JSON.stringify({ done: true, allOk }));
  if (!allOk) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exit(1); });
