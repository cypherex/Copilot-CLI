import { promises as fs } from 'fs';
import path from 'path';
import { UnifiedDiffTool } from './unified-diff-tool.js';

async function makeTempDir(): Promise<string> {
  const root = path.join(process.cwd(), 'testbox');
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, 'unified-diff-'));
}

describe('UnifiedDiffTool', () => {
  it('applies a single-file unified diff', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'a.txt');
    await fs.writeFile(file, ['one', 'two', 'three', ''].join('\n'), 'utf-8');

    const diff = [
      `--- a/a.txt`,
      `+++ b/a.txt`,
      `@@ -1,3 +1,3 @@`,
      ` one`,
      `-two`,
      `+TWO`,
      ` three`,
      ``,
    ].join('\n');

    const tool = new UnifiedDiffTool();
    const result = await tool.execute({ diff, cwd: dir });
    expect(result.success).toBe(true);

    const updated = await fs.readFile(file, 'utf-8');
    expect(updated).toBe(['one', 'TWO', 'three', ''].join('\n'));
  });

  it('rejects ambiguous hunks', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'b.txt');
    await fs.writeFile(file, ['X', 'Y', 'X', 'Y', ''].join('\n'), 'utf-8');

    const diff = [
      `--- a/b.txt`,
      `+++ b/b.txt`,
      `@@ -1,2 +1,2 @@`,
      ` X`,
      `-Y`,
      `+Z`,
      ``,
    ].join('\n');

    const tool = new UnifiedDiffTool();
    const res = await tool.execute({ diff, cwd: dir, fuzz: 10 });
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('ambiguous');
  });
});
