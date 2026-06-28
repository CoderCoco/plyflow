import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadAgent } from '@plyflow/core';

const agent = (name: string) =>
  fileURLToPath(new URL(`./${name}`, import.meta.url));

const agentNames = [
  'flight-director.md',
  'astronaut.md',
  'flight-controller.md',
  'systems-inspector.md',
  'capcom.md',
  'docking.md',
  'scout.md',
];

describe('mission agent prompt files', () => {
  for (const name of agentNames) {
    describe(name, () => {
      it('has model, provider, and mode frontmatter', async () => {
        const a = await loadAgent(agent(name));
        expect(a.config.model, 'model must be set').toBeTruthy();
        expect(a.config.provider, 'provider must be set').toBeTruthy();
        expect(a.config.mode, 'mode must be agent-sdk').toBe('agent-sdk');
      });

      it('has a non-empty system prompt body (> 50 chars)', async () => {
        const a = await loadAgent(agent(name));
        expect(a.systemPrompt.length).toBeGreaterThan(50);
      });
    });
  }
});
