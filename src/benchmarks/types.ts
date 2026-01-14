/**
 * Benchmark types and interfaces
 * Supports SWE-bench and ARC-AGI-2 task formats
 */

/**
 * SWE-bench Task Instance
 * Represents a single GitHub issue resolution task
 */
export interface SWEBenchInstance {
  instance_id: string;
  repo: string;
  version: string;
  base_commit: string;
  environment_setup_commit?: string;
  patch: string;
  test_patch: string;
  problem_statement: string;
  FAIL_TO_PASS?: string[];
  PASS_TO_PASS?: string[];
  issue_url?: string;
  pr_url?: string;
  hints_text?: string;
  created_at?: string;
}

/**
 * ARC-AGI-2 Grid (2D array of integers 0-9)
 */
export type ARCGrid = number[][];

/**
 * ARC-AGI-2 Example (input/output pair)
 */
export interface ARCExample {
  input: ARCGrid;
  output: ARCGrid;
}

/**
 * ARC-AGI-2 Task
 * Represents a pattern transformation task
 */
export interface ARCTask {
  task_id: string;
  train: ARCExample[];
  test: ARCExample[];
}

/**
 * Benchmark task union type
 */
export type BenchmarkTask = SWEBenchInstance | ARCTask;

/**
 * Benchmark dataset type
 */
export type BenchmarkDataset = 'swe-bench' | 'swe-bench-lite' | 'swe-bench-verified' | 'arc-agi-2';

/**
 * Task execution result
 */
export interface TaskResult {
  task_id: string;
  dataset: BenchmarkDataset;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'timeout';
  passed?: boolean;
  time_seconds?: number;
  iterations?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * SWE-bench specific result
 */
export interface SWEBenchResult extends TaskResult {
  passed?: boolean; // true if patch resolves the issue
  patch?: string; // generated patch
  verification_passed?: boolean;
  test_output?: string;
}

/**
 * ARC-AGI-2 specific result
 */
export interface ARCResult extends TaskResult {
  attempts: number;
  passed?: boolean; // true if solution correct
  pass_at_1?: boolean; // solved on first attempt
  pass_at_2?: boolean; // solved within 2 attempts
  training_accuracy?: number; // accuracy on training examples
  code?: string; // generated transformation function
  errors?: string[]; // compilation/execution errors
}

/**
 * Benchmark evaluation report
 */
export interface BenchmarkReport {
  dataset: BenchmarkDataset;
  total_instances: number;
  completed: number;
  passed: number;
  passed_rate: number;
  total_time_seconds: number;
  average_time_per_task: number;
  average_iterations: number;
  results: TaskResult[];
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for benchmark execution
 */
export interface BenchmarkConfig {
  dataset: BenchmarkDataset;
  instances?: string | number; // specific instances or range
  timeout_seconds?: number; // per-task timeout
  docker_image?: string; // custom Docker image
  output_file?: string; // results output file
  resume_checkpoint?: string; // checkpoint to resume from
  parallel?: number; // number of parallel executions
  verbose?: boolean;
}

/**
 * Loader interface for different benchmark formats
 */
export interface BenchmarkLoader {
  load(config: BenchmarkConfig): Promise<BenchmarkTask[]>;
  loadSingle(id: string): Promise<BenchmarkTask>;
}
