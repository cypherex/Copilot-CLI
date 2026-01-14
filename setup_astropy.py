"""Setup astropy repository for fixing the bug"""

import subprocess
import sys
from pathlib import Path

# Configuration
REPO_URL = "https://github.com/astropy/astropy.git"
BASE_COMMIT = "d16bfe05a744909de4b27f5875fe0d4ed41ce607"
REPO_DIR = Path("astropy_repo")

def run_command(cmd, cwd=None, check=True):
    """Run a shell command"""
    print(f"Running: {cmd}")
    result = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    if check and result.returncode != 0:
        print(f"ERROR: {result.stderr}")
        sys.exit(1)
    return result

def main():
    print("=" * 60)
    print("Setting up astropy repository for bug fix")
    print("=" * 60)

    # Clone if not exists
    if not REPO_DIR.exists():
        print(f"\n[*] Cloning astropy repository...")
        run_command(f"git clone {REPO_URL} {REPO_DIR}")
    else:
        print(f"\n[*] Repository already exists at {REPO_DIR}")

    # Checkout base commit
    print(f"\n[*] Checking out base commit: {BASE_COMMIT}")
    run_command(f"git checkout {BASE_COMMIT}", cwd=REPO_DIR)

    print("\n[OK] Repository setup complete!")
    print(f"    Location: {REPO_DIR.absolute()}")
    print(f"    Commit: {BASE_COMMIT}")

if __name__ == "__main__":
    main()
