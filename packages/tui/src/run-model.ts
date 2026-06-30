import type { EngineEvent, AgentChunk, StepKind } from '@plyflow/core';

export const MAX_BUFFER = 500;

export interface AgentInstance {
  instanceId: string;
  parentId: string | null;
  stepId: string;
  kind: StepKind;
  status: 'pending' | 'running' | 'done' | 'error';
  label: string;
  depth: number;
  buffer: AgentChunk[];
  trimmed: boolean;
  output?: unknown;
  tokens?: number;
  error?: string;
}

export interface RunModel {
  order: string[];
  byId: Map<string, AgentInstance>;
  phases: string[];
}

export function createRunModel(): RunModel {
  return { order: [], byId: new Map(), phases: [] };
}

/** Path depth relative to the `phase:<name>` root (the phase segment is depth 0). */
function depthOf(instanceId: string): number {
  return instanceId.split('/').length - 1;
}

/** Label = stepId, with the nearest enclosing foreach/loop key in brackets. */
export function deriveLabel(instanceId: string, stepId: string): string {
  const segs = instanceId.split('/');
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s.startsWith('foreach:')) return `${stepId}[${s.slice('foreach:'.length)}]`;
    if (s.startsWith('loop:')) return `${stepId}[${s.slice('loop:'.length)}]`;
  }
  return stepId;
}

/** Insert id so descendants cluster directly after their nearest ancestor already in `order`. */
function insertOrdered(order: string[], id: string): string[] {
  // Find the deepest existing entry that is a prefix-ancestor of id; insert after its subtree.
  let insertAt = order.length;
  let bestAncestorIdx = -1;
  for (let i = 0; i < order.length; i++) {
    if (id.startsWith(order[i] + '/')) bestAncestorIdx = i;
  }
  if (bestAncestorIdx >= 0) {
    const ancestor = order[bestAncestorIdx];
    insertAt = bestAncestorIdx + 1;
    while (insertAt < order.length && order[insertAt].startsWith(ancestor + '/')) insertAt++;
  }
  return [...order.slice(0, insertAt), id, ...order.slice(insertAt)];
}

function cloneModel(m: RunModel): RunModel {
  return { order: m.order, byId: new Map(m.byId), phases: m.phases };
}

function upsert(m: RunModel, id: string, patch: Partial<AgentInstance>): RunModel {
  const existing = m.byId.get(id);
  if (!existing) return m; // event for an unknown instance; ignore
  const next = cloneModel(m);
  next.byId.set(id, { ...existing, ...patch });
  return next;
}

export function applyEvent(model: RunModel, e: EngineEvent): RunModel {
  switch (e.type) {
    case 'phase-start': {
      if (model.phases.includes(e.phase)) return model;
      return { ...cloneModel(model), phases: [...model.phases, e.phase] };
    }
    case 'step-start': {
      const inst: AgentInstance = {
        instanceId: e.instanceId,
        parentId: e.parentId,
        stepId: e.stepId,
        kind: e.kind,
        status: 'running',
        label: deriveLabel(e.instanceId, e.stepId),
        depth: depthOf(e.instanceId),
        buffer: [],
        trimmed: false,
      };
      const next = cloneModel(model);
      next.byId.set(e.instanceId, inst);
      next.order = model.byId.has(e.instanceId) ? model.order : insertOrdered(model.order, e.instanceId);
      return next;
    }
    case 'agent-stream': {
      const existing = model.byId.get(e.instanceId);
      if (!existing) return model;
      let buffer = [...existing.buffer, e.chunk];
      let trimmed = existing.trimmed;
      if (buffer.length > MAX_BUFFER) {
        buffer = buffer.slice(buffer.length - MAX_BUFFER);
        trimmed = true;
      }
      const tokens = e.chunk.t === 'result' && e.chunk.tokens !== undefined ? e.chunk.tokens : existing.tokens;
      return upsert(model, e.instanceId, { buffer, trimmed, tokens });
    }
    case 'step-done':
      return upsert(model, e.instanceId, { status: 'done', output: e.output });
    case 'step-error':
      return upsert(model, e.instanceId, { status: 'error', error: e.error });
    case 'step-skipped':
      return model;
    case 'step-log':
      return model;
  }
}
