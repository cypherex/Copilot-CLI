"""
Final verification of the bug fix for nested CompoundModel separability.
This script demonstrates the before/after behavior.
"""

import numpy as np

print("=" * 70)
print("VERIFICATION: Bug Fix for Nested CompoundModel Separability")
print("=" * 70)

def _cstack_buggy(left, right):
    """Original buggy implementation"""
    # Compute total outputs
    lnout = left.shape[0] if isinstance(left, np.ndarray) else left.n_outputs
    rnout = right.shape[0] if isinstance(right, np.ndarray) else right.n_outputs
    noutp = lnout + rnout

    # Left side
    cleft = np.zeros((noutp, left.shape[1]))
    cleft[: left.shape[0], : left.shape[1]] = left

    # Right side - BUG: assigns 1 instead of the actual matrix
    cright = np.zeros((noutp, right.shape[1]))
    cright[-right.shape[0]:, -right.shape[1]:] = 1  # ← BUG HERE

    return np.hstack([cleft, cright])


def _cstack_fixed(left, right):
    """Fixed implementation"""
    # Compute total outputs
    lnout = left.shape[0] if isinstance(left, np.ndarray) else left.n_outputs
    rnout = right.shape[0] if isinstance(right, np.ndarray) else right.n_outputs
    noutp = lnout + rnout

    # Left side
    cleft = np.zeros((noutp, left.shape[1]))
    cleft[: left.shape[0], : left.shape[1]] = left

    # Right side - FIX: uses the actual matrix
    cright = np.zeros((noutp, right.shape[1]))
    cright[-right.shape[0]:, -right.shape[1]:] = right  # ← FIXED

    return np.hstack([cleft, cright])


# Test scenario: Pix2Sky_TAN() & (Linear1D(10) & Linear1D(5))
print("\nTest Scenario: Pix2Sky_TAN() & (Linear1D(10) & Linear1D(5))")
print("-" * 70)

# Pix2Sky_TAN coordinate matrix (2x2, all True because it's not separable)
pix2sky = np.array([[True, True], [True, True]])

# (Linear1D(10) & Linear1D(5)) coordinate matrix (2x2 diagonal because it's separable)
linear_cm = np.array([[True, False], [False, True]])

print("\nPix2Sky_TAN matrix (non-separable):")
print(pix2sky)
print("\n(Linear1D(10) & Linear1D(5)) matrix (separable, diagonal):")
print(linear_cm)

# Compute results
result_buggy = _cstack_buggy(pix2sky, linear_cm)
result_fixed = _cstack_fixed(pix2sky, linear_cm)

print("\n" + "=" * 70)
print("BUGGY VERSION RESULT:")
print("=" * 70)
print(result_buggy)
print("\nIssue: Last two rows are [0, 0, 1, 1] instead of diagonal!")
print("This incorrectly indicates the last two outputs are NOT separable.")

print("\n" + "=" * 70)
print("FIXED VERSION RESULT:")
print("=" * 70)
print(result_fixed)
print("\nCorrect: Last two rows are [0, 0, 1, 0] and [0, 0, 0, 1] (diagonal)!")
print("This correctly indicates the last two outputs ARE separable.")

# Verify the fix
expected = np.array([[True, True, False, False],
                     [True, True, False, False],
                     [False, False, True, False],
                     [False, False, False, True]])

print("\n" + "=" * 70)
print("VERIFICATION:")
print("=" * 70)
buggy_matches = np.array_equal(result_buggy, expected)
fixed_matches = np.array_equal(result_fixed, expected)

print(f"Buggy version matches expected: {buggy_matches}")
print(f"Fixed version matches expected: {fixed_matches}")

if not buggy_matches and fixed_matches:
    print("\n[SUCCESS] Bug is fixed! The correct behavior is restored.")
elif buggy_matches:
    print("\n[ERROR] Buggy version somehow matches - something is wrong!")
else:
    print("\n[ERROR] Fix didn't work as expected!")

# Show the specific difference
print("\n" + "=" * 70)
print("DETAILED COMPARISON:")
print("=" * 70)
print("\nDifference between buggy and fixed:")
diff = (result_buggy != result_fixed)
print(diff.astype(int))

print("\nValues in buggy version (where different):")
print(result_buggy[diff])

print("\nValues in fixed version (where different):")
print(result_fixed[diff])

print("\n" + "=" * 70)
print("CONCLUSION:")
print("=" * 70)
print("The bug was a single-character change in _cstack():")
print("  BEFORE: cright[...] = 1")
print("  AFTER:  cright[...] = right")
print("\nThis preserves the coordinate matrix from nested CompoundModels,")
print("ensuring the diagonal pattern (separability) is correctly maintained.")
print("=" * 70)
