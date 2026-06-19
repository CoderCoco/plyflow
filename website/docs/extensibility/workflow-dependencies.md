---
sidebar_position: 3
---

# Workflow Dependencies

Workflow directories can declare their own npm dependencies. plyflow auto-installs them before the workflow runs, so you never need to install packages manually.

## `package.json` in the workflow directory

Create a `package.json` next to your workflow YAML:

```json
{
  "name": "my-workflow",
  "dependencies": {
    "lodash": "^4.17.21",
    "date-fns": "^3.6.0"
  }
}
```

When plyflow loads the workflow, it checks whether dependencies are installed. If not:
- If a `package-lock.json` is present → runs `npm ci`
- Otherwise → runs `npm install`

Then `lodash` and `date-fns` are available in `run:`, `uses:`, `widget:`, and plugin modules within the workflow directory.

## Host-provided modules

The following modules are **bundled with plyflow** and are always available — workflows do not need to declare or install them:

| Module | Version |
|--------|---------|
| `zod` | latest (plyflow's copy) |
| `react` | latest (plyflow's copy) |
| `react/jsx-runtime` | latest (plyflow's copy) |
| `ink` | latest (plyflow's copy) |

These resolve to plyflow's own copies via the module loader. This is especially important for React and Ink: if widgets installed their own copy, React would have two instances, breaking hooks.

## Extending host-provided modules

If you want plyflow's module loader to treat additional packages as host-provided (sharing plyflow's copy rather than installing a local one), declare them in `plyflow.provided`:

```json
{
  "name": "my-workflow",
  "plyflow": {
    "provided": ["zod", "my-shared-lib"]
  }
}
```

## Declaring plugins in `package.json`

You can also declare plugins in `package.json` under `plyflow.plugins`:

```json
{
  "name": "my-workflow",
  "plyflow": {
    "plugins": ["./steps/uppercase.ts", "./steps/markdown.ts"]
  }
}
```

Both `plyflow.plugins` (from `package.json`) and `plugins:` (from the YAML) are merged and deduplicated.

## Full `package.json` example

```json
{
  "name": "my-workflow",
  "dependencies": {
    "lodash": "^4.17.21",
    "yaml": "^2.4.0"
  },
  "plyflow": {
    "provided": ["zod"],
    "plugins": ["./steps/yaml-reader.ts"]
  }
}
```

## How module loading works

plyflow uses [jiti](https://github.com/unjs/jiti) to load TypeScript modules directly (no compilation). The module loader:

1. Resolves the module path relative to the workflow directory (or the module's own directory for relative imports).
2. Checks the host-provided list first — if the module is host-provided, returns plyflow's own copy.
3. Otherwise, resolves from the workflow directory's `node_modules`.

This means your workflow TypeScript can `import { z } from 'zod'` and always get plyflow's Zod, ensuring schema compatibility.
