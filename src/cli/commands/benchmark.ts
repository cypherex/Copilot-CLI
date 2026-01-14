/**
 * Benchmark command - Run benchmarks on SWE-bench and ARC-AGI-2
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { BenchmarkConfig } from '../../benchmarks/types.js';
import { BenchmarkRunner } from '../../benchmarks/harness/runner.js';
import { BenchmarkFormatter } from '../../benchmarks/reports/formatter.js';
import { CheckpointManager } from '../../benchmarks/checkpoint.js';
import { loadConfig } from '../../utils/config.js';
import { CopilotAgent } from '../../agent/index.js';

export async function benchmarkCommand(options: any): Promise<void> {
  // Create/get workspace directory for benchmark execution
  // Agent needs to work here so edits are visible to Docker mount
  const workspaceDir = path.join(process.cwd(), 'benchmark-workspace');
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  const config: BenchmarkConfig & { use_agent?: boolean; api_key?: string; llm_model?: string; workspace?: string } = {
    dataset: options.dataset || 'swe-bench-lite',
    instances: options.instances,
    timeout_seconds: options.timeout ? parseInt(options.timeout) : 3600,
    output_file: options.output,
    resume_checkpoint: options.resume,
    parallel: options.parallel ? parseInt(options.parallel) : 1,
    verbose: options.verbose || false,
    use_agent: options.useAgent || false,
    api_key: options.apiKey,
    llm_model: options.llmModel,
    workspace: workspaceDir,
  };

  // Validate dataset
  const validDatasets = ['swe-bench', 'swe-bench-lite', 'swe-bench-verified', 'arc-agi-2'];
  if (!validDatasets.includes(config.dataset)) {
    console.error(`❌ Invalid dataset: ${config.dataset}`);
    console.error(`Valid options: ${validDatasets.join(', ')}`);
    process.exit(1);
  }

  // Check Docker availability
  if (!BenchmarkRunner.isDockerAvailable()) {
    console.error('❌ Docker is not available. Please install Docker and try again.');
    process.exit(1);
  }

  try {
    // Create runner
    const runner = new BenchmarkRunner(config as any);

    // For ARC-AGI-2, initialize agent to handle pattern recognition
    // For SWE-bench with --use-agent, also initialize agent
    if (config.dataset === 'arc-agi-2' || config.use_agent) {
      console.log('🤖 Initializing agent...');
      const authConfig = await loadConfig();
      // Initialize agent with benchmark-workspace/work directory
      // This matches the Docker volume mount: benchmark-workspace/work → /workspace
      const agentWorkDir = path.join(workspaceDir, 'work');
      if (!fs.existsSync(agentWorkDir)) {
        fs.mkdirSync(agentWorkDir, { recursive: true });
      }
      const agent = new CopilotAgent(authConfig.auth, authConfig.llm, agentWorkDir);
      await agent.initialize();
      runner.setAgent(agent);
    }

    // Run benchmark
    const report = await runner.run();

    // Print results
    console.log('\n✨ Benchmark Complete!');
    console.log(BenchmarkFormatter.toSummary(report));

    // Save summary
    if (config.output_file) {
      console.log(`\n📁 Results saved to: ${config.output_file}`);
    }
  } catch (error) {
    console.error(`\n❌ Benchmark failed: ${error}`);
    process.exit(1);
  }
}

export function registerBenchmarkCommand(program: Command): void {
  program
    .command('benchmark <action>')
    .description('Run benchmarks on evaluation datasets')
    .option('-d, --dataset <name>', 'Dataset to run (swe-bench|swe-bench-lite|swe-bench-verified|arc-agi-2)', 'swe-bench-lite')
    .option('-i, --instances <range>', 'Specific instances to run (e.g., "1-10" or "django-123")')
    .option('-o, --output <path>', 'Output file for results (JSON/CSV)')
    .option('-t, --timeout <seconds>', 'Timeout per task in seconds', '3600')
    .option('-p, --parallel <n>', 'Number of parallel executions', '1')
    .option('-r, --resume <checkpoint>', 'Resume from checkpoint file')
    .option('-v, --verbose', 'Verbose output')
    .option('--use-agent', 'Use CLI agent to solve tasks instead of gold patches')
    .option('--api-key <key>', 'API key for LLM provider')
    .option('--llm-model <model>', 'LLM model to use (e.g., claude-opus-4)')
    .action(async (action, options) => {
      if (action === 'run') {
        await benchmarkCommand(options);
      } else if (action === 'status') {
        console.log('Benchmark status command - not yet implemented');
      } else if (action === 'list') {
        console.log('Available datasets:');
        console.log('  - swe-bench (2,294 instances)');
        console.log('  - swe-bench-lite (300 instances)');
        console.log('  - swe-bench-verified (500 instances)');
        console.log('  - arc-agi-2 (120 tasks)');
      } else {
        console.error(`Unknown action: ${action}`);
        console.error('Valid actions: run, status, list');
        process.exit(1);
      }
    });
}
