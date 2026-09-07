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


describe("口播 Map 账本并发合并", () => {
    const permutations = [
        ["high", "low", "unknown"], ["high", "unknown", "low"],
        ["low", "high", "unknown"], ["low", "unknown", "high"],
        ["unknown", "high", "low"], ["unknown", "low", "high"],
    ] as const;
    const fixture = () => {
        const db = createDbClient();
        const snapshot = { id: "snapshot", runId: "run", projectId: "project", operation: "script.narration.generate" } as never;
        return { db, snapshot, runId: "run", providerRequestKey: "request", providerModelId: "tts.synthesize.dashscope.cn-beijing.qwen-audio-3.0-tts-plus", pricingVersion: "v1", priceMicrosPer10k: "1400000", sourceCharacters: 80 };
    };
    for (const seeded of [false, true]) {
        it.each(permutations)(
            (seeded ? "已有部分回执" : "空账本") + "：并发 %s → %s → %s 保持唯一最大最终费用",
            async (...order) => {
                const common = fixture();
                const previous = seeded ? await recordNarrationUsage({ ...common, usageCharacters: 100, status: "failed", receiptKind: "partial" }) : null;
                const receipts = {
                    high: { usageCharacters: 308, status: "succeeded", receiptKind: "final" },
                    low: { usageCharacters: 120, status: "failed", receiptKind: "partial" },
                    unknown: { usageCharacters: null, status: "submitted" },
                } as const;
                const results = await Promise.all(order.map(kind => recordNarrationUsage({ ...common, ...receipts[kind] })));
                const records = [...common.db.usageCostRecords.values()];
                expect(records).toHaveLength(1);
                expect(new Set(results.map(row => row.id)).size).toBe(1);
                expect(records[0]).toMatchObject({
                    outputUnits: 308, actualCostMicros: "43120", status: "succeeded",
                    costBasis: "provider_usage", assetProviderJobRecordId: null,
                    unitDetailJson: { provider_cumulative_characters: 308, provider_receipt_kind: "final", actual_cost_state: "provider_usage_priced" },
                });
                if (previous) {
                    expect(records[0].id).toBe(previous.id);
                    expect(records[0].createdAt).toEqual(previous.createdAt);
                }
            },
        );
    }
    it("不同请求 key 和不同快照并发记账互不串账", async () => {
        const common = fixture();
        const otherSnapshot = { id: "snapshot-2", runId: "run-2", projectId: "project", operation: "script.narration.generate" } as never;
        await Promise.all([
            recordNarrationUsage({ ...common, usageCharacters: 308, status: "succeeded" }),
            recordNarrationUsage({ ...common, providerRequestKey: "request-2", usageCharacters: 120, status: "failed" }),
            recordNarrationUsage({ ...common, snapshot: otherSnapshot, runId: "run-2", usageCharacters: null, status: "submitted" }),
        ]);
        const rows = [...common.db.usageCostRecords.values()];
        expect(rows).toHaveLength(3);
        expect(rows.find(row => row.runConfigurationSnapshotId === "snapshot" && row.providerRequestKey === "request")).toMatchObject({ outputUnits: 308, actualCostMicros: "43120", status: "succeeded" });
        expect(rows.find(row => row.providerRequestKey === "request-2")).toMatchObject({ outputUnits: 120, actualCostMicros: "16800", status: "failed" });
        expect(rows.find(row => row.runConfigurationSnapshotId === "snapshot-2")).toMatchObject({ outputUnits: null, actualCostMicros: null, status: "submitted" });
    });
    it("无价格时并发最终回执仍保留最大用量，但实际费用未知", async () => {
        const common = { ...fixture(), priceMicrosPer10k: null };
        await Promise.all([
            recordNarrationUsage({ ...common, usageCharacters: 308, status: "succeeded", receiptKind: "final" }),
            recordNarrationUsage({ ...common, usageCharacters: null, status: "submitted" }),
        ]);
        const rows = [...common.db.usageCostRecords.values()];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ outputUnits: 308, actualCostMicros: null, status: "succeeded", costBasis: "estimate", unitDetailJson: { provider_receipt_kind: "final", actual_cost_state: "unknown" } });
    });
});
