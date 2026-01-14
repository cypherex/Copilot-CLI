/**
 * SWE-bench evaluator
 * Evaluates if generated patches successfully resolve issues
 */

import { SWEBenchInstance, SWEBenchResult, TaskResult } from '../types.js';
import { DockerManager, CommandResult } from '../docker/manager.js';

export interface EvaluationConfig {
  timeout_seconds?: number;
  capture_output?: boolean;
}

export class SWEBenchEvaluator {
  /**
   * Evaluate a generated patch against test suite
   */
  static async evaluate(
    instance: SWEBenchInstance,
    containerName: string,
    dockerManager: DockerManager,
    config: EvaluationConfig = {}
  ): Promise<SWEBenchResult> {
    const timeout = config.timeout_seconds || 600;
    const captureOutput = config.capture_output !== false;

    console.log(`\n📋 Evaluating: ${instance.instance_id}`);

    try {
      // Step 1: Run reproduction command to get baseline
      console.log('  Step 1: Running reproduction (baseline test)...');
      const reproResult = await this.runRepro(
        containerName,
        instance,
        dockerManager,
        timeout
      );

      // Step 2: Run test patch to verify fix
      console.log('  Step 2: Running test patch...');
      const testResult = await this.runTestPatch(
        containerName,
        instance,
        dockerManager,
        timeout
      );

      // Step 3: Determine if patch is successful
      const passed = this.isPatchSuccessful(reproResult, testResult);

      return {
        task_id: instance.instance_id,
        dataset: 'swe-bench' as any,
        status: 'completed',
        passed,
        verification_passed: passed,
        time_seconds: reproResult.duration + testResult.duration,
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
   * Run reproduction command (failing test)
   */
  private static async runRepro(
    containerName: string,
    instance: SWEBenchInstance,
    dockerManager: DockerManager,
    timeout: number
  ): Promise<{ exitCode: number; duration: number; output: string }> {
    const startTime = Date.now();

    try {
      // Parse repo to get structure
      const [owner, repo] = instance.repo.split('/');

      // Extract test files from patch to run only relevant tests
      const testFiles = this.extractTestFilesFromPatch(instance.test_patch);
      const testCommand = testFiles.length > 0
        ? `python -m pytest ${testFiles.join(' ')} -x --tb=line -q`
        : this.getTestCommand(instance.repo);

      console.log(`    Running: ${testCommand.substring(0, 100)}...`);

      // Add timeout wrapper to enforce hard limit
      const timeoutWrappedCommand = `timeout ${Math.floor(timeout * 0.9)} ${testCommand}`;
      const result = await dockerManager.executeInContainer(
        containerName,
        timeoutWrappedCommand,
        timeout
      );

      const duration = (Date.now() - startTime) / 1000;

      return {
        exitCode: result.exitCode,
        duration,
        output: result.stdout + '\n' + result.stderr,
      };
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      throw new Error(`Repro failed: ${error}`);
    }
  }

  /**
   * Run test patch (post-fix validation)
   */
  private static async runTestPatch(
    containerName: string,
    instance: SWEBenchInstance,
    dockerManager: DockerManager,
    timeout: number
  ): Promise<{ exitCode: number; duration: number; output: string }> {
    const startTime = Date.now();

    try {
      // Encode test patch as base64 to avoid escaping issues
      const patchBase64 = Buffer.from(instance.test_patch).toString('base64');
      const patchPath = '/tmp/test.patch';

      // Write patch file using base64 decoding to avoid escaping issues
      await dockerManager.executeInContainer(
        containerName,
        `echo '${patchBase64}' | base64 -d > ${patchPath}`,
        30
      );

      // Apply the patch
      await dockerManager.executeInContainer(
        containerName,
        `cd /workspace && patch -p1 < ${patchPath}`,
        30
      );

      // Run the test command with enforced timeout
      const testCommand = this.getTestCommand(instance.repo);
      // Add timeout wrapper to enforce hard limit
      const timeoutWrappedCommand = `timeout ${Math.floor(timeout * 0.9)} ${testCommand}`;
      const result = await dockerManager.executeInContainer(
        containerName,
        timeoutWrappedCommand,
        timeout
      );

      const duration = (Date.now() - startTime) / 1000;

      return {
        exitCode: result.exitCode,
        duration,
        output: result.stdout + '\n' + result.stderr,
      };
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      throw new Error(`Test patch failed: ${error}`);
    }
  }

  /**
   * Determine if patch is successful based on test results
   */
  private static isPatchSuccessful(
    reproResult: { exitCode: number },
    testResult: { exitCode: number }
  ): boolean {
    // Heuristic: if test passes after patch, it's successful
    // Repro might fail (negative test), test should pass
    return testResult.exitCode === 0;
  }

  /**
   * Extract test files from patch that should be run
   */
  private static extractTestFilesFromPatch(patch: string): string[] {
    const testFiles = new Set<string>();

    // Look for lines starting with "diff --git" which indicate file changes
    const lines = patch.split('\n');
    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        // Extract file path from: diff --git a/path/to/file b/path/to/file
        const match = line.match(/diff --git a\/(.*) b\//);
        if (match) {
          const filePath = match[1];
          // If it's a test file, add it
          if (filePath.includes('/test') || filePath.startsWith('test')) {
            testFiles.add(filePath);
          }
        }
      }
    }

    return Array.from(testFiles);
  }

  /**
   * Get test command for repo
   * This is repo-specific and needs customization
   */
  private static getTestCommand(repo: string): string {
    // Repo-specific test commands with appropriate pytest discovery
    const commands: Record<string, string> = {
      // Django needs its test runner
      'django/django': 'python manage.py test --keepdb 2>&1 | head -500',
      'pallets/flask': 'python -m pytest tests/ -x',
      'psf/requests': 'python -m pytest tests/ -x',
      'mitsuhiko/click': 'python -m pytest tests/ -x',
      'scikit-learn/scikit-learn': 'python -m pytest sklearn/ -x',
    };

    // Default: run pytest with auto-discovery from current directory
    return commands[repo] || 'python -m pytest -x --tb=line -q';
  }


  /**
   * Compare outputs to determine success
   */
  static compareOutputs(expected: string, actual: string): number {
    // Calculate similarity (0-1)
    const expectedLines = expected.split('\n');
    const actualLines = actual.split('\n');

    let matches = 0;
    for (let i = 0; i < Math.min(expectedLines.length, actualLines.length); i++) {
      if (expectedLines[i].trim() === actualLines[i].trim()) {
        matches++;
      }
    }

    return matches / Math.max(expectedLines.length, actualLines.length);
  }
}
