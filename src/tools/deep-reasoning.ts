// Deep Reasoning Tool - Standalone single-path reasoning engine
// Focuses on expanding thoughts and exploring edge cases in a single deep dive

import { z } from 'zod';
import chalk from 'chalk';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from './types.js';
import type { LLMClient, ChatMessage } from '../llm/types.js';
import { StreamAccumulator } from '../llm/streaming.js';
import { uiState } from '../ui/ui-state.js';

const DeepReasoningSchema = z.object({
  problem: z.string().min(1).describe('The problem or goal to reason about'),
  max_iterations: z.number().int().min(5).max(100).optional().default(15),
  min_iterations: z.number().int().min(0).max(50).optional().default(8),
});

export class DeepReasoningTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'deep_reasoning',
    description: `Perform a deep, single-path reasoning dive to explore a problem in detail. 
Use this for periodic architectural check-ins or when you need to think through a complex implementation step before writing code.`, 
    parameters: {
      type: 'object',
      properties: {
        problem: { type: 'string', description: 'Problem statement or implementation goal' },
        max_iterations: { type: 'number', description: 'Max depth of reasoning', default: 15 },
        min_iterations: { type: 'number', description: 'Min depth of reasoning (enforces expansion)', default: 8 },
      },
      required: ['problem'],
    },
  };

  protected readonly schema = DeepReasoningSchema;

  protected async executeInternal(args: z.infer<typeof DeepReasoningSchema>, context?: ToolExecutionContext): Promise<string> {
    const { problem, max_iterations, min_iterations } = args;
    const llmClient = context?.llmClient;
    const conversation = context?.conversation;

    if (!llmClient) {
      throw new Error('LLM client not available in tool execution context');
    }

    uiState.addMessage({
      role: 'system',
      content: chalk.bold(`\nSTARTING DEEP REASONING SESSION`),
      timestamp: Date.now()
    });

    const messages: ChatMessage[] = [];

    // 1. Extract and push context from conversation history first
    if (conversation) {
      const history = conversation.getMessages()
        .slice(-15)
        .filter((m: any) => m.role === 'user' || m.role === 'assistant')
        .map((m: any) => `${m.role.toUpperCase()}: ${m.content.slice(0, 500)}`)
        .join('\n\n');
      if (history) {
        messages.push({ role: 'system', content: `RECENT CONVERSATION HISTORY:\n${history}` });
      }
    }

    // 2. Push the problem statement
    messages.push({ role: 'user', content: `Problem: ${problem}` });

    // 3. Push the System Prompt / Directives LAST so they are fresh in context
    messages.push({ 
      role: 'system', 
      content: `You are a high-level reasoning engine. Your goal is to explore the provided problem in extreme detail.
Rules:
1. You have NO TOOLS. You are purely thinking.
2. Focus on: structural integrity, edge cases, data flow, and potential regressions.
3. Reach a high depth of reasoning before summarizing.
4. Output your final synthesis only when prompted or when depth is reached.` 
    });

    let currentIteration = 0;    let finalOutput = '';

    while (currentIteration < max_iterations) {
      currentIteration++;
      
      // Inject depth directive
      if (currentIteration <= min_iterations) {
        const directive = currentIteration === min_iterations
          ? `Minimum reasoning depth reached. You may now provide your final summary and implementation plan.`
          : `Continue expanding your reasoning (Iter ${currentIteration}/${min_iterations} min). Look for deeper patterns and subtle risks.`;
        messages.push({ role: 'system', content: `[System] ${directive}` });
      }

      const accumulator = new StreamAccumulator();
      for await (const chunk of llmClient.chatStream(messages, [])) {
        accumulator.addChunk(chunk);
      }

      const response = accumulator.getResponse();
      const content = response.content || '';
      messages.push({ role: 'assistant', content, reasoningContent: response.reasoningContent });

      uiState.addMessage({
        role: 'system',
        content: `[Deep Reasoning][Iter ${currentIteration}] ${content.trim()}`,
        timestamp: Date.now()
      });

      // Break if model is ready and we reached min depth
      const looksLikeConclusion = content.toLowerCase().includes('conclusion') || 
                                 content.toLowerCase().includes('final plan') ||
                                 content.toLowerCase().includes('summary');
      
      if (looksLikeConclusion && currentIteration >= min_iterations) {
        finalOutput = content;
        break;
      }

      if (currentIteration >= max_iterations) {
        finalOutput = content;
      }
    }

    uiState.addMessage({
      role: 'system',
      content: chalk.green(`✓ Deep Reasoning session complete.`),
      timestamp: Date.now()
    });

    return [
      `[Deep Reasoning Results]`,
      `Problem: ${problem}`,
      `Iterations: ${currentIteration}`,
      '',
      `Synthesis:`,
      finalOutput,
      '',
      `SYSTEM: Reasoning complete. Execute the implementation plan now.`
    ].join('\n');
  }
}
