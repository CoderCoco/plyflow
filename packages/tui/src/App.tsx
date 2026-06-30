import React, { useEffect, useReducer, useState } from 'react';
import { Box, useApp } from 'ink';
import { RunView } from './RunView.js';
import { useRunNav } from './use-run-nav.js';
import { useAltscreen } from './use-altscreen.js';
import { QuestionModal, type PendingUi } from './QuestionModal.js';
import { applyEvent, createRunModel, type RunModel } from './run-model.js';
import type { EngineEvent, UiRequest } from '@plyflow/core';
import type { WorkflowFile } from '@plyflow/core';

export interface AppProps {
  workflow: WorkflowFile;
  events: AsyncIterable<EngineEvent>;
  registerPrompt: (handler: (stepId: string, req: UiRequest) => Promise<unknown>) => void;
  onDone: () => void;
  /** Injectable terminal output stream; defaults to process.stdout. Pass a fake in tests. */
  out?: Parameters<typeof useAltscreen>[0];
}

export function App({ events, registerPrompt, onDone, out }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { rows, columns } = useAltscreen(out);
  const [model, dispatch] = useReducer(applyEvent, undefined, createRunModel) as [RunModel, (e: EngineEvent) => void];
  const [queue, setQueue] = useState<PendingUi[]>([]);

  const pending = queue[0] ?? null;

  const nav = useRunNav(model, { active: !pending });

  useEffect(() => {
    registerPrompt(
      (stepId, request) =>
        new Promise((resolve) => {
          const entry: PendingUi = {
            stepId,
            request,
            resolve: (v) => {
              setQueue((q) => q.filter((e) => e !== entry));
              resolve(v);
            },
          };
          setQueue((q) => [...q, entry]);
        }),
    );
    (async () => {
      for await (const e of events) dispatch(e);
      onDone();
      // Defer exit by one macrotask so React can flush the final dispatch
      // before Ink tears down the render tree.
      setTimeout(exit, 0);
    })();
  }, []);

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <RunView model={model} cursorId={nav.cursorId} focus={nav.focus} scrollOffset={nav.scrollOffset} width={columns} />
      {pending && <QuestionModal pending={pending} />}
    </Box>
  );
}
