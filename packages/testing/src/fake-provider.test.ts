import { describe, it, expect } from 'vitest';
import { fakeProvider } from './index.js';

describe('fakeProvider', () => {
  it('dispatches by system-prompt substring', async () => {
    const p = fakeProvider({
      'Flight Director': { plan: ['a', 'b'] },
      'Astronaut': 'done',
    });
    const a = await p.complete({ system: 'You are the Flight Director.', prompt: '', model: 'm' });
    expect(a.structured).toEqual({ plan: ['a', 'b'] }); // plain object → structured
    const b = await p.complete({ system: 'You are an Astronaut.', prompt: '', model: 'm' });
    expect(b.text).toBe('done'); // string → text
  });

  it('passes through an explicit AIResult value', async () => {
    const p = fakeProvider({ X: { text: 'hi', usage: { inputTokens: 1, outputTokens: 2 } } });
    const r = await p.complete({ system: 'contains X here', prompt: '', model: 'm' });
    expect(r.text).toBe('hi');
    expect(r.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  it('throws a clear error when no rule matches', async () => {
    const p = fakeProvider({ X: 'x' });
    await expect(p.complete({ system: 'no match', prompt: '', model: 'm' })).rejects.toThrow(/no fakeProvider rule/i);
  });

  it('wraps a structured object that happens to contain a text field (not misclassified as AIResult)', async () => {
    // { text, title } has a non-AIResult key (title) → it is the structured output, not an AIResult.
    const p = fakeProvider({ X: { text: 'body', title: 'heading' } });
    const r = await p.complete({ system: 'contains X', prompt: '', model: 'm' });
    expect(r.structured).toEqual({ text: 'body', title: 'heading' });
    expect(r.text).toBeUndefined();
  });

  it('treats a bare usage-only object as a structured fixture (not an AIResult)', async () => {
    const p = fakeProvider({ X: { usage: 1 } });
    const r = await p.complete({ system: 'contains X', prompt: '', model: 'm' });
    expect(r.structured).toEqual({ usage: 1 });
  });
});
