---
name: opencode-plugin-reliability-loop
description: Use when iterating OpenCode plugin behavior and you need scored artifacts, baseline comparison, and regression-aware next-step guidance.
---

# OpenCode Plugin Reliability Loop

## Overview

Use this workflow to tune plugin behavior with fast, repeatable scoring.

## Loop

1. Generate a fresh session export JSON.
2. Run `npm run reliability:loop -- --export <session-export.json>`.
3. Review latest report in `.opencode/reliability/runs/<run-id>/report.md`.
4. Check trend and baseline in `.opencode/reliability/scoreboard.json`.
5. Fix highest-impact reason code and rerun.

## Strict Labels

- `post_nudge_user_correction` (strong false-positive evidence)
- `post_no_nudge_user_prompt_to_continue` (strong false-negative evidence)

Both labels use a strict 1-turn window for user feedback.

## Soft Gate

- Fail on ACP smoke failure.
- Fail on strong score regression.
- Warn on mild score regression.
- Pass when no strong regression exists.

## Artifacts

- `.opencode/reliability/runs/<run-id>/run.json`
- `.opencode/reliability/runs/<run-id>/events.jsonl`
- `.opencode/reliability/runs/<run-id>/labels.json`
- `.opencode/reliability/runs/<run-id>/scores.json`
- `.opencode/reliability/runs/<run-id>/diff-vs-baseline.json`
- `.opencode/reliability/runs/<run-id>/report.md`
- `.opencode/reliability/scoreboard.json`
