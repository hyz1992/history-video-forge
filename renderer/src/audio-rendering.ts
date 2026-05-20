export function getAudioSequenceFrames(input: {
  startSec: number;
  durationSec: number;
  fps: number;
}) {
  return {
    from: Math.max(0, Math.round(input.startSec * input.fps)),
    durationInFrames: Math.max(1, Math.round(input.durationSec * input.fps)),
  };
}

export function normalizeAudioVolume(volume: number) {
  return Math.min(1, Math.max(0, volume));
}

export function getFadedAudioVolume(input: {
  baseVolume: number;
  localSec: number;
  durationSec: number;
  fadeInSec?: number;
  fadeOutSec?: number;
}) {
  const base = normalizeAudioVolume(input.baseVolume);
  const fadeIn = Math.max(0, input.fadeInSec ?? 0);
  const fadeOut = Math.max(0, input.fadeOutSec ?? 0);
  const inFactor =
    fadeIn > 0 ? Math.min(1, Math.max(0, input.localSec / fadeIn)) : 1;
  const remainingSec = input.durationSec - input.localSec;
  const outFactor =
    fadeOut > 0 ? Math.min(1, Math.max(0, remainingSec / fadeOut)) : 1;

  return base * Math.min(inFactor, outFactor);
}

export function getAudioLoopSequences(input: {
  clipDurationSec: number;
  sourceDurationSec?: number;
}) {
  const clipDurationSec = Math.max(0, input.clipDurationSec);
  const sourceDurationSec =
    input.sourceDurationSec && input.sourceDurationSec > 0
      ? input.sourceDurationSec
      : clipDurationSec;
  const sequences: Array<{ offsetSec: number; durationSec: number }> = [];

  if (clipDurationSec <= 0 || sourceDurationSec <= 0) {
    return sequences;
  }

  for (
    let offsetSec = 0;
    offsetSec < clipDurationSec;
    offsetSec += sourceDurationSec
  ) {
    const durationSec = Math.min(sourceDurationSec, clipDurationSec - offsetSec);
    if (durationSec > 0) {
      sequences.push({ offsetSec, durationSec });
    }
  }

  return sequences;
}
