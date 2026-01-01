# Documentation Index

Welcome to the Copilot CLI Agent documentation hub.

## Core Documentation

- [README.md](../README.md) - Main project documentation and quick start guide

## Feature Documentation

### Mandatory Delegation System

**Main Documentation**
- [Mandatory Delegation](mandatory-delegation.md) - Complete guide to the mandatory delegation system
  - Overview and concepts
  - When delegation triggers
  - Expected behavior
  - Customization guide
  - Pattern reference
  - Troubleshooting guide
  - Migration guide

**Supporting Guides**
- [Mandatory Patterns Reference](mandatory-patterns-reference.md) - Quick lookup table for all mandatory patterns
- [Adding Mandatory Patterns](adding-mandatory-patterns.md) - Guide for adding new mandatory delegation patterns
- [Troubleshooting Mandatory Delegation](troubleshooting-mandatory-delegation.md) - Common issues and solutions

### Context Budget System

- [Context Budget Management](context-budget.md) - Detailed explanation of the context budget system
- [Context Budget Summary](context-budget-summary.md) - Quick reference for context budgets

## Quick Reference

### Subagent Patterns

| Pattern Type | Priority | Mandatory | Documentation |
|--------------|----------|-----------|---------------|
| Parallel Processing | High | ✅ Yes | [Reference](mandatory-patterns-reference.md#parallel-processing-patterns) |
| Investigation | High | ✅ Yes | [Reference](mandatory-patterns-reference.md#investigation-patterns) |
| Bug Fixing | High | ✅ Yes | [Reference](mandatory-patterns-reference.md#bug-fix-patterns) |
| Test Writing | Medium | ❌ No | [Reference](mandatory-patterns-reference.md#test-writing-patterns) |
| Refactoring | Medium | ❌ No | [Reference](mandatory-patterns-reference.md#refactoring-patterns) |
| Documentation | Low | ❌ No | [Reference](mandatory-patterns-reference.md#documentation-patterns) |

### Subagent Roles

| Role ID | Name | Purpose | Max Iterations |
|---------|------|---------|----------------|
| `test-writer` | Test Writer | Write comprehensive tests | 3 |
| `investigator` | Investigator | Diagnose bugs and trace execution | 3 |
| `refactorer` | Refactorer | Improve code quality and organization | 2 |
| `documenter` | Documenter | Create and maintain documentation | 2 |
| `fixer` | Fixer | Resolve specific bugs and issues | 2 |
| (undefined) | General | General-purpose tasks | 10 |

## Getting Started

### For Users

1. Read the [README.md](../README.md) for installation and setup
2. Learn about the [Subagent System](../README.md#subagent-system)
3. Review [Mandatory Delegation](mandatory-delegation.md) for understanding automated delegation

### For Developers

1. Review [Adding Mandatory Patterns](adding-mandatory-patterns.md) to extend the system
2. Use the [Pattern Reference](mandatory-patterns-reference.md) for existing patterns
3. Consult [Troubleshooting Guide](troubleshooting-mandatory-delegation.md) for debugging

### For Contributors

1. Understand the [Mandatory Delegation System](mandatory-delegation.md)
2. Follow the pattern guidelines in [Adding Mandatory Patterns](adding-mandatory-patterns.md)
3. Use the [Testing Patterns](troubleshooting-mandatory-delegation.md#testing-patterns) section for validation

## Documentation Structure

```
docs/
├── README.md (this file)
│
├── mandatory-delegation.md
│   ├── Overview
│   ├── What is Mandatory Delegation
│   ├── When Does It Trigger
│   ├── Expected Behavior
│   ├── Customization
│   ├── Pattern Reference
│   ├── Troubleshooting
│   └── Migration Guide
│
├── mandatory-patterns-reference.md
│   ├── Summary Table
│   ├── Parallel Processing Patterns
│   ├── Investigation Patterns
│   ├── Bug Fix Patterns
│   ├── Suggested Patterns
│   └── Pattern Decision Matrix
│
├── adding-mandatory-patterns.md
│   ├── Quick Start
│   ├── Pattern Template
│   ├── Step-by-Step Guide
│   ├── Common Pattern Examples
│   ├── Advanced Topics
│   ├── Testing Checklist
│   ├── Common Mistakes
│   └── Contributing
│
├── troubleshooting-mandatory-delegation.md
│   ├── Common Issues
│   ├── Debugging Steps
│   ├── Diagnostic Commands
│   ├── Testing Patterns
│   └── Advanced Debugging
│
├── context-budget.md
│   └── Context Budget System Details
│
└── context-budget-summary.md
    └── Context Budget Quick Reference
```

## Key Concepts

### Mandatory Delegation

Mandatory delegation is a system rule that forces the agent to spawn subagents for specific types of tasks:

- **Triggers**: High-priority patterns in user messages
- **Behavior**: Agent MUST delegate, CANNOT attempt directly
- **Display**: Yellow warning banner with ⚠️ icon
- **Examples**: "for each file", "investigate", "debug", "fix bug"

### Suggested Delegation

Suggested delegation provides optional delegation opportunities:

- **Triggers**: Medium/low priority patterns
- **Behavior**: Agent MAY delegate based on judgment
- **Display**: Gray suggestion with 💡 icon
- **Examples**: "write tests", "refactor", "update docs"

### Context Budget

The context budget system manages token allocation:

- **Purpose**: Prevent overflow, optimize token usage
- **Sections**: User, Assistant, Tools, System, Subagents
- **Priority**: High for recent messages, tools, results
- **Budgeting**: Dynamic allocation based on importance

## Common Workflows

### Adding a New Mandatory Pattern

1. Read [Adding Mandatory Patterns](adding-mandatory-patterns.md)
2. Define your regex pattern
3. Set priority to 'high' and mandatory to true
4. Add to `src/agent/subagent-detector.ts`
5. Test using [Diagnostic Commands](troubleshooting-mandatory-delegation.md#diagnostic-commands)
6. Update documentation

### Debugging Delegation Issues

1. Use [Debugging Steps](troubleshooting-mandatory-delegation.md#debugging-steps)
2. Run [Diagnostic Commands](troubleshooting-mandatory-delegation.md#diagnostic-commands)
3. Check [Common Issues](troubleshooting-mandatory-delegation.md#common-issues)
4. Verify pattern matching with [Testing Patterns](troubleshooting-mandatory-delegation.md#testing-patterns)

### Understanding Pattern Matching

1. Review [Pattern Reference](mandatory-patterns-reference.md)
2. Check [Pattern Decision Matrix](mandatory-patterns-reference.md#pattern-decision-matrix)
3. Use [Quick Reference Card](mandatory-patterns-reference.md#quick-reference-card)
4. Test with [Quick Pattern Test](troubleshooting-mandatory-delegation.md#quick-pattern-test)

## Contributing to Documentation

When adding new features or modifying existing ones:

1. Update the relevant documentation file
2. Add examples where appropriate
3. Update the [Documentation Structure](#documentation-structure) if needed
4. Test all diagnostic commands and examples
5. Update this index with new documents

## Version Information

- **Current Version**: 2.0.0
- **Last Updated**: 2024
- **Major Features**:
  - Mandatory delegation system (v2.0.0)
  - Context budget management (v2.0.0)
  - Parallel subagent execution (v2.0.0)

## Changelog

### Version 2.0.0
- Added mandatory delegation system
- Distinguished between mandatory and suggested delegation
- Added priority-based pattern selection
- Enhanced user feedback with warning banners
- Added context budget management
- Improved parallel subagent execution

### Version 1.0.0
- Initial subagent suggestion system
- Basic pattern detection
- Suggested delegation only

## Support

For issues or questions:

1. Check the [Troubleshooting Guide](troubleshooting-mandatory-delegation.md)
2. Review [Common Issues](troubleshooting-mandatory-delegation.md#common-issues)
3. Search existing documentation
4. Review [Diagnostic Commands](troubleshooting-mandatory-delegation.md#diagnostic-commands)

## Related Resources

- [Project README](../README.md)
- [Subagent Detector Source](../src/agent/subagent-detector.ts)
- [Agent Loop Source](../src/agent/loop.ts)
- [System Prompt Source](../src/agent/system-prompt.ts)

---

**Last Updated**: 2024  
**Documentation Version**: 2.0.0
