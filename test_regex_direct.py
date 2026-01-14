"""Test the QDP regex pattern directly"""
import re

# Original pattern (case-sensitive)
_command_re_original = r'READ [TS]ERR(\s+[0-9]+)+'
_decimal_re = r'[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?'
_new_re = r'NO(\s+NO)+'
_data_re = rf'({_decimal_re}|NO|[-+]?nan)(\s+({_decimal_re}|NO|[-+]?nan))*'
_type_re = rf'^\s*((?P<command>{_command_re_original})|(?P<new>{_new_re})|(?P<data>{_data_re})?\s*(\!(?P<comment>.*))?\s*$'
_line_type_re_original = re.compile(_type_re)

# Fixed pattern (case-insensitive)
_line_type_re_fixed = re.compile(_type_re, re.IGNORECASE)

test_lines = [
    "READ SERR 1 2",
    "read serr 1 2",
    "ReAd TeRr 1 2",
    "READ TERR 1 2",
    "read terr 1 2",
    "ReAd SeRr 1 2 3",
    "1 0.5 1 0.5",
]

print("=" * 60)
print("Testing ORIGINAL pattern (case-sensitive):")
print("=" * 60)
for line in test_lines:
    match = _line_type_re_original.match(line)
    if match:
        for type_, val in match.groupdict().items():
            if val is not None:
                print(f"✓ '{line}' -> {type_}")
    else:
        print(f"✗ '{line}' -> NO MATCH")

print("\n" + "=" * 60)
print("Testing FIXED pattern (case-insensitive):")
print("=" * 60)
for line in test_lines:
    match = _line_type_re_fixed.match(line)
    if match:
        for type_, val in match.groupdict().items():
            if val is not None:
                print(f"✓ '{line}' -> {type_}")
    else:
        print(f"✗ '{line}' -> NO MATCH")

print("\n" + "=" * 60)
print("SUMMARY:")
print("=" * 60)
print("The fix adds re.IGNORECASE flag to the regex compilation.")
print("This allows matching commands in any case: READ, read, Read, etc.")
print("\nThis matches the QDP format specification which is case-insensitive.")
