import { describe, it, expect } from 'vitest';
import { shQuote, shJoin } from './sh.js';

describe('shQuote', () => {
  it('leaves simple tokens unquoted', () => {
    expect(shQuote('git')).toBe('git');
    expect(shQuote('origin/main')).toBe('origin/main');
    expect(shQuote('claude/issue-12-fix')).toBe('claude/issue-12-fix');
  });
  it('single-quotes tokens with spaces or newlines', () => {
    expect(shQuote('a b')).toBe("'a b'");
    expect(shQuote('line1\nline2')).toBe("'line1\nline2'");
  });
  it('escapes embedded single quotes', () => {
    expect(shQuote("it's")).toBe("'it'\\''s'");
  });
  it('quotes the empty string', () => {
    expect(shQuote('')).toBe("''");
  });
});

describe('shJoin', () => {
  it('joins quoted parts with spaces', () => {
    expect(shJoin(['gh', 'pr', 'create', '--title', 'a b'])).toBe("gh pr create --title 'a b'");
  });
});
