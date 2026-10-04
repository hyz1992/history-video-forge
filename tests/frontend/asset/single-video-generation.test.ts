import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { parse } from "@vue/compiler-sfc";
import { describe, expect, it, vi } from "vitest";

// 对真实组件处理函数执行行为测试：卡片事件应经过报价确认后提交同一任务。
// 不复制处理逻辑，不调用供应商，不依赖浏览器或完整页面初始化。
function realHandler(bindings: Record<string, unknown>) {
  const file = readFileSync("frontend/src/components/asset/AssetPanel.vue", "utf8");
  const script = parse(file).descriptor.scriptSetup!.content;
  const source = ts.createSourceFile("AssetPanel.ts", script, ts.ScriptTarget.Latest, true);
  const handler = source.statements.find(
    (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "handleGenerateTask",
  );
  if (!handler) throw new Error("组件单任务生成处理函数缺失");
  const code = ts.transpileModule(handler.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(code + "\nhandleGenerateTask", bindings) as (id: string) => Promise<void>;
}

describe("分镜视频卡片的单任务生成", () => {
  it("已存在的视频任务在确认价格后提交原任务，不默默跳过", async () => {
    const task = { task_id: "video_s012_01", task_type: "video_clip" };
    const confirm = vi.fn().mockResolvedValue(undefined);
    const generateSingleTask = vi.fn().mockResolvedValue(undefined);
    const submit = { quoteId: "quote-1", idempotencyKey: "retry-1", authorizeBudgetOverride: false };
    const quoteAndGenerateWithRetry = vi.fn(async (options) => { await options.submit(submit); });
    const pricing = vi.fn().mockResolvedValue({ video: { unitPricePerSec: .09, qualityLabel: "1080P", displayName: "AutoDL H3" } });
    const handler = realHandler({
      assetTasks: { value: [task] }, projectId: { value: "project-1" },
      TASK_TYPE_LABELS: { video_clip: "分镜视频" }, getTaskCostHint: () => "",
      resolveGenerationPricingOnce: pricing, ElMessageBox: { confirm },
      quoteAndGenerateWithRetry, assetsStore: { generateSingleTask },
    });
    await handler(task.task_id);
    expect(pricing).toHaveBeenCalledWith("project-1");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("AutoDL H3"), "确认单任务生成", expect.any(Object));
    expect(quoteAndGenerateWithRetry).toHaveBeenCalledWith(expect.objectContaining({ request: { operation: "assets.generate", selection: { task_ids: [task.task_id] } } }));
    expect(generateSingleTask).toHaveBeenCalledWith(task.task_id, submit);
  });

  it("取消费用确认时不请求报价，也不生成视频", async () => {
    const quoteAndGenerateWithRetry = vi.fn();
    const handler = realHandler({
      assetTasks: { value: [{ task_id: "video-1", task_type: "video_clip" }] }, projectId: { value: "project-1" },
      TASK_TYPE_LABELS: { video_clip: "分镜视频" }, getTaskCostHint: () => "",
      resolveGenerationPricingOnce: async () => ({ video: { unitPricePerSec: .09, qualityLabel: "1080P", displayName: "AutoDL H3" } }),
      ElMessageBox: { confirm: async () => { throw new Error("cancel"); } }, quoteAndGenerateWithRetry,
    });
    await handler("video-1");
    expect(quoteAndGenerateWithRetry).not.toHaveBeenCalled();
  });
});
