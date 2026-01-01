// Stream accumulator for Server-Sent Events (SSE)

import type { StreamChunk } from './types.js';
import chalk from 'chalk';
import { marked } from 'marked';

/**
 * Accumulates streaming chunks and renders them to stdout in real-time
 */
export class StreamAccumulator {
  private content = '';
  private toolCalls: Map<number, any> = new Map();
  private role = 'assistant';
  private renderer?: StreamingRenderer;

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

  /**
   * Enable streaming mode with a renderer
   */
  enableStreaming(): void {
    this.renderer = new StreamingRenderer();
    this.renderer.start();
  }

  /**
   * Update streaming display when content is received
   */
  updateStreamingDisplay(): void {
    if (this.renderer) {
      this.renderer.update(this.content);
    }
  }

  /**
   * Finalize streaming and clean up
   */
  finalizeStreaming(): void {
    if (this.renderer) {
      this.renderer.update(this.content);
      this.renderer.stop();
      this.renderer = undefined;
    }
  }
}

/**
 * Real-time streaming renderer for markdown content
 */
class StreamingRenderer {
  private lines: string[] = [];
  private activeCodeBlock = false;
  private currentContent = '';

  start(): void {
    // Print the "Assistant:" label at the start
    process.stdout.write(chalk.cyan('\nAssistant: '));
  }

  update(content: string): void {
    const diff = content.slice(this.currentContent.length);
    if (!diff) return;

    // Detect and handle code blocks
    this.handleCodeBlocks(diff);

    // Write the new content directly to stdout
    process.stdout.write(diff);
    this.currentContent = content;
  }

  private handleCodeBlocks(chunk: string): void {
    // Check for code block markers
    const codeBlockRegex = /```(\w*)?/g;
    let match;
    
    // Reset regex state for this chunk
    while ((match = codeBlockRegex.exec(chunk)) !== null) {
      this.activeCodeBlock = !this.activeCodeBlock;
    }

    // If we're in a code block, we could apply special formatting
    // For now, we let the raw text flow through
  }

  stop(): void {
    // Ensure we end on a new line
    if (!this.currentContent.endsWith('\n')) {
      process.stdout.write('\n');
    }
    process.stdout.write('\n');
  }
}
