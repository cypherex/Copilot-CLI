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
  memoryData?: SessionMemoryData;
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
  goal?: SessionGoalData;
  preferences?: SessionPreferenceData[];
  tasks?: SessionTaskData[];
  decisions?: SessionDecisionData[];
}

export interface SessionGoalData {
  id: string;
  description: string;
  originalMessage: string;
  status: 'active' | 'completed' | 'abandoned';
  completionCriteria?: string[];
  progress?: string;
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
