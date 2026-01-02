// Stream accumulator for Server-Sent Events (SSE)

import type { StreamChunk } from './types.js';
import chalk from 'chalk';
import { marked } from 'marked';
import { CodeBlockDetector, syntaxHighlighter } from '../ui/syntax-highlighter.js';

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
 * Real-time streaming renderer for markdown content with syntax highlighting
 */
class StreamingRenderer {
  private codeBlockDetector: CodeBlockDetector;
  private currentContent = '';
  private pendingText = '';

  constructor() {
    this.codeBlockDetector = new CodeBlockDetector();
  }

  start(): void {
    // Print the "Assistant:" label at the start
    process.stdout.write(chalk.cyan('\nAssistant: '));
  }

  update(content: string): void {
    const diff = content.slice(this.currentContent.length);
    if (!diff) return;

    // Add to pending text and try to parse
    this.pendingText += diff;

    // Parse blocks from pending text
    const blocks = this.codeBlockDetector.parse(this.pendingText);

    // Process complete blocks
    for (const block of blocks) {
      if (block.type === 'code') {
        // Apply syntax highlighting to code blocks
        const highlighted = syntaxHighlighter.highlight(block.content, block.language || 'text');

        // Add code block markers with language
        process.stdout.write(chalk.gray('```') + chalk.dim(block.language || '') + '\n');
        process.stdout.write(highlighted);
        process.stdout.write(chalk.gray('```') + '\n');
      } else {
        // Regular text - write as-is
        process.stdout.write(block.content);
      }
    }

    // Clear pending text as we've processed it
    this.pendingText = '';
    this.currentContent = content;
  }

  stop(): void {
    // Flush any remaining pending text
    if (this.pendingText) {
      process.stdout.write(this.pendingText);
    }

    // Ensure we end on a new line
    if (!this.currentContent.endsWith('\n')) {
      process.stdout.write('\n');
    }
    process.stdout.write('\n');

    // Reset detector for next stream
    this.codeBlockDetector.reset();
  }
}
