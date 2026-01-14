#!/usr/bin/env python
"""
Simplified test to demonstrate the permissions issue.
This focuses on the core problem without full Django setup.
"""

import os
import tempfile
import shutil

def test_tempfile_permissions():
    """Demonstrate that tempfile.NamedTemporaryFile creates files with 0o600."""
    
    print("Demonstrating the root cause of the issue:")
    print("=" * 60)
    print()
    
    # Create a temporary file using tempfile.NamedTemporaryFile
    with tempfile.NamedTemporaryFile(mode='w+b', delete=False) as tmp:
        tmp_name = tmp.name
        tmp.write(b"test content")
    
    # Check its permissions
    perms = os.stat(tmp_name).st_mode & 0o777
    print(f"tempfile.NamedTemporaryFile creates files with permissions: 0o{oct(perms)[2:]} ({perms})")
    print(f"Expected for Django uploads: 0o644 (420)")
    print()
    
    # Simulate Django's file_move_safe using os.rename
    dest_dir = tempfile.mkdtemp()
    dest_path = os.path.join(dest_dir, 'test.txt')
    
    try:
        os.rename(tmp_name, dest_path)
        moved_perms = os.stat(dest_path).st_mode & 0o777
        print(f"After os.rename(), file has permissions: 0o{oct(moved_perms)[2:]} ({moved_perms})")
        print()
        
        if moved_perms != 0o644:
            print("✗ ISSUE CONFIRMED:")
            print("  - Temporary files have 0o600 permissions")
            print("  - os.rename() preserves these permissions")
            print("  - os.chmod() needs to be called to set correct permissions")
            print()
            print("  This is why large files (TemporaryUploadedFile) get 0o600")
            print("  while small files (InMemoryUploadedFile) get 0o644")
            return 1
        else:
            print("✓ Issue not reproduced (permissions are correct)")
            return 0
    finally:
        # Clean up
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        if os.path.exists(dest_path):
            os.unlink(dest_path)
        os.rmdir(dest_dir)

if __name__ == '__main__':
    import sys
    sys.exit(test_tempfile_permissions())
