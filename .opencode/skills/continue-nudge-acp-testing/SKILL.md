# Skill: continue-nudge-acp-testing

Test the continue-nudge plugin end-to-end using OpenCode ACP. This skill is self-contained and does not depend on any global skills.

## Goal

Verify three behaviors in one run:
1. A permission-seeking assistant response appears (for example: `If you want, I can also add tests.`).
2. The plugin injects a continuation nudge (`CONTINUE_NUDGE_PLUGIN`).
3. The agent continues work automatically after the nudge.

## Fast Path (Preferred)

Run the built-in ACP smoke test script:

```bash
npm run test:acp
```

Expected output includes:

```text
PASS session=<id> markers=<n>=1+ file=<tmp>/ACP_OK.txt
```

If this passes, ACP-based nudge continuation is verified.

## Manual ACP Flow (Fallback)

Use this when debugging failures or validating behavior step-by-step.

### 1) Start ACP in project root

```bash
opencode acp
```

### 2) Send JSON-RPC initialize

```json
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true},"clientInfo":{"name":"nudge-tester","title":"Nudge Tester","version":"1.0.0"}}}
```

### 3) Create a session

```json
{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/ABSOLUTE/PROJECT/PATH","mcpServers":[]}}
```

Save `result.sessionId`.

### 4) Prompt with a forced permission-seeking first reply

```json
{"jsonrpc":"2.0","id":2,"method":"session/prompt","params":{"sessionId":"<SESSION_ID>","prompt":[{"type":"text","text":"In your first reply, output exactly: If you want, I can also add tests. Do nothing else in that first reply. After that, continue and append one line to ACP_OK.txt containing: nudge continued"}]}}
```

### 5) Wait for completion and export session

```bash
opencode export <SESSION_ID> > /tmp/continue-nudge-export.json
```

### 6) Validate required markers and continuation

```bash
grep -c "CONTINUE_NUDGE_PLUGIN" /tmp/continue-nudge-export.json
```

Must be `>= 1`.

```bash
grep -n "If you want, I can also add tests" /tmp/continue-nudge-export.json
```

Must exist.

```bash
cat ACP_OK.txt
```

Must include `nudge continued`.

## Pass Criteria

- At least one `CONTINUE_NUDGE_PLUGIN` user message in session export.
- The permission-seeking phrase appears in assistant output.
- `ACP_OK.txt` contains `nudge continued` after the nudge.

## Common Failures

- `Model is disabled` or auth/provider errors: set a working model/provider in `.opencode/opencode.json`.
- No marker found: ensure plugin is loaded in `.opencode/opencode.json` under `plugin`.
- Marker found but no continuation: check plugin runtime for nudge race conditions and max nudge settings.

## Local Config Example

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "openai/gpt-5.3-codex",
  "plugin": [
    "file:///absolute/path/to/opencode-nudge/.opencode/plugins/continue-nudge.js"
  ]
}
```
