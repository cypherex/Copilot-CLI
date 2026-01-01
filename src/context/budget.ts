// Context Budget - manages token budget allocation for context sections

/**
 * Token budget allocation for different sections of the LLM context window.
 *
 * The ContextBudget interface defines how available tokens are distributed across
 * different types of content when building the context for an LLM request. This
 * ensures that critical information receives appropriate allocation while preventing
 * context overflow errors.
 *
 * @example
 * ```typescript
 * const budget: ContextBudget = {
 *   total: 6400,
 *   systemPrompt: 960,      // 15% - Instructions and capabilities
 *   goal: 320,              // 5% - Current mission/objective
 *   memory: 640,            // 10% - Persistent context (facts, preferences)
 *   workingState: 320,      // 5% - Current state (active tasks, errors)
 *   conversationSummary: 960, // 15% - Compressed conversation history
 *   retrievedContext: 640,  // 10% - Retrieved archival content
 *   recentMessages: 2240,   // 35% - Raw message history
 *   scaffoldingReminder: 320 // 5% - Meta-instructions
 * };
 * ```
 *
 * @remarks
 * - The total should typically be 80-90% of the model's context limit to leave
 *   room for estimation errors and response generation
 * - Ratios are defined in DEFAULT_BUDGET_RATIOS and can be customized for
 *   specific use cases
 * - Budgets are calculated once at initialization and adjusted when context
 *   limits change (e.g., switching models)
 */
export interface ContextBudget {
  /** Total token budget for the entire context window */
  total: number;

  /** Tokens allocated for the system prompt (instructions, capabilities) */
  systemPrompt: number;

  /** Tokens for the current goal/mission statement */
  goal: number;

  /** Tokens for persistent memory context (facts, preferences, decisions) */
  memory: number;

  /** Tokens for current working state (active tasks, recent errors) */
  workingState: number;

  /** Tokens for conversation history summaries */
  conversationSummary: number;

  /** Tokens for dynamically retrieved archival content */
  retrievedContext: number;

  /** Tokens for recent raw message history */
  recentMessages: number;

  /** Tokens for scaffolding/instruction reminders */
  scaffoldingReminder: number;
}

/**
 * Default percentage allocations for each budget section.
 *
 * These ratios determine how tokens are distributed across different context sections.
 * They are designed to balance the needs of maintaining conversation continuity while
 * preserving important information and leaving adequate space for recent exchanges.
 *
 * @remarks
 * Design rationale for these ratios:
 * - **recentMessages (35%)**: Largest allocation for maintaining conversation flow
 * - **systemPrompt (15%)**: Sufficient space for comprehensive instructions
 * - **conversationSummary (15%)**: Balance for compressed history
 * - **memory (10%)**: Moderate allocation for persistent facts/preferences
 * - **retrievedContext (10%)**: Space for dynamically retrieved archival info
 * - **goal (5%)**: Compact representation of current objective
 * - **workingState (5%)**: Minimal but adequate for state tracking
 * - **scaffoldingReminder (5%)**: Small but sufficient for meta-instructions
 *
 * Custom ratios can be defined for specific use cases:
 * - Code-focused agents may increase recentMessages to 45%
 * - Long-running sessions may increase memory to 15%
 * - Conversational agents may increase conversationSummary to 20%
 */
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

/**
 * Calculates token budget allocations for each context section.
 *
 * This function takes a total token budget and distributes it across all
 * context sections according to DEFAULT_BUDGET_RATIOS. The allocations are
 * computed as whole token values using Math.floor().
 *
 * @param totalTokens - The total number of tokens to allocate across all sections.
 *   This should typically be 80-90% of the model's context limit to leave
 *   buffer for estimation errors and response generation.
 *   For example, for an 8k context model, use 6400 tokens (8k * 0.8).
 *
 * @returns A ContextBudget object with token allocations for each section.
 *   The sum of all section allocations will be slightly less than totalTokens
 *   due to Math.floor() rounding.
 *
 * @example
 * ```typescript
 * // Calculate budget for an 8k context model
 * const budget = calculateBudget(6400);
 *
 * console.log(budget);
 * // {
 * //   total: 6400,
 * //   systemPrompt: 960,      // 6400 * 0.15
 * //   goal: 320,              // 6400 * 0.05
 * //   memory: 640,            // 6400 * 0.10
 * //   workingState: 320,      // 6400 * 0.05
 * //   conversationSummary: 960, // 6400 * 0.15
 * //   retrievedContext: 640,  // 6400 * 0.10
 * //   recentMessages: 2240,   // 6400 * 0.35
 * //   scaffoldingReminder: 320 // 6400 * 0.05
 * // }
 * ```
 *
 * @remarks
 * - This function should be called once during initialization or when switching
 *   to a model with a different context limit
 * - Use adjustBudgetForTotal() to recalculate budgets when the total changes
 * - The 20% buffer (using 80% of context limit) accounts for:
 *   - Token estimation inaccuracies (typically 5-10% error)
 *   - Response generation space
 *   - Metadata and protocol overhead
 * - Allocations are rounded down to avoid overflow
 */
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

/**
 * Adjusts a budget to a new total while preserving proportional allocations.
 *
 * This function recalculates all budget section allocations when the total
 * context limit changes (e.g., when switching between models with different
 * context windows). The proportions between sections remain the same,
 * ensuring consistent behavior across different context sizes.
 *
 * @param budget - The existing budget to adjust. This budget may have been
 *   modified from its original proportions (e.g., if custom ratios were used).
 *   The function will preserve any custom proportions when scaling.
 * @param newTotal - The new total token budget. This should typically be
 *   80-90% of the new model's context limit, consistent with calculateBudget().
 *
 * @returns A new ContextBudget object with all sections scaled proportionally.
 *   The original budget is not modified.
 *
 * @example
 * ```typescript
 * // Initial budget for 8k model
 * const budget8k = calculateBudget(6400);
 * console.log(budget8k.recentMessages); // 2240 tokens
 *
 * // Switch to 32k model (using 80% = 25,600 tokens)
 * const budget32k = adjustBudgetForTotal(budget8k, 25600);
 * console.log(budget32k.recentMessages); // 8960 tokens (4x increase)
 *
 * // All sections scale proportionally:
 * // - systemPrompt: 960 → 3840 (4x)
 * // - memory: 640 → 2560 (4x)
 * // - etc.
 * ```
 *
 * @example
 * ```typescript
 * // Custom budget preservation
 * const customBudget = {
 *   ...calculateBudget(6400),
 *   memory: 1280, // Double the default memory
 *   recentMessages: 1600, // Reduced to compensate
 * };
 *
 * // Scale while preserving custom proportions
 * const scaledCustom = adjustBudgetForTotal(customBudget, 12800);
 * // memory: 1280 → 2560 (still 2x recentMessages)
 * // recentMessages: 1600 → 3200
 * ```
 *
 * @remarks
 * - This function is commonly used in setModelContextLimit() when switching models
 * - The scaling ratio is calculated as `newTotal / budget.total`
 * - All sections are scaled using Math.floor() to avoid overflow
 * - Custom proportions (deviations from DEFAULT_BUDGET_RATIOS) are preserved
 * - This ensures that tuning done for one context size applies to all sizes
 *
 * @see calculateBudget - Creates a new budget from scratch
 */
export function adjustBudgetForTotal(budget: ContextBudget, newTotal: number): ContextBudget {
  // Calculate the scaling ratio between new and old totals
  // This ensures all sections scale proportionally
  const ratio = newTotal / budget.total;

  // Apply the ratio to each section, using Math.floor() to prevent overflow
  // The proportional allocation between sections is preserved
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

/**
 * Calculates remaining tokens for each budget section after accounting for usage.
 *
 * This function subtracts the tokens already used in each section from the
 * allocated budget, returning the available tokens for further content. It's
 * useful for tracking how much space remains when building the context.
 *
 * @param budget - The original budget allocation defining the total tokens
 *   available for each section.
 * @param used - A partial ContextBudget indicating how many tokens have been
 *   consumed in each section. Only sections that have been used need to be
 *   specified; missing sections are treated as having 0 usage.
 *
 * @returns A ContextBudget object showing the remaining tokens for each section.
 *   The total field always reflects the original budget total, not the sum
 *   of remaining tokens.
 *
 * @example
 * ```typescript
 * const budget = calculateBudget(6400);
 *
 * // Track usage after building some context
 * const usedTokens: Partial<ContextBudget> = {
 *   systemPrompt: 850,
 *   memory: 400,
 *   recentMessages: 1800,
 * };
 *
 * const available = getAvailableTokens(budget, usedTokens);
 *
 * console.log(available.systemPrompt); // 110 remaining (960 - 850)
 * console.log(available.memory);       // 240 remaining (640 - 400)
 * console.log(available.recentMessages); // 440 remaining (2240 - 1800)
 * ```
 *
 * @example
 * ```typescript
 * // Check if we have space for more content
 * const available = getAvailableTokens(budget, used);
 *
 * if (available.memory < 100) {
 *   console.warn('Memory budget nearly exhausted!');
 *   await compressMemory();
 * }
 * ```
 *
 * @remarks
 * - This function uses Math.max(0, ...) to prevent negative values if usage
 *   exceeds the allocated budget
 * - Missing sections in the `used` parameter are treated as having 0 usage
 * - The `total` field is not recalculated; it always shows the original budget
 * - This is useful for:
 *   - Real-time monitoring of token usage
 *   - Determining when to trigger compression
 *   - Checking if new content fits within allocations
 *   - Displaying budget status to users
 *
 * @see calculateBudget - Creates the initial budget allocation
 * @see adjustBudgetForTotal - Adjusts budget when context limits change
 */
export function getAvailableTokens(budget: ContextBudget, used: Partial<ContextBudget>): ContextBudget {
  return {
    total: budget.total,
    // Subtract used tokens from each section's allocation
    // Use Math.max(0, ...) to prevent negative values if usage exceeds budget
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

