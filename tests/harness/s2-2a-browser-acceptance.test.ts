import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** S2-2A 任务 12：浏览器验收脚本的静态冒烟测试。
 *
 * 真实浏览器运行通过 `npm run harness:s2-2a-browser-acceptance` 显式执行
 * （Playwright 全流程：设置四档切换/项目冻结/失效预览）；本测试保证脚本
 * 存在、注册了 npm 入口、且验收步骤与实施计划任务 12 步骤 3 的验收点对应。
 */

const scriptPath = join(process.cwd(), "harness/scripts/ui-acceptance/s2-2a-browser-acceptance.ts");
const packageJsonPath = join(process.cwd(), "package.json");

describe("S2-2A browser acceptance script (任务 12 步骤 3)", () => {
  it("验收脚本存在且包含全部 UI 验收点", () => {
    expect(existsSync(scriptPath)).toBe(true);
    const source = readFileSync(scriptPath, "utf-8");
    // 实施计划任务 12 步骤 3 的验收点逐项对应
    expect(source).toContain("verifySettingsFourStrategies"); // 用户设置四档切换
    expect(source).toContain("verifyProjectFreezeAndInvalidation"); // 创建项目后默认冻结 + 项目设置失效预览
    expect(source).toContain("继承自创建时用户默认"); // 来源说明
    expect(source).toContain("资产规划"); // 失效预览映射到资产规划
    // 不做真实付费调用（stub/fake 部署）
    expect(source).not.toContain("dashscope.aliyuncs.com");
  });

  it("npm 入口 harness:s2-2a-browser-acceptance 已注册", () => {
    const packageJson = readFileSync(packageJsonPath, "utf-8");
    expect(packageJson).toContain('"harness:s2-2a-browser-acceptance"');
  });

  it("e2e 验收测试覆盖 9B 三入口 quote 正链路与 billing 落账", () => {
    const e2ePath = join(process.cwd(), "tests/backend/s2-2a-e2e-acceptance.test.ts");
    expect(existsSync(e2ePath)).toBe(true);
    const source = readFileSync(e2ePath, "utf-8");
    expect(source).toContain("storyboard.generate quote 正链路");
    expect(source).toContain("asset_plan.generate quote 正链路");
    expect(source).toContain("publish.generate quote 正链路");
    expect(source).toContain("assertBilling");
  });
});
