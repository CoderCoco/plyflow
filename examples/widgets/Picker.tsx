/**
 * Example widget: Picker.
 *
 * A custom Ink/React widget component for plyflow. The widget contract:
 *   - Props: { data: unknown; resolve: (value: unknown) => void }
 *   - Call resolve(value) when the user makes a selection.
 *   - data comes from the step's `with:` fields.
 *   - react and ink are provided by plyflow — no need to install them.
 *
 * This Picker shows a list of choices from data.choices and lets the user
 * navigate with arrow keys and select with Enter.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

interface PickerData {
  choices: string[];
  message?: string;
}

interface PickerProps {
  data: unknown;
  resolve: (value: unknown) => void;
}

export default function Picker({ data, resolve }: PickerProps): React.ReactElement {
  const { choices, message } = data as PickerData;
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(choices.length - 1, c + 1));
    } else if (key.return || input === ' ') {
      resolve(choices[cursor]);
    }
  });

  // Auto-resolve on mount when there's exactly one choice (useful for tests /
  // non-interactive contexts where the widget is mounted but shouldn't block).
  useEffect(() => {
    if (choices.length === 1) {
      resolve(choices[0]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Box flexDirection="column" paddingY={1}>
      {message && <Text bold>{message}</Text>}
      {choices.map((choice, i) => (
        <Box key={choice}>
          <Text color={i === cursor ? 'cyan' : undefined}>
            {i === cursor ? '› ' : '  '}
            {choice}
          </Text>
        </Box>
      ))}
      <Text dimColor>↑/↓ navigate · Enter/Space select</Text>
    </Box>
  );
}
