import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildSemanticCheckPrompt,
  buildQuestionAutoAnswer,
  buildContinuationPrompt,
  buildSystemReminder,
  compilePattern,
  compilePatternList,
  CONTINUATION_NUDGE_MARKER,
  createContinueNudgeRuntime,
  DEFAULT_PRESET,
  extractTextFromParts,
  loadContinueNudgeConfig,
  normalizeText,
  PRESET_OPTIONS,
  resolveSemanticFallbackOptions,
  resolveContinueNudgeOptions,
  SEMANTIC_CHECK_MARKER,
  shouldNudge,
  SYSTEM_REMINDER_MARKER,
} from '../src/continue-nudge-plugin.js';

function createMockClient(messagesBySession = {}) {
  const promptCalls = [];
  const logCalls = [];
  const questionReplyCalls = [];
  const questionRejectCalls = [];

  return {
    promptCalls,
    logCalls,
    questionReplyCalls,
    questionRejectCalls,
    client: {
      session: {
        async prompt(payload) {
          promptCalls.push(payload);
          return { data: { ok: true } };
        },
        async messages({ path }) {
          return { data: messagesBySession[path.id] || [] };
        },
      },
      question: {
        async reply(payload) {
          questionReplyCalls.push(payload);
          return { data: { ok: true } };
        },
        async reject(payload) {
          questionRejectCalls.push(payload);
          return { data: { ok: true } };
        },
      },
      app: {
        async log(payload) {
          logCalls.push(payload);
        },
      },
    },
  };
}

function textMessage(role, text, id) {
  return {
    info: { id, role },
    parts: [{ type: 'text', text }],
  };
}

test('package entrypoint re-exports the plugin helpers', async () => {
  const mod = await import('../index.js');
  assert.equal(typeof mod.createContinueNudgePlugin, 'function');
  assert.equal(typeof mod.loadContinueNudgeConfig, 'function');
});

test('normalizeText preserves zero and false inputs', () => {
  assert.equal(normalizeText(0), '0');
  assert.equal(normalizeText(false), 'false');
});

test('extractTextFromParts joins text-like parts', () => {
  assert.equal(
    extractTextFromParts([
      { type: 'text', text: 'first' },
      { type: 'output', content: 'second' },
    ]),
    'first second',
  );
});

test('compilePattern supports strings and objects', () => {
  assert.equal(compilePattern('continue\\?').test('Continue?'), true);
  assert.equal(compilePattern({ source: 'STOP', flags: 'i' }).test('stop'), true);
});

test('compilePatternList falls back when no overrides are provided', () => {
  const fallback = [/fallback/i];
  assert.equal(compilePatternList(undefined, fallback), fallback);
});

test('compilePatternList respects an explicit empty override', () => {
  const fallback = [/fallback/i];
  assert.deepEqual(compilePatternList([], fallback), []);
});

test('resolveContinueNudgeOptions uses the default preset', () => {
  const config = resolveContinueNudgeOptions();
  assert.equal(config.preset, DEFAULT_PRESET);
  assert.equal(config.maxNudgesPerSession, PRESET_OPTIONS[DEFAULT_PRESET].maxNudgesPerSession);
  assert.equal(config.semanticFallback.enabled, false);
});

test('resolveSemanticFallbackOptions normalizes invalid numeric values', () => {
  const options = resolveSemanticFallbackOptions({
    enabled: true,
    timeoutMs: 0,
    maxChecksPerSession: -2,
  });
  assert.equal(options.enabled, true);
  assert.equal(options.mode, 'in_session');
  assert.equal(options.timeoutMs, 4000);
  assert.equal(options.maxChecksPerSession, 1);
});

test('resolveSemanticFallbackOptions keeps supported out_of_band mode', () => {
  const options = resolveSemanticFallbackOptions({ enabled: true, mode: 'out_of_band' });
  assert.equal(options.mode, 'out_of_band');
});

test('resolveContinueNudgeOptions treats null max nudges as unlimited', () => {
  assert.equal(
    resolveContinueNudgeOptions({ maxNudgesPerSession: null }).maxNudgesPerSession,
    Number.POSITIVE_INFINITY,
  );
});

test('resolveContinueNudgeOptions applies conservative and aggressive presets', () => {
  assert.equal(resolveContinueNudgeOptions({ preset: 'conservative' }).maxNudgesPerSession, 1);
  assert.equal(resolveContinueNudgeOptions({ preset: 'aggressive' }).maxNudgesPerSession, 3);
});

test('resolveContinueNudgeOptions rejects unknown presets', () => {
  assert.throws(() => resolveContinueNudgeOptions({ preset: 'wild' }), /Unknown continue-nudge preset/);
});

test('loadContinueNudgeConfig returns defaults when file is missing', async () => {
  const config = await loadContinueNudgeConfig(join(tmpdir(), 'missing-continue-nudge.json'));
  assert.equal(config.preset, DEFAULT_PRESET);
  assert.equal(config.maxNudgesPerSession, PRESET_OPTIONS[DEFAULT_PRESET].maxNudgesPerSession);
});

test('loadContinueNudgeConfig compiles configured regexes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'continue-nudge-'));
  const configPath = join(dir, 'continue-nudge.json');
  await writeFile(
    configPath,
    JSON.stringify({
      preset: 'conservative',
      maxNudgesPerSession: 4,
      permissionSeekingPatterns: ['continue\\?'],
      hardStopPatterns: [{ source: 'BLOCKED', flags: 'i' }],
      userOptOutPatterns: ['ask me first'],
      semanticFallback: {
        enabled: true,
        model: 'github-copilot/gpt-5.1-codex-mini',
        mode: 'out_of_band',
        timeoutMs: 2500,
        maxChecksPerSession: 2,
      },
    }),
  );

  const config = await loadContinueNudgeConfig(configPath);
  assert.equal(config.preset, 'conservative');
  assert.equal(config.maxNudgesPerSession, 4);
  assert.equal(config.permissionSeekingPatterns[0].test('continue?'), true);
  assert.equal(config.hardStopPatterns[0].test('blocked'), true);
  assert.equal(config.userOptOutPatterns[0].test('ask me first'), true);
  assert.equal(config.semanticFallback.enabled, true);
  assert.equal(config.semanticFallback.model, 'github-copilot/gpt-5.1-codex-mini');
  assert.equal(config.semanticFallback.mode, 'out_of_band');
  assert.equal(config.semanticFallback.timeoutMs, 2500);
  assert.equal(config.semanticFallback.maxChecksPerSession, 2);
});

test('repository default config enables semantic fallback with small model', async () => {
  const config = await loadContinueNudgeConfig('.opencode/continue-nudge.json');
  assert.equal(config.semanticFallback.enabled, true);
  assert.equal(config.semanticFallback.model, 'github-copilot/gpt-5.1-codex-mini');
  assert.equal(config.semanticFallback.mode, 'in_session');
  assert.equal(config.semanticFallback.timeoutMs, 4000);
  assert.equal(config.semanticFallback.maxChecksPerSession, 1);
});

test('shouldNudge returns true for permission-seeking language', () => {
  assert.equal(
    shouldNudge({ assistantText: 'I finished the scan. Would you like me to implement the fix next?' }),
    true,
  );
});

test('shouldNudge returns false when the user explicitly asked to wait', () => {
  assert.equal(
    shouldNudge({
      assistantText: 'I have a plan. Would you like me to implement it?',
      latestUserText: 'Plan only. Ask me before you implement anything.',
    }),
    false,
  );
});

test('shouldNudge returns false for real blockers', () => {
  assert.equal(
    shouldNudge({ assistantText: 'I cannot proceed because I need your approval to access production.' }),
    false,
  );
});

test('shouldNudge returns false after the same assistant message was already nudged', () => {
  assert.equal(
    shouldNudge({
      assistantText: 'Would you like me to keep going?',
      hasSeenMessage: true,
    }),
    false,
  );
});

test('shouldNudge returns false for a normal completion message', () => {
  assert.equal(
    shouldNudge({ assistantText: 'Implemented the fix, added tests, and everything passes.' }),
    false,
  );
});

test('shouldNudge catches multiple common permission-seeking phrasings', () => {
  const phrases = [
    'Would you like me to implement it now?',
    'Would you prefer the improvement focus on functionality, documentation, or tests?',
    'Do you want me to continue with the fix?',
    'Do you prefer I spend the effort on tests first?',
    'Should I focus the improvement on functionality, tests, or documentation?',
    "Let me know if you'd like me to patch this.",
    'If you want, I can update the README too.',
    "If you want, next I'll implement the remaining handlers.",
    'If you want, next I\u2019ll implement the remaining handlers.',
    'If you want, next I will implement the remaining handlers.',
    'Next I can implement the remaining handlers.',
    'Next concrete step I can do now: implement the remaining handlers.',
    'Next high-value step: implement the remaining handlers.',
    'Natural next steps: 1) add tests 2) wire CI',
    'Next logical step: implement the remaining handlers.',
    "I'll continue with the remaining handlers now.",
    'Want me to add tests too?',
    'What would you like me to tackle next?',
  ];

  for (const assistantText of phrases) {
    assert.equal(shouldNudge({ assistantText }), true, assistantText);
  }
});

test('shouldNudge supports custom pattern overrides', () => {
  assert.equal(
    shouldNudge({
      assistantText: 'Continue?',
      permissionSeekingPatterns: [/continue\?/i],
      hardStopPatterns: [],
      userOptOutPatterns: [],
    }),
    true,
  );
});

test('system reminder and continuation prompt include stable markers', () => {
  assert.match(buildSystemReminder(), new RegExp(SYSTEM_REMINDER_MARKER));
  assert.match(buildContinuationPrompt(), new RegExp(CONTINUATION_NUDGE_MARKER));
  assert.match(buildQuestionAutoAnswer(), new RegExp(CONTINUATION_NUDGE_MARKER));
});

test('buildSemanticCheckPrompt includes marker and context', () => {
  const prompt = buildSemanticCheckPrompt('Next high-value step: add tests.', 'Continue until done.');
  assert.match(prompt, new RegExp(SEMANTIC_CHECK_MARKER));
  assert.match(prompt, /YES or NO/);
  assert.match(prompt, /Latest user message/);
  assert.match(prompt, /Assistant message/);
});

test('session.created primes the session with a hidden reminder', async () => {
  const { client, promptCalls } = createMockClient();
  const runtime = createContinueNudgeRuntime(client);

  await runtime.event({
    event: {
      type: 'session.created',
      properties: { info: { id: 'session-1' } },
    },
  });

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0].path.id, 'session-1');
  assert.equal(promptCalls[0].body.noReply, true);
  assert.match(promptCalls[0].body.parts[0].text, /continue-nudge safety net/i);
});

test('session.created only primes a session once', async () => {
  const { client, promptCalls } = createMockClient();
  const runtime = createContinueNudgeRuntime(client);

  const createdEvent = {
    event: {
      type: 'session.created',
      properties: { info: { id: 'session-1' } },
    },
  };

  await runtime.event(createdEvent);
  await runtime.event(createdEvent);

  assert.equal(promptCalls.length, 1);
});

test('session.idle sends a continuation prompt for a permission-seeking assistant reply', async () => {
  const { client, promptCalls } = createMockClient({
    'session-2': [
      textMessage('user', 'Please fix the issue.', 'user-1'),
      textMessage('assistant', 'I found the problem. Would you like me to implement the fix now?', 'assistant-1'),
    ],
  });
  const runtime = createContinueNudgeRuntime(client);

  await runtime.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-2' },
    },
  });

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0].path.id, 'session-2');
  assert.equal(promptCalls[0].body.noReply, undefined);
  assert.match(promptCalls[0].body.parts[0].text, /continue working now/i);
});

test('semantic fallback nudges ambiguous message when classifier says yes', async () => {
  const { client, promptCalls, logCalls } = createMockClient({
    'session-semantic': [
      textMessage('user', 'Continue until done.', 'user-1'),
      textMessage('assistant', 'Potential follow-up opportunity identified for this task.', 'assistant-1'),
    ],
  });

  const semanticCalls = [];
  const runtime = createContinueNudgeRuntime(client, {
    semanticFallback: { enabled: true, maxChecksPerSession: 2 },
    semanticClassifier: async (payload) => {
      semanticCalls.push(payload);
      return true;
    },
  });

  await runtime.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-semantic' },
    },
  });

  assert.equal(semanticCalls.length, 1);
  assert.equal(promptCalls.length, 1);
  assert.match(promptCalls[0].body.parts[0].text, /continue working now/i);
  assert.equal(runtime._debug.semanticChecksBySession.get('session-semantic'), 1);
  assert.deepEqual(runtime._debug.semanticClassifierStatsBySession.get('session-semantic'), {
    inSession: 1,
    outOfBand: 0,
    fallbackToInSession: 0,
  });
  assert.equal(
    logCalls.some((call) => call?.body?.message === 'Semantic fallback evaluated message'),
    true,
  );
});

test('semantic fallback respects max checks per session', async () => {
  const messagesBySession = {
    'session-semantic-cap': [
      textMessage('user', 'Continue until done.', 'user-1'),
      textMessage('assistant', 'Potential follow-up opportunity identified for this task.', 'assistant-1'),
    ],
  };
  const { client } = createMockClient(messagesBySession);

  let calls = 0;
  const runtime = createContinueNudgeRuntime(client, {
    semanticFallback: { enabled: true, maxChecksPerSession: 1 },
    semanticClassifier: async () => {
      calls += 1;
      return false;
    },
  });

  await runtime.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-semantic-cap' },
    },
  });

  messagesBySession['session-semantic-cap'] = [
    textMessage('user', 'Continue until done.', 'user-1'),
    textMessage('assistant', 'Potential follow-up opportunity identified for this task.', 'assistant-2'),
  ];

  await runtime.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-semantic-cap' },
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(runtime._debug.semanticClassifierStatsBySession.get('session-semantic-cap'), {
    inSession: 1,
    outOfBand: 0,
    fallbackToInSession: 0,
  });
});

test('default semantic fallback classifier uses session prompt and model override', async () => {
  const messagesBySession = {
    'session-semantic-default': [
      textMessage('user', 'Continue until done.', 'user-1'),
      textMessage('assistant', 'Potential follow-up opportunity identified for this task.', 'assistant-1'),
    ],
  };

  const promptCalls = [];
  const client = {
    session: {
      async prompt(payload) {
        promptCalls.push(payload);
        if (payload?.body?.parts?.[0]?.text?.includes(SEMANTIC_CHECK_MARKER)) {
          return { data: { parts: [{ type: 'text', text: 'YES' }] } };
        }
        return { data: { ok: true } };
      },
      async messages({ path }) {
        return { data: messagesBySession[path.id] || [] };
      },
    },
    question: {
      async reply() {
        return { data: { ok: true } };
      },
      async reject() {
        return { data: { ok: true } };
      },
    },
    app: {
      async log() {},
    },
  };

  const runtime = createContinueNudgeRuntime(client, {
    semanticFallback: {
      enabled: true,
      model: 'github-copilot/gpt-5.1-codex-mini',
      timeoutMs: 2000,
      maxChecksPerSession: 1,
    },
  });

  await runtime.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-semantic-default' },
    },
  });

  assert.equal(promptCalls.length, 2);
  assert.match(promptCalls[0].body.parts[0].text, /Classify if this assistant message/);
  assert.equal(promptCalls[0].body.model.providerID, 'github-copilot');
  assert.equal(promptCalls[0].body.model.modelID, 'gpt-5.1-codex-mini');
  assert.equal(promptCalls[0].path.id, 'session-semantic-default');
  assert.match(promptCalls[1].body.parts[0].text, /continue working now/i);
  assert.deepEqual(runtime._debug.semanticClassifierStatsBySession.get('session-semantic-default'), {
    inSession: 1,
    outOfBand: 0,
    fallbackToInSession: 0,
  });
});

test('default semantic fallback classifier supports out-of-band mode', async () => {
  const messagesBySession = {
    'session-semantic-oob': [
      textMessage('user', 'Continue until done.', 'user-1'),
      textMessage('assistant', 'Potential follow-up opportunity identified for this task.', 'assistant-1'),
    ],
  };

  const promptCalls = [];
  const deleteCalls = [];
  const client = {
    session: {
      async create() {
        return { data: { id: 'session-semantic-check-1' } };
      },
      async delete(payload) {
        deleteCalls.push(payload);
        return { data: { ok: true } };
      },
      async prompt(payload) {
        promptCalls.push(payload);
        if (payload?.body?.parts?.[0]?.text?.includes(SEMANTIC_CHECK_MARKER)) {
          return { data: { parts: [{ type: 'text', text: 'YES' }] } };
        }
        return { data: { ok: true } };
      },
      async messages({ path }) {
        return { data: messagesBySession[path.id] || [] };
      },
    },
    question: {
      async reply() {
        return { data: { ok: true } };
      },
      async reject() {
        return { data: { ok: true } };
      },
    },
    app: {
      async log() {},
    },
  };

  const runtime = createContinueNudgeRuntime(client, {
    semanticFallback: {
      enabled: true,
      mode: 'out_of_band',
      model: 'github-copilot/gpt-5.1-codex-mini',
      timeoutMs: 2000,
      maxChecksPerSession: 1,
    },
  });

  await runtime.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-semantic-oob' },
    },
  });

  assert.equal(promptCalls.length, 2);
  assert.equal(promptCalls[0].path.id, 'session-semantic-check-1');
  assert.equal(deleteCalls.length, 1);
  assert.deepEqual(deleteCalls[0], { path: { id: 'session-semantic-check-1' } });
  assert.deepEqual(runtime._debug.semanticClassifierStatsBySession.get('session-semantic-oob'), {
    inSession: 0,
    outOfBand: 1,
    fallbackToInSession: 0,
  });
});

test('semantic fallback tracks fallback-to-in-session metric when out-of-band setup is unavailable', async () => {
  const messagesBySession = {
    'session-semantic-oob-fallback': [
      textMessage('user', 'Continue until done.', 'user-1'),
      textMessage('assistant', 'Potential follow-up opportunity identified for this task.', 'assistant-1'),
    ],
  };

  const promptCalls = [];
  const client = {
    session: {
      async prompt(payload) {
        promptCalls.push(payload);
        if (payload?.body?.parts?.[0]?.text?.includes(SEMANTIC_CHECK_MARKER)) {
          return { data: { parts: [{ type: 'text', text: 'YES' }] } };
        }
        return { data: { ok: true } };
      },
      async messages({ path }) {
        return { data: messagesBySession[path.id] || [] };
      },
    },
    question: {
      async reply() {
        return { data: { ok: true } };
      },
      async reject() {
        return { data: { ok: true } };
      },
    },
    app: {
      async log() {},
    },
  };

  const runtime = createContinueNudgeRuntime(client, {
    semanticFallback: {
      enabled: true,
      mode: 'out_of_band',
      model: 'github-copilot/gpt-5.1-codex-mini',
      timeoutMs: 2000,
      maxChecksPerSession: 1,
    },
  });

  await runtime.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-semantic-oob-fallback' },
    },
  });

  assert.equal(promptCalls.length, 2);
  assert.equal(promptCalls[0].path.id, 'session-semantic-oob-fallback');
  assert.deepEqual(runtime._debug.semanticClassifierStatsBySession.get('session-semantic-oob-fallback'), {
    inSession: 1,
    outOfBand: 0,
    fallbackToInSession: 1,
  });
});

test('aggressive preset catches broader continuation offers', () => {
  const config = resolveContinueNudgeOptions({ preset: 'aggressive' });
  assert.equal(
    shouldNudge({
      assistantText: 'I can patch that next if you want.',
      permissionSeekingPatterns: config.permissionSeekingPatterns,
      hardStopPatterns: config.hardStopPatterns,
      userOptOutPatterns: config.userOptOutPatterns,
      maxNudgesPerSession: config.maxNudgesPerSession,
    }),
    true,
  );
});

test('session.idle does not nudge twice for the same assistant message', async () => {
  const { client, promptCalls } = createMockClient({
    'session-3': [
      textMessage('user', 'Fix it.', 'user-1'),
      textMessage('assistant', 'I traced the bug. Would you like me to patch it?', 'assistant-1'),
    ],
  });
  const runtime = createContinueNudgeRuntime(client);

  const idleEvent = {
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-3' },
    },
  };

  await runtime.event(idleEvent);
  await runtime.event(idleEvent);

  assert.equal(promptCalls.length, 1);
});

test('session.updated re-entry during prompt does not create nudge storms', async () => {
  const messagesBySession = {
    'session-race': [
      textMessage('user', 'Please continue.', 'user-1'),
      textMessage('assistant', 'I found the issue. Would you like me to implement the fix?', 'assistant-1'),
    ],
  };

  const promptCalls = [];
  const logCalls = [];
  let runtime;

  const client = {
    session: {
      async prompt(payload) {
        promptCalls.push(payload);
        if (payload?.body?.parts?.[0]?.text?.includes(CONTINUATION_NUDGE_MARKER)) {
          messagesBySession['session-race'] = [
            ...messagesBySession['session-race'],
            textMessage('user', buildContinuationPrompt(), `plugin-user-${promptCalls.length}`),
          ];
          await runtime.event({
            event: {
              type: 'session.updated',
              properties: { info: { id: 'session-race' } },
            },
          });
        }
        return { data: { ok: true } };
      },
      async messages({ path }) {
        return { data: messagesBySession[path.id] || [] };
      },
    },
    question: {
      async reply() {
        return { data: { ok: true } };
      },
      async reject() {
        return { data: { ok: true } };
      },
    },
    app: {
      async log(payload) {
        logCalls.push(payload);
      },
    },
  };

  runtime = createContinueNudgeRuntime(client, { preset: 'balanced' });

  await runtime.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-race' },
    },
  });

  const continuationPromptCalls = promptCalls.filter((call) =>
    call?.body?.parts?.[0]?.text?.includes(CONTINUATION_NUDGE_MARKER),
  );

  assert.equal(continuationPromptCalls.length, 1);
  assert.equal(runtime._debug.nudgesBySession.get('session-race'), 1);
  assert.equal(
    logCalls.filter((call) => call?.body?.message === 'Sent continuation nudge').length,
    1,
  );
});

test('session.error suppresses nudges until session.updated clears the error', async () => {
  const { client, promptCalls } = createMockClient({
    'session-4': [
      textMessage('user', 'Keep going.', 'user-1'),
      textMessage('assistant', "I can continue if you'd like.", 'assistant-1'),
    ],
  });
  const runtime = createContinueNudgeRuntime(client);

  await runtime.event({
    event: { type: 'session.error', properties: { sessionID: 'session-4' } },
  });
  await runtime.event({
    event: { type: 'session.idle', properties: { sessionID: 'session-4' } },
  });
  assert.equal(promptCalls.length, 0);

  await runtime.event({
    event: { type: 'session.updated', properties: { info: { id: 'session-4' } } },
  });
  await runtime.event({
    event: { type: 'session.idle', properties: { sessionID: 'session-4' } },
  });
  assert.equal(promptCalls.length, 1);
});

test('session.deleted clears error state for the same session ID', async () => {
  const { client, promptCalls } = createMockClient({
    'session-9': [
      textMessage('user', 'Keep going.', 'user-1'),
      textMessage('assistant', 'I can continue if you want.', 'assistant-1'),
    ],
  });
  const runtime = createContinueNudgeRuntime(client);

  await runtime.event({ event: { type: 'session.error', properties: { sessionID: 'session-9' } } });
  await runtime.event({ event: { type: 'session.deleted', properties: { info: { id: 'session-9' } } } });
  await runtime.event({ event: { type: 'session.idle', properties: { sessionID: 'session-9' } } });

  assert.equal(promptCalls.length, 1);
});

test('session.created clears error state for a reused session ID', async () => {
  const { client, promptCalls } = createMockClient({
    'session-10': [
      textMessage('user', 'Keep going.', 'user-1'),
      textMessage('assistant', 'I can continue if you want.', 'assistant-1'),
    ],
  });
  const runtime = createContinueNudgeRuntime(client);

  await runtime.event({ event: { type: 'session.error', properties: { sessionID: 'session-10' } } });
  await runtime.event({ event: { type: 'session.created', properties: { info: { id: 'session-10' } } } });
  await runtime.event({ event: { type: 'session.idle', properties: { sessionID: 'session-10' } } });

  assert.equal(promptCalls.length, 2);
  assert.equal(promptCalls[0]?.body?.noReply, true);
  assert.match(promptCalls[1]?.body?.parts?.[0]?.text ?? '', /continue working now/i);
});

test('max nudges per session is enforced across distinct assistant replies', async () => {
  const messagesBySession = {
    'session-5': [
      textMessage('user', 'Continue until done.', 'user-1'),
      textMessage('assistant', 'I drafted the plan. Would you like me to implement it?', 'assistant-1'),
    ],
  };
  const { client, promptCalls } = createMockClient(messagesBySession);
  const runtime = createContinueNudgeRuntime(client, { maxNudgesPerSession: 2 });

  await runtime.event({
    event: { type: 'session.idle', properties: { sessionID: 'session-5' } },
  });

  messagesBySession['session-5'] = [
    textMessage('user', 'Continue until done.', 'user-1'),
    textMessage('assistant', 'I drafted the plan. Would you like me to implement it?', 'assistant-1'),
    textMessage('user', buildContinuationPrompt(), 'plugin-user-1'),
    textMessage('assistant', 'I changed the code. Want me to add tests too?', 'assistant-2'),
  ];

  await runtime.event({
    event: { type: 'session.idle', properties: { sessionID: 'session-5' } },
  });

  messagesBySession['session-5'] = [
    ...messagesBySession['session-5'],
    textMessage('user', buildContinuationPrompt(), 'plugin-user-2'),
    textMessage('assistant', 'I also found a README update. Would you like me to apply it?', 'assistant-3'),
  ];

  await runtime.event({
    event: { type: 'session.idle', properties: { sessionID: 'session-5' } },
  });

  assert.equal(promptCalls.length, 2);
});

test('question.asked auto-replies to permission-seeking questions when custom answers are allowed', async () => {
  const { client, questionReplyCalls, promptCalls } = createMockClient({
    'session-6': [
      textMessage('user', 'Find one improvement and do it.', 'user-1'),
      textMessage('assistant', 'I inspected the files.', 'assistant-1'),
    ],
  });
  const runtime = createContinueNudgeRuntime(client);

  await runtime.event({
    event: {
      type: 'question.asked',
      properties: {
        id: 'question-1',
        sessionID: 'session-6',
        questions: [
          {
            header: 'Focus',
            question: 'Should I focus the improvement on functionality, tests, or documentation?',
            options: [],
          },
        ],
      },
    },
  });

  assert.equal(questionReplyCalls.length, 1);
  assert.deepEqual(questionReplyCalls[0], {
    requestID: 'question-1',
    answers: [[buildQuestionAutoAnswer()]],
  });
  assert.equal(promptCalls.length, 0);
});

test('question.asked rejects and nudges when custom answers are disabled', async () => {
  const { client, questionRejectCalls, promptCalls } = createMockClient({
    'session-7': [
      textMessage('user', 'Find one improvement and do it.', 'user-1'),
      textMessage('assistant', 'I inspected the files.', 'assistant-1'),
    ],
  });
  const runtime = createContinueNudgeRuntime(client);

  await runtime.event({
    event: {
      type: 'question.asked',
      properties: {
        id: 'question-2',
        sessionID: 'session-7',
        questions: [
          {
            header: 'Focus',
            question: 'Should I focus the improvement on functionality, tests, or documentation?',
            options: [{ label: 'Functionality', description: 'Pick a code-path improvement.' }],
            custom: false,
          },
        ],
      },
    },
  });

  assert.equal(questionRejectCalls.length, 1);
  assert.deepEqual(questionRejectCalls[0], { requestID: 'question-2' });
  assert.equal(promptCalls.length, 1);
  assert.match(promptCalls[0].body.parts[0].text, /continue working now/i);
});

test('question.asked respects explicit user opt-out instructions', async () => {
  const { client, questionReplyCalls, questionRejectCalls, promptCalls } = createMockClient({
    'session-8': [
      textMessage('user', 'Plan only. Ask me before you implement anything.', 'user-1'),
      textMessage('assistant', 'I inspected the files.', 'assistant-1'),
    ],
  });
  const runtime = createContinueNudgeRuntime(client);

  await runtime.event({
    event: {
      type: 'question.asked',
      properties: {
        id: 'question-3',
        sessionID: 'session-8',
        questions: [
          {
            header: 'Focus',
            question: 'Should I focus the improvement on functionality, tests, or documentation?',
            options: [],
          },
        ],
      },
    },
  });

  assert.equal(questionReplyCalls.length, 0);
  assert.equal(questionRejectCalls.length, 0);
  assert.equal(promptCalls.length, 0);
});

test('default semantic classifier call is ignored for marker messages', async () => {
  const { client, promptCalls } = createMockClient({
    'session-semantic-marker': [
      textMessage('user', 'Continue until done.', 'user-1'),
      textMessage('assistant', `${CONTINUATION_NUDGE_MARKER}\nContinue working now.`, 'assistant-1'),
    ],
  });

  const runtime = createContinueNudgeRuntime(client, {
    semanticFallback: { enabled: true, maxChecksPerSession: 2 },
  });

  await runtime.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-semantic-marker' },
    },
  });

  assert.equal(promptCalls.length, 0);
  assert.equal(runtime._debug.semanticChecksBySession.get('session-semantic-marker') || 0, 0);
});
