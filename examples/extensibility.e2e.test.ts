/**
 * Task Z integration tests: extensibility examples (widgets + plugins).
 *
 * Tests the example workflows in examples/widgets/ and examples/plugins/ to
 * prove the v0.3 extensibility features work end-to-end:
 *
 *  1. The plugin example (examples/plugins/transform.yaml) runs via runWorkflow
 *     with a FakeProvider and isTty:false. The uppercase plugin is loaded via
 *     jiti, processes `with.text: 'hello'`, and produces `output: 'HELLO'`.
 *
 *  2. The widget example (examples/widgets/pick.yaml) parses via loadWorkflow
 *     and runs in non-TTY mode using its `default:` value — the widget step
 *     must NOT try to render an Ink component (there's no TTY in CI), and the
 *     run step that consumes the widget output must see the default value.
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { loadWorkflow } from '../src/core/loader.js';
import { runWorkflow } from '../src/core/engine.js';
import { FakeProvider } from '../src/providers/fake.js';

const examplesDir = dirname(fileURLToPath(import.meta.url));
const pluginWfPath = join(examplesDir, 'plugins', 'transform.yaml');
const widgetWfPath = join(examplesDir, 'widgets', 'pick.yaml');

describe('extensibility examples', () => {
  describe('plugin example (examples/plugins/transform.yaml)', () => {
    it('parses successfully', async () => {
      const wf = await loadWorkflow(pluginWfPath);
      expect(wf.name).toBe('transform');
      // plugins declared in YAML or package.json; either way the wf object is valid
    });

    it('runs end-to-end: uppercase step produces HELLO from hello', async () => {
      const result = await runWorkflow(pluginWfPath, {
        provider: new FakeProvider([]),
        runDir: join(examplesDir, '..', '.plyflow', 'runs', 'e2e-test'),
        isTty: false,
        // No exec injection: the plugins dir has no missing deps (only host-provided)
        // so prepareEnv won't attempt npm install.
      });

      // The uppercase step should output 'HELLO'
      expect(result.outputs['shout']).toBe('HELLO');
    });
  });

  describe('widget example (examples/widgets/pick.yaml)', () => {
    it('parses successfully', async () => {
      const wf = await loadWorkflow(widgetWfPath);
      expect(wf.name).toBe('pick-demo');
    });

    it('runs in non-TTY mode using the default: value', async () => {
      const result = await runWorkflow(widgetWfPath, {
        provider: new FakeProvider([]),
        runDir: join(examplesDir, '..', '.plyflow', 'runs', 'e2e-test'),
        isTty: false,
      });

      // The widget step default is 'typescript' (first choice); the run step
      // echoes it, so the result should contain that value.
      expect(result.outputs['picked']).toBe('typescript');
      expect(result.outputs['echo']).toBe('You picked: typescript');
    });
  });
});
