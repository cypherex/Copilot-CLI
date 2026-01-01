# Documentation Cleanup Plan

## Overview

This document outlines the cleanup and reorganization of 44 project markdown files to improve documentation structure and remove outdated content.

**Date Created:** 2025-01-16
**Total Files:** 44 markdown files (excluding node_modules)

---

## Summary of Actions

| Action | Count | Files |
|--------|-------|-------|
| **KEEP** | 7 | Already well-organized |
| **DELETE** | 7 | Outdated task tracking |
| **REPURPOSE/MERGE** | 13 | Has useful content |
| **MOVE** | 5 | Better location needed |
| **ARCHIVE** | 2 | Historical value |
| **ORGANIZE** | 14 | testbox directory |

---

## Section 1: Root-Level Files (28 files)

### ✅ KEEP (1 file)

| File | Reason |
|------|--------|
| `README.md` | Core project documentation, well-organized |

---

### 🗑️ DELETE (7 files)

These files are outdated task tracking documents with completed work:

| File | Reason |
|------|--------|
| `ACTION_PLAN.md` | Old action plan, tasks completed |
| `TASK_2.1.6_COMPLETION_REPORT.md` | Completed task report |
| `TASK_2.2.1_COMPLETION_REPORT.md` | Completed task report |
| `TASK_2.2.1_IMPLEMENTATION_SUMMARY.md` | Task-specific summary |
| `TASK_2.2.1_SUMMARY.md` | Task-specific summary |
| `TASK_2.2.2_IMPLEMENTATION_SUMMARY.md` | Task-specific summary |
| `PROGRESS.md` | Progress tracking for completed work |

---

### 📝 REPURPOSE/MERGE (13 files)

These files contain useful content that should be consolidated into proper documentation:

#### Implementation Summaries → Merge into developer guides

| File | Target | Action |
|------|--------|--------|
| `BUDGET_FIXES_SUMMARY.md` | `docs/context-budget.md` | Merge technical details |
| `IMPLEMENTATION_NOTES.md` | Multiple docs | Extract relevant parts |
| `IMPLEMENTATION_SUMMARY.md` | `docs/developer-guide.md` | Create new doc |
| `WORK_COMPLETED_SUMMARY.md` | `docs/developer-guide.md` | Merge into developer guide |

#### Subagent Documentation → Consolidate

| File | Target | Action |
|------|--------|--------|
| `SUBAGENT_QUICK_REFERENCE.md` | `docs/subagent-quick-reference.md` | Already good, just move |
| `SUBAGENT_SYSTEM_GUIDE.md` | `docs/subagent-quick-reference.md` | Merge sections |
| `SUBAGENT_IMPLEMENTATION_SUMMARY.md` | `docs/subagent-development.md` | Create development guide |
| `SUBAGENT_DELEGATION_SUMMARY.md | Already in docs/` | Delete (duplicate) |

#### Feature Documentation → Organize

| File | Target | Action |
|------|--------|--------|
| `DELIVERY_SUMMARY.md` | Archive | Content already in other docs |
| `PROACTIVE_CONTEXT_MONITOR_SUMMARY.md` | `docs/proactive-monitor.md` | Move and rename |
| `PROACTIVE_MONITOR_COMPLETE.md` | `docs/proactive-monitor.md` | Merge |
| `PROACTIVE_MONITOR_USER_FLOW.md` | `docs/proactive-monitor.md` | Merge as section |
| `QUANTIFIER_PATTERNS_REFERENCE.md` | `docs/pattern-reference.md` | Move to docs/ |
| `TASK_PLANNING_GUIDE.md` | `docs/task-management.md` | Move to docs/ |

---

### 📦 ARCHIVE (2 files)

| File | Reason |
|------|--------|
| `AGENT_DECISION_MAKING_ANALYSIS.md` | Historical analysis, not actively needed |
| `MEMORY_SUPERSESSION.md` | Feature documentation - determine if still relevant |

**Note:** Create `docs/archive/` directory for historical documents.

---

### 📋 SETUP (1 file)

| File | Target | Action |
|------|--------|--------|
| `AZURE_SETUP.md` | Merge into `README.md` | Add setup section |

---

### ❌ DELETE (1 file)

| File | Reason |
|------|--------|
| `IMPLEMENTATION_COMPLETE.md` | Redundant with other summaries |

---

## Section 2: src/agent/ Directory (2 files)

| File | Target | Action |
|------|--------|--------|
| `src/agent/IMPLEMENTATION_SUMMARY.md` | Archive | Move to docs/archive/ |
| `src/agent/VERIFICATION_CHECKLIST.md` | Archive | Move to docs/archive/ |

---

## Section 3: docs/ Directory (6 files)

### ✅ KEEP ALL - Already Well Organized

All existing docs/ files are properly organized and should be kept:

- `docs/README.md` - Documentation hub
- `docs/mandatory-delegation.md` - Mandatory delegation guide
- `docs/mandatory-patterns-reference.md` - Pattern reference
- `docs/adding-mandatory-patterns.md` - Developer guide
- `docs/troubleshooting-mandatory-delegation.md` - Troubleshooting
- `docs/context-budget.md` - Context budget docs
- `docs/context-budget-summary.md` - Quick reference

---

## Section 4: testbox/ Directory (14 files)

### 🧹 CLEAN UP / ORGANIZE

These files appear to be test configurations and prompts for different AI models:

#### testbox/haiku/ (7 files)
```
- CONTRIBUTING.md
- IMPLEMENTATION_STATUS.md
- INDEX.md
- PROJECT_SUMMARY.md
- README.md
- docs/api.md
- docs/architecture.md
- docs/deployment.md
- prompt.md
```

**Action:** Keep well-structured documentation, consider consolidating

#### testbox/sonnet/ (7 files)
```
- CONTRIBUTING.md
- IMPLEMENTATION_COMPLETE.md
- IMPLEMENTATION_STATUS.md
- PROJECT_SUMMARY.md
- README.md
- docs/API.md
- docs/ARCHITECTURE.md
- docs/DEPLOYMENT.md
- prompt.md
```

**Action:** Keep well-structured documentation, consider consolidating

#### testbox/GLM/ (1 file)
```
- prompt.md
```

**Action:** Keep or create docs structure

#### testbox/ (1 file)
```
- prompt.md
```

**Action:** Keep or integrate

**Recommendation:**
1. Keep model-specific documentation that documents unique behaviors
2. Create `testbox/README.md` explaining the test structure
3. Consolidate similar documentation across models
4. Consider deleting if models are no longer being tested

---

## Proposed Documentation Structure

After cleanup, the documentation structure should be:

```
├── README.md                          # Main project documentation
│
├── docs/                              # All technical documentation
│   ├── README.md                      # Documentation hub (keep)
│   │
│   ├── Core Features/
│   │   ├── context-budget.md           # Context budget system (keep)
│   │   ├── context-budget-summary.md   # Quick reference (keep)
│   │   ├── task-management.md          # Task planning guide (move)
│   │   ├── proactive-monitor.md        # Proactive monitor (move)
│   │   └── memory-supersession.md     # Memory system (archive)
│   │
│   ├── Subagent System/
│   │   ├── subagent-quick-reference.md # Quick reference (move)
│   │   ├── subagent-development.md     # Developer guide (create)
│   │   ├── mandatory-delegation.md     # (keep)
│   │   ├── mandatory-patterns-reference.md # (keep)
│   │   ├── adding-mandatory-patterns.md # (keep)
│   │   ├── troubleshooting-mandatory-delegation.md # (keep)
│   │   └── pattern-reference.md        # Pattern reference (move)
│   │
│   ├── Developer Guide/
│   │   ├── getting-started.md         # Developer onboarding
│   │   ├── architecture.md             # System architecture
│   │   ├── contribution-guide.md       # How to contribute
│   │   └── testing-guide.md           # How to test
│   │
│   └── archive/                       # Historical documents
│       ├── task-completion-reports/
│       ├── implementation-summaries/
│       └── analysis-documents/
│
├── testbox/                           # Model testing
│   ├── README.md                      # Test structure guide
│   ├── haiku/
│   │   ├── README.md
│   │   ├── docs/
│   │   └── prompt.md
│   ├── sonnet/
│   │   ├── README.md
│   │   ├── docs/
│   │   └── prompt.md
│   └── GLM/
│       └── prompt.md
│
└── Archive (root-level)                # Legacy files
    ├── OLD_ACTION_PLAN.md
    ├── OLD_IMPLEMENTATION_NOTES.md
    └── ...
```

---

## Execution Steps

### Phase 1: Deletions (Quick Wins)

1. Delete 7 task tracking files:
   ```bash
   rm ACTION_PLAN.md
   rm TASK_2.1.6_COMPLETION_REPORT.md
   rm TASK_2.2.1_COMPLETION_REPORT.md
   rm TASK_2.2.1_IMPLEMENTATION_SUMMARY.md
   rm TASK_2.2.1_SUMMARY.md
   rm TASK_2.2.2_IMPLEMENTATION_SUMMARY.md
   rm PROGRESS.md
   ```

2. Delete redundant file:
   ```bash
   rm IMPLEMENTATION_COMPLETE.md
   ```

### Phase 2: Moves and Merges

3. Move subagent quick reference:
   ```bash
   mv SUBAGENT_QUICK_REFERENCE.md docs/subagent-quick-reference.md
   ```

4. Move task planning guide:
   ```bash
   mv TASK_PLANNING_GUIDE.md docs/task-management.md
   ```

5. Move quantifier patterns:
   ```bash
   mv QUANTIFIER_PATTERNS_REFERENCE.md docs/pattern-reference.md
   ```

6. Consolidate proactive monitor docs into single file

7. Merge Azure setup into README.md

### Phase 3: Archive Creation

8. Create archive directory:
   ```bash
   mkdir -p docs/archive/{task-reports,summaries}
   ```

9. Move files to archive:
   ```bash
   mv BUDGET_FIXES_SUMMARY.md docs/archive/summaries/
   mv IMPLEMENTATION_NOTES.md docs/archive/summaries/
   mv IMPLEMENTATION_SUMMARY.md docs/archive/summaries/
   mv WORK_COMPLETED_SUMMARY.md docs/archive/summaries/
   mv DELIVERY_SUMMARY.md docs/archive/summaries/
   mv src/agent/IMPLEMENTATION_SUMMARY.md docs/archive/summaries/
   mv src/agent/VERIFICATION_CHECKLIST.md docs/archive/summaries/
   mv AGENT_DECISION_MAKING_ANALYSIS.md docs/archive/analysis/
   ```

### Phase 4: Documentation Updates

10. Update docs/README.md with new structure
11. Consolidate subagent system guides
12. Create developer guide from implementation notes
13. Create testbox/README.md

### Phase 5: Cleanup

14. Remove empty directories if any
15. Verify all links in documentation still work
16. Update any cross-references between docs

---

## Success Criteria

- [ ] 8 outdated task tracking files deleted
- [ ] 7 files moved to proper locations
- [ ] 6 files merged/repurposed
- [ ] 2 historical files archived
- [ ] Azure setup integrated into README
- [ ] Documentation structure clearly organized
- [ ] All internal links updated
- [ ] No broken references
- [ ] Clear distinction between user and developer docs

---

## Risk Assessment

### Low Risk
- Deleting task completion reports (content in other docs)
- Moving quick references to docs/ (improves organization)
- Archiving historical summaries (preserved for reference)

### Medium Risk
- Merging multiple docs (may lose some details)
- Reorganizing structure (requires link updates)
- Consolidating subagent guides (ensure no content lost)

### Mitigation Strategies
1. Create backup before deletions
2. Review merged content carefully
3. Verify all links after reorganization
4. Test accessibility of moved files
5. Keep archive for historical reference

---

## Next Steps

1. **Review this plan** with the team
2. **Create backup** of current documentation state
3. **Execute in phases** (deletions first, then reorganization)
4. **Test** documentation accessibility after each phase
5. **Update** docs/README.md with new structure
6. **Communicate** changes to team if this is a shared project

---

## Questions for Consideration

1. **Memory Supersession:** Is the MEMORY_SUPERSESSION.md feature still active? If yes, move to docs/. If no, archive.

2. **testbox Models:** Are haiku, sonnet, and GLM models still being tested? If not, consider removing those directories.

3. **Subagent Documentation:** Should the implementation summary and verification checklist be kept for developers, or is archive sufficient?

4. **Developer Guide:** Should we create a comprehensive developer guide from the implementation notes, or is the current documentation sufficient?

---

**Document Version:** 1.0
**Created:** 2025-01-16
**Status:** Pending Review and Approval
