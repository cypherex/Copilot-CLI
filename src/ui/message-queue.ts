// Message queue for non-blocking user input
// Allows users to send messages while agent is working

import { EventEmitter } from 'events';

export interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
  priority: 'normal' | 'high';
}

/**
 * Message queue for handling user input while agent is busy
 * Supports priority queuing and async message retrieval
 */
export class MessageQueue extends EventEmitter {
  private queue: QueuedMessage[] = [];
  private messageCounter = 0;
  private waitingResolvers: Array<(message: QueuedMessage) => void> = [];

  /**
   * Add a message to the queue
   */
  enqueue(content: string, priority: 'normal' | 'high' = 'normal'): string {
    const message: QueuedMessage = {
      id: `msg_${++this.messageCounter}_${Date.now()}`,
      content,
      timestamp: Date.now(),
      priority,
    };

    // High priority messages go to front
    if (priority === 'high') {
      this.queue.unshift(message);
    } else {
      this.queue.push(message);
    }

    // Emit event
    this.emit('message_queued', message);

    // Notify any waiting consumers
    if (this.waitingResolvers.length > 0) {
      const resolver = this.waitingResolvers.shift();
      if (resolver) {
        const nextMessage = this.queue.shift();
        if (nextMessage) {
          resolver(nextMessage);
        }
      }
    }

    return message.id;
  }

  /**
   * Get next message from queue (non-blocking)
   * Returns undefined if queue is empty
   */
  poll(): QueuedMessage | undefined {
    return this.queue.shift();
  }

  /**
   * Wait for next message (blocking)
   * Returns immediately if queue has messages
   * Waits indefinitely if queue is empty
   */
  async dequeue(): Promise<QueuedMessage> {
    // If queue has messages, return immediately
    if (this.queue.length > 0) {
      return this.queue.shift()!;
    }

    // Otherwise, wait for next message
    return new Promise((resolve) => {
      this.waitingResolvers.push(resolve);
    });
  }

  /**
   * Wait for next message with timeout
   * Returns undefined if timeout expires
   */
  async dequeueWithTimeout(timeoutMs: number): Promise<QueuedMessage | undefined> {
    // If queue has messages, return immediately
    if (this.queue.length > 0) {
      return this.queue.shift();
    }

    // Otherwise, wait with timeout
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        // Remove resolver from waiting list
        const index = this.waitingResolvers.indexOf(resolver);
        if (index !== -1) {
          this.waitingResolvers.splice(index, 1);
        }
        resolve(undefined);
      }, timeoutMs);

      const resolver = (message: QueuedMessage) => {
        clearTimeout(timeoutId);
        resolve(message);
      };

      this.waitingResolvers.push(resolver);
    });
  }

  /**
   * Peek at next message without removing it
   */
  peek(): QueuedMessage | undefined {
    return this.queue[0];
  }

  /**
   * Get queue length
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Clear all messages from queue
   */
  clear(): void {
    this.queue = [];
    this.emit('queue_cleared');
  }

  /**
   * Get all messages (without removing)
   */
  getAll(): QueuedMessage[] {
    return [...this.queue];
  }

  /**
   * Remove a specific message by ID
   */
  remove(messageId: string): boolean {
    const index = this.queue.findIndex(m => m.id === messageId);
    if (index !== -1) {
      const removed = this.queue.splice(index, 1)[0];
      this.emit('message_removed', removed);
      return true;
    }
    return false;
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    total: number;
    highPriority: number;
    normalPriority: number;
    oldestTimestamp: number | undefined;
  } {
    const highPriority = this.queue.filter(m => m.priority === 'high').length;
    const normalPriority = this.queue.filter(m => m.priority === 'normal').length;
    const oldestTimestamp = this.queue[0]?.timestamp;

    return {
      total: this.queue.length,
      highPriority,
      normalPriority,
      oldestTimestamp,
    };
  }
}
