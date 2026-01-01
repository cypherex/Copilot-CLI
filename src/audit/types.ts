// Scaffolding Tracker Types - audits LLM responses for incomplete work

export type IncompleteItemType =
  | 'unconnected_method'    // Method defined but never called
  | 'unwired_extraction'    // Extractor exists but not wired to storage
  | 'missing_call'          // Expected call site missing
  | 'stub'                  // Placeholder implementation (throw, TODO body)
  | 'simplified'            // Working but known to need more logic later
  | 'todo'                  // Explicit TODO/FIXME comment
  | 'missing_implementation' // Interface/type without implementation
  | 'dead_code'             // Code that can never be reached
  | 'obsolete_code';        // Code made redundant by new implementation (needs cleanup)

// Priority scoring - higher = more critical
export const ITEM_PRIORITY: Record<IncompleteItemType, number> = {
  unwired_extraction: 5,     // Most critical - data loss risk
  missing_call: 4,           // Logic not connected
  obsolete_code: 4,          // Should cleanup now while context is fresh
  unconnected_method: 3,     // Dead code
  missing_implementation: 3, // Type without backing
  simplified: 2,             // Works but needs enhancement
  stub: 2,                   // Placeholder
  dead_code: 2,              // Unreachable
  todo: 1,                   // Explicit marker (lowest - intentional)
};

export interface IncompleteItem {
  id: string;
  type: IncompleteItemType;
  description: string;
  file: string;
  line?: number;
  // Tracking
  introducedAt: Date;
  introducedByResponseId: string;
  responsesSinceIntroduced: number;
  // Resolution
  resolved: boolean;
  resolvedAt?: Date;
  resolvedByResponseId?: string;
  // Priority
  priority: number;
}

// What the audit LLM returns
export interface AuditResult {
  new: {
    type: IncompleteItemType;
    description: string;
    file: string;
    line?: number;
  }[];
  resolved: string[]; // Item IDs that are now complete
}

// Strictness modes
export type StrictnessMode = 'off' | 'warn' | 'remind' | 'block';

export interface CompletionTrackerConfig {
  enabled: boolean;
  strictnessMode: StrictnessMode;
  // Thresholds
  staleThreshold: number;      // Responses before item is "stale" (default: 3)
  reminderThreshold: number;   // Responses before injecting reminder (default: 5)
  blockThreshold: number;      // Critical items before blocking (default: 5)
  // Priority filter - only track items at or above this priority
  minPriority: number;
  // Audit model (optional - uses main client if not set)
  auditModel?: string;
}

export const DEFAULT_TRACKER_CONFIG: CompletionTrackerConfig = {
  enabled: true,
  strictnessMode: 'warn',
  staleThreshold: 3,
  reminderThreshold: 5,
  blockThreshold: 5,
  minPriority: 1,
};

// Persisted state
export interface TrackerState {
  version: number;
  items: IncompleteItem[];
  responseCount: number;
  lastAuditAt?: Date;
  sessionStats: {
    totalIntroduced: number;
    totalResolved: number;
    avgResolutionResponses: number;
  };
}

// Display status for CLI
export interface ScaffoldingDebt {
  critical: IncompleteItem[];   // Priority >= 4
  stale: IncompleteItem[];      // Past staleThreshold
  recent: IncompleteItem[];     // New items
  resolved: IncompleteItem[];   // Recently resolved (this session)
  totalDebt: number;
  shouldBlock: boolean;
}
