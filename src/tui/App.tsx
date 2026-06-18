import React, { useEffect, useState } from 'react';
import { Box, useApp } from 'ink';
import { ProgressTree, type PhaseView, type StepView } from './ProgressTree.js';
import { Prompt } from './prompts.js';
import type { EngineEvent } from '../core/engine.js';
import type { PromptRequest } from '../steps/types.js';
import type { WorkflowFile } from '../core/types.js';

interface PendingPrompt {
  stepId: string;
  request: PromptRequest;
  resolve: (value: unknown) => void;
}

export interface AppProps {
  workflow: WorkflowFile;
  events: AsyncIterable<EngineEvent>;
  registerPrompt: (handler: (stepId: string, req: PromptRequest) => Promise<unknown>) => void;
  onDone: () => void;
}

function initialPhases(wf: WorkflowFile): PhaseView[] {
  return wf.phases.map((p) => ({
    name: p.name,
    steps: p.steps.map<StepView>((s) => ({ id: s.id, status: 'pending' })),
  }));
}

export function App({ workflow, events, registerPrompt, onDone }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [phases, setPhases] = useState<PhaseView[]>(() => initialPhases(workflow));
  const [pending, setPending] = useState<PendingPrompt | null>(null);

  const setStatus = (id: string, patch: Partial<StepView>) =>
    setPhases((prev) =>
      prev.map((ph) => ({ ...ph, steps: ph.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
    );

  useEffect(() => {
    registerPrompt(
      (stepId, request) =>
        new Promise((resolve) => setPending({ stepId, request, resolve: (v) => { setPending(null); resolve(v); } })),
    );
    (async () => {
      for await (const e of events) {
        if (e.type === 'step-start') setStatus(e.stepId, { status: 'running' });
        else if (e.type === 'step-done') setStatus(e.stepId, { status: 'done', cached: e.cached });
        else if (e.type === 'step-error') setStatus(e.stepId, { status: 'error' });
      }
      onDone();
      exit();
    })();
  }, []);

  return (
    <Box flexDirection="column">
      <ProgressTree phases={phases} />
      {pending && <Prompt request={pending.request} onResolve={pending.resolve} />}
    </Box>
  );
}
