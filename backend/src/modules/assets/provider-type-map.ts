const TASK_TYPE_TO_PROVIDER_TYPE: Record<string, string | null> = {
  image_still: "image",
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
