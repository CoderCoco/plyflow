import type { EngineEvent, AgentChunk } from '@plyflow/core';

function trimPhase(instanceId: string): string {
  return instanceId.replace(/^phase:/, '');
}

function formatChunk(c: AgentChunk): string | null {
  switch (c.t) {
    case 'tool_use': return `› ${c.name} ${c.summary}`.trimEnd();
    case 'tool_result': return `${c.ok ? '✓' : '✗'} ${c.summary}`;
    case 'assistant': return `▸ ${c.text}`;
    case 'thinking': return null; // not surfaced in flat logs
    case 'result': return `✓ done${c.tokens !== undefined ? ` (${c.tokens} tok)` : ''}`;
    case 'raw': return c.text;
  }
}

export class LineLogger {
  constructor(private readonly write: (line: string) => void) {}

  handle(e: EngineEvent): void {
    switch (e.type) {
      case 'phase-start':
        this.write(`\n# ${e.phase}`);
        break;
      case 'step-start':
        this.write(`  → ${e.stepId}`);
        break;
      case 'step-done':
        this.write(`  ✓ ${e.stepId}${e.cached ? ' (cached)' : ''}`);
        break;
      case 'step-error':
        this.write(`  ✗ ${e.stepId}: ${e.error}`);
        break;
      case 'step-log':
        this.write(`    ${e.stepId}: ${e.message}`);
        break;
      case 'agent-stream': {
        const line = formatChunk(e.chunk);
        if (line !== null) this.write(`  ${trimPhase(e.instanceId)} ${line}`);
        break;
      }
    }
  }
}
