# Validator Flow Integration Test

## Overview

This integration test validates the complete validator flow for the copilot-cli agent system. It simulates a realistic multi-step task to ensure all validators work together correctly to prevent incomplete work.

## What This Test Validates

### 1. **PlanningValidator** - Blocks write operations without task setup
- LLM attempts to create a file without first setting up tasks
- **Expected**: Validation error forces LLM to create task structure first

### 2. **CompletionTracker** - Audits files immediately after modification
- LLM creates files with TODOs, stubs, and placeholder implementations
- **Expected**: Audit runs IMMEDIATELY after each `create_file` or `patch_file`
- **Expected**: "Tracking:" messages appear for each incomplete item found

### 3. **IncompleteWorkDetector** - Blocks completion with open work
- LLM tries to claim completion while tasks are still open
- **Expected**: Blocked with "⚠️ Cannot complete: X open tasks remaining"
- LLM tries to claim completion while tracking items are still open
- **Expected**: Blocked with prompt to review tracking items

### 4. **Integration** - All validators work together
- Validates that the complete workflow prevents incomplete work from being accepted
- Ensures LLM is forced to properly complete all work before finishing

## Test Scenario

The test simulates this realistic workflow:

```
User Request: "Build an authentication module with login and logout functions"

STEP 1: LLM tries to write without task setup
   → PlanningValidator blocks ❌
   → LLM creates tasks ✓

STEP 2: LLM creates auth.ts with stub implementations
   → File created ✓
   → CompletionTracker audits IMMEDIATELY ✓
   → Finds 2 stubs: "TODO: Implement authentication", "TODO: Session cleanup" ✓
   → Tracking items added ✓

STEP 3: LLM creates auth.test.ts with TODO
   → File created ✓
   → CompletionTracker audits IMMEDIATELY ✓
   → Finds 1 TODO: "Add actual tests" ✓
   → Tracking item added ✓

STEP 4: LLM tries to finish with open task
   → IncompleteWorkDetector blocks ❌
   → "Cannot complete: 1 open tasks remaining" ✓
   → LLM marks task complete ✓

STEP 5: LLM tries to finish with 3 open tracking items
   → IncompleteWorkDetector blocks ❌
   → "Review tracking items" prompt ✓
   → LLM reviews and closes all tracking items ✓

STEP 6: LLM completes successfully
   → No blockers ✓
   → Loop ends ✓
```

## How to Run

### Option 1: Run specific test file
```bash
npm test -- src/agent/__tests__/validator-flow.integration.test.ts
```

### Option 2: Run with verbose output
```bash
npm test -- src/agent/__tests__/validator-flow.integration.test.ts --verbose
```

### Option 3: Use the helper script
```bash
./test-validator-flow.sh
```

## Expected Output

When the test runs, you should see console output showing each step:

```
========================================
STARTING VALIDATOR FLOW INTEGRATION TEST
========================================

[STEP 1] LLM attempts write operation without task setup
[LLM Call #1] Returning response: { content: "I'll create the authentication module now..." }

[STEP 2] LLM creates tasks and sets current task
[LLM Call #2] Returning response: { content: "You're right, I need to set up..." }

[STEP 3] LLM creates file with stub implementations
[Tool Execution] create_file: auth.ts
[UI Message] system: 🔍 Auditing create_file on auth.ts...
[UI Message] system: Tracking: stub in auth.ts: login function returns fake success...

... (continues for all steps)

========================================
VERIFYING TEST RESULTS
========================================

Captured 25 total messages
✓ Planning validator blocked write without task
✓ CompletionTracker found 3 tracking items
✓ Incomplete work detector blocked completion with open tasks
✓ Incomplete work detector triggered tracking item review

========================================
ALL VALIDATOR CHECKS PASSED ✓
========================================
```

## What Success Looks Like

The test passes when:

1. ✅ Planning validation blocks initial write operation
2. ✅ At least one "Tracking:" message appears (CompletionTracker found issues)
3. ✅ "Cannot complete: X open tasks" message appears (task blocking works)
4. ✅ "Asking LLM to review tracking items" message appears (tracking item blocking works)
5. ✅ No exceptions or errors thrown
6. ✅ Loop completes successfully after all work is done

## Mock Architecture

The test uses several mocking strategies:

### MockLLMClient
- Pre-queues all LLM responses
- Returns responses in sequence as they're requested
- Simulates both regular responses and audit LLM calls

### Mocked Tools
- `create_file` and `patch_file` return success without actual file I/O
- Tool results include realistic content previews
- Tool execution is logged for verification

### TestHarness
- Subscribes to UIState to capture all messages
- Provides helper methods to find specific messages
- Allows verification of validator output

## Debugging

If the test fails:

1. **Check console output** - Each step logs what it's doing
2. **Look for LLM call mismatches** - If you see "No more mocked responses", you need more queued responses
3. **Check message patterns** - The test searches for specific strings like "Tracking:" and "Cannot complete"
4. **Verify message count** - `Captured X total messages` shows how many messages were generated

## Extending the Test

To add more validation scenarios:

1. Queue additional LLM responses in the test
2. Add new verification assertions at the end
3. Use `harness.findMessage()` or `harness.findMessages()` to check for specific patterns
4. Add console.log statements to debug validator behavior

## Related Files

- `src/agent/loop.ts` - Main agentic loop with validator integration
- `src/agent/planning-validator.ts` - Planning validation logic
- `src/audit/tracker.ts` - CompletionTracker implementation
- `src/agent/incomplete-work-detector.ts` - Incomplete work detection
- `src/ui/ui-state.ts` - Message state management
