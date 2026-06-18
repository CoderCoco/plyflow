import type { AIProvider, AICompleteRequest, AIResult } from './types.js';

export class FakeProvider implements AIProvider {
  name = 'fake';
  calls: AICompleteRequest[] = [];
  private queue: AIResult[];

  constructor(results: AIResult[]) {
    this.queue = [...results];
  }

  async complete(req: AICompleteRequest): Promise<AIResult> {
    this.calls.push(req);
    const next = this.queue.shift();
    if (!next) throw new Error('FakeProvider: no scripted result left');
    return next;
  }
}
