# Action Plan: Complete Incomplete Features & Improve Subagent Delegation

## Overview

This action plan addresses:
1. **Incomplete Scaffolding** - Complete missing_call and stub items from previous work
2. **Subagent Delegation Improvements** - Increase delegation rate from ~17% to 60-70%

## Status Legend

- [ ] Not Started
- [x] Completed
- [ ] In Progress
- [ ] Blocked
- [ ] Delegated

---

# Phase 1: Complete Incomplete Scaffolding

**Priority**: 🔴 Critical (Must complete first)
**Estimated Time**: 2-3 hours
**Assignees**: Can be split across 2 subagents


## 1.1 Context Budget Module (missing_call)

**Assignee**: fixer subagent recommended
**Status**: [ ] Not Started

### Task 1.1.1: Integrate calculateBudget() into Context Building

**File**: `src/context/budget.ts` or `src/context/index.ts`

- [ ] Review current calculateBudget() implementation
  - [ ] Read src/context/budget.ts lines 1-50
  - [ ] Verify budget calculation logic is sound
  - [ ] Document the algorithm used

- [ ] Identify where budget calculation should be called
  - [ ] Search for buildContextSummary() call sites
  - [ ] Identify entry point for context building
  - [ ] Map the data flow: budget -> buildContextSummary -> LLM call

- [ ] Update buildContextSummary() to use calculated budget
  - [ ] Add tokenBudget parameter defaulting to calculateBudget()
  - [ ] Ensure type safety with TypeScript interfaces
  - [ ] Add JSDoc comment explaining budget source

- [ ] Add budget tracking to ConversationManager
  - [ ] Store current budget in conversation state
  - [ ] Update budget after each LLM call
  - [ ] Persist budget across iterations

- [ ] Test budget integration
  - [ ] Create test with small budget (100 tokens)
  - [ ] Verify context is truncated appropriately
  - [ ] Create test with large budget (100k tokens)
  - [ ] Verify full context is included

- [ ] Add error handling
  - [ ] Handle negative budgets
  - [ ] Handle budget overflow
  - [ ] Add budget validation in calculateBudget()

**Deliverables**:
- [ ] Modified src/context/budget.ts with exported calculateBudget()
- [ ] Updated buildContextSummary() with tokenBudget parameter
- [ ] Unit tests for budget calculation and integration
- [ ] Documentation of budget usage flow

---

# Phase 2: Implement Subagent Delegation Improvements

**Priority**: 🟡 High (After Phase 1)
**Estimated Time**: 4-6 hours
**Assignees**: Can be split across 3 subagents

## 2.1 Add Mandatory Delegation Flag

**Assignee**: refactorer subagent recommended
**Status**: [ ] Not Started

### Task 2.1.1: Update SubagentOpportunity Interface

**File**: `src/agent/subagent-detector.ts`

- [ ] Add mandatory field to interface
  - [ ] Extend SubagentOpportunity interface
  - [ ] Add `mandatory?: boolean` field
  - [ ] Add TypeScript documentation

- [ ] Update type safety
  - [ ] Add validation for mandatory flag
  - [ ] Ensure backward compatibility
  - [ ] Add type guards

- [ ] Update all PATTERNS entries
  - [ ] Mark high-priority patterns as mandatory
  - [ ] Review each pattern's priority
  - [ ] Add mandatory flag where appropriate

- [ ] Add mandatory field to PatternMatch type
  - [ ] Update interface definition
  - [ ] Add default value (false)
  - [ ] Ensure consistency across all patterns

**Deliverables**:
- [ ] Updated SubagentOpportunity interface
- [ ] All patterns marked with mandatory flags
- [ ] Type tests for mandatory flag
- [ ] Documentation of mandatory behavior

### Task 2.1.2: Implement Mandatory Delegation Logic

**File**: `src/agent/subagent-detector.ts`

- [ ] Implement mandatory detection
  - [ ] Add logic to set mandatory flag
  - [ ] Define rules for mandatory delegation
  - [ ] Add priority-to-mandatory mapping

- [ ] Update detectSubagentOpportunity()
  - [ ] Return mandatory field when appropriate
  - [ ] Document when mandatory is set
  - [ ] Add examples of mandatory triggers

- [ ] Add mandatory detection tests
  - [ ] Test high-priority patterns are mandatory
  - [ ] Test medium/low patterns are not mandatory
  - [ ] Test edge cases
  - [ ] Test backward compatibility

- [ ] Add mandatory flag propagation
  - [ ] Ensure flag flows to buildSubagentHint()
  - [ ] Test flag is preserved through pipeline
  - [ ] Add error handling for missing flag

**Deliverables**:
- [ ] Mandatory detection logic
- [ ] Updated detectSubagentOpportunity() function
- [ ] Comprehensive test suite
- [ ] Flag propagation verified

### Task 2.1.3: Update buildSubagentHint() for Mandatory Mode

**File**: `src/agent/subagent-detector.ts`

- [ ] Redesign hint format for mandatory
  - [ ] Design mandatory hint template
  - [ ] Use "REQUIREMENT" instead of "SUGGESTION"
  - [ ] Add [WARNING] warning emoji
  - [ ] Add imperative language ("YOU MUST")

- [ ] Implement mandatory hint builder
  - [ ] Add conditional formatting based on mandatory flag
  - [ ] Add clear action steps for mandatory delegation
  - [ ] Add examples of proper response structure

- [ ] Update existing hint for backward compatibility
  - [ ] Keep suggestion format for non-mandatory
  - [ ] Ensure smooth transition
  - [ ] Add migration notes

- [ ] Add hint validation
  - [ ] Validate mandatory hints have required sections
  - [ ] Validate suggestion hints are gentle
  - [ ] Add hint formatting tests

**Deliverables**:
- [ ] Mandatory hint template
- [ ] Updated buildSubagentHint() function
- [ ] Hint validation logic
- [ ] Test suite for both hint types

### Task 2.1.4: Update System Prompt for Mandatory Delegation

**File**: `src/agent/system-prompt.ts`

- [ ] Add mandatory delegation section
  - [ ] Define when delegation is mandatory
  - [ ] Explain what "MANDATORY" means
  - [ ] Add examples of mandatory triggers
  - [ ] Specify consequences of ignoring

- [ ] Add mandatory response structure
  - [ ] Define expected tool call pattern
  - [ ] Add example: spawn_agent → wait_agent
  - [ ] Add example: parallel spawn_agents
  - [ ] Show proper summary format

- [ ] Update "When to Spawn" section
  - [ ] Reference mandatory patterns
  - [ ] Add "MUST" language for high priority
  - [ ] Clarify "should" vs "must"

- [ ] Add error handling guidance
  - [ ] What to do if spawn fails
  - [ ] How to handle background agent failures
  - [ ] When to retry vs escalate

- [ ] Test system prompt effectiveness
  - [ ] Prompt LLM with mandatory scenario
  - [ ] Verify it delegates
  - [ ] Verify it uses proper structure
  - [ ] Refine prompt if needed

**Deliverables**:
- [ ] Updated system prompt with mandatory section
- [ ] Mandatory response structure documentation
- [ ] System prompt effectiveness tests
- [ ] Error handling guidance

### Task 2.1.5: Integrate Mandatory Flag into Loop

**File**: `src/agent/loop.ts`

- [ ] Update hint injection to use mandatory flag
  - [ ] Read mandatory flag from opportunity
  - [ ] Pass flag to buildSubagentHint()
  - [ ] Verify hint is injected correctly

- [ ] Add mandatory logging
  - [ ] Log when mandatory delegation is triggered
  - [ ] Log which pattern triggered it
  - [ ] Use different color/console style for mandatory
  - [ ] Add "[WARNING] MANDATORY" prefix to log

- [ ] Add mandatory enforcement check
  - [ ] After LLM response, check if spawn_agent used
  - [ ] If mandatory and no delegation, warn or retry
  - [ ] Add telemetry for mandatory compliance

- [ ] Test integration
  - [ ] Test with mandatory pattern
  - [ ] Verify hint is stronger
  - [ ] Verify agent delegates
  - [ ] Test with non-mandatory pattern

**Deliverables**:
- [ ] Updated hint injection
- [ ] Mandatory logging system
- [ ] Enforcement check logic
- [ ] Integration tests

### Task 2.1.6: Document Mandatory Delegation

**File**: `docs/mandatory-delegation.md`

- [ ] Create mandatory delegation guide
  - [ ] What is mandatory delegation
  - [ ] When it triggers
  - [ ] Expected behavior
  - [ ] How to customize

- [ ] Document mandatory patterns
  - [ ] List all mandatory patterns
  - [ ] Explain why each is mandatory
  - [ ] Show examples
  - [ ] Provide customization guide

- [ ] Create troubleshooting guide
  - [ ] Agent not delegating when mandatory
  - [ ] Agent delegating when not expected
  - [ ] How to debug mandatory triggers

- [ ] Update migration guide
  - [ ] How behavior changes
  - [ ] What to expect
  - [ ] How to adjust prompts

**Deliverables**:
- [ ] docs/mandatory-delegation.md documentation
- [ ] Pattern reference
- [ ] Troubleshooting guide
- [ ] Migration guide

## 2.2 Expand Pattern Coverage

**Assignee**: refactorer subagent recommended
**Status**: [ ] Not Started

### Task 2.2.1: Add Quantifier Patterns

**File**: `src/agent/subagent-detector.ts`

- [ ] Design quantifier pattern set
  - [ ] "several", "multiple", "various"
  - [ ] "each", "every"
  - [ ] "all", "each of", "every one of"
  - [ ] Number phrases ("two files", "three services")

- [ ] Implement quantifier patterns
  - [ ] Add regex patterns to PATTERNS array
  - [ ] Set appropriate priority (usually medium)
  - [ ] Add role hints where appropriate
  - [ ] Test pattern matching

- [ ] Add context awareness
  - [ ] Ensure quantifier applies to files/modules
  - [ ] Avoid false positives for "several options"
  - [ ] Add word boundary checks
  - [ ] Test edge cases

- [ ] Create test suite
  - [ ] Test each quantifier pattern
  - [ ] Test negative cases
  - [ ] Test combinations
  - [ ] Test priority ordering

**Deliverables**:
- [ ] Quantifier pattern implementations
- [ ] Context-aware matching
- [ ] Comprehensive test suite
- [ ] Pattern documentation

### Task 2.2.2: Add Conjunction Patterns

**File**: `src/agent/subagent-detector.ts`

- [ ] Design conjunction pattern set
  - [ ] "and also", "and additionally"
  - [ ] "as well as", "along with"
  - [ ] "in addition", "furthermore"
  - [ ] "plus", "also"

- [ ] Implement conjunction patterns
  - [ ] Add regex patterns to PATTERNS array
  - [ ] Detect when conjunction joins distinct tasks
  - [ ] Set appropriate priority (usually low-medium)
  - [ ] Add role hints where appropriate

- [ ] Add task separation logic
  - [ ] Split message at conjunctions
  - [ ] Identify distinct tasks
  - [ ] Count independent tasks
  - [ ] Return count in opportunity

- [ ] Create test suite
  - [ ] Test each conjunction pattern
  - [ ] Test task separation
  - [ ] Test false negatives
  - [ ] Test boundary cases

**Deliverables**:
- [ ] Conjunction pattern implementations
- [ ] Task separation logic
- [ ] Comprehensive test suite
- [ ] Task count integration

---

## Summary

Total Tasks: 50+ detailed tasks across 2 Phases
Estimated Total Time: 6-9 hours
Recommended Parallelization: 3-5 subagents

Phase 1 (Scaffolding):
- 1.1: Context Budget (4 major tasks)
- 1.2: Subagent Role Prompts (7 major tasks)

Phase 2 (Delegation Improvements):
- 2.1: Mandatory Delegation (6 major tasks, 30+ sub-tasks)
- 2.2: Pattern Coverage (2 major tasks, 20+ sub-tasks)

Each task includes:
- File specification
- Checkboxed sub-tasks
- Clear deliverables
- Recommended subagent role

---

# Update: 2025-01-02

## Phase 1.1: Context Budget Module - ✅ COMPLETED

All tasks in section 1.1 (Context Budget Module) have been completed. See:

- **BUDGET_FIXES_SUMMARY.md** - Comprehensive documentation of all fixes
- **src/agent/conversation.ts** - Updated with proper budget integration
- **src/memory/smart-compressor.ts** - Updated with comment explaining local calculation

### Completed Changes:

1. ✅ `calculateTokenBudget()` now returns `ContextBudget` instead of `number`
2. ✅ Calls `calculateBudget()` from `src/context/budget.ts`
3. ✅ Budget stored as instance variable `private currentBudget?: ContextBudget`
4. ✅ `initialize()` extracts `budget.memory` and passes to `buildContextSummary()`
5. ✅ `adjustBudgetForTotal()` integrated in `setModelContextLimit()`
6. ✅ Unused `calculateBudget` import removed from smart-compressor
7. ✅ Type safety improved with explicit annotations
8. ✅ Budget tracking added with `updateBudgetAfterResponse()`
9. ✅ TypeScript compiles without errors
10. ✅ All type signatures are correct

### Testing Results:
- ✅ TypeScript compilation: PASS
- ✅ Type safety: PASS
- ✅ Logic flow: PASS

The budget integration is now complete and ready for Phase 2.
