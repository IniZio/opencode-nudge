# Installing opencode-continue-nudge for OpenCode

## Choose install scope

If you have a `question` tool, ask this first:

```json
{
  "questions": [
    {
      "header": "Install scope",
      "question": "Where should I install opencode-continue-nudge?",
      "options": [
        {
          "label": "Project-level (Recommended)",
          "description": "Enable only in this repository via .opencode/opencode.json."
        },
        {
          "label": "Global-level",
          "description": "Enable for all projects via ~/.config/opencode/opencode.json."
        }
      ],
      "multiple": false
    }
  ]
}
```

If asking is not possible, default to **Project-level**.

## Project-level install

Add this to `.opencode/opencode.json`:

```json
{
  "plugin": [
    "opencode-continue-nudge@git+https://github.com/IniZio/opencode-nudge.git"
  ]
}
```

If the file already exists, append the plugin string to the existing `plugin` array.

## Global-level install

Add this to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "opencode-continue-nudge@git+https://github.com/IniZio/opencode-nudge.git"
  ]
}
```

If the file already exists, append the plugin string to the existing `plugin` array.

## Verify

Restart OpenCode, then run:

```bash
opencode debug config --print-logs --log-level INFO | rg -i "opencode-continue-nudge|continue-nudge"
```

You should see plugin loading lines for `opencode-continue-nudge`.
