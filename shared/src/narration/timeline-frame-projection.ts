/** 同一绝对端点只取整一次，禁止逐段累计帧数。 */
export function projectNarrationFrameRange(input: {
    startMs: number;
    endMs: number;
    fps: number;
}): {
    from: number;
    durationInFrames: number;
} {
    const { startMs, endMs, fps } = input;
    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs <= startMs || !Number.isFinite(fps) || fps <= 0)
        throw new Error('narration_frame_range_invalid');
    const from = Math.round(startMs * fps / 1000), end = Math.round(endMs * fps / 1000);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(end))
        throw new Error('narration_frame_range_invalid');
    if (end <= from)
        throw new Error('narration_zero_frame_interval');
    return { from, durationInFrames: end - from };
}
