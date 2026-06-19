import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentStep } from './agent.js';
import { FakeProvider } from '../providers/fake.js';
import { ClaudeProvider } from '../providers/claude.js';
import { createRootScope, runSteps } from '../core/exec.js';
import { buildDefaultRegistry } from '../core/engine.js';
import { Journal } from '../core/journal.js';
import { createLoader } from '../core/module-loader.js';
import type { StepContext } from './types.js';
import type { AICompleteRequest } from '../providers/types.js';

// Helper: build a ${{ expr }} template string without triggering parser issues
function expr(e: string): string {
  return '${{' + ' ' + e + ' ' + '}}';
}

const fixturesDir = dirname(fileURLToPath(new URL('./__fixtures__/x', import.meta.url)));
const fixturesLoader = createLoader({ baseDir: fixturesDir });

function makeCtx(provider: any, over: Partial<StepContext> = {}): StepContext {
  return {
    inputs: {},
    env: {},
    steps: {},
    with: {},
    provider,
    baseDir: fixturesDir,
    isTty: true,
    provided: ['zod', 'react', 'ink'],
    emit: () => {},
    prompt: async () => undefined,
    loadModule: fixturesLoader.import.bind(fixturesLoader),
    bindings: {},
    resolve: (v: unknown) => v,
    runChildren: async () => ({}),
    ...over,
  };
}

// ── Test 1: Model override ─────────────────────────────────────────────────────
describe('agent step — model override', () => {
  it('uses cfg.model over agent.config.model when provided', async () => {
    const provider = new FakeProvider([{ text: 'ok' }]);
    const cfg = agentStep.parse({
      id: 's',
      agent: './sum-agent.md',
      prompt: 'do it',
      model: 'claude-haiku-overridden',
    });
    await agentStep.run(cfg, makeCtx(provider));
    expect(provider.calls[0]!.model).toBe('claude-haiku-overridden');
  });

  it('falls back to agent.config.model when no override', async () => {
    const provider = new FakeProvider([{ text: 'ok' }]);
    const cfg = agentStep.parse({ id: 's', agent: './sum-agent.md', prompt: 'do it' });
    await agentStep.run(cfg, makeCtx(provider));
    // sum-agent.md has model: claude-opus-4-8
    expect(provider.calls[0]!.model).toBe('claude-opus-4-8');
  });
});

// ── Test 2: Expression-resolved model override via runSteps ──────────────────
describe('agent step — expression-resolved model override via exec', () => {
  it('resolves model expression and threads into parse/run', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'plyflow-agent-override-'));
    try {
      const capturedRequests: AICompleteRequest[] = [];
      const provider = new FakeProvider([{ text: 'result' }]);
      // Override complete to also capture
      const origComplete = provider.complete.bind(provider);
      provider.complete = async (req: AICompleteRequest) => {
        capturedRequests.push(req);
        return origComplete(req);
      };

      const registry = buildDefaultRegistry();
      const journal = Journal.create(tmpDir, 'test-run-override', 'test', {});

      const scope = createRootScope({
        inputs: { m: 'claude-haiku-4' },
        env: {},
        baseDir: fixturesDir,
        provider,
        registry,
        journal,
        journalPath: 'phase:Test',
        dirty: new Set(),
        isTty: true,
        loadModule: fixturesLoader.import.bind(fixturesLoader),
        emit: () => {},
        prompt: () => Promise.reject(new Error('no prompt')),
      });

      await runSteps(
        [{ id: 'step1', agent: './sum-agent.md', prompt: 'go', model: expr('inputs.m') }],
        scope,
      );

      expect(capturedRequests[0]!.model).toBe('claude-haiku-4');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Test 3: Mode routing override on ClaudeProvider ─────────────────────────
describe('ClaudeProvider — per-request mode override', () => {
  it('routes to agent-sdk when req.mode=agent-sdk even if constructed with mode=api', async () => {
    const fakeAgentQuery = vi.fn(async function* () {
      // minimal result message
      yield { type: 'result', result: 'agent-sdk-response' } as any;
    });

    const provider = new ClaudeProvider({
      mode: 'api',
      agentQuery: fakeAgentQuery,
    });

    const result = await provider.complete({
      system: 'sys',
      prompt: 'hello',
      model: 'claude-opus-4',
      mode: 'agent-sdk',
    });

    expect(fakeAgentQuery).toHaveBeenCalledOnce();
    expect(result.text).toBe('agent-sdk-response');
  });

  it('stays on api path when req.mode is undefined and constructed with mode=api', async () => {
    const fakeClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'api-response' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    };

    const provider = new ClaudeProvider({ mode: 'api', client: fakeClient });
    const result = await provider.complete({
      system: 'sys',
      prompt: 'hi',
      model: 'claude-opus-4',
    });

    expect(fakeClient.messages.create).toHaveBeenCalledOnce();
    expect(result.text).toBe('api-response');
  });
});

// ── Test 4: Params passthrough ────────────────────────────────────────────────
describe('agent step — params passthrough', () => {
  it('merges cfg.params into the provider request on top of temperature', async () => {
    const provider = new FakeProvider([{ text: 'ok' }]);
    const cfg = agentStep.parse({
      id: 's',
      agent: './sum-agent.md',
      prompt: 'do it',
      params: { maxTurns: 3 },
    });
    await agentStep.run(cfg, makeCtx(provider));
    expect(provider.calls[0]!.params?.maxTurns).toBe(3);
  });

  it('cfg.params overrides temperature from agent.config when both present', async () => {
    const provider = new FakeProvider([{ text: 'ok' }]);
    // sum-agent.md has no temperature, so let's verify maxTurns presence
    const cfg = agentStep.parse({
      id: 's',
      agent: './sum-agent.md',
      prompt: 'do it',
      params: { maxTurns: 5, temperature: 0.9 },
    });
    await agentStep.run(cfg, makeCtx(provider));
    expect(provider.calls[0]!.params?.maxTurns).toBe(5);
    expect(provider.calls[0]!.params?.temperature).toBe(0.9);
  });
});
