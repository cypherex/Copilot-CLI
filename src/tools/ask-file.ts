// Ask File Tool - specialized single-file reasoning engine
// Performs a focused deep-dive into a specific file to answer questions

import { z } from 'zod';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import path from 'path';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition, ToolExecutionContext } from './types.js';
import type { LLMClient, ChatMessage } from '../llm/types.js';
import { StreamAccumulator } from '../llm/streaming.js';
import { uiState } from '../ui/ui-state.js';
import { createFilesystemError } from '../utils/filesystem-errors.js';
import { execaBash } from '../utils/bash.js';

const AskFileSchema = z.object({
  path: z.string().describe('Primary file to investigate'),
  question: z.string().describe('What information do you need from this file?'),
  mode: z.enum(['forensic', 'hypothesis']).optional().default('forensic').describe('Investigation mode'),
  hypothesis: z.string().optional().describe('Hypothesis to test (hypothesis mode only)'),
  context_paths: z.array(z.string()).optional().describe('Optional related files for cross-referencing'),
  max_turns: z.number().int().min(2).max(15).optional().default(8),
  min_turns: z.number().int().min(0).max(10).optional().default(3),
});

interface Evidence {
  turn: number;
  type: 'observation' | 'reasoning' | 'verification' | 'disproof';
  content: string;
}

export class AskFileTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'ask_file',
    description: `Perform a forensic deep-dive or hypothesis test on a file.
PREFERRED FOR ANALYSIS: Use this instead of 'read_file' for understanding complex logic, investigating bugs, or exploring large files.
The tool uses an autonomous mini-loop to navigate the file and return distilled insights, keeping the main context lean.
It tracks an 'Evidence Chain' to ensure conclusions are provable and verified.`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Primary file path' },
        question: { type: 'string', description: 'Specific question or extraction goal' },
        mode: { type: 'string', enum: ['forensic', 'hypothesis'], default: 'forensic', description: 'Investigation mode' },
        hypothesis: { type: 'string', description: 'The hypothesis to test (if mode is hypothesis)' },
        context_paths: { type: 'array', items: { type: 'string' }, description: 'Related files for cross-referencing' },
        max_turns: { type: 'number', description: 'Maximum turns (default: 8)', default: 8 },
        min_turns: { type: 'number', description: 'Minimum reasoning depth (default: 3)', default: 3 },
      },
      required: ['path', 'question'],
    },
  };

  protected readonly schema = AskFileSchema;

  protected async executeInternal(args: z.infer<typeof AskFileSchema>, context?: ToolExecutionContext): Promise<string> {
    const { path: filePath, question, mode, hypothesis, context_paths = [], max_turns = 8, min_turns = 3 } = args;
    const llmClient = context?.llmClient;

    if (!llmClient) {
      throw new Error('LLM client not available in tool execution context');
    }

    const absolutePath = path.resolve(filePath);
    
    // Initial metadata check
    let fileInfo = '';
    try {
      const stats = await fs.stat(absolutePath);
      fileInfo = `Size: ${stats.size} bytes, Created: ${stats.birthtime}`;
    } catch (error) {
      throw createFilesystemError(error, absolutePath, 'stat');
    }

    uiState.addMessage({
      role: 'system',
      content: chalk.bold(`\n🕵️ [${mode?.toUpperCase()}] INVESTIGATION: ${filePath}\n${fileInfo}${hypothesis ? `\nHypothesis: ${hypothesis}` : ''}`),
      timestamp: Date.now()
    });

    const messages: ChatMessage[] = [];
    const evidenceChain: Evidence[] = [];
    
    // 1. Context First
    let userPrompt = `Question: ${question}`;
    if (mode === 'hypothesis' && hypothesis) {
      userPrompt = `Test Hypothesis: ${hypothesis}\nContext: ${question}`;
    }
    if (context_paths.length > 0) {
      userPrompt += `\nNote: You may reference these files: ${context_paths.join(', ')}`;
    }
    messages.push({ role: 'user', content: userPrompt });

    // 2. Protocol Last
    const forensicProtocol = `
Protocol:
1. Survey: Understand the primary file's structure.
2. Cross-Reference: Use PEEK(path) or EXECUTE_BASH to examine imports/configs.
3. Navigate: Use targeted searches (grep, awk) to find data.
4. REASON: Perform mandatory reasoning steps to connect observations.
5. Synthesis: Provide the final ANSWER with evidence.
`;

    const hypothesisProtocol = `
Protocol:
1. Requirements: State what evidence would PROVE vs DISPROVE the hypothesis.
2. Search: Actively look for both proving and disproving evidence.
3. Falsification: Specifically use EXECUTE_BASH/PEEK to find counter-examples.
4. Conclude: State if hypothesis is PROVEN, DISPROVEN, or INCONCLUSIVE.
`;

    messages.push({
      role: 'system',
      content: `You are a Forensic File Analyst. 
File: ${filePath}
Metadata: ${fileInfo}
Mode: ${mode}

${mode === 'hypothesis' ? hypothesisProtocol : forensicProtocol}

Rules:
- You MUST reach at least ${min_turns} turns of investigation before answering.
- Document every finding using REASON(thought) or by interpreting command results.
- Be rigorous - don't cherry-pick.

Commands:
- REASON(thought): Document a step in your logical deduction or observation.
- PEEK(path): Quick read of another file (first 100 lines).
- EXECUTE_BASH(command): Run any shell command.
- ANSWER: Your final synthesis and Evidence Summary.`
    });

    let currentTurn = 0;
    let finalSynthesis = '';

    while (currentTurn < max_turns) {
      currentTurn++;
      
      if (currentTurn <= min_turns) {
        messages.push({ role: 'system', content: `[System] Turn ${currentTurn}/${min_turns} (min). Continue exploration.` });
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
        content: `[AskFile][Turn ${currentTurn}] ${content.trim()}`,
        timestamp: Date.now()
      });

      // Track Evidence from REASON calls
      const reasonMatch = content.match(/REASON\(['"]?([\s\S]+?)['"]?\)/i);
      if (reasonMatch) {
        evidenceChain.push({ turn: currentTurn, type: 'reasoning', content: reasonMatch[1] });
      }

      if (content.includes('PEEK')) {
        const match = content.match(/PEEK\(['"]?(.+?)['"]?\)/);
        if (match) {
          const peekPath = match[1];
          try {
            const data = await fs.readFile(path.resolve(peekPath), 'utf-8');
            const lines = data.split('\n');
            const preview = lines.slice(0, 100).join('\n');
            evidenceChain.push({ turn: currentTurn, type: 'observation', content: `Peeked ${peekPath}` });
            messages.push({ role: 'system', content: `[Peek Result: ${peekPath}]:\n${preview}` });
          } catch (err: any) {
            messages.push({ role: 'system', content: `[Peek Error]: ${err.message}` });
          }
        }
      } else if (content.includes('EXECUTE_BASH')) {
        const match = content.match(/EXECUTE_BASH\(['"]?(.+?)['"]?\)/);
        if (match) {
          const command = match[1];
          uiState.addMessage({ role: 'system', content: `[AskFile] Executing: ${command}`, timestamp: Date.now() });
          try {
            const result = await execaBash(command);
            const output = (result.all || result.stdout || result.stderr || '(No output)').slice(0, 8000);
            evidenceChain.push({ turn: currentTurn, type: 'observation', content: `Executed: ${command}` });
            messages.push({ role: 'system', content: `[Command Result]:\n${output}` });
          } catch (err: any) {
            messages.push({ role: 'system', content: `[Command Error]: ${err.message}` });
          }
        }
      } else if (content.includes('ANSWER') || currentTurn === max_turns) {
        if (currentTurn < min_turns) {
          messages.push({ role: 'user', content: `Too early for an answer. Reach turn ${min_turns} by expanding your reasoning.` });
          continue;
        }
        finalSynthesis = content.replace('ANSWER', '').trim();
        break;
      } else {
        messages.push({ role: 'user', content: 'Investigation in progress... use REASON, PEEK, EXECUTE_BASH, or ANSWER.' });
      }
    }

    uiState.addMessage({
      role: 'system',
      content: chalk.green(`✓ Investigation complete. Synthesizing Evidence Chain.`),
      timestamp: Date.now()
    });

    const chainText = evidenceChain.map(e => `${e.turn}. [${e.type.toUpperCase()}] ${e.content}`).join('\n');

    return [
      `[Ask File Results: ${filePath}]`,
      `Mode: ${mode}`,
      `Depth: ${currentTurn} turns`,
      '',
      `Evidence Chain:`,
      chainText || '(No specific evidence steps logged)',
      '',
      `Final Analysis & Synthesis:`,
      finalSynthesis,
      '',
      `SYSTEM: Investigation concluded. Act on the synthesized evidence above.`
    ].join('\n');
  }
}

