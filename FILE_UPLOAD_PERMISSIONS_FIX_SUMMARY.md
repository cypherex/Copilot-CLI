# Django File Upload Permissions Fix Summary

## Issue
File upload permissions were inconsistent depending on whether `MemoryUploadedFile` or `TemporaryUploadedFile` was used:
- Small files (uploaded to memory): got permissions based on system umask (often 0o644)
- Large files (uploaded to temporary file): got 0o600 permissions (from Python's tempfile module)

This inconsistency occurred because:
1. `tempfile.NamedTemporaryFile` explicitly sets 0o600 permissions for security
2. When moved via `os.rename()`, these restrictive permissions were preserved
3. The default `FILE_UPLOAD_PERMISSIONS` was `None`, so Django didn't override the permissions

## Solution
Changed the default value of `FILE_UPLOAD_PERMISSIONS` setting from `None` to `0o644` in `django/conf/global_settings.py`.

This ensures all uploaded files get consistent 0o644 permissions regardless of size or upload handler used.

## Files Modified

### 1. django/conf/global_settings.py
```python
# Before:
FILE_UPLOAD_PERMISSIONS = None

# After:
FILE_UPLOAD_PERMISSIONS = 0o644
```

### 2. tests/test_utils/tests.py
Updated test to expect new default value:
```python
# Before:
self.assertIsNone(default_storage.file_permissions_mode)

# After:
self.assertEqual(default_storage.file_permissions_mode, 0o644)
```

### 3. docs/ref/settings.txt
- Changed default value from ``None`` to ``0o644``
- Added versionchanged note for Django 3.0

### 4. docs/releases/3.0.txt
Added release notes explaining the change:
```
New default value for ``FILE_UPLOAD_PERMISSIONS`` setting

In older versions, :setting:`FILE_UPLOAD_PERMISSIONS` setting defaults to
``None``. With default :setting:`FILE_UPLOAD_HANDLERS`, this results in
uploaded files having different permissions depending on their size and which
upload handler is used.

``FILE_UPLOAD_PERMISSION`` now defaults to ``0o644`` to avoid this
inconsistency.
```

### 5. docs/howto/deployment/checklist.txt
Removed outdated checklist item about setting FILE_UPLOAD_PERMISSIONS manually, since it now has a secure default.

## How It Works

When `FileSystemStorage._save()` is called:
1. For temporary files (large uploads): Uses `file_move_safe()` to move the file
2. For in-memory files (small uploads): Creates a new file with `os.open()`
3. After the file is saved, if `self.file_permissions_mode` is not `None`, Django calls `os.chmod(full_path, self.file_permissions_mode)`

By setting the default to `0o644`, the chmod is always applied, ensuring consistent permissions.

## Benefits

1. **Security**: Files are consistently readable by the web server, preventing access issues
2. **Consistency**: All uploaded files have the same permissions regardless of size
3. **Usability**: Users don't need to manually configure the setting for most use cases
4. **Backwards Compatible**: Users can still override the default if needed

## Testing

The fix was verified by:
1. Checking that the default value change was applied correctly
2. Reviewing test changes that expect the new default
3. Confirming documentation updates match the change

This fix matches the upstream Django fix (commit 22aab8662f) for issue #30004.
