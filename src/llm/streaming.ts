// Stream accumulator for Server-Sent Events (SSE)
// Uses UIState for coordinated output

import type { StreamChunk } from './types.js';
import { uiState } from '../ui/ui-state.js';

/**
 * Accumulates streaming chunks and updates UIState
 */
export class StreamAccumulator {
  private content = '';
  private reasoningContent = '';
  private toolCalls: Map<number, any> = new Map();
  private role = 'assistant';
  private isStreamingActive = false;

  addChunk(chunk: StreamChunk): void {
    if (chunk.delta.role) {
      this.role = chunk.delta.role;
    }

    if (chunk.delta.content) {
      this.content += chunk.delta.content;
    }

    if (chunk.delta.reasoningContent) {
      this.reasoningContent += chunk.delta.reasoningContent;
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
      reasoningContent: this.reasoningContent || undefined,
      toolCalls: toolCallsArray.length > 0 ? toolCallsArray : undefined,
    };
  }

  /**
   * Enable streaming mode
   */
  enableStreaming(): void {
    this.isStreamingActive = true;
    uiState.startStreaming();
  }

  /**
   * Update streaming display when content is received
   */
  updateStreamingDisplay(): void {
    if (this.isStreamingActive) {
      uiState.updateStreamContent(this.content);
    }
  }

  /**
   * Finalize streaming and clean up
   */
  finalizeStreaming(): void {
    if (this.isStreamingActive) {
      uiState.updateStreamContent(this.content);
      uiState.endStreaming();
      this.isStreamingActive = false;
    }
  }
}
