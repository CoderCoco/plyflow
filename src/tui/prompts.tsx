import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PromptRequest } from '../steps/types.js';

interface PromptProps {
  request: PromptRequest;
  onResolve: (value: unknown) => void;
}

function ConfirmPrompt({ request, onResolve }: PromptProps): React.ReactElement {
  useInput((input) => {
    if (input.toLowerCase() === 'y') onResolve(true);
    else if (input.toLowerCase() === 'n') onResolve(false);
  });
  return <Text>{request.message} (y/n)</Text>;
}

function TextPrompt({ request, onResolve }: PromptProps): React.ReactElement {
  const [value, setValue] = useState('');
  useInput((input, key) => {
    if (key.return) onResolve(value);
    else if (key.backspace || key.delete) setValue((v) => v.slice(0, -1));
    else if (input) setValue((v) => v + input);
  });
  return (
    <Text>
      {request.message} {value}
    </Text>
  );
}

function SelectPrompt({ request, onResolve }: PromptProps): React.ReactElement {
  const choices = request.choices ?? [];
  const [index, setIndex] = useState(0);
  useInput((_input, key) => {
    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIndex((i) => Math.min(choices.length - 1, i + 1));
    else if (key.return) onResolve(choices[index]);
  });
  return (
    <Box flexDirection="column">
      <Text>{request.message}</Text>
      {choices.map((c, i) => (
        <Text key={c} color={i === index ? 'cyan' : undefined}>
          {i === index ? '› ' : '  '}
          {c}
        </Text>
      ))}
    </Box>
  );
}

export function Prompt(props: PromptProps): React.ReactElement {
  if (props.request.type === 'confirm') return <ConfirmPrompt {...props} />;
  if (props.request.type === 'select') return <SelectPrompt {...props} />;
  return <TextPrompt {...props} />;
}

export { ConfirmPrompt, TextPrompt, SelectPrompt };
