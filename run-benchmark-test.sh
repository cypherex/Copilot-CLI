#!/bin/bash

# SWE-bench Benchmark Quick Test
# Tests the benchmark infrastructure on 5 sample instances

set -e

echo "=========================================="
echo "SWE-bench Quick Test"
echo "=========================================="
echo ""

# Create output directory
mkdir -p results

# Check Docker is running
echo "✓ Checking Docker..."
if ! docker ps > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop."
    exit 1
fi
echo "  Docker is running"
echo ""

# Check Docker images exist
echo "✓ Checking Docker images..."
if ! docker images | grep -q copilot-cli-swe-bench; then
    echo "❌ Docker image 'copilot-cli-swe-bench' not found."
    echo "   Build with: docker build -t copilot-cli-swe-bench -f docker/swe-bench/Dockerfile ."
    exit 1
fi
echo "  Image 'copilot-cli-swe-bench' found"
echo ""

# Check dataset exists
echo "✓ Checking dataset..."
if [ ! -f "./data/swe-bench-lite/data.jsonl" ]; then
    echo "❌ Dataset not found at ./data/swe-bench-lite/data.jsonl"
    exit 1
fi

INSTANCE_COUNT=$(wc -l < ./data/swe-bench-lite/data.jsonl)
echo "  Found $INSTANCE_COUNT instances"
echo ""

# Run benchmark
echo "🚀 Starting benchmark test..."
echo "   Dataset: swe-bench-lite"
echo "   Instances: 0-4 (5 tasks)"
echo "   Timeout: 600s per task"
echo ""

node dist/cli/index.js benchmark run \
  --dataset swe-bench-lite \
  --instances 0-4 \
  --timeout 600 \
  --output results/swe-bench-lite-test.json \
  --verbose

echo ""
echo "=========================================="
echo "✨ Benchmark Complete!"
echo "=========================================="
echo ""
echo "Results saved to: results/swe-bench-lite-test.json"

if [ -f "results/swe-bench-lite-test.json" ]; then
    echo ""
    echo "📊 Results Summary:"
    echo ""
    node << 'JSEOF'
const fs = require('fs');
const report = JSON.parse(fs.readFileSync('results/swe-bench-lite-test.json', 'utf-8'));
console.log(`  Dataset: ${report.dataset}`);
console.log(`  Total: ${report.total_instances}`);
console.log(`  Completed: ${report.completed}`);
console.log(`  Passed: ${report.passed}`);
console.log(`  Pass Rate: ${(report.passed_rate * 100).toFixed(1)}%`);
console.log(`  Avg Time: ${report.average_time_per_task.toFixed(1)}s`);
JSEOF
fi
