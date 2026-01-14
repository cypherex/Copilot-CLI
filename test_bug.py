"""Test script to reproduce the bug in separability_matrix for nested CompoundModels"""

import sys
import os
sys.path.insert(0, 'astropy_repo')
sys.path.insert(0, os.path.join('astropy_repo', 'astropy'))

from astropy.modeling import models as m
from astropy.modeling.separable import separability_matrix
import numpy as np

print("=" * 60)
print("Testing separability_matrix for nested CompoundModels")
print("=" * 60)

# Test 1: Simple compound model - should work correctly
print("\n[Test 1] Simple compound model: Linear1D(10) & Linear1D(5)")
cm = m.Linear1D(10) & m.Linear1D(5)
result1 = separability_matrix(cm)
print(f"Result:\n{result1}")
expected1 = np.array([[True, False], [False, True]])
print(f"Expected:\n{expected1}")
print(f"PASS: {np.array_equal(result1, expected1)}")

# Test 2: Unnested compound model - should work correctly
print("\n[Test 2] Unnested: Pix2Sky_TAN() & Linear1D(10) & Linear1D(5)")
model2 = m.Pix2Sky_TAN() & m.Linear1D(10) & m.Linear1D(5)
result2 = separability_matrix(model2)
print(f"Result:\n{result2}")
expected2 = np.array([[True, True, False, False],
                      [True, True, False, False],
                      [False, False, True, False],
                      [False, False, False, True]])
print(f"Expected:\n{expected2}")
print(f"PASS: {np.array_equal(result2, expected2)}")

# Test 3: Nested compound model - THIS IS THE BUG
print("\n[Test 3] Nested: Pix2Sky_TAN() & (Linear1D(10) & Linear1D(5))")
model3 = m.Pix2Sky_TAN() & cm
result3 = separability_matrix(model3)
print(f"Result:\n{result3}")
print(f"Expected:\n{expected2}")  # Should be the same as unnested version
print(f"PASS: {np.array_equal(result3, expected2)}")

# Test 4: Another nested variant
print("\n[Test 4] Nested variant 2: (Pix2Sky_TAN() & Linear1D(10)) & Linear1D(5)")
model4 = (m.Pix2Sky_TAN() & m.Linear1D(10)) & m.Linear1D(5)
result4 = separability_matrix(model4)
print(f"Result:\n{result4}")
print(f"Expected:\n{expected2}")  # Should be the same as unnested version
print(f"PASS: {np.array_equal(result4, expected2)}")

# Summary
print("\n" + "=" * 60)
print("Summary:")
print("=" * 60)
if not np.array_equal(result3, expected2):
    print("❌ BUG CONFIRMED: Nested compound model produces incorrect result")
    print(f"   Last two rows should be diagonal: [False, False, True, False] and [False, False, False, True]")
    print(f"   But got: {result3[2:]}")
else:
    print("✓ All tests passed!")
