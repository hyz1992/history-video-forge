import { describe, expect, it } from "vitest";

import { randomUUID } from "node:crypto";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createProvisionalEvent } from "../../../backend/src/modules/events/event-registry.repository.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { confirmTopicCandidate, type StoredTopicCandidate } from "../../../backend/src/modules/topic/topic-confirm.service.js";
import { buildScriptInputBundle } from "../../../backend/src/modules/script/script-input-bundle.builder.js";
import { buildApp } from "../../../backend/src/app.js";
import { seedGenerationCatalog } from "../helpers/seed-generation-catalog.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";

function makeBaseCandidate(event: ReturnType<typeof createDbClient> extends infer DB
  ? Awaited<ReturnType<typeof createProvisionalEvent>>
  : never) {
  return {
    candidateId: "test-candidate",
    projectId: "",
    event,
    title: "测试事件",
    oneLineAngle: "测试角度",
    familyLabel: "测试类型",
    scopeLabel: "单事件",
    coreConflict: "测试核心冲突",
    strongScene: "测试强场面",
    mustCoverPreview: ["节拍1", "节拍2", "节拍3"],
    sourceHint: "测试来源",
    recentUsageHint: "首次测试",
  };
}

describe("三入口 confirm 合并", () => {
  it("recommended confirm：sourceMode 缺失时默认 recommended，sourceRefJson 为 null", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "Source Recommended" });
    const event = await createProvisionalEvent(db, {
      canonicalName: "推荐测试",
      aliases: [],
    });

    const result = await confirmTopicCandidate({
      projectDb: db,
      project,
      candidate: {
        ...makeBaseCandidate(event),
        candidateId: "rec-test",
        projectId: project.id,
        title: "推荐源测试",
      },
    });

    const saved = db.topicPackages.get(result.topic_package.topic_package_id);
    expect(saved).toBeDefined();
    expect(saved!.sourceMode).toBe("recommended");
    expect(saved!.sourceRefJson).toBeNull();
  });

  it("library confirm：sourceMode=library，sourceRefJson 含 eventLibraryEntryId", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "Source Library" });
    const event = await createProvisionalEvent(db, {
      canonicalName: "库测试",
      aliases: [],
    });

    const result = await confirmTopicCandidate({
      projectDb: db,
      project,
      candidate: {
        ...makeBaseCandidate(event),
        candidateId: "lib-test",
        projectId: project.id,
        title: "库源测试",
        sourceMode: "library",
        sourceRef: { eventLibraryEntryId: "entry-001", angleId: "angle-a" },
      },
    });

    const saved = db.topicPackages.get(result.topic_package.topic_package_id);
    expect(saved).toBeDefined();
    expect(saved!.sourceMode).toBe("library");
    expect(saved!.sourceRefJson).toEqual({ eventLibraryEntryId: "entry-001", angleId: "angle-a" });
  });

  it("custom confirm：sourceMode=custom，sourceRefJson 含 customDraftId", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "Source Custom" });
    const event = await createProvisionalEvent(db, {
      canonicalName: "自定义测试",
      aliases: [],
    });

    const result = await confirmTopicCandidate({
      projectDb: db,
      project,
      candidate: {
        ...makeBaseCandidate(event),
        candidateId: "custom-test",
        projectId: project.id,
        title: "自定义源测试",
        sourceMode: "custom",
        sourceRef: { customDraftId: "draft-xyz" },
      },
    });

    const saved = db.topicPackages.get(result.topic_package.topic_package_id);
    expect(saved).toBeDefined();
    expect(saved!.sourceMode).toBe("custom");
    expect(saved!.sourceRefJson).toEqual({ customDraftId: "draft-xyz" });
  });

  it("三入口产出的合同字段结构一致", async () => {
    const results: Array<{ mode: string; pkg: Record<string, unknown> }> = [];

    for (const [mode, sourceOpts] of [
      ["recommended", {}],
      ["library", { sourceRef: { eventLibraryEntryId: "e1" } }],
      ["custom", { sourceRef: { customDraftId: "d1" } }],
    ] as const) {
      const db = createDbClient();
      const project = await createProject(db, { name: `Consistency ${mode}` });
      const event = await createProvisionalEvent(db, {
        canonicalName: `一致性测试-${mode}`,
        aliases: [],
      });

      const result = await confirmTopicCandidate({
        projectDb: db,
        project,
        candidate: {
          ...makeBaseCandidate(event),
          candidateId: `cons-${mode}`,
          projectId: project.id,
          title: `一致性测试-${mode}`,
          sourceMode: mode,
          ...sourceOpts as Record<string, unknown>,
        },
      });
      results.push({ mode, pkg: result.topic_package as unknown as Record<string, unknown> });
    }

    // 所有三入口的合同字段存在且为非空字符串
    const contractFields = [
      "core_conflict", "stakes", "strong_scene",
    ] as const;
    for (const r of results) {
      for (const field of contractFields) {
        expect(r.pkg[field], `${r.mode}: ${field} 应为非空字符串`)
          .toEqual(expect.any(String));
        expect((r.pkg[field] as string).length, `${r.mode}: ${field} 不应为空`)
          .toBeGreaterThan(0);
      }
      expect(r.pkg.must_include_beats, `${r.mode}: must_include_beats`)
        .toEqual(expect.any(Array));
      expect((r.pkg.must_include_beats as unknown[]).length, `${r.mode}: beats 数量`)
        .toBeGreaterThanOrEqual(3);
    }
  });

  it("ScriptInputBundle 携带 library confirm 的 source_mode/source_ref", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "Script Bundle Library" });
    const event = await createProvisionalEvent(db, {
      canonicalName: "库脚本测试",
      aliases: [],
    });

    const result = await confirmTopicCandidate({
      projectDb: db,
      project,
      candidate: {
        ...makeBaseCandidate(event),
        candidateId: "bundle-lib",
        projectId: project.id,
        title: "库脚本捆绑测试",
        sourceMode: "library",
        sourceRef: { eventLibraryEntryId: "entry-bundle", angleId: "angle-b" },
      },
    });

    // 模拟真实 script-run 的 TopicPackageRecord → mapTopicPackage → buildScriptInputBundle 路径
    const record = db.topicPackages.get(result.topic_package.topic_package_id)!;
    const topicPackage = {
      topic_id: record.id,
      title: record.title,
      selected_angle: record.selectedAngle,
      family_label: record.familyLabel,
      scope_label: record.scopeLabel,
      core_conflict: record.coreConflict,
      stakes: record.stakes ?? "",
      strong_scene: record.strongScene,
      packaging_seed: record.packagingSeed,
      must_include_beats: record.mustIncludeBeatsJson as string[],
      forbidden_expansions: record.forbiddenExpansionsJson as string[],
      risk_hints: record.riskHintsJson as string[],
      source_anchor_refs: record.sourceAnchorRefsJson as string[],
      canonical_quotes: record.canonicalQuotesJson,
      canonical_quote_intents: record.canonicalQuoteIntentsJson as Array<{ quote: string; intent: string }>,
      ambiguity_notes: record.ambiguityNotesJson as string[],
      duration_band: typeof record.durationBandJson.label === "string"
        ? (record.durationBandJson.label as string) : "medium",
      narrative_tension_map: record.narrativeTensionMapJson as {
        hook_claim: string; pressure_escalation: string;
        mid_reveal: string; peak_payoff: string; ending_residue: string;
      },
      source_mode: record.sourceMode ?? "recommended",
      source_ref: record.sourceRefJson ?? null,
    };

    const bundle = buildScriptInputBundle({
      topicPackage,
      eventIdentity: record.eventRegistryEntryId ?? record.id,
      topicDeliveryPack: {
        hook_claim: "hook",
        hook_emotion: "压迫",
        reveal_position: "mid" as const,
        opening_move: "question",
        opening_pressure_level: "high",
        voice_tilt: "sharper",
        pacing_tilt: "neutral",
        ending_tilt: "judgment",
        visual_tilt: ["faces"],
        caution_notes: [],
      },
      projectStylePack: {
        narrator_persona: "冷静",
        wording_register: "sharp",
        subtitle_profile: "dense",
        cover_profile: "faces",
        title_profile: "conflict_first",
        pacing_baseline: "tight",
        risk_posture: "controlled",
      },
      familyBiasPack: {
        family_label: "test",
        opening_pressure_bias: "high",
        exposition_budget: "low",
        pacing_bias: "fast",
        voice_bias: "sharper",
        anti_patterns: [],
      },
    });

    expect(bundle.topic_package.source_mode).toBe("library");
    expect(bundle.topic_package.source_ref).toEqual({ eventLibraryEntryId: "entry-bundle", angleId: "angle-b" });
    // hard_lane 仍不包含 source 元数据
    expect(Object.keys(bundle.hard_lane)).not.toContain("source_mode");
    expect(Object.keys(bundle.hard_lane)).not.toContain("source_ref");
  });
});

describe("confirm HTTP route — sourceMode 校验", () => {
  it("accepts confirm without sourceMode (向后兼容)", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const auth = createAuthenticatedAuthContext({
      userId: "u-confirm", username: "u-confirm", displayName: "U", role: "ADMIN", sessionId: "s",
    });

    const p = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Confirm Compat" },
      auth,
    });
    const projectId = p.json().project_id as string;

    const rec = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "测试事件",
        summary: "测试摘要足够长用于通过校验",
        core_conflict: "核心冲突描述",
        strong_scene: "强场景描述",
        source_hint: "test",
        recent_usage_hint: "new",
        tags: ["test"],
      },
      auth,
    });
    const candidateId = rec.json().candidates[0].candidate_id as string;

    const r = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
      payload: { confirm_reason: "user_selected" },
      auth,
    });

    expect(r.statusCode).toBe(200);
  });

  it("rejects invalid sourceMode value", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const auth = createAuthenticatedAuthContext({
      userId: "u-confirm2", username: "u-confirm2", displayName: "U2", role: "ADMIN", sessionId: "s",
    });

    const p = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Confirm Invalid Mode" },
      auth,
    });
    const projectId = p.json().project_id as string;

    const rec = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "测试事件2",
        summary: "测试摘要足够长用于通过校验",
        core_conflict: "核心冲突描述",
        strong_scene: "强场景描述",
        source_hint: "test",
        recent_usage_hint: "new",
        tags: ["test"],
      },
      auth,
    });
    const candidateId = rec.json().candidates[0].candidate_id as string;

    const r = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
      payload: { confirm_reason: "user_selected", sourceMode: "invalid" },
      auth,
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("invalid_source_mode");
  });

  it("rejects sourceMode mismatch with candidate's actual source", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const auth = createAuthenticatedAuthContext({
      userId: "u-confirm3", username: "u-confirm3", displayName: "U3", role: "ADMIN", sessionId: "s",
    });

    const p = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Confirm Mismatch" },
      auth,
    });
    const projectId = p.json().project_id as string;

    const rec = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "测试事件3",
        summary: "测试摘要足够长用于通过校验",
        core_conflict: "核心冲突描述",
        strong_scene: "强场景描述",
        source_hint: "test",
        recent_usage_hint: "new",
        tags: ["test"],
      },
      auth,
    });
    const candidateId = rec.json().candidates[0].candidate_id as string;

    // recommended 的 candidate，传 custom → 不匹配
    const r = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
      payload: { confirm_reason: "user_selected", sourceMode: "custom" },
      auth,
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("source_mode_mismatch");
  });

  it("rejects sourceRef mismatch (recommended candidate has null sourceRef)", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const auth = createAuthenticatedAuthContext({
      userId: "u-confirm4", username: "u-confirm4", displayName: "U4", role: "ADMIN", sessionId: "s",
    });

    const p = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Confirm Ref Mismatch" },
      auth,
    });
    const projectId = p.json().project_id as string;

    const rec = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "测试事件4",
        summary: "测试摘要足够长用于通过校验",
        core_conflict: "核心冲突描述",
        strong_scene: "强场景描述",
        source_hint: "test",
        recent_usage_hint: "new",
        tags: ["test"],
      },
      auth,
    });
    const candidateId = rec.json().candidates[0].candidate_id as string;

    // recommended candidate 的 sourceRef 为 null，传入非 null sourceRef → 不匹配
    const r = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
      payload: { confirm_reason: "user_selected", sourceRef: { eventLibraryEntryId: "x" } },
      auth,
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("source_ref_mismatch");
  });

  it("accepts sourceRef with different field order (order-insensitive comparison)", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const auth = createAuthenticatedAuthContext({
      userId: "u-confirm5", username: "u-confirm5", displayName: "U5", role: "ADMIN", sessionId: "s",
    });

    const p = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Confirm Ref Order" },
      auth,
    });
    const projectId = p.json().project_id as string;

    const candidateId = randomUUID();
    const storedCandidate: StoredTopicCandidate = {
      candidateId,
      projectId,
      event: { id: "ev-lib-order", canonicalName: "顺序测试", aliasesJson: [], canonicalQuotesJson: [], canonicalQuoteIntentsJson: [] },
      title: "顺序测试",
      oneLineAngle: "测试角度",
      familyLabel: "测试类型",
      scopeLabel: "单事件",
      coreConflict: "核心冲突",
      strongScene: "强场面",
      mustCoverPreview: ["节拍1", "节拍2", "节拍3"],
      sourceHint: "test",
      recentUsageHint: "new",
      whyThisNow: "now",
      riskHints: [],
      viralRubric: {},
      sourceMode: "library",
      sourceRef: { eventLibraryEntryId: "entry-order", angleId: "angle-order" },
    };

    const state = app.topicCandidateStore.get(projectId) ?? {
      candidatesById: new Map<string, StoredTopicCandidate>(),
      rounds: [],
    };
    state.candidatesById.set(candidateId, storedCandidate);
    app.topicCandidateStore.set(projectId, state);

    // confirm 传 sourceRef 时字段顺序与存储不同 → 应 200
    const r = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
      payload: {
        confirm_reason: "user_selected",
        sourceMode: "library",
        sourceRef: { angleId: "angle-order", eventLibraryEntryId: "entry-order" },
      },
      auth,
    });

    expect(r.statusCode).toBe(200);
  });
});
