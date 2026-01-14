"""Test the QDP regex pattern directly"""
import re

# Test the command pattern specifically
_command_pattern = r'READ [TS]ERR(\s+[0-9]+)+'

print("=" * 60)
print("Testing command pattern (case-sensitive):")
print("=" * 60)
test_cases = [
    "READ SERR 1 2",
    "read serr 1 2",
    "ReAd TeRr 1 2",
    "READ TERR 1",
    "read terr 1 2 3",
]

for line in test_cases:
    match = re.match(_command_pattern, line)
    if match:
        print(f"[PASS] '{line}' matched")
    else:
        print(f"[FAIL] '{line}' did NOT match")

print("\n" + "=" * 60)
print("Testing command pattern (case-insensitive):")
print("=" * 60)
for line in test_cases:
    match = re.match(_command_pattern, line, re.IGNORECASE)
    if match:
        print(f"[PASS] '{line}' matched")
    else:
        print(f"[FAIL] '{line}' did NOT match")

print("\n" + "=" * 60)
print("SUMMARY:")
print("=" * 60)
print("The fix adds re.IGNORECASE flag to the regex compilation.")
print("This allows matching commands in any case: READ, read, Read, etc.")
print("\nThis matches the QDP format specification which is case-insensitive.")
