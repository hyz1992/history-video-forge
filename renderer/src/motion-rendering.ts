export function makeMotionTransform(input: {
  recipeType: string;
  progress: number;
  parameters: Record<string, unknown>;
}): string {
  const progress = clamp(input.progress, 0, 1);
  const distancePct = readNumber(input.parameters.distance_pct, 4);

  if (input.recipeType === "hold") {
    return "scale(1) translate3d(0%, 0%, 0)";
  }
  if (input.recipeType === "zoom_out") {
    return `scale(${format(1.06 - 0.06 * progress)}) translate3d(0%, 0%, 0)`;
  }
  if (
    input.recipeType === "zoom_in" ||
    input.recipeType === "push_in" ||
    input.recipeType === "slow_push_in"
  ) {
    return `scale(${format(1 + 0.06 * progress)}) translate3d(0%, 0%, 0)`;
  }
  if (input.recipeType === "pan_left") {
    return `scale(1.04) translate3d(${format(-distancePct * progress)}%, 0%, 0)`;
  }
  if (input.recipeType === "pan_right") {
    return `scale(1.04) translate3d(${format(distancePct * progress)}%, 0%, 0)`;
  }
  if (input.recipeType === "pan_up") {
    return `scale(1.04) translate3d(0%, ${format(-distancePct * progress)}%, 0)`;
  }
  if (input.recipeType === "pan_down") {
    return `scale(1.04) translate3d(0%, ${format(distancePct * progress)}%, 0)`;
  }

  return `scale(${format(1 + 0.04 * progress)}) translate3d(0%, 0%, 0)`;
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function format(value: number) {
  return Number(value.toFixed(4)).toString();
}
