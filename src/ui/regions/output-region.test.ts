class FakeRenderManager {
  output: string[] = [];
  replaceCalls: Array<{ startLine: number; lineCount: number; newContent: string[] }> = [];

  writeOutput(content: string): void {
    this.output.push(content);
  }

  writeOutputInline(content: string): void {
    if (this.output.length === 0) this.output.push('');
    this.output[this.output.length - 1] += content;
  }

  getOutputBufferLength(): number {
    return this.output.length;
  }

  replaceOutputLines(startLine: number, lineCount: number, newContent: string[]): number {
    this.replaceCalls.push({ startLine, lineCount, newContent });
    this.output.splice(startLine, lineCount, ...newContent);
    return startLine;
  }
}

describe('OutputRegion live message tracking', () => {
  it('shifts subsequent live message positions when a live message expands', async () => {
    // Note: chalk is globally mocked for Jest in `src/test/chalk-mock.ts`
    // via `jest.config.mjs` moduleNameMapper.
    const { OutputRegion } = await import('./output-region.js');
    const renderManager = new FakeRenderManager();
    const region = new OutputRegion();
    region.attach(renderManager as any);

    const updateLiveMessage = (region as any).updateLiveMessage.bind(region) as (
      id: string,
      msg: { role: string; content: string; timestamp: number }
    ) => void;

    updateLiveMessage('a', { role: 'system', content: 'one', timestamp: 0 });
    updateLiveMessage('b', { role: 'system', content: 'two', timestamp: 0 });

    updateLiveMessage('a', { role: 'system', content: 'one\nline2', timestamp: 0 });
    updateLiveMessage('b', { role: 'system', content: 'two-updated', timestamp: 0 });

    // The update to 'a' adds a line, so 'b' should shift down by 1 line.
    const lastCall = renderManager.replaceCalls[renderManager.replaceCalls.length - 1];
    expect(lastCall).toEqual({
      startLine: 2,
      lineCount: 1,
      newContent: ['two-updated'],
    });
  });
});
