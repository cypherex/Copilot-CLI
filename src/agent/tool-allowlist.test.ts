import { filterToolDefinitions, isToolAllowed } from './tool-allowlist.js';

describe('tool allowlist', () => {
  test('allows all tools when allowlist is undefined', () => {
    expect(isToolAllowed('create_file')).toBe(true);
    expect(filterToolDefinitions([{ name: 'a' } as any, { name: 'b' } as any])).toHaveLength(2);
  });

  test('allows no tools when allowlist is empty array', () => {
    expect(isToolAllowed('read_file', [])).toBe(false);
    expect(filterToolDefinitions([{ name: 'a' } as any, { name: 'b' } as any], [])).toHaveLength(0);
  });

  test('filters tool definitions to allowlist', () => {
    const defs = [{ name: 'read_file' }, { name: 'create_file' }, { name: 'grep_repo' }] as any[];
    const filtered = filterToolDefinitions(defs, ['read_file', 'grep_repo']);
    expect(filtered.map(d => d.name)).toEqual(['read_file', 'grep_repo']);
  });

  test('denies tools not in allowlist', () => {
    expect(isToolAllowed('patch_file', ['read_file'])).toBe(false);
    expect(isToolAllowed('read_file', ['read_file'])).toBe(true);
  });
});
