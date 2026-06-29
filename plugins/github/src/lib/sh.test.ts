import { describe, it, expect } from 'vitest';
import { shQuote, shJoin } from './sh.js';

describe('shQuote', () => {
  it('leaves simple tokens unquoted', () => {
    expect(shQuote('gh')).toBe('gh');
    expect(shQuote('number,title,body')).toBe('number,title,body');
  });
  it('single-quotes tokens with spaces or newlines', () => {
    expect(shQuote('Fix the bug')).toBe("'Fix the bug'");
    expect(shQuote('## Summary\n- a')).toBe("'## Summary\n- a'");
  });
  it('escapes embedded single quotes', () => {
    expect(shQuote("don't")).toBe("'don'\\''t'");
  });
  it('quotes the empty string', () => {
    expect(shQuote('')).toBe("''");
  });
});

describe('shJoin', () => {
  it('joins quoted parts', () => {
    expect(shJoin(['gh', 'pr', 'comment', '5', '--body', 'hi there'])).toBe("gh pr comment 5 --body 'hi there'");
  });
});
