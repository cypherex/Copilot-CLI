# Bug Fix Summary: Nested CompoundModel Separability

## Issue
Modeling's `separability_matrix` does not compute separability correctly for nested CompoundModels.

### Problem Description
When using nested CompoundModels like `separability_matrix(m.Pix2Sky_TAN() & cm)` where `cm = m.Linear1D(10) & m.Linear1D(5)`, the result incorrectly shows the last two outputs as not separable (both True for both outputs) instead of the expected diagonal pattern.

**Incorrect Result (Buggy):**
```
[[ True,  True, False, False],
 [ True,  True, False, False],
 [False, False,  True,  True],  # ← Wrong! Should be [False, False, True, False]
 [False, False,  True,  True]]  # ← Wrong! Should be [False, False, False, True]
```

**Expected Result (Correct):**
```
[[ True,  True, False, False],
 [ True,  True, False, False],
 [False, False,  True, False],  # ← Diagonal
 [False, False, False,  True]]  # ← Diagonal
```

## Root Cause
In the `_cstack` function in `astropy/modeling/separable.py`, when combining two coordinate matrices with the `&` operator:

```python
# Buggy code (line 245):
cright[-right.shape[0]:, -right.shape[1]:] = 1
```

This line incorrectly assigns the scalar value `1` (or True) to the entire right block, instead of using the actual `right` coordinate matrix. This causes the function to lose the diagonal pattern that indicates separability when the right operand is itself a nested compound model.

## Fix
Changed line 245 in `astropy/modeling/separable.py`:

```python
# Fixed code:
cright[-right.shape[0]:, -right.shape[1]:] = right
```

This ensures that the actual coordinate matrix from the right operand is preserved, maintaining the diagonal pattern for separable outputs.

## Files Modified

### 1. `astropy/modeling/separable.py`
**Function:** `_cstack(left, right)`
**Line:** 245
**Change:** Changed assignment from `1` to `right`

```diff
def _cstack(left, right):
    """..."""
    noutp = _compute_n_outputs(left, right)

    if isinstance(left, Model):
        cleft = _coord_matrix(left, 'left', noutp)
    else:
        cleft = np.zeros((noutp, left.shape[1]))
        cleft[: left.shape[0], : left.shape[1]] = left
    if isinstance(right, Model):
        cright = _coord_matrix(right, 'right', noutp)
    else:
        cright = np.zeros((noutp, right.shape[1]))
-       cright[-right.shape[0]:, -right.shape[1]:] = 1
+       cright[-right.shape[0]:, -right.shape[1]:] = right

    return np.hstack([cleft, cright])
```

### 2. `astropy/modeling/tests/test_separable.py`
**Added test cases:**
- `cm_4d_expected`: Expected result for 4D nested models
- `cm8`: `rot & (sh1 & sh2)` - nested on right side
- `cm9`: `rot & sh1 & sh2` - unnested (baseline)
- `cm10`: `(rot & sh1) & sh2` - nested on left side
- `cm11`: `rot & sh1 & (scl1 & scl2)` - larger nested model

```python
cm_4d_expected = (np.array([False, False, True, True]),
                  np.array([[True,  True,  False, False],
                            [True,  True,  False, False],
                            [False, False, True,  False],
                            [False, False, False, True]]))

# Added to compound_models dictionary:
'cm8': (rot & (sh1 & sh2), cm_4d_expected),
'cm9': (rot & sh1 & sh2, cm_4d_expected),
'cm10': ((rot & sh1) & sh2, cm_4d_expected),
'cm11': (rot & sh1 & (scl1 & scl2),
         (np.array([False, False, True, True, True]),
          np.array([[True,  True,  False, False, False],
                    [True,  True,  False, False, False],
                    [False, False, True,  False, False],
                    [False, False, False, True,  False],
                    [False, False, False, False, True]]))),
```

## Test Results

### Test Cases Verified:
1. **cm8** (`rot & (sh1 & sh2)`): PASS - Nested right side produces correct diagonal
2. **cm9** (`rot & sh1 & sh2`): PASS - Unnested matches nested result
3. **cm10** (`(rot & sh1) & sh2`): PASS - Nested left side works correctly
4. **cm11** (`rot & sh1 & (scl1 & scl2)`): PASS - Larger nested model works

### Bug Demonstration:
Before fix:
```python
>>> separability_matrix(m.Pix2Sky_TAN() & (m.Linear1D(10) & m.Linear1D(5)))
array([[ True,  True, False, False],
       [ True,  True, False, False],
       [False, False,  True,  True],  # Wrong - non-separable
       [False, False,  True,  True]])  # Wrong - non-separable
```

After fix:
```python
>>> separability_matrix(m.Pix2Sky_TAN() & (m.Linear1D(10) & m.Linear1D(5)))
array([[ True,  True, False, False],
       [ True,  True, False, False],
       [False, False,  True, False],  # Correct - separable
       [False, False, False,  True]])  # Correct - separable
```

## Impact
- **Minimal change**: Only one line of code modified in the core implementation
- **Backward compatible**: Does not affect existing unnested CompoundModel behavior
- **Performance**: No performance impact (same operations, just correct values)
- **Tests**: Added comprehensive test cases to prevent regression

## Verification
The fix ensures that:
1. Nested CompoundModels produce correct separability matrices
2. Nested and unnested equivalent models produce identical results
3. The diagonal pattern indicating separable outputs is preserved
4. All existing test cases continue to pass
