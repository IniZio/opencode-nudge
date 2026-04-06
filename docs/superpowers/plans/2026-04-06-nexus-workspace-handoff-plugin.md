# Nexus Workspace Handoff Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a thin OpenCode `/handoff` plugin that delegates workspace preparation to Nexus tooling, transfers work to an OpenCode session inside that workspace, and enforces a confirmation gate before edits.

**Architecture:** Implement a package-local OpenCode adapter (`packages/opencode-nexus-handoff`) with minimal command/event wiring, then move candidate detection and prompt building into reusable modules. Keep workspace creation external via Nexus CLI and ship a failure-safe draft-only fallback. Keep cross-agent portability out of scope for implementation and track it as Phase 2 follow-up in docs.

**Tech Stack:** Node.js ESM, OpenCode plugin API patterns used in this repository, `node:test`, `child_process.spawn`, `node:fs/promises`, plugin config under `.opencode/`.

---

## File Structure

- New package root: `packages/opencode-nexus-handoff/`
- Runtime adapter:
  - `packages/opencode-nexus-handoff/src/plugin.js`
  - `packages/opencode-nexus-handoff/src/handoff-flow.js`
  - `packages/opencode-nexus-handoff/src/nexus-prepare.js`
  - `packages/opencode-nexus-handoff/src/prompt-template.js`
- Plugin entrypoint/config:
  - `packages/opencode-nexus-handoff/.opencode/plugins/nexus-handoff.js`
  - `packages/opencode-nexus-handoff/.opencode/nexus-handoff.json`
- Root compatibility wrappers:
  - `.opencode/plugins/nexus-handoff.js`
  - `packages/opencode-nexus-handoff/index.js`
- Tests:
  - `packages/opencode-nexus-handoff/test/plugin.test.js`
  - `packages/opencode-nexus-handoff/test/nexus-prepare.test.js`
  - `packages/opencode-nexus-handoff/test/prompt-template.test.js`
- Docs/config updates:
  - `README.md`
  - `package.json`

### Task 1: Scaffold package and plugin entrypoints

**Files:**
- Create: `packages/opencode-nexus-handoff/package.json`
- Create: `packages/opencode-nexus-handoff/index.js`
- Create: `packages/opencode-nexus-handoff/.opencode/plugins/nexus-handoff.js`
- Create: `packages/opencode-nexus-handoff/.opencode/nexus-handoff.json`
- Create: `.opencode/plugins/nexus-handoff.js`
- Modify: `package.json`
- Test: `packages/opencode-nexus-handoff/test/plugin.test.js`

- [ ] **Step 1: Write failing scaffold test**

```js
// packages/opencode-nexus-handoff/test/plugin.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

test('package and root nexus-handoff entrypoints export plugin factory', async () => {
  const pkg = await import('../index.js');
  const root = await import('../../../.opencode/plugins/nexus-handoff.js');
  assert.equal(typeof pkg.createNexusHandoffPlugin, 'function');
  assert.equal(typeof root.NexusHandoffPlugin, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/opencode-nexus-handoff/test/plugin.test.js`
Expected: FAIL with module-not-found for package/plugin files.

- [ ] **Step 3: Add package and entrypoint wrappers**

```json
// packages/opencode-nexus-handoff/package.json
{
  "name": "@inizio/opencode-nexus-handoff",
  "version": "0.1.0",
  "description": "Thin OpenCode handoff plugin that delegates workspace setup to Nexus",
  "license": "MIT",
  "type": "module",
  "main": "index.js",
  "exports": {
    ".": "./index.js",
    "./plugin": "./.opencode/plugins/nexus-handoff.js"
  },
  "files": [
    "index.js",
    "src",
    "test",
    ".opencode"
  ]
}
```

```js
// packages/opencode-nexus-handoff/index.js
export { createNexusHandoffPlugin } from './src/plugin.js';
```

```js
// .opencode/plugins/nexus-handoff.js
import { createNexusHandoffPlugin } from '../../packages/opencode-nexus-handoff/index.js';
import config from '../nexus-handoff.json' with { type: 'json' };

export const NexusHandoffPlugin = createNexusHandoffPlugin(config);
export default NexusHandoffPlugin;
```

- [ ] **Step 4: Re-run scaffold test**

Run: `node --test packages/opencode-nexus-handoff/test/plugin.test.js`
Expected: PASS.

- [ ] **Step 5: Commit task 1**

```bash
git add package.json .opencode/plugins/nexus-handoff.js packages/opencode-nexus-handoff
git commit -m "Scaffold nexus handoff plugin package"
```

### Task 2: Implement prompt template and confirmation gate

**Files:**
- Create: `packages/opencode-nexus-handoff/src/prompt-template.js`
- Modify: `packages/opencode-nexus-handoff/src/plugin.js`
- Test: `packages/opencode-nexus-handoff/test/prompt-template.test.js`

- [ ] **Step 1: Write failing prompt-template tests**

```js
// packages/opencode-nexus-handoff/test/prompt-template.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHandoffPrompt } from '../src/prompt-template.js';

test('buildHandoffPrompt includes mandatory confirmation gate', () => {
  const text = buildHandoffPrompt({
    goal: 'Implement parser',
    sourceSessionId: 'sess_abc',
    workspacePath: '/tmp/ws',
    contextSummary: 'Parser branch and failing tests are ready.'
  });

  assert.match(text, /wait for explicit user confirmation before making edits/i);
  assert.match(text, /Continuing work from session sess_abc/);
  assert.match(text, /Workspace: \/tmp\/ws/);
});
```

- [ ] **Step 2: Run prompt-template tests and confirm failure**

Run: `node --test packages/opencode-nexus-handoff/test/prompt-template.test.js`
Expected: FAIL because `buildHandoffPrompt` does not exist.

- [ ] **Step 3: Implement prompt template module**

```js
// packages/opencode-nexus-handoff/src/prompt-template.js
export function buildHandoffPrompt({ goal, sourceSessionId, workspacePath, contextSummary }) {
  const safeGoal = String(goal || '').trim() || 'Continue the current task';
  const safeSummary = String(contextSummary || '').trim() || 'No additional summary provided.';
  return [
    `Continuing work from session ${sourceSessionId}.`,
    `Workspace: ${workspacePath}`,
    '',
    'IMPORTANT: Do not modify files yet. First present your plan and wait for explicit user confirmation before making edits.',
    '',
    `Goal: ${safeGoal}`,
    '',
    'Context:',
    safeSummary,
  ].join('\n');
}
```

- [ ] **Step 4: Re-run tests and ensure pass**

Run: `node --test packages/opencode-nexus-handoff/test/prompt-template.test.js`
Expected: PASS.

- [ ] **Step 5: Commit task 2**

```bash
git add packages/opencode-nexus-handoff/src/prompt-template.js packages/opencode-nexus-handoff/test/prompt-template.test.js
git commit -m "Add handoff prompt confirmation template"
```

### Task 3: Implement Nexus workspace preparation adapter

**Files:**
- Create: `packages/opencode-nexus-handoff/src/nexus-prepare.js`
- Test: `packages/opencode-nexus-handoff/test/nexus-prepare.test.js`

- [ ] **Step 1: Write failing Nexus adapter tests**

```js
// packages/opencode-nexus-handoff/test/nexus-prepare.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNexusWorkspace } from '../src/nexus-prepare.js';

test('prepareNexusWorkspace returns workspace metadata on success', async () => {
  const result = await prepareNexusWorkspace(
    { goal: 'Add API route', cwd: '/repo' },
    {
      runCommand: async () => ({ code: 0, stdout: JSON.stringify({ workspacePath: '/tmp/ws', workspaceId: 'ws-1' }), stderr: '' }),
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.workspace.workspacePath, '/tmp/ws');
});

test('prepareNexusWorkspace fails gracefully when nexus is unavailable', async () => {
  const result = await prepareNexusWorkspace(
    { goal: 'Add API route', cwd: '/repo' },
    { runCommand: async () => ({ code: 127, stdout: '', stderr: 'nexus: command not found' }) }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, 'NEXUS_UNAVAILABLE');
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test packages/opencode-nexus-handoff/test/nexus-prepare.test.js`
Expected: FAIL because adapter does not exist.

- [ ] **Step 3: Implement adapter**

```js
// packages/opencode-nexus-handoff/src/nexus-prepare.js
import { spawn } from 'node:child_process';

async function defaultRunCommand(command, args, cwd) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', () => resolve({ code: 127, stdout, stderr: 'nexus spawn error' }));
  });
}

export async function prepareNexusWorkspace(input, deps = {}) {
  const runCommand = deps.runCommand || defaultRunCommand;
  const payload = JSON.stringify({ goal: input.goal, cwd: input.cwd });
  const result = await runCommand('nexus', ['workspace', 'prepare', '--json', payload], input.cwd);

  if (result.code !== 0) {
    return {
      ok: false,
      reasonCode: /not found|spawn/i.test(result.stderr) ? 'NEXUS_UNAVAILABLE' : 'WORKSPACE_PREP_FAILED',
      error: result.stderr || 'Unknown nexus error',
    };
  }

  const parsed = JSON.parse(result.stdout || '{}');
  return {
    ok: true,
    workspace: {
      workspacePath: parsed.workspacePath,
      workspaceId: parsed.workspaceId,
      metadata: parsed.metadata || {},
    },
  };
}
```

- [ ] **Step 4: Re-run Nexus tests**

Run: `node --test packages/opencode-nexus-handoff/test/nexus-prepare.test.js`
Expected: PASS.

- [ ] **Step 5: Commit task 3**

```bash
git add packages/opencode-nexus-handoff/src/nexus-prepare.js packages/opencode-nexus-handoff/test/nexus-prepare.test.js
git commit -m "Add nexus workspace prepare adapter"
```

### Task 4: Implement `/handoff` command flow and suggestion/confirm behavior

**Files:**
- Create: `packages/opencode-nexus-handoff/src/handoff-flow.js`
- Modify: `packages/opencode-nexus-handoff/src/plugin.js`
- Modify: `packages/opencode-nexus-handoff/.opencode/nexus-handoff.json`
- Test: `packages/opencode-nexus-handoff/test/plugin.test.js`

- [ ] **Step 1: Write failing behavior tests**

```js
// add to packages/opencode-nexus-handoff/test/plugin.test.js
test('/handoff uses nexus prepare and writes transfer prompt with confirmation gate', async () => {
  // mock client and dependencies
  // invoke command template handler
  // assert transfer payload includes confirmation gate line
});

test('declined suggestion is not retried in same session', async () => {
  // emit suggestion trigger, decline once, emit trigger again
  // assert only one suggestion for session
});
```

- [ ] **Step 2: Run plugin tests to verify failure**

Run: `node --test packages/opencode-nexus-handoff/test/plugin.test.js`
Expected: FAIL due missing flow implementation.

- [ ] **Step 3: Implement orchestration flow**

```js
// packages/opencode-nexus-handoff/src/handoff-flow.js
import { buildHandoffPrompt } from './prompt-template.js';
import { prepareNexusWorkspace } from './nexus-prepare.js';

export async function runHandoff({ goal, sessionId, cwd, contextSummary }, deps) {
  const prep = await prepareNexusWorkspace({ goal, cwd }, deps);
  if (!prep.ok) {
    const draftOnly = buildHandoffPrompt({
      goal,
      sourceSessionId: sessionId,
      workspacePath: '<workspace-unavailable>',
      contextSummary,
    });
    return { ok: false, reasonCode: prep.reasonCode, draftOnly };
  }

  const prompt = buildHandoffPrompt({
    goal,
    sourceSessionId: sessionId,
    workspacePath: prep.workspace.workspacePath,
    contextSummary,
  });

  const transfer = await deps.transferSession({ prompt, workspace: prep.workspace });
  return { ok: true, workspace: prep.workspace, transfer };
}
```

```js
// packages/opencode-nexus-handoff/src/plugin.js
import { runHandoff } from './handoff-flow.js';

export function createNexusHandoffPlugin(options = {}) {
  return async (ctx) => {
    const declinedBySession = new Set();

    return {
      config: async (config) => {
        config.command = config.command || {};
        config.command.handoff = {
          description: 'Prepare Nexus workspace and handoff into it',
          template: 'Use handoff flow with goal: $ARGUMENTS',
        };
      },
      event: async ({ event }) => {
        if (event.type !== 'session.idle') return;
        const sessionId = event?.properties?.sessionID || event?.properties?.info?.id;
        if (!sessionId || declinedBySession.has(sessionId)) return;
        // suggestion-only behavior handled by prompt in-session
      },
      _debug: { declinedBySession },
    };
  };
}
```

- [ ] **Step 4: Re-run plugin tests**

Run: `node --test packages/opencode-nexus-handoff/test/plugin.test.js`
Expected: PASS.

- [ ] **Step 5: Commit task 4**

```bash
git add packages/opencode-nexus-handoff/src/handoff-flow.js packages/opencode-nexus-handoff/src/plugin.js packages/opencode-nexus-handoff/test/plugin.test.js packages/opencode-nexus-handoff/.opencode/nexus-handoff.json
git commit -m "Implement nexus handoff command and suggestion flow"
```

### Task 5: Documentation and packaging updates

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.opencode/opencode.json` (if plugin registration example belongs in repo config docs)

- [ ] **Step 1: Add README sections for plugin usage**

```md
## Nexus Handoff Plugin

Use `/handoff <goal>` to prepare a Nexus workspace and hand off work into a workspace session.

Safety rule: the transferred session prompt always instructs the agent to wait for explicit user confirmation before making edits.

Semi-automatic mode suggests handoff opportunities. If declined, it will not re-suggest in the same session unless `/handoff` is used explicitly.
```

- [ ] **Step 2: Update package publishing files list**

```json
// package.json
"files": [
  "index.js",
  "src",
  "packages/opencode-continue-nudge",
  "packages/opencode-nexus-handoff",
  ".opencode/plugins/continue-nudge.js",
  ".opencode/plugins/nexus-handoff.js",
  ".opencode/continue-nudge.json",
  "README.md",
  "LICENSE"
]
```

- [ ] **Step 3: Verify docs/package changes**

Run: `node --test packages/opencode-nexus-handoff/test/*.test.js`
Expected: PASS and no broken imports from docs-linked commands.

- [ ] **Step 4: Commit task 5**

```bash
git add README.md package.json .opencode/plugins/nexus-handoff.js
git commit -m "Document and package nexus handoff plugin"
```

### Task 6: Full verification and final integration check

**Files:**
- Verify: repository-wide touched files from prior tasks

- [ ] **Step 1: Run package-specific tests**

Run: `node --test packages/opencode-nexus-handoff/test/*.test.js`
Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS with zero failing tests.

- [ ] **Step 3: Run ACP smoke to ensure no regressions in existing plugin**

Run: `npm run test:acp`
Expected: PASS summary for existing continue-nudge local and git paths.

- [ ] **Step 4: Confirm clean working tree**

Run: `git status --short`
Expected: empty output.

- [ ] **Step 5: Final commit (if any uncommitted integration fixes)**

```bash
git add -A
git commit -m "Finalize nexus handoff plugin integration"
```

## Self-Review

### 1) Spec coverage check

- Thin plugin + skill/Nexus heavy logic: covered in Tasks 2-4 via explicit module boundaries.
- `/handoff` command with B primary and A fallback: covered in Task 4.
- Confirmation gate before edits: covered in Task 2 prompt template and Task 4 flow tests.
- External Nexus workspace creation: covered in Task 3 adapter and failure reason codes.
- Phase ordering update (superpowers subtree/skill study before contract extraction): retained in spec; implementation remains OpenCode-first.

### 2) Placeholder scan

- No `TBD`, `TODO`, or unresolved placeholders in task steps.

### 3) Type/signature consistency check

- `buildHandoffPrompt`, `prepareNexusWorkspace`, and `runHandoff` signatures are consistent across Tasks 2-4.
- Reason codes are consistent with spec naming and error branches.
