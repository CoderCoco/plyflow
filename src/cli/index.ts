#!/usr/bin/env node
import { render } from 'ink';
import React from 'react';
import { parseArgs } from './args.js';
import { loadWorkflow } from '../core/loader.js';
import { runWorkflow, type EngineEvent } from '../core/engine.js';
import { makeProvider } from '../providers/factory.js';
import { LineLogger } from '../tui/logger.js';
import { App } from '../tui/App.js';
import type { PromptRequest } from '../steps/types.js';

function coerceInputs(
  raw: Record<string, string>,
  defs: Record<string, { type: string }> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const t = defs?.[k]?.type;
    out[k] = t === 'number' ? Number(v) : t === 'boolean' ? v === 'true' : v;
  }
  return out;
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const wf = await loadWorkflow(args.workflow);
  const inputs = coerceInputs(args.inputs, wf.inputs);
  const provider = makeProvider('claude', 'api');

  if (!process.stdout.isTTY) {
    const logger = new LineLogger((line) => process.stdout.write(line + '\n'));
    await runWorkflow(args.workflow, {
      inputs,
      runId: args.resume,
      provider,
      onEvent: (e) => logger.handle(e),
      prompt: async () => {
        throw new Error('interactive input is not available in non-TTY mode');
      },
    });
    return;
  }

  // TTY: stream engine events into the Ink App.
  const queue: EngineEvent[] = [];
  let push: (() => void) | null = null;
  let finished = false;
  const events: AsyncIterable<EngineEvent> = {
    async *[Symbol.asyncIterator]() {
      while (!finished || queue.length > 0) {
        if (queue.length === 0) await new Promise<void>((r) => (push = r));
        while (queue.length > 0) yield queue.shift()!;
      }
    },
  };
  const emit = (e: EngineEvent) => {
    queue.push(e);
    push?.();
    push = null;
  };

  let promptHandler: ((stepId: string, req: PromptRequest) => Promise<unknown>) | null = null;
  const { waitUntilExit } = render(
    React.createElement(App, {
      workflow: wf,
      events,
      registerPrompt: (h) => (promptHandler = h),
      onDone: () => undefined,
    }),
  );

  await runWorkflow(args.workflow, {
    inputs,
    runId: args.resume,
    provider,
    onEvent: emit,
    prompt: (stepId, req) =>
      promptHandler ? promptHandler(stepId, req) : Promise.reject(new Error('prompt handler not ready')),
  });
  finished = true;
  push?.();
  await waitUntilExit();
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`plyflow: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
