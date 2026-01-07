import type { ToolDefinition } from '../llm/types.js';

export function isToolAllowed(toolName: string, allowedTools?: string[]): boolean {
  // Undefined means "no restriction"; an empty array means "no tools allowed".
  if (allowedTools === undefined) return true;
  return allowedTools.includes(toolName);
}

export function filterToolDefinitions(definitions: ToolDefinition[], allowedTools?: string[]): ToolDefinition[] {
  // Undefined means "no restriction"; an empty array means "no tools allowed".
  if (allowedTools === undefined) return definitions;
  const allowedSet = new Set(allowedTools);
  return definitions.filter(d => allowedSet.has(d.name));
}
