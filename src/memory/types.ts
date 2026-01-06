// Memory system types - structured information with different lifespans

export type MemoryLifespan = 'session' | 'project' | 'permanent';
export type MemoryPriority = 'critical' | 'high' | 'medium' | 'low';

// Configurable decay rates per category
export interface DecayConfig {
  // Decay rate per hour (0.02 = 2% per hour)
  preferenceDecayRate: number;
  userFactDecayRate: number;
  exploratoryDecayRate: number; // For low-importance context
  // Minimum confidence floor
  minConfidence: number;
  // Categories that don't decay (always stable)
  stableCategories?: ('personal' | 'permanent' | 'project')[];
}

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  preferenceDecayRate: 0.01, // Preferences decay slowly
  userFactDecayRate: 0.005, // Personal facts decay very slowly
  exploratoryDecayRate: 0.05, // Exploratory context decays faster
  minConfidence: 0.1,
  stableCategories: ['personal', 'permanent'],
};

// Session goal / mission statement - the original ask that persists
export interface SessionGoal {
  id: string;
  description: string; // The core objective
  originalMessage: string; // Full original user message
  established: Date;
  status: 'active' | 'completed' | 'abandoned';
  completionCriteria?: string[]; // What defines "done"
  progress?: string; // Current progress summary
  parentGoalId?: string; // For nested goals: "Build CLI" → "Add memory" → "Fix extractor"
  childGoalIds?: string[]; // Track sub-goals
  depth?: number; // 0 = root goal, 1 = sub-goal, etc.
}

// User facts - freeform personal information
export interface UserFact {
  id: string;
  fact: string; // "user's name is Alice", "presenting Friday"
  category: 'personal' | 'schedule' | 'context' | 'preference' | 'other';
  source: string;
  confidence: number;
  timestamp: Date;
  lastReinforced?: Date; // When this was last confirmed/mentioned
  lifespan: MemoryLifespan;
  // Add supersession support
  supersededBy?: string;
  supersededAt?: Date;
}

// User facts and preferences
export interface UserPreference {
  id: string;
  category: 'style' | 'tooling' | 'workflow' | 'communication' | 'other';
  key: string;
  value: string;
  source: string; // The message that established this
  confidence: number; // 0-1, how confident we are this is a real preference
  timestamp: Date;
  lastReinforced?: Date;
  lifespan: MemoryLifespan;
  supersededBy?: string; // ID of preference that replaced this
  supersededAt?: Date;
}

// Project-specific context
export interface ProjectContext {
  id: string;
  type: 'tech_stack' | 'convention' | 'structure' | 'dependency' | 'config';
  key: string;
  value: string;
  filePath?: string;
  timestamp: Date;
  lifespan: MemoryLifespan;
}

// Task tracking
export type TaskStatus = 'active' | 'blocked' | 'waiting' | 'pending_verification' | 'completed' | 'abandoned';
export type TaskComplexity = 'simple' | 'moderate' | 'complex';

// Integration point - describes how tasks/components integrate
export interface IntegrationPoint {
  id: string;
  sourceTask?: string; // Task ID that produces
  targetTask?: string; // Task ID that consumes
  sourceComponent?: string; // Component/module name
  targetComponent?: string; // Component/module name
  requirement: string; // What's required (e.g., "tokens must include span info")
  dataContract?: string; // Expected interface/type/structure
  createdAt: Date;
  relatedFiles?: string[]; // Files involved in this integration
}

// Design decision - architectural/implementation choices made during breakdown
export interface DesignDecision {
  id: string;
  decision: string; // What was decided
  reasoning: string; // Why this decision was made
  alternatives?: string[]; // Other options considered
  affects: string[]; // Task IDs or component names affected
  scope: 'global' | 'module' | 'task'; // How broad the impact is
  createdDuringBreakdown?: boolean; // Was this created during task breakdown?
  parentTaskId?: string; // Task being broken down when this was decided
  createdAt: Date;
  relatedFiles?: string[]; // Files this decision impacts
}

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  parentId?: string; // For subtasks
  blockedBy?: string; // What's blocking this task
  waitingFor?: string; // What we're waiting for
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  completionMessage?: string; // Summary of what was accomplished when task was completed
  relatedFiles: string[];
  priority: MemoryPriority;
  relatedToGoal?: boolean; // Whether this task is related to the main goal

  // Complexity tracking
  estimatedComplexity?: TaskComplexity;
  actualComplexity?: TaskComplexity;
  actualIterations?: number; // How many iterations/LLM calls to complete
  shouldHaveSpawnedSubagent?: boolean; // Retrospective flag

  // File tracking
  filesModified?: string[]; // Files created/modified during task execution (from EditRecords)

  // Task breakdown metadata
  breakdownDepth?: number; // How many levels deep in the breakdown tree (0 = root)
  produces?: string[]; // What this task produces (interfaces, data structures, etc.)
  consumes?: string[]; // What this task depends on from other tasks

  // Dependency graph (task ID dependencies)
  dependsOn?: string[]; // Task IDs that must complete before this task can start
  isDependencyLeaf?: boolean; // Computed: true if no dependencies or all dependencies completed
  integrationPointIds?: string[]; // IDs of IntegrationPoints related to this task
  designDecisionIds?: string[]; // IDs of DesignDecisions made for/affecting this task
  breakdownComplete?: boolean; // Whether this task has been fully broken down (all subtasks are ready)
}

// Tracking items - incomplete work items detected in LLM responses
export type TrackingItemStatus = 'open' | 'under-review' | 'closed';

export interface TrackingItem {
  id: string;
  description: string;
  status: TrackingItemStatus;
  priority: MemoryPriority;

  // Context
  extractedFrom: string; // Which message it was extracted from
  detectedAt: Date;

  // Review tracking
  movedToReviewAt?: Date; // When it was moved to 'under-review'
  verificationNotes?: string; // LLM's notes when verifying (file paths read, reasoning)

  // Closure
  closedAt?: Date;
  closureReason?: 'completed' | 'added-to-tasks' | 'duplicate' | 'not-needed' | 'out-of-scope';
  closureDetails?: string; // Explanation for why it was closed

  // Related items
  relatedTaskId?: string; // If added to task list
  relatedFiles?: string[]; // Files that were read to verify this item
}

// Working state - current focus
export interface WorkingState {
  activeFiles: ActiveFile[];
  currentTask?: string; // Task ID
  recentErrors: ErrorContext[];
  editHistory: EditRecord[];
  lastUpdated: Date;
  lastContextSummary?: string;
  summaryScope?: 'current_task' | 'recent_messages' | 'all_transcript' | 'files' | 'pre-subagent';
  summaryTimestamp?: Date;
  lastSubagentMerge?: {
    summary: string;
    filesAffected: string[];
    actionItems: string[];
    timestamp: Date;
  };
  lastMergedOutput?: string;
}

// Session resume info for work continuity
export interface SessionResume {
  lastActiveTime: Date;
  lastGoalDescription?: string;
  goalProgress?: number;
  activeTaskDescription?: string;
  pausedAtDescription?: string;
  lastFileEdited?: string;
  pendingDecisionsCount?: number;
  completedTasksCount?: number;
  activeTasksCount?: number;
}

export interface ActiveFile {
  path: string;
  purpose: string; // Why we're looking at this file
  lastAccessed: Date;
  sections: FileSection[]; // Specific functions/classes we're focused on
  featureGroup?: string; // "auth", "api", "components" - logical grouping
}

export interface FileSection {
  name: string; // Function/class/method name
  type: 'function' | 'class' | 'method' | 'interface' | 'type' | 'variable' | 'other';
  startLine?: number;
  endLine?: number;
  purpose?: string; // What we're doing with this section
  lastModified?: Date;
}

// Feature/component grouping for relationship mapping
export interface FeatureGroup {
  id: string;
  name: string; // "auth", "user-management", "api"
  description?: string;
  files: string[]; // File paths in this group
  relatedGroups?: string[]; // IDs of related feature groups
  createdAt: Date;
}

export interface ErrorContext {
  error: string;
  message?: string; // Human-readable error message
  file?: string;
  line?: number;
  timestamp: Date;
  resolved: boolean;
  resolution?: string;
}

export interface EditRecord {
  id: string;
  file: string;
  description: string;
  timestamp: Date;
  sections?: string[]; // Functions/classes affected
  changeType: 'create' | 'modify' | 'delete' | 'rename';
  beforeSnippet?: string; // Small snippet of what was there before
  afterSnippet?: string; // Small snippet of what it became
  relatedTaskId?: string; // Which task this edit was for
}

// Semantic message classification
export type MessageImportance = 'critical' | 'high' | 'medium' | 'low' | 'noise';

export interface ClassifiedMessage {
  index: number;
  role: string;
  importance: MessageImportance;
  categories: MessageCategory[];
  extractedInfo?: ExtractedInfo;
  // Chunk boundary hints for semantic splitting
  topicBoundary?: boolean; // True if this starts a new topic
  exchangeComplete?: boolean; // True if this completes a user-assistant exchange
  boundaryReason?: 'new_request' | 'file_switch' | 'error_resolved' | 'decision_made' | 'correction';
}

export type MessageCategory =
  | 'user_correction'
  | 'user_preference'
  | 'user_request'
  | 'user_fact' // Personal info about the user
  | 'backward_reference' // References to earlier context
  | 'goal_statement' // The mission/objective
  | 'key_decision'
  | 'error_report'
  | 'error_resolution'
  | 'file_content'
  | 'code_snippet'
  | 'tool_output'
  | 'exploratory'
  | 'confirmation'
  | 'superseded';

export interface ExtractedInfo {
  preferences?: Partial<UserPreference>[];
  projectContext?: Partial<ProjectContext>[];
  tasks?: Partial<Task>[];
  files?: string[];
  fileSections?: { path: string; section: Partial<FileSection> }[];
  errors?: Partial<ErrorContext>[];
  decisions?: Partial<Decision>[];
  userFacts?: Partial<UserFact>[];
  goal?: Partial<SessionGoal>;
  backwardReferences?: BackwardReference[];
  corrections?: Correction[];
}

// Backward reference - mentions of earlier context
export interface BackwardReference {
  phrase: string; // "like before", "that regex", "the approach we discussed"
  referenceType: 'code' | 'decision' | 'file' | 'approach' | 'general';
  searchQuery: string; // Query to use for retrieval
}

// Tracks what was actually retrieved and injected for a backward reference
export interface RetrievalResult {
  id: string;
  backwardReference: BackwardReference;
  retrievedEntryIds: string[]; // Archive entry IDs that were pulled
  retrievedAt: Date;
  messageIndex: number; // Which message triggered this
  injectedContent?: string; // What was actually injected into context
  wasUseful?: boolean; // Feedback: did this help? (for learning)
}

// Correction with supersession info
export interface Correction {
  what: string; // What's being corrected
  from?: string; // Old value (if detectable)
  to: string; // New value
  category: 'preference' | 'decision' | 'fact' | 'approach';
}

export interface Decision {
  id: string;
  description: string;
  rationale?: string;
  alternatives?: string[];
  tradeoffs?: string;        // Pros/cons of the chosen approach
  revisitCondition?: string;  // "Revisit if performance degrades", etc.
  timestamp: Date;
  supersededBy?: string; // ID of decision that replaced this
  supersededAt?: Date;
  relatedFiles?: string[];
  category?: 'architecture' | 'implementation' | 'tooling' | 'approach' | 'other';
}

// Archive entry for retrieval
export interface ArchiveEntry {
  id: string;
  type: 'conversation_chunk' | 'code_artifact' | 'decision' | 'error_resolution';
  content: string;
  summary: string;
  keywords: string[];
  relatedFiles: string[];
  timestamp: Date;
  sessionId: string;
  importance: MessageImportance;
}

// Memory store interface
export interface MemoryStore {
  // Session identification
  getSessionId(): string;
  
  // Initialize stores
  initialize(): Promise<void>;

  // Session goal (with hierarchy support)
  getGoal(): SessionGoal | undefined;
  getGoalById(id: string): SessionGoal | undefined;
  getAllGoals(): SessionGoal[];
  setGoal(goal: Omit<SessionGoal, 'id' | 'established'>): SessionGoal;
  addSubGoal(parentId: string, goal: Omit<SessionGoal, 'id' | 'established' | 'parentGoalId' | 'depth'>): SessionGoal;
  updateGoal(id: string, updates: Partial<SessionGoal>): void;

  // User facts
  getUserFacts(): UserFact[];
  getAllUserFacts(): UserFact[];
  addUserFact(fact: Omit<UserFact, 'id' | 'timestamp'>): UserFact;
  supersedeUserFact(id: string, newFactId: string): void;

  // Preferences
  getPreferences(): UserPreference[];
  getAllPreferences(): UserPreference[];
  addPreference(pref: Omit<UserPreference, 'id' | 'timestamp'>): UserPreference;
  updatePreference(id: string, updates: Partial<UserPreference>): void;
  supersedePreference(id: string, newPrefId: string): void;

  // Decisions (with supersession)
  getDecisions(): Decision[];
  getAllDecisions(): Decision[];
  addDecision(decision: Omit<Decision, 'id' | 'timestamp'>): Decision;
  supersedeDecision(id: string, newDecisionId: string): void;
  getDecisionById(id: string): Decision | undefined;

  // Project context
  getProjectContext(): ProjectContext[];
  addProjectContext(ctx: Omit<ProjectContext, 'id' | 'timestamp'>): ProjectContext;

  // Feature groups (file relationships)
  getFeatureGroups(): FeatureGroup[];
  addFeatureGroup(group: Omit<FeatureGroup, 'id' | 'createdAt'>): FeatureGroup;
  addFileToGroup(groupId: string, filePath: string): void;

  // Tasks
  getTasks(status?: TaskStatus): Task[];
  getActiveTask(): Task | undefined;
  addTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task;
  updateTask(id: string, updates: Partial<Task>): void;
  getTaskById(id: string): Task | undefined;

  // Integration Points
  getIntegrationPoints(): IntegrationPoint[];
  getIntegrationPointsForTask(taskId: string): IntegrationPoint[];
  addIntegrationPoint(point: Omit<IntegrationPoint, 'id' | 'createdAt'>): IntegrationPoint;

  // Design Decisions (breakdown-specific)
  getDesignDecisions(): DesignDecision[];
  getDesignDecisionsForTask(taskId: string): DesignDecision[];
  addDesignDecision(decision: Omit<DesignDecision, 'id' | 'createdAt'>): DesignDecision;

  // Tracking items (incomplete work detection)
  getTrackingItems(status?: TrackingItemStatus): TrackingItem[];
  addTrackingItem(item: Omit<TrackingItem, 'id' | 'detectedAt'>): TrackingItem;
  updateTrackingItem(id: string, updates: Partial<TrackingItem>): void;
  deleteTrackingItem(id: string): void;

  // Working state
  getWorkingState(): WorkingState;
  updateWorkingState(updates: Partial<WorkingState>): void;
  addEditRecord(edit: Omit<EditRecord, 'id' | 'timestamp'>): EditRecord;

  // Archive
  archive(entry: Omit<ArchiveEntry, 'id'>): ArchiveEntry;
  search(query: string, limit?: number): ArchiveEntry[];
  getRecentArchive(limit?: number): ArchiveEntry[];

  // Retrieval tracking
  trackRetrieval(result: Omit<RetrievalResult, 'id'>): RetrievalResult;
  getRetrievalHistory(): RetrievalResult[];
  markRetrievalUseful(id: string, useful: boolean): void;

  // Confidence decay (configurable)
  applyConfidenceDecay(config?: Partial<DecayConfig>): void;
  setDecayConfig(config: Partial<DecayConfig>): void;

  // Session resumption
  buildResumptionContext(): string;

  // Persistence
  save(): Promise<void>;

  // Session data management (for session persistence)
  exportSessionData(): any;
  importSessionData(data: any): void;

  clear(lifespan?: MemoryLifespan): void;
}
