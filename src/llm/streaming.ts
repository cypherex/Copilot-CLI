// Stream accumulator for Server-Sent Events (SSE)

import type { StreamChunk } from './types.js';

export class StreamAccumulator {
  private content = '';
  private toolCalls: Map<number, any> = new Map();
  private role = 'assistant';

  addChunk(chunk: StreamChunk): void {
    if (chunk.delta.role) {
      this.role = chunk.delta.role;
    }

    if (chunk.delta.content) {
      this.content += chunk.delta.content;
    }

    if (chunk.delta.toolCalls) {
      for (const toolCallDelta of chunk.delta.toolCalls) {
        const existing = this.toolCalls.get(toolCallDelta.index) || {
          id: '',
          type: 'function',
          function: { name: '', arguments: '' },
        };

        if (toolCallDelta.id) existing.id = toolCallDelta.id;
        if (toolCallDelta.type) existing.type = toolCallDelta.type;
        if (toolCallDelta.function?.name) {
          existing.function.name += toolCallDelta.function.name;
        }
        if (toolCallDelta.function?.arguments) {
          existing.function.arguments += toolCallDelta.function.arguments;
        }

        this.toolCalls.set(toolCallDelta.index, existing);
      }
    }
  }

  getResponse() {
    const toolCallsArray = Array.from(this.toolCalls.values());

    return {
      content: this.content,
      toolCalls: toolCallsArray.length > 0 ? toolCallsArray : undefined,
    };
  }
}
