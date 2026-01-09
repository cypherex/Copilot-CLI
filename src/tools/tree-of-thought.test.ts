import { TreeOfThoughtTool } from './tree-of-thought.js';

type SubAgentResult = { success: boolean; output: string; toolsUsed?: string[] };

class FakeSubAgentManager {
  private nextId = 1;
  private readonly results = new Map<string, SubAgentResult>();
  readonly spawns: Array<{ id: string; name: string }> = [];

  constructor(private outputs: string[]) {}

  spawn(opts: { name: string }): string {
    const id = `agent-${this.nextId++}`;
    this.spawns.push({ id, name: opts.name });
    const output = this.outputs.shift() ?? '';
    this.results.set(id, { success: true, output, toolsUsed: [] });
    return id;
  }

  async waitAll(agentIds: string[]): Promise<Map<string, SubAgentResult>> {
    return new Map(agentIds.map((id) => [id, this.results.get(id) ?? { success: false, output: '' }]));
  }
}

function goodBranch(branch: number): string {
  return JSON.stringify({
    branch,
    hypothesis: 'Root cause X',
    evidence_to_collect: ['read_file src/a.ts', 'grep_repo "foo("'],
    likely_files: ['src/a.ts'],
    proposed_fix: 'Change foo() to handle null',
    next_experiment: 'Run existing unit test that covers foo(null)',
    expected_observation: 'Test passes after fix',
    decision_rule: 'If foo(null) throws then fix is confirmed',
    verification: ['npm test'],
  });
}

function weakBranch(branch: number): string {
  return JSON.stringify({
    branch,
    hypothesis: 'Maybe X',
    evidence_to_collect: [],
    likely_files: [],
    proposed_fix: '',
    next_experiment: '',
    expected_observation: '',
    decision_rule: '',
    verification: [],
  });
}

function refinement(pass: number): string {
  return JSON.stringify({
    pass,
    refined_focus: `Try experiment pass ${pass}`,
    missing_evidence: ['read_file src/a.ts'],
    risks: ['May break edge case Y'],
    improved_verification: ['npm test'],
  });
}

describe('TreeOfThoughtTool (reflection)', () => {
  it('does not auto-reflect when top branch is strong', async () => {
    const mgr = new FakeSubAgentManager([goodBranch(1), goodBranch(2)]);
    const tool = new TreeOfThoughtTool(mgr as any, undefined, undefined);

    const res = await tool.execute({
      mode: 'diagnose',
      problem: 'Test problem',
      branches: 2,
      require_evidence: true,
    });

    expect(res.success).toBe(true);
    expect(mgr.spawns).toHaveLength(2);
    expect(res.output).toContain('Branches (summary):');
    expect(res.output).not.toContain('Refinement passes:');
  });

  it('auto-reflects when results look weak', async () => {
    const mgr = new FakeSubAgentManager([weakBranch(1), weakBranch(2), refinement(1)]);
    const tool = new TreeOfThoughtTool(mgr as any, undefined, undefined);

    const res = await tool.execute({
      mode: 'diagnose',
      problem: 'Test problem',
      branches: 2,
      require_evidence: true,
    });

    expect(res.success).toBe(true);
    expect(mgr.spawns).toHaveLength(3); // 2 branches + 1 refinement pass
    expect(res.output).toContain('Refinement passes:');
    expect(res.output).toContain('pass 1:');
  });

  it('forces multiple reflection passes when requested', async () => {
    const mgr = new FakeSubAgentManager([goodBranch(1), goodBranch(2), refinement(1), refinement(2)]);
    const tool = new TreeOfThoughtTool(mgr as any, undefined, undefined);

    const res = await tool.execute({
      mode: 'diagnose',
      problem: 'Test problem',
      branches: 2,
      require_evidence: true,
      reflection_passes: 2,
      auto_reflect: false,
    });

    expect(res.success).toBe(true);
    expect(mgr.spawns).toHaveLength(4); // 2 branches + 2 forced passes
    expect(res.output).toContain('pass 1:');
    expect(res.output).toContain('pass 2:');
  });
});

