import { it, expect } from 'vitest';
import { runWorkflow } from './engine.js';
import { FakeProvider } from '../providers/fake.js';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('loads a plugin declared by bare package specifier from node_modules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ply-pkgplugin-'));
  // Fake installed plugin package: node_modules/shout-plugin
  const pkgDir = join(dir, 'node_modules', 'shout-plugin');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'shout-plugin', type: 'module', main: 'index.js' }));
  writeFileSync(
    join(pkgDir, 'index.js'),
    [
      'export default {',
      '  name: "shout",',
      '  match: (def) => def.step === "shout",',
      '  parse: (def) => ({ text: def.with?.text ?? "" }),',
      '  run: async (cfg) => ({ output: String(cfg.text).toUpperCase() }),',
      '};',
    ].join('\n'),
  );
  // Minimal package.json in the workflow dir so Node resolution finds node_modules
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'wf', type: 'module' }),
  );
  writeFileSync(
    join(dir, 'w.yaml'),
    [
      'name: w',
      'plugins:',
      '  - shout-plugin',
      'phases:',
      '  - name: p',
      '    steps:',
      '      - id: s',
      '        step: shout',
      '        with: { text: hello }',
    ].join('\n'),
  );
  const res = await runWorkflow(join(dir, 'w.yaml'), { provider: new FakeProvider([]), isTty: false });
  expect(res.outputs.s).toBe('HELLO');
});
