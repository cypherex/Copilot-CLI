// Context Budget - manages token budget allocation for context sections

export interface ContextBudget {
  total: number;
  systemPrompt: number;
  goal: number;
  memory: number;
  workingState: number;
  conversationSummary: number;
  retrievedContext: number;
  recentMessages: number;
  scaffoldingReminder: number;
}

export const DEFAULT_BUDGET_RATIOS = {
  systemPrompt: 0.15,
  goal: 0.05,
  memory: 0.10,
  workingState: 0.05,
  conversationSummary: 0.15,
  retrievedContext: 0.10,
  recentMessages: 0.35,
  scaffoldingReminder: 0.05,
};

export function calculateBudget(totalTokens: number): ContextBudget {
  return {
    total: totalTokens,
    systemPrompt: Math.floor(totalTokens * DEFAULT_BUDGET_RATIOS.systemPrompt),
    goal: Math.floor(totalTokens * DEFAULT_BUDGET_RATIOS.goal),
    memory: Math.floor(totalTokens * DEFAULT_BUDGET_RATIOS.memory),
    workingState: Math.floor(totalTokens * DEFAULT_BUDGET_RATIOS.workingState),
    conversationSummary: Math.floor(totalTokens * DEFAULT_BUDGET_RATIOS.conversationSummary),
    retrievedContext: Math.floor(totalTokens * DEFAULT_BUDGET_RATIOS.retrievedContext),
    recentMessages: Math.floor(totalTokens * DEFAULT_BUDGET_RATIOS.recentMessages),
    scaffoldingReminder: Math.floor(totalTokens * DEFAULT_BUDGET_RATIOS.scaffoldingReminder),
  };
}

export function adjustBudgetForTotal(budget: ContextBudget, newTotal: number): ContextBudget {
  const ratio = newTotal / budget.total;
  return {
    total: newTotal,
    systemPrompt: Math.floor(budget.systemPrompt * ratio),
    goal: Math.floor(budget.goal * ratio),
    memory: Math.floor(budget.memory * ratio),
    workingState: Math.floor(budget.workingState * ratio),
    conversationSummary: Math.floor(budget.conversationSummary * ratio),
    retrievedContext: Math.floor(budget.retrievedContext * ratio),
    recentMessages: Math.floor(budget.recentMessages * ratio),
    scaffoldingReminder: Math.floor(budget.scaffoldingReminder * ratio),
  };
}

export function getAvailableTokens(budget: ContextBudget, used: Partial<ContextBudget>): ContextBudget {
  return {
    total: budget.total,
    systemPrompt: Math.max(0, budget.systemPrompt - (used.systemPrompt || 0)),
    goal: Math.max(0, budget.goal - (used.goal || 0)),
    memory: Math.max(0, budget.memory - (used.memory || 0)),
    workingState: Math.max(0, budget.workingState - (used.workingState || 0)),
    conversationSummary: Math.max(0, budget.conversationSummary - (used.conversationSummary || 0)),
    retrievedContext: Math.max(0, budget.retrievedContext - (used.retrievedContext || 0)),
    recentMessages: Math.max(0, budget.recentMessages - (used.recentMessages || 0)),
    scaffoldingReminder: Math.max(0, budget.scaffoldingReminder - (used.scaffoldingReminder || 0)),
  };
}

