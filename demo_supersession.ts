/**
 * Demonstration of Memory Supersession System
 * This file shows how fact, preference, and decision supersession works
 */

import { LocalMemoryStore } from './src/memory/store.js';

async function demonstrateSupersession() {
  const store = new LocalMemoryStore(process.cwd());

  console.log('=== Memory Supersession Demo ===\n');

  // 1. Fact Supersession
  console.log('1. Fact Supersession:');
  console.log('   Adding: "user prefers VS Code"');
  const fact1 = store.addUserFact({
    fact: 'user prefers VS Code',
    category: 'personal',
    source: 'user message',
    confidence: 0.8,
    lifespan: 'permanent',
  });

  console.log('   Adding: "user prefers Vim" (conflicting)');
  const fact2 = store.addUserFact({
    fact: 'user prefers Vim',
    category: 'personal',
    source: 'user correction',
    confidence: 0.9,
    lifespan: 'permanent',
  });

  // Supersede the old fact
  store.supersedeUserFact(fact1.id, fact2.id);

  console.log('   Current facts:', store.getUserFacts().map(f => f.fact).join(', '));
  console.log('   All facts (including superseded):', store.getAllUserFacts().map(f => `"${f.fact}"${f.supersededBy ? ' (superseded)' : ''}`).join(', '));
  console.log();

  // 2. Preference Supersession
  console.log('2. Preference Supersession:');
  console.log('   Adding: editor = "VS Code"');
  const pref1 = store.addPreference({
    category: 'tooling',
    key: 'editor',
    value: 'VS Code',
    source: 'user message',
    confidence: 0.8,
    lifespan: 'permanent',
  });

  console.log('   Adding: editor = "Neovim" (updated preference)');
  const pref2 = store.addPreference({
    category: 'tooling',
    key: 'editor',
    value: 'Neovim',
    source: 'user update',
    confidence: 0.9,
    lifespan: 'permanent',
  });

  store.supersedePreference(pref1.id, pref2.id);

  console.log('   Current preferences:', store.getPreferences().map(p => `${p.key}=${p.value}`).join(', '));
  console.log('   Preference history:', store.getAllPreferences().map(p => `${p.key}="${p.value}"${p.supersededBy ? ' →' : ''}`).join(' → '));
  console.log();

  // 3. Decision Supersession
  console.log('3. Decision Supersession:');
  console.log('   Adding: "Use React for frontend"');
  const dec1 = store.addDecision({
    description: 'Use React for frontend',
    rationale: 'Team is familiar with it',
    alternatives: ['Vue', 'Angular'],
    category: 'architecture',
  });

  console.log('   Adding: "Use Vue for frontend" (course correction)');
  const dec2 = store.addDecision({
    description: 'Use Vue for frontend',
    rationale: 'Better performance for our use case',
    alternatives: ['React', 'Angular'],
    category: 'architecture',
  });

  store.supersedeDecision(dec1.id, dec2.id);

  console.log('   Current decisions:', store.getDecisions().map(d => d.description).join(', '));
  console.log('   Decision evolution:', store.getAllDecisions().map(d => `"${d.description}"${d.supersededBy ? ' →' : ''}`).join(' → '));
  console.log();

  // 4. Context Generation
  console.log('4. Context Generation (only current values):');
  console.log('   Current facts: ', store.getUserFacts().map(f => f.fact).join(', '));
  console.log('   Current preferences:', store.getPreferences().map(p => `${p.key}=${p.value}`).join(', '));
  console.log('   Current decisions: ', store.getDecisions().map(d => d.description).join(', '));
  console.log();

  // 5. Persistence Test
  console.log('5. Persistence Test:');
  await store.save();
  console.log('   Saved to disk');

  const newStore = new LocalMemoryStore(process.cwd());
  await newStore.load();
  console.log('   Loaded from disk');

  const restoredFacts = newStore.getAllUserFacts();
  console.log('   Restored facts:', restoredFacts.map(f => `"${f.fact}"${f.supersededBy ? ' (superseded)' : ''}`).join(', '));
  console.log();

  console.log('=== Demo Complete ===');
}

// Run the demo
demonstrateSupersession().catch(console.error);
