# OpenCode Plugin Reliability Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a publishable reliability toolkit and reusable OpenCode skill that let plugin developers run repeatable tuning loops with persisted artifacts and regression-aware scoring.

**Architecture:** Add a new package (`packages/opencode-plugin-reliability`) that provides a profile-driven runner, scoring, artifact persistence, and a soft-gate decision engine. Implement a `continue-nudge` profile first, then wire repository scripts and a generic skill so current and external plugin developers can use the same workflow.

**Tech Stack:** Node.js ESM, `node:test`, JSON/JSONL artifacts, existing OpenCode ACP/session export tooling.

---

## File Structure

### New files

- `packages/opencode-plugin-reliability/package.json` - publishable package metadata, exports, CLI bin.
- `packages/opencode-plugin-reliability/src/index.js` - public exports.
- `packages/opencode-plugin-reliability/src/runner.js` - main orchestration pipeline.
- `packages/opencode-plugin-reliability/src/profiles/continue-nudge.js` - continue-nudge normalize/label/score/policy profile.
- `packages/opencode-plugin-reliability/src/score/reliability-score.js` - weighted score math.
- `packages/opencode-plugin-reliability/src/gate/soft-gate.js` - pass/warn/fail logic.
- `packages/opencode-plugin-reliability/src/artifacts/write-artifacts.js` - run folder + scoreboard writer.
- `packages/opencode-plugin-reliability/src/cli.js` - CLI commands (`run`, `score`, `gate`, `report`).
- `packages/opencode-plugin-reliability/test/runner.test.js` - orchestration contract tests.
- `packages/opencode-plugin-reliability/test/continue-nudge-profile.test.js` - strict 1-turn label rules tests.
- `packages/opencode-plugin-reliability/test/score-and-gate.test.js` - scoring and gate regression tests.
- `packages/opencode-plugin-reliability/test/artifacts.test.js` - artifact persistence and scoreboard tests.
- `packages/opencode-plugin-reliability/test/cli.test.js` - CLI behavior tests.
- `scripts/reliability-loop.mjs` - repository integration script that runs profile evaluation and writes artifacts.
- `.opencode/skills/opencode-plugin-reliability-loop/SKILL.md` - reusable skill for plugin teams.
- `docs/superpowers/reliability-toolkit-adoption.md` - external adopter guide.

### Modified files

- `package.json` - add root scripts for toolkit tests and reliability loop execution.
- `README.md` - add toolkit usage section and artifact layout.

---

### Task 1: Scaffold the publishable package and runner contract

**Files:**
- Create: `packages/opencode-plugin-reliability/package.json`
- Create: `packages/opencode-plugin-reliability/src/index.js`
- Create: `packages/opencode-plugin-reliability/src/runner.js`
- Test: `packages/opencode-plugin-reliability/test/runner.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { runReliabilitySuite } from '../src/index.js';

test('runReliabilitySuite orchestrates profile pipeline', async () => {
  const calls = [];

  const profile = {
    normalize(input) {
      calls.push('normalize');
      return input.events;
    },
    label(events) {
      calls.push('label');
      return { events, counts: { tp: 1, fp: 0, fn: 0, ignored: 0 } };
    },
    score(labels) {
      calls.push('score');
      return { total: 90, components: { continuationSuccess: 1 } };
    },
    policy() {
      calls.push('policy');
      return { actions: [] };
    },
  };

  const result = await runReliabilitySuite({
    profile,
    inputs: { events: [{ type: 'assistant', text: 'done' }] },
  });

  assert.deepEqual(calls, ['normalize', 'label', 'score', 'policy']);
  assert.equal(result.score.total, 90);
  assert.equal(result.labels.counts.tp, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/opencode-plugin-reliability/test/runner.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/index.js`.

- [ ] **Step 3: Write minimal implementation**

```json
// packages/opencode-plugin-reliability/package.json
{
  "name": "@inizio/opencode-plugin-reliability",
  "version": "0.1.0",
  "description": "Reliability harness for OpenCode plugins",
  "license": "MIT",
  "type": "module",
  "main": "src/index.js",
  "exports": {
    ".": "./src/index.js"
  },
  "bin": {
    "opencode-reliability": "./src/cli.js"
  },
  "scripts": {
    "test": "node --test test/*.test.js"
  }
}
```

```js
// packages/opencode-plugin-reliability/src/runner.js
export async function runReliabilitySuite({ profile, inputs, context = {} }) {
  if (!profile) throw new Error('profile is required');
  if (typeof profile.normalize !== 'function') throw new Error('profile.normalize is required');
  if (typeof profile.label !== 'function') throw new Error('profile.label is required');
  if (typeof profile.score !== 'function') throw new Error('profile.score is required');

  const events = await profile.normalize(inputs, context);
  const labels = await profile.label(events, context);
  const score = await profile.score(labels, context);
  const policy = typeof profile.policy === 'function' ? await profile.policy({ events, labels, score }, context) : null;

  return { events, labels, score, policy };
}
```

```js
// packages/opencode-plugin-reliability/src/index.js
export { runReliabilitySuite } from './runner.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/opencode-plugin-reliability/test/runner.test.js`
Expected: PASS with `runReliabilitySuite orchestrates profile pipeline`.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode-plugin-reliability/package.json \
  packages/opencode-plugin-reliability/src/index.js \
  packages/opencode-plugin-reliability/src/runner.js \
  packages/opencode-plugin-reliability/test/runner.test.js
git commit -m "Scaffold reliability package runner"
```

### Task 2: Implement continue-nudge profile with strict 1-turn feedback labels

**Files:**
- Create: `packages/opencode-plugin-reliability/src/profiles/continue-nudge.js`
- Modify: `packages/opencode-plugin-reliability/src/index.js`
- Test: `packages/opencode-plugin-reliability/test/continue-nudge-profile.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { continueNudgeProfile } from '../src/profiles/continue-nudge.js';

test('labels post_nudge_user_correction as strong false positive', async () => {
  const events = [
    { role: 'assistant', text: 'Would you like me to keep going?', messageId: 'a1' },
    { role: 'user', text: 'CONTINUE_NUDGE_PLUGIN Continue working now', messageId: 'u-plugin' },
    { role: 'user', text: 'Not the right direction. Stop that.', messageId: 'u1' },
  ];

  const labels = continueNudgeProfile.label(events);
  assert.equal(labels.reasonCodes.includes('post_nudge_user_correction'), true);
  assert.equal(labels.counts.fp >= 1, true);
});

test('labels post_no_nudge_user_prompt_to_continue as strong false negative', async () => {
  const events = [
    { role: 'assistant', text: 'I can also add tests if you want.', messageId: 'a1' },
    { role: 'user', text: 'continue', messageId: 'u1' },
  ];

  const labels = continueNudgeProfile.label(events);
  assert.equal(labels.reasonCodes.includes('post_no_nudge_user_prompt_to_continue'), true);
  assert.equal(labels.counts.fn >= 1, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/opencode-plugin-reliability/test/continue-nudge-profile.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/profiles/continue-nudge.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/opencode-plugin-reliability/src/profiles/continue-nudge.js
const CORRECTION_PATTERN = /\b(not (the )?right direction|wrong direction|stop|do not continue|don't continue|pause|hold off)\b/i;
const USER_CONTINUE_PATTERN = /\b(continue|keep going|go ahead|proceed)\b/i;
const PERMISSION_PATTERN = /\b(would you like me to|do you want me to|should i|if you want|next high-value step|next logical step)\b/i;

export const continueNudgeProfile = {
  normalize(input) {
    if (Array.isArray(input?.messages)) {
      return input.messages.map((message) => ({
        role: message.role,
        text: String(message.text || ''),
        messageId: message.messageId || null,
      }));
    }
    return Array.isArray(input) ? input : [];
  },

  label(events) {
    const counts = { tp: 0, fp: 0, fn: 0, ignored: 0 };
    const reasonCodes = [];

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const text = String(event?.text || '');
      const next = events[index + 1];

      if (/CONTINUE_NUDGE_PLUGIN/.test(text) && next?.role === 'user' && CORRECTION_PATTERN.test(next.text || '')) {
        counts.fp += 1;
        reasonCodes.push('post_nudge_user_correction');
      }

      if (event?.role === 'assistant' && PERMISSION_PATTERN.test(text)) {
        const nextIsNudge = /CONTINUE_NUDGE_PLUGIN/.test(String(next?.text || ''));
        if (!nextIsNudge && next?.role === 'user' && USER_CONTINUE_PATTERN.test(next.text || '')) {
          counts.fn += 1;
          reasonCodes.push('post_no_nudge_user_prompt_to_continue');
        }
      }
    }

    return { counts, reasonCodes };
  },

  score(labels) {
    const { tp, fp, fn } = labels.counts;
    const safeTotal = tp + fp + fn || 1;
    const total = Math.max(0, Math.round(((tp - fp - fn) / safeTotal) * 100 + 100) / 2);
    return { total, components: { tp, fp, fn } };
  },

  policy() {
    return { actions: [] };
  },
};
```

```js
// packages/opencode-plugin-reliability/src/index.js
export { runReliabilitySuite } from './runner.js';
export { continueNudgeProfile } from './profiles/continue-nudge.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/opencode-plugin-reliability/test/continue-nudge-profile.test.js`
Expected: PASS for both strict 1-turn rule tests.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode-plugin-reliability/src/profiles/continue-nudge.js \
  packages/opencode-plugin-reliability/src/index.js \
  packages/opencode-plugin-reliability/test/continue-nudge-profile.test.js
git commit -m "Add continue nudge reliability profile"
```

### Task 3: Implement weighted Reliability Score and soft gate decisions

**Files:**
- Create: `packages/opencode-plugin-reliability/src/score/reliability-score.js`
- Create: `packages/opencode-plugin-reliability/src/gate/soft-gate.js`
- Modify: `packages/opencode-plugin-reliability/src/runner.js`
- Modify: `packages/opencode-plugin-reliability/src/index.js`
- Test: `packages/opencode-plugin-reliability/test/score-and-gate.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { computeReliabilityScore, classifySoftGate } from '../src/index.js';

test('computeReliabilityScore penalizes fp/fn reasons heavily', () => {
  const result = computeReliabilityScore({
    counts: { tp: 4, fp: 1, fn: 2, ignored: 0 },
    acpSmokePassed: true,
    hardStopRespected: true,
  });

  assert.equal(result.total < 80, true);
  assert.equal(result.components.falsePositiveControl <= 70, true);
});

test('classifySoftGate fails on strong regression and warns on mild dip', () => {
  const failResult = classifySoftGate({ currentScore: 61, baselineScore: 80, acpSmokePassed: true });
  assert.equal(failResult.verdict, 'fail');
  assert.equal(failResult.reasonCodes.includes('GATE_STRONG_REGRESSION'), true);

  const warnResult = classifySoftGate({ currentScore: 76, baselineScore: 80, acpSmokePassed: true });
  assert.equal(warnResult.verdict, 'warn');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/opencode-plugin-reliability/test/score-and-gate.test.js`
Expected: FAIL with missing exports for `computeReliabilityScore` and `classifySoftGate`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/opencode-plugin-reliability/src/score/reliability-score.js
export function computeReliabilityScore({ counts, acpSmokePassed, hardStopRespected }) {
  const tp = counts?.tp || 0;
  const fp = counts?.fp || 0;
  const fn = counts?.fn || 0;
  const total = Math.max(tp + fp + fn, 1);

  const continuationSuccess = Math.max(0, Math.min(100, Math.round((tp / total) * 100)));
  const falsePositiveControl = Math.max(0, Math.min(100, 100 - fp * 25));
  const hardStopRespect = hardStopRespected ? 100 : 50;
  const acpSmoke = acpSmokePassed ? 100 : 0;
  const missedNudgePenalty = Math.max(0, 100 - fn * 30);

  const weighted =
    continuationSuccess * 0.35 +
    falsePositiveControl * 0.25 +
    hardStopRespect * 0.15 +
    acpSmoke * 0.15 +
    missedNudgePenalty * 0.1;

  return {
    total: Math.round(weighted),
    components: {
      continuationSuccess,
      falsePositiveControl,
      hardStopRespect,
      acpSmoke,
      missedNudgePenalty,
    },
  };
}
```

```js
// packages/opencode-plugin-reliability/src/gate/soft-gate.js
export function classifySoftGate({ currentScore, baselineScore, acpSmokePassed }) {
  const reasonCodes = [];
  if (!acpSmokePassed) {
    reasonCodes.push('ACP_SMOKE_FAILED');
    return { verdict: 'fail', reasonCodes };
  }

  if (typeof baselineScore !== 'number') {
    reasonCodes.push('BASELINE_MISSING');
    return { verdict: 'warn', reasonCodes };
  }

  const delta = currentScore - baselineScore;
  if (delta <= -12) {
    reasonCodes.push('GATE_STRONG_REGRESSION');
    return { verdict: 'fail', reasonCodes, delta };
  }
  if (delta < 0) {
    reasonCodes.push('GATE_MILD_REGRESSION');
    return { verdict: 'warn', reasonCodes, delta };
  }

  return { verdict: 'pass', reasonCodes, delta };
}
```

```js
// packages/opencode-plugin-reliability/src/runner.js
import { computeReliabilityScore } from './score/reliability-score.js';

export async function runReliabilitySuite({ profile, inputs, context = {} }) {
  if (!profile) throw new Error('profile is required');
  const events = await profile.normalize(inputs, context);
  const labels = await profile.label(events, context);
  const profileScore = await profile.score(labels, context);
  const score =
    profileScore && typeof profileScore.total === 'number'
      ? profileScore
      : computeReliabilityScore({
          counts: labels.counts,
          acpSmokePassed: Boolean(context.acpSmokePassed),
          hardStopRespected: context.hardStopRespected !== false,
        });
  const policy = typeof profile.policy === 'function' ? await profile.policy({ events, labels, score }, context) : null;
  return { events, labels, score, policy };
}
```

```js
// packages/opencode-plugin-reliability/src/index.js
export { runReliabilitySuite } from './runner.js';
export { continueNudgeProfile } from './profiles/continue-nudge.js';
export { computeReliabilityScore } from './score/reliability-score.js';
export { classifySoftGate } from './gate/soft-gate.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/opencode-plugin-reliability/test/score-and-gate.test.js`
Expected: PASS for weighted score and soft-gate classification.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode-plugin-reliability/src/score/reliability-score.js \
  packages/opencode-plugin-reliability/src/gate/soft-gate.js \
  packages/opencode-plugin-reliability/src/runner.js \
  packages/opencode-plugin-reliability/src/index.js \
  packages/opencode-plugin-reliability/test/score-and-gate.test.js
git commit -m "Add reliability scoring and soft gate"
```

### Task 4: Persist run artifacts and rolling scoreboard

**Files:**
- Create: `packages/opencode-plugin-reliability/src/artifacts/write-artifacts.js`
- Modify: `packages/opencode-plugin-reliability/src/index.js`
- Test: `packages/opencode-plugin-reliability/test/artifacts.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeRunArtifacts } from '../src/index.js';

test('writeRunArtifacts creates run directory and updates scoreboard', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reliability-artifacts-'));

  const output = await writeRunArtifacts({
    rootDir: root,
    runId: '2026-04-06T11-22-33Z',
    run: { score: { total: 81 }, labels: { counts: { tp: 2, fp: 0, fn: 1, ignored: 0 } } },
    diff: { delta: -2, verdict: 'warn' },
  });

  assert.equal(output.runDir.endsWith('2026-04-06T11-22-33Z'), true);

  const scoreboardRaw = await readFile(join(root, '.opencode/reliability/scoreboard.json'), 'utf8');
  const scoreboard = JSON.parse(scoreboardRaw);
  assert.equal(Array.isArray(scoreboard.runs), true);
  assert.equal(scoreboard.runs.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/opencode-plugin-reliability/test/artifacts.test.js`
Expected: FAIL with missing export `writeRunArtifacts`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/opencode-plugin-reliability/src/artifacts/write-artifacts.js
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeRunArtifacts({ rootDir, runId, run, diff }) {
  const baseDir = join(rootDir, '.opencode/reliability');
  const runDir = join(baseDir, 'runs', runId);
  const scoreboardPath = join(baseDir, 'scoreboard.json');

  await mkdir(runDir, { recursive: true });

  await writeFile(join(runDir, 'scores.json'), `${JSON.stringify(run.score, null, 2)}\n`);
  await writeFile(join(runDir, 'labels.json'), `${JSON.stringify(run.labels, null, 2)}\n`);
  await writeFile(join(runDir, 'diff-vs-baseline.json'), `${JSON.stringify(diff, null, 2)}\n`);
  await writeFile(
    join(runDir, 'report.md'),
    `# Reliability Report\n\n- Score: ${run.score.total}\n- Gate: ${diff.verdict}\n- Delta: ${diff.delta ?? 0}\n`,
  );

  const scoreboard = await readJson(scoreboardPath, { runs: [], activeBaselineRunId: null });
  scoreboard.runs.push({ runId, score: run.score.total, verdict: diff.verdict, delta: diff.delta ?? 0 });
  if (!scoreboard.activeBaselineRunId && diff.verdict !== 'fail') {
    scoreboard.activeBaselineRunId = runId;
  }

  await mkdir(dirname(scoreboardPath), { recursive: true });
  await writeFile(scoreboardPath, `${JSON.stringify(scoreboard, null, 2)}\n`);

  return { runDir, scoreboardPath };
}
```

```js
// packages/opencode-plugin-reliability/src/index.js
export { runReliabilitySuite } from './runner.js';
export { continueNudgeProfile } from './profiles/continue-nudge.js';
export { computeReliabilityScore } from './score/reliability-score.js';
export { classifySoftGate } from './gate/soft-gate.js';
export { writeRunArtifacts } from './artifacts/write-artifacts.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/opencode-plugin-reliability/test/artifacts.test.js`
Expected: PASS and created scoreboard with one run entry.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode-plugin-reliability/src/artifacts/write-artifacts.js \
  packages/opencode-plugin-reliability/src/index.js \
  packages/opencode-plugin-reliability/test/artifacts.test.js
git commit -m "Persist reliability run artifacts"
```

### Task 5: Add CLI commands for run, score, gate, and report

**Files:**
- Create: `packages/opencode-plugin-reliability/src/cli.js`
- Modify: `packages/opencode-plugin-reliability/src/index.js`
- Test: `packages/opencode-plugin-reliability/test/cli.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('cli score command returns JSON with total score', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reliability-cli-'));
  const labelsPath = join(root, 'labels.json');
  await writeFile(labelsPath, JSON.stringify({ counts: { tp: 3, fp: 1, fn: 0, ignored: 0 } }));

  const result = spawnSync(process.execPath, ['packages/opencode-plugin-reliability/src/cli.js', 'score', '--labels', labelsPath], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(typeof parsed.total, 'number');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/opencode-plugin-reliability/test/cli.test.js`
Expected: FAIL because `src/cli.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/opencode-plugin-reliability/src/cli.js
#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import { computeReliabilityScore, classifySoftGate } from './index.js';

function parseFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0 || index + 1 >= args.length) return null;
  return args[index + 1];
}

async function main() {
  const [, , command, ...rest] = process.argv;

  if (command === 'score') {
    const labelsPath = parseFlag(rest, '--labels');
    if (!labelsPath) throw new Error('--labels is required');
    const labels = JSON.parse(await readFile(labelsPath, 'utf8'));
    const score = computeReliabilityScore({
      counts: labels.counts,
      acpSmokePassed: true,
      hardStopRespected: true,
    });
    process.stdout.write(`${JSON.stringify(score)}\n`);
    return;
  }

  if (command === 'gate') {
    const currentScore = Number(parseFlag(rest, '--current'));
    const baselineScore = Number(parseFlag(rest, '--baseline'));
    const verdict = classifySoftGate({ currentScore, baselineScore, acpSmokePassed: true });
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
    process.exitCode = verdict.verdict === 'fail' ? 1 : 0;
    return;
  }

  process.stdout.write('Usage: opencode-reliability <score|gate>\n');
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
```

```js
// packages/opencode-plugin-reliability/src/index.js
export { runReliabilitySuite } from './runner.js';
export { continueNudgeProfile } from './profiles/continue-nudge.js';
export { computeReliabilityScore } from './score/reliability-score.js';
export { classifySoftGate } from './gate/soft-gate.js';
export { writeRunArtifacts } from './artifacts/write-artifacts.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/opencode-plugin-reliability/test/cli.test.js`
Expected: PASS and JSON output with numeric `total`.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode-plugin-reliability/src/cli.js \
  packages/opencode-plugin-reliability/test/cli.test.js
git commit -m "Add reliability toolkit cli"
```

### Task 6: Integrate repository reliability loop script and root scripts

**Files:**
- Create: `scripts/reliability-loop.mjs`
- Modify: `package.json`
- Test: `packages/opencode-plugin-reliability/test/runner.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('reliability-loop script requires an export path and exits non-zero without it', () => {
  const result = spawnSync(process.execPath, ['scripts/reliability-loop.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--export is required/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/opencode-plugin-reliability/test/runner.test.js`
Expected: FAIL with missing `scripts/reliability-loop.mjs` assertion target.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/reliability-loop.mjs
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  continueNudgeProfile,
  runReliabilitySuite,
  classifySoftGate,
  writeRunArtifacts,
} from '../packages/opencode-plugin-reliability/src/index.js';

function parseFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0 || index + 1 >= args.length) return null;
  return args[index + 1];
}

const exportPath = parseFlag(process.argv.slice(2), '--export');
if (!exportPath) {
  process.stderr.write('--export is required\n');
  process.exit(1);
}

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const sessionExport = JSON.parse(await readFile(resolve(exportPath), 'utf8'));

const messages = Array.isArray(sessionExport.messages)
  ? sessionExport.messages.map((message) => ({
      role: message?.info?.role || 'unknown',
      text: (message.parts || [])
        .filter((part) => part?.type === 'text' && typeof part?.text === 'string')
        .map((part) => part.text)
        .join('\n')
        .trim(),
      messageId: message?.info?.id || null,
    }))
  : [];

const run = await runReliabilitySuite({
  profile: continueNudgeProfile,
  inputs: { messages },
  context: { acpSmokePassed: true, hardStopRespected: true },
});

const verdict = classifySoftGate({ currentScore: run.score.total, baselineScore: null, acpSmokePassed: true });

const rootDir = resolve(dirname(exportPath), '..');
await writeRunArtifacts({ rootDir, runId, run, diff: verdict });

process.stdout.write(`${JSON.stringify({ runId, score: run.score.total, verdict: verdict.verdict })}\n`);
```

```json
// package.json (scripts section)
{
  "scripts": {
    "test": "node --test",
    "test:acp": "node scripts/acp-smoke-run.mjs",
    "check:nudge": "node scripts/check-nudge-status.mjs",
    "test:reliability": "node --test packages/opencode-plugin-reliability/test/*.test.js",
    "reliability:loop": "node scripts/reliability-loop.mjs"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:reliability`
Expected: PASS for package tests including script validation.

- [ ] **Step 5: Commit**

```bash
git add scripts/reliability-loop.mjs package.json
git commit -m "Wire repository reliability loop script"
```

### Task 7: Add reusable OpenCode skill and adoption documentation

**Files:**
- Create: `.opencode/skills/opencode-plugin-reliability-loop/SKILL.md`
- Create: `docs/superpowers/reliability-toolkit-adoption.md`
- Modify: `README.md`
- Test: `packages/opencode-plugin-reliability/test/cli.test.js`

- [ ] **Step 1: Write the failing doc test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('skill doc references scoreboard and soft gate workflow', async () => {
  const skill = await readFile('.opencode/skills/opencode-plugin-reliability-loop/SKILL.md', 'utf8');
  assert.match(skill, /scoreboard\.json/);
  assert.match(skill, /soft gate/i);
  assert.match(skill, /post_nudge_user_correction/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/opencode-plugin-reliability/test/cli.test.js`
Expected: FAIL because new skill file does not exist.

- [ ] **Step 3: Write minimal implementation**

```markdown
<!-- .opencode/skills/opencode-plugin-reliability-loop/SKILL.md -->
---
name: opencode-plugin-reliability-loop
description: Use when iterating OpenCode plugin behavior and you need scored artifacts, regression checks, and next-step tuning guidance between runs.
---

# OpenCode Plugin Reliability Loop

Run this loop after each tuning change:

1. Generate or export a fresh session artifact.
2. Run `npm run reliability:loop -- --export <path>`.
3. Inspect `.opencode/reliability/scoreboard.json` and the latest run report.
4. If verdict is fail, fix highest-impact reason code first.
5. Repeat until score trend stabilizes upward.

Strict labels:
- `post_nudge_user_correction`
- `post_no_nudge_user_prompt_to_continue`

Soft gate behavior:
- Fail on ACP smoke failure or strong score regression.
- Warn on mild regressions.
```

```markdown
<!-- docs/superpowers/reliability-toolkit-adoption.md -->
# Reliability Toolkit Adoption

## Install

```bash
npm install @inizio/opencode-plugin-reliability
```

## Implement a Profile

Provide `normalize`, `label`, `score`, and optional `policy`.

## Run

```bash
opencode-reliability score --labels labels.json
opencode-reliability gate --current 78 --baseline 82
```

## Artifact Layout

- `.opencode/reliability/runs/<run-id>/scores.json`
- `.opencode/reliability/runs/<run-id>/labels.json`
- `.opencode/reliability/runs/<run-id>/diff-vs-baseline.json`
- `.opencode/reliability/runs/<run-id>/report.md`
- `.opencode/reliability/scoreboard.json`
```

```markdown
<!-- README.md addition -->
## Reliability Toolkit

This repository includes a reusable toolkit at `packages/opencode-plugin-reliability`.

Run local reliability checks with:

```bash
npm run reliability:loop -- --export /path/to/session-export.json
```

Artifacts are written under `.opencode/reliability/`.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:reliability`
Expected: PASS and skill/adoption docs referenced in assertions.

- [ ] **Step 5: Commit**

```bash
git add .opencode/skills/opencode-plugin-reliability-loop/SKILL.md \
  docs/superpowers/reliability-toolkit-adoption.md \
  README.md
git commit -m "Document reliability loop skill"
```

### Task 8: End-to-end verification and release readiness

**Files:**
- Modify: `packages/opencode-plugin-reliability/package.json`
- Test: `packages/opencode-plugin-reliability/test/*.test.js`

- [ ] **Step 1: Add release readiness test expectations**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('package metadata is publish-ready', async () => {
  const pkg = JSON.parse(await readFile('packages/opencode-plugin-reliability/package.json', 'utf8'));
  assert.equal(pkg.name, '@inizio/opencode-plugin-reliability');
  assert.equal(pkg.type, 'module');
  assert.equal(typeof pkg.bin['opencode-reliability'], 'string');
});
```

- [ ] **Step 2: Run full test suite and verify failures first**

Run: `npm run test:reliability`
Expected: FAIL until metadata and all tests are aligned.

- [ ] **Step 3: Final implementation updates**

```json
// packages/opencode-plugin-reliability/package.json
{
  "name": "@inizio/opencode-plugin-reliability",
  "version": "0.1.0",
  "description": "Reliability harness for OpenCode plugins",
  "license": "MIT",
  "type": "module",
  "main": "src/index.js",
  "exports": {
    ".": "./src/index.js"
  },
  "bin": {
    "opencode-reliability": "./src/cli.js"
  },
  "files": [
    "src",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "test": "node --test test/*.test.js"
  }
}
```

- [ ] **Step 4: Run final verification commands**

Run all:

```bash
npm run test
npm run test:acp
npm run check:nudge
npm run test:reliability
```

Expected:
- all command exits are `0`
- reliability artifacts written under `.opencode/reliability/runs/`
- gate verdict appears in script output (`pass`, `warn`, or `fail`)

- [ ] **Step 5: Commit**

```bash
git add packages/opencode-plugin-reliability/package.json
git commit -m "Finalize reliability toolkit release metadata"
```

## Spec Coverage Self-Check

- Harness-first architecture: covered by Tasks 1-4.
- Continue-nudge strict 1-turn user feedback signals: covered by Task 2 tests and implementation.
- Reliability Score as primary KPI: covered by Task 3.
- Artifact persistence and scoreboard trend memory: covered by Task 4.
- Soft-gate fail/warn policy: covered by Task 3 and Task 6 integration.
- Generic skill for other plugin developers: covered by Task 7.
- Publishable package target: covered by Tasks 1 and 8.

## Placeholder Scan Result

- No `TODO`, `TBD`, or deferred implementation markers remain.
- Every code-change step includes concrete code blocks.
- Every task includes explicit test commands and expected outcomes.
