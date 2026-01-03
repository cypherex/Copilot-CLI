/**
 * UIState - Observable state for UI components
 *
 * The loop/agent updates this state, UI regions subscribe to changes.
 * This cleanly separates business logic from display.
 */

export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error';

export interface TaskState {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority?: 'low' | 'medium' | 'high';
}

export interface ToolExecutionState {
  id: string;
  name: string;
  args?: Record<string, any>;
  status: 'pending' | 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  result?: string;
  error?: string;
}

export interface MessageState {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'parallel-status' | 'subagent-status';
  content: string;
  timestamp: number;
  toolCalls?: ToolExecutionState[];
  // For updatable messages - references live state
  parallelExecutionId?: string;
  subagentId?: string;
}

export interface ParallelToolState {
  id: string;
  tool: string;
  status: 'pending' | 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  executionTime?: number;
  error?: string;
}

export interface ParallelExecutionState {
  id: string;
  description?: string;
  tools: ParallelToolState[];
  startTime: number;
  endTime?: number;
  isActive: boolean;
}

export interface SubagentState {
  id: string;
  task: string;
  role?: string;
  status: 'spawning' | 'running' | 'completed' | 'failed';
  background: boolean;
  startTime: number;
  endTime?: number;
  iterations?: number;
  error?: string;
  result?: string;
}

export interface SubagentTrackingState {
  active: SubagentState[];
  completed: SubagentState[];
  showCompleted: boolean;
}

export interface UIStateData {
  // Agent status
  agentStatus: AgentStatus;
  statusMessage: string;

  // Token usage
  tokensUsed: number;
  tokensLimit: number;

  // Tasks
  currentTask: TaskState | null;
  allTasks: TaskState[];

  // Current tool execution
  currentToolExecution: ToolExecutionState | null;

  // Messages for output
  pendingMessages: MessageState[];

  // Model info
  modelName: string;
  providerName: string;

  // Streaming
  isStreaming: boolean;
  streamContent: string;

  // Parallel execution
  parallelExecution: ParallelExecutionState | null;

  // Subagent tracking
  subagents: SubagentTrackingState | null;
}

type StateChangeListener = (state: UIStateData, changedKeys: (keyof UIStateData)[]) => void;

/**
 * Observable UI state
 */
class UIStateManager {
  private state: UIStateData = {
    agentStatus: 'idle',
    statusMessage: '',
    tokensUsed: 0,
    tokensLimit: 0,
    currentTask: null,
    allTasks: [],
    currentToolExecution: null,
    pendingMessages: [],
    modelName: '',
    providerName: '',
    isStreaming: false,
    streamContent: '',
    parallelExecution: null,
    subagents: null,
  };

  private listeners: Set<StateChangeListener> = new Set();

  /**
   * Get current state (read-only snapshot)
   */
  getState(): Readonly<UIStateData> {
    return { ...this.state };
  }

  /**
   * Update state and notify listeners
   */
  update(partial: Partial<UIStateData>): void {
    const changedKeys = Object.keys(partial) as (keyof UIStateData)[];
    this.state = { ...this.state, ...partial };
    this.notifyListeners(changedKeys);
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    // Return unsubscribe function
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of changes
   */
  private notifyListeners(changedKeys: (keyof UIStateData)[]): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state, changedKeys);
      } catch (error) {
        // Don't let listener errors break other listeners
        console.error('UIState listener error:', error);
      }
    }
  }

  // ============================================
  // Convenience methods for common updates
  // ============================================

  setAgentStatus(status: AgentStatus, message?: string): void {
    this.update({
      agentStatus: status,
      statusMessage: message || '',
    });
  }

  setTokenUsage(used: number, limit: number): void {
    this.update({ tokensUsed: used, tokensLimit: limit });
  }

  setTasks(current: TaskState | null, all: TaskState[]): void {
    this.update({ currentTask: current, allTasks: all });
  }

  startToolExecution(tool: ToolExecutionState): void {
    this.update({ currentToolExecution: tool });
  }

  endToolExecution(result?: string, error?: string): void {
    if (this.state.currentToolExecution) {
      const updated = {
        ...this.state.currentToolExecution,
        status: error ? 'error' as const : 'success' as const,
        endTime: Date.now(),
        result,
        error,
      };
      this.update({ currentToolExecution: updated });
    }
    // Clear after a moment
    setTimeout(() => this.update({ currentToolExecution: null }), 100);
  }

  addMessage(message: MessageState): void {
    this.update({
      pendingMessages: [...this.state.pendingMessages, message],
    });
  }

  clearPendingMessages(): MessageState[] {
    const messages = this.state.pendingMessages;
    this.update({ pendingMessages: [] });
    return messages;
  }

  startStreaming(): void {
    this.update({ isStreaming: true, streamContent: '' });
  }

  updateStreamContent(content: string): void {
    this.update({ streamContent: content });
  }

  endStreaming(): void {
    this.update({ isStreaming: false });
  }

  setModelInfo(modelName: string, providerName: string): void {
    this.update({ modelName, providerName });
  }

  /**
   * Reset state
   */
  reset(): void {
    this.state = {
      agentStatus: 'idle',
      statusMessage: '',
      tokensUsed: 0,
      tokensLimit: 0,
      currentTask: null,
      allTasks: [],
      currentToolExecution: null,
      pendingMessages: [],
      modelName: this.state.modelName,
      providerName: this.state.providerName,
      isStreaming: false,
      streamContent: '',
      parallelExecution: null,
      subagents: null,
    };
    this.notifyListeners(Object.keys(this.state) as (keyof UIStateData)[]);
  }
}

// Singleton instance
export const uiState = new UIStateManager();

// Export type for external use
export type { UIStateManager };
