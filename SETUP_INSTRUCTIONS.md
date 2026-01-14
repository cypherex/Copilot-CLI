# SWE-bench Test Setup Status

## ✅ Completed

1. **Dataset**: Created sample SWE-bench-lite test data
   - Location: `./data/swe-bench-lite/data.jsonl`
   - Instances: 5 sample tasks (django, flask, requests, scikit-learn)
   - Ready for testing

2. **Code**: All benchmark infrastructure is in place
   - Loaders: ✓ Working
   - Evaluators: ✓ Ready
   - Formatters: ✓ Ready
   - CLI: ✓ Built into CLI

## ⏳ Next: Start Docker

**Docker Desktop is installed but not running.**

### On Windows 10/11:

1. **Option A**: Start Docker Desktop GUI
   - Click Start Menu → Search "Docker Desktop"
   - Click to launch Docker Desktop
   - Wait for "Engine running" notification (1-2 minutes)

2. **Option B**: Start Docker service via PowerShell (Admin)
   ```powershell
   Start-Service docker
   # Or if using WSL2:
   wsl -d docker-desktop
   ```

3. **Verify Docker is running**:
   ```bash
   docker ps
   # Should show "CONTAINER ID IMAGE COMMAND..."
   ```

## 🏗️ Build Docker Images

Once Docker is running, execute:

```bash
# Build SWE-bench environment
docker build -t copilot-cli-swe-bench -f docker/swe-bench/Dockerfile .

# Build ARC environment (optional for now)
docker build -t copilot-cli-arc -f docker/arc/Dockerfile .
```

This will take 3-5 minutes for each image.

## 🏃 Run Benchmark Test

After Docker images are built:

```bash
# Build TypeScript
npm run build

# Run test on 5 instances
node lib/cli/index.js benchmark run \
  --dataset swe-bench-lite \
  --instances 0-5 \
  --timeout 600 \
  --output results/test-run.json \
  --verbose
```

## 📊 Expected Results

- Each instance will take 2-5 minutes to process
- Total test run: ~15-30 minutes
- Results saved to: `results/test-run.json`

## 🛠️ Troubleshooting

### Docker won't start
- Check Windows Hyper-V is enabled (Settings → Programs → Turn Windows features on or off)
- Restart Docker Desktop
- Check Event Viewer for errors

### Out of memory
- Increase Docker Desktop memory: Settings → Resources → Memory (set to 4GB+)

### Network issues
- Some repos require internet access (git clone, pip install)
- Check firewall isn't blocking Docker

## File Locations

```
├── docker/
│   ├── swe-bench/Dockerfile        # SWE-bench image definition
│   └── arc/Dockerfile              # ARC image definition
├── data/
│   └── swe-bench-lite/
│       └── data.jsonl              # Test instances
├── src/benchmarks/
│   ├── types.ts                    # Type definitions
│   ├── loaders/                    # Dataset loaders
│   ├── evaluators/                 # Result evaluators
│   ├── harness/runner.ts          # Main orchestrator
│   ├── docker/manager.ts          # Docker utilities
│   └── reports/formatter.ts       # Results export
└── src/cli/commands/
    └── benchmark.ts               # CLI command
```

---

**Ready to proceed? Start Docker and run the commands above!**
