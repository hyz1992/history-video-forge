import { describe, expect, it } from "vitest";

import {
  buildCharacterSheetRows,
  sheetReferenceLabel,
  sheetUploadAcceptTypes,
  characterSheetStateLabel,
  characterSheetStateTagType,
  countReadyCharacterSheets,
  resolveCharacterSheetState,
} from "../../../frontend/src/utils/asset-sheets.js";

function task(overrides: Partial<Parameters<typeof buildCharacterSheetRows>[0]["tasks"][number]> = {}) {
  return {
    task_id: "sheet_001",
    task_type: "character_sheet",
    parameters: {
      character_label: "李世民",
      segment_hit_count: 8,
      matched_segment_ids: ["sb_001", "sb_002"],
    },
    manual_upload_policy: { accepted_file_types: ["image/png", "image/jpeg"] },
    ...overrides,
  };
}

function build(input: {
  tasks?: ReturnType<typeof task>[];
  executions?: Array<[string, { status: string; output_artifact_ids?: string[]; notes?: string[] }]>;
  artifactIds?: string[];
}) {
  return buildCharacterSheetRows({
    tasks: (input.tasks ?? [task()]) as never,
    executionsByTaskId: new Map(input.executions ?? []) as never,
    artifactsById: new Map(
      (input.artifactIds ?? []).map((id) => [id, { artifact_id: id }]),
    ) as never,
  });
}

describe("buildCharacterSheetRows", () => {
  it("只收 character_sheet 任务，并读出角色名/命中段数/命中段", () => {
    const rows = build({
      tasks: [
        task(),
        { task_id: "img_s000_01", task_type: "image_still", parameters: {}, manual_upload_policy: null },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskId: "sheet_001",
      label: "李世民",
      hitCount: 8,
      matchedSegmentIds: ["sb_001", "sb_002"],
      acceptedFileTypes: ["image/png", "image/jpeg"],
    });
  });

  it("已完成且有产物 → ready 且带可预览 artifactId", () => {
    const rows = build({
      executions: [["sheet_001", { status: "completed", output_artifact_ids: ["artifact_sheet_1"], notes: ["dashscope image generated"] }]],
      artifactIds: ["artifact_sheet_1"],
    });
    expect(rows[0]).toMatchObject({ state: "ready", artifactId: "artifact_sheet_1" });
    expect(characterSheetStateLabel(rows[0]!.state, true)).toBe("已完成");
  });

  it("completed 但产物不在 manifest 里 → 仍 ready 但 artifactId 为空（文案区分“产物缺失”）", () => {
    const rows = build({
      executions: [["sheet_001", { status: "completed", output_artifact_ids: ["artifact_missing"] }]],
      artifactIds: [],
    });
    expect(rows[0]).toMatchObject({ state: "ready", artifactId: null });
    expect(characterSheetStateLabel(rows[0]!.state, false)).toBe("产物缺失");
  });

  it("降级跳过：保留引擎 note 原样透出，状态为 degraded", () => {
    const note = "[sheet] 冻结模型 wan2.6-t2i 不具备参考图能力，未生成该角色 sheet（零计费）";
    const rows = build({
      executions: [["sheet_001", { status: "skipped_with_fallback", notes: [note] }]],
    });
    expect(rows[0]).toMatchObject({ state: "degraded", artifactId: null, notes: [note] });
    expect(characterSheetStateLabel(rows[0]!.state, false)).toBe("已降级跳过");
  });

  it("失败 / 生成中 / 待生成（无 execution）三态各自可辨", () => {
    const failed = build({ executions: [["sheet_001", { status: "failed", notes: ["boom"] }]] });
    const running = build({ executions: [["sheet_001", { status: "running" }]] });
    const planned = build({ tasks: [task({ task_id: "sheet_002" as never })] });
    expect(failed[0]!.state).toBe("failed");
    expect(running[0]!.state).toBe("generating");
    expect(planned[0]!.state).toBe("pending");
    expect(characterSheetStateTagType("failed")).toBe("danger");
    expect(characterSheetStateTagType("pending")).toBe("warning");
  });

  it("缺 character_label 时回退 task_id；缺 accepted_file_types 时回退 png/jpeg", () => {
    const rows = build({
      tasks: [task({ parameters: {} as never, manual_upload_policy: null as never })],
    });
    expect(rows[0]).toMatchObject({ label: "sheet_001", hitCount: null, acceptedFileTypes: ["image/png", "image/jpeg"] });
  });

  it("完成计数只统计有可预览产物的行", () => {
    const rows = build({
      tasks: [task(), task({ task_id: "sheet_002" as never })],
      executions: [
        ["sheet_001", { status: "completed", output_artifact_ids: ["a1"] }],
        ["sheet_002", { status: "skipped_with_fallback", notes: ["x"] }],
      ],
      artifactIds: ["a1"],
    });
    expect(countReadyCharacterSheets(rows)).toBe(1);
  });

  it("无 sheet 任务时返回空数组（legacy 项目零变化的前提）", () => {
    expect(build({ tasks: [{ task_id: "img_1", task_type: "image_still", parameters: {}, manual_upload_policy: null }] })).toEqual([]);
    expect(resolveCharacterSheetState("")).toBe("pending");
  });
});

describe("sheetUploadAcceptTypes", () => {
  it("取各任务 accepted_file_types 的并集（覆盖策略差异，真实校验仍在后端）", () => {
    const rows = build({
      tasks: [
        task(),
        task({ task_id: "sheet_002" as never, manual_upload_policy: { accepted_file_types: ["image/webp"] } as never }),
      ],
    });
    expect(sheetUploadAcceptTypes(rows)).toBe("image/png,image/jpeg,image/webp");
  });

  it("无 sheet 任务时返回空串（分区不渲染，input 也不会被触发）", () => {
    expect(sheetUploadAcceptTypes([])).toBe("");
  });
});

describe("sheetReferenceLabel（T3 分镜卡片注入标记）", () => {
  const sheets = new Map([
    ["sheet_001", { label: "李世民", artifactId: "artifact_a" }],
    ["sheet_002", { label: "李建成", artifactId: null }],
  ]);

  it("有引用且产物齐备", () => {
    expect(sheetReferenceLabel({ parameters: { character_sheet_task_ids: ["sheet_001"] }, sheetsByTaskId: sheets }))
      .toBe("参考：李世民");
  });

  it("多角色按任务顺序拼接", () => {
    expect(sheetReferenceLabel({ parameters: { character_sheet_task_ids: ["sheet_001", "sheet_002"] }, sheetsByTaskId: sheets }))
      .toBe("参考：李世民、李建成（未生成）");
  });

  it("未生成时显式标注（避免误以为已注入）", () => {
    expect(sheetReferenceLabel({ parameters: { character_sheet_task_ids: ["sheet_002"] }, sheetsByTaskId: sheets }))
      .toBe("参考：李建成（未生成）");
  });

  it("参数缺失、非数组或空数组时说明未配置参考", () => {
    expect(sheetReferenceLabel({ parameters: {}, sheetsByTaskId: sheets })).toBe("未配置角色定妆图参考");
    expect(sheetReferenceLabel({ parameters: null, sheetsByTaskId: sheets })).toBe("未配置角色定妆图参考");
    expect(sheetReferenceLabel({ parameters: { character_sheet_task_ids: "sheet_001" }, sheetsByTaskId: sheets }))
      .toBe("未配置角色定妆图参考");
    expect(sheetReferenceLabel({ parameters: { character_sheet_task_ids: [] }, sheetsByTaskId: sheets }))
      .toBe("未配置角色定妆图参考");
  });

  it("引用到未知定妆图任务时不静默", () => {
    expect(sheetReferenceLabel({ parameters: { character_sheet_task_ids: ["sheet_999"] }, sheetsByTaskId: sheets }))
      .toBe("参考：sheet_999（未知定妆图任务）");
  });
});
