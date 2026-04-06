export function classifySoftGate({
  currentScore,
  baselineScore,
  acpSmokePassed,
  strongRegressionThreshold = 12,
  mildRegressionThreshold = 1,
}) {
  const reasonCodes = [];

  if (!acpSmokePassed) {
    reasonCodes.push('ACP_SMOKE_FAILED');
    return {
      verdict: 'fail',
      reasonCodes,
      delta: null,
    };
  }

  if (typeof baselineScore !== 'number' || Number.isNaN(baselineScore)) {
    reasonCodes.push('BASELINE_MISSING');
    return {
      verdict: 'warn',
      reasonCodes,
      delta: null,
    };
  }

  const delta = Number(currentScore) - baselineScore;
  if (delta <= -Math.abs(strongRegressionThreshold)) {
    reasonCodes.push('GATE_STRONG_REGRESSION');
    return {
      verdict: 'fail',
      reasonCodes,
      delta,
    };
  }

  if (delta <= -Math.abs(mildRegressionThreshold)) {
    reasonCodes.push('GATE_MILD_REGRESSION');
    return {
      verdict: 'warn',
      reasonCodes,
      delta,
    };
  }

  reasonCodes.push('GATE_PASS');
  return {
    verdict: 'pass',
    reasonCodes,
    delta,
  };
}
