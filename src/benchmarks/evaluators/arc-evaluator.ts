/**
 * ARC-AGI-2 evaluator
 * Evaluates grid transformation solutions for correctness
 */

import { ARCTask, ARCResult } from '../types.js';
import { DockerManager } from '../docker/manager.js';

export interface ARCEvaluationConfig {
  timeout_seconds?: number;
  max_attempts?: number;
}

export class ARCEvaluator {
  /**
   * Evaluate a transformation function against test cases
   */
  static async evaluate(
    task: ARCTask,
    containerName: string,
    code: string,
    dockerManager: DockerManager,
    config: ARCEvaluationConfig = {}
  ): Promise<ARCResult> {
    const timeout = config.timeout_seconds || 60;
    const maxAttempts = config.max_attempts || 2;

    console.log(`\n🔍 Evaluating: ${task.task_id}`);

    try {
      // Step 1: Validate training examples
      console.log('  Step 1: Testing on training examples...');
      const trainingResult = await this.validateTraining(
        task,
        containerName,
        code,
        dockerManager,
        timeout
      );

      if (!trainingResult.passed) {
        return {
          task_id: task.task_id,
          dataset: 'arc-agi-2' as any,
          status: 'completed',
          passed: false,
          attempts: 1,
          pass_at_1: false,
          pass_at_2: false,
          training_accuracy: trainingResult.accuracy,
          code,
          errors: trainingResult.errors,
        };
      }

      console.log('  ✓ Training passed');

      // Step 2: Test on test cases
      console.log('  Step 2: Testing on test cases...');
      const testResult = await this.validateTest(
        task,
        containerName,
        code,
        dockerManager,
        timeout
      );

      const passed = testResult.accuracy === 1.0;

      return {
        task_id: task.task_id,
        dataset: 'arc-agi-2' as any,
        status: 'completed',
        passed,
        attempts: 1,
        pass_at_1: passed,
        pass_at_2: passed,
        training_accuracy: trainingResult.accuracy,
        code,
        errors: testResult.errors,
      };
    } catch (error) {
      return {
        task_id: task.task_id,
        dataset: 'arc-agi-2' as any,
        status: 'failed',
        passed: false,
        attempts: 0,
        training_accuracy: 0,
        code,
        errors: [String(error)],
      };
    }
  }

  /**
   * Validate transformation on training examples
   */
  private static async validateTraining(
    task: ARCTask,
    containerName: string,
    code: string,
    dockerManager: DockerManager,
    timeout: number
  ): Promise<{ passed: boolean; accuracy: number; errors: string[] }> {
    const errors: string[] = [];
    let correctCount = 0;

    for (const example of task.train) {
      try {
        const result = await this.executeTransform(
          containerName,
          code,
          example.input,
          dockerManager,
          timeout
        );

        if (result.error) {
          errors.push(`Training error: ${result.error}`);
          continue;
        }

        const matches = this.compareGrids(result.output, example.output);
        if (matches) {
          correctCount++;
        } else {
          errors.push(`Training mismatch on example`);
        }
      } catch (error) {
        errors.push(`Training execution failed: ${error}`);
      }
    }

    const accuracy = task.train.length > 0 ? correctCount / task.train.length : 0;
    return {
      passed: accuracy === 1.0,
      accuracy,
      errors,
    };
  }

  /**
   * Validate transformation on test cases
   */
  private static async validateTest(
    task: ARCTask,
    containerName: string,
    code: string,
    dockerManager: DockerManager,
    timeout: number
  ): Promise<{ accuracy: number; errors: string[] }> {
    const errors: string[] = [];
    let correctCount = 0;

    for (const testCase of task.test) {
      try {
        const result = await this.executeTransform(
          containerName,
          code,
          testCase.input,
          dockerManager,
          timeout
        );

        if (result.error) {
          errors.push(`Test error: ${result.error}`);
          continue;
        }

        // For test cases with known outputs, verify
        if (testCase.output && testCase.output.length > 0) {
          const matches = this.compareGrids(result.output, testCase.output);
          if (matches) {
            correctCount++;
          } else {
            errors.push(`Test output mismatch`);
          }
        } else {
          // For test cases without known outputs, just check it executed
          correctCount++;
        }
      } catch (error) {
        errors.push(`Test execution failed: ${error}`);
      }
    }

    const accuracy = task.test.length > 0 ? correctCount / task.test.length : 0;
    return {
      accuracy,
      errors,
    };
  }

  /**
   * Execute transformation function and get output
   */
  private static async executeTransform(
    containerName: string,
    code: string,
    input: number[][],
    dockerManager: DockerManager,
    timeout: number
  ): Promise<{ output: number[][]; error?: string }> {
    try {
      // Execute Python code directly using base64 to avoid shell issues
      const inputJson = JSON.stringify(input);
      const pythonCode = `
import json
import sys

${code}

try:
    input_data = ${inputJson}
    output = transform(input_data)
    print(json.dumps(output))
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
`;

      // Encode Python code in base64 for safe shell transmission
      const encodedCode = Buffer.from(pythonCode).toString('base64');

      // Execute Python code directly
      const result = await dockerManager.executeInContainer(
        containerName,
        `echo '${encodedCode}' | base64 -d | python`,
        timeout
      );

      // Check for execution errors
      if (result.exitCode !== 0) {
        const errorOutput = result.stderr || result.stdout;
        // Try to parse error as JSON
        try {
          const parsed = JSON.parse(errorOutput.trim());
          if (parsed.error) {
            return { output: [], error: parsed.error };
          }
        } catch {
          return { output: [], error: `Execution failed: ${errorOutput.substring(0, 200)}` };
        }
      }

      const stdout = result.stdout.trim();
      if (!stdout) {
        return {
          output: [],
          error: `No output produced. Stderr: ${result.stderr}`,
        };
      }

      try {
        const output = JSON.parse(stdout);
        if (output && Array.isArray(output)) {
          return { output };
        }
        return { output: [], error: `Invalid output format` };
      } catch (parseError) {
        return {
          output: [],
          error: `JSON parse failed: ${stdout.substring(0, 100)}`,
        };
      }
    } catch (error) {
      return {
        output: [],
        error: String(error),
      };
    }
  }

  /**
   * Compare two grids for exact match
   */
  private static compareGrids(actual: number[][], expected: number[][]): boolean {
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
   * Calculate grid similarity (for debugging)
   */
  static calculateSimilarity(actual: number[][], expected: number[][]): number {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      return 0;
    }

    let matches = 0;
    let total = 0;

    const minRows = Math.min(actual.length, expected.length);
    const maxRows = Math.max(actual.length, expected.length);

    for (let i = 0; i < minRows; i++) {
      const minCols = Math.min(actual[i]?.length || 0, expected[i]?.length || 0);
      const maxCols = Math.max(actual[i]?.length || 0, expected[i]?.length || 0);

      for (let j = 0; j < minCols; j++) {
        if (actual[i][j] === expected[i][j]) {
          matches++;
        }
        total++;
      }

      // Count mismatches in non-overlapping regions
      total += Math.abs((actual[i]?.length || 0) - (expected[i]?.length || 0));
    }

    // Count row mismatches
    total += (maxRows - minRows) * Math.max(
      actual[0]?.length || 0,
      expected[0]?.length || 0
    );

    return total > 0 ? matches / total : 0;
  }
}
