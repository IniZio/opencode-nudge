function toSafeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.floor(count);
}

export function computeReliabilityScore({ counts = {}, acpSmokePassed = true, hardStopRespected = true }) {
  const tp = toSafeCount(counts.tp);
  const fp = toSafeCount(counts.fp);
  const fn = toSafeCount(counts.fn);

  const denominator = Math.max(tp + fp + fn, 1);

  const continuationSuccess = Math.round((tp / denominator) * 100);
  const falsePositiveControl = Math.max(0, 100 - fp * 35);
  const hardStopRespect = hardStopRespected ? 100 : 50;
  const acpSmoke = acpSmokePassed ? 100 : 0;
  const missedContinuationControl = Math.max(0, 100 - fn * 35);

  const total = Math.round(
    continuationSuccess * 0.35 +
      falsePositiveControl * 0.25 +
      hardStopRespect * 0.15 +
      acpSmoke * 0.15 +
      missedContinuationControl * 0.1,
  );

  return {
    total,
    components: {
      continuationSuccess,
      falsePositiveControl,
      hardStopRespect,
      acpSmoke,
      missedContinuationControl,
    },
  };
}
