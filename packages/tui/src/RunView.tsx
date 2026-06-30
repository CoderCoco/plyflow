import React from 'react';
import { Box, Text } from 'ink';
import { glyph, color } from './status.js';
import { ChunkLine } from './chunk-renderers.js';
import type { RunModel, AgentInstance } from './run-model.js';

export interface RunViewProps {
  model: RunModel;
  cursorId: string | null;
  focus: 'selector' | 'detail';
  scrollOffset: number;
  width: number;
  /** Below this width the detail column is hidden (narrow-terminal collapse). */
  narrowWidth?: number;
}

const DETAIL_ROWS = 20;

function Selector({ model, cursorId }: { model: RunModel; cursorId: string | null }): React.ReactElement {
  // Render phase headers interleaved with their steps, in `order`.
  const rows: React.ReactElement[] = [];
  let lastPhase: string | null = null;
  for (const id of model.order) {
    const inst = model.byId.get(id);
    if (!inst) continue;
    const phase = id.replace(/^phase:/, '').split('/')[0];
    if (phase !== lastPhase) {
      rows.push(<Text key={`ph:${phase}`} bold>{phase}</Text>);
      lastPhase = phase;
    }
    const marker = id === cursorId ? '›' : ' ';
    const indent = '  '.repeat(inst.depth);
    rows.push(
      <Text key={id} color={color[inst.status]}>
        {`${marker} ${indent}${glyph[inst.status]} ${inst.label}`}
      </Text>,
    );
  }
  return <Box flexDirection="column">{rows}</Box>;
}

function Detail({ inst, scrollOffset }: { inst: AgentInstance | undefined; scrollOffset: number }): React.ReactElement {
  if (!inst) return <Text dimColor>no selection</Text>;
  const header = (
    <Text bold>
      {inst.label} {glyph[inst.status]}
    </Text>
  );
  if (inst.buffer.length === 0) {
    return (
      <Box flexDirection="column">
        {header}
        <Text>{typeof inst.output === 'string' ? inst.output : JSON.stringify(inst.output ?? '', null, 2)}</Text>
      </Box>
    );
  }
  const start = Math.max(0, inst.buffer.length - DETAIL_ROWS - scrollOffset);
  const visible = inst.buffer.slice(start, start + DETAIL_ROWS);
  return (
    <Box flexDirection="column">
      {header}
      {inst.trimmed && start === 0 ? <Text dimColor>…earlier output trimmed</Text> : null}
      {visible.map((c, i) => <ChunkLine key={start + i} chunk={c} />)}
    </Box>
  );
}

export function RunView({ model, cursorId, scrollOffset, width, narrowWidth = 80 }: RunViewProps): React.ReactElement {
  const inst = cursorId ? model.byId.get(cursorId) : undefined;
  if (width < narrowWidth) {
    // Narrow: selector only (detail opens as overlay — handled by App in Task 10).
    return <Selector model={model} cursorId={cursorId} />;
  }
  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={Math.floor(width * 0.4)} marginRight={1}>
        <Selector model={model} cursorId={cursorId} />
      </Box>
      <Box flexDirection="column" flexGrow={1} paddingLeft={2}>
        <Detail inst={inst} scrollOffset={scrollOffset} />
      </Box>
    </Box>
  );
}
