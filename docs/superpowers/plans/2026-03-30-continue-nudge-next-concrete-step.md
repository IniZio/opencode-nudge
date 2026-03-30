# Continue Nudge Next Concrete Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect `Next concrete step I can do now:` style permission-seeking phrasing and enable global semantic fallback using the small model.

**Architecture:** Extend the existing targeted regex matcher list in `src/continue-nudge-plugin.js` with one narrow pattern for the observed phrase family, then update the shared plugin config at `.opencode/continue-nudge.json` to enable semantic fallback globally. Validate behavior with focused unit tests in `test/continue-nudge-plugin.test.js` and run the full test suite.

**Tech Stack:** Node.js ESM, `node:test`, OpenCode plugin runtime API.

---

### Task 1: Add Targeted Regex Coverage for "Next Concrete Step"

**Files:**
- Modify: `src/continue-nudge-plugin.js`
- Test: `test/continue-nudge-plugin.test.js`

- [ ] **Step 1: Write the failing test case in the existing phrase coverage test**

In `test/continue-nudge-plugin.test.js`, inside the `phrases` array in test `shouldNudge catches multiple common permission-seeking phrasings`, add:

```js
'Next concrete step I can do now: implement the remaining handlers.',
```

- [ ] **Step 2: Run the focused test to verify it fails first**

Run:

```bash
node --test --test-name-pattern="shouldNudge catches multiple common permission-seeking phrasings"
```

Expected: FAIL for the new phrase because current regexes do not explicitly match `next concrete step ...`.

- [ ] **Step 3: Add minimal regex implementation**

In `src/continue-nudge-plugin.js`, append this pattern to `BASE_PERMISSION_SEEKING_PATTERNS` near the existing next-step patterns:

```js
/\bnext\s+concrete\s+step\s+i\s+can\s+do\s+now:?\b/i,
```

Place it after:

```js
/\bnext\s+high[-\s]?value\s+step:?\b/i,
```

and before:

```js
/\bnatural next steps:?\b/i,
```

- [ ] **Step 4: Re-run focused test to verify pass**

Run:

```bash
node --test --test-name-pattern="shouldNudge catches multiple common permission-seeking phrasings"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1 changes**

Run:

```bash
git add test/continue-nudge-plugin.test.js src/continue-nudge-plugin.js
git commit -m "feat: detect next concrete step continuation phrasing"
```

Expected: Commit created with test + implementation together.

### Task 2: Enable Global Semantic Fallback in Shared Plugin Config

**Files:**
- Modify: `.opencode/continue-nudge.json`
- Test: `test/continue-nudge-plugin.test.js`

- [ ] **Step 1: Write failing config expectation test**

In `test/continue-nudge-plugin.test.js`, keep the existing unit assertion for `resolveContinueNudgeOptions()` default behavior unchanged:

```js
assert.equal(config.semanticFallback.enabled, false);
```

Then add a new integration-style config load test that reads `.opencode/continue-nudge.json` and asserts enabled true, small model, in_session mode, timeout 4000, max checks 1:

```js
test('repository default config enables semantic fallback with small model', async () => {
  const config = await loadContinueNudgeConfig('.opencode/continue-nudge.json');
  assert.equal(config.semanticFallback.enabled, true);
  assert.equal(config.semanticFallback.model, 'github-copilot/gpt-5.1-codex-mini');
  assert.equal(config.semanticFallback.mode, 'in_session');
  assert.equal(config.semanticFallback.timeoutMs, 4000);
  assert.equal(config.semanticFallback.maxChecksPerSession, 1);
});
```

- [ ] **Step 2: Run focused config tests and verify initial failure**

Run:

```bash
node --test --test-name-pattern="repository default config enables semantic fallback with small model"
```

Expected: FAIL because `.opencode/continue-nudge.json` currently has `enabled: false`.

- [ ] **Step 3: Update global plugin config with minimal changes**

In `.opencode/continue-nudge.json`, change only:

```json
"enabled": false
```

to:

```json
"enabled": true
```

Keep these unchanged:

```json
"model": "github-copilot/gpt-5.1-codex-mini",
"mode": "in_session",
"timeoutMs": 4000,
"maxChecksPerSession": 1
```

- [ ] **Step 4: Re-run focused config tests to verify pass**

Run:

```bash
node --test --test-name-pattern="repository default config enables semantic fallback with small model"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2 changes**

Run:

```bash
git add .opencode/continue-nudge.json test/continue-nudge-plugin.test.js
git commit -m "chore: enable semantic fallback in default plugin config"
```

Expected: Commit created with config and coverage updates.

### Task 3: Full Verification

**Files:**
- Modify: none
- Test: `test/continue-nudge-plugin.test.js`

- [ ] **Step 1: Run complete test suite**

Run:

```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 2: Verify working tree is clean except intended changes/commits**

Run:

```bash
git status --short
```

Expected: No unexpected modified files.

- [ ] **Step 3: Produce implementation summary for handoff**

Summarize:

- Added targeted `next concrete step ... i can do now` regex coverage.
- Enabled semantic fallback globally in `.opencode/continue-nudge.json`.
- Added/updated tests that verify phrase detection and global config semantics.
- Confirmed full suite passes.

- [ ] **Step 4: Final verification commit (only if Task 3 introduced code changes)**

If no files changed in Task 3, skip commit. If any test-related snapshots or fixtures changed, commit with:

```bash
git add <exact-files>
git commit -m "test: finalize continue nudge verification updates"
```
