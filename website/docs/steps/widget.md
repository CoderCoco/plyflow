---
sidebar_position: 8
---

# `widget` Steps

A `widget:` step mounts a custom [Ink](https://github.com/vadimdemedes/ink) (React for CLI) component in the terminal UI, letting you build fully custom interactive prompts.

## Basic usage

```yaml
- id: picked
  widget: ./Picker.tsx
  default: typescript
  with:
    message: "Which language do you prefer?"
    choices:
      - typescript
      - python
      - rust
```

- `widget:` — path to a `.tsx` file (relative to the workflow)
- `default:` — returned automatically in non-TTY mode (CI, tests, piped output)
- `with:` — arbitrary data passed to the component as `data`

## Writing a widget component

The component receives `{ data, resolve }`:

- `data` — the `with:` object from the YAML step
- `resolve(value)` — call this to return a value and complete the step

```tsx
// Picker.tsx
// react and ink are host-provided — no install needed
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
      <Text>{data.message}</Text>
      {data.choices.map((c, i) => (
        <Text key={c} color={i === index ? 'cyan' : undefined}>
          {i === index ? '› ' : '  '}{c}
        </Text>
      ))}
    </>
  );
}
```

Call `resolve(value)` exactly once. The widget unmounts and the step output becomes `value`.

## Non-TTY mode

In non-interactive environments (CI, piped stdin/stdout, tests), plyflow skips widget rendering and immediately returns `default:`. Without `default:`, the step throws.

```yaml
- id: picked
  widget: ./Picker.tsx
  default: typescript     # returned in CI without rendering
  with:
    message: "Pick a language"
    choices: [typescript, python, rust]
```

## Consuming the output

```yaml
- id: echo
  needs: [picked]
  run: |
    return `You picked: ${ctx.steps.picked.output}`;
```

## Full example

From `examples/widgets/pick.yaml`:

```yaml
name: pick-demo
phases:
  - name: Pick
    steps:
      - id: picked
        widget: ./Picker.tsx
        default: typescript
        with:
          message: "Which language do you prefer?"
          choices:
            - typescript
            - python
            - rust

      - id: echo
        needs: [picked]
        run: |
          return `You picked: ${ctx.steps.picked.output}`;
```

## Host-provided modules

`react` and `ink` are provided by plyflow — widgets do not need to declare them in a `package.json`. See [Workflow Dependencies](../extensibility/workflow-dependencies.md) for the full list of host-provided modules.
