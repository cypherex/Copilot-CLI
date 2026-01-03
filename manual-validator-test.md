# Manual Validator Flow Test

Since the automated integration test has ESM module issues with Jest/chalk, here's a manual test procedure to verify the complete validator flow.

## Prerequisites

```bash
npm run build
```

## Test Scenario: Build Authentication Module

This test validates all validators work together to prevent incomplete work.

### Expected Flow

```
User Request → Planning Validator blocks writes without task
             → LLM creates tasks
             → LLM creates files with stubs
             → CompletionTracker audits IMMEDIATELY
             → Finds stubs/TODOs
             → Blocks completion with open tasks
             → Blocks completion with tracking items
             → Forces review and completion
             → Finally allows completion
```

## How to Test

### Test 1: Ask Mode (Detailed Logging)

Run in ask mode to see all audit messages in the log file:

```bash
node dist/cli/index.js ask "Build an authentication module with login and logout functions. Create auth.ts with the functions, but use TODO comments for the implementation details." --output-file test-validator-output.txt
```

**What to Look For in `test-validator-output.txt`:**

1. **Planning Validation** (if LLM tries to write without tasks):
   ```
   [Planning Validation Required]
   You must create tasks before performing write operations
   ```

2. **Immediate Audit Messages** (after each file creation):
   ```
   ═══════════════════════════════════════════════════════════
   📋 SCAFFOLDING AUDIT RESULTS
   ═══════════════════════════════════════════════════════════
   Tracking: stub in auth.ts: login function has TODO placeholder
   Tracking: todo in auth.ts: TODO: Implement actual authentication
   ═══════════════════════════════════════════════════════════
   ```

3. **Task Blocking** (if LLM tries to finish with open tasks):
   ```
   ⚠️ Cannot complete: 1 open tasks remaining
   ```

4. **Tracking Item Blocking** (if LLM tries to finish with tracking items):
   ```
   Asking LLM to review tracking items with file verification
   ```

5. **Final Success**:
   ```
   Everything is complete!
   ```

### Test 2: Interactive Mode (Visual Feedback)

Run in interactive mode to see real-time colored output:

```bash
node dist/cli/index.js chat
```

Then type:
```
Build an authentication module with login and logout functions. Use TODO comments as placeholders.
```

**What to Look For in the Terminal:**

1. **Yellow audit messages** when files are created:
   - `Tracking: stub in auth.ts: ...` (in yellow/bright color)
   - `Resolved: stub in auth.ts` (when fixed, in yellow/bright color)

2. **Yellow blocking messages**:
   - `⚠️ Cannot complete: X open tasks remaining` (yellow)
   - Task blocking prevents premature completion

3. **Tool execution with immediate audits**:
   ```
   ⚙️  Executing: create_file
   ✓ Completed: create_file (250ms)
   🔍 Auditing create_file on auth.ts...
   Tracking: stub in auth.ts: login returns hardcoded value
   ```

4. **Tracking item review process**:
   ```
   You said work is complete, but there are pending tracking items
   Use list_tracking_items to see all open items
   ```

## Verification Checklist

Run through this checklist to verify all validators work:

- [ ] **PlanningValidator**: Prevents writes without active task
  - If LLM tries to create files before setting up tasks, see validation error

- [ ] **CompletionTracker**: Audits files IMMEDIATELY after creation
  - See audit messages RIGHT AFTER each `create_file` or `patch_file`
  - NOT at the end of the session

- [ ] **CompletionTracker**: Finds stubs/TODOs/placeholders
  - See "Tracking:" messages for each incomplete item
  - Messages appear in yellow in interactive mode
  - Messages appear with formatted headers in ask mode logs

- [ ] **IncompleteWorkDetector**: Blocks completion with open tasks
  - If LLM tries to finish with tasks marked as pending/in_progress/blocked
  - See "⚠️ Cannot complete: X open tasks remaining"

- [ ] **IncompleteWorkDetector**: Blocks completion with tracking items
  - If LLM tries to finish with open tracking items
  - See "Asking LLM to review tracking items"
  - LLM forced to use list_tracking_items, review_tracking_item, close_tracking_item

- [ ] **Integration**: Full workflow prevents incomplete work
  - LLM cannot claim completion until ALL work is done
  - Tasks completed
  - Tracking items reviewed and closed
  - Only then does the loop end

## Expected Audit Output Examples

### Successful Audit (No Issues)
```
🔍 Auditing create_file on utils.ts...
✓ Audit complete: No incomplete scaffolding detected in utils.ts
```

### Audit Finding Issues
```
🔍 Auditing create_file on auth.ts...

═══════════════════════════════════════════════════════════
📋 SCAFFOLDING AUDIT RESULTS
═══════════════════════════════════════════════════════════
Tracking: stub in auth.ts: login function returns hardcoded t...
Tracking: todo in auth.ts: TODO: Implement session cleanup
═══════════════════════════════════════════════════════════
```

### Audit Failure
```
⚠️ Scaffolding audit failed: LLM request failed: timeout
```

## Common Issues

### 1. No Audit Messages Appear
**Symptom**: Files are created but no "Tracking:" messages
**Likely Cause**: CompletionTracker LLM client not set or disabled
**Check**: Ensure `completionTracker.setLLMClient()` is called in agent initialization

### 2. Audit Only Runs at End
**Symptom**: Audit messages appear only after final response
**Likely Cause**: Using old code before immediate audit fix
**Fix**: Rebuild with `npm run build`

### 3. Completion Not Blocked
**Symptom**: LLM finishes even with open tasks/items
**Likely Cause**: IncompleteWorkDetector not detecting completion phrases
**Check**: Look for phrases like "done", "complete", "finished" in LLM response

### 4. Audit Messages Not Visible
**Symptom**: Audit runs but messages barely visible
**Likely Cause**: Using interactive mode with dark terminal theme
**Fix**: Audit messages now yellow - check terminal supports color

## Success Criteria

The validator flow is working correctly if:

1. ✅ Audit runs IMMEDIATELY after each file modification (not at end)
2. ✅ Audit messages are VISIBLE (yellow in interactive, formatted in ask mode)
3. ✅ Completion BLOCKED when tasks remain open
4. ✅ Completion BLOCKED when tracking items remain open
5. ✅ LLM FORCED to review and close tracking items before finishing
6. ✅ Loop only ends when ALL work complete

## What Changed

The validator fixes ensure:

- **Immediate Auditing**: Audit after EACH file modification, not just at loop end
- **Visible Output**: Critical messages in yellow (interactive) or formatted headers (ask mode)
- **Task Blocking**: Open tasks prevent completion
- **Tracking Item Blocking**: Open tracking items prevent completion
- **Verbose Logging**: Ask mode logs show full audit details
- **Fail Visibility**: Audit failures surfaced to user, not silent stderr

## Files to Review

After running the test, check these files to verify the flow:

1. **test-validator-output.txt** - Full detailed log with all audits
2. **Terminal output** - Real-time colored feedback
3. **Console errors** - Should see no silent failures

Compare the output to the examples above to confirm validators are working as expected.
