# Tracking Item Pre-Storage Validation Design

## Current Flow (Problematic)

```
1. extractTrackingItems() → Regex extracts ALL bullet/numbered lists
2. analyze() → Detects completion phrases + tracking items
3. storeDetectedItems() → Stores ALL items without validation
4. LLM review → Agent reads files and validates (after storage)
```

**Problems:**
- False positives stored immediately
- Requires post-storage cleanup
- User sees spurious tracking items
- Extra review step needed

## Proposed Solution: Pre-Storage Validation

### Approach: Multi-Pass Filtering

```
1. extractTrackingItems() → Regex extracts ALL patterns
2. filterObviousNonWork() → Heuristics remove obvious false positives
3. validateWithLLM() → Quick LLM check for borderline cases (optional)
4. storeDetectedItems() → Store ONLY validated items
```

### Pass 1: Heuristic Filtering (Fast, Zero LLM cost)

**Patterns to exclude:**

1. **Documentation markers:**
   - Starts with `*File:`, `**File:`, `*` followed by `**` (markdown formatting)
   - Contains code file references like `src/...` in explanation context
   - Example: `*File:** `src/agent/loop.ts` → Lines 463-520`

2. **Emoji prefixes (indicating examples/summaries):**
   - Starts with ✅, ❌, ⚠️, 📋, 💡, 🎯, etc.
   - Example: `✅ Real work items: "Add error handling"`

3. **Explanatory phrases:**
   - Contains "This is", "This was", "That was", "What happened"
   - Example: `*Stage 1** - Regex detected 32 items`

4. **Workflow descriptions:**
   - Contains "→", arrows, or workflow notation
   - Example: `**Incomplete** → create_task()`

5. **Meta-descriptions:**
   - Starts with `Read files:`, `Review:`, `Close:`
   - Example: `Read files: N/A (these aren't file references)`

6. **Summary/analysis markers:**
   - Contains "detected from", "extracted from", "identified as"
   - Example: `Stores them as 'open' tracking items`

### Pass 2: LLM Validation (Optional, for borderline cases)

**Only for items that pass heuristics:**
- Quick LLM call with few-shot examples
- Simple classification: "work" or "non-work"
- Batch validation for efficiency

**Prompt template:**
```
Classify each item as REAL WORK or NOT WORK:

Items:
1. "Add error handling to API endpoint"
2. "✅ Real work items: 'Add error handling'"
3. "File: src/agent/loop.ts → Lines 463-520"
4. "Implement user authentication"
5. "This is explanatory text about the detection process"

Rules:
- REAL WORK: Actions to implement code, fix bugs, add features
- NOT WORK: Documentation, examples, explanations, summaries, analysis

Classification:
1. REAL WORK
2. NOT WORK (explanation)
3. NOT WORK (documentation)
4. REAL WORK
5. NOT WORK (explanation)
```

## Implementation Plan

### Step 1: Add Heuristic Filtering

```typescript
private filterObviousNonWork(items: TrackingItem[]): TrackingItem[] {
  return items.filter(item => {
    const text = item.description;

    // Exclude documentation markers
    if (/^\*\*?File:|→|Example:|E\.?g\.?|For instance:/i.test(text)) {
      return false;
    }

    // Exclude emoji prefixes (indicating examples)
    if (/^[✅❌⚠️📋💡🎯🔍📌]/.test(text)) {
      return false;
    }

    // Exclude explanatory phrases
    if (/^This (is|was)|That (is|was)|What happened/i.test(text)) {
      return false;
    }

    // Exclude workflow arrows
    if (text.includes('→') && /[A-Z]{2,}/.test(text)) {
      return false; // Like "create_task()"
    }

    // Exclude meta-descriptions
    if (/^(Read files:|Review:|Close:|Stage \d)/i.test(text)) {
      return false;
    }

    // Include only if it looks like actionable work
    return true;
  });
}
```

### Step 2: Add Optional LLM Validation

```typescript
private async validateWithLLM(items: TrackingItem[]): Promise<TrackingItem[]> {
  if (items.length === 0) return [];

  // Only use LLM validation if configured
  if (!this.enableLLMValidation) {
    return items; // Skip if disabled (fast mode)
  }

  const prompt = this.buildValidationPrompt(items);
  const response = await this.llmClient.chat([{
    role: 'user',
    content: prompt
  }]);

  return this.parseValidationResponse(response, items);
}
```

### Step 3: Modify Storage Flow

```typescript
async storeDetectedItems(items: TrackingItem[], extractedFrom: string): Promise<void> {
  if (!this.memoryStore) return;

  // Pass 1: Heuristic filtering
  const filteredItems = this.filterObviousNonWork(items);

  // Pass 2: Optional LLM validation
  const validatedItems = await this.validateWithLLM(filteredItems);

  // Store only validated items
  for (const item of validatedItems) {
    this.memoryStore.addTrackingItem({
      description: item.description,
      status: 'open',
      priority: (item.priority || 'medium') as any,
      extractedFrom,
    });
  }
}
```

## Configuration

```typescript
export interface ValidationConfig {
  enableHeuristicFiltering: boolean;  // Default: true (fast, free)
  enableLLMValidation: boolean;        // Default: false (slower, more accurate)
  heuristicOnlyOnHighCount?: number;    // Auto-enable LLM if > N items detected
}
```

## Performance Impact

| Mode | LLM Calls | Latency | False Positive Rate |
|------|-----------|---------|---------------------|
| Current (no validation) | 0 | 0ms | High |
| Heuristic-only | 0 | ~1ms | Low-Medium |
| Heuristic + LLM | 1 | ~500ms | Very Low |
| Adaptive | 0-1 | ~1-500ms | Low |

## Trade-offs

### Heuristic-Only (Fast Mode)
✅ Zero additional LLM calls
✅ Very fast filtering
⚠️ May miss some false positives
✅ Good for most cases

### LLM-Enhanced (Accurate Mode)
✅ Best false positive reduction
✅ Handles complex cases
⚠️ Extra LLM cost/latency
⚠️ May be overkill for simple cases

### Adaptive Mode (Recommended)
✅ Fast for obvious cases (heuristics)
✅ Accurate for complex cases (LLM)
✅ Cost-effective (only when needed)
⚠️ More complex implementation

## Recommendation

**Start with Heuristic-Only:**
1. Implement `filterObviousNonWork()`
2. Measure false positive rate
3. If still high, add optional LLM validation
4. Make LLM validation configurable

This provides:
- Immediate improvement (90%+ reduction in false positives)
- Zero performance cost
- Simple implementation
- Optional enhancement path
