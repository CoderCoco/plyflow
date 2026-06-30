import React from 'react';
import { Text } from 'ink';
import type { AgentChunk } from '@plyflow/core';

export function ChunkLine({ chunk: c }: { chunk: AgentChunk }): React.ReactElement {
  switch (c.t) {
    case 'tool_use':
      return <Text color="cyan">{`> ${c.name} ${c.summary}`.trimEnd()}</Text>;
    case 'tool_result':
      return <Text color={c.ok ? 'green' : 'red'}>{`  ${c.ok ? '✓' : '✗'} ${c.summary}`}</Text>;
    case 'assistant':
      return <Text>{`▸ ${c.text}`}</Text>;
    case 'thinking':
      return <Text dimColor>{`· ${c.text}`}</Text>;
    case 'result':
      return <Text color="green">{`✓ done${c.tokens !== undefined ? ` (${c.tokens} tok)` : ''}`}</Text>;
    case 'raw':
      return <Text>{c.text}</Text>;
  }
}
