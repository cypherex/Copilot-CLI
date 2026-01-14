import { readFile } from 'fs/promises';
import type { AgentEvent } from './types.js';

export interface TraceSummary {
  header?: any;
  sessionId?: string;
  assistantResponses: number;
  toolCalls: number;
  toolErrors: number;
  lastAssistantMessage?: string;
}

export async function readTraceEvents(tracePath: string): Promise<AgentEvent[]> {
  const raw = await readFile(tracePath, 'utf-8');
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  const events: AgentEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // Ignore malformed lines
    }
  }
  return events;
}

export function summarizeTrace(events: AgentEvent[]): TraceSummary {
  let header: any;
  let sessionId: string | undefined;
  let assistantResponses = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let lastAssistantMessage: string | undefined;

  for (const e of events) {
    if (e.type === 'trace_header') {
      header = e;
    }
    if ((e as any).sessionId && !sessionId) {
      sessionId = (e as any).sessionId;
    }
    if (e.type === 'assistant_response') {
      assistantResponses++;
      const msg = (e as any).assistantMessage;
      if (typeof msg === 'string' && msg.trim().length > 0) {
        lastAssistantMessage = msg;
      }
    }
    if (e.type === 'tool_pre_execute') {
      toolCalls++;
    }
    if (e.type === 'tool_post_execute') {
      const tr = (e as any).toolResult;
      if (tr && tr.success === false) {
        toolErrors++;
      }
    }
  }

  return { header, sessionId, assistantResponses, toolCalls, toolErrors, lastAssistantMessage };
}
