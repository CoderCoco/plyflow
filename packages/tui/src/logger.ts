import type { EngineEvent } from '@plyflow/core';

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
    }
  }
}
