import { HookRegistry } from './registry.js';

describe('HookRegistry.execute context propagation', () => {
  test('propagates modifiedMessage to later user:prompt-submit hooks', async () => {
    const registry = new HookRegistry();
    const seen: string[] = [];

    registry.register({
      type: 'user:prompt-submit',
      name: 'modifier',
      priority: 10,
      handler: async () => ({ continue: true, modifiedMessage: 'modified' }),
    });

    registry.register({
      type: 'user:prompt-submit',
      name: 'observer',
      priority: 20,
      handler: async (ctx) => {
        seen.push(String(ctx.userMessage));
        return { continue: true };
      },
    });

    const result = await registry.execute('user:prompt-submit', { userMessage: 'original' });
    expect(result.modifiedMessage).toBe('modified');
    expect(seen).toEqual(['modified']);
  });

  test('propagates modifiedArgs to later tool:pre-execute hooks', async () => {
    const registry = new HookRegistry();
    const seen: any[] = [];

    registry.register({
      type: 'tool:pre-execute',
      name: 'modifier',
      priority: 10,
      handler: async () => ({ continue: true, modifiedArgs: { a: 2 } }),
    });

    registry.register({
      type: 'tool:pre-execute',
      name: 'observer',
      priority: 20,
      handler: async (ctx) => {
        seen.push(ctx.toolArgs);
        return { continue: true };
      },
    });

    const result = await registry.execute('tool:pre-execute', { toolName: 'x', toolArgs: { a: 1 } });
    expect(result.modifiedArgs).toEqual({ a: 2 });
    expect(seen).toEqual([{ a: 2 }]);
  });
});
