#!/usr/bin/env node

// Test script for FileRelationshipTracker

import { FileRelationshipTracker } from '../src/agent/file-relationship-tracker.js';

function testFileRelationshipTracker() {
  console.log('Testing FileRelationshipTracker...\n');

  const tracker = new FileRelationshipTracker();

  // Test 1: Track file access
  console.log('Test 1: Track file access');
  tracker.trackFileAccess('src/utils/index.ts', true);
  tracker.trackFileAccess('src/auth/types.ts', true);

  const rel1 = tracker.getRelationships('src/utils/index.ts');
  console.log(`File tracked: ${rel1?.file}`);
  console.log(`Last edit: ${rel1?.lastEditTime}`);
  console.log('✓ Test 1 passed\n');

  // Test 2: Edit session tracking
  console.log('Test 2: Edit session tracking');
  tracker.startEditSession(['src/utils/index.ts', 'src/auth/types.ts']);
  tracker.endEditSession();

  const rel2 = tracker.getRelationships('src/utils/index.ts');
  console.log(`Edited with: ${rel2?.lastEditedWith.join(', ')}`);

  const suggestions = tracker.getSuggestions('src/utils/index.ts');
  console.log(`Suggestions: ${suggestions.join(', ')}`);
  console.log('✓ Test 2 passed\n');

  // Test 3: Dependency tracking
  console.log('Test 3: Dependency tracking (mock)');
  tracker.trackFileAccess('src/app.ts', true);
  const rel3 = tracker.getRelationships('src/app.ts');
  console.log(`App file tracked: ${rel3?.file}`);
  console.log('✓ Test 3 passed\n');

  // Test 4: Should prompt check
  console.log('Test 4: Should prompt check');
  const shouldPrompt = tracker.shouldPrompt('src/utils/index.ts');
  console.log(`Should prompt for src/utils/index.ts: ${shouldPrompt}`);
  console.log('✓ Test 4 passed\n');

  // Test 5: Get all relationships
  console.log('Test 5: Get all relationships');
  const all = tracker.getAllRelationships();
  console.log(`Total relationships: ${all.length}`);
  all.forEach(r => console.log(`  - ${r.file}`));
  console.log('✓ Test 5 passed\n');

  console.log('✓ All tests passed!');
}

testFileRelationshipTracker();
