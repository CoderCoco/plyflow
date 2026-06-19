import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkflow, buildDefaultRegistry } from './engine.js';
import { FakeProvider } from '../providers/fake.js';
import type { Exec } from './workflow-env.js';

const wf = fileURLToPath(new URL('./__fixtures__/e2e.yaml', import.meta.url));
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plyflow-e2e-'));
  return () => rm(dir, { recursive: true, force: true });
});

describe('runWorkflow', () => {
  it('runs phases and resolves cross-step expressions', async () => {
    const events: string[] = [];
    const res = await runWorkflow(wf, {
      inputs: { n: 5 },
      runDir: dir,
      provider: new FakeProvider([]),
      onEvent: (e) => events.push(e.type),
    });
    expect(res.outputs.label).toBe('value=10');
    expect(events).toContain('phase-start');
  });

  it('replays cached steps on resume with the same runId', async () => {
    const first = await runWorkflow(wf, { inputs: { n: 5 }, runDir: dir, provider: new FakeProvider([]) });
    const cachedIds: string[] = [];
    await runWorkflow(wf, {
      inputs: { n: 5 },
      runId: first.runId,
      runDir: dir,
      provider: new FakeProvider([]),
      onEvent: (e) => { if (e.type === 'step-done' && e.cached) cachedIds.push(e.stepId); },
    });
    expect(cachedIds.sort()).toEqual(['double', 'label']);
  });

  it('registers the four built-in step types', () => {
    const reg = buildDefaultRegistry();
    expect(reg.select({ id: 's', run: 'x' }).name).toBe('run');
    expect(reg.select({ id: 's', agent: 'a.md' }).name).toBe('agent');
    expect(reg.select({ id: 's', input: { type: 'confirm', message: 'm' } }).name).toBe('input');
    expect(reg.select({ id: 's', parallel: [] }).name).toBe('parallel');
  });

  it('invalidates cache when inputs change on resume', async () => {
    const first = await runWorkflow(wf, { inputs: { n: 5 }, runDir: dir, provider: new FakeProvider([]) });
    const rerunIds: string[] = [];
    await runWorkflow(wf, {
      inputs: { n: 10 },
      runId: first.runId,
      runDir: dir,
      provider: new FakeProvider([]),
      onEvent: (e) => { if (e.type === 'step-done' && !e.cached) rerunIds.push(e.stepId); },
    });
    expect(rerunIds.sort()).toEqual(['double', 'label']);
  });

  it('throws on missing required input', async () => {
    await expect(
      runWorkflow(wf, { inputs: {}, runDir: dir, provider: new FakeProvider([]) }),
    ).rejects.toThrow(/required/);
  });

  // C4: env-built loader is wired through the full engine path.
  // The agent step loads a zod schema via ctx.loadModule (which goes through
  // the env-resolved loader), validates the FakeProvider's structured output,
  // and returns it — proving realm-shared zod instanceof checks hold.
  it('C4: env-built loader validates structured output through the full engine path', async () => {
    const schemaWf = fileURLToPath(
      new URL('./__fixtures__/schema-e2e.yaml', import.meta.url),
    );
    const structured = { name: 'hello', value: 42 };
    const provider = new FakeProvider([{ structured }]);

    const res = await runWorkflow(schemaWf, {
      runDir: dir,
      provider,
    });

    // The schema validates name: string, value: number — if realm is broken
    // instanceof would throw "must export default a Zod schema".
    expect(res.outputs.result).toEqual(structured);
  });

  // C4: when the workflow dir has a package.json with a missing dep + a
  // lockfile, runWorkflow calls the injected exec with 'npm ci'.
  it('C4: triggers npm ci via opts.exec when workflow has a package.json with missing deps', async () => {
    // Build a temp workflow dir with package.json + lockfile
    const wfDir = await mkdtemp(join(tmpdir(), 'plyflow-c4-'));
    try {
      const wfPath = join(wfDir, 'workflow.yaml');
      await writeFile(
        wfPath,
        [
          'name: dep-install-test',
          'phases:',
          '  - name: Main',
          '    steps:',
          '      - id: s',
          '        run: "return 1;"',
        ].join('\n'),
      );
      await writeFile(
        join(wfDir, 'package.json'),
        JSON.stringify({
          dependencies: { 'some-missing-dep': '1.0.0' },
        }),
      );
      // Provide a lockfile so prepareEnv picks 'npm ci'
      await writeFile(join(wfDir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }));
      // node_modules NOT created → dep is missing → install should fire

      const execCalls: Array<{ cmd: string; args: string[] }> = [];
      const fakeExec: Exec = vi.fn(async (cmd, args) => {
        execCalls.push({ cmd, args });
        // Simulate install success: create the dep dir so re-runs wouldn't re-install
        await mkdir(join(wfDir, 'node_modules', 'some-missing-dep'), { recursive: true });
        await writeFile(
          join(wfDir, 'node_modules', 'some-missing-dep', 'package.json'),
          JSON.stringify({ name: 'some-missing-dep', version: '1.0.0' }),
        );
        return { stdout: '', stderr: '', code: 0 };
      });

      await runWorkflow(wfPath, {
        runDir: dir,
        provider: new FakeProvider([]),
        exec: fakeExec,
      });

      expect(execCalls).toHaveLength(1);
      expect(execCalls[0].cmd).toBe('npm');
      expect(execCalls[0].args).toEqual(['ci']);
    } finally {
      await rm(wfDir, { recursive: true, force: true });
    }
  });

  it('FIX2: a bad plugin path creates a journal failed record (not unhandled crash)', async () => {
    // Workflow that declares a non-existent plugin
    const wfPath = join(dir, 'bad-plugin-wf.yaml');
    await writeFile(
      wfPath,
      [
        'name: bad-plugin-wf',
        "plugins: ['./nonexistent-plugin.ts']",
        'phases:',
        '  - name: Main',
        '    steps:',
        '      - id: s',
        '        run: "return 1;"',
      ].join('\n'),
    );

    // Should reject (plugin load fails)
    await expect(
      runWorkflow(wfPath, {
        provider: new FakeProvider([]),
        runDir: dir,
        isTty: false,
      }),
    ).rejects.toThrow();

    // And a journal record should exist in runDir (status: failed)
    const entries = await readdir(dir);
    const runDirs = entries.filter((e) => e.startsWith('run-'));
    expect(runDirs.length).toBeGreaterThan(0);
  });

  it('FIX4: does not mutate a caller-provided registry across two runs', async () => {
    // Plugin A (echo) and plugin B (double) — write both to temp dir
    await writeFile(
      join(dir, 'echo-plugin.ts'),
      [
        "import type { StepType } from 'plyflow/steps/types.js';",
        "const echoStep: StepType<{ value: unknown }> = {",
        "  name: 'echo',",
        "  match: () => false,",
        "  parse: (def) => ({ value: (def.with as any)?.value }),",
        "  run: async (cfg) => ({ output: cfg.value }),",
        "};",
        "export default echoStep;",
      ].join('\n'),
    );

    await writeFile(
      join(dir, 'double-plugin.ts'),
      [
        "import type { StepRegistry } from 'plyflow/steps/registry.js';",
        "import type { StepDef } from 'plyflow/core/types.js';",
        "export default function register(registry: StepRegistry): void {",
        "  registry.register({",
        "    name: 'double',",
        "    match: (def: StepDef) => def.step === 'double',",
        "    parse: (def: StepDef) => ({ n: (def.with as any)?.n as number }),",
        "    run: async (cfg: { n: number }) => ({ output: cfg.n * 2 }),",
        "  });",
        "}",
      ].join('\n'),
    );

    const wfEcho = join(dir, 'wf-echo.yaml');
    await writeFile(
      wfEcho,
      [
        'name: wf-echo',
        "plugins: ['./echo-plugin.ts']",
        'phases:',
        '  - name: Main',
        '    steps:',
        '      - id: e',
        '        step: echo',
        '        with:',
        "          value: 'hello'",
      ].join('\n'),
    );

    const wfDouble = join(dir, 'wf-double.yaml');
    await writeFile(
      wfDouble,
      [
        'name: wf-double',
        "plugins: ['./double-plugin.ts']",
        'phases:',
        '  - name: Main',
        '    steps:',
        '      - id: d',
        '        step: double',
        '        with:',
        '          n: 5',
      ].join('\n'),
    );

    // Shared registry provided by caller
    const sharedRegistry = buildDefaultRegistry();
    const initialTypeCount = (sharedRegistry as any).types.length as number;

    const res1 = await runWorkflow(wfEcho, {
      provider: new FakeProvider([]),
      runDir: dir,
      registry: sharedRegistry,
      isTty: false,
    });
    expect(res1.outputs['e']).toBe('hello');

    const res2 = await runWorkflow(wfDouble, {
      provider: new FakeProvider([]),
      runDir: dir,
      registry: sharedRegistry,
      isTty: false,
    });
    expect(res2.outputs['d']).toBe(10);

    // The caller's registry must NOT have been mutated
    expect((sharedRegistry as any).types.length).toBe(initialTypeCount);
  });
});
