/**
 * Example: Run SWE-bench and ARC-AGI-2 benchmarks
 *
 * This script demonstrates how to programmatically run benchmarks
 * using the benchmark infrastructure.
 */

import {
  BenchmarkRunner,
  BenchmarkFormatter,
  CheckpointManager,
  SWEBenchLoader,
  ARCLoader,
} from '../src/benchmarks/index.js';

/**
 * Example 1: Run SWE-bench-lite benchmark
 */
async function runSWEBenchLite() {
  console.log('🚀 Example 1: SWE-bench-lite Benchmark\n');

  const runner = new BenchmarkRunner({
    dataset: 'swe-bench-lite',
    timeout_seconds: 3600,
    output_file: 'results/swe-bench-lite.json',
    instances: '0-5', // Run first 5 instances
  });

  try {
    const report = await runner.run();
    console.log('✓ Benchmark completed');

    // Get summary
    const summary = BenchmarkFormatter.toSummary(report);
    console.log(summary);

    // Export as CSV
    const csv = BenchmarkFormatter.toCSV(report);
    console.log('CSV Preview (first 3 lines):');
    console.log(csv.split('\n').slice(0, 3).join('\n'));
  } catch (error) {
    console.error(`❌ Error: ${error}`);
  }
}

/**
 * Example 2: Run ARC-AGI-2 benchmark
 */
async function runARCBenchmark() {
  console.log('\n🚀 Example 2: ARC-AGI-2 Benchmark\n');

  const runner = new BenchmarkRunner({
    dataset: 'arc-agi-2',
    timeout_seconds: 300,
    output_file: 'results/arc-agi-2.json',
    instances: '0-10', // Run first 10 tasks
  });

  try {
    const report = await runner.run();
    console.log('✓ Benchmark completed');
    console.log(BenchmarkFormatter.toSummary(report));
  } catch (error) {
    console.error(`❌ Error: ${error}`);
  }
}

/**
 * Example 3: Load datasets and inspect
 */
async function inspectDatasets() {
  console.log('\n📊 Example 3: Inspect Datasets\n');

  // Inspect SWE-bench
  const sweBenchLoader = new SWEBenchLoader();
  try {
    const stats = await sweBenchLoader.getStats('swe-bench-lite');
    console.log('SWE-bench-lite Stats:');
    console.log(`  Total instances: ${stats.total}`);
    console.log(`  Repositories: ${stats.repos.slice(0, 3).join(', ')} ...`);
  } catch (error) {
    console.log(`⚠️ SWE-bench not available: ${error}`);
  }

  // Inspect ARC
  const arcLoader = new ARCLoader();
  try {
    const stats = await arcLoader.getStats('arc-agi-2');
    console.log('\nARC-AGI-2 Stats:');
    console.log(`  Training tasks: ${stats.training}`);
    console.log(`  Evaluation tasks: ${stats.evaluation}`);
    console.log(`  Test tasks: ${stats.test}`);
    console.log(`  Total: ${stats.total}`);
  } catch (error) {
    console.log(`⚠️ ARC-AGI-2 not available: ${error}`);
  }
}

/**
 * Example 4: Resume from checkpoint
 */
async function resumeFromCheckpoint() {
  console.log('\n📋 Example 4: Resume from Checkpoint\n');

  try {
    // Load existing checkpoint
    const checkpoint = await CheckpointManager.loadCheckpoint(
      '.checkpoint-swe-bench-lite.json'
    );

    console.log('Checkpoint loaded:');
    console.log(`  Dataset: ${checkpoint.dataset}`);
    console.log(`  Progress: ${checkpoint.completed}/${checkpoint.total_instances}`);
    console.log(`  Pass rate: ${(checkpoint.passed / checkpoint.completed * 100).toFixed(1)}%`);

    // Convert to report for analysis
    const report = CheckpointManager.checkpointToReport(checkpoint);
    console.log('\nReport summary:');
    console.log(BenchmarkFormatter.toSummary(report));
  } catch (error) {
    console.log(`⚠️ No checkpoint found: ${error}`);
  }
}

/**
 * Example 5: Multiple benchmarks in sequence
 */
async function runMultipleBenchmarks() {
  console.log('\n🔄 Example 5: Run Multiple Benchmarks\n');

  const datasets = [
    { name: 'swe-bench-lite', instances: '0-2' },
    { name: 'arc-agi-2', instances: '0-2' },
  ];

  const results = [];

  for (const dataset of datasets) {
    console.log(`\n📌 Running ${dataset.name}...`);

    const runner = new BenchmarkRunner({
      dataset: dataset.name as any,
      timeout_seconds: 1800,
      output_file: `results/${dataset.name}.json`,
      instances: dataset.instances,
    });

    try {
      const report = await runner.run();
      results.push(report);

      console.log(`✓ Pass rate: ${(report.passed_rate * 100).toFixed(1)}%`);
    } catch (error) {
      console.error(`❌ Error: ${error}`);
    }
  }

  // Summary of all results
  console.log('\n' + '='.repeat(60));
  console.log('📊 OVERALL RESULTS');
  console.log('='.repeat(60));

  for (const report of results) {
    console.log(
      `${report.dataset.padEnd(20)} | Pass Rate: ${(report.passed_rate * 100).toFixed(1)}% | Avg Time: ${report.average_time_per_task.toFixed(1)}s`
    );
  }
}

/**
 * Main entry point
 */
async function main() {
  console.log('='.repeat(60));
  console.log('BENCHMARK EXAMPLES');
  console.log('='.repeat(60));

  // Comment/uncomment examples to run
  try {
    // await runSWEBenchLite();
    // await runARCBenchmark();
    await inspectDatasets();
    // await resumeFromCheckpoint();
    // await runMultipleBenchmarks();
  } catch (error) {
    console.error(`Fatal error: ${error}`);
    process.exit(1);
  }
}

main();
