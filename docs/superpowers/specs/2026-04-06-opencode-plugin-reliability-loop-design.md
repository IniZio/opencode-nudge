# OpenCode Plugin Reliability Loop Design

## Overview

Design a reusable OpenCode skill + publishable toolkit package that helps plugin developers run fast, quantified reliability iteration loops and detect regressions across runs.

Primary goals:

1. Shorten iteration time from missed behavior to verified fix.
2. Persist well-organized artifacts between runs.
3. Quantify whether tuning improved or regressed reliability.
4. Generalize beyond continue-nudge so other OpenCode plugin developers can adopt it.

Out of scope for v1:

- Building a broad runtime intervention framework first.
- Solving every plugin-specific detection problem automatically.

## Confirmed Product Decisions

- Preferred approach: harness-first core + adapters.
- Deliverable type: both reusable skill + reusable toolkit package.
- Center of gravity for v1: dev harness first; runtime hooks are secondary.
- Primary KPI: Reliability Score.
- User-feedback signal rules:
  - If plugin nudges and the next user turn immediately corrects direction, count as strong false-positive evidence.
  - If plugin does not nudge and the next user turn asks to continue, count as strong false-negative evidence.
- Immediate window definition: strict 1-turn window.
- Artifact location: `.opencode/reliability/runs/<timestamp>/` with rolling summary in `.opencode/reliability/scoreboard.json`.
- Distribution target: publishable package + reusable skill docs.
- Gate type: soft gate (hard fail only for strong regressions and ACP smoke failure).
- Package namespace assumption: scoped package under user/org (example: `@inizio/opencode-plugin-reliability`).

## Architecture

### Package Layout

`packages/opencode-plugin-reliability` (publishable):

- `normalize/`: converts ACP/session traces into canonical events.
- `signal/`: applies strict labeling rules and reason codes.
- `score/`: computes component metrics and Reliability Score.
- `artifacts/`: writes run files and updates scoreboard.
- `gate/`: compares against baseline and returns soft-gate verdict.
- `profiles/`: plugin-specific adapters (start with continue-nudge).
- `cli/`: command entrypoint for local and CI usage.

### System Flow

1. Ingest raw run input (ACP output, exported session JSON, diagnostics output).
2. Normalize into canonical event stream.
3. Apply profile labeler (TP/FP/FN/ignored + reason code).
4. Compute component metrics.
5. Compute weighted Reliability Score.
6. Persist run artifacts.
7. Compare current run to baseline.
8. Produce gate verdict and recommended next experiment.

## Toolkit API Design

### Core API

- `createReliabilityRunner(config)`
  - Orchestrates normalize -> label -> score -> artifacts -> gate.
- `runReliabilitySuite({ profile, inputs, baselineRef })`
  - One-shot local/CI run.
- `compareRuns({ current, baseline, thresholds })`
  - Generates structured regression classification.

### Profile Contract

Each plugin profile implements:

- `normalize(raw) => CanonicalEvent[]`
- `label(events) => LabelSet`
- `score(labels, context) => ScoreBreakdown`
- `policy(context) => PolicyDecision` (optional; can return no-op)

This contract makes plugin-specific logic swappable while preserving a stable loop/toolchain.

### CLI

- `opencode-reliability run --profile <name> --input <path>`
- `opencode-reliability score --run <path>`
- `opencode-reliability gate --run <path> --baseline <ref>`
- `opencode-reliability report --run <path>`

## Reliability Score Model

Reliability Score is the primary KPI and is a weighted blend of:

1. Continuation success.
2. False-positive control.
3. Hard-stop respect.
4. ACP smoke status.
5. Immediate user feedback correction/miss signals.

### Label Rules (Strict)

- `post_nudge_user_correction`:
  - Trigger: plugin nudges, and the next user turn indicates wrong direction.
  - Interpretation: strong FP evidence.
- `post_no_nudge_user_prompt_to_continue`:
  - Trigger: no nudge, and the next user turn asks to continue.
  - Interpretation: strong FN evidence.

Both rules apply only in a strict 1-turn window after the relevant assistant/plugin state.

## Artifact and Reporting Model

### Per-Run Files

Under `.opencode/reliability/runs/<timestamp>/`:

- `run.json`: config, profile, commit SHA, thresholds, environment.
- `events.jsonl`: normalized canonical event stream.
- `labels.json`: TP/FP/FN/ignored with reason codes.
- `scores.json`: score components and weighted total.
- `diff-vs-baseline.json`: deltas and regression class.
- `report.md`: concise human-readable narrative and next recommendation.

### Rolling Summary

`.opencode/reliability/scoreboard.json` stores:

- run index and chronology,
- active baseline reference,
- trend indicators,
- best stable run metadata,
- recent warning/failure reasons.

## Soft-Gate Policy

### Fail Conditions

- ACP smoke failure.
- Strong Reliability Score regression beyond configured threshold.

### Warn Conditions

- Mild Reliability Score dip.
- Non-fatal profile-specific regressions.

### Pass Conditions

- No strong regressions and ACP smoke passes.

Gate output always includes machine-readable reason codes and a one-step recommended follow-up.

## Skill Design (Reusable by Other Plugin Teams)

### New Generic Skill

Proposed skill: `opencode-plugin-reliability-loop`.

Purpose: run an end-to-end reliability iteration loop for any OpenCode plugin profile.

Loop sequence:

1. Run scenario suite (ACP/manual fixtures).
2. Generate artifacts and score.
3. Compare against baseline.
4. Produce next tuning suggestion ranked by likely impact.
5. Repeat.

Requirements:

- Reads scoreboard trends before making recommendations.
- Emits one concrete next-step action (not a generic list).
- Works with any plugin profile implementing the 4-function contract.

### Continue-Nudge Profile as First Example

The current repository keeps continue-nudge checks, but maps them through the generic pipeline:

- `npm run test:acp`
- `npm run check:nudge`

This provides immediate backward compatibility and a concrete adoption example.

## Error Handling Strategy

- Artifact writes are fail-open where possible: partial outputs still written.
- Gate verdicts are fail-closed only for explicit fail criteria.
- Deterministic reason codes for triage, including:
  - `INPUT_PARSE_ERROR`
  - `PROFILE_LABEL_ERROR`
  - `BASELINE_MISSING`
  - `GATE_STRONG_REGRESSION`

## Testing Strategy

1. Unit tests
   - normalize/label/score logic,
   - strict 1-turn feedback signal rules,
   - gate thresholds and reason-code outputs.
2. Golden tests
   - artifact schema and report stability.
3. Integration tests
   - ACP end-to-end regression flow.
4. Profile contract tests
   - reusable validation for third-party plugin profiles.

## Rollout Plan

### Phase 1

- Implement toolkit package skeleton + CLI.
- Add continue-nudge profile adapter.
- Add generic reliability loop skill docs.

### Phase 2

- Add one non-nudge sample profile to prove generality.
- Tighten defaults from real run data.

### Phase 3

- Publish CI templates and adoption guide.
- Publish package and versioning policy.

## Risks and Mitigations

- Overfitting to continue-nudge behavior.
  - Mitigation: profile contract + second profile in phase 2.
- Noisy score movement from small sample sizes.
  - Mitigation: baseline quality checks and trend windows.
- Confusion between advisory vs fail criteria.
  - Mitigation: explicit reason codes and gate policy table.

## Open Items

- Confirm final npm scope string before publishing.
- Confirm default component weights for Reliability Score during implementation planning.
