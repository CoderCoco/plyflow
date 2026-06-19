/**
 * B3 e2e tests: plugin loading wired into runWorkflow.
 *
 * These tests use a REAL temp dir and REAL files so that the jiti-based loader
 * genuinely loads the plugin module on Node 24.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow } from './engine.js';
import { FakeProvider } from '../providers/fake.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plyflow-b3-'));
  return () => rm(dir, { recursive: true, force: true });
});

describe('B3: plugin loading via runWorkflow', () => {
  it('loads a workflow-declared plugin and runs a custom step: <name>', async () => {
    // Write the echo plugin file into the temp dir
    await writeFile(
      join(dir, 'echo-plugin.ts'),
      [
        "import type { StepType } from 'plyflow/steps/types.js';",
        '',
        'const echoStep: StepType<{ value: unknown }> = {',
        "  name: 'echo',",
        '  match: () => false, // loader wraps this to (d) => d.step === "echo"',
        '  parse: (def) => ({',
        "    value: (def.with as Record<string, unknown> | undefined)?.['value'],",
        '  }),',
        '  run: async (cfg) => ({ output: cfg.value }),',
        '};',
        '',
        'export default echoStep;',
      ].join('\n'),
    );

    // Write the workflow YAML
    const wfPath = join(dir, 'plugin-e2e.yaml');
    await writeFile(
      wfPath,
      [
        'name: plugin-e2e',
        "plugins: ['./echo-plugin.ts']",
        'phases:',
        '  - name: Main',
        '    steps:',
        '      - id: e',
        "        step: echo",
        '        with:',
        "          value: 'hi'",
      ].join('\n'),
    );

    const res = await runWorkflow(wfPath, {
      provider: new FakeProvider([]),
      runDir: dir,
      isTty: false,
    });

    expect(res.outputs['e']).toBe('hi');
  });

  it('loads a plugin from the env (package.json plyflow.plugins) and runs a custom step', async () => {
    // Write the double plugin file
    await writeFile(
      join(dir, 'double-plugin.ts'),
      [
        "import type { StepRegistry } from 'plyflow/steps/registry.js';",
        "import type { StepDef } from 'plyflow/core/types.js';",
        '',
        'export default function register(registry: StepRegistry): void {',
        '  registry.register({',
        "    name: 'double',",
        '    match: (def: StepDef) => def.step === "double",',
        '    parse: (def: StepDef) => ({',
        "      n: (def.with as Record<string, unknown> | undefined)?.['n'] as number,",
        '    }),',
        '    run: async (cfg: { n: number }) => ({ output: cfg.n * 2 }),',
        '  });',
        '}',
      ].join('\n'),
    );

    // package.json declaring the plugin via plyflow.plugins
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        plyflow: { plugins: ['./double-plugin.ts'] },
      }),
    );

    const wfPath = join(dir, 'pkg-plugin-e2e.yaml');
    await writeFile(
      wfPath,
      [
        'name: pkg-plugin-e2e',
        'phases:',
        '  - name: Main',
        '    steps:',
        '      - id: d',
        '        step: double',
        '        with:',
        '          n: 7',
      ].join('\n'),
    );

    const res = await runWorkflow(wfPath, {
      provider: new FakeProvider([]),
      runDir: dir,
      isTty: false,
    });

    expect(res.outputs['d']).toBe(14);
  });

  it('deduplicates plugin paths declared in both package.json and workflow YAML', async () => {
    // Keep track of how many times the plugin is loaded (it registers; if
    // loaded twice the registry would have duplicate names → ambiguous)
    await writeFile(
      join(dir, 'echo-plugin.ts'),
      [
        "import type { StepType } from 'plyflow/steps/types.js';",
        '',
        'const echoStep: StepType<{ value: unknown }> = {',
        "  name: 'echo',",
        '  match: () => false,',
        '  parse: (def) => ({',
        "    value: (def.with as Record<string, unknown> | undefined)?.['value'],",
        '  }),',
        '  run: async (cfg) => ({ output: cfg.value }),',
        '};',
        '',
        'export default echoStep;',
      ].join('\n'),
    );

    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        plyflow: { plugins: ['./echo-plugin.ts'] },
      }),
    );

    const wfPath = join(dir, 'dedup-e2e.yaml');
    await writeFile(
      wfPath,
      [
        'name: dedup-e2e',
        "plugins: ['./echo-plugin.ts']",
        'phases:',
        '  - name: Main',
        '    steps:',
        '      - id: e',
        '        step: echo',
        '        with:',
        "          value: 'dedup'",
      ].join('\n'),
    );

    // Should not throw "ambiguous" — dedup prevents double-registration
    const res = await runWorkflow(wfPath, {
      provider: new FakeProvider([]),
      runDir: dir,
      isTty: false,
    });

    expect(res.outputs['e']).toBe('dedup');
  });

  it('rejects with a clear error mentioning the unknown step name when step: ghost has no matching plugin', async () => {
    const wfPath = join(dir, 'ghost-e2e.yaml');
    await writeFile(
      wfPath,
      [
        'name: ghost-e2e',
        'phases:',
        '  - name: Main',
        '    steps:',
        '      - id: g',
        '        step: ghost',
        '        with: {}',
      ].join('\n'),
    );

    await expect(
      runWorkflow(wfPath, {
        provider: new FakeProvider([]),
        runDir: dir,
        isTty: false,
      }),
    ).rejects.toThrow(/ghost/);
  });
});
