"""Download SWE-bench-lite dataset and convert to JSONL format."""

import json
from pathlib import Path

try:
    from datasets import load_dataset
except ImportError:
    print("Installing datasets library...")
    import subprocess
    subprocess.check_call(["pip", "install", "-q", "datasets"])
    from datasets import load_dataset

output_dir = Path(".benchmark-cache")
output_dir.mkdir(exist_ok=True)
output_file = output_dir / "swe-bench-lite.jsonl"

print("📥 Downloading SWE-bench-lite from HuggingFace...")
dataset = load_dataset("SWE-bench/SWE-bench_Lite")

print(f"   Loaded dataset: {len(dataset)} splits")
if isinstance(dataset, dict):
    # If it's a dict of splits, take the default split
    data = dataset.get('train') or list(dataset.values())[0]
else:
    data = dataset

print(f"   Total instances: {len(data)}")

# Convert to JSONL format
print(f"💾 Writing to {output_file}...")
with open(output_file, 'w') as f:
    for i, instance in enumerate(data):
        # Ensure it has the right structure
        f.write(json.dumps(instance) + '\n')
        if (i + 1) % 50 == 0:
            print(f"   Wrote {i + 1} instances...")

print(f"✅ Complete! Wrote {len(data)} instances to {output_file}")

# Verify
line_count = sum(1 for _ in open(output_file))
print(f"✓ Verification: {line_count} lines in JSONL file")
