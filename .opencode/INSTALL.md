# Install opencode-continue-nudge in another project

Use these steps in the target project root.

## 0) Ask install scope first (agents)

If you are an agent with a `question` tool, ask this before installing:

```json
{
  "questions": [
    {
      "header": "Install scope",
      "question": "Where should I install opencode-continue-nudge?",
      "options": [
        {
          "label": "Project-level (Recommended)",
          "description": "Install only for this repository using node_modules and .opencode/opencode.json."
        },
        {
          "label": "Global-level",
          "description": "Install once and enable for all projects via ~/.config/opencode/opencode.json."
        }
      ],
      "multiple": false
    }
  ]
}
```

If asking is not possible, default to **Project-level**.

## 1) Project-level install (git+https)

```bash
npm install --save-dev git+https://github.com/IniZio/opencode-nudge.git
```

## 2) Register plugin in `.opencode/opencode.json` (project)

If `.opencode/opencode.json` does not exist, create it with:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "../node_modules/opencode-continue-nudge/.opencode/plugins/continue-nudge.js"
  ]
}
```

If the file exists, append `../node_modules/opencode-continue-nudge/.opencode/plugins/continue-nudge.js` to the `plugin` array.

## 3) Optional: tune preset

Edit:

`./node_modules/opencode-continue-nudge/.opencode/continue-nudge.json`

Preset options: `conservative`, `balanced`, `aggressive`.

## 4) Verify

Run from target project root:

```bash
opencode debug config --print-logs --log-level INFO | rg continue-nudge
```

You should see plugin load lines for `continue-nudge.js`.

## Global-level install (alternative)

Install a shared clone:

```bash
mkdir -p ~/.opencode/vendor
git clone --depth 1 https://github.com/IniZio/opencode-nudge.git ~/.opencode/vendor/opencode-nudge
```

Then add this plugin path in `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///Users/<your-user>/.opencode/vendor/opencode-nudge/.opencode/plugins/continue-nudge.js"
  ]
}
```

Use `file://` absolute path for global config.

## Alternative: vendor clone in-repo (project)

If you prefer vendoring over package install:

```bash
mkdir -p .opencode/vendor
git clone --depth 1 https://github.com/IniZio/opencode-nudge.git .opencode/vendor/opencode-nudge
```

Then use plugin path:

`./.opencode/vendor/opencode-nudge/.opencode/plugins/continue-nudge.js`
