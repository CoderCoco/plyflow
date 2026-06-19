import { describe, it, expect, beforeEach } from 'vitest';
import { StepRegistry } from '../steps/registry.js';
import { loadPlugins } from './plugins.js';
import type { StepDef } from './types.js';

// Fixture modules (imported for use in fakeLoad)
import pluginSteptype from './__fixtures__/plugin-steptype.js';
import pluginRegister from './__fixtures__/plugin-register.js';

const FIXTURE_MAP: Record<string, unknown> = {
  './plugin-steptype.ts': { default: pluginSteptype },
  './plugin-register.ts': { default: pluginRegister },
};

function fakeLoad(path: string): Promise<unknown> {
  const mod = FIXTURE_MAP[path];
  if (!mod) throw new Error(`fakeLoad: unknown path ${path}`);
  return Promise.resolve(mod);
}

// Minimal StepContext for running steps in tests
function makeCtx() {
  return {
    inputs: {},
    env: {},
    steps: {},
    with: {},
    provider: null as never,
    baseDir: '.',
    isTty: false,
    provided: ['zod', 'react', 'ink'],
    emit: () => undefined,
    prompt: async () => undefined,
    loadModule: async () => undefined,
  };
}

describe('loadPlugins', () => {
  let registry: StepRegistry;

  beforeEach(() => {
    registry = new StepRegistry();
  });

  it('registers a StepType-shaped plugin (wrapping match to d.step === name)', async () => {
    await loadPlugins(['./plugin-steptype.ts'], registry, fakeLoad);

    const def: StepDef = { id: 'x', step: 'echo', with: { value: 7 } };
    const type = registry.select(def);
    expect(type.name).toBe('echo');

    const cfg = type.parse(def);
    const result = await type.run(cfg, makeCtx());
    expect(result.output).toBe(7);
  });

  it('registers a register-function plugin', async () => {
    await loadPlugins(['./plugin-register.ts'], registry, fakeLoad);

    const def: StepDef = { id: 'y', step: 'twice', with: { n: 5 } };
    const type = registry.select(def);
    expect(type.name).toBe('twice');

    const cfg = type.parse(def);
    const result = await type.run(cfg, makeCtx());
    expect(result.output).toBe(10);
  });

  it('registers multiple plugins in one call', async () => {
    await loadPlugins(['./plugin-steptype.ts', './plugin-register.ts'], registry, fakeLoad);

    const echoDef: StepDef = { id: 'x', step: 'echo', with: { value: 7 } };
    const twiceDef: StepDef = { id: 'y', step: 'twice', with: { n: 5 } };

    const echoType = registry.select(echoDef);
    const twiceType = registry.select(twiceDef);

    const echoResult = await echoType.run(echoType.parse(echoDef), makeCtx());
    const twiceResult = await twiceType.run(twiceType.parse(twiceDef), makeCtx());

    expect(echoResult.output).toBe(7);
    expect(twiceResult.output).toBe(10);
  });

  it('throws a clear error for a plugin with an unrecognized export shape', async () => {
    const badLoad = (_path: string): Promise<unknown> =>
      Promise.resolve({ default: 42 });

    await expect(
      loadPlugins(['./bad-plugin.ts'], registry, badLoad),
    ).rejects.toThrow(/bad-plugin\.ts/);
  });

  it('FIX1: throws a clear plugin/StepType error when default export lacks parse', async () => {
    // An export with name+match+run but NO parse should NOT pass isStepType;
    // instead it should fall through to the "unrecognized default export" error
    // (which mentions the plugin path), NOT a TypeError about parse.bind.
    const noParsePload = (_path: string): Promise<unknown> =>
      Promise.resolve({
        default: {
          name: 'no-parse',
          match: () => true,
          run: async () => ({ output: null }),
          // parse is intentionally absent
        },
      });

    await expect(
      loadPlugins(['./no-parse-plugin.ts'], registry, noParsePload),
    ).rejects.toThrow(/plugin|StepType/i);
  });

  it('handles plugins that export the default directly (not wrapped in {default})', async () => {
    // Some loaders return the module value directly rather than {default: ...}
    const directLoad = (_path: string): Promise<unknown> =>
      Promise.resolve(pluginRegister);

    await loadPlugins(['./plugin-register.ts'], registry, directLoad);

    const def: StepDef = { id: 'y', step: 'twice', with: { n: 3 } };
    const type = registry.select(def);
    const result = await type.run(type.parse(def), makeCtx());
    expect(result.output).toBe(6);
  });
});
