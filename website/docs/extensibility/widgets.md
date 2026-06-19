---
sidebar_position: 1
---

# Widgets

Widgets let you add fully custom interactive terminal UI to any workflow step using [Ink](https://github.com/vadimdemedes/ink) (React for the terminal).

## The `{ data, resolve }` contract

Every widget component receives exactly two props:

| Prop | Type | Description |
|------|------|-------------|
| `data` | `Record<string, unknown>` | The `with:` object from the YAML step |
| `resolve` | `(value: unknown) => void` | Call once to return the step's output |

The widget is mounted in the TUI when the step runs. It stays mounted until `resolve` is called. The value passed to `resolve` becomes the step's output, available as `${{ steps.<id>.output }}` in subsequent steps.

## Minimal example

```tsx
// SimpleConfirm.tsx
import React from 'react';
import { Text, useInput } from 'ink';

interface Props {
  data: { message: string };
  resolve: (value: boolean) => void;
}

export default function SimpleConfirm({ data, resolve }: Props) {
  useInput((input) => {
    if (input === 'y' || input === 'Y') resolve(true);
    if (input === 'n' || input === 'N') resolve(false);
  });

  return <Text>{data.message} [y/n] </Text>;
}
```

```yaml
- id: approved
  widget: ./SimpleConfirm.tsx
  default: true
  with:
    message: "Deploy to production?"
```

## Full picker example

From `examples/widgets/Picker.tsx`:

```tsx
import React from 'react';
import { Text, useInput } from 'ink';

interface Props {
  data: { message: string; choices: string[] };
  resolve: (value: string) => void;
}

export default function Picker({ data, resolve }: Props) {
  const [index, setIndex] = React.useState(0);

  useInput((input, key) => {
    if (key.upArrow) setIndex(i => Math.max(0, i - 1));
    if (key.downArrow) setIndex(i => Math.min(data.choices.length - 1, i + 1));
    if (key.return) resolve(data.choices[index]);
  });

  return (
    <>
      <Text bold>{data.message}</Text>
      {data.choices.map((choice, i) => (
        <Text key={choice} color={i === index ? 'cyan' : undefined}>
          {i === index ? '› ' : '  '}{choice}
        </Text>
      ))}
    </>
  );
}
```

```yaml
- id: picked
  widget: ./Picker.tsx
  default: typescript
  with:
    message: "Which language do you prefer?"
    choices: [typescript, python, rust]
```

## Non-TTY mode and `default:`

In non-interactive environments (CI pipelines, piped output, test suites), the TUI is not rendered. The widget step immediately returns `default:` without ever loading the component.

```yaml
- id: env-choice
  widget: ./EnvPicker.tsx
  default: staging      # CI always picks staging
  with:
    message: "Deploy to which environment?"
    choices: [staging, production]
```

Without `default:`, a widget step in non-TTY mode throws an error.

## Host-provided modules

`react` and `ink` are bundled with plyflow and resolve to plyflow's copies automatically. Widget components do not need to declare them in a `package.json`.

The following are always host-provided:

- `react` — React core
- `react/jsx-runtime` — JSX runtime
- `ink` — Ink terminal UI library
- `zod` — Zod schema validation

## Using other libraries in widgets

Import any additional npm package. Declare it in a `package.json` in the workflow directory and plyflow will auto-install it. See [Workflow Dependencies](./workflow-dependencies.md).

## Under the hood

When a widget step runs, the engine sends a `UiRequest` event to the TUI App component. The App mounts the widget component with `data` and a wrapped `resolve`. When `resolve` is called, the App unmounts the component, logs the result, and the engine continues to the next step.
