// Paste this into loop.ts around line 183 to see real timing

const ITERATION_DELAY_MS = 35;

while (continueLoop && (this.maxIterations === null || iteration < this.maxIterations)) {
  iteration++;

  const iterationStartTime = Date.now();
  console.log(`\n[TIMING] === Iteration ${iteration} Start ===`);

  // The delay
  if (iteration > 1) {
    const delayStart = Date.now();
    await new Promise(resolve => setTimeout(resolve, ITERATION_DELAY_MS));
    console.log(`[TIMING] Delay: ${Date.now() - delayStart}ms`);
  }

  // Hook
  const hookStart = Date.now();
  if (this.hookRegistry) {
    const iterationResult = await this.hookRegistry.execute('agent:iteration', {
      iteration,
      maxIterations: this.maxIterations ?? Infinity,
    });
    if (!iterationResult.continue) {
      console.log(chalk.yellow('Iteration cancelled by hook.'));
      break;
    }
  }
  console.log(`[TIMING] Hooks: ${Date.now() - hookStart}ms`);

  // Message prep
  const prepStart = Date.now();
  const tools = this.toolRegistry.getDefinitions();
  let messages = this.conversation.getMessages();
  // ... all the message building ...
  console.log(`[TIMING] Message prep: ${Date.now() - prepStart}ms`);

  // LLM CALL - THE BIG ONE
  const llmStart = Date.now();
  for await (const chunk of this.llmClient.chatStream(messages, tools)) {
    // ... streaming ...
  }
  const llmTime = Date.now() - llmStart;
  console.log(`[TIMING] LLM call: ${llmTime}ms 🔥🔥🔥`);

  // Tool execution
  if (response.toolCalls) {
    const toolStart = Date.now();
    await this.executeTools(response.toolCalls);
    console.log(`[TIMING] Tool execution: ${Date.now() - toolStart}ms`);
  }

  console.log(`[TIMING] === Iteration ${iteration} Total: ${Date.now() - iterationStartTime}ms ===\n`);
}
