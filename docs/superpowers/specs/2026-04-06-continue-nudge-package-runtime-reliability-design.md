# Continue-Nudge Package Migration and Runtime Reliability Integration Design

## Overview

This design updates the continue-nudge system so the plugin is a first-class package under `packages/`, integrates runtime reliability scoring using the reliability toolkit, and proves correctness through ACP iteration.

Goals:

1. Move continue-nudge into `packages/opencode-continue-nudge` as the canonical implementation.
2. Keep existing local workflows working via root compatibility shims.
3. Integrate reliability runtime in `shadow` mode by default, with opt-in `enforce` mode.
4. Prove local and installed plugin behavior via ACP scenarios plus reliability artifacts.

Out of scope:

- Replacing the existing continue-nudge detection semantics.
- Enforcing hard CI failure for all score dips.

## Confirmed Decisions

- Packaging target: move continue-nudge into `packages/opencode-continue-nudge`.
- Runtime integration mode: both supported, with `shadow` as default and `enforce` opt-in.
- ACP proof requirement: validate local file plugin path and git install plugin path.
- Reliability signals stay strict 1-turn for:
  - `post_nudge_user_correction`
  - `post_no_nudge_user_prompt_to_continue`

## Architecture

### Package Structure

Canonical implementation:

- `packages/opencode-continue-nudge/`
  - `package.json`
  - `src/continue-nudge-plugin.js`
  - plugin tests
  - package-local defaults/config assets where needed

Existing reliability toolkit remains:

- `packages/opencode-plugin-reliability/`

Compatibility layer at repo root:

- `.opencode/plugins/continue-nudge.js` remains as entrypoint but delegates to package implementation.
- Root scripts remain available and route to package-based logic.

### Runtime Reliability Wiring

Continue-nudge runtime records canonical event data per session and hands normalized data to reliability profile scoring.

Default behavior (`shadow`):

- Nudge behavior remains unchanged.
- Reliability scoring and artifact writing run alongside behavior.

Opt-in behavior (`enforce`):

- Policy output can influence whether a nudge is sent.
- Safety fallback: on reliability/policy error, behavior reverts to shadow semantics.

### Configuration Additions

Add `reliabilityRuntime` block to continue-nudge config:

```json
{
  "reliabilityRuntime": {
    "enabled": true,
    "mode": "shadow",
    "artifactRoot": ".opencode/reliability",
    "flushOnSessionEnd": true
  }
}
```

Mode values:

- `shadow` (default)
- `enforce`

## Data Flow

1. Continue-nudge receives ACP/OpenCode session events.
2. Runtime tracks assistant/user turns and nudge decisions.
3. At session end (or explicit flush), canonical events are scored through continue-nudge profile logic.
4. Artifacts are persisted under `.opencode/reliability/runs/<runId>/`.
5. Scoreboard and run summary are updated.
6. If `enforce`, policy decision may alter nudge action for subsequent decisions in-session.

## ACP Proof Workflow

ACP iteration must prove both plugin-resolution paths:

1. Local file path plugin:
   - `ACP_PLUGIN_SPEC=file://.../packages/opencode-continue-nudge/...`
2. Installed plugin spec path:
   - `ACP_PLUGIN_SPEC='opencode-continue-nudge@git+https://...'`

For each path, ACP asserts:

- expected continuation nudge marker exists,
- continuation action executed (`ACP_OK.txt` check),
- reliability artifacts written,
- run verdict and reason codes emitted.

Include one explicit non-nudge scenario (hard-stop or user opt-out) to prove safe behavior.

## Error Handling

- Reliability integration must never crash continue-nudge runtime.
- Artifact write failures log and continue without blocking nudge processing.
- Policy evaluation failures in enforce mode fall back to shadow behavior.

## Testing Strategy

1. Package migration tests
   - Root shim resolves package implementation.
   - Existing plugin entry path remains valid.
2. Runtime reliability tests
   - Shadow mode: no behavior change, artifacts produced.
   - Enforce mode: policy can influence nudge path.
   - Enforce failure fallback behaves as shadow.
3. Reliability regression tests
   - strict 1-turn FP/FN labels remain correct after migration.
4. ACP integration tests
   - pass for local file path plugin.
   - pass for git install path plugin.

## Verification Commands

- `npm test`
- `npm run test:reliability`
- `npm run test:acp`
- `ACP_PLUGIN_SPEC='opencode-continue-nudge@git+https://github.com/IniZio/opencode-nudge.git' npm run test:acp`

## Rollout

Phase 1:

- Move plugin to `packages/opencode-continue-nudge` with root compatibility.
- Wire shadow-mode runtime reliability and artifact output.
- Update ACP for dual-path proof and artifact assertions.

Phase 2:

- Enable enforce mode via config with guarded fallback behavior.
- Tune policy thresholds from ACP/reliability run evidence.
