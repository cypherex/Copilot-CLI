#!/bin/bash
# Test script for validator flow integration test

echo "========================================="
echo "Running Validator Flow Integration Test"
echo "========================================="
echo ""

# Run the test with Jest
npm test -- src/agent/__tests__/validator-flow.integration.test.ts --verbose

echo ""
echo "========================================="
echo "Test Complete"
echo "========================================="
