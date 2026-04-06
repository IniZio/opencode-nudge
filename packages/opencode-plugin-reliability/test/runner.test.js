import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import {
  compareRuns,
  createReliabilityRunner,
  runReliabilitySuite,
} from '../src/index.js';

test('runReliabilitySuite orchestrates normalize -> label -> score -> policy', async () => {
  const calls = [];
  const profile = {
    normalize(input) {
      calls.push('normalize');
      return input.events;
    },
    label(events) {
      calls.push('label');
      return {
        events,
        counts: { tp: 2, fp: 0, fn: 1, ignored: 0 },
        reasonCodes: ['post_no_nudge_user_prompt_to_continue'],
      };
    },
    score(labels) {
      calls.push('score');
      return { total: 76, components: { continuationSuccess: 67 }, labels };
    },
    policy(context) {
      calls.push('policy');
      return { action: 'tighten_patterns', context };
    },
  };

  const result = await runReliabilitySuite({
    profile,
    inputs: {
      events: [{ role: 'assistant', text: 'Would you like me to continue?' }],
    },
    context: { acpSmokePassed: true },
  });

  assert.deepEqual(calls, ['normalize', 'label', 'score', 'policy']);
  assert.equal(result.score.total, 76);
  assert.equal(result.labels.counts.fn, 1);
  assert.equal(result.policy.action, 'tighten_patterns');
});

test('createReliabilityRunner returns reusable runner bound to profile', async () => {
  const profile = {
    normalize(input) {
      return input.events;
    },
    label() {
      return { counts: { tp: 1, fp: 0, fn: 0, ignored: 0 }, reasonCodes: [] };
    },
    score() {
      return { total: 90, components: { continuationSuccess: 100 } };
    },
  };

  const runner = createReliabilityRunner({ profile });
  const result = await runner.run({ events: [{ role: 'assistant', text: 'done' }] });
  assert.equal(result.score.total, 90);
});

test('compareRuns classifies regressions and deltas', () => {
  const comparison = compareRuns({
    current: { total: 64 },
    baseline: { total: 80 },
    thresholds: { strongRegression: 12, mildRegression: 1 },
  });

  assert.equal(comparison.delta, -16);
  assert.equal(comparison.classification, 'strong_regression');
});

test('reliability-loop script requires --export argument', () => {
  const result = spawnSync(process.execPath, ['scripts/reliability-loop.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--export is required/);
});
