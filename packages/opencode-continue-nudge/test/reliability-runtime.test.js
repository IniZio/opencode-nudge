import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createReliabilityRuntime,
  resolveReliabilityRuntimeOptions,
} from '../src/reliability-runtime.js';

test('resolveReliabilityRuntimeOptions defaults to shadow mode', () => {
  const resolved = resolveReliabilityRuntimeOptions();
  assert.deepEqual(resolved, {
    enabled: false,
    mode: 'shadow',
    artifactRoot: '.opencode/reliability',
    flushOnSessionEnd: true,
    strongRegressionThreshold: 12,
    mildRegressionThreshold: 1,
  });
});

test('shadow mode writes artifacts and does not block nudge decisions', async () => {
  const writes = [];
  const runtime = createReliabilityRuntime({
    options: { enabled: true, mode: 'shadow' },
    scorer: async () => ({
      events: [{ role: 'assistant', text: 'Would you like me to continue?' }],
      labels: { counts: { tp: 1, fp: 0, fn: 0 }, reasonCodes: [] },
      score: { total: 91 },
      policy: { actions: ['keep_current_configuration'] },
    }),
    writer: async (payload) => {
      writes.push(payload);
      return {
        runDir: '/tmp/run-dir',
        scoreboardPath: '/tmp/scoreboard.json',
      };
    },
    gate: () => ({ verdict: 'pass', reasonCodes: ['GATE_PASS'], delta: 0 }),
    now: () => new Date('2026-04-06T00:00:00.000Z'),
  });

  const decision = await runtime.evaluateNudgeDecision({
    sessionId: 's1',
    shouldNudge: true,
    events: [],
  });
  assert.equal(decision.shouldNudge, true);
  assert.equal(decision.reason, 'shadow_or_disabled');

  const flush = await runtime.flushSession({
    sessionId: 's1',
    events: [{ info: { role: 'assistant', id: 'a1' }, parts: [{ type: 'text', text: 'Would you like me to continue?' }] }],
    context: {},
  });

  assert.equal(flush.wroteArtifacts, true);
  assert.equal(flush.verdict, 'pass');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].runId, '2026-04-06T00-00-00-000Z-s1');
});

test('enforce mode can block nudge decisions from policy actions', async () => {
  const runtime = createReliabilityRuntime({
    options: { enabled: true, mode: 'enforce' },
    scorer: async () => ({
      events: [],
      labels: { counts: { tp: 0, fp: 1, fn: 0 }, reasonCodes: ['post_nudge_user_correction'] },
      score: { total: 50 },
      policy: { actions: ['reduce_nudge_aggressiveness'] },
    }),
    writer: async () => ({ runDir: '/tmp/run-dir', scoreboardPath: '/tmp/scoreboard.json' }),
    gate: () => ({ verdict: 'warn', reasonCodes: ['GATE_MILD_REGRESSION'], delta: -2 }),
  });

  const decision = await runtime.evaluateNudgeDecision({
    sessionId: 's2',
    shouldNudge: true,
    events: [{ role: 'assistant', text: 'Would you like me to continue?' }],
    context: {},
  });

  assert.equal(decision.shouldNudge, false);
  assert.equal(decision.reason, 'reduce_nudge_aggressiveness');
});

test('flushSession fails open when scorer throws', async () => {
  const runtime = createReliabilityRuntime({
    options: { enabled: true, mode: 'shadow' },
    scorer: async () => {
      throw new Error('boom');
    },
    writer: async () => ({ runDir: '/tmp/run-dir', scoreboardPath: '/tmp/scoreboard.json' }),
    gate: () => ({ verdict: 'pass', reasonCodes: ['GATE_PASS'], delta: 0 }),
  });

  const result = await runtime.flushSession({
    sessionId: 's3',
    events: [{ role: 'assistant', text: 'Would you like me to continue?' }],
    context: {},
  });

  assert.equal(result.wroteArtifacts, false);
  assert.equal(result.reason, 'flush_error');
});
