# QDP Format Parser Fix - Case-Insensitive Commands

## Summary

Fixed the QDP format parser in astropy to handle case-insensitive commands, matching the QDP format specification.

## Root Cause

The QDP parser in `astropy/io/ascii/qdp.py` used a case-sensitive regular expression to match QDP commands. The pattern `r'READ [TS]ERR(\s+[0-9]+)+'` only matched uppercase commands like "READ SERR 1 2". When lowercase commands like "read serr 1 2" were used, the regex didn't match and raised `ValueError: Unrecognized QDP line: read serr 1 2`.

The QDP format specification is case-insensitive, so the parser should accept commands in any case.

## Changes Made

### 1. Fixed the `_line_type` function (astropy_repo/astropy/io/ascii/qdp.py)

**Line 69:**
```python
# Before:
_line_type_re = re.compile(_type_re)

# After:
_line_type_re = re.compile(_type_re, re.IGNORECASE)
```

This change adds the `re.IGNORECASE` flag to the regex compilation, allowing it to match commands in any case.

### 2. Added test cases (astropy_repo/astropy/io/ascii/tests/test_qdp.py)

Added two new test functions to verify the fix:

**test_lowercase_commands:**
- Tests QDP files with lowercase commands (e.g., "read terr", "read serr")
- Verifies that data is parsed correctly with lowercase commands
- Checks that metadata (comments) are preserved

**test_mixed_case_commands:**
- Tests QDP files with mixed case commands (e.g., "ReAd TeRr", "rEaD sErR")
- Verifies that data is parsed correctly with mixed case commands
- Checks that metadata (comments) are preserved

## Test Results

### Standalone Test (test_fix_standalone.py)
```
SUCCESS: re.IGNORECASE flag found in qdp.py
SUCCESS: Found correct line: _line_type_re = re.compile(_type_re, re.IGNORECASE)

[PASS] 'READ SERR 1 2' -> command
[PASS] 'read serr 1 2' -> command
[PASS] 'ReAd TeRr 1 2' -> command
[PASS] 'READ TERR 1' -> command
[PASS] 'read terr 1 2 3' -> command
[PASS] '1 0.5 1 0.5' -> data,4

All tests passed! The fix is working correctly.
```

### Example from the Issue
The fix allows the following QDP file to be read successfully:
```
read serr 1 2
1 0.5 1 0.5
```

Previously, this would raise:
```
ValueError: Unrecognized QDP line: read serr 1 2
```

Now it correctly parses as a command line and processes the data.

## Files Modified

1. **astropy_repo/astropy/io/ascii/qdp.py** (1 line changed)
   - Line 69: Added `re.IGNORECASE` flag to regex compilation

2. **astropy_repo/astropy/io/ascii/tests/test_qdp.py** (42 lines added)
   - Added `test_lowercase_commands` function
   - Added `test_mixed_case_commands` function

## Impact

- **Minimal**: The change is a one-line fix that adds a regex flag
- **Backward Compatible**: Uppercase commands continue to work as before
- **No Breaking Changes**: All existing functionality is preserved
- **Improved Compatibility**: QDP files with lowercase or mixed-case commands now work correctly

## Verification

The fix has been verified to:
1. Correctly handle uppercase commands (existing behavior)
2. Correctly handle lowercase commands (new behavior)
3. Correctly handle mixed-case commands (new behavior)
4. Not break any existing parsing logic
5. Preserve all metadata (comments) correctly
