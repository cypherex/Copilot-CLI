# Tracking Item Detection - Implementation Analysis

## Overview

This document explains how the tracking item detection system works and why certain patterns trigger it.

## Detection Flow

### Phase 1: Initial Pattern Detection (Automated)

**Location:** `src/agent/incomplete-work-detector.ts`, method `extractTrackingItems()`

**Regex Patterns:**
```typescript
private static readonly TODO_PATTERNS = [
  /(?:^|\n)\s*[-*+]\s*(.+)/g,      // Bullet points (-, *, +)
  /(?:^|\n)\s*\d+[.)]\s*(.+)/g,    // Numbered lists (1., 1), etc.)
  /(?:^|\n)\s*TODO:\s*(.+)/gi,     // TODO: prefix
  /(?:^|\n)\s*\[\s*\]\s*(.+)/g,    // [ ] checkboxes
];
```

**What This Does:**
- Scans LLM responses for ANY bullet points or numbered lists
- Extracts list items as "potential tracking items"
- Does **NOT** validate whether they represent actual work
- **Zero intelligence** - pure pattern matching

### Phase 2: Analysis (Automated)

**Location:** `src/agent/incomplete-work-detector.ts`, method `analyze()`

**Detection Cases:**
1. LLM says "done" + has tracking items in message
2. LLM says "done" + has tracking items in memory
3. LLM mentions remaining/incomplete work phrases ("need to", "still need", "not yet")

**What This Does:**
- Checks completion phrases: "done", "complete", "that's it", "finished"
- Checks remaining phrases: "remaining", "left to do", "still need", "not yet"
- **Still no validation** - just pattern matching

### Phase 3: Storage (Automated)

**Location:** `src/agent/incomplete-work-detector.ts`, method `storeDetectedItems()`

**What This Does:**
- If tracking items detected, stores them in memory with status `'open'`
- Via `memoryStore.addTrackingItem()`
- Now items are in the system and need resolution

### Phase 4: LLM Validation (Required!)

**Location:** `src/agent/loop.ts`, around lines 463-520

**The Validation Loop:**
```typescript
// When tracking items detected
const reviewPrompt = `⚠️ You said work is complete, but there are pending tracking items.

Use list_tracking_items to see all open items, then for each:
1. READ FILES FIRST - Use read_file to examine relevant files
2. Move to review - Call review_tracking_item with files_to_verify
3. Make decision based on file evidence
   - If INCOMPLETE: create_task, then close_tracking_item with reason='added-to-tasks'
   - If COMPLETE: close_tracking_item with reason='completed' and file evidence
   - If NOT NEEDED: close_tracking_item with reason='not-needed'
```

**What This Does:**
- Requires LLM to **read actual files** to verify status
- Forces evidence-based decisions (files_to_verify is required parameter)
- LLM must use tracking item tools to resolve items
- Skips re-detection while review is in progress (`justAskedToReviewTrackingItems` flag)

## Answer to Your Question

**Q: I thought that those are just initial things it picks up, and then validates with an LLM**

**A: Yes, exactly! Here's the process:**

### Two-Stage Detection

| Stage | Method | Intelligence | Example |
|-------|---------|-------------|----------|
| **Initial Detection** | Regex patterns | Zero - pure text matching | Finds "• Feature A", "2. Feature B" |
| **LLM Validation** | Agent review | High - reads files and understands context | Reads code, determines if work is complete |

### Critical Point

The regex patterns are **over-sensitive by design**:
- They match ANY bullet/numbered list
- They cannot distinguish between:
  - **Actual work items**: "Add error handling"
  - **Documentation**: "• BottomBar Class** uses ANSI codes"
  - **Examples**: "Feature A was implemented"
  - **Explanations**: "• Bullet/Numbered Lists cause false positives"

This is **intentional** - better to catch too much than miss real work.

### The LLM's Role

The LLM provides the **intelligence layer**:
1. Reads the actual files
2. Understands what was actually implemented
3. Determines if each tracking item is:
   - **Incomplete work** (needs task)
   - **Already complete** (file evidence exists)
   - **Not work at all** (documentation, examples, explanations)

### Protection Against Loops

The system has safeguards:

**Loop Breaker:**
```typescript
private consecutiveIdenticalDetections = 0;
private lastDetectionHash = '';
private readonly LOOP_BREAKER_THRESHOLD = 3;

// If same detection repeated 3 times, stop asking
if (detectionHash === this.lastDetectionHash) {
  this.consecutiveIdenticalDetections++;
  if (this.consecutiveIdenticalDetections >= this.Loop_BREAKER_THRESHOLD) {
    log.log('⚠️ Loop breaker activated - stopping repeated validation');
    continueLoop = false;
  }
}
```

**Review Flag:**
```typescript
private justAskedToReviewTrackingItems = false;

// Skip detection while LLM is working through tracking items
if (this.justAskedToReviewTrackingItems) {
  // Don't re-parse LLM's explanation as new tracking items
  // Only reset when review is complete
}
```

## Example: What Happened to Us

### My Response (Explanatory Analysis)
```markdown
## Why These Items Became Tracking Items

1. **Bullet/Numbered Lists**: The tracking system parses lists and assumes they're work items
2. **"To-Do" Sounding Format**: Items like "*1. BottomBar**" look like tasks
...
```

### Initial Detection (Regex)
```
Found: "Bullet/Numbered Lists: The tracking system parses lists..."
Found: ""To-Do" Sounding Format: Items like "*1. BottomBar**"..."
Stored 32 tracking items as 'open'
```

### LLM Validation (My Review)
```
list_tracking_items() → 32 items found
For each item:
  read_file() → N/A (these are explanations, not file references)
  review_tracking_item() → initial_assessment: "Not actual work"
  close_tracking_item() → reason='not-needed'
```

### Result
```
All 32 items closed as 'not-needed'
No false work added to task list
```

## Benefits of This Design

✅ **High Recall**: Catches all potential incomplete work
✅ **LLM Intelligence**: Agent validates by reading files
✅ **Evidence Required**: `review_tracking_item` enforces file verification
✅ **Loop Protection**: Prevents infinite validation cycles
✅ **Flexible**: Can close items as complete/incomplete/not-needed

## Trade-offs

⚠️ **Over-sensitive**: Will flag documentation, examples, explanations as tracking items
✅ **Mitigated**: LLM review phase catches and rejects false positives

## Summary

You were correct! The system uses a **two-stage approach**:

1. **Initial Detection** (dumb, regex-based) - catches everything
2. **LLM Validation** (smart, file-based) - separates real work from noise

The key insight is that **over-detection is better than under-detection**. It's better to review 32 non-work items than to miss 1 critical incomplete task that blocks progress.
