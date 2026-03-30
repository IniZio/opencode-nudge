# opencode-continue-nudge

OpenCode plugin that detects permission-seeking stops and nudges the agent to continue working.

## Installation

### OpenCode (recommended)

Tell OpenCode:

```
Fetch and follow instructions from https://raw.githubusercontent.com/IniZio/opencode-nudge/refs/heads/main/.opencode/INSTALL.md
```

### Manual

Install from git (`git+https`) and register the plugin path:

```bash
npm install --save-dev git+https://github.com/IniZio/opencode-nudge.git
```

Then add this plugin entry in `.opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "../node_modules/opencode-continue-nudge/.opencode/plugins/continue-nudge.js"
  ]
}
```

Note: plugin paths in `.opencode/opencode.json` are resolved from the `.opencode/` directory, so use `../node_modules/...`.

Project layout after install:

```
your-project/
├── node_modules/
│   └── opencode-continue-nudge/
│       └── .opencode/
│           ├── plugins/
│           │   └── continue-nudge.js
│           └── continue-nudge.json
└── .opencode/
    └── opencode.json
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
  "preset": "balanced"
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

## Pattern Detection

The plugin detects these permission-seeking phrases:

- "Should I...?"
- "Would you like me to...?"
- "Do you want me to...?"
- "Shall I...?"
- "I can also..."
- "Is there any additional constraint?"

And respects these hard stops:

- Missing credentials
- Blocked by permissions
- Genuine blockers
- User explicitly says "wait" or "ask first"

## Events

The plugin subscribes to:

- `session.created` - Primes session with hidden reminder
- `session.idle` - Checks last message and nudges if permission-seeking
- `session.updated` - Proactively checks for permission-seeking
- `session.completed` - Fallback check at session end
- `question.asked` - Auto-answers permission-style questions

## Files

```
src/continue-nudge-plugin.js  # Core implementation
test/continue-nudge-plugin.test.js  # Tests
scripts/acp-smoke-run.mjs  # ACP end-to-end smoke test runner
.opencode/plugins/continue-nudge.js  # Plugin entrypoint
.opencode/continue-nudge.json  # Config
.opencode/skills/continue-nudge-acp-testing/SKILL.md  # Self-contained ACP testing workflow
```

## License

MIT
