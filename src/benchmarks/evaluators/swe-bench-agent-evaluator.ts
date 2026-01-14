/**
 * SWE-bench Agent Evaluator
 * Uses CopilotAgent directly (in-process) to solve SWE-bench tasks
 * Agent edits files in the Docker-mounted /workspace directory
 * Tests are then run in the Docker container
 */

import * as path from 'path';
import * as fs from 'fs';
import { SWEBenchInstance, SWEBenchResult } from '../types.js';
import { DockerManager } from '../docker/manager.js';

export interface AgentEvaluationConfig {
  timeout_seconds?: number;
  capture_output?: boolean;
  api_key?: string;
  llm_model?: string;
  agent?: any; // CopilotAgent instance
}

export class SWEBenchAgentEvaluator {
  /**
   * Evaluate a task by running the agent to solve it
   * Agent runs directly (in-process) against workspace mounted in Docker container
   */
  static async evaluateWithAgent(
    instance: SWEBenchInstance,
    containerName: string,
    dockerManager: DockerManager,
    config: AgentEvaluationConfig = {}
  ): Promise<SWEBenchResult> {
    const timeout = config.timeout_seconds || 3600;
    const captureOutput = config.capture_output !== false;
    const agent = config.agent;

    console.log(`\n🤖 Running Agent on: ${instance.instance_id}`);

    try {
      const startTime = Date.now();

      if (!agent) {
        return {
          task_id: instance.instance_id,
          dataset: 'swe-bench' as any,
          status: 'failed',
          passed: false,
          error: 'Agent instance not provided to evaluator',
        };
      }

      // Create the problem statement
      const problemStatement = `
Repository: ${instance.repo}
Issue: ${instance.problem_statement}

Your task is to fix this GitHub issue. Use the tools available to:
1. Explore and understand the codebase
2. Identify the root cause
3. Make minimal, targeted code changes
4. Run tests to verify the fix works

Focus on making the fewest changes necessary to resolve the issue.
`.trim();

      // Run the agent against the workspace
      console.log('  Running agent to solve the issue...');
      let agentOutput = '';

      try {
        // Store original cwd
        const originalCwd = process.cwd();

        // Get the mounted workspace path from the agent's basePath or use /workspace
        // The agent should already be initialized with basePath, but set it to workspace mount point
        const workspacePath = agent.basePath || originalCwd;

        // Problem statement with workspace context
        const contextualProblem = `
Repository Root: ${workspacePath}
${problemStatement}

You have access to all files in the repository. Use tools to:
1. Explore the repository structure and understand the codebase
2. Find and analyze the files mentioned in the issue
3. Make targeted changes to fix the problem
4. Test your changes

The repository is located at: ${workspacePath}
`.trim();

        // Run agent with full iterations
        // Note: uiState will track all messages during agent execution
        // The benchmark runner will save the conversation from uiState
        await agent.chat(contextualProblem);
        agentOutput = 'Agent completed successfully';
      } catch (error) {
        console.warn('    Agent encountered an error:', String(error).substring(0, 100));
        agentOutput = String(error);
      }

      // Step 2: Extract patch from agent's work
      console.log('  Extracting patch from agent modifications...');
      const generatedPatch = await this.extractPatchFromWork(
        containerName,
        instance,
        dockerManager
      );

      if (!generatedPatch) {
        console.log('    ⚠️  No files were modified by agent');
        return {
          task_id: instance.instance_id,
          dataset: 'swe-bench' as any,
          status: 'completed',
          passed: false,
          verification_passed: false,
          time_seconds: (Date.now() - startTime) / 1000,
          test_output: 'Agent did not modify any files',
        };
      }

      // Step 3: Run tests to verify the fix
      console.log('  Running tests to verify the fix...');
      const testResult = await this.runTests(
        containerName,
        instance,
        dockerManager,
        timeout
      );

      const duration = (Date.now() - startTime) / 1000;
      const passed = testResult.exitCode === 0;

      return {
        task_id: instance.instance_id,
        dataset: 'swe-bench' as any,
        status: 'completed',
        passed,
        verification_passed: passed,
        time_seconds: duration,
        test_output: captureOutput ? testResult.output : undefined,
      };
    } catch (error) {
      return {
        task_id: instance.instance_id,
        dataset: 'swe-bench' as any,
        status: 'failed',
        passed: false,
        error: String(error),
      };
    }
  }

  /**
   * Extract patch from agent's file modifications via git diff
   */
  private static async extractPatchFromWork(
    containerName: string,
    instance: SWEBenchInstance,
    dockerManager: DockerManager
  ): Promise<string | null> {
    try {
      // Get diff from current state vs base commit
      const diffResult = await dockerManager.executeInContainer(
        containerName,
        `cd /workspace && git diff ${instance.base_commit}`,
        60
      );

      if (!diffResult.stdout || diffResult.stdout.trim().length === 0) {
        return null;
      }

      return diffResult.stdout;
    } catch (error) {
      console.error('Error extracting patch:', error);
      return null;
    }
  }

  /**
   * Run tests to verify the fix
   */
  private static async runTests(
    containerName: string,
    instance: SWEBenchInstance,
    dockerManager: DockerManager,
    timeout: number
  ): Promise<{ exitCode: number; output: string }> {
    try {
      const testCommand = this.getTestCommand(instance.repo);
      const timeoutWrappedCommand = `cd /workspace && timeout ${Math.floor(timeout * 0.1)} ${testCommand}`;

      const result = await dockerManager.executeInContainer(
        containerName,
        timeoutWrappedCommand,
        Math.floor(timeout * 0.1)
      );

      return {
        exitCode: result.exitCode,
        output: result.stdout + '\n' + result.stderr,
      };
    } catch (error) {
      return {
        exitCode: 1,
        output: String(error),
      };
    }
  }

  /**
   * Get test command for repo
   */
  private static getTestCommand(repo: string): string {
    const commands: Record<string, string> = {
      'django/django': 'python manage.py test --keepdb 2>&1 | head -500',
      'pallets/flask': 'python -m pytest tests/ -x',
      'psf/requests': 'python -m pytest tests/ -x',
      'mitsuhiko/click': 'python -m pytest tests/ -x',
      'scikit-learn/scikit-learn': 'python -m pytest sklearn/ -x',
    };

    return commands[repo] || 'python -m pytest . -x --tb=short';
  }
}
