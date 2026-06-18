import { describe, it, expect } from 'vitest';
import { FakeProvider } from './fake.js';

describe('FakeProvider', () => {
  it('returns the scripted result and records the call', async () => {
    const p = new FakeProvider([{ text: 'hi' }]);
    const r = await p.complete({ system: 'sys', prompt: 'p', model: 'm' });
    expect(r.text).toBe('hi');
    expect(p.calls[0]!.prompt).toBe('p');
  });

  it('returns structured output when scripted', async () => {
    const p = new FakeProvider([{ structured: { title: 'T' } }]);
    const r = await p.complete({ system: '', prompt: '', model: 'm', outputSchema: {} });
    expect(r.structured).toEqual({ title: 'T' });
  });
});
