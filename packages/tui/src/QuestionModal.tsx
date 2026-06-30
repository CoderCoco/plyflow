import React from 'react';
import { Box, Text } from 'ink';
import { Prompt } from './prompts.js';
import { WidgetHost } from './WidgetHost.js';
import type { UiRequest, PromptRequest } from '@plyflow/core';

export interface PendingUi {
  stepId: string;
  request: UiRequest;
  resolve: (value: unknown) => void;
}

export function QuestionModal({ pending }: { pending: PendingUi }): React.ReactElement {
  const body =
    pending.request.kind === 'prompt' ? (
      <Prompt request={pending.request as PromptRequest} onResolve={pending.resolve} />
    ) : (
      <WidgetHost request={pending.request} onResolve={pending.resolve} />
    );
  return (
    <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1} flexDirection="column">
      <Text dimColor>question</Text>
      {body}
    </Box>
  );
}
