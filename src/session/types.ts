// Session persistence types

import type { ChatMessage } from '../llm/types.js';
import type { MemoryStore } from '../memory/types.js';

export interface Session {
  id: string;
  title: string;
  createdAt: Date;
  lastUpdatedAt: Date;
  workingDirectory: string;
  provider: string;
  model?: string;
  messages: ChatMessage[];
  sessionId?: string;  // Link to memory store session
  sessionData?: SessionMemoryData;  // Session-scoped memory data
  scaffoldingDebt?: SessionScaffoldingDebt;
}

export interface SessionMetadata {
  id: string;
  title: string;
  createdAt: Date;
  lastUpdatedAt: Date;
  workingDirectory: string;
  provider: string;
  model?: string;
  messageCount: number;
}

export interface SessionMemoryData {
  goals?: SessionGoalData[];
  tasks?: SessionTaskData[];
  workingState?: WorkingStateData;
  archive?: ArchiveEntry[];
  retrievalHistory?: RetrievalEntry[];
}

export interface WorkingStateData {
  activeFiles: ActiveFileData[];
  recentErrors: ErrorEntry[];
  editHistory: EditEntry[];
  currentTask?: string;
  lastUpdated: Date;
}

export interface ActiveFileData {
  path: string;
  purpose?: string;
  sections?: FileSectionData[];
  featureGroup?: string;
  lastAccessed: Date;
}

export interface FileSectionData {
  name: string;
  type: string;
  purpose?: string;
}

export interface ErrorEntry {
  error: string;
  timestamp: Date;
  resolved: boolean;
  resolution?: string;
}

export interface EditEntry {
  id: string;
  file: string;
  description: string;
  changeType: string;
  beforeSnippet?: string;
  afterSnippet?: string;
  relatedTaskId?: string;
  timestamp: Date;
}

export interface ArchiveEntry {
  id: string;
  timestamp: Date;
  keywords: string[];
  summary: string;
  content: string;
  importance: 'critical' | 'high' | 'medium' | 'low';
}

export interface RetrievalEntry {
  id: string;
  backwardReference: any;
  retrievedEntryIds: string[];
  retrievedAt: Date;
  messageIndex: number;
  injectedContent: string;
  wasUseful?: boolean;
}

export interface SessionGoalData {
  id: string;
  description: string;
  originalMessage: string;
  status: 'active' | 'completed' | 'abandoned';
  completionCriteria?: string[];
  progress?: string;
  parentGoalId?: string;
  depth?: number;
  established: Date;
}

export interface SessionPreferenceData {
  category: string;
  key: string;
  value: string;
  confidence: number;
}

export interface SessionTaskData {
  id: string;
  description: string;
  status: string;
  priority: string;
}

export interface SessionDecisionData {
  id: string;
  description: string;
  category?: string;
}

export interface SessionScaffoldingDebt {
  items: SessionDebtItem[];
}

export interface SessionDebtItem {
  id: string;
  description: string;
  status: 'critical' | 'stale' | 'recent';
  timestamp: Date;
}
