import fs from 'fs';

const filePath = '.benchmark-cache/swe-bench-lite.jsonl';
const content = fs.readFileSync(filePath, 'utf-8');

console.log('Content length:', content.length);
console.log('Character codes at position 200-230:');
for (let i = 200; i < 230 && i < content.length; i++) {
  const code = content.charCodeAt(i);
  const char = content[i];
  if (char === '\n') console.log(`[${i}] = \\n`);
  else if (char === '\r') console.log(`[${i}] = \\r`);
  else console.log(`[${i}] = ${char} (${code})`);
}

const lines = content.split('\n');
console.log('\nTotal lines:', lines.length);

lines.forEach((line, i) => {
  const trimmed = line.trim();
  if (trimmed) {
    console.log(`\nLine ${i+1}:`);
    console.log(`  Length: ${line.length}`);
    console.log(`  Trimmed: ${trimmed.length}`);
    console.log(`  First 50 chars: ${line.substring(0, 50)}`);
    try {
      const parsed = JSON.parse(trimmed);
      console.log(`  Status: ✓ Valid JSON`);
    } catch (e) {
      console.log(`  Status: ✗ JSON Error: ${e.message}`);
    }
  }
});
