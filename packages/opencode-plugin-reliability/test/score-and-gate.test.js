import test from 'node:test';
import assert from 'node:assert/strict';

import { classifySoftGate, computeReliabilityScore } from '../src/index.js';

test('computeReliabilityScore penalizes false positives and false negatives', () => {
  const result = computeReliabilityScore({
    counts: { tp: 3, fp: 1, fn: 2, ignored: 0 },
    acpSmokePassed: true,
    hardStopRespected: true,
  });

  assert.equal(result.total < 80, true);
  assert.equal(result.components.falsePositiveControl <= 65, true);
  assert.equal(result.components.missedContinuationControl <= 30, true);
});

test('classifySoftGate fails on strong regression and warns on mild regression', () => {
  const failResult = classifySoftGate({
    currentScore: 61,
    baselineScore: 80,
    acpSmokePassed: true,
  });

  assert.equal(failResult.verdict, 'fail');
  assert.equal(failResult.reasonCodes.includes('GATE_STRONG_REGRESSION'), true);

  const warnResult = classifySoftGate({
    currentScore: 78,
    baselineScore: 80,
    acpSmokePassed: true,
  });

  assert.equal(warnResult.verdict, 'warn');
  assert.equal(warnResult.reasonCodes.includes('GATE_MILD_REGRESSION'), true);
});

test('classifySoftGate fails closed on ACP smoke failure', () => {
  const result = classifySoftGate({
    currentScore: 99,
    baselineScore: 80,
    acpSmokePassed: false,
  });

  assert.equal(result.verdict, 'fail');
  assert.equal(result.reasonCodes.includes('ACP_SMOKE_FAILED'), true);
});
