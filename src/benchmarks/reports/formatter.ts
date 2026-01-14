/**
 * Results formatter and exporter
 * Supports JSON and CSV output formats
 */

import { BenchmarkReport, TaskResult, SWEBenchResult, ARCResult } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

export class BenchmarkFormatter {
  /**
   * Format report as JSON
   */
  static toJSON(report: BenchmarkReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Format report as CSV
   */
  static toCSV(report: BenchmarkReport): string {
    const headers = [
      'task_id',
      'status',
      'passed',
      'time_seconds',
      'iterations',
      'dataset',
    ];

    const rows = report.results.map((result: TaskResult) => {
      const isSWEBench = 'verification_passed' in result;
      const isARC = 'attempts' in result;

      const row: string[] = [
        result.task_id,
        result.status,
        result.passed ? 'true' : 'false',
        String(result.time_seconds || ''),
        String(result.iterations || ''),
        result.dataset,
      ];

      if (isSWEBench) {
        const swResult = result as SWEBenchResult;
        if (!headers.includes('verification_passed')) {
          headers.push('verification_passed');
        }
        row.push(swResult.verification_passed ? 'true' : 'false');
      }

      if (isARC) {
        const arcResult = result as ARCResult;
        if (!headers.includes('attempts')) {
          headers.push('attempts', 'training_accuracy');
        }
        row.push(arcResult.attempts.toString(), (arcResult.training_accuracy || 0).toString());
      }

      return row;
    });

    // Add header row
    const csvLines = [headers.join(',')];

    // Ensure all rows have same length as headers
    rows.forEach((row: string[], idx: number) => {
      while (row.length < headers.length) {
        row.push('');
      }
      csvLines.push(row.slice(0, headers.length).join(','));
    });

    return csvLines.join('\n');
  }

  /**
   * Generate human-readable summary
   */
  static toSummary(report: BenchmarkReport): string {
    const lines: string[] = [];

    lines.push(`\n${'='.repeat(60)}`);
    lines.push(`BENCHMARK REPORT: ${report.dataset.toUpperCase()}`);
    lines.push(`${'='.repeat(60)}`);
    lines.push('');

    lines.push(`Dataset:          ${report.dataset}`);
    lines.push(`Total instances:  ${report.total_instances}`);
    lines.push(`Completed:        ${report.completed} (${((report.completed / report.total_instances) * 100).toFixed(2)}%)`);
    lines.push(`Passed:           ${report.passed}`);
    lines.push(`Pass rate:        ${(report.passed_rate * 100).toFixed(2)}%`);
    lines.push('');

    lines.push(`Total time:       ${report.total_time_seconds} seconds`);
    lines.push(`Avg time/task:    ${report.average_time_per_task.toFixed(2)} seconds`);
    lines.push(`Avg iterations:   ${report.average_iterations.toFixed(2)}`);
    lines.push('');

    lines.push(`Timestamp:        ${report.timestamp}`);
    lines.push('');

    // Group results by status
    const byStatus = new Map<string, number>();
    report.results.forEach((r: TaskResult) => {
      byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);
    });

    lines.push('Results by status:');
    byStatus.forEach((count, status) => {
      lines.push(`  ${status}: ${count}`);
    });

    lines.push('');
    lines.push(`${'='.repeat(60)}\n`);

    return lines.join('\n');
  }

  /**
   * Save report to file
   */
  static async saveReport(report: BenchmarkReport, outputPath: string, format: 'json' | 'csv' | 'txt' = 'json'): Promise<void> {
    let content = '';

    if (format === 'json') {
      content = this.toJSON(report);
    } else if (format === 'csv') {
      content = this.toCSV(report);
    } else if (format === 'txt') {
      content = this.toSummary(report);
    }

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, content, 'utf-8');
    console.log(`✓ Report saved to ${outputPath}`);
  }

  /**
   * Load report from file
   */
  static async loadReport(inputPath: string): Promise<BenchmarkReport> {
    const content = fs.readFileSync(inputPath, 'utf-8');
    return JSON.parse(content) as BenchmarkReport;
  }

  /**
   * Create summary report from individual results
   */
  static createReport(dataset: string, results: TaskResult[]): BenchmarkReport {
    const passedCount = results.filter(r => r.passed).length;
    const totalTime = results.reduce((sum, r) => sum + (r.time_seconds || 0), 0);
    const avgTime = totalTime / results.length;
    const avgIterations = results.reduce((sum, r) => sum + (r.iterations || 0), 0) / results.length;

    return {
      dataset: dataset as any,
      total_instances: results.length,
      completed: results.filter(r => r.status === 'completed').length,
      passed: passedCount,
      passed_rate: passedCount / results.length,
      total_time_seconds: totalTime,
      average_time_per_task: avgTime,
      average_iterations: avgIterations,
      results,
      timestamp: new Date().toISOString(),
    };
  }
}
