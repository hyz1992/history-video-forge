import { narrationVisibleStatus, hasPassingNarrationScriptValidation } from "../../../backend/src/modules/narration/narration-readiness.js";
import { recordNarrationUsage } from "../../../backend/src/modules/generation-cost/usage-cost-recorder.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { describe, expect, it } from "vitest";
import { computeRunPayloadFingerprint } from "../../../backend/src/modules/generation-run/generation-run.service.js";
describe("口播请求指纹", () => {
    const base = { operation: "script.narration.generate", narration: { source_script_record_id: "s1", source_text_sha256: "a".repeat(64), settings_override: {}, source_project_tts_settings_sha256: "b".repeat(64), projection_version: "narration-tts-projection/v1" } };
    it.each([
        { source_script_record_id: "s2" }, { source_text_sha256: "c".repeat(64) },
        { settings_override: { rate: 1 } }, { source_project_tts_settings_sha256: "d".repeat(64) },
        { projection_version: "narration-tts-projection/v2" },
    ])("同 key 的口播来源与参数变化不能复用：%j", patch => {
        expect(computeRunPayloadFingerprint({ ...base, narration: { ...base.narration, ...patch } } as never)).not.toBe(computeRunPayloadFingerprint(base as never));
    });
    it("旧 operation 忽略新增口播字段，保持旧指纹", () => {
        expect(computeRunPayloadFingerprint({ ...base, operation: "assets.generate" } as never)).toBe(computeRunPayloadFingerprint({ operation: "assets.generate" }));
    });
});
describe("口播费用累计值", () => {
    it("累计100→150→120→150只留150，未知迟到不抹账", async () => {
        const db = createDbClient(), snapshot = { id: "snapshot", runId: "run", projectId: "project", operation: "script.narration.generate" } as never;
        const common = { db, snapshot, runId: "run", providerRequestKey: "request", providerModelId: "tts.synthesize.dashscope.cn-beijing.qwen-audio-3.0-tts-plus", pricingVersion: "v1", priceMicrosPer10k: "1400000", sourceCharacters: 80 };
        for (const usageCharacters of [100, 150, 120, 150])
            await recordNarrationUsage({ ...common, usageCharacters, status: "succeeded" });
        await recordNarrationUsage({ ...common, usageCharacters: null, status: "submitted" });
        expect(db.usageCostRecords.size).toBe(1);
        const record = [...db.usageCostRecords.values()][0];
        expect(record.outputUnits).toBe(150);
        expect(record.actualCostMicros).toBe("21000");
        expect(record.status).toBe("succeeded");
        expect(record.assetProviderJobRecordId).toBeNull();
    });
    it("无价格或无receipt不能伪造已确认零费用", async () => { const db = createDbClient(); const record = await recordNarrationUsage({ db, snapshot: { id: "s", runId: "r", operation: "script.narration.generate" } as never, runId: "r", providerRequestKey: "q", providerModelId: "tts.synthesize.dashscope.cn-beijing.qwen-audio-3.0-tts-plus", pricingVersion: "unknown", priceMicrosPer10k: null, sourceCharacters: 30, usageCharacters: 40, status: "succeeded" }); expect(record.actualCostMicros).toBeNull(); expect(record.costBasis).toBe("estimate"); expect(record.unitDetailJson?.actual_cost_state).toBe("unknown"); });
});

describe("口播状态投影与硬校验",()=>{
 it("只读投影终态run，不把未完成record仍报生成中",()=>{expect(narrationVisibleStatus("generating","failed")).toBe("failed");expect(narrationVisibleStatus("generating","needs_reconciliation")).toBe("unknown");expect(narrationVisibleStatus("cancelled","succeeded")).toBe("cancelled")});
 it("decision pass不足以伪装合法硬校验报告",()=>{expect(hasPassingNarrationScriptValidation({decision:"pass"})).toBe(false);expect(hasPassingNarrationScriptValidation({stage:"script_local_validation",decision:"pass",errors:["failed"],warnings:[],metrics:{}})).toBe(false);expect(hasPassingNarrationScriptValidation({stage:"script_local_validation",decision:"pass",errors:[],warnings:[],metrics:{}})).toBe(true)});
});
