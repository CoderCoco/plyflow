import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface JournalEntry {
  stepId: string;
  hash: string;
  output: unknown;
  status: 'completed' | 'failed';
  startedAt: number;
  endedAt: number;
}

interface RunData {
  runId: string;
  workflow: string;
  inputs: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed';
  entries: Record<string, JournalEntry>;
}

export function hashStep(resolvedConfig: unknown): string {
  return createHash('sha256').update(JSON.stringify(resolvedConfig)).digest('hex').slice(0, 16);
}

export class Journal {
  private constructor(
    private readonly dir: string,
    private readonly data: RunData,
  ) {}

  get runId(): string {
    return this.data.runId;
  }

  static create(dir: string, runId: string, workflow: string, inputs: Record<string, unknown>): Journal {
    return new Journal(dir, { runId, workflow, inputs, status: 'running', entries: {} });
  }

  static async load(dir: string, runId: string): Promise<Journal> {
    const text = await readFile(join(dir, `${runId}.json`), 'utf8');
    return new Journal(dir, JSON.parse(text) as RunData);
  }

  get(stepId: string): JournalEntry | undefined {
    return this.data.entries[stepId];
  }

  async record(entry: JournalEntry): Promise<void> {
    this.data.entries[entry.stepId] = entry;
    await this.flush();
  }

  async setStatus(status: RunData['status']): Promise<void> {
    this.data.status = status;
    await this.flush();
  }

  private async flush(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${this.data.runId}.json`), JSON.stringify(this.data, null, 2));
  }
}
