#!/usr/bin/env python
"""
Test script to reproduce the file upload permissions issue.

This script demonstrates that TemporaryUploadedFile files (large files) 
get 0o600 permissions while InMemoryUploadedFile files (small files)
get 0o644 permissions when using FileSystemStorage.
"""

import os
import sys
import tempfile
import shutil

# Add the django directory to the path
sys.path.insert(0, '../django')

import django
from django.conf import settings

# Configure minimal Django settings
settings.configure(
    DEBUG=True,
    SECRET_KEY='test-secret-key',
    DATABASES={},
    INSTALLED_APPS=[],
    ROOT_URLCONF='',
    MEDIA_ROOT=tempfile.mkdtemp(),
    MEDIA_URL='/media/',
    FILE_UPLOAD_TEMP_DIR=tempfile.mkdtemp(),
    FILE_UPLOAD_PERMISSIONS=0o644,
)

django.setup()

from django.core.files.storage import FileSystemStorage
from django.core.files.uploadedfile import TemporaryUploadedFile, InMemoryUploadedFile
from django.core.files.base import ContentFile

def test_permissions():
    """Test file permissions for both small and large uploads."""
    storage_dir = settings.MEDIA_ROOT
    temp_dir = settings.FILE_UPLOAD_TEMP_DIR
    
    try:
        storage = FileSystemStorage(location=storage_dir)
        
        # Test 1: Small file (InMemoryUploadedFile)
        print("Test 1: Small file (InMemoryUploadedFile)")
        small_content = ContentFile(b"Small file content")
        small_name = storage.save('small_test.txt', small_content)
        small_path = storage.path(small_name)
        small_perms = os.stat(small_path).st_mode & 0o777
        print(f"  Expected permissions: 0o644 (420)")
        print(f"  Actual permissions: 0o{oct(small_perms)[2:]} ({small_perms})")
        print(f"  Status: {'✓ PASS' if small_perms == 0o644 else '✗ FAIL'}")
        print()
        
        # Test 2: Large file (TemporaryUploadedFile)
        print("Test 2: Large file (TemporaryUploadedFile)")
        # Create a temporary file first
        temp_file = tempfile.NamedTemporaryFile(dir=temp_dir, delete=False, suffix='.txt')
        temp_file.write(b"Large file content that exceeds memory size")
        temp_file.flush()
        temp_file.close()
        
        # Create TemporaryUploadedFile wrapper
        # We need to create it properly to simulate Django's behavior
        try:
            from django.core.files import temp as django_temp
            # Actually use a real TemporaryUploadedFile
            large_uploaded = TemporaryUploadedFile(
                name='large_test.txt',
                content_type='text/plain',
                size=40,
                charset=None
            )
            # Write content to it
            large_uploaded.write(b"Large file content that exceeds memory size")
            large_uploaded.close()
            
            large_name = storage.save('large_test.txt', large_uploaded)
            large_path = storage.path(large_name)
            large_perms = os.stat(large_path).st_mode & 0o777
            print(f"  Expected permissions: 0o644 (420)")
            print(f"  Actual permissions: 0o{oct(large_perms)[2:]} ({large_perms})")
            print(f"  Status: {'✓ PASS' if large_perms == 0o644 else '✗ FAIL'}")
            print()
        finally:
            # Clean up temp file
            if os.path.exists(temp_file.name):
                os.unlink(temp_file.name)
        
        # Summary
        print("=" * 50)
        if small_perms == 0o644 and large_perms == 0o644:
            print("All tests PASSED ✓")
            return 0
        else:
            print("Tests FAILED ✗")
            print()
            print("Issue: File permissions are inconsistent between")
            print("  - InMemoryUploadedFile (small files): 0o644")
            print("  - TemporaryUploadedFile (large files): 0o600")
            print()
            print("This happens because:")
            print("  1. tempfile.NamedTemporaryFile creates files with 0o600")
            print("  2. When moved via os.rename(), permissions are preserved")
            print("  3. os.chmod() is not called on moved files")
            return 1
        
    finally:
        # Clean up
        if os.path.exists(storage_dir):
            shutil.rmtree(storage_dir)
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

if __name__ == '__main__':
    sys.exit(test_permissions())
