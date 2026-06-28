import React from 'react';
import { Box, Text } from 'ink';

export interface StepView {
  id: string;
  status: 'pending' | 'running' | 'done' | 'error';
  cached?: boolean;
}

export interface PhaseView {
  name: string;
  steps: StepView[];
}

const glyph: Record<StepView['status'], string> = {
  pending: '○',
  running: '◐',
  done: '✓',
  error: '✗',
};

const color: Record<StepView['status'], string> = {
  pending: 'gray',
  running: 'cyan',
  done: 'green',
  error: 'red',
};

export function ProgressTree({ phases }: { phases: PhaseView[] }): React.ReactElement {
  return (
    <Box flexDirection="column">
      {phases.map((phase) => (
        <Box key={phase.name} flexDirection="column">
          <Text bold>{phase.name}</Text>
          {phase.steps.map((step) => (
            <Text key={step.id} color={color[step.status]}>
              {'  '}
              {glyph[step.status]} {step.id}
              {step.cached ? ' (cached)' : ''}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}
