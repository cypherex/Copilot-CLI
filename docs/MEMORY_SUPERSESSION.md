# Memory Supersession System

## Overview

The Memory Supersession System is a feature in the Copilot CLI that enables intelligent tracking of how facts, preferences, and decisions evolve over time. When a user corrects information or when the system makes a course correction, the old value is superseded by the new value while maintaining a complete history.

## Key Concepts

### Supersession

Supersession is the process of marking an existing memory item as "replaced" by a newer version, while keeping the old version in history. This enables:

- **Conflict Resolution**: Handle user corrections gracefully
- **Decision Evolution**: Track architecture/approach changes
- **Preference Changes**: Monitor user preference updates
- **Audit Trail**: Keep full history for context and learning

### Supersession Chain

When an item is superseded multiple times, a chain is formed:
```
Original Item → Superseded By → Superseded By → Current Item
```

Each item in the chain contains:
- `supersededBy`: ID of the item that superseded it
- `supersededAt`: Timestamp when supersession occurred

## Features

### 1. User Fact Supersession

Facts about the user can be superseded when conflicting information is detected.

**Example:**
```
User says: "I prefer VS Code"
→ Fact stored: "user prefers VS Code"

User says: "Actually, I prefer Vim"
→ Old fact superseded, new fact stored: "user prefers Vim"
```

**API:**
```typescript
// Add and supersede facts
const fact1 = store.addUserFact({
  fact: 'user prefers VS Code',
  category: 'personal',
  confidence: 0.8,
  lifespan: 'permanent',
});

const fact2 = store.addUserFact({
  fact: 'user prefers Vim',
  category: 'personal',
  confidence: 0.9,
  lifespan: 'permanent',
});

store.supersedeUserFact(fact1.id, fact2.id);

// Get current facts (excludes superseded)
const currentFacts = store.getUserFacts(); // Returns only fact2

// Get all facts including history
const allFacts = store.getAllUserFacts(); // Returns fact1 (superseded) and fact2
```

### 2. Preference Supersession

Preferences are automatically superseded when a preference with the same key is updated.

**Example:**
```
User says: "I always use VS Code"
→ Preference stored: editor = "VS Code"

User says: "I've switched to Neovim"
→ Old preference superseded, new preference stored: editor = "Neovim"
```

**API:**
```typescript
// Add and supersede preferences
const pref1 = store.addPreference({
  category: 'tooling',
  key: 'editor',
  value: 'VS Code',
  confidence: 0.8,
  lifespan: 'permanent',
});

const pref2 = store.addPreference({
  category: 'tooling',
  key: 'editor',
  value: 'Neovim',
  confidence: 0.9,
  lifespan: 'permanent',
});

store.supersedePreference(pref1.id, pref2.id);

// Get current preferences
const currentPrefs = store.getPreferences(); // Returns only pref2

// Get preference by key
const editorPref = store.getPreferenceByKey('tooling', 'editor'); // Returns pref2

// Get all preferences including history
const allPrefs = store.getAllPreferences(); // Returns pref1 (superseded) and pref2
```

### 3. Decision Supersession

Architectural and implementation decisions can be superseded when course corrections are made.

**Example:**
```
System decides: "Use React for frontend"
→ Decision stored

Later: "Vue would be better for this use case"
→ Old decision superseded, new decision stored: "Use Vue for frontend"
```

**API:**
```typescript
// Add and supersede decisions
const dec1 = store.addDecision({
  description: 'Use React for frontend',
  category: 'architecture',
  rationale: 'Team is familiar with it',
});

const dec2 = store.addDecision({
  description: 'Use Vue for frontend',
  category: 'architecture',
  rationale: 'Better performance for our use case',
});

store.supersedeDecision(dec1.id, dec2.id);

// Get current decisions
const currentDecisions = store.getDecisions(); // Returns only dec2

// Get decision by ID
const decision = store.getDecisionById(dec2.id); // Returns dec2

// Get all decisions including history
const allDecisions = store.getAllDecisions(); // Returns dec1 (superseded) and dec2
```

## Automatic Supersession Detection

### Conflict Detection

The ConversationManager automatically detects potential conflicts and triggers supersession:

1. **User Facts**: Checks if a new fact conflicts with existing facts in the same category
2. **Preferences**: Automatically supersedes when updating a preference with the same key
3. **Decisions**: Detects when a new decision supersedes an existing one in the same category

### Correction Patterns

The ContextExtractor identifies user corrections using pattern matching:

```typescript
// Patterns detected:
- "not X, use Y"
- "change from X to Y"
- "I meant X"
- "actually, Y"
- "instead of X, do Y"
```

When a correction is detected, the system can automatically supersede the relevant item.

## Persistence

All supersession information is persisted to disk and restored on session resumption:

```typescript
// Save memory with supersession data
await store.save();

// Load memory and restore supersession chains
const newStore = new LocalMemoryStore(projectPath);
await newStore.load();

// Supersession information is preserved
const allFacts = newStore.getAllUserFacts();
const oldFact = allFacts.find(f => f.id === fact1.id);
console.log(oldFact?.supersededBy); // ID of fact2
console.log(oldFact?.supersededAt); // Timestamp
```

## Context Generation

When generating context for the LLM, only **current (non-superseded)** items are included:

```typescript
// getCurrentContext includes only current values
- Current facts only (excludes superseded)
- Current preferences only (excludes superseded)
- Current decisions only (excludes superseded)
```

This ensures the LLM always works with the most up-to-date information while the system maintains a complete history for analysis.

## Use Cases

### 1. User Preference Evolution
Track how user preferences change over time and adapt behavior accordingly:
```
User: "I use tabs for indentation"
→ Preference: style.indentation = "tabs"

User: "Actually, let's use 2 spaces instead"
→ Preference superseded: style.indentation = "2 spaces"
```

### 2. Architecture Decisions
Maintain a history of architectural decisions and course corrections:
```
Decision: Use PostgreSQL
↓ (changed requirements)
Decision: Use MongoDB
↓ (performance issues)
Decision: Use PostgreSQL with caching layer
```

### 3. Fact Correction
Handle user corrections gracefully:
```
User: "I'm a junior developer"
→ Fact stored

User: "Actually, I'm a senior developer now"
→ Old fact superseded, confidence boosted for new fact
```

### 4. Learning from Supersession Patterns

The system can analyze supersession patterns to:
- Identify areas where user preferences are unstable
- Detect when initial decisions are frequently changed
- Improve conflict detection accuracy
- Learn to ask clarifying questions when conflicts are likely

## Implementation Details

### Type Definitions

```typescript
interface UserFact {
  id: string;
  fact: string;
  category: string;
  confidence: number;
  source: string;
  lifespan: 'session' | 'project' | 'permanent';
  timestamp: Date;
  lastReinforced?: Date;
  supersededBy?: string;      // ID of fact that superseded this
  supersededAt?: Date;        // When supersession occurred
}

interface UserPreference {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  lifespan: 'session' | 'project' | 'permanent';
  timestamp: Date;
  lastReinforced?: Date;
  supersededBy?: string;      // ID of preference that superseded this
  supersededAt?: Date;        // When supersession occurred
}

interface Decision {
  id: string;
  description: string;
  category?: string;
  rationale?: string;
  alternatives?: string[];
  relatedFiles?: string[];
  timestamp: Date;
  supersededBy?: string;      // ID of decision that superseded this
  supersededAt?: Date;        // When supersession occurred
}
```

### Store Methods

```typescript
class LocalMemoryStore {
  // Fact supersession
  supersedeUserFact(id: string, newFactId: string): void;
  getUserFacts(): UserFact[];           // Current only
  getAllUserFacts(): UserFact[];        // Including superseded

  // Preference supersession
  supersedePreference(id: string, newPrefId: string): void;
  getPreferences(): UserPreference[];   // Current only
  getAllPreferences(): UserPreference[];// Including superseded
  getPreferenceByKey(category: string, key: string): UserPreference | undefined;

  // Decision supersession
  supersedeDecision(id: string, newDecisionId: string): void;
  getDecisions(): Decision[];           // Current only
  getAllDecisions(): Decision[];        // Including superseded
  getDecisionById(id: string): Decision | undefined;
}
```

## Demo

Run the supersession demo to see the system in action:

```bash
npx tsx demo_supersession.ts
```

This demonstrates:
1. Fact supersession with conflict detection
2. Preference supersession with history tracking
3. Decision supersession with evolution chains
4. Context generation using only current values
5. Persistence and restoration of supersession data

## Benefits

1. **Accurate Context**: LLM always receives current, accurate information
2. **Historical Awareness**: System maintains awareness of how context evolved
3. **User Control**: User corrections are tracked and respected
4. **Decision Transparency**: Full history of decisions and course corrections
5. **Learning Opportunity**: Pattern analysis improves conflict detection over time
