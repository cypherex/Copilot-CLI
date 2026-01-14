# Benchmark Quick Start Guide

Get up and running with SWE-bench and ARC-AGI-2 benchmarks in 5 minutes.

## Prerequisites

- Docker installed and running
- Python 3.11+ (for dataset downloads)
- Node.js 18+
- Git

## Setup (5 minutes)

### 1. Install HuggingFace CLI

```bash
pip install huggingface-hub
```

### 2. Download Datasets

**For SWE-bench:**
```bash
# Download SWE-bench-lite (recommended for testing)
huggingface-hub download SWE-bench/SWE-bench_Lite \
  --repo-type dataset \
  --local-dir ./data/swe-bench-lite

# Alternative: Download Verified variant
huggingface-hub download SWE-bench/SWE-bench_Verified \
  --repo-type dataset \
  --local-dir ./data/swe-bench-verified
```

**For ARC-AGI-2:**
```bash
# Clone the repository
git clone https://github.com/fchollet/ARC-AGI.git ./data/arc-agi-2
```

### 3. Build Docker Images

```bash
# Build SWE-bench environment
docker build -t copilot-cli-swe-bench \
  -f docker/swe-bench/Dockerfile .

# Build ARC environment
docker build -t copilot-cli-arc \
  -f docker/arc/Dockerfile .
```

### 4. Build CLI

```bash
npm install
npm run build
```

## Running Benchmarks

### Run SWE-bench on Sample Tasks

```bash
# List available datasets
node lib/index.js benchmark list

# Run on first 5 instances
node lib/index.js benchmark run \
  --dataset swe-bench-lite \
  --instances 0-5 \
  --output results/swe-bench-sample.json

# Run with custom timeout
node lib/index.js benchmark run \
  --dataset swe-bench-lite \
  --timeout 7200 \
  --output results/swe-bench.json
```

### Run ARC-AGI-2 on Sample Tasks

```bash
# Run first 10 tasks
node lib/index.js benchmark run \
  --dataset arc-agi-2 \
  --instances 0-10 \
  --output results/arc-sample.json
```

### Resume from Checkpoint

If your benchmark run was interrupted:

```bash
# Resume from last checkpoint
node lib/index.js benchmark run \
  --dataset swe-bench-lite \
  --resume .checkpoint-swe-bench-lite.json \
  --output results/swe-bench-lite.json
```

## Understanding Results

### JSON Report Format

```json
{
  "dataset": "swe-bench-lite",
  "total_instances": 300,
  "completed": 5,
  "passed": 2,
  "passed_rate": 0.4,
  "total_time_seconds": 1500,
  "average_time_per_task": 300,
  "average_iterations": 25,
  "timestamp": "2024-01-01T12:00:00Z",
  "results": [
    {
      "task_id": "django__django-12345",
      "status": "completed",
      "passed": true,
      "time_seconds": 250,
      "iterations": 20,
      "verification_passed": true
    }
  ]
}
```

### Metrics Explained

- **Pass Rate**: Percentage of instances/tasks successfully resolved
- **Avg Time/Task**: Average execution time per task (in seconds)
- **Avg Iterations**: Average number of agent iterations per task
- **Total Time**: Cumulative time spent on all tasks

## Example Usage Patterns

### Pattern 1: Quick Testing

Test benchmarks on small subset to verify setup:

```bash
# Test SWE-bench with 3 instances
node lib/index.js benchmark run \
  --dataset swe-bench-lite \
  --instances 0-3 \
  --timeout 600

# Test ARC with 5 tasks
node lib/index.js benchmark run \
  --dataset arc-agi-2 \
  --instances 0-5 \
  --timeout 300
```

### Pattern 2: Full Evaluation

Run comprehensive benchmark:

```bash
# Full SWE-bench-lite evaluation
node lib/index.js benchmark run \
  --dataset swe-bench-lite \
  --timeout 3600 \
  --output results/swe-bench-lite-full.json

# This will take several hours depending on number of instances
```

### Pattern 3: Incremental Testing

Run in batches with checkpoint recovery:

```bash
# Run batch 1
node lib/index.js benchmark run \
  --dataset swe-bench-lite \
  --instances 0-50 \
  --output results/batch1.json

# Run batch 2 (will resume if interrupted)
node lib/index.js benchmark run \
  --dataset swe-bench-lite \
  --instances 50-100 \
  --resume .checkpoint-swe-bench-lite.json \
  --output results/batch2.json
```

## Troubleshooting

### Docker Not Found

```
❌ Docker is not available
```

**Solution**: Ensure Docker is installed and running
```bash
docker --version  # Should show version
docker ps         # Should list running containers
```

### Dataset Not Found

```
⚠️ Dataset cache not found
```

**Solution**: Download datasets following setup instructions above

### Container Fails to Start

```
Error: Failed to create container
```

**Solution**: Check Docker images are built
```bash
docker images | grep copilot-cli
```

### Out of Memory

If containers run out of memory, increase Docker's memory limit in Docker Desktop settings.

### Timeout Issues

If tasks are timing out, increase timeout:
```bash
node lib/index.js benchmark run \
  --dataset swe-bench-lite \
  --timeout 7200  # 2 hours instead of default 1 hour
```

## Performance Tips

1. **Use SWE-bench-lite** for initial testing (300 instances vs 2,294)
2. **Start with small batches** (5-10 instances) to debug issues
3. **Keep checkpoints** for long runs - enables resuming if interrupted
4. **Monitor Docker memory** during execution
5. **Run during off-hours** for large-scale evaluations

## Understanding Agent Behavior

The benchmark runs the Copilot CLI agent on each task. The agent will:

1. **For SWE-bench**:
   - Clone the repository at the base commit
   - Install dependencies
   - Run reproduction to see failing tests
   - Attempt to fix the issue by editing files
   - Verify the fix runs successfully

2. **For ARC-AGI-2** (when agent integration complete):
   - Analyze training examples to understand the pattern
   - Write Python code to implement the transformation
   - Test on training examples
   - Submit predictions for test inputs

## Next Steps

- Read [BENCHMARK_SETUP.md](./BENCHMARK_SETUP.md) for detailed architecture
- Check [examples/](../examples/run-benchmark.ts) for programmatic usage
- Review results in JSON format for detailed analysis
- Export to CSV for spreadsheet analysis

## Command Reference

```bash
# See all options
node lib/index.js benchmark --help

# List datasets
node lib/index.js benchmark list

# Run benchmark
node lib/index.js benchmark run [options]
  --dataset <name>        Dataset: swe-bench|swe-bench-lite|swe-bench-verified|arc-agi-2
  --instances <range>     Instances: e.g., "0-10" or "django-123"
  --output <path>         Save results to JSON/CSV file
  --timeout <seconds>     Timeout per task (default: 3600)
  --resume <checkpoint>   Resume from checkpoint file
  --verbose               Verbose output
```

## Getting Help

For issues or questions:
1. Check troubleshooting section above
2. Review logs in `.checkpoint-*.json` files
3. Check Docker logs: `docker logs <container_id>`
4. Open issue on GitHub with error message and benchmark details
