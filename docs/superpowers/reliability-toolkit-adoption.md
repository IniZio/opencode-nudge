# Reliability Toolkit Adoption

This guide shows how other OpenCode plugin teams can reuse this reliability toolkit.

## Install

```bash
npm install @inizio/opencode-plugin-reliability
```

## Profile Contract

Implement a profile object with:

- `normalize(raw) => CanonicalEvent[]`
- `label(events) => LabelSet`
- `score(labels, context) => ScoreBreakdown`
- `policy(context) => PolicyDecision` (optional)

## CLI Usage

```bash
opencode-reliability run --profile continue-nudge --input session-export.json
opencode-reliability score --labels labels.json
opencode-reliability gate --current 78 --baseline 82
opencode-reliability report --current 78 --baseline 82
```

## Artifact Layout

- `.opencode/reliability/runs/<run-id>/run.json`
- `.opencode/reliability/runs/<run-id>/events.jsonl`
- `.opencode/reliability/runs/<run-id>/labels.json`
- `.opencode/reliability/runs/<run-id>/scores.json`
- `.opencode/reliability/runs/<run-id>/diff-vs-baseline.json`
- `.opencode/reliability/runs/<run-id>/report.md`
- `.opencode/reliability/scoreboard.json`

## Recommended CI Policy

- Fail build when gate verdict is `fail`.
- Keep build warning-only when verdict is `warn`.
- Track score trend using `scoreboard.json` over the last N runs.
