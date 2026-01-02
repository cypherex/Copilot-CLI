/**
 * Test script to verify tracking item validation filters false positives
 */

const { IncompleteWorkDetector } = require('./src/agent/incomplete-work-detector.ts');

// Test cases that previously caused false positives
const testCases = [
  {
    name: 'Documentation with file references',
    input: '*File:** `src/agent/incomplete-work-detector.ts` → `extractTrackingItems()`',
    expected: false,
  },
  {
    name: 'Emoji-prefixed examples',
    input: '✅ Real work items: "Add error handling"',
    expected: false,
  },
  {
    name: 'Explanatory text',
    input: 'This is explanatory text, not actual work',
    expected: false,
  },
  {
    name: 'Workflow arrows',
    input: '**Incomplete** → create_task()',
    expected: false,
  },
  {
    name: 'Meta-descriptions',
    input: 'Read files: N/A (these aren\'t file references)',
    expected: false,
  },
  {
    name: 'Real work item',
    input: 'Add error handling to API endpoint',
    expected: true,
  },
  {
    name: 'File path without action',
    input: 'src/agent/loop.ts',
    expected: false,
  },
  {
    name: 'File path with action',
    input: 'Create src/agent/loop.ts',
    expected: true,
  },
  {
    name: 'Stage description',
    input: 'Stage 1 - Regex detection',
    expected: false,
  },
  {
    name: 'Example marker',
    input: 'Example: This is how it works',
    expected: false,
  },
];

console.log('Testing tracking item validation...\n');

const detector = new IncompleteWorkDetector();

// Access the private method via prototype
const filterMethod = detector.__proto__.filterObviousNonWork;

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
  const items = [{ description: test.input, priority: 'medium' as const }];
  const filtered = filterMethod.call(detector, items);

  const result = filtered.length > 0;
  const success = result === test.expected;

  if (success) {
    console.log(`✓ Test ${index + 1}: ${test.name}`);
    passed++;
  } else {
    console.log(`✗ Test ${index + 1}: ${test.name}`);
    console.log(`  Input: "${test.input}"`);
    console.log(`  Expected: ${test.expected}, Got: ${result}`);
    failed++;
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed');
  process.exit(1);
}
