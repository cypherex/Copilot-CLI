# Context Budget System

## Overview

The Context Budget System is a token allocation management system that intelligently distributes available context tokens across different sections of a conversation with an LLM. It ensures that critical information receives appropriate token allocation while preventing context overflow errors.

### Purpose

The budget system serves several key purposes:

- **Token Allocation**: Distributes context tokens strategically across different conversation sections
- **Overflow Prevention**: Ensures total token usage stays within model limits
- **Dynamic Adjustment**: Allows budget recalculation when context limits change (e.g., switching models)
- **Tracking Integration**: Works with ConversationManager to monitor usage and warn when approaching limits

### Key Concepts

1. **Total Budget**: The maximum number of tokens available for the entire context window (typically 80% of the model's context limit)
2. **Budget Sections**: Specific allocations for different types of content (system prompt, memory, recent messages, etc.)
3. **Budget Ratios**: Percentage-based allocations that scale with the total budget
4. **Available Tokens**: Remaining tokens after accounting for actual usage in each section

## ContextBudget Interface

The `ContextBudget` interface defines the structure for token allocations across different context sections:

```typescript
export interface ContextBudget {
  total: number;                      // Total token budget for the context window
  systemPrompt: number;               // Tokens allocated for the system prompt
  goal: number;                       // Tokens for the current goal/mission statement
  memory: number;                     // Tokens for persistent memory context
  workingState: number;               // Tokens for current working state/context
  conversationSummary: number;        // Tokens for conversation history summaries
  retrievedContext: number;           // Tokens for retrieved archival content
  recentMessages: number;             // Tokens for recent message history
  scaffoldingReminder: number;        // Tokens for scaffolding/instruction reminders
}
```

### Budget Sections Explained

#### System Prompt (15%)
The initial instructions that define the agent's behavior and capabilities. This typically includes:
- Agent role and personality
- Available tools and their usage
- Task-specific instructions
- Output format requirements

#### Goal (5%)
The current mission statement or objective that the agent is working on. This is usually:
- A concise description of what the agent is trying to accomplish
- Updated when the user changes the primary objective
- Critical for maintaining focus across long conversations

#### Memory (10%)
Persistent memory that includes information extracted from previous interactions:
- User preferences and facts
- Project context and decisions
- Error history and resolutions
- Active files and their purposes

#### Working State (5%)
Current working context that changes frequently:
- Active task status
- Recent errors being debugged
- Current file being edited
- In-progress operations

#### Conversation Summary (15%)
Compressed representation of conversation history:
- Summaries of earlier exchanges
- Key decisions made
- Progress toward goals
- Context about completed tasks

#### Retrieved Context (10%)
Dynamically retrieved information from archival storage:
- Back-references to earlier conversation chunks
- Relevant file content from memory
- Previously discussed concepts
- Cross-session context

#### Recent Messages (35%)
The largest allocation, reserved for raw message history:
- Actual conversation exchanges
- Tool inputs and outputs
- Code snippets and results
- Most recent context that hasn't been summarized yet

#### Scaffolding Reminder (5%)
Meta-instructions and reminders:
- Guidance on how to handle specific situations
- Best practices reminders
- Formatting instructions
- Error handling guidance

## Budget Calculation

### calculateBudget()

The `calculateBudget()` function creates a new budget allocation based on the total available tokens:

```typescript
function calculateBudget(totalTokens: number): ContextBudget
```

**Algorithm**:
1. Takes the total token budget as input
2. Applies predefined budget ratios to each section
3. Uses `Math.floor()` to ensure whole tokens
4. Returns a complete `ContextBudget` object

**Example**:
```typescript
// Calculate budget for an 8k context model (using 80% = 6,400 tokens)
const budget = calculateBudget(6400);

console.log(budget);
// {
//   total: 6400,
//   systemPrompt: 960,      // 15%
//   goal: 320,              // 5%
//   memory: 640,            // 10%
//   workingState: 320,      // 5%
//   conversationSummary: 960, // 15%
//   retrievedContext: 640,  // 10%
//   recentMessages: 2240,   // 35%
//   scaffoldingReminder: 320 // 5%
// }
```

### Default Budget Ratios

```typescript
export const DEFAULT_BUDGET_RATIOS = {
  systemPrompt: 0.15,        // 15% - Instructions and capabilities
  goal: 0.05,                // 5% - Current mission
  memory: 0.10,              // 10% - Persistent context
  workingState: 0.05,        // 5% - Current state
  conversationSummary: 0.15, // 15% - Compressed history
  retrievedContext: 0.10,    // 10% - Retrieved archival info
  recentMessages: 0.35,      // 35% - Raw message history
  scaffoldingReminder: 0.05, // 5% - Meta-instructions
};
```

These ratios are designed to:
- Give priority to recent messages (35%) for maintaining conversation flow
- Allocate sufficient space for system instructions (15%) to guide behavior
- Balance memory (10%) and conversation summary (15%) for context retention
- Reserve smaller, but adequate, allocations for dynamic content (goal, working state, retrieved context)

## Budget Adjustment

### adjustBudgetForTotal()

The `adjustBudgetForTotal()` function recalculates budget allocations when the total context limit changes:

```typescript
function adjustBudgetForTotal(budget: ContextBudget, newTotal: number): ContextBudget
```

**Algorithm**:
1. Calculates the ratio between new and old totals (`newTotal / budget.total`)
2. Applies this ratio proportionally to each budget section
3. Uses `Math.floor()` to ensure whole tokens
4. Preserves the relative proportions of the original budget

**Use Case**: Switching between models with different context limits

**Example**:
```typescript
// Initial budget for 8k model
const budget8k = calculateBudget(6400);

// Switch to 32k model (using 80% = 25,600 tokens)
const budget32k = adjustBudgetForTotal(budget8k, 25600);

console.log(budget32k);
// {
//   total: 25600,
//   systemPrompt: 3840,     // Scaled from 960 (4x)
//   goal: 1280,             // Scaled from 320 (4x)
//   memory: 2560,           // Scaled from 640 (4x)
//   // ... all other sections scaled proportionally
// }
```

## Typical Budget Allocations

### 8K Context Model (6,400 token budget)

```
Total Budget: 6,400 tokens (80% of 8,000)

┌─────────────────────────┬─────────┬────────┐
│ Section                 │ Tokens  │  %     │
├─────────────────────────┼─────────┼────────┤
│ recentMessages          │ 2,240   │ 35.0%  │
│ systemPrompt            │   960   │ 15.0%  │
│ conversationSummary     │   960   │ 15.0%  │
│ memory                  │   640   │ 10.0%  │
│ retrievedContext        │   640   │ 10.0%  │
│ goal                    │   320   │  5.0%  │
│ workingState            │   320   │  5.0%  │
│ scaffoldingReminder     │   320   │  5.0%  │
├─────────────────────────┼─────────┼────────┤
│ TOTAL                   │ 6,400   │ 100%   │
└─────────────────────────┴─────────┴────────┘
```

### 32K Context Model (25,600 token budget)

```
Total Budget: 25,600 tokens (80% of 32,000)

┌─────────────────────────┬─────────┬────────┐
│ Section                 │ Tokens  │  %     │
├─────────────────────────┼─────────┼────────┤
│ recentMessages          │ 8,960   │ 35.0%  │
│ systemPrompt            │ 3,840   │ 15.0%  │
│ conversationSummary     │ 3,840   │ 15.0%  │
│ memory                  │ 2,560   │ 10.0%  │
│ retrievedContext        │ 2,560   │ 10.0%  │
│ goal                    │ 1,280   │  5.0%  │
│ workingState            │ 1,280   │  5.0%  │
│ scaffoldingReminder     │ 1,280   │  5.0%  │
├─────────────────────────┼─────────┼────────┤
│ TOTAL                   │ 25,600  │ 100%   │
└─────────────────────────┴─────────┴────────┘
```

### 128K Context Model (102,400 token budget)

```
Total Budget: 102,400 tokens (80% of 128,000)

┌─────────────────────────┬─────────┬────────┐
│ Section                 │ Tokens  │  %     │
├─────────────────────────┼─────────┼────────┤
│ recentMessages          │ 35,840  │ 35.0%  │
│ systemPrompt            │ 15,360  │ 15.0%  │
│ conversationSummary     │ 15,360  │ 15.0%  │
│ memory                  │ 10,240  │ 10.0%  │
│ retrievedContext        │ 10,240  │ 10.0%  │
│ goal                    │ 5,120   │  5.0%  │
│ workingState            │ 5,120   │  5.0%  │
│ scaffoldingReminder     │ 5,120   │  5.0%  │
├─────────────────────────┼─────────┼────────┤
│ TOTAL                   │ 102,400 │ 100%   │
└─────────────────────────┴─────────┴────────┘
```

## Integration Points

### ConversationManager Integration

The `ConversationManager` class uses the budget system in several ways:

#### Initialization

```typescript
export class ConversationManager {
  private currentBudget?: ContextBudget;

  private calculateTokenBudget(): ContextBudget {
    const usage = this.contextManager.getUsage();
    const maxContextTokens = usage.totalTokens + usage.remainingTokens || 32000;
    const totalBudget = Math.floor(maxContextTokens * 0.8); // Use 80% for safety
    return calculateBudget(totalBudget);
  }

  async initialize(): Promise<void> {
    // Calculate and store budget
    this.currentBudget = this.calculateTokenBudget();

    // Use memory budget when injecting context
    const memoryBudget = this.currentBudget.memory;
    const memoryContext = this.memoryStore.buildContextSummary(memoryBudget);
    if (memoryContext) {
      // Inject into system prompt
    }
  }
}
```

**Key Points**:
- Budget is calculated at initialization using 80% of the model's context limit
- The 20% buffer accounts for token estimation errors and response overhead
- Memory budget is passed to `buildContextSummary()` to limit memory context size

#### Model Switching

```typescript
setModelContextLimit(model: string): void {
  this.contextManager.setModelContextLimit(model);

  // Update smart compressor target
  const limit = MODEL_CONTEXT_LIMITS[model] || 32000;
  this.smartCompressor = new SmartCompressor(this.memoryStore, {
    targetTokens: Math.floor(limit * 0.5),
  });

  // Adjust budget if it was already calculated
  if (this.currentBudget) {
    const newTotal = Math.floor(limit * 0.8);
    this.currentBudget = adjustBudgetForTotal(this.currentBudget, newTotal);
  }
}
```

**Key Points**:
- When switching models, the budget is recalculated proportionally
- SmartCompressor is also updated with a new target (50% of context limit)
- This ensures all components are aligned with the new context constraints

#### Budget Tracking

```typescript
updateBudgetAfterResponse(usedTokens: number): void {
  if (!this.currentBudget) return;

  const availableTokens = this.currentBudget.total - usedTokens;
  const usageRatio = usedTokens / this.currentBudget.total;

  // Warning when running low on budget (< 20% remaining)
  if (availableTokens < this.currentBudget.total * 0.2 && usageRatio > 0.8) {
    console.log(chalk.yellow(
      `[Budget] Warning: ${Math.floor(usageRatio * 100)}% of token budget used. ` +
      `${availableTokens} tokens remaining.`
    ));
  }

  // Debug logging
  if (process.env.DEBUG_BUDGET) {
    console.log(chalk.gray(
      `[Budget] Used ${usedTokens} / ${this.currentBudget.total} tokens ` +
      `(${Math.floor(usageRatio * 100)}%)`
    ));
  }
}
```

**Key Points**:
- Budget is tracked after each LLM response
- Warnings are triggered when more than 80% of the budget is used
- Debug logging can be enabled with the `DEBUG_BUDGET` environment variable

### SmartCompressor Integration

The `SmartCompressor` uses a simplified memory budget calculation:

```typescript
export class SmartCompressor {
  private calculateMemoryBudget(): number {
    // Uses 20% of target tokens to avoid excessive memory
    // This is separate from the full ContextBudget system
    return Math.floor(this.config.targetTokens * 0.2);
  }

  async compress(messages: ChatMessage[]): Promise<SmartCompressionResult> {
    // ... compression logic ...

    // Inject memory context using the calculated budget
    const memoryBudget = this.calculateMemoryBudget();
    const memoryContext = this.memoryStore.buildContextSummary(memoryBudget);
    if (memoryContext) {
      compressedMessages.push({
        role: 'system',
        content: `[Persistent Memory]\n${memoryContext}`,
      });
    }

    // ...
  }
}
```

**Why Separate Budget Calculation?**

The SmartCompressor uses a simpler 20% calculation instead of the full `ContextBudget` system because:

1. **Focused Scope**: SmartCompressor only needs the memory portion, not the full budget breakdown
2. **Different Target**: The compressor's `targetTokens` (typically 50% of context limit) differs from the ConversationManager's budget (80% of context limit)
3. **Simplicity**: A direct 20% calculation is clearer for this specific use case
4. **Avoid Dependency**: Keeps SmartCompressor decoupled from the full budget system

The ConversationManager handles the comprehensive budget allocation, while SmartCompressor focuses on its specific memory injection needs.

## Budget Warnings

Budget warnings help prevent context overflow by alerting when token usage approaches limits.

### Warning Thresholds

| Warning Level | Usage Percentage | Remaining Tokens | Action Required |
|--------------|------------------|------------------|-----------------|
| Normal       | < 80%            | > 20%            | None            |
| Warning      | 80% - 90%        | 20% - 10%        | Consider compression |
| Critical     | > 90%            | < 10%            | Compression required |

### When Warnings Are Triggered

1. **After LLM Response**: `updateBudgetAfterResponse()` checks usage after each response
2. **During Compression**: `trimHistory()` checks if compression is needed based on actual token count
3. **Context Building**: When building context, the system ensures allocations stay within budget

### Example Warning Output

```bash
[Budget] Warning: 85% of token budget used. 960 tokens remaining.
```

Or in debug mode:

```bash
[Budget] Used 5440 / 6400 tokens (85%)
```

## Usage Examples

### Example 1: Basic Budget Calculation

```typescript
import { calculateBudget } from './context/budget.js';

// Calculate budget for an 8k context window (using 80%)
const totalBudget = 8000 * 0.8; // 6400 tokens
const budget = calculateBudget(totalBudget);

console.log(`Total Budget: ${budget.total} tokens`);
console.log(`Memory Allocation: ${budget.memory} tokens`);
console.log(`Recent Messages: ${budget.recentMessages} tokens`);

// Output:
// Total Budget: 6400 tokens
// Memory Allocation: 640 tokens
// Recent Messages: 2240 tokens
```

### Example 2: Budget Adjustment When Switching Models

```typescript
import { calculateBudget, adjustBudgetForTotal } from './context/budget.js';

// Start with 8k model
const initialBudget = calculateBudget(6400);
console.log('8K Model Budget:', initialBudget);

// Switch to 32k model
const adjustedBudget = adjustBudgetForTotal(initialBudget, 25600);
console.log('32K Model Budget:', adjustedBudget);

// All sections are scaled proportionally:
// - recentMessages: 2240 → 8960 (4x)
// - memory: 640 → 2560 (4x)
// - etc.
```

### Example 3: Budget Tracking Across Iterations

```typescript
class MyConversationManager extends ConversationManager {
  private budgetHistory: Array<{iteration: number, used: number}> = [];

  async processIteration(iteration: number): Promise<void> {
    const usedTokens = await this.makeLLMCall();
    
    // Track budget usage
    this.updateBudgetAfterResponse(usedTokens);
    
    // Record history
    this.budgetHistory.push({
      iteration,
      used: usedTokens
    });

    // Display budget trend
    if (iteration % 5 === 0) {
      this.displayBudgetTrend();
    }
  }

  private displayBudgetTrend(): void {
    const recent = this.budgetHistory.slice(-5);
    const avgUsed = recent.reduce((sum, h) => sum + h.used, 0) / recent.length;
    console.log(`[Budget] Last 5 iterations avg: ${Math.round(avgUsed)} tokens`);
  }
}
```

**Output Example**:

```bash
[Budget] Used 3200 / 6400 tokens (50%)
[Budget] Used 4100 / 6400 tokens (64%)
[Budget] Used 4800 / 6400 tokens (75%)
[Budget] Used 5300 / 6400 tokens (83%)
[Budget] Warning: 83% of token budget used. 1100 tokens remaining.
[Budget] Last 5 iterations avg: 4300 tokens
```

### Example 4: Handling Low-Budget Warnings

```typescript
class BudgetAwareManager extends ConversationManager {
  private lowBudgetThreshold = 0.2; // 20% remaining

  async handleResponse(usedTokens: number): Promise<boolean> {
    // Update budget tracking
    this.updateBudgetAfterResponse(usedTokens);

    // Check if we're running low
    if (!this.currentBudget) return false;

    const remaining = this.currentBudget.total - usedTokens;
    const ratio = remaining / this.currentBudget.total;

    if (ratio < this.lowBudgetThreshold) {
      console.log(`[Budget] Low budget alert! ${remaining} tokens remaining (${Math.round(ratio * 100)}%)`);
      
      // Trigger compression
      await this.trimHistory();
      
      // Rebuild context with fresh budget
      this.currentBudget = this.calculateTokenBudget();
      
      return true; // Budget was adjusted
    }

    return false;
  }

  async makeLLMCallWithBudgetCheck(): Promise<string> {
    const result = await this.llmCall();
    const usedTokens = result.usage.total_tokens;
    
    const adjusted = await this.handleResponse(usedTokens);
    
    if (adjusted) {
      console.log('[Budget] Compressed and adjusted budget for next call');
    }

    return result.content;
  }
}
```

**Output Example**:

```bash
[Budget] Low budget alert! 1100 tokens remaining (17%)
[Memory] Context threshold reached, compressing...
[Memory] Compressed: 6800 → 5200 tokens (archived 3 chunks)
[Budget] Compressed and adjusted budget for next call
```

### Example 5: Custom Budget Ratios

```typescript
import { calculateBudget } from './context/budget.js';
import type { ContextBudget } from './context/budget.js';

// Create custom ratios for a specific use case
// E.g., a code-focused agent that needs more room for recent code
const CODE_FOCUSED_RATIOS = {
  systemPrompt: 0.10,      // Less system prompt needed
  goal: 0.05,               // Standard goal allocation
  memory: 0.05,             // Less memory for code tasks
  workingState: 0.10,       // More working state for code context
  conversationSummary: 0.10, // Less history needed
  retrievedContext: 0.10,   // Standard retrieval
  recentMessages: 0.45,     // MORE space for code snippets
  scaffoldingReminder: 0.05, // Standard scaffolding
};

function calculateCustomBudget(totalTokens: number): ContextBudget {
  return {
    total: totalTokens,
    systemPrompt: Math.floor(totalTokens * CODE_FOCUSED_RATIOS.systemPrompt),
    goal: Math.floor(totalTokens * CODE_FOCUSED_RATIOS.goal),
    memory: Math.floor(totalTokens * CODE_FOCUSED_RATIOS.memory),
    workingState: Math.floor(totalTokens * CODE_FOCUSED_RATIOS.workingState),
    conversationSummary: Math.floor(totalTokens * CODE_FOCUSED_RATIOS.conversationSummary),
    retrievedContext: Math.floor(totalTokens * CODE_FOCUSED_RATIOS.retrievedContext),
    recentMessages: Math.floor(totalTokens * CODE_FOCUSED_RATIOS.recentMessages),
    scaffoldingReminder: Math.floor(totalTokens * CODE_FOCUSED_RATIOS.scaffoldingReminder),
  };
}

// Usage
const budget = calculateCustomBudget(6400);
console.log(`Recent messages: ${budget.recentMessages} tokens (45% vs 35% default)`);
// Output: Recent messages: 2880 tokens (45% vs 35% default)
```

### Example 6: Multi-Model Budget Comparison

```typescript
import { calculateBudget } from './context/budget.js';

function compareBudgets(): void {
  const models = [
    { name: 'gpt-3.5-turbo', context: 4096 },
    { name: 'gpt-4', context: 8192 },
    { name: 'gpt-4-32k', context: 32768 },
    { name: 'claude-3-opus', context: 200000 },
  ];

  console.log('\nBudget Comparison Across Models:\n');
  console.log('Model'.padEnd(20) + 'Total'.padEnd(12) + 'Memory'.padEnd(12) + 'Recent Msgs'.padEnd(12) + 'Ratio');
  console.log('─'.repeat(70));

  for (const model of models) {
    const budget = calculateBudget(Math.floor(model.context * 0.8));
    console.log(
      model.name.padEnd(20) +
      budget.total.toString().padEnd(12) +
      budget.memory.toString().padEnd(12) +
      budget.recentMessages.toString().padEnd(12) +
      `${(budget.recentMessages / budget.total * 100).toFixed(0)}%`
    );
  }
}

compareBudgets();
```

**Output**:

```
Budget Comparison Across Models:

Model                Total       Memory      Recent Msgs Ratio
──────────────────────────────────────────────────────────────
gpt-3.5-turbo        3276        327         1146            35%
gpt-4                6553        655         2293            35%
gpt-4-32k            26214       2621        9174            35%
claude-3-opus        160000      16000       56000           35%
```

## Best Practices

### 1. Always Use a Buffer

Never use the full context limit for your budget. The standard practice is to use 80% of the limit:

```typescript
const maxContext = getModelContextLimit(model);
const budgetTotal = Math.floor(maxContext * 0.8); // 20% buffer
```

**Why?**
- Token estimation is approximate and can be off by 5-10%
- Model responses need space to generate output
- Prevents overflow errors at runtime

### 2. Monitor Budget Proactively

Don't wait for overflow errors. Monitor usage throughout the conversation:

```typescript
// After each LLM call
const usage = getUsage();
if (usage.remainingTokens < budget.total * 0.3) {
  // Trigger compression before it becomes critical
  await compress();
}
```

### 3. Adjust Budgets When Switching Models

Always recalculate budgets when switching between models:

```typescript
function switchModel(newModel: string): void {
  const oldLimit = getCurrentContextLimit();
  const newLimit = MODEL_CONTEXT_LIMITS[newModel];
  
  if (oldLimit !== newLimit) {
    this.currentBudget = adjustBudgetForTotal(
      this.currentBudget,
      Math.floor(newLimit * 0.8)
    );
  }
}
```

### 4. Balance Memory vs. History

The trade-off between `memory` and `conversationSummary`:

- **More Memory**: Better persistence of facts, preferences, and decisions
- **More Summary**: Better continuity of conversation flow

Adjust ratios based on your use case:

```typescript
// For long-running sessions with many user preferences
const PREFERENCE_FOCUSED_RATIOS = {
  ...DEFAULT_BUDGET_RATIOS,
  memory: 0.15,              // Increase memory
  conversationSummary: 0.10,  // Decrease summary
};

// For short, focused coding sessions
const SESSION_FOCUSED_RATIOS = {
  ...DEFAULT_BUDGET_RATIOS,
  memory: 0.05,              // Less memory needed
  conversationSummary: 0.20,  // More summary for continuity
};
```

### 5. Use Budget Warnings

Enable debug logging during development:

```typescript
process.env.DEBUG_BUDGET = '1';

// Or use conditional logging
if (shouldLogBudget) {
  console.log(`[Budget] Section usage:`, {
    systemPrompt: used.systemPrompt,
    memory: used.memory,
    recentMessages: used.recentMessages,
  });
}
```

### 6. Test with Different Context Sizes

Verify your budget system works across different model context limits:

```typescript
describe('Budget System', () => {
  const contextSizes = [4096, 8192, 32768, 128000];

  for (const size of contextSizes) {
    it(`should calculate valid budget for ${size} context`, () => {
      const budget = calculateBudget(Math.floor(size * 0.8));
      const sum = Object.values(budget)
        .filter((v, k) => k !== 'total')
        .reduce((a, b) => a + b, 0);
      
      expect(sum).toBeLessThanOrEqual(budget.total);
    });
  }
});
```

### 7. Track Budget Over Time

Monitor budget usage patterns to optimize ratios:

```typescript
class BudgetAnalytics {
  private history: Array<{
    timestamp: Date;
    model: string;
    budget: ContextBudget;
    actualUsage: number;
  }> = [];

  record(budget: ContextBudget, model: string, actualUsage: number): void {
    this.history.push({
      timestamp: new Date(),
      model,
      budget,
      actualUsage,
    });
  }

  analyze(): {avgUsage: number, overBudgetCount: number} {
    const avgUsage = this.history.reduce(
      (sum, h) => sum + h.actualUsage,
      0
    ) / this.history.length;

    const overBudgetCount = this.history.filter(
      h => h.actualUsage > h.budget.total
    ).length;

    return { avgUsage, overBudgetCount };
  }
}
```

## Troubleshooting

### Problem: Context Overflow Errors

**Symptoms**:
- "Context length exceeded" errors
- Responses cut off mid-sentence
- Model returns without completing the task

**Solutions**:
1. Increase the buffer (use 70% instead of 80%)
2. Enable more aggressive compression
3. Reduce budget ratios for less critical sections
4. Monitor usage earlier in the conversation

### Problem: Insufficient Memory Context

**Symptoms**:
- Agent forgets user preferences
- Decisions are not recalled
- Repetitive information extraction

**Solutions**:
1. Increase the `memory` budget ratio
2. Use more efficient memory storage
3. Implement memory prioritization
4. Increase compression aggressiveness

### Problem: Not Enough Room for Recent Messages

**Symptoms**:
- Conversation feels disjointed
- Agent loses track of recent exchanges
- Frequently asks for context

**Solutions**:
1. Increase the `recentMessages` budget ratio
2. Compress conversation history more aggressively
3. Reduce `systemPrompt` size
4. Use fewer scaffolding instructions

### Problem: Budget Warnings Too Frequent

**Symptoms**:
- Many warnings but no actual overflows
- Performance impact from constant checks
- User confusion about warnings

**Solutions**:
1. Adjust warning threshold (from 80% to 90%)
2. Implement hysteresis (warn at 80%, clear at 70%)
3. Make warnings debug-only in production
4. Add cooldown period between warnings

## API Reference

### Functions

#### `calculateBudget(totalTokens: number): ContextBudget`

Creates a new budget allocation based on the total available tokens.

**Parameters**:
- `totalTokens` - The total number of tokens to allocate (typically 80% of model context limit)

**Returns**:
- A `ContextBudget` object with allocated tokens for each section

**Example**:
```typescript
const budget = calculateBudget(6400);
```

#### `adjustBudgetForTotal(budget: ContextBudget, newTotal: number): ContextBudget`

Adjusts an existing budget to a new total while preserving proportions.

**Parameters**:
- `budget` - The existing budget to adjust
- `newTotal` - The new total token budget

**Returns**:
- A new `ContextBudget` object with adjusted allocations

**Example**:
```typescript
const newBudget = adjustBudgetForTotal(oldBudget, 25600);
```

#### `getAvailableTokens(budget: ContextBudget, used: Partial<ContextBudget>): ContextBudget`

Calculates remaining tokens for each section after accounting for usage.

**Parameters**:
- `budget` - The original budget allocation
- `used` - Tokens already used in each section (partial)

**Returns**:
- A `ContextBudget` object with available tokens for each section

**Example**:
```typescript
const available = getAvailableTokens(budget, {
  systemPrompt: 500,
  recentMessages: 1500
});
```

### Constants

#### `DEFAULT_BUDGET_RATIOS`

Default percentage allocations for each budget section.

```typescript
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
```

### Types

#### `ContextBudget`

Interface defining token allocations for context sections.

```typescript
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
```

## Recent Fixes and Improvements

### Budget Integration Fixes

Several critical fixes were implemented to ensure proper use of the budget system:

#### ConversationManager Integration

The `ConversationManager` class in `src/agent/conversation.ts` was enhanced to properly track and manage budgets:

1. **Added Budget Instance Variable**
   ```typescript
   private currentBudget?: ContextBudget;
   ```

2. **Updated Budget Calculation**
   - Now properly calls `calculateBudget()` from `src/context/budget.ts`
   - Uses proper API access via `contextManager.getUsage()` instead of `as any` assertions
   - Returns `ContextBudget` type instead of `number`

3. **Budget Integration in Memory Injection**
   - Extracts `budget.memory` when calling `buildContextSummary()`
   - Maintains backward compatibility with existing interface

4. **Dynamic Budget Adjustment**
   - Integrated `adjustBudgetForTotal()` in `setModelContextLimit()`
   - Budget automatically adjusts when model context limit changes
   - Maintains proper budget ratios during adjustments

5. **Budget Tracking**
   - Added `updateBudgetAfterResponse()` method
   - Tracks token usage after each LLM response
   - Warns when budget runs low (< 20% remaining)
   - Optional debug logging via `DEBUG_BUDGET` environment variable

#### SmartCompressor Separation

The `SmartCompressor` in `src/memory/smart-compressor.ts` uses a simplified budget calculation:

```typescript
private calculateMemoryBudget(): number {
  // Uses 20% of target tokens to avoid excessive memory
  return Math.floor(this.config.targetTokens * 0.2);
}
```

**Rationale for Separate Calculation:**
- The full `ContextBudget` type includes allocations for sections not used here
- Only the memory portion is needed for `buildContextSummary()`
- Keeps the smart-compressor focused on its specific use case
- The `ConversationManager` handles the full budget allocation

#### Type Safety Improvements

- All budget-related functions return consistent `ContextBudget` type
- Removed `as any` type assertions
- Proper API access via public methods

### Testing

All changes compile successfully:
```bash
npm run build
# Exit Code: 0
```

Type safety verification:
- ✅ All budget-related functions return consistent `ContextBudget` type
- ✅ No `as any` assertions for budget-related code
- ✅ Proper type inference throughout

## See Also

- [Context Manager Documentation](./context-manager.md)
- [Smart Compressor Documentation](./smart-compressor.md)
- [Memory Store Documentation](./memory-store.md)
- [Token Estimation](./token-estimation.md)
