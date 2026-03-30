# opencode-continue-nudge

OpenCode plugin that detects permission-seeking stops and nudges the agent to continue working.

## Installation

Tell OpenCode:

```
Fetch and follow instructions from https://raw.githubusercontent.com/IniZio/opencode-nudge/refs/heads/main/.opencode/INSTALL.md
```

## How it works

1. **Session priming** - Injects a hidden reminder on `session.created`
2. **Idle detection** - Watches `session.idle` and `session.updated` for stops
3. **Permission-seeking patterns** - Detects "Should I...", "Would you like me to...", etc.
4. **Auto-nudge** - Posts a continuation prompt when detected
5. **Question handling** - Auto-answers permission-style questions on `question.asked`

## Configuration

Default config in `.opencode/continue-nudge.json`:

```json
{
  "preset": "balanced",
  "semanticFallback": {
    "enabled": false,
    "model": "openai/gpt-5.1-codex-mini",
    "mode": "in_session",
    "timeoutMs": 4000,
    "maxChecksPerSession": 1
  }
}
```

### Presets

| Preset | MaxNudges | Patterns | Use Case |
|--------|-----------|----------|----------|
| `conservative` | 1 | Only explicit "Should I continue?" | Minimal intervention |
| `balanced` | 2 | "Should I...", "Would you like me to..." | Default |
| `aggressive` | 3 | Includes "I can also..." | Stop-prone models |

### Custom patterns

```json
{
  "preset": "balanced",
  "maxNudgesPerSession": 3,
  "permissionSeekingPatterns": ["\\bshould i\\b", "\\bwould you like me to\\b"],
  "hardStopPatterns": ["\\bmissing credentials\\b", "\\bcannot proceed\\b"],
  "userOptOutPatterns": ["\\bplan only\\b", "\\bask me first\\b"]
}
```

## Testing

```bash
npm test
```

ACP smoke test (end-to-end nudge + continuation):

```bash
npm run test:acp
```

Optional model override for ACP smoke runs:

```bash
ACP_MODEL=opencode/gpt-5.1-codex-mini npm run test:acp
```

Optional plugin override (useful to validate installed git plugin resolution):

```bash
ACP_PLUGIN_SPEC='opencode-continue-nudge@git+https://github.com/IniZio/opencode-nudge.git' ACP_MODEL=opencode/gpt-5.3-codex npm run test:acp
```

Runtime verify in a real session:

```bash
opencode export <session-id> | rg "CONTINUE_NUDGE_PLUGIN"
```

If present, the plugin injected a continuation nudge in that session.

Detailed session diagnostics:

```bash
npm run check:nudge -- <session-id>
```

If no session id is passed, it checks the most recent session.

## Pattern Detection

The plugin detects these permission-seeking phrases:

- "Should I...?"
- "Would you like me to...?"
- "Do you want me to...?"
- "Shall I...?"
- "I can also..."
- "Is there any additional constraint?"

Additional covered continuation phrasings include:

- "Next I can ..."
- "Next high-value step: ..."

And respects these hard stops:

- Missing credentials
- Blocked by permissions
- Genuine blockers
- User explicitly says "wait" or "ask first"

## Semantic fallback (optional)

You can enable a cheap semantic classifier for long-tail phrasing that misses regex rules:

```json
{
  "preset": "balanced",
  "semanticFallback": {
    "enabled": true,
    "model": "openai/gpt-5.1-codex-mini",
    "mode": "out_of_band",
    "timeoutMs": 4000,
    "maxChecksPerSession": 1
  }
}
```

How it behaves:

- Runs only when regex detection does not trigger
- Uses per-session/message dedupe to avoid repeated checks
- Skips marker messages (`CONTINUE_NUDGE_*`) and hard-stop/user opt-out cases
- Fails closed (timeout/error => no nudge)

`semanticFallback.mode`:

- `in_session` (default): classify in the current session
- `out_of_band`: try classifying in a short-lived side session and clean it up after use

## Events

The plugin subscribes to:

- `session.created` - Primes session with hidden reminder
- `session.idle` - Checks last message and nudges if permission-seeking
- `session.updated` - Proactively checks for permission-seeking
- `session.completed` - Fallback check at session end
- `question.asked` - Auto-answers permission-style questions

## License

MIT
