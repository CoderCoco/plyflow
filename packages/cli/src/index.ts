#!/usr/bin/env node
import { render } from 'ink';
import React from 'react';
import { parseArgs } from './args.js';
import { loadWorkflow, runWorkflow, makeProvider, type EngineEvent } from '@plyflow/core';
import type { UiRequest } from '@plyflow/core';
import { resolveWorkflowSource } from '@plyflow/core/remote';
import { ensureTrusted, readlineConfirm } from './trust-prompt.js';
import { LineLogger, App } from '@plyflow/tui';
import { coerceInputs } from './coerce.js';

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const resolved = await resolveWorkflowSource(args.workflow, { refresh: args.refresh });
  await ensureTrusted(resolved, {
    isTty: Boolean(process.stdout.isTTY),
    yes: args.yes,
    confirm: readlineConfirm,
    log: (line) => process.stderr.write(line + '\n'),
  });
  const wfPath = resolved.localPath;
  const wf = await loadWorkflow(wfPath);
  const inputs = coerceInputs(args.inputs, wf.inputs);
  const provider = makeProvider('claude', 'api');

  if (!process.stdout.isTTY) {
    const logger = new LineLogger((line) => process.stdout.write(line + '\n'));
    await runWorkflow(wfPath, {
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

  let promptHandler: ((stepId: string, req: UiRequest) => Promise<unknown>) | null = null;
  const { waitUntilExit } = render(
    React.createElement(App, {
      workflow: wf,
      events,
      registerPrompt: (h) => (promptHandler = h),
      onDone: () => undefined,
    }),
  );

  await runWorkflow(wfPath, {
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
