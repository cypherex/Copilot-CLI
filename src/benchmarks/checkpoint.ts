/**
 * Checkpoint and resume functionality
 * Allows resuming benchmark runs from saved state
 */

import * as fs from 'fs';
import * as path from 'path';
import { BenchmarkReport, TaskResult } from './types.js';

export interface CheckpointData {
  dataset: string;
  created_at: string;
  updated_at: string;
  total_instances: number;
  completed: number;
  passed: number;
  results: TaskResult[];
  pending_ids: string[];
  in_progress_ids: string[];
}

export class CheckpointManager {
  /**
   * Save checkpoint of progress
   */
  static async saveCheckpoint(
    report: BenchmarkReport,
    pendingIds: string[],
    inProgressIds: string[] = [],
    filePath: string = `.checkpoint-${report.dataset}.json`
  ): Promise<void> {
    const checkpoint: CheckpointData = {
      dataset: report.dataset,
      created_at: report.timestamp,
      updated_at: new Date().toISOString(),
      total_instances: report.total_instances,
      completed: report.completed,
      passed: report.passed,
      results: report.results,
      pending_ids: pendingIds,
      in_progress_ids: inProgressIds,
    };

    fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    console.log(`✓ Checkpoint saved to ${filePath}`);
  }

  /**
   * Load checkpoint from file
   */
  static async loadCheckpoint(filePath: string): Promise<CheckpointData> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Checkpoint not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const checkpoint = JSON.parse(content) as CheckpointData;

    console.log(`✓ Checkpoint loaded from ${filePath}`);
    console.log(`  Dataset: ${checkpoint.dataset}`);
    console.log(`  Completed: ${checkpoint.completed}/${checkpoint.total_instances}`);
    console.log(`  Passed: ${checkpoint.passed}/${checkpoint.completed}`);
    console.log(`  Created: ${checkpoint.created_at}`);
    console.log(`  Last updated: ${checkpoint.updated_at}`);

    return checkpoint;
  }

  /**
   * Get list of completed tasks from checkpoint
   */
  static getCompletedTasks(checkpoint: CheckpointData): Set<string> {
    return new Set(checkpoint.results.map(r => r.task_id));
  }

  /**
   * Get pending tasks from checkpoint
   */
  static getPendingTasks(checkpoint: CheckpointData): string[] {
    return checkpoint.pending_ids;
  }

  /**
   * Update checkpoint with new result
   */
  static updateCheckpoint(
    checkpoint: CheckpointData,
    result: TaskResult
  ): void {
    // Remove from pending/in_progress
    checkpoint.pending_ids = checkpoint.pending_ids.filter(id => id !== result.task_id);
    checkpoint.in_progress_ids = checkpoint.in_progress_ids.filter(
      id => id !== result.task_id
    );

    // Add to results
    const existingIndex = checkpoint.results.findIndex(
      r => r.task_id === result.task_id
    );

    if (existingIndex >= 0) {
      checkpoint.results[existingIndex] = result;
    } else {
      checkpoint.results.push(result);
    }

    // Update stats
    if (result.status === 'completed') {
      checkpoint.completed++;
      if (result.passed) {
        checkpoint.passed++;
      }
    }

    checkpoint.updated_at = new Date().toISOString();
  }

  /**
   * Find latest checkpoint file
   */
  static findLatestCheckpoint(directory: string = '.'): string | null {
    if (!fs.existsSync(directory)) {
      return null;
    }

    const files = fs.readdirSync(directory).filter(f => f.startsWith('.checkpoint-'));

    if (files.length === 0) {
      return null;
    }

    // Sort by modification time (newest first)
    const sorted = files.sort((a, b) => {
      const aTime = fs.statSync(path.join(directory, a)).mtime.getTime();
      const bTime = fs.statSync(path.join(directory, b)).mtime.getTime();
      return bTime - aTime;
    });

    return path.join(directory, sorted[0]);
  }

  /**
   * Clean up old checkpoints (keep only N most recent)
   */
  static async cleanupOldCheckpoints(
    directory: string = '.',
    keepCount: number = 3
  ): Promise<void> {
    const files = fs.readdirSync(directory).filter(f => f.startsWith('.checkpoint-'));

    if (files.length <= keepCount) {
      return;
    }

    // Sort by modification time
    const sorted = files.sort((a, b) => {
      const aTime = fs.statSync(path.join(directory, a)).mtime.getTime();
      const bTime = fs.statSync(path.join(directory, b)).mtime.getTime();
      return bTime - aTime;
    });

    // Delete oldest files
    for (let i = keepCount; i < sorted.length; i++) {
      const filePath = path.join(directory, sorted[i]);
      fs.unlinkSync(filePath);
      console.log(`  Deleted old checkpoint: ${sorted[i]}`);
    }
  }

  /**
   * Merge results from multiple checkpoints
   */
  static mergeCheckpoints(checkpoints: CheckpointData[]): CheckpointData {
    if (checkpoints.length === 0) {
      throw new Error('No checkpoints to merge');
    }

    const merged = { ...checkpoints[0] };
    const resultMap = new Map(merged.results.map(r => [r.task_id, r]));

    // Merge results from other checkpoints
    for (let i = 1; i < checkpoints.length; i++) {
      for (const result of checkpoints[i].results) {
        resultMap.set(result.task_id, result);
      }
    }

    merged.results = Array.from(resultMap.values());
    merged.completed = merged.results.filter(r => r.status === 'completed').length;
    merged.passed = merged.results.filter(r => r.passed).length;
    merged.updated_at = new Date().toISOString();

    // Update pending/in_progress lists
    merged.pending_ids = merged.pending_ids.filter(
      id => !resultMap.has(id)
    );
    merged.in_progress_ids = [];

    return merged;
  }

  /**
   * Export checkpoint as report
   */
  static checkpointToReport(checkpoint: CheckpointData): BenchmarkReport {
    const totalTime = checkpoint.results.reduce((sum, r) => sum + (r.time_seconds || 0), 0);
    const avgTime = checkpoint.completed > 0 ? totalTime / checkpoint.completed : 0;
    const avgIterations =
      checkpoint.completed > 0
        ? checkpoint.results.reduce((sum, r) => sum + (r.iterations || 0), 0) / checkpoint.completed
        : 0;

    return {
      dataset: checkpoint.dataset as any,
      total_instances: checkpoint.total_instances,
      completed: checkpoint.completed,
      passed: checkpoint.passed,
      passed_rate: checkpoint.completed > 0 ? checkpoint.passed / checkpoint.completed : 0,
      total_time_seconds: totalTime,
      average_time_per_task: avgTime,
      average_iterations: avgIterations,
      results: checkpoint.results,
      timestamp: checkpoint.updated_at,
    };
  }
}
