# Continue Nudge Pattern and Global Semantic Fallback Design

## Context

The plugin currently detects permission-seeking stop language through preset regex patterns and an optional semantic fallback classifier. A new phrasing was observed in live use:

- `Next concrete step I can do now:`

The desired behavior is:

1. Detect this phrase family as permission-seeking continuation language.
2. Enable semantic fallback globally.
3. Keep the small classifier model (`github-copilot/gpt-5.1-codex-mini`).

## Goals

- Catch `Next concrete step I can do now:` with deterministic regex matching.
- Keep existing guardrails (hard-stop and user opt-out) unchanged.
- Enable semantic fallback in project config to catch long-tail phrasing not covered by regex.
- Preserve current runtime cost and latency profile.

## Non-Goals

- Broadly generalize all `next step` language.
- Change semantic fallback model, timeout, or check count.
- Alter event subscription behavior or nudge cadence.

## Design

### 1) Detection Logic Update (Targeted Regex)

Update `BASE_PERMISSION_SEEKING_PATTERNS` in `src/continue-nudge-plugin.js` with a targeted pattern for the newly observed phrase family.

Proposed matcher intent:

- Match language starting with `next concrete step` and a first-person action offer like `I can do now`.
- Preserve the current targeted style to reduce false positives.

Expected result:

- `shouldNudge(...)` returns `true` for assistant text like `Next concrete step I can do now:` when no hard-stop/opt-out applies.

### 2) Global Semantic Fallback Enablement

Update `.opencode/continue-nudge.json`:

- Set `semanticFallback.enabled` from `false` to `true`.
- Keep:
  - `model: github-copilot/gpt-5.1-codex-mini`
  - `mode: in_session`
  - `timeoutMs: 4000`
  - `maxChecksPerSession: 1`

This keeps classifier behavior cheap and conservative while adding long-tail coverage.

### 3) Validation Plan

Update/add tests in `test/continue-nudge-plugin.test.js` to verify:

- Positive detection for `Next concrete step I can do now:`.
- Existing hard-stop behavior still blocks nudges.
- Existing user opt-out behavior still blocks nudges.

Run:

```bash
npm test
```

## Risks and Mitigations

- Risk: New regex over-matches unrelated text.
  - Mitigation: Keep matcher specific to `next concrete step` phrasing and verify with focused tests.
- Risk: Semantic fallback adds extra runtime checks.
  - Mitigation: Keep `maxChecksPerSession: 1` and existing candidate gate logic.
- Risk: Duplicate nudges from mixed regex+semantic paths.
  - Mitigation: Existing fingerprint dedupe and nudge count limits remain unchanged.

## Rollout

1. Apply regex and config updates.
2. Run test suite.
3. Validate in a real OpenCode session with `npm run check:nudge -- <session-id>` when needed.

## Success Criteria

- The phrase `Next concrete step I can do now:` is detected and nudged when appropriate.
- Semantic fallback is enabled globally with the small model.
- All existing tests pass and updated tests cover the new behavior.
