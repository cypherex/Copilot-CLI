/**
 * LogManager - Manages structured logging with separate files for subagents
 *
 * When output-file is specified, creates:
 *   output.txt                 - Main loop output
 *   output.subagents/          - Directory for subagent logs
 *     explore-abc123.log       - Individual subagent outputs
 */

import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname, basename, join } from 'path';
import type { WriteStream } from 'fs';

export interface LogManagerOptions {
  mainOutputPath: string;  // Path to main output file
}

/**
 * Manages structured logging with separate files for main loop and subagents
 */
export class LogManager {
  private mainStream: WriteStream;
  private subagentStreams: Map<string, WriteStream> = new Map();
  private subagentDir: string;
  private subagentDirCreated = false;

  constructor(options: LogManagerOptions) {
    // Create main output stream
    this.mainStream = createWriteStream(options.mainOutputPath, { flags: 'w' });

    // Calculate subagent directory path
    const dir = dirname(options.mainOutputPath);
    const base = basename(options.mainOutputPath);
    const nameWithoutExt = base.replace(/\.[^.]*$/, ''); // Remove extension
    this.subagentDir = join(dir, `${nameWithoutExt}.subagents`);
  }

  /**
   * Get the main output stream
   */
  getMainStream(): WriteStream {
    return this.mainStream;
  }

  /**
   * Get or create a stream for a subagent
   */
  async getSubagentStream(subagentId: string, subagentType?: string): Promise<WriteStream> {
    const existing = this.subagentStreams.get(subagentId);
    if (existing) {
      return existing;
    }

    // Create subagent directory if needed
    if (!this.subagentDirCreated) {
      try {
        await mkdir(this.subagentDir, { recursive: true });
        this.subagentDirCreated = true;
      } catch (error) {
        console.error(`Failed to create subagent log directory: ${this.subagentDir}`, error);
        // Return main stream as fallback
        return this.mainStream;
      }
    }

    // Create subagent log file
    const prefix = subagentType || 'subagent';
    const filename = `${prefix}-${subagentId.slice(0, 8)}.log`;
    const filepath = join(this.subagentDir, filename);

    const stream = createWriteStream(filepath, { flags: 'w' });
    this.subagentStreams.set(subagentId, stream);

    // Write header to subagent log
    stream.write(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    stream.write(`Subagent Log: ${prefix}\n`);
    stream.write(`ID: ${subagentId}\n`);
    stream.write(`Started: ${new Date().toISOString()}\n`);
    stream.write(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`);

    return stream;
  }

  /**
   * Write to a specific subagent's log
   */
  async writeToSubagent(subagentId: string, content: string, subagentType?: string): Promise<void> {
    const stream = await this.getSubagentStream(subagentId, subagentType);
    stream.write(content);
  }

  /**
   * Write to main log
   */
  writeToMain(content: string): void {
    this.mainStream.write(content);
  }

  /**
   * Close a subagent stream
   */
  closeSubagentStream(subagentId: string): Promise<void> {
    const stream = this.subagentStreams.get(subagentId);
    if (!stream) {
      return Promise.resolve();
    }

    this.subagentStreams.delete(subagentId);

    return new Promise<void>((resolve, reject) => {
      stream.write(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      stream.write(`Ended: ${new Date().toISOString()}\n`);
      stream.write(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      stream.end(() => resolve());
      stream.on('error', reject);
    });
  }

  /**
   * Close all streams
   */
  async closeAll(): Promise<void> {
    // Close all subagent streams
    const closePromises: Promise<void>[] = [];
    for (const [id, stream] of this.subagentStreams) {
      closePromises.push(this.closeSubagentStream(id));
    }
    await Promise.all(closePromises);

    // Close main stream
    await new Promise<void>((resolve, reject) => {
      this.mainStream.end(() => resolve());
      this.mainStream.on('error', reject);
    });
  }
}
