import { describe, it, expect } from 'vitest';
import { mockExec } from './index.js';

describe('mockExec', () => {
  it('matches a command by substring and returns the scripted result', async () => {
    const exec = mockExec({
      'gh issue view': { stdout: '{"title":"x"}', code: 0 },
      'git push': { stdout: '', code: 0 },
    });
    expect(await exec('gh issue view 7 --json title')).toEqual({ stdout: '{"title":"x"}', stderr: '', code: 0 });
    expect(await exec('git push -u origin HEAD')).toEqual({ stdout: '', stderr: '', code: 0 });
  });

  it('defaults stdout/stderr to "" and code to 0', async () => {
    const exec = mockExec({ ls: {} });
    expect(await exec('ls -la')).toEqual({ stdout: '', stderr: '', code: 0 });
  });

  it('throws when no rule matches the command', async () => {
    const exec = mockExec({ ls: {} });
    await expect(exec('rm -rf /')).rejects.toThrow(/no mockExec rule/i);
  });
});
