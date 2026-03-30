# Install opencode-continue-nudge in another project

Use these steps in the target project root.

## 1) Install from git (git+https)

```bash
npm install --save-dev git+https://github.com/IniZio/opencode-nudge.git
```

## 2) Register plugin in `.opencode/opencode.json`

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

## Alternative: vendor clone in-repo

If you prefer vendoring over package install:

```bash
mkdir -p .opencode/vendor
git clone --depth 1 https://github.com/IniZio/opencode-nudge.git .opencode/vendor/opencode-nudge
```

Then use plugin path:

`./.opencode/vendor/opencode-nudge/.opencode/plugins/continue-nudge.js`
