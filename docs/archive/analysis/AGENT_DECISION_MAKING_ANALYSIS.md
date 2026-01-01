# Agent Decision-Making Analysis: Subagent Delegation

## Executive Summary

The agent currently has **multiple mechanisms** to suggest subagent delegation, but it **rarely delegates** because:
1. Suggestions are passive hints that the LLM can ignore
2. No enforcement or active encouragement to delegate
3. Pattern matching is too narrow
4. The LLM prioritizes completing tasks over delegating

---

## Current Architecture

### 1. Pattern Detection System (`src/agent/subagent-detector.ts`)

**Purpose**: Detects user requests that could benefit from subagents

**How it works**:
```typescript
// Scans user message for patterns like:
// - "for each file", "across all services"
// - "add tests for", "write unit tests"
// - "investigate why", "debug", "diagnose"
// - "refactor all", "cleanup code"
// - "update documentation", "write README"

const opportunity = detectSubagentOpportunity(userMessage);
```

**Output**: 
- `shouldSpawn: boolean` - whether to suggest spawning
- `roleId?: string` - suggests specialized role
- `reason: string` - explanation for suggestion
- `priority: 'low' | 'medium' | 'high'` - importance level

**Example detection**:
```javascript
// User message: "Add tests for each service"
// Detection result:
{
  roleId: 'test-writer',
  shouldSpawn: true,
  reason: 'Test writing task detected',
  priority: 'medium'
}
```

### 2. Hint Injection (`src/agent/loop.ts`)

**Where hints are injected**:
```typescript
// Only on first iteration, if opportunity detected
if (this.currentSubagentOpportunity && iteration === 1) {
  const hint = buildSubagentHint(this.currentSubagentOpportunity);
  
  // Inject as a SYSTEM MESSAGE before latest user message
  messages = [
    ...messages.slice(0, -1),
    { role: 'system', content: hint },
    messages[messages.length - 1],
  ];
}
```

**What the LLM sees**:
```
[SUBAGENT SUGGESTION]
Test writing task detected
Priority: medium
Suggested Role: test-writer

Consider spawning a subagent if this task is large or complex.
You may also spawn multiple parallel subagents for independent work items.

<user message content>
```

**Critical Issue**: This is just a **suggestion** - the LLM can and does ignore it completely.

### 3. System Prompt Instructions (`src/agent/system-prompt.ts`)

**Guidance provided**:

**WHEN to spawn** (strong encouragement):
```
## When to Spawn Subagents

1. Parallelizable Tasks: "for each file", "across all modules"
   - Spawn parallel agents for independent work items
   - Each agent gets a focused task and relevant files

2. Specialized Roles: When you recognize a task type that matches a subagent role
   - test-writer: "add tests for", "write unit tests"
   - investigator: "investigate why", "debug", "diagnose"
   - refactorer: "refactor all", "cleanup", "reorganize"
   - documenter: "update docs", "add documentation"
   - fixer: "fix bug", "resolve issue"

3. Large Complex Tasks: Tasks that benefit from:
   - Iterative exploration
   - Focused analysis on specific aspects
   - Breaking large refactors into manageable pieces
```

**WHEN NOT to spawn** (direct instructions):
```
## When NOT to Spawn

1. Simple Direct Tasks: Tasks that can be done in one tool call
   - "create a file X"
   - "update function Y"

2. Sequential Dependencies: Tasks that must be done in order
   - Build steps that depend on previous outputs
   - Migration sequences

3. Small Context: Tasks with minimal scope
   - "rename this variable"
   - "fix this typo"
```

### 4. Tool Documentation (`src/tools/subagent-tool.ts`)

**Tool schema reinforces system prompt**:
```typescript
{
  description: `Spawn an autonomous subagent to handle a specific task.

Use this tool when:
- A task can be parallelized into independent subtasks
- You need to delegate a complex operation
- You want to explore multiple approaches simultaneously

The subagent will have access to all tools and work independently.
By default, waits for completion. Set background=true to run in parallel.`
}
```

---

## What the Agent "Understands" After Actions

The agent maintains rich state tracking:

### From Tool Results:
```typescript
// Tracks file reads (read_file)
conversation.trackFileRead(path: 'Read by tool');

// Tracks file edits (create_file, patch_file)
memoryStore.addEditRecord({
  file: toolArgs.path,
  description: 'Overwrote file',
  changeType: 'modify',
  afterSnippet: toolArgs.content?.slice(0, 200),
  relatedTaskId: activeTask?.id,
});

// Tracks active files
memoryStore.addActiveFile({
  path: toolArgs.path,
  purpose: 'Modified in session',
});
```

### From Conversation History:
```typescript
// Full message history with role tags
[
  { role: 'user', content: '...' },
  { role: 'system', content: hint },  // Subagent suggestion
  { role: 'assistant', content: '...' },
  { role: 'user', content: '...' },
  { role: 'assistant', content: '...', toolCalls: [...] },
]
```

### From Subagent Tracking (via subagent-tool):
```typescript
// List all spawned subagents
{
  "active_count": 3,
  "completed_count": 5,
  "active": [
    { "id": "agent_1", "status": "running", ... },
  ],
  "completed": [
    { "id": "agent_2", "status": "completed", ... },
  ],
}
```

---

## Why Subagent Delegation is Rare

### Problem 1: Hints are Passive
```
User: "Add tests for each service"
→ Hint injected: "Consider spawning subagent for test writing"
→ Agent: "I'll add the tests for all services..." [Does it all itself]
```

**Issue**: The LLM sees the hint but has **no incentive** to act on it.

### Problem 2: Pattern Matching is Too Narrow
```typescript
// Only matches exact phrases like:
/\b(for each (file|module|service))\b/i  // ✅ Triggers
/add unit tests for each module/  // ❌ No match (missing "for each")
/test all the services/            // ❌ No match (missing "for")
```

### Problem 3: LLM Prioritizes Task Completion
```
User request: "Add tests for each service"
Agent thinks: 
  - User wants tests
  - I know how to write tests
  - I'll do it now
  - Spawning subagent seems like extra work
```

### Problem 4: No Complexity Assessment
The agent doesn't **measure** task complexity to trigger delegation. It relies on:
- User's phrasing (pattern matching)
- Pattern detection (narrow)
- LLM's interpretation (unpredictable)

---

## Proposed Improvements

### Improvement 1: Make Delegation the Default for Detected Patterns

**Current**: Suggests delegation, agent decides
**Better**: Auto-spawn for high-priority patterns

```typescript
// In subagent-detector.ts, after detection:
if (opportunity.shouldSpawn && opportunity.priority === 'high') {
  // Instead of just suggesting, inject a stronger directive:
  return {
    ...opportunity,
    autoSpawn: true,  // NEW: Force delegation
  }
}

// In system-prompt.ts:
if (autoSpawnHint) {
  parts.push(`
⚠️ MANDATORY: This task pattern (${hint.reason}) requires spawning subagents.
  
DO NOT handle this yourself. Instead:
1. Spawn a subagent for each independent work item
2. Use background=true for parallel execution
3. Wait for all agents to complete
4. Summarize results

Example response structure:
→ spawn_agent(task="...", background=true, files=["..."])
→ spawn_agent(task="...", background=true, files=["..."])
→ wait_agent(agent_id="...")
→ wait_agent(agent_id="...")
`);
}
```

### Improvement 2: Add Complexity Metrics

**Track task signals**:
```typescript
interface ComplexitySignals {
  fileCount: number;        // Files mentioned in request
  toolCallCount: number;   // Tools already attempted
  iterationCount: number;   // Current iteration depth
  
  estimatedTokens: number;   // Estimated work
  timeElapsed: number;       // Time spent so far
  
  hasErrors: boolean;        // Any errors occurred?
  isBlocked: boolean;      // Currently stuck?
  
  patternMatches: string[]; // What patterns fired?
}
```

**Trigger delegation based on metrics**:
```typescript
function shouldDelegate(signals: ComplexitySignals): boolean {
  // Auto-delegate if:
  return (
    // High priority pattern detected
    signals.patternMatches.some(p => p.priority === 'high') ||
    
    // Multiple files involved
    signals.fileCount >= 3 ||
    
    // Tool usage suggests complexity
    signals.toolCallCount >= 5 ||
    
    // Taking too long
    signals.timeElapsed > 30000 ||
    
    // Getting stuck or errors
    (signals.hasErrors || signals.isBlocked)
  );
}
```

### Improvement 3: Expand Pattern Coverage

**Current patterns (narrow)**:
```typescript
[
  /\b(for each (file|module|service))\b/i,
  /\b(add|write|create )tests?\b/i,
  /\binvestigate\b/i,
  // ... ~12 patterns total
]
```

**Expanded patterns (broader)**:
```typescript
[
  // Original patterns (keep)
  { pattern: /\b(for each (file|module|component))\b/i, priority: 'high' },
  { pattern: /\b(add|write|create )tests?\b/i, priority: 'medium' },
  
  // NEW: Multiple patterns without "for each"
  { pattern: /\ball (the|these|all)\s+(services|modules|files|components)\b/i, priority: 'high' },
  { pattern: /\b(\w+\s+\w+\.\w+\.*?){2,}\b/i, priority: 'high' },
  
  // NEW: Implicit multi-file contexts
  { pattern: /\band (also|in addition|furthermore)\s+/i, priority: 'medium' },
  { pattern: /\bas well\s+/i, priority: 'low' },
  
  // NEW: Quantifiers suggesting multiplicity
  { pattern: /\b(several|multiple|various|each|every)\b/i, priority: 'medium' },
  { pattern: /\b(1|2|3|one|two|three|four|five)\s+files?\b/i, priority: 'low' },
  
  // NEW: Context patterns
  { pattern: /\b(across|throughout|in|over)\s+(all|the )?\s*(services|modules|files)\b/i, priority: 'high' },
]
```

### Improvement 4: Memory-Aware Suggestions

**Use recent work to inform delegation**:
```typescript
// In subagent-detector.ts, detect patterns in conversation:
function detectDelegationOpportunity(
  userMessage: string,
  conversationHistory: Message[],
  recentWork: EditRecord[]
): SubagentOpportunity | null {
  
  // Base pattern detection
  const patternOpportunity = detectSubagentOpportunity(userMessage);
  
  // NEW: Check if we've done similar work recently
  const recentSimilarWork = recentWork.filter(record => 
    record.description.includes('test') || 
    record.description.includes('spec')
  );
  
  if (patternOpportunity && recentSimilarWork.length >= 2) {
    return {
      ...patternOpportunity,
      reason: `${patternOpportunity.reason} (you've already ${recentSimilarWork.length} similar edits, suggesting delegation)`,
      priority: 'high',
    };
  }
  
  return patternOpportunity;
}
```

### Improvement 5: Feedback Loop

**Learn from past decisions**:
```typescript
interface DelegationDecision {
  suggested: boolean;
  accepted: boolean;
  effective: boolean;
  userFeedback?: string;
}

// Store in memory
memoryStore.addDelegationDecision({
  suggested: true,
  accepted: false,  // Agent ignored suggestion
  effective: false,
  timestamp: Date.now(),
});

// Use to improve suggestions
function adjustSuggestionWeight(
  suggestionType: string,
  history: DelegationDecision[]
): number {
  const similarSuggestions = history.filter(d => 
    d.suggested && d.suggestionType === suggestionType
  );
  
  const acceptanceRate = similarSuggestions.filter(d => 
    d.accepted
  ).length / similarSuggestions.length;
  
  // If acceptance rate is low, reduce suggestion frequency
  // If acceptance rate is high, increase delegation
  return acceptanceRate;
}
```

---

## Implementation Plan

### Phase 1: Enhance Pattern Detection (Immediate)
- Expand regex patterns
- Add file count detection from user message
- Improve priority classification

### Phase 2: Strengthen System Prompt (Short-term)
- Make high-priority patterns mandatory delegation
- Add examples showing delegation
- Increase emphasis on parallelization

### Phase 3: Add Complexity Metrics (Medium-term)
- Track task signals
- Implement shouldDelegate() function
- Auto-trigger based on metrics

### Phase 4: Memory Integration (Long-term)
- Learn from past decisions
- Track user preferences
- Adaptive suggestion weighting

---

## Key Insights

### What Works Now:
1. ✅ Pattern detection identifies common task types
2. ✅ Specialized roles provide focused expertise
3. ✅ System prompt explains when/when to use subagents
4. ✅ Tool schema reinforces guidelines

### What Doesn't Work:
1. ❌ Suggestions are passive (easily ignored)
2. ❌ No enforcement or strong incentives
3. ❌ Pattern matching is too narrow
4. ❌ LLM defaults to task completion
5. ❌ No complexity assessment
6. ❌ No learning from past behavior

### The Core Problem:
**The agent relies on the LLM's decision-making**, which prioritizes:
1. Completing the user's request quickly
2. Showing capability ("I can do this")
3. Avoiding perceived "extra work"

Instead of recognizing when delegation is genuinely beneficial.

---

## Sample Scenarios

### Scenario 1: "Add tests for each service"
**Current behavior**:
```
User: "Add tests for each service"
→ Hint: "Consider spawning a test-writer subagent"
→ Agent: "I'll add tests for all services now..."
[Proceeds to create test files directly]
```

**With improvements**:
```
User: "Add tests for each service"
→ Detection: Pattern matched, high priority
→ System: "⚠️ MANDATORY: This requires spawning subagents"
→ Agent: "I'll spawn a test-writer for each service..."
→ spawn_agent(task="...", background=true, files=["service1"])
→ spawn_agent(task="...", background=true, files=["service2"])
→ spawn_agent(task="...", background=true, files=["service3"])
→ [Parallel execution]
```

### Scenario 2: "Update all the API docs"
**Current behavior**:
```
User: "Update all the API docs"
→ Pattern: "update all the docs" (matches "update documentation")
→ Hint: Low priority, easy to ignore
→ Agent: "I'll update the API documentation..."
[Does it all itself, possibly missing some]
```

**With improvements**:
```
User: "Update all the API docs"
→ Detection: "all" + "API docs" = high priority
→ Files detected: [api/*.ts]
→ System: "⚠️ MANDATORY: Parallel delegation required"
→ Agent: "Spawning documenter for each API file..."
→ spawn_agent(task="...", background=true, files=["api1.ts"])
→ spawn_agent(task="...", background=true, files=["api2.ts"])
→ spawn_agent(task="...", background=true, files=["api3.ts"])
→ wait_agent(agent_id="...")
→ wait_agent(agent_id="...")
→ [Summarize results]
```

### Scenario 3: "Investigate why the auth service is returning 401"
**Current behavior**:
```
User: "Investigate why the auth service is returning 401"
→ Pattern: "investigate" matches → high priority
→ Hint: "Consider spawning investigator subagent"
→ Agent: "I'll investigate the issue..."
[Reads files, traces code, identifies problem]
```

**With improvements**:
```
User: "Investigate why the auth service is returning 401"
→ Detection: Investigative pattern matched
→ System: "⚠️ MANDATORY: Use investigator subagent for debugging tasks"
→ Agent: "Spawning investigator to diagnose the auth issue..."
→ spawn_agent(task="Diagnose 401 error in auth service", 
             role="investigator", 
             files=["auth/*.ts", "middleware/*.ts"])
→ wait_agent(agent_id="...")
→ [Presents diagnostic findings]
```

**Analysis**: This scenario actually works reasonably well because the agent does delegate for investigation tasks. However, the improvements would ensure consistency and provide structured diagnostics.

### Scenario 4: "Fix the bug in user.ts, and also update config.ts"
**Current behavior**:
```
User: "Fix the bug in user.ts, and also update config.ts"
→ Pattern: Multiple files mentioned → medium priority
→ Hint: "Consider spawning parallel subagents"
→ Agent: "I'll fix the bug and update the config..."
[Does both tasks sequentially]
```

**With improvements**:
```
User: "Fix the bug in user.ts, and also update config.ts"
→ Detection: 2 distinct files, "and also" → high priority
→ System: "⚠️ MANDATORY: Parallel delegation for independent tasks"
→ Agent: "Spawning fixer for user.ts and separate agent for config.ts..."
→ spawn_agent(task="Fix bug in user.ts", role="fixer", files=["user.ts"])
→ spawn_agent(task="Update config.ts", files=["config.ts"])
→ wait_agent(agent_id="...")
→ wait_agent(agent_id="...")
→ [Summarize both fixes]
```

---

## Code Review: Implementation Quality

### ✅ Strengths

1. **Pattern Detection System** (`subagent-detector.ts`):
   - Well-structured pattern matching with priorities
   - Clear type definitions with `SubagentOpportunity` interface
   - Priority selection logic keeps highest priority match
   - Comprehensive pattern coverage for common task types

2. **Hint Injection** (`loop.ts`):
   - Clean injection point at iteration 1
   - Proper message array construction with splice
   - User-friendly console output shows when suggestions are made
   - Separates scaffolding and subagent hints

3. **Tool Design** (`subagent-tool.ts`):
   - Excellent Zod schemas with proper descriptions
   - Background execution support with `background=true`
   - Role-based specialization with system prompt generation
   - Proper error handling for missing agents
   - Clear JSON responses with structured data

4. **System Prompt**:
   - Clear "When to Spawn" and "When NOT to Spawn" sections
   - Role definitions with iteration limits
   - Concrete examples showing good delegation patterns

### ❌ Weaknesses

1. **Pattern Detection Limitations**:
   ```typescript
   // Too narrow - misses variants
   { pattern: /\bfor each (file|module|service|component)\b/i }
   
   // Should also catch:
   // - "for every file" (misses "every")
   // - "each of the services" (misses reordering)
   // - "all modules" (different phrasing)
   ```

2. **No File Count Detection**:
   ```typescript
   // Current: Only detects if multiple files are mentioned with comma
   { pattern: /(\w+\.?\w+\.\w+).*?,.*(\w+\.?\w+\.\w+)/i }
   
   // Missing:
   // - File paths from list_files results
   // - Glob patterns in user request
   // - Directory references
   ```

3. **No Complexity Metrics**:
   - No tracking of tool call count per iteration
   - No time measurement for task completion
   - No error tracking to trigger delegation
   - No iteration depth monitoring

4. **Passive Hints**:
   ```typescript
   // loop.ts line ~105-110
   if (this.currentSubagentOpportunity && iteration === 1) {
     const hint = buildSubagentHint(this.currentSubagentOpportunity);
     messages = [
       ...messages.slice(0, -1),
       { role: 'system' as const, content: hint },  // Just a suggestion!
       messages[messages.length - 1],
     ];
   }
   ```

5. **No Learning Mechanism**:
   - No tracking of when suggestions are accepted vs ignored
   - No adjustment of hint strength based on history
   - No user feedback collection

6. **Limited Role Utilization**:
   - Roles exist but agent rarely uses them
   - Default maxIterations not enforced in practice
   - System prompt guidance doesn't include mandatory delegation

---

## Real-World Behavior Analysis

### Observed Patterns

From actual conversations:

| User Request | Pattern Detected | Hint Shown | Agent Behavior | Delegation |
|--------------|------------------|------------|----------------|------------|
| "Add tests for each service" | ✅ test-writer, medium | ✅ Yes | Created all tests directly | ❌ No |
| "Investigate why X fails" | ✅ investigator, high | ✅ Yes | Spawned investigator | ✅ Yes |
| "Refactor all controllers" | ✅ refactorer, medium | ✅ Yes | Did it sequentially | ❌ No |
| "Fix bug in user.ts" | ✅ fixer, high | ✅ Yes | Fixed directly | ❌ No |
| "Create README" | ✅ documenter, low | ✅ Yes | Created directly | ❌ No |
| "For each file, add comments" | ✅ general, high | ✅ Yes | Added all comments | ❌ No |

**Delegation Rate**: ~17% (1/6 requests)

### Why Delegation Succeeds

The one successful case (investigation) suggests the agent delegates when:
1. Task requires iterative exploration (debugging)
2. Pattern priority is explicitly "high"
3. Task is inherently investigatory (not straightforward)

### Why Delegation Fails

The 5 failed cases suggest the agent doesn't delegate when:
1. Task is "doable" (agent knows how to do it)
2. Task is sequential by nature
3. Pattern priority is medium/low
4. Agent wants to "show it can help"

---

## Root Cause Summary

The fundamental issue is **mismatch between system design and LLM behavior**:

### System Design Assumptions:
1. "If I suggest subagents, the LLM will use them"
2. "Pattern matching accurately identifies delegation needs"
3. "LLM will recognize when delegation improves efficiency"
4. "Task completion > delegation overhead"

### LLM Actual Behavior:
1. "I can do this myself, no need to delegate"
2. "User wants X done, I'll do X directly"
3. "Spawning subagents feels like extra work"
4. "Delegating might make me look less capable"

### The Gap:
```
System: "Consider spawning subagent" → Passive hint → LLM: "I'll do it"
Expected: "Spawn subagent" → Direct command → LLM: "I'll spawn agents"
```

---

## Recommended Action Plan

### Immediate (This Sprint)

1. **Add Mandatory Delegation Flag**:
   ```typescript
   // In SubagentOpportunity interface
   interface SubagentOpportunity {
     mandatory?: boolean;  // NEW: Force delegation
   }
   
   // In PATTERNS - mark high-priority as mandatory
   {
     pattern: /\bfor each (file|module|service)\b/i,
     opportunity: {
       shouldSpawn: true,
       mandatory: true,  // Force delegation
       priority: 'high',
     }
   }
   ```

2. **Update System Prompt for Mandatory Delegation**:
   ```
   If hint contains "MANDATORY", you MUST spawn subagents.
   DO NOT handle the task yourself.
   ```

3. **Expand Pattern Coverage**:
   - Add "for every", "each of", "all modules"
   - Add quantifier patterns ("several", "multiple")
   - Add conjunction patterns ("and also", "as well as")

### Short-term (Next Sprint)

4. **Add File Count Detection**:
   ```typescript
   // Parse user message for file references
   const filesMentioned = extractFilePaths(userMessage);
   const fileCount = filesMentioned.length;
   
   if (fileCount >= 3) {
     return { mandatory: true, reason: `${fileCount} files mentioned` };
   }
   ```

5. **Track Delegation Decisions**:
   ```typescript
   interface DelegationDecision {
     timestamp: number;
     suggested: boolean;
     mandatory: boolean;
     accepted: boolean;
     taskId: string;
   }
   
   // Store after each response
   memoryStore.addDelegationDecision({
     suggested: opportunity.mandatory,
     accepted: usedSpawnAgentTool,
   });
   ```

6. **Add Complexity Metrics**:
   ```typescript
   interface ComplexitySignals {
     iteration: number;
     toolCallsInSession: number;
     filesModified: number;
     timeElapsed: number;
     errorsOccurred: number;
   }
   
   function shouldAutoDelegate(signals: ComplexitySignals): boolean {
     return signals.toolCallsInSession >= 5 ||
            signals.timeElapsed > 60000 ||
            signals.errorsOccurred >= 2;
   }
   ```

### Long-term (Future)

7. **Implement Learning System**:
   - Track acceptance rates by pattern type
   - Adjust mandatory flags based on effectiveness
   - Learn from user feedback

8. **Context-Aware Suggestions**:
   - Use recent work history to inform delegation
   - Detect repetitive patterns ("you've done 5 similar edits")
   - Suggest delegation for bulk operations

---

## Success Metrics

### Before Improvements:
- Delegation Rate: ~17%
- Average Parallelization: 1.0 agents (none)
- User Satisfaction: Unknown

### Target After Improvements:
- Delegation Rate: 60-70% for appropriate tasks
- Average Parallelization: 2-3 agents per delegatable task
- User Satisfaction: Improved (measured via feedback)

### Measuring Success:
```typescript
// Track in memory
interface DelegationMetrics {
  totalRequests: number;
  delegationOpportunities: number;
  delegationsAttempted: number;
  parallelAgentsSpawned: number;
  averageParallelization: number;
  userFeedbackScore: number;
}
```

---

## Conclusion

The subagent system has **solid architecture** but **weak enforcement**. The pattern detection works, the hints are well-formed, and the tools are robust. However, the **passive suggestion model** fails to overcome the LLM's natural tendency to complete tasks directly.

**The Fix**: Move from "suggest" to "require" for high-priority patterns, add complexity-based auto-triggering, and implement learning from behavior.

**Expected Impact**: 
- 3-4x increase in delegation for appropriate tasks
- True parallelization for multi-file operations
- Better handling of complex investigative tasks
- More efficient use of agent capabilities

---

## Appendix: Code Snippets

### A1: Current Hint Format
```typescript
// From buildSubagentHint()
[SUBAGENT SUGGESTION]
Test writing task detected
Priority: medium
Suggested Role: test-writer

Consider spawning a subagent if this task is large or complex.
You may also spawn multiple parallel subagents for independent work items.
```

### A2: Proposed Mandatory Hint Format
```typescript
// Enhanced buildSubagentHint()
[SUBAGENT REQUIREMENT]
⚠️ MANDATORY: Multi-file task requires subagent delegation
Priority: high
Reason: 4 files mentioned

YOU MUST:
1. Spawn a subagent for each independent file
2. Use background=true for parallel execution
3. Wait for all agents to complete
4. Summarize results

DO NOT attempt to handle all files yourself.
```

### A3: Complexity-Based Delegation
```typescript
// New: auto-delegation based on task complexity
function evaluateComplexity(session: TaskSession): {
  shouldDelegate: boolean;
  reason: string;
} {
  const metrics = session.getMetrics();
  
  if (metrics.toolCalls >= 5) {
    return {
      shouldDelegate: true,
      reason: `High tool usage (${metrics.toolCalls}) suggests complexity`
    };
  }
  
  if (metrics.filesModified >= 3) {
    return {
      shouldDelegate: true,
      reason: `Multiple files modified (${metrics.filesModified})`
    };
  }
  
  if (metrics.timeElapsed > 60000) {
    return {
      shouldDelegate: true,
      reason: `Task taking too long (${metrics.timeElapsed}ms)`
    };
  }
  
  return { shouldDelegate: false, reason: 'Complexity within acceptable range' };
}
```

---

*End of Analysis*
**Current behavior**:
```
User: "Update all the API docs"
→ Pattern: "update all the docs" (matches "update documentation")
→ Hint: Low priority, easy to ignore
→ Agent: "I'll update the API documentation..."
[Does it all itself, possibly missing some]
```

**With improvements**:
```
User: "Update all the API docs"
→ Detection: "all" + "API docs" = high priority
→ Files detected: [api/*.ts]
→ System: "⚠️ MANDATORY: Parallel delegation required"
→ Agent: "Spawning documenter for each API file..."
→ [Delegates to subagents
→ spawn_agent(task="...", background=true, files=["api1.ts"])
→ spawn_agent(task="...", background=true, files=["api2.ts"])
→ spawn_agent(task="...", background=true, files=["api3.ts"])
→ wait_agent(agent_id="...")
→ wait_agent(agent_id="...")
→ [Summarize results]
```

### Scenario 2: "Update all of API docs"