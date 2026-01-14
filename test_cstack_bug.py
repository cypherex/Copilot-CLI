"""Minimal test to demonstrate the bug in _cstack function"""

import numpy as np

# Copy the buggy _cstack function from astropy/modeling/separable.py
def _cstack_buggy(left, right):
    """Original buggy version"""
    # Compute noutp (total outputs)
    if isinstance(left, np.ndarray):
        lnout = left.shape[0]
    else:
        lnout = left.n_outputs
    if isinstance(right, np.ndarray):
        rnout = right.shape[0]
    else:
        rnout = right.n_outputs
    noutp = lnout + rnout

    # For this test, left and right are arrays (coord matrices)
    cleft = np.zeros((noutp, left.shape[1]))
    cleft[: left.shape[0], : left.shape[1]] = left

    cright = np.zeros((noutp, right.shape[1]))
    # BUG: This line assigns 1 instead of the actual right matrix!
    cright[-right.shape[0]:, -right.shape[1]:] = 1

    return np.hstack([cleft, cright])


def _cstack_fixed(left, right):
    """Fixed version"""
    # Compute noutp (total outputs)
    if isinstance(left, np.ndarray):
        lnout = left.shape[0]
    else:
        lnout = left.n_outputs
    if isinstance(right, np.ndarray):
        rnout = right.shape[0]
    else:
        rnout = right.n_outputs
    noutp = lnout + rnout

    # For this test, left and right are arrays (coord matrices)
    cleft = np.zeros((noutp, left.shape[1]))
    cleft[: left.shape[0], : left.shape[1]] = left

    cright = np.zeros((noutp, right.shape[1]))
    # FIX: Use the actual right matrix instead of 1
    cright[-right.shape[0]:, -right.shape[1]:] = right

    return np.hstack([cleft, cright])


print("=" * 60)
print("Testing _cstack function bug")
print("=" * 60)

# Simulate the scenario from the bug report
# When computing Pix2Sky_TAN() & (Linear1D(10) & Linear1D(5))
# The right part (Linear1D(10) & Linear1D(5)) has already been computed
# and its coord_matrix is a 2x2 diagonal matrix
right_matrix = np.array([[True, False],
                        [False, True]])

# Left part is Pix2Sky_TAN() with a 2x2 matrix (all True because it's not separable)
left_matrix = np.array([[True, True],
                       [True, True]])

print("\nLeft matrix (Pix2Sky_TAN):")
print(left_matrix)
print("\nRight matrix (Linear1D(10) & Linear1D(5)):")
print(right_matrix)

print("\n" + "=" * 60)
print("BUGGY VERSION:")
print("=" * 60)
result_buggy = _cstack_buggy(left_matrix, right_matrix)
print("Result:")
print(result_buggy)

expected = np.array([[True, True, False, False],
                     [True, True, False, False],
                     [False, False, True, False],
                     [False, False, False, True]])
print("\nExpected:")
print(expected)
print(f"\nBUGGY matches expected: {np.array_equal(result_buggy, expected)}")

print("\n" + "=" * 60)
print("FIXED VERSION:")
print("=" * 60)
result_fixed = _cstack_fixed(left_matrix, right_matrix)
print("Result:")
print(result_fixed)
print("\nExpected:")
print(expected)
print(f"\nFIXED matches expected: {np.array_equal(result_fixed, expected)}")

# Show the difference
print("\n" + "=" * 60)
print("DIFFERENCE:")
print("=" * 60)
diff = result_buggy != result_fixed
if np.any(diff):
    print(f"Positions where buggy and fixed differ:")
    print(diff.astype(int))
    print(f"\nBuggy values at those positions:")
    print(result_buggy[diff])
    print(f"\nFixed values at those positions:")
    print(result_fixed[diff])

# Check specifically the last two rows which should be diagonal
print("\n" + "=" * 60)
print("VERIFICATION OF BUG:")
print("=" * 60)
print("Last two rows should be diagonal (separable outputs):")
print(f"  Row 2 should be: [False, False, True, False]")
print(f"  Row 3 should be: [False, False, False, True]")
print(f"\nBuggy row 2: {result_buggy[2]}")
print(f"Buggy row 3: {result_buggy[3]}")
print(f"\nFixed row 2: {result_fixed[2]}")
print(f"Fixed row 3: {result_fixed[3]}")
