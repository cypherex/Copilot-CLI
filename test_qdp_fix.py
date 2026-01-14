"""Quick test to verify QDP case-insensitive fix works"""
import sys
sys.path.insert(0, 'astropy_repo')

# Import the function we need to test
from astropy.io.ascii.qdp import _line_type

# Test with uppercase (should work before and after fix)
result_upper = _line_type("READ SERR 1 2")
print(f"Uppercase 'READ SERR 1 2': {result_upper}")
assert result_upper == 'command', f"Expected 'command', got {result_upper}"

# Test with lowercase (should fail before fix, work after)
try:
    result_lower = _line_type("read serr 1 2")
    print(f"Lowercase 'read serr 1 2': {result_lower}")
    assert result_lower == 'command', f"Expected 'command', got {result_lower}"
    print("✓ Lowercase commands work!")
except ValueError as e:
    print(f"✗ Lowercase commands failed: {e}")
    sys.exit(1)

# Test with mixed case (should fail before fix, work after)
try:
    result_mixed = _line_type("ReAd TeRr 1 2")
    print(f"Mixed case 'ReAd TeRr 1 2': {result_mixed}")
    assert result_mixed == 'command', f"Expected 'command', got {result_mixed}"
    print("✓ Mixed case commands work!")
except ValueError as e:
    print(f"✗ Mixed case commands failed: {e}")
    sys.exit(1)

# Test that data still works
result_data = _line_type("1 0.5 1 0.5")
print(f"Data '1 0.5 1 0.5': {result_data}")
assert result_data == 'data,4', f"Expected 'data,4', got {result_data}"

print("\n✓ All tests passed! The fix works correctly.")
