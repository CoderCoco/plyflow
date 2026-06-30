export type Status = 'pending' | 'running' | 'done' | 'error';

export const glyph: Record<Status, string> = {
  pending: '○',
  running: '◐',
  done: '✓',
  error: '✗',
};

export const color: Record<Status, string> = {
  pending: 'gray',
  running: 'cyan',
  done: 'green',
  error: 'red',
};
