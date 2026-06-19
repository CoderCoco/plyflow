/**
 * Workflow environment preparation module.
 *
 * Locates a workflow's package.json, resolves its host-provided modules and
 * plugins, and auto-installs its declared dependencies when missing.
 */

import { access, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { DEFAULT_PROVIDED } from './module-loader.js';

/**
 * Minimal exec interface for running shell commands (injectable for tests).
 * Never throws on non-zero exit — caller decides what to do with `code`.
 */
export type Exec = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string; code: number }>;

/** The resolved workflow environment returned by prepareEnv. */
export interface WorkflowEnv {
  /** Directory containing the workflow file. */
  dir: string;
  /** Deduplicated list of host-provided module specifiers (DEFAULT_PROVIDED ∪ pkg.plyflow.provided). */
  provided: string[];
  /** Plugin paths declared in pkg.plyflow.plugins (default []). */
  plugins: string[];
}

/** Options for prepareEnv. */
export interface PrepareOptions {
  /** Injectable exec for running npm commands; defaults to a real execFile wrapper. */
  exec?: Exec;
  /** Called with a short progress message before running an install. */
  onLog?: (msg: string) => void;
}

/** Default exec implementation wrapping node:child_process execFile. */
const defaultExec: Exec = (cmd, args, opts) =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd: opts?.cwd }, (err, stdout, stderr) => {
      const code = err && 'code' in err && typeof err.code === 'number' ? err.code : (err ? 1 : 0);
      resolve({ stdout, stderr, code });
    });
  });

/** Check whether a path exists (any type). */
async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prepare the environment for a workflow file:
 * 1. Resolve dir from workflowPath.
 * 2. If no package.json → return defaults, no install.
 * 3. Parse package.json; merge provided list; collect plugins.
 * 4. For each declared dep (minus provided), check node_modules.
 * 5. If any missing → run npm ci (if lockfile present) else npm install.
 * 6. Return WorkflowEnv.
 */
export async function prepareEnv(
  workflowPath: string,
  opts?: PrepareOptions,
): Promise<WorkflowEnv> {
  const exec = opts?.exec ?? defaultExec;
  const onLog = opts?.onLog;
  const dir = dirname(workflowPath);

  // Check for package.json
  const pkgPath = join(dir, 'package.json');
  if (!(await pathExists(pkgPath))) {
    return { dir, provided: DEFAULT_PROVIDED, plugins: [] };
  }

  // Parse package.json
  const pkgRaw = await readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(pkgRaw) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    plyflow?: {
      provided?: string[];
      plugins?: string[];
    };
  };

  // Build provided set: DEFAULT_PROVIDED ∪ pkg.plyflow.provided, deduplicated
  const providedSet = new Set<string>(DEFAULT_PROVIDED);
  for (const p of pkg.plyflow?.provided ?? []) {
    providedSet.add(p);
  }
  const provided = Array.from(providedSet);

  // Collect plugins
  const plugins: string[] = pkg.plyflow?.plugins ?? [];

  // Collect declared deps minus provided
  const declaredDeps = new Set<string>([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
  for (const p of provided) {
    declaredDeps.delete(p);
  }

  // If no deps to check, return early
  if (declaredDeps.size === 0) {
    return { dir, provided, plugins };
  }

  // Check which deps are missing from node_modules
  const missingDeps: string[] = [];
  for (const dep of declaredDeps) {
    const depPkgPath = join(dir, 'node_modules', dep, 'package.json');
    if (!(await pathExists(depPkgPath))) {
      missingDeps.push(dep);
    }
  }

  if (missingDeps.length === 0) {
    return { dir, provided, plugins };
  }

  // Determine install command: npm ci if lockfile present, else npm install
  const hasLockfile =
    (await pathExists(join(dir, 'package-lock.json'))) ||
    (await pathExists(join(dir, 'npm-shrinkwrap.json')));

  const installArgs = hasLockfile ? ['ci'] : ['install'];
  const installCmd = `npm ${installArgs.join(' ')}`;

  if (onLog) {
    onLog(`Installing missing dependencies in ${dir} via \`${installCmd}\`…`);
  }

  const result = await exec('npm', installArgs, { cwd: dir });

  if (result.code !== 0) {
    throw new Error(
      `npm ${installArgs[0]} failed (exit ${result.code}) in ${dir}:\n${result.stderr}`,
    );
  }

  return { dir, provided, plugins };
}
