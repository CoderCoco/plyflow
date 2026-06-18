import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import matter from 'gray-matter';
import { parseWorkflow, parseAgentConfig } from './format-schema.js';
import type { WorkflowFile, AgentFile } from './types.js';

export async function loadWorkflow(path: string): Promise<WorkflowFile> {
  const text = await readFile(path, 'utf8');
  const raw = parseYaml(text);
  return parseWorkflow(raw);
}

export async function loadAgent(path: string): Promise<AgentFile> {
  const text = await readFile(path, 'utf8');
  const { data, content } = matter(text);
  return { config: parseAgentConfig(data), systemPrompt: content.trim() };
}
