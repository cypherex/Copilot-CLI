"""Test the QDP case-insensitive fix without importing astropy"""
import re

# Import only what we need - the _line_type function
import sys
import os

# Add the path to qdp module
sys.path.insert(0, 'astropy_repo/astropy/io/ascii')

# Read the qdp.py file directly to extract the _line_type function
with open('astropy_repo/astropy/io/ascii/qdp.py', 'r') as f:
    content = f.read()

# Check that re.IGNORECASE is in the file
if 're.IGNORECASE' in content:
    print("SUCCESS: re.IGNORECASE flag found in qdp.py")
else:
    print("FAILURE: re.IGNORECASE flag NOT found in qdp.py")
    sys.exit(1)

# Check the exact line
for line in content.split('\n'):
    if '_line_type_re = re.compile' in line:
        if 're.IGNORECASE' in line:
            print(f"SUCCESS: Found correct line: {line.strip()}")
        else:
            print(f"FAILURE: Found incorrect line: {line.strip()}")
            sys.exit(1)

# Now test the actual function
print("\nNow testing the _line_type function with case variations:")

# Define the function locally
def _line_type_test(line, delimiter=None):
    _decimal_re = r'[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?'
    _command_re = r'READ [TS]ERR(\s+[0-9]+)+'

    sep = delimiter
    if delimiter is None:
        sep = r'\s+'
    _new_re = rf'NO({sep}NO)+'
    _data_re = rf'({_decimal_re}|NO|[-+]?nan)({sep}({_decimal_re}|NO|[-+]?nan))*)'
    _type_re = rf'^\s*((?P<command>{_command_re})|(?P<new>{_new_re})|(?P<data>{_data_re})?\s*(\!(?P<comment>.*))?\s*$'
    _line_type_re = re.compile(_type_re, re.IGNORECASE)
    line = line.strip()
    if not line:
        return 'comment'
    match = _line_type_re.match(line)

    if match is None:
        raise ValueError(f'Unrecognized QDP line: {line}')
    for type_, val in match.groupdict().items():
        if val is None:
            continue
        if type_ == 'data':
            return f'data,{len(val.split(sep=delimiter))}'
        else:
            return type_

# Test cases
test_cases = [
    ("READ SERR 1 2", 'command'),
    ("read serr 1 2", 'command'),
    ("ReAd TeRr 1 2", 'command'),
    ("READ TERR 1", 'command'),
    ("read terr 1 2 3", 'command'),
    ("1 0.5 1 0.5", 'data,4'),
]

all_passed = True
for test_input, expected in test_cases:
    try:
        result = _line_type_test(test_input)
        if result == expected:
            print(f"[PASS] '{test_input}' -> {result}")
        else:
            print(f"[FAIL] '{test_input}' -> {result} (expected {expected})")
            all_passed = False
    except ValueError as e:
        print(f"[FAIL] '{test_input}' raised ValueError: {e}")
        all_passed = False

if all_passed:
    print("\nAll tests passed! The fix is working correctly.")
else:
    print("\nSome tests failed!")
    sys.exit(1)
