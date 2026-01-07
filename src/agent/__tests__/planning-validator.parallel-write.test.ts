import { PlanningValidator } from '../planning-validator.js';

describe('PlanningValidator.hasWriteOperationTools (parallel)', () => {
  test('detects direct write tools', () => {
    const v = new PlanningValidator({} as any);
    expect(v.hasWriteOperationTools([{ function: { name: 'create_file', arguments: '{}' } }])).toBe(true);
    expect(v.hasWriteOperationTools([{ function: { name: 'patch_file', arguments: '{}' } }])).toBe(true);
    expect(v.hasWriteOperationTools([{ function: { name: 'apply_unified_diff', arguments: '{}' } }])).toBe(true);
  });

  test('detects write tools inside parallel arguments', () => {
    const v = new PlanningValidator({} as any);
    const args = {
      tools: [
        { tool: 'read_file', parameters: { path: 'src/a.ts' } },
        { tool: 'create_file', parameters: { path: 'src/b.ts', content: 'x' } },
      ],
    };

    expect(v.hasWriteOperationTools([{ function: { name: 'parallel', arguments: JSON.stringify(args) } }])).toBe(true);
  });

  test('does not flag read-only parallel blocks as write operations', () => {
    const v = new PlanningValidator({} as any);
    const args = {
      tools: [
        { tool: 'read_file', parameters: { path: 'src/a.ts' } },
        { tool: 'grep_repo', parameters: { query: 'foo' } },
      ],
    };

    expect(v.hasWriteOperationTools([{ function: { name: 'parallel', arguments: JSON.stringify(args) } }])).toBe(false);
  });
});

