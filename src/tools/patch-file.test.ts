import { promises as fs } from 'fs';
import path from 'path';
import { PatchFileTool } from './patch-file.js';

async function makeTempDir(): Promise<string> {
  const root = path.join(process.cwd(), 'testbox');
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, 'patch-file-'));
}

describe('PatchFileTool', () => {
  it('patches exact matches and respects expectCount', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'a.txt');
    await fs.writeFile(file, 'hello world\nhello world\n', 'utf-8');

    const tool = new PatchFileTool();
    const result = await tool.execute({
      path: file,
      search: 'hello world',
      replace: 'hello there',
      expectCount: 2,
    });

    expect(result.success).toBe(true);
    const updated = await fs.readFile(file, 'utf-8');
    expect(updated).toBe('hello there\nhello there\n');
  });

  it('handles CRLF/LF mismatches in exact mode by normalizing line endings', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'crlf.txt');
    await fs.writeFile(file, 'a\r\nb\r\nc\r\n', 'utf-8');

    const tool = new PatchFileTool();
    const result = await tool.execute({
      path: file,
      search: 'a\nb\nc\n', // LF search against CRLF file
      replace: 'a\nB\nc\n',
    });

    expect(result.success).toBe(true);
    const updated = await fs.readFile(file, 'utf-8');
    expect(updated).toBe('a\r\nB\r\nc\r\n');
  });

  it('supports matchMode=line for indentation differences', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'code.ts');
    await fs.writeFile(
      file,
      ['function x() {', '  return 1;', '}', ''].join('\n'),
      'utf-8'
    );

    const tool = new PatchFileTool();
    const result = await tool.execute({
      path: file,
      matchMode: 'line',
      search: 'return 1;',
      replace: '  return 2;',
      expectCount: 1,
    });

    expect(result.success).toBe(true);
    const updated = await fs.readFile(file, 'utf-8');
    expect(updated).toBe(['function x() {', '  return 2;', '}', ''].join('\n'));
  });

  it('supports matchMode=fuzzy for near-miss blocks (unambiguous)', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'math.ts');
    await fs.writeFile(
      file,
      ['export function add(a: number, b: number) {', '  return a + b;', '}', ''].join('\n'),
      'utf-8'
    );

    const tool = new PatchFileTool();
    const result = await tool.execute({
      path: file,
      matchMode: 'fuzzy',
      fuzzyThreshold: 0.8,
      search: ['export function add(a:number, b:number) {', '  return a+b;', '}'].join('\n'),
      replace: ['export function add(a: number, b: number) {', '  return a + b + 1;', '}'].join('\n'),
    });

    expect(result.success).toBe(true);
    const updated = await fs.readFile(file, 'utf-8');
    expect(updated).toContain('return a + b + 1;');
  });
});

