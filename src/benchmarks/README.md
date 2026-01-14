# Benchmark Infrastructure

Comprehensive benchmarking framework for evaluating the Copilot CLI Agent on SWE-bench and ARC-AGI-2 datasets.

## Overview

This module provides:

- **Dataset Integration**: Load benchmarks from HuggingFace or local files
- **Docker Orchestration**: Isolated execution environments per task
- **Evaluation**: Automated verification of solutions
- **Checkpointing**: Resume interrupted runs
- **Results Export**: JSON, CSV, and text reports

## Architecture

```
benchmarks/
├── types.ts                 # Core type definitions
├── checkpoint.ts           # Checkpoint/resume functionality
├── index.ts               # Module exports
├── docker/
│   └── manager.ts         # Docker container management
├── loaders/
│   ├── index.ts          # Loader factory
│   ├── swe-bench-loader.ts
│   └── arc-loader.ts
├── evaluators/
│   ├── swe-bench-evaluator.ts
│   └── arc-evaluator.ts
├── harness/
│   └── runner.ts         # Main execution orchestrator
└── reports/
    └── formatter.ts      # Results export
```

## Quick Start

### 1. Load Dataset

```typescript
import { createLoader } from './loaders/index.js';

const loader = createLoader({ dataset: 'swe-bench-lite' });
const tasks = await loader.load();
```

### 2. Run Benchmark

```typescript
import { BenchmarkRunner } from './harness/runner.js';

const runner = new BenchmarkRunner({
  dataset: 'swe-bench-lite',
  timeout_seconds: 3600,
  output_file: 'results.json'
});

const report = await runner.run();
```

### 3. Export Results

```typescript
import { BenchmarkFormatter } from './reports/formatter.js';

// JSON export
const json = BenchmarkFormatter.toJSON(report);

// CSV export
const csv = BenchmarkFormatter.toCSV(report);

// Save to file
await BenchmarkFormatter.saveReport(report, 'results.json', 'json');
```

## Key Classes

### BenchmarkRunner

Main orchestrator for running benchmarks.

```typescript
const runner = new BenchmarkRunner(config);
const report = await runner.run();
```

**Config Options**:
- `dataset`: 'swe-bench' | 'swe-bench-lite' | 'swe-bench-verified' | 'arc-agi-2'
- `timeout_seconds`: Timeout per task (default: 3600)
- `output_file`: Where to save results
- `instances`: Specific instances to run (e.g., "0-10")
- `resume_checkpoint`: Checkpoint file to resume from

### DockerManager

Handles container lifecycle and command execution.

```typescript
const manager = new DockerManager();

// Create container
const name = await manager.createContainer({
  image: 'copilot-cli-swe-bench:latest',
  workdir: '/workspace',
  volumes: { '/host/path': '/container/path' }
});

// Execute command
const result = await manager.executeInContainer(
  name,
  'pytest tests/',
  timeout
);

// Cleanup
await manager.removeContainer(name);
```

### Evaluators

#### SWEBenchEvaluator

Evaluates patches by running test suites.

```typescript
const result = await SWEBenchEvaluator.evaluate(
  instance,
  containerName,
  dockerManager,
  { timeout_seconds: 600 }
);
```

#### ARCEvaluator

Evaluates grid transformation functions by comparing outputs.

```typescript
const result = await ARCEvaluator.evaluate(
  task,
  containerName,
  code,
  dockerManager,
  { timeout_seconds: 60 }
);
```

### CheckpointManager

Manages progress checkpoints for long-running evaluations.

```typescript
// Save checkpoint
await CheckpointManager.saveCheckpoint(report, pendingIds, inProgressIds);

// Load checkpoint
const checkpoint = await CheckpointManager.loadCheckpoint('path/to/checkpoint.json');

// Resume from checkpoint
const report = CheckpointManager.checkpointToReport(checkpoint);
```

### BenchmarkFormatter

Exports results in various formats.

```typescript
// JSON
const json = BenchmarkFormatter.toJSON(report);
await BenchmarkFormatter.saveReport(report, 'results.json', 'json');

// CSV
const csv = BenchmarkFormatter.toCSV(report);
await BenchmarkFormatter.saveReport(report, 'results.csv', 'csv');

// Summary
const summary = BenchmarkFormatter.toSummary(report);
console.log(summary);
```

## Data Formats

### Task Types

#### SWE-bench Instance

```typescript
{
  instance_id: string;
  repo: string;
  version: string;
  base_commit: string;
  patch: string;           // Gold patch
  test_patch: string;      // Test validation
  problem_statement: string;
}
```

#### ARC-AGI-2 Task

```typescript
{
  task_id: string;
  train: Array<{
    input: number[][];
    output: number[][];
  }>;
  test: Array<{
    input: number[][];
    output?: number[][];
  }>;
}
```

### Result Types

#### SWE-bench Result

```typescript
{
  task_id: string;
  dataset: 'swe-bench' | 'swe-bench-lite' | 'swe-bench-verified';
  status: 'completed' | 'failed' | 'timeout';
  passed: boolean;
  verification_passed: boolean;
  time_seconds: number;
  iterations: number;
  test_output?: string;
}
```

#### ARC-AGI-2 Result

```typescript
{
  task_id: string;
  dataset: 'arc-agi-2';
  status: 'completed' | 'failed';
  passed: boolean;
  attempts: number;
  pass_at_1: boolean;
  pass_at_2: boolean;
  training_accuracy: number;
  code: string;
  errors: string[];
}
```

## Workflow

### Running a Benchmark

1. **Initialize**: Load config and datasets
2. **Setup**: Build Docker images, create workspace
3. **Execute**: Run each task in isolated container
4. **Evaluate**: Check if task succeeded
5. **Checkpoint**: Save progress after each task
6. **Cleanup**: Remove containers and temporary files
7. **Report**: Export results in requested format

### Resuming a Benchmark

1. **Load Checkpoint**: Restore previous state
2. **Skip Completed**: Don't re-run finished tasks
3. **Continue**: Process remaining tasks
4. **Merge Results**: Combine with previous results
5. **Report**: Export updated results

## Error Handling

The framework handles several error scenarios:

- **Container Creation Failures**: Log and skip task
- **Command Timeouts**: Mark as timeout, continue
- **Docker Not Available**: Exit with helpful message
- **Dataset Not Found**: Provide download instructions
- **Insufficient Resources**: Warn and attempt cleanup

## Performance Considerations

- **Docker Caching**: Reuse containers when possible
- **Parallel Execution**: Can run multiple containers (future feature)
- **Memory Limits**: Monitor Docker memory usage
- **Network**: Some tasks require internet access (git clone, pip install)

## Testing

Test individual components:

```typescript
// Test loader
const loader = new SWEBenchLoader();
const tasks = await loader.load({ dataset: 'swe-bench-lite' });

// Test Docker manager
const manager = new DockerManager();
const works = DockerManager.isDockerAvailable();

// Test evaluator
const result = await SWEBenchEvaluator.evaluate(...);

// Test formatter
const json = BenchmarkFormatter.toJSON(report);
```

## Extending the Framework

### Add New Benchmark

1. Create loader in `loaders/your-bench-loader.ts`
2. Implement `BenchmarkLoader` interface
3. Create evaluator in `evaluators/your-bench-evaluator.ts`
4. Register in loader factory
5. Update CLI to support new dataset

### Custom Docker Image

1. Create `Dockerfile` in `docker/your-bench/`
2. Configure in runner
3. Pass `docker_image` option to BenchmarkRunner

### Custom Result Format

Extend `BenchmarkFormatter`:

```typescript
class CustomFormatter extends BenchmarkFormatter {
  static toCustomFormat(report: BenchmarkReport): string {
    // Custom formatting logic
  }
}
```

## Troubleshooting

### Docker Issues

```bash
# Check Docker
docker ps

# Build image
docker build -t image-name -f Dockerfile .

# View logs
docker logs container-id
```

### Dataset Issues

```bash
# Check files exist
ls -la data/swe-bench-lite/

# Verify JSON format
head -1 data/swe-bench-lite/data.jsonl | python -m json.tool
```

### Runtime Issues

Enable verbose logging:

```typescript
const runner = new BenchmarkRunner({
  dataset: 'swe-bench-lite',
  verbose: true,
  ...
});
```

## References

- [SWE-bench Official](https://www.swebench.com/)
- [ARC-AGI Prize](https://arcprize.org/)
- [SWE-bench Paper](https://arxiv.org/abs/2310.06770)
- [Docker Documentation](https://docs.docker.com/)
