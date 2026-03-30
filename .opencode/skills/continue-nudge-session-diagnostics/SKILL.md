# Skill: continue-nudge-session-diagnostics

Diagnose whether continue-nudge is active in the current or recent OpenCode chat session.

This skill should run on autopilot: it performs all checks itself and returns findings. No manual steps are required unless a command fails due to environment issues.

## Goal

Answer these clearly:
1. Did the plugin load?
2. Did it inject `CONTINUE_NUDGE_PLUGIN` nudges?
3. Which assistant messages look permission-seeking and likely triggered nudges?

## Inputs

- Optional session id (`ses_...`).
- Optional scope choice (`current/recent`).

If scope/session is not provided, use the most recent session automatically.

## Procedure

### 1) Run diagnostics script directly

```bash
npm run check:nudge -- <session-id>
```

If session id is unknown, run:

```bash
npm run check:nudge
```

The script auto-selects the newest session.

Interpretation:
- `pluginLikelyLoaded: true` means plugin load lines were seen in debug config output.
- `nudgeMarkers > 0` means nudge injections occurred.
- `permissionLikeAssistantMessages > 0` means assistant emitted likely stop-prone phrasing.
- `looksWorking: true` means plugin behavior is visible in that session.

Also report `lastAssistant` from the script output to show where the session ended.

### 2) Return a concise diagnosis

Return:
- Session id inspected
- Whether plugin loaded
- Number of nudge markers
- Final verdict (`working` / `not_observed_in_this_session` / `misconfigured_or_not_loaded`)
- One actionable next step if not working

### Optional pattern expansion loop

When verdict is `not_observed_in_this_session` but assistant likely stopped early:
1. Create a small temporary practice project.
2. Trigger 5-10 varied stop-prone prompts.
3. Run `npm run check:nudge -- <session-id>` after each run.
4. Collect unhandled closing phrases and add regex patterns + tests.

## Common outcomes

- **No markers, plugin loaded:** assistant may not have emitted trigger phrases in that session.
- **No markers, plugin not loaded:** installation/config issue.
- **Markers present but still stopped:** likely max nudge limit reached or hard-stop condition.
