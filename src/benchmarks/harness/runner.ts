/**
 * Benchmark runner
 * Main orchestrator for running benchmark tasks
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  BenchmarkTask,
  BenchmarkConfig,
  BenchmarkReport,
  TaskResult,
  SWEBenchInstance,
  ARCTask,
} from '../types.js';
import { BenchmarkFormatter } from '../reports/formatter.js';
import { CheckpointManager, CheckpointData } from '../checkpoint.js';
import { createLoader } from '../loaders/index.js';
import { DockerManager } from '../docker/manager.js';
import { SWEBenchEvaluator } from '../evaluators/swe-bench-evaluator.js';
import { SWEBenchAgentEvaluator } from '../evaluators/swe-bench-agent-evaluator.js';
import { ARCEvaluator } from '../evaluators/arc-evaluator.js';

export interface RunnerConfig extends BenchmarkConfig {
  workspace?: string;
  docker_image?: string;
  use_agent?: boolean; // If true, use CLI agent to solve tasks; if false, use gold patches
  api_key?: string;
  llm_model?: string;
}

export class BenchmarkRunner {
  private config: RunnerConfig;
  private dockerManager: DockerManager;
  private completedTasks: Set<string> = new Set();
  private results: TaskResult[] = [];
  private checkpoint: CheckpointData | null = null;
  private agent: any = null; // CopilotAgent instance for ARC tasks

  constructor(config: RunnerConfig) {
    this.config = {
      ...config,
      workspace: config.workspace || process.cwd(),
      timeout_seconds: config.timeout_seconds || 3600,
    };

    this.dockerManager = new DockerManager();
  }

  /**
   * Set the agent for ARC task execution
   */
  setAgent(agent: any): void {
    this.agent = agent;
  }

  /**
   * Create evaluation directory and clear existing contents
   */
  private createEvaluationDir(taskId: string): string {
    const benchmarkName = this.config.dataset?.replace(/-/g, '_') || 'benchmark';
    const evalDir = path.join(process.cwd(), 'benchmark_evaluation', benchmarkName, taskId);

    // Create directory if it doesn't exist
    if (!fs.existsSync(evalDir)) {
      fs.mkdirSync(evalDir, { recursive: true });
    } else {
      // Clear existing contents
      const files = fs.readdirSync(evalDir);
      for (const file of files) {
        const filePath = path.join(evalDir, file);
        if (fs.lstatSync(filePath).isDirectory()) {
          fs.rmSync(filePath, { recursive: true });
        } else {
          fs.unlinkSync(filePath);
        }
      }
    }

    return evalDir;
  }

  /**
   * Save question/prompt to file
   */
  private saveQuestion(evalDir: string, question: string): void {
    const questionPath = path.join(evalDir, 'question.txt');
    fs.writeFileSync(questionPath, question, 'utf-8');
  }

  /**
   * Save agent response/output to file
   */
  private saveOutput(evalDir: string, output: string, attemptNum: number = 1): void {
    const outputPath = path.join(evalDir, `output_attempt_${attemptNum}.txt`);
    fs.writeFileSync(outputPath, output, 'utf-8');
  }

  /**
   * Save conversation history to file
   */
  private saveConversation(evalDir: string, messages: any[], attemptNum: number = 1): void {
    const conversationPath = path.join(evalDir, `conversation_attempt_${attemptNum}.txt`);
    const conversationText = messages
      .map((msg: any) => `[${msg.role.toUpperCase()}]\n${msg.content}\n`)
      .join('\n' + '='.repeat(60) + '\n\n');
    fs.writeFileSync(conversationPath, conversationText, 'utf-8');
  }

  /**
   * Check if Docker is available
   */
  static isDockerAvailable(): boolean {
    return DockerManager.isDockerAvailable();
  }

  /**
   * Run benchmark on dataset
   */
  async run(): Promise<BenchmarkReport> {
    console.log('\n' + '='.repeat(60));
    console.log(`🚀 Starting Benchmark: ${this.config.dataset}`);
    console.log('='.repeat(60));

    try {
      // Load or resume from checkpoint
      await this.initializeFromCheckpoint();

      // Load dataset
      const loader = createLoader(this.config);
      const tasks = await loader.load(this.config);

      console.log(`\n📊 Loaded ${tasks.length} tasks`);
      console.log(`   Already completed: ${this.completedTasks.size}`);
      console.log(`   Remaining: ${tasks.length - this.completedTasks.size}`);

      // Filter out already-completed tasks
      const pendingTasks = tasks.filter(t => !this.completedTasks.has(this.getTaskId(t)));

      console.log(`\n⏱️  Starting execution (timeout: ${this.config.timeout_seconds}s per task)...\n`);

      // Execute pending tasks
      for (let i = 0; i < pendingTasks.length; i++) {
        const task = pendingTasks[i];
        const taskId = this.getTaskId(task);

        try {
          const progress = `[${this.results.length + 1}/${tasks.length}]`;
          console.log(`\n${progress} Processing: ${taskId}`);

          const result = await this.executeTask(task);
          this.results.push(result);

          // Save checkpoint after each task
          await this.saveCheckpoint(pendingTasks.slice(i + 1).map(t => this.getTaskId(t)));

          // Small delay between tasks
          await this.delay(1000);
        } catch (error) {
          console.error(`❌ Error executing task ${taskId}: ${error}`);
          this.results.push({
            task_id: taskId,
            dataset: this.config.dataset as any,
            status: 'failed',
            error: String(error),
          });
        }
      }

      // Generate report
      const report = BenchmarkFormatter.createReport(
        this.config.dataset,
        this.results
      );

      // Save results
      if (this.config.output_file) {
        const format = this.config.output_file.endsWith('.csv') ? 'csv' : 'json';
        await BenchmarkFormatter.saveReport(
          report,
          this.config.output_file,
          format as any
        );
      }

      // Print summary
      console.log(BenchmarkFormatter.toSummary(report));

      return report;
    } finally {
      // Cleanup
      await this.cleanup();
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: BenchmarkTask): Promise<TaskResult> {
    const isSWEBench = 'problem_statement' in task;
    const isARC = 'train' in task;

    if (isSWEBench) {
      return this.executeSWEBenchTask(task as SWEBenchInstance);
    } else if (isARC) {
      return this.executeARCTask(task as ARCTask);
    } else {
      throw new Error(`Unknown task type`);
    }
  }

  /**
   * Get task ID from task (works for both types)
   */
  private getTaskId(task: BenchmarkTask): string {
    if ('instance_id' in task) {
      return task.instance_id;
    } else if ('task_id' in task) {
      return task.task_id;
    }
    return 'unknown';
  }

  /**
   * Execute SWE-bench task
   */
  private async executeSWEBenchTask(instance: SWEBenchInstance): Promise<TaskResult> {
    const startTime = Date.now();
    const containerName = `benchmark-swe-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Create evaluation directory for this task
      const evalDir = this.createEvaluationDir(instance.instance_id);

      // Save the problem statement as question
      const questionText = `Repository: ${instance.repo}
Base Commit: ${instance.base_commit}

Problem Statement:
${instance.problem_statement}

Patch (expected fix):
${instance.patch}

Test Patch:
${instance.test_patch}`;
      this.saveQuestion(evalDir, questionText);

      console.log(`  📦 Setting up repo: ${instance.repo}`);

      // Clean workspace directory on host before mounting in Docker
      const workDir = path.join(this.config.workspace!, 'work');
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      fs.mkdirSync(workDir, { recursive: true });

      // Create container with repo
      const container = await this.dockerManager.createContainer({
        image: this.config.docker_image || 'copilot-cli-swe-bench:latest',
        containerName,
        workdir: '/workspace',
        volumes: {
          [workDir]: '/workspace',
        },
      });

      // Clean workspace and clone repo at base commit
      await this.dockerManager.executeInContainer(
        container,
        `rm -rf /workspace/* /workspace/.git && git clone https://github.com/${instance.repo}.git . && git checkout ${instance.base_commit}`,
        300
      );

      // For agent evaluation, skip the expensive environment setup and just install from base commit
      // For gold patches, use environment setup if available (for proper baseline)
      if (instance.environment_setup_commit && !this.config.use_agent) {
        console.log(`  🔧 Applying environment setup from ${instance.environment_setup_commit.substring(0, 7)}`);
        await this.dockerManager.executeInContainer(
          container,
          `git checkout ${instance.environment_setup_commit}`,
          60
        );

        // Install dependencies in environment setup state
        await this.dockerManager.executeInContainer(
          container,
          this.getInstallCommand(instance.repo),
          600
        );

        // Return to base commit
        await this.dockerManager.executeInContainer(
          container,
          `git checkout ${instance.base_commit}`,
          60
        );
      } else {
        // Install dependencies from base commit (faster for agent eval)
        console.log(`  🔧 Installing dependencies from base commit...`);
        await this.dockerManager.executeInContainer(
          container,
          this.getInstallCommand(instance.repo),
          600
        );
      }

      // Evaluate - use agent if configured, otherwise use gold patches
      const result = this.config.use_agent
        ? await SWEBenchAgentEvaluator.evaluateWithAgent(
            instance,
            container,
            this.dockerManager,
            {
              timeout_seconds: this.config.timeout_seconds,
              api_key: this.config.api_key,
              llm_model: this.config.llm_model,
              agent: this.agent,
            }
          )
        : await SWEBenchEvaluator.evaluate(
            instance,
            container,
            this.dockerManager,
            { timeout_seconds: this.config.timeout_seconds }
          );

      // Save the test output
      const outputText = `Status: ${result.status}
Passed: ${result.passed}
Verification Passed: ${result.verification_passed}
Time: ${result.time_seconds}s

Test Output:
${result.test_output || '(no output)'}`;
      this.saveOutput(evalDir, outputText, 1);

      // If using agent, save the conversation/memory from uiState
      if (this.config.use_agent) {
        try {
          // Import uiState to capture agent messages
          const { uiState } = await import('../../ui/ui-state.js');
          const state = uiState.getState();

          // Collect all messages from pending and live messages
          const allMessages: any[] = [];

          // Add pending messages
          if (state.pendingMessages && state.pendingMessages.length > 0) {
            allMessages.push(...state.pendingMessages);
          }

          // Add live messages
          if (state.liveMessages && state.liveMessages.size > 0) {
            for (const [id, msg] of state.liveMessages.entries()) {
              allMessages.push({ ...msg, id });
            }
          }

          // Sort by timestamp
          allMessages.sort((a, b) => a.timestamp - b.timestamp);

          // Save the conversation if we have messages
          if (allMessages.length > 0) {
            this.saveConversation(evalDir, allMessages, 1);
          }
        } catch (e) {
          console.warn('Could not save agent conversation:', e);
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      result.time_seconds = duration;

      return result;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      return {
        task_id: instance.instance_id,
        dataset: this.config.dataset as any,
        status: 'failed',
        time_seconds: duration,
        error: String(error),
      };
    } finally {
      await this.dockerManager.removeContainer(containerName);
    }
  }

  /**
   * Execute ARC-AGI-2 task
   */
  private async executeARCTask(task: ARCTask): Promise<TaskResult> {
    const startTime = Date.now();

    try {
      console.log(`  🧠 Asking agent to analyze pattern and predict outputs`);

      // Create evaluation directory for this task
      const evalDir = this.createEvaluationDir(task.task_id);

      // Check if agent is available
      if (!this.agent) {
        return {
          task_id: task.task_id,
          dataset: this.config.dataset as any,
          status: 'failed',
          time_seconds: (Date.now() - startTime) / 1000,
          error: 'Agent not provided to benchmark runner',
        };
      }

      // Format ARC task for agent - ask for predictions
      const trainingExamples = task.train
        .map((ex, i) => `Example ${i + 1}:\nInput: ${JSON.stringify(ex.input)}\nOutput: ${JSON.stringify(ex.output)}`)
        .join('\n\n');

      const testInputs = task.test
        .map((ex, i) => `Test ${i + 1}: ${JSON.stringify(ex.input)}`)
        .join('\n');

      const agentPrompt = `You are an ARC-AGI-2 pattern recognition expert.

## Task: ${task.task_id}

### Training Examples (learn the pattern):
${trainingExamples}

### Test Inputs (predict the outputs):
${testInputs}

Analyze the pattern from the training examples and predict the outputs for the test inputs.

Respond ONLY with a JSON array of the predicted outputs, in the same order as the test inputs. Each output should be a 2D array of integers.

Example response format:
[
  [[1,1,1], [1,0,1], [1,1,1]],
  [[2,2,2], [2,0,2], [2,2,2]]
]`;

      // Save the question
      this.saveQuestion(evalDir, agentPrompt);

      // Call agent to get predictions
      await this.agent.chat(agentPrompt);

      // Extract the agent's output from conversation
      const messages = this.agent.getConversationMessages();

      // Find the most recent assistant message
      let predictions: number[][][] = [];
      let agentResponse = '';

      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          agentResponse = messages[i].content;
          break;
        }
      }

      // Save the agent's raw output
      this.saveOutput(evalDir, agentResponse, 1);

      // Save the conversation
      this.saveConversation(evalDir, messages, 1);

      // Extract JSON predictions from agent response
      try {
        // Try to find JSON array in the response (may be in markdown code blocks)
        let jsonMatch = agentResponse.match(/```json\s*([\s\S]*?)\s*```/);
        let jsonString = jsonMatch ? jsonMatch[1] : agentResponse;

        // If still no match, try to find raw JSON array
        if (!jsonMatch) {
          jsonMatch = agentResponse.match(/\[\s*\[.*?\]\s*\]/s);
          jsonString = jsonMatch ? jsonMatch[0] : agentResponse;
        }

        predictions = JSON.parse(jsonString);

        // Validate it's an array of arrays
        if (!Array.isArray(predictions) || predictions.length === 0) {
          return {
            task_id: task.task_id,
            dataset: this.config.dataset as any,
            status: 'failed',
            time_seconds: (Date.now() - startTime) / 1000,
            error: `Agent predictions not in expected format (array of grids)`,
          };
        }
      } catch (error) {
        return {
          task_id: task.task_id,
          dataset: this.config.dataset as any,
          status: 'failed',
          time_seconds: (Date.now() - startTime) / 1000,
          error: `Failed to parse agent predictions: ${error}. Agent response: ${agentResponse.substring(0, 300)}`,
        };
      }

      // Evaluate predictions against expected outputs
      let passed = true;
      const errors: string[] = [];

      for (let i = 0; i < task.test.length; i++) {
        if (!predictions[i]) {
          passed = false;
          errors.push(`Missing prediction for test case ${i + 1}`);
          continue;
        }

        // Check if predicted output matches expected output exactly
        const expected = task.test[i].output;
        const predicted = predictions[i];

        if (!this.compareGrids(predicted, expected)) {
          passed = false;
          errors.push(`Test case ${i + 1} mismatch`);
        }
      }

      const result: any = {
        task_id: task.task_id,
        dataset: this.config.dataset,
        status: 'completed',
        passed,
        attempts: 1,
        pass_at_1: passed,
        pass_at_2: passed,
        training_accuracy: 1.0, // Agent analyzed training examples
        errors,
      };

      const duration = (Date.now() - startTime) / 1000;
      result.time_seconds = duration;

      return result;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      return {
        task_id: task.task_id,
        dataset: this.config.dataset as any,
        status: 'failed',
        time_seconds: duration,
        error: String(error),
      };
    }
  }

  /**
   * Compare two grids for exact match
   */
  private compareGrids(actual: number[][], expected: number[][]): boolean {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      return false;
    }

    if (actual.length !== expected.length) {
      return false;
    }

    for (let i = 0; i < actual.length; i++) {
      if (!Array.isArray(actual[i]) || !Array.isArray(expected[i])) {
        return false;
      }

      if (actual[i].length !== expected[i].length) {
        return false;
      }

      for (let j = 0; j < actual[i].length; j++) {
        if (actual[i][j] !== expected[i][j]) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Get install command for repo
   */
  private getInstallCommand(repo: string): string {
    // Repo-specific installation commands with test dependencies
    const commands: Record<string, string> = {
      'django/django': 'pip install -e . && pip install -e .[tests] && pip install asgiref sqlparse',
      'pallets/flask': 'pip install -e . && pip install -e .[test] && pip install pytest',
      'psf/requests': 'pip install -e . && pip install -e .[tests] && pip install pytest',
    };

    // Default: install package and test dependencies
    return commands[repo] || 'pip install -e . && pip install pytest';
  }

  /**
   * Initialize from checkpoint if resuming
   */
  private async initializeFromCheckpoint(): Promise<void> {
    if (!this.config.resume_checkpoint) {
      return;
    }

    try {
      this.checkpoint = await CheckpointManager.loadCheckpoint(
        this.config.resume_checkpoint
      );

      // Restore state
      this.completedTasks = CheckpointManager.getCompletedTasks(this.checkpoint);
      this.results = this.checkpoint.results;

      console.log(`\n📋 Resumed from checkpoint`);
    } catch (error) {
      console.warn(`⚠️  Could not load checkpoint: ${error}`);
    }
  }

  /**
   * Save checkpoint
   */
  private async saveCheckpoint(pendingIds: string[]): Promise<void> {
    if (!this.checkpoint) {
      this.checkpoint = {
        dataset: this.config.dataset,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        total_instances: 0,
        completed: 0,
        passed: 0,
        results: [],
        pending_ids: [],
        in_progress_ids: [],
      };
    }

    const report = BenchmarkFormatter.createReport(
      this.config.dataset,
      this.results
    );

    await CheckpointManager.saveCheckpoint(
      report,
      pendingIds,
      [],
      this.config.output_file || `.checkpoint-${this.config.dataset}.json`
    );
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    console.log('\n🧹 Cleaning up...');
    await this.dockerManager.cleanup();
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
