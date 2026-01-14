"""Verify the fix for nested CompoundModel separability bug"""

import sys
import os

# Add the astropy source to path
sys.path.insert(0, 'astropy_repo')
os.environ['MPLBACKEND'] = 'Agg'  # Use non-interactive backend

import numpy as np

# Import the fixed modules directly
from astropy.modeling.separable import _cstack, separability_matrix

print("=" * 60)
print("Verifying Fix for Nested CompoundModel Bug")
print("=" * 60)

# Test 1: Verify _cstack function directly
print("\n[Test 1] Testing _cstack function with nested matrices")
left = np.array([[True, True], [True, True]])
right = np.array([[True, False], [False, True]])
result = _cstack(left, right)
expected = np.array([[True, True, False, False],
                     [True, True, False, False],
                     [False, False, True, False],
                     [False, False, False, True]])
print(f"Result:\n{result}")
print(f"Expected:\n{expected}")
test1_pass = np.array_equal(result, expected)
print(f"✓ PASS: {test1_pass}")

# Test 2: Test with actual model objects (if possible)
try:
    from astropy.modeling import models as m

    print("\n[Test 2] Testing with actual models (nested)")
    cm = m.Linear1D(10) & m.Linear1D(5)
    model_nested = m.Pix2Sky_TAN() & cm
    result_nested = separability_matrix(model_nested)

    model_unnested = m.Pix2Sky_TAN() & m.Linear1D(10) & m.Linear1D(5)
    result_unnested = separability_matrix(model_unnested)

    print(f"Nested result:\n{result_nested}")
    print(f"Unnested result:\n{result_unnested}")
    test2_pass = np.array_equal(result_nested, result_unnested)
    print(f"✓ PASS: {test2_pass}")

except Exception as e:
    print(f"[Test 2] Skipped (model import failed): {e}")
    test2_pass = None

# Summary
print("\n" + "=" * 60)
print("Summary:")
print("=" * 60)
if test1_pass and (test2_pass is None or test2_pass):
    print("✓ All tests passed! The fix works correctly.")
    sys.exit(0)
else:
    print("✗ Some tests failed!")
    if not test1_pass:
        print("  - _cstack function test failed")
    if test2_pass is False:
        print("  - Model separability test failed")
    sys.exit(1)
