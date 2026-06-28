import type { AIProvider } from './types.js';
import { ClaudeProvider, defaultRunCli } from './claude.js';

export function makeProvider(name: string, mode: 'api' | 'cli' | 'agent-sdk'): AIProvider {
  if (name === 'claude') {
    return new ClaudeProvider({ mode, runCli: defaultRunCli });
  }
  throw new Error(`unknown provider "${name}"`);
}
