import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** S2-2B 任务 10：浏览器验收脚本的静态冒烟测试。
 *
 * 真实浏览器运行通过 `npm run harness:s2-2b-browser-acceptance` 显式执行
 * （Playwright 全流程：设置页创作三区/项目覆盖与失效预览/字幕预览框）；
 * 本测试保证脚本存在、注册了 npm 入口、且验收步骤与详细设计 §13.5 对应。
 */

const scriptPath = join(process.cwd(), "harness/scripts/ui-acceptance/s2-2b-browser-acceptance.ts");
const packageJsonPath = join(process.cwd(), "package.json");

describe("S2-2B browser acceptance script (任务 10 步骤 3)", () => {
  it("验收脚本存在且包含全部 UI 验收点", () => {
    expect(existsSync(scriptPath)).toBe(true);
    const source = readFileSync(scriptPath, "utf-8");
    expect(source).toContain("verifyCreativeSettings"); // 设置页创作三区渲染/保存/刷新保持
    expect(source).toContain("verifyVoicePreviewInProjectSettings"); // 复审 P1-1b：项目设置内试听（免 quote fake/cached，含网络断言）
    expect(source).toContain("verifyProjectCreativeCover"); // 项目覆盖 + 画风失效预览
    expect(source).toContain("verifySubtitlePreview"); // 字幕安全覆盖 + 预览框
    expect(source).toContain("project-invalidation-preview"); // 失效预览映射
    expect(source).toContain("subtitle-preview-text"); // 预览框 testid
    // 不做真实付费调用（stub/fake 部署）
    expect(source).not.toContain("dashscope.aliyuncs.com");
  });

  it("npm 入口 harness:s2-2b-browser-acceptance 已注册", () => {
    const packageJson = readFileSync(packageJsonPath, "utf-8");
    expect(packageJson).toContain('"harness:s2-2b-browser-acceptance"');
  });

  it("e2e 验收测试覆盖快照冻结/执行消费/试听/兼容四项", () => {
    const e2ePath = join(process.cwd(), "tests/backend/s2-2b-e2e-acceptance.test.ts");
    expect(existsSync(e2ePath)).toBe(true);
    const source = readFileSync(e2ePath, "utf-8");
    expect(source).toContain("resolved_creative"); // 快照冻结断言
    expect(source).toContain("voice.preview"); // 试听链路
    expect(source).toContain("旧 A 请求体兼容");
  });
});
