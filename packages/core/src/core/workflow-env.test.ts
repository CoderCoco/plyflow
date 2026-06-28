import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { prepareEnv } from './workflow-env.js';
import { DEFAULT_PROVIDED } from './module-loader.js';
import type { Exec } from './workflow-env.js';

/** A fake exec that records calls and returns success (code 0) by default. */
function makeFakeExec(code = 0, stderr = ''): { exec: Exec; calls: Array<{ cmd: string; args: string[]; cwd?: string }> } {
  const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
  const exec: Exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd });
    return { stdout: '', stderr, code };
  };
  return { exec, calls };
}

/** Write a package.json to the given dir. */
async function writePkg(dir: string, content: object): Promise<void> {
  await writeFile(join(dir, 'package.json'), JSON.stringify(content, null, 2));
}

/** Create a fake node_modules/<dep>/package.json to simulate installed dep. */
async function installDep(dir: string, dep: string): Promise<void> {
  // Handle scoped packages like @scope/name
  const depDir = join(dir, 'node_modules', dep);
  await mkdir(depDir, { recursive: true });
  await writeFile(join(depDir, 'package.json'), '{"name":"' + dep + '"}');
}

describe('prepareEnv', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'plyflow-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('no package.json → returns DEFAULT_PROVIDED, empty plugins, NO exec calls', async () => {
    const { exec, calls } = makeFakeExec();
    const workflowPath = join(tmpDir, 'workflow.yaml');

    const env = await prepareEnv(workflowPath, { exec });

    expect(env.dir).toBe(tmpDir);
    expect(env.provided).toEqual(DEFAULT_PROVIDED);
    expect(env.plugins).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('missing dep + package-lock.json → calls npm ci in dir', async () => {
    await writePkg(tmpDir, {
      dependencies: { 'some-lib': '1.0.0' },
    });
    // Create a lockfile
    await writeFile(join(tmpDir, 'package-lock.json'), '{}');
    // Do NOT create node_modules/some-lib (it's missing)

    const { exec, calls } = makeFakeExec();
    const workflowPath = join(tmpDir, 'workflow.yaml');

    await prepareEnv(workflowPath, { exec });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe('npm');
    expect(calls[0]!.args).toContain('ci');
    expect(calls[0]!.cwd).toBe(tmpDir);
  });

  it('missing dep + NO lockfile → calls npm install', async () => {
    await writePkg(tmpDir, {
      dependencies: { 'some-lib': '1.0.0' },
    });
    // No lockfile
    const { exec, calls } = makeFakeExec();
    const workflowPath = join(tmpDir, 'workflow.yaml');

    await prepareEnv(workflowPath, { exec });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe('npm');
    expect(calls[0]!.args).toContain('install');
    expect(calls[0]!.cwd).toBe(tmpDir);
  });

  it('all declared deps present in node_modules → NO exec call', async () => {
    await writePkg(tmpDir, {
      dependencies: { 'some-lib': '1.0.0' },
    });
    await installDep(tmpDir, 'some-lib');

    const { exec, calls } = makeFakeExec();
    const workflowPath = join(tmpDir, 'workflow.yaml');

    await prepareEnv(workflowPath, { exec });

    expect(calls).toHaveLength(0);
  });

  it('dep that is a PROVIDED module (e.g. zod) → excluded from missing-check, no install', async () => {
    await writePkg(tmpDir, {
      dependencies: { zod: '^4.0.0' },
    });
    // node_modules/zod is NOT present — but zod is provided so should be excluded

    const { exec, calls } = makeFakeExec();
    const workflowPath = join(tmpDir, 'workflow.yaml');

    await prepareEnv(workflowPath, { exec });

    expect(calls).toHaveLength(0);
  });

  it('pkg.plyflow.provided merged with defaults (deduped)', async () => {
    await writePkg(tmpDir, {
      plyflow: {
        provided: ['zod', 'my-custom-lib'],
      },
    });

    const { exec } = makeFakeExec();
    const workflowPath = join(tmpDir, 'workflow.yaml');

    const env = await prepareEnv(workflowPath, { exec });

    // Should contain all DEFAULT_PROVIDED + my-custom-lib, with no duplicates
    for (const dep of DEFAULT_PROVIDED) {
      expect(env.provided).toContain(dep);
    }
    expect(env.provided).toContain('my-custom-lib');
    // No duplicates
    const unique = new Set(env.provided);
    expect(env.provided.length).toBe(unique.size);
  });

  it('pkg.plyflow.plugins parsed correctly', async () => {
    await writePkg(tmpDir, {
      plyflow: {
        plugins: ['./plugins/my-plugin.ts', './plugins/other.ts'],
      },
    });

    const { exec } = makeFakeExec();
    const workflowPath = join(tmpDir, 'workflow.yaml');

    const env = await prepareEnv(workflowPath, { exec });

    expect(env.plugins).toEqual(['./plugins/my-plugin.ts', './plugins/other.ts']);
  });

  it('install exec returning non-zero code → throws including stderr', async () => {
    await writePkg(tmpDir, {
      dependencies: { 'broken-pkg': '1.0.0' },
    });

    const stderrMsg = 'npm ERR! 404 Not Found';
    const { exec } = makeFakeExec(1, stderrMsg);
    const workflowPath = join(tmpDir, 'workflow.yaml');

    await expect(prepareEnv(workflowPath, { exec })).rejects.toThrow(stderrMsg);
  });

  it('uses npm-shrinkwrap.json as lockfile indicator → calls npm ci', async () => {
    await writePkg(tmpDir, {
      dependencies: { 'some-lib': '1.0.0' },
    });
    await writeFile(join(tmpDir, 'npm-shrinkwrap.json'), '{}');

    const { exec, calls } = makeFakeExec();
    const workflowPath = join(tmpDir, 'workflow.yaml');

    await prepareEnv(workflowPath, { exec });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toContain('ci');
  });

  it('devDependencies are also checked (minus provided)', async () => {
    await writePkg(tmpDir, {
      devDependencies: { 'dev-tool': '1.0.0' },
    });
    // dev-tool not installed

    const { exec, calls } = makeFakeExec();
    const workflowPath = join(tmpDir, 'workflow.yaml');

    await prepareEnv(workflowPath, { exec });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toContain('install');
  });

  it('onLog callback called before install', async () => {
    await writePkg(tmpDir, {
      dependencies: { 'some-lib': '1.0.0' },
    });

    const { exec } = makeFakeExec();
    const logMessages: string[] = [];
    const workflowPath = join(tmpDir, 'workflow.yaml');

    await prepareEnv(workflowPath, { exec, onLog: (msg) => logMessages.push(msg) });

    expect(logMessages.length).toBeGreaterThan(0);
  });
});
