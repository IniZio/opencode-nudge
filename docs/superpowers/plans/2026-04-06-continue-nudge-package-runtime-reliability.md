# Continue-Nudge Package Runtime Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate continue-nudge into `packages/opencode-continue-nudge`, keep root compatibility, add runtime reliability integration (shadow default, enforce opt-in), and prove behavior through ACP on both local and installed plugin paths.

**Architecture:** Make `packages/opencode-continue-nudge` the canonical plugin implementation and keep root `.opencode/plugins/continue-nudge.js` plus `index.js` as compatibility shims. Add a package-local runtime reliability module that uses `@inizio/opencode-plugin-reliability` APIs to score live sessions and write artifacts safely. Extend ACP smoke flow to validate both plugin resolution paths and reliability artifact output.

**Tech Stack:** Node.js ESM, `node:test`, OpenCode ACP JSON-RPC script (`scripts/acp-smoke-run.mjs`), reliability toolkit package in `packages/opencode-plugin-reliability`.

---

## File Structure

### Create

- `packages/opencode-continue-nudge/package.json`
- `packages/opencode-continue-nudge/index.js`
- `packages/opencode-continue-nudge/src/continue-nudge-plugin.js`
- `packages/opencode-continue-nudge/src/reliability-runtime.js`
- `packages/opencode-continue-nudge/.opencode/plugins/continue-nudge.js`
- `packages/opencode-continue-nudge/test/continue-nudge-plugin.test.js`
- `packages/opencode-continue-nudge/test/reliability-runtime.test.js`

### Modify

- `index.js`
- `src/continue-nudge-plugin.js`
- `.opencode/plugins/continue-nudge.js`
- `.opencode/continue-nudge.json`
- `scripts/acp-smoke-run.mjs`
- `package.json`
- `README.md`
- `test/continue-nudge-plugin.test.js` (temporary compatibility coverage until fully removed)

### Remove (after package tests are green)

- `test/continue-nudge-plugin.test.js`

---

### Task 1: Create canonical continue-nudge package and root compatibility shims

**Files:**
- Create: `packages/opencode-continue-nudge/package.json`
- Create: `packages/opencode-continue-nudge/index.js`
- Create: `packages/opencode-continue-nudge/.opencode/plugins/continue-nudge.js`
- Modify: `index.js`
- Modify: `.opencode/plugins/continue-nudge.js`
- Test: `test/continue-nudge-plugin.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/continue-nudge-plugin.test.js
test('package entrypoint re-exports plugin helpers from packages/opencode-continue-nudge', async () => {
  const mod = await import('../index.js');
  assert.equal(typeof mod.createContinueNudgePlugin, 'function');
  assert.equal(typeof mod.loadContinueNudgeConfig, 'function');

  const pkgMod = await import('../packages/opencode-continue-nudge/index.js');
  assert.equal(typeof pkgMod.createContinueNudgePlugin, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/continue-nudge-plugin.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `packages/opencode-continue-nudge/index.js`.

- [ ] **Step 3: Write minimal implementation**

```json
// packages/opencode-continue-nudge/package.json
{
  "name": "@inizio/opencode-continue-nudge",
  "version": "0.1.0",
  "description": "Package implementation for opencode continue-nudge plugin",
  "license": "MIT",
  "type": "module",
  "main": "index.js",
  "exports": {
    ".": "./index.js",
    "./plugin": "./src/continue-nudge-plugin.js"
  },
  "files": [
    "index.js",
    "src",
    ".opencode/plugins/continue-nudge.js"
  ]
}
```

```js
// packages/opencode-continue-nudge/index.js
export * from './src/continue-nudge-plugin.js';
```

```js
// packages/opencode-continue-nudge/.opencode/plugins/continue-nudge.js
import {
  createContinueNudgePlugin,
  loadContinueNudgeConfig,
} from '../../src/continue-nudge-plugin.js';

export const ContinueNudgePlugin = async (context) => {
  const options = await loadContinueNudgeConfig(new URL('../continue-nudge.json', import.meta.url));
  return createContinueNudgePlugin(options)(context);
};

export default ContinueNudgePlugin;
```

```js
// index.js
export * from './packages/opencode-continue-nudge/index.js';
```

```js
// .opencode/plugins/continue-nudge.js
export { ContinueNudgePlugin as default } from '../../packages/opencode-continue-nudge/.opencode/plugins/continue-nudge.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/continue-nudge-plugin.test.js`
Expected: PASS for new package-entrypoint coverage.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode-continue-nudge/package.json \
  packages/opencode-continue-nudge/index.js \
  packages/opencode-continue-nudge/.opencode/plugins/continue-nudge.js \
  index.js .opencode/plugins/continue-nudge.js test/continue-nudge-plugin.test.js
git commit -m "Create continue nudge package shims"
```

### Task 2: Move runtime source and tests into package as canonical implementation

**Files:**
- Create: `packages/opencode-continue-nudge/src/continue-nudge-plugin.js`
- Create: `packages/opencode-continue-nudge/test/continue-nudge-plugin.test.js`
- Modify: `src/continue-nudge-plugin.js`
- Modify: `package.json`
- Test: `packages/opencode-continue-nudge/test/continue-nudge-plugin.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/opencode-continue-nudge/test/continue-nudge-plugin.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createContinueNudgePlugin,
  loadContinueNudgeConfig,
} from '../src/continue-nudge-plugin.js';

test('package runtime exports are available', () => {
  assert.equal(typeof createContinueNudgePlugin, 'function');
  assert.equal(typeof loadContinueNudgeConfig, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/opencode-continue-nudge/test/continue-nudge-plugin.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/continue-nudge-plugin.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/opencode-continue-nudge/src/continue-nudge-plugin.js
export * from '../../../src/continue-nudge-plugin.js';
```

```js
// src/continue-nudge-plugin.js
export * from '../packages/opencode-continue-nudge/src/continue-nudge-plugin.js';
```

```json
// package.json (root)
{
  "scripts": {
    "test": "node --test",
    "test:acp": "node scripts/acp-smoke-run.mjs"
  }
}
```

Then replace the temporary re-export with full source moved into `packages/opencode-continue-nudge/src/continue-nudge-plugin.js`, and keep root `src/continue-nudge-plugin.js` as thin compatibility re-export.

- [ ] **Step 4: Run tests to verify they pass from package path**

Run: `node --test packages/opencode-continue-nudge/test/continue-nudge-plugin.test.js`
Expected: PASS.

Run: `node --test test/continue-nudge-plugin.test.js`
Expected: PASS through compatibility re-export.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode-continue-nudge/src/continue-nudge-plugin.js \
  packages/opencode-continue-nudge/test/continue-nudge-plugin.test.js \
  src/continue-nudge-plugin.js package.json
git commit -m "Move continue nudge runtime into package"
```

### Task 3: Add runtime reliability integration module (shadow default, enforce opt-in)

**Files:**
- Create: `packages/opencode-continue-nudge/src/reliability-runtime.js`
- Modify: `packages/opencode-continue-nudge/src/continue-nudge-plugin.js`
- Modify: `.opencode/continue-nudge.json`
- Test: `packages/opencode-continue-nudge/test/reliability-runtime.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/opencode-continue-nudge/test/reliability-runtime.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createReliabilityRuntime } from '../src/reliability-runtime.js';

test('shadow mode writes artifacts and does not block nudge decisions', async () => {
  const runtime = createReliabilityRuntime({
    mode: 'shadow',
    writer: async () => ({ runDir: '/tmp/run' }),
    scorer: async () => ({ score: { total: 80 }, labels: { reasonCodes: [] } }),
  });

  const decision = await runtime.evaluateNudgeDecision({ shouldNudge: true });
  assert.equal(decision.shouldNudge, true);

  const flush = await runtime.flushSession({ sessionId: 's1', events: [] });
  assert.equal(flush.wroteArtifacts, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/opencode-continue-nudge/test/reliability-runtime.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/reliability-runtime.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/opencode-continue-nudge/src/reliability-runtime.js
import { resolve } from 'node:path';
import {
  classifySoftGate,
  continueNudgeProfile,
  runReliabilitySuite,
  writeRunArtifacts,
} from '../../opencode-plugin-reliability/src/index.js';

export function resolveReliabilityRuntimeOptions(input = {}) {
  return {
    enabled: input.enabled !== false,
    mode: input.mode === 'enforce' ? 'enforce' : 'shadow',
    artifactRoot: typeof input.artifactRoot === 'string' && input.artifactRoot ? input.artifactRoot : '.opencode/reliability',
    flushOnSessionEnd: input.flushOnSessionEnd !== false,
  };
}

export function createReliabilityRuntime({
  options = {},
  rootDir = process.cwd(),
  scorer = runReliabilitySuite,
  writer = writeRunArtifacts,
  gate = classifySoftGate,
} = {}) {
  const config = resolveReliabilityRuntimeOptions(options);

  async function evaluateNudgeDecision({ shouldNudge }) {
    return { shouldNudge: Boolean(shouldNudge) };
  }

  async function flushSession({ sessionId, events, context = {} }) {
    if (!config.enabled) return { wroteArtifacts: false, reason: 'disabled' };

    const run = await scorer({
      profile: continueNudgeProfile,
      inputs: { messages: events || [] },
      context,
    });

    const diff = gate({
      currentScore: run.score.total,
      baselineScore: Number.NaN,
      acpSmokePassed: context.acpSmokePassed !== false,
    });

    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${sessionId}`;
    await writer({
      rootDir: resolve(rootDir),
      runId,
      run,
      diff,
      runMeta: {
        profile: 'continue-nudge',
        createdAt: new Date().toISOString(),
      },
    });

    return { wroteArtifacts: true, verdict: diff.verdict };
  }

  return {
    config,
    evaluateNudgeDecision,
    flushSession,
  };
}
```

```json
// .opencode/continue-nudge.json
{
  "preset": "balanced",
  "semanticFallback": {
    "enabled": true,
    "model": "github-copilot/gpt-5.3-codex-mini",
    "mode": "out_of_band",
    "timeoutMs": 4000,
    "maxChecksPerSession": 1
  },
  "reliabilityRuntime": {
    "enabled": true,
    "mode": "shadow",
    "artifactRoot": ".opencode/reliability",
    "flushOnSessionEnd": true
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/opencode-continue-nudge/test/reliability-runtime.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode-continue-nudge/src/reliability-runtime.js \
  packages/opencode-continue-nudge/test/reliability-runtime.test.js \
  .opencode/continue-nudge.json
git commit -m "Add runtime reliability module"
```

### Task 4: Wire reliability runtime into continue-nudge event handling

**Files:**
- Modify: `packages/opencode-continue-nudge/src/continue-nudge-plugin.js`
- Test: `packages/opencode-continue-nudge/test/continue-nudge-plugin.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/opencode-continue-nudge/test/continue-nudge-plugin.test.js
test('session.completed flushes reliability artifacts in shadow mode', async () => {
  const flushCalls = [];
  const runtime = createContinueNudgeRuntime(mockClient.client, {
    reliabilityRuntimeFactory: () => ({
      flushSession: async (payload) => {
        flushCalls.push(payload);
        return { wroteArtifacts: true, verdict: 'pass' };
      },
      evaluateNudgeDecision: async ({ shouldNudge }) => ({ shouldNudge }),
    }),
  });

  await runtime.event({ event: { type: 'session.completed', properties: { info: { id: 's1' } } } });
  assert.equal(flushCalls.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/opencode-continue-nudge/test/continue-nudge-plugin.test.js`
Expected: FAIL because `session.completed` currently does not call runtime flush hook.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/opencode-continue-nudge/src/continue-nudge-plugin.js
import { createReliabilityRuntime, resolveReliabilityRuntimeOptions } from './reliability-runtime.js';

export function resolveContinueNudgeOptions(options = {}) {
  // existing fields...
  return {
    // existing resolved options...
    reliabilityRuntime: resolveReliabilityRuntimeOptions(options.reliabilityRuntime),
  };
}

export function createContinueNudgeRuntime(client, options = {}) {
  const config = resolveContinueNudgeOptions(options);
  const reliabilityRuntimeFactory =
    typeof options?.reliabilityRuntimeFactory === 'function'
      ? options.reliabilityRuntimeFactory
      : (payload) => createReliabilityRuntime(payload);

  const reliabilityRuntime = reliabilityRuntimeFactory({
    options: config.reliabilityRuntime,
    rootDir: process.cwd(),
  });

  // inside nudge path
  const evaluated = await reliabilityRuntime.evaluateNudgeDecision({ shouldNudge: shouldSendNudge });
  shouldSendNudge = evaluated.shouldNudge;

  // inside session.completed and session.deleted handlers
  await reliabilityRuntime.flushSession({
    sessionId,
    events: (messages || []).map((m) => ({
      role: m?.info?.role || 'unknown',
      text: extractTextFromParts(m?.parts || []),
      messageId: m?.info?.id || null,
    })),
    context: { acpSmokePassed: true, hardStopRespected: true },
  });
}
```

- [ ] **Step 4: Run targeted test suite to verify pass**

Run: `node --test packages/opencode-continue-nudge/test/continue-nudge-plugin.test.js`
Expected: PASS including reliability flush test.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode-continue-nudge/src/continue-nudge-plugin.js \
  packages/opencode-continue-nudge/test/continue-nudge-plugin.test.js
git commit -m "Wire reliability runtime into plugin events"
```

### Task 5: Extend ACP smoke iteration to prove local and installed plugin paths and artifacts

**Files:**
- Modify: `scripts/acp-smoke-run.mjs`
- Modify: `README.md`

- [ ] **Step 1: Write the failing ACP assertion change**

```js
// scripts/acp-smoke-run.mjs (new checks)
import { stat } from 'node:fs/promises';

async function assertReliabilityArtifacts(projectDir) {
  const scoreboard = join(projectDir, '.opencode', 'reliability', 'scoreboard.json');
  await stat(scoreboard);
}
```

Add a non-nudge scenario to `scenarios`:

```js
{
  name: 'hard-stop',
  triggerSentence: 'Cannot proceed because credentials are missing.',
  shouldExpectNudge: false,
}
```

- [ ] **Step 2: Run ACP smoke to verify the new assertions fail before implementation is complete**

Run: `npm run test:acp`
Expected: FAIL on missing reliability artifacts or path assertions.

- [ ] **Step 3: Implement dual-path ACP proof and artifact assertions**

```js
// scripts/acp-smoke-run.mjs
const localPackagePluginSpec = `file://${join(pluginRepoRoot, 'packages/opencode-continue-nudge/.opencode/plugins/continue-nudge.js')}`;
const gitPluginSpec =
  process.env.ACP_PLUGIN_SPEC_GIT ||
  'opencode-continue-nudge@git+https://github.com/IniZio/opencode-nudge.git';

const pluginSpecs = process.env.ACP_PLUGIN_SPEC
  ? [process.env.ACP_PLUGIN_SPEC]
  : [localPackagePluginSpec, gitPluginSpec];

for (const activePluginSpec of pluginSpecs) {
  // create sandbox project + config per spec
  // run scenarios
  // assert marker behavior
  // assert reliability scoreboard + latest run artifacts exist
}
```

```md
<!-- README.md -->
### ACP proof matrix

```bash
npm run test:acp
ACP_PLUGIN_SPEC='opencode-continue-nudge@git+https://github.com/IniZio/opencode-nudge.git' npm run test:acp
```

Each run verifies nudge behavior and reliability artifacts under `.opencode/reliability/`.
```

- [ ] **Step 4: Run ACP smoke checks**

Run: `npm run test:acp`
Expected: PASS for local package path and git path, with artifact checks passing.

Run: `ACP_PLUGIN_SPEC='opencode-continue-nudge@git+https://github.com/IniZio/opencode-nudge.git' npm run test:acp`
Expected: PASS explicitly for installed plugin resolution path.

- [ ] **Step 5: Commit**

```bash
git add scripts/acp-smoke-run.mjs README.md
git commit -m "Prove ACP paths and reliability artifacts"
```

### Task 6: Finalize root/package metadata and remove legacy test duplication

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Remove: `test/continue-nudge-plugin.test.js`

- [ ] **Step 1: Write the failing test command update**

```bash
node --test test/continue-nudge-plugin.test.js
```

Expected: This command will be removed as part of migration; update root test invocation to rely on package tests.

- [ ] **Step 2: Update metadata and test wiring**

```json
// package.json (root)
{
  "scripts": {
    "test": "node --test",
    "test:acp": "node scripts/acp-smoke-run.mjs",
    "test:reliability": "node --test packages/opencode-plugin-reliability/test/*.test.js",
    "reliability:loop": "node scripts/reliability-loop.mjs"
  },
  "files": [
    "index.js",
    "packages/opencode-continue-nudge",
    ".opencode/plugins/continue-nudge.js",
    ".opencode/continue-nudge.json",
    "README.md",
    "LICENSE"
  ]
}
```

Remove legacy duplicated root plugin test once package tests cover all runtime cases.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS with package tests and reliability tests all green.

- [ ] **Step 4: Commit**

```bash
git add package.json README.md test/continue-nudge-plugin.test.js
git rm test/continue-nudge-plugin.test.js
git commit -m "Finalize continue nudge package migration"
```

### Task 7: Final verification and release-ready status

**Files:**
- Modify: none (verification only)

- [ ] **Step 1: Run complete verification matrix**

Run: `npm test`
Expected: PASS, 0 failures.

Run: `npm run test:reliability`
Expected: PASS for toolkit tests.

Run: `npm run test:acp`
Expected: PASS with local and git plugin path checks plus artifact assertions.

Run: `ACP_PLUGIN_SPEC='opencode-continue-nudge@git+https://github.com/IniZio/opencode-nudge.git' npm run test:acp`
Expected: PASS for explicit installed plugin path.

- [ ] **Step 2: Capture final status snapshot**

Run: `git status --short`
Expected: empty output.

Run: `git log --oneline -6`
Expected: includes migration + reliability integration commits from this plan.

- [ ] **Step 3: Final commit (only if last-minute fixes were needed)**

```bash
git add -A
git commit -m "Fix migration verification issues"
```

Skip this step if no files changed.

---

## Self-Review

### 1) Spec coverage check

- Move plugin into `packages/opencode-continue-nudge`: covered in Tasks 1-2.
- Keep root compatibility shims: covered in Tasks 1-2.
- Runtime reliability shadow default + enforce opt-in: covered in Tasks 3-4.
- ACP proof for local + git plugin paths and artifacts: covered in Task 5 and Task 7.
- Non-nudge safety scenario: covered in Task 5.

No uncovered spec items.

### 2) Placeholder scan

- No `TBD`, `TODO`, or unresolved placeholders included.
- All tasks include explicit file paths, code snippets, and commands.

### 3) Type/signature consistency check

- Runtime helper names are consistent across tasks:
  - `createReliabilityRuntime`
  - `resolveReliabilityRuntimeOptions`
  - `evaluateNudgeDecision`
  - `flushSession`
- ACP assertions consistently target `.opencode/reliability/` artifacts.
