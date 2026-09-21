const TASK_TYPE_TO_PROVIDER_TYPE: Record<string, string | null> = {
  image_still: "image",
  // 角色 sheet 是图片任务：缺此映射时 taskTypeToProviderType 返回 null，
  // isProviderTypeEnabled 对未知类型放行（fail-open），sheet 会绕过
  // "provider 类型未启用 → 转人工上传"语义（设计 §3.7 第 3 项）。
  character_sheet: "image",
  video_clip: "video",
  tts_audio: "tts",
  subtitle_track: "tts",
  sfx_cue: "sfx",
  bgm_cue: "bgm",
  render_motion_cue: null,
};

export function taskTypeToProviderType(
  taskType: string,
): string | null {
  return TASK_TYPE_TO_PROVIDER_TYPE[taskType] ?? null;
}

export function isProviderTypeEnabled(
  taskType: string,
  enabledProviderTypes: string[] | undefined,
): boolean {
  if (enabledProviderTypes === undefined) return true;
  const providerType = taskTypeToProviderType(taskType);
  if (providerType === null) return true;
  return enabledProviderTypes.includes(providerType);
}
