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
