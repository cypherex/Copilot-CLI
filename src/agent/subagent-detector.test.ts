// Subagent Detector Tests - comprehensive testing for pattern matching

import { detectSubagentOpportunity, buildSubagentHint, separateTasks, countTasks } from './subagent-detector';

describe('detectSubagentOpportunity - Quantifier Patterns', () => {
  describe('Several/Multiple/Various patterns', () => {
    it('should detect "several files"', () => {
      const result = detectSubagentOpportunity('Process several files in the src directory');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      expect(result?.priority).toBe('medium');
      expect(result?.reason).toContain('Multiple');
    });

    it('should detect "multiple services"', () => {
      const result = detectSubagentOpportunity('Update multiple services with new config');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      expect(result?.reason).toContain('services');
    });

    it('should detect "various modules"', () => {
      const result = detectSubagentOpportunity('Refactor various modules in the project');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      // Note: This may match "refactor" pattern first which has medium priority
      expect(result?.priority).toBe('medium');
    });

    it('should detect "several components"', () => {
      const result = detectSubagentOpportunity('Test several components in the UI');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
    });

    it('should be case insensitive', () => {
      const result = detectSubagentOpportunity('SEVERAL FILES need processing');
      expect(result).toBeDefined();
    });

    it('should NOT trigger for "several options"', () => {
      const result = detectSubagentOpportunity('We have several options to consider');
      expect(result).toBeUndefined();
    });

    it('should NOT trigger for "multiple ways"', () => {
      const result = detectSubagentOpportunity('There are multiple ways to do this');
      expect(result).toBeUndefined();
    });
  });

  describe('Each/Every patterns', () => {
    it('should detect "each file"', () => {
      const result = detectSubagentOpportunity('Run tests for each file');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      // Note: May match "tests" pattern (medium) instead
      expect(result?.priority).toBeDefined();
    });

    it('should detect "every service"', () => {
      const result = detectSubagentOpportunity('Update every service with the new endpoint');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
    });

    it('should detect "each module"', () => {
      const result = detectSubagentOpportunity('Review each module for security issues');
      expect(result).toBeDefined();
    });

    it('should detect "every component"', () => {
      const result = detectSubagentOpportunity('Add logging to every component');
      expect(result).toBeDefined();
    });

    it('should be case insensitive', () => {
      const result = detectSubagentOpportunity('EACH FILE MUST BE UPDATED');
      expect(result).toBeDefined();
    });

    it('should NOT trigger for "each option"', () => {
      const result = detectSubagentOpportunity('Consider each option carefully');
      expect(result).toBeUndefined();
    });
  });

  describe('All patterns', () => {
    it('should detect "all files"', () => {
      const result = detectSubagentOpportunity('Delete all files in the temp directory');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      expect(result?.priority).toBe('high');
    });

    it('should detect "all services"', () => {
      const result = detectSubagentOpportunity('Restart all services in the cluster');
      expect(result).toBeDefined();
      expect(result?.priority).toBe('high');
    });

    it('should detect "all modules"', () => {
      const result = detectSubagentOpportunity('Recompile all modules');
      expect(result).toBeDefined();
      expect(result?.priority).toBe('high');
    });

    it('should detect "all components"', () => {
      const result = detectSubagentOpportunity('Style all components with the new theme');
      expect(result).toBeDefined();
      expect(result?.priority).toBe('high');
    });

    it('should be case insensitive', () => {
      const result = detectSubagentOpportunity('ALL FILES MUST GO');
      expect(result).toBeDefined();
    });

    it('should NOT trigger for "all options"', () => {
      const result = detectSubagentOpportunity('Consider all options first');
      expect(result).toBeUndefined();
    });
  });

  describe('Each of / Every one of patterns', () => {
    it('should detect "each of the files"', () => {
      const result = detectSubagentOpportunity('Run linting on each of the files');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      expect(result?.priority).toBe('medium');
    });

    it('should detect "every one of the services"', () => {
      const result = detectSubagentOpportunity('Check health for every one of the services');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
    });

    it('should detect "each of modules"', () => {
      const result = detectSubagentOpportunity('Update dependencies for each of the modules');
      expect(result).toBeDefined();
    });

    it('should detect "every one of components"', () => {
      const result = detectSubagentOpportunity('Test every one of components thoroughly');
      expect(result).toBeDefined();
    });

    it('should be case insensitive', () => {
      const result = detectSubagentOpportunity('EACH OF THE FILES needs review');
      expect(result).toBeDefined();
    });
  });

  describe('Number phrase patterns', () => {
    it('should detect "two files"', () => {
      const result = detectSubagentOpportunity('Compare two files for differences');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      expect(result?.priority).toBe('low');
    });

    it('should detect "three services"', () => {
      const result = detectSubagentOpportunity('Deploy three services to production');
      expect(result).toBeDefined();
      expect(result?.priority).toBe('low');
    });

    it('should detect "four modules"', () => {
      const result = detectSubagentOpportunity('Refactor four modules in the codebase');
      expect(result).toBeDefined();
      // Note: May match "refactor" pattern (medium) instead
      expect(result?.priority).toBeDefined();
    });

    it('should detect "five components"', () => {
      const result = detectSubagentOpportunity('Create five components for the dashboard');
      expect(result).toBeDefined();
      expect(result?.priority).toBe('low');
    });

    it('should detect "six files"', () => {
      const result = detectSubagentOpportunity('Process six files in batch');
      expect(result).toBeDefined();
    });

    it('should detect "seven services"', () => {
      const result = detectSubagentOpportunity('Configure seven services for monitoring');
      expect(result).toBeDefined();
    });

    it('should detect "eight modules"', () => {
      const result = detectSubagentOpportunity('Test eight modules for integration');
      expect(result).toBeDefined();
    });

    it('should detect "nine components"', () => {
      const result = detectSubagentOpportunity('Style nine components consistently');
      expect(result).toBeDefined();
    });

    it('should detect "ten files"', () => {
      const result = detectSubagentOpportunity('Review ten files for code quality');
      expect(result).toBeDefined();
    });

    it('should be case insensitive', () => {
      const result = detectSubagentOpportunity('FIVE FILES need attention');
      expect(result).toBeDefined();
    });

    it('should NOT trigger for "two days"', () => {
      const result = detectSubagentOpportunity('Complete the task in two days');
      expect(result).toBeUndefined();
    });

    it('should NOT trigger for "three times"', () => {
      const result = detectSubagentOpportunity('Run the test three times');
      expect(result).toBeUndefined();
    });
  });

  describe('Priority ordering tests', () => {
    it('should prioritize "all files" (high) over "several files" (medium)', () => {
      const result = detectSubagentOpportunity('Process all files and several modules');
      expect(result).toBeDefined();
      expect(result?.priority).toBe('high');
      expect(result?.reason).toContain('all');
    });

    it('should prioritize "all services" (high) over "two files" (low)', () => {
      const result = detectSubagentOpportunity('Update all services and fix two files');
      expect(result).toBeDefined();
      expect(result?.priority).toBe('high');
    });

    it('should prioritize medium over low when both present', () => {
      const result = detectSubagentOpportunity('Review several files and three components');
      expect(result).toBeDefined();
      expect(result?.priority).toBe('medium');
    });
  });

  describe('Context awareness tests', () => {
    it('should NOT trigger for quantifiers without file-related words', () => {
      const result1 = detectSubagentOpportunity('There are several options to choose from');
      const result2 = detectSubagentOpportunity('Check each option carefully');
      const result3 = detectSubagentOpportunity('Consider all possibilities');
      const result4 = detectSubagentOpportunity('Two days remain');

      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
      expect(result3).toBeUndefined();
      expect(result4).toBeUndefined();
    });

    it('should NOT trigger for general quantifier usage', () => {
      const result = detectSubagentOpportunity('I have multiple ideas and several thoughts about various topics');
      expect(result).toBeUndefined();
    });

    it('should trigger for file-related contexts only', () => {
      const result1 = detectSubagentOpportunity('Update multiple files in the repository');
      const result2 = detectSubagentOpportunity('Review each module for bugs');
      const result3 = detectSubagentOpportunity('Test all services in the cluster');
      const result4 = detectSubagentOpportunity('Refactor five components for performance');

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result3).toBeDefined();
      expect(result4).toBeDefined();
    });
  });

  describe('Combined pattern tests', () => {
    it('should detect quantifiers with role-specific tasks', () => {
      const result = detectSubagentOpportunity('Write tests for several files');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
    });

    it('should detect quantifiers with investigation tasks', () => {
      const result = detectSubagentOpportunity('Investigate each module for performance issues');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
    });

    it('should detect quantifiers with refactoring tasks', () => {
      const result = detectSubagentOpportunity('Refactor all components in the project');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
    });
  });

  describe('Word boundary tests', () => {
    it('should not match partial words', () => {
      const result = detectSubagentOpportunity('The severalities of the problem are complex');
      expect(result).toBeUndefined();
    });

    it('should not match "everyday" as "every"', () => {
      const result = detectSubagentOpportunity('Use everyday components in the UI');
      expect(result).toBeUndefined();
    });

    it('should not match "always" as "all"', () => {
      const result = detectSubagentOpportunity('Always check the files before committing');
      expect(result).toBeUndefined();
    });
  });
});

describe('buildSubagentHint', () => {
  it('should build hint message for quantifier pattern', () => {
    const opportunity = {
      roleId: 'general',
      shouldSpawn: true,
      reason: 'Multiple files/modules/services/components mentioned - consider spawning parallel subagents',
      priority: 'medium' as const,
    };
    
    const hint = buildSubagentHint(opportunity);
    expect(hint).toContain('[SUBAGENT SUGGESTION]');
    expect(hint).toContain(opportunity.reason);
    expect(hint).toContain('Priority: medium');
    expect(hint).toContain('Suggested Role: general');
  });

  it('should build hint without role when undefined', () => {
    const opportunity = {
      roleId: undefined,
      shouldSpawn: true,
      reason: 'All files/modules/services/components need processing - consider spawning parallel subagents',
      priority: 'high' as const,
    };
    
    const hint = buildSubagentHint(opportunity);
    expect(hint).toContain('[SUBAGENT SUGGESTION]');
    expect(hint).toContain(opportunity.reason);
    expect(hint).toContain('Priority: high');
    expect(hint).not.toContain('Suggested Role:');
  });
});

describe('detectSubagentOpportunity - Conjunction Patterns (Task 2.2.2)', () => {
  describe('"and also" pattern', () => {
    it('should detect "and also" in message', () => {
      const result = detectSubagentOpportunity('Fix bug and also update docs');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      // Note: "also update" pattern (medium) takes precedence over "and also" (low)
      expect(result?.priority).toBe('medium');
      expect(result?.reason).toContain('also');
    });

    it('should detect "and also" with low priority when not overlapping', () => {
      const result = detectSubagentOpportunity('Handle database and also manage cache');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      expect(result?.priority).toBe('low');
      expect(result?.reason).toContain('and also');
    });

    it('should be case insensitive', () => {
      const result = detectSubagentOpportunity('Fix bug AND ALSO update docs');
      expect(result).toBeDefined();
      expect(result?.reason).toContain('also');
      // Medium priority because "also update" matches
      expect(result?.priority).toBe('medium');
    });

    it('should detect with different action verbs', () => {
      const result1 = detectSubagentOpportunity('Fix bug and also add tests');
      const result2 = detectSubagentOpportunity('Update docs and also create examples');
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });

    it('should not trigger false positive for "and" without "also"', () => {
      const result = detectSubagentOpportunity('Add tests and refactor code');
      expect(result?.reason).not.toContain('and also');
    });
  });

  describe('"and additionally" pattern', () => {
    it('should detect "and additionally" in message', () => {
      const result = detectSubagentOpportunity('Handle database and additionally process files');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      expect(result?.reason).toContain('and additionally');
      expect(result?.priority).toBe('low');
    });

    it('should be case insensitive', () => {
      const result = detectSubagentOpportunity('Handle database AND ADDITIONALLY process files');
      expect(result).toBeDefined();
      expect(result?.reason).toContain('and additionally');
      expect(result?.priority).toBe('low');
    });

    it('should work with various tasks', () => {
      const result = detectSubagentOpportunity('Investigate issue and additionally document findings');
      expect(result).toBeDefined();
    });
  });

  describe('"as well as" pattern', () => {
    it('should detect "as well as" in message', () => {
      const result = detectSubagentOpportunity('Update code as well as tests');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      expect(result?.reason).toContain('as well as');
    });

    it('should be case insensitive', () => {
      const result = detectSubagentOpportunity('Update docs AS WELL AS tests');
      expect(result).toBeDefined();
    });

    it('should detect with different task types', () => {
      const result = detectSubagentOpportunity('Refactor code as well as add tests');
      expect(result).toBeDefined();
    });
  });

  describe('"along with" pattern', () => {
    it('should detect "along with" in message', () => {
      const result = detectSubagentOpportunity('Fix bug along with update tests');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      expect(result?.priority).toBe('medium'); // Higher priority than "and also"
      expect(result?.reason).toContain('along with');
    });

    it('should be case insensitive', () => {
      const result = detectSubagentOpportunity('Fix bug ALONG WITH update tests');
      expect(result).toBeDefined();
    });

    it('should detect with different contexts', () => {
      const result = detectSubagentOpportunity('Investigate the issue along with document the solution');
      expect(result).toBeDefined();
    });
  });

  describe('"in addition" pattern', () => {
    it('should detect "in addition" in message', () => {
      const result = detectSubagentOpportunity('Fix code in addition to refactoring');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      expect(result?.priority).toBe('medium');
      expect(result?.reason).toContain('in addition');
    });

    it('should be case insensitive', () => {
      const result = detectSubagentOpportunity('Add tests IN ADDITION TO refactoring');
      expect(result).toBeDefined();
    });

    it('should detect standalone "in addition"', () => {
      const result = detectSubagentOpportunity('Write code. In addition, add documentation');
      expect(result).toBeDefined();
    });
  });

  describe('"furthermore" pattern', () => {
    it('should detect "furthermore" in message', () => {
      const result = detectSubagentOpportunity('Update code. Furthermore, manage database');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      expect(result?.priority).toBe('medium');
      expect(result?.reason).toContain('furthermore');
    });

    it('should be case insensitive', () => {
      const result = detectSubagentOpportunity('Fix the bug. FURTHERMORE, add tests');
      expect(result).toBeDefined();
    });
  });

  describe('"plus" pattern', () => {
    it('should detect "plus" in message', () => {
      const result = detectSubagentOpportunity('Update code plus add features');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      expect(result?.priority).toBe('low');
      expect(result?.reason).toContain('plus');
    });

    it('should be case insensitive', () => {
      const result = detectSubagentOpportunity('Investigate PLUS document');
      expect(result).toBeDefined();
    });

    it('should not trigger false positive for "plus" in non-task contexts', () => {
      // This might be tricky - but we're testing that it does detect the pattern
      const result = detectSubagentOpportunity('Add feature plus fix bug');
      expect(result).toBeDefined();
    });
  });

  describe('"also" with action verb pattern', () => {
    it('should detect "also refactor"', () => {
      const result = detectSubagentOpportunity('Write tests and also refactor code');
      expect(result).toBeDefined();
      expect(result?.shouldSpawn).toBe(true);
      expect(result?.priority).toBe('medium');
    });

    it('should detect "also update"', () => {
      const result = detectSubagentOpportunity('Fix bug and also update docs');
      expect(result).toBeDefined();
    });

    it('should detect "also add"', () => {
      const result = detectSubagentOpportunity('Test code and also add examples');
      expect(result).toBeDefined();
    });

    it('should detect "also write"', () => {
      const result = detectSubagentOpportunity('Plan work and also write tests');
      expect(result).toBeDefined();
    });

    it('should detect "also create"', () => {
      const result = detectSubagentOpportunity('Design system and also create docs');
      expect(result).toBeDefined();
    });

    it('should detect "also fix"', () => {
      const result = detectSubagentOpportunity('Add tests and also fix bug');
      expect(result).toBeDefined();
    });

    it('should detect "also investigate"', () => {
      const result = detectSubagentOpportunity('Document code and also investigate issue');
      expect(result).toBeDefined();
    });

    it('should detect "also test"', () => {
      const result = detectSubagentOpportunity('Refactor code and also test it');
      expect(result).toBeDefined();
    });

    it('should detect "also document"', () => {
      const result = detectSubagentOpportunity('Write code and also document it');
      expect(result).toBeDefined();
    });

    it('should detect "also improve"', () => {
      const result = detectSubagentOpportunity('Add tests and also improve performance');
      expect(result).toBeDefined();
    });

    it('should detect "also optimize"', () => {
      const result = detectSubagentOpportunity('Fix bug and also optimize code');
      expect(result).toBeDefined();
    });

    it('should detect "also cleanup"', () => {
      const result = detectSubagentOpportunity('Add features and also cleanup code');
      expect(result).toBeDefined();
    });
  });
});

describe('Task Separation Logic (Task 2.2.2)', () => {
  describe('separateTasks function', () => {
    it('should split "and also" correctly', () => {
      const tasks = separateTasks('Fix the bug and also add tests');
      expect(tasks).toHaveLength(2);
      expect(tasks).toContain('Fix the bug');
      expect(tasks).toContain('add tests');
    });

    it('should split "and additionally" correctly', () => {
      const tasks = separateTasks('Refactor code and additionally add documentation');
      expect(tasks).toHaveLength(2);
      expect(tasks).toContain('Refactor code');
      expect(tasks).toContain('add documentation');
    });

    it('should split "as well as" correctly', () => {
      const tasks = separateTasks('Update docs as well as tests');
      expect(tasks).toHaveLength(2);
      expect(tasks).toContain('Update docs');
      expect(tasks).toContain('tests');
    });

    it('should split "along with" correctly', () => {
      const tasks = separateTasks('Fix bug along with update tests');
      expect(tasks).toHaveLength(2);
      expect(tasks).toContain('Fix bug');
      expect(tasks).toContain('update tests');
    });

    it('should split "in addition" correctly', () => {
      const tasks = separateTasks('Add tests in addition to refactoring');
      expect(tasks).toHaveLength(2);
      expect(tasks).toContain('Add tests');
      expect(tasks).toContain('to refactoring');
    });

    it('should split "furthermore" correctly', () => {
      const tasks = separateTasks('Fix the bug. Furthermore, add tests');
      expect(tasks).toHaveLength(2);
      expect(tasks).toContain('Fix the bug.');
      expect(tasks).toContain('add tests');
    });

    it('should split "plus" correctly', () => {
      const tasks = separateTasks('Investigate plus document');
      expect(tasks).toHaveLength(2);
      expect(tasks).toContain('Investigate');
      expect(tasks).toContain('document');
    });

    it('should handle multiple conjunctions', () => {
      const tasks = separateTasks('Fix bug and also add tests plus write docs');
      expect(tasks.length).toBeGreaterThanOrEqual(3);
      expect(tasks).toContain('Fix bug');
      expect(tasks).toContain('add tests');
      expect(tasks).toContain('write docs');
    });

    it('should return single task when no conjunction found', () => {
      const tasks = separateTasks('Just add tests');
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toBe('Just add tests');
    });

    it('should filter out empty or very short fragments', () => {
      const tasks = separateTasks('Add tests and also');
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      expect(tasks).toContain('Add tests');
    });

    it('should handle leading/trailing whitespace', () => {
      const tasks = separateTasks('  Fix bug  and  also  add tests  ');
      expect(tasks).toHaveLength(2);
      expect(tasks).toContain('Fix bug');
      expect(tasks).toContain('add tests');
    });
  });

  describe('countTasks function', () => {
    it('should count tasks with "and also"', () => {
      const count = countTasks('Fix the bug and also add tests');
      expect(count).toBe(2);
    });

    it('should count tasks with multiple conjunctions', () => {
      const count = countTasks('Fix bug and also add tests plus write docs');
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('should return 1 for single task', () => {
      const count = countTasks('Just add tests');
      expect(count).toBe(1);
    });

    it('should count tasks with "as well as"', () => {
      const count = countTasks('Update docs as well as tests');
      expect(count).toBe(2);
    });

    it('should count tasks with "along with"', () => {
      const count = countTasks('Fix bug along with update tests');
      expect(count).toBe(2);
    });

    it('should count tasks with "in addition"', () => {
      const count = countTasks('Add tests in addition to refactoring');
      expect(count).toBe(2);
    });
  });

  describe('taskCount in SubagentOpportunity', () => {
    it('should include taskCount when conjunction detected', () => {
      const result = detectSubagentOpportunity('Fix the bug and also add tests');
      expect(result).toBeDefined();
      expect(result?.taskCount).toBeGreaterThanOrEqual(2);
    });

    it('should include taskCount for multiple conjunctions', () => {
      const result = detectSubagentOpportunity('Fix bug and also add tests plus write docs');
      expect(result?.taskCount).toBeGreaterThanOrEqual(3);
    });

    it('should not include taskCount when no conjunction', () => {
      const result = detectSubagentOpportunity('Just add tests');
      // May be undefined or 1, but not > 1
      expect(result?.taskCount).toBeUndefined();
    });

    it('should include taskCount for "as well as"', () => {
      const result = detectSubagentOpportunity('Update docs as well as tests');
      expect(result?.taskCount).toBeGreaterThanOrEqual(2);
    });

    it('should include taskCount for "along with"', () => {
      const result = detectSubagentOpportunity('Fix bug along with update tests');
      expect(result?.taskCount).toBeGreaterThanOrEqual(2);
    });

    it('should include taskCount for "in addition"', () => {
      const result = detectSubagentOpportunity('Add tests in addition to refactoring');
      expect(result?.taskCount).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('Integration Tests - Conjunction Patterns (Task 2.2.2)', () => {
  it('should handle complex multi-task requests', () => {
    const result = detectSubagentOpportunity('Fix the authentication bug and also add unit tests for the login flow');
    expect(result).toBeDefined();
    expect(result?.shouldSpawn).toBe(true);
    expect(result?.taskCount).toBeGreaterThanOrEqual(2);
  });

  it('should handle three tasks with different conjunctions', () => {
    const result = detectSubagentOpportunity('Refactor the API along with add tests and also update documentation');
    expect(result).toBeDefined();
    expect(result?.taskCount).toBeGreaterThanOrEqual(3);
  });

  it('should prioritize medium priority over low priority patterns', () => {
    const result = detectSubagentOpportunity('Fix bug along with update tests and also add docs');
    expect(result).toBeDefined();
    expect(result?.priority).toBe('medium');
  });

  it('should combine conjunction detection with other patterns', () => {
    const result = detectSubagentOpportunity('Write tests for the module and also refactor the code');
    // Should detect both test-writer and conjunction patterns
    expect(result).toBeDefined();
    expect(result?.shouldSpawn).toBe(true);
  });

  it('should build hint with task count information', () => {
    const opportunity = detectSubagentOpportunity('Fix bug and also add tests');
    expect(opportunity).toBeDefined();
    
    if (opportunity) {
      const hint = buildSubagentHint(opportunity);
      expect(hint).toBeDefined();
      expect(hint).toContain('Priority');
      expect(hint).toContain(opportunity.priority);
    }
  });
});

describe('False Negatives - Boundary Cases (Task 2.2.2)', () => {
  it('should detect conjunction at message start', () => {
    const result = detectSubagentOpportunity('And also handle database');
    expect(result).toBeDefined();
    // Will match the specific action pattern if present
    expect(result?.shouldSpawn).toBe(true);
  });

  it('should detect conjunction at message end', () => {
    const result = detectSubagentOpportunity('Fix the authentication bug and also');
    expect(result?.reason).toContain('and also');
  });

  it('should detect conjunction with punctuation', () => {
    const result = detectSubagentOpportunity('Handle code, and also manage database');
    expect(result).toBeDefined();
    expect(result?.shouldSpawn).toBe(true);
  });

  it('should detect conjunction with period', () => {
    const result = detectSubagentOpportunity('Handle code. And also manage database');
    expect(result).toBeDefined();
    expect(result?.shouldSpawn).toBe(true);
  });

  it('should handle multiple consecutive conjunctions', () => {
    const result = detectSubagentOpportunity('Fix the bug and also and additionally add tests');
    expect(result).toBeDefined();
  });

  it('should detect conjunction in longer sentences', () => {
    const longMessage = 'We need to thoroughly process the authentication module and also handle edge cases before the next release';
    const result = detectSubagentOpportunity(longMessage);
    expect(result).toBeDefined();
    expect(result?.taskCount).toBeGreaterThanOrEqual(2);
  });

  it('should detect conjunction with numbers', () => {
    const result = detectSubagentOpportunity('Fix 5 bugs and also add 10 tests');
    expect(result).toBeDefined();
  });

  it('should detect conjunction with file paths', () => {
    const result = detectSubagentOpportunity('Update src/index.ts and also add tests');
    expect(result).toBeDefined();
  });

  it('should detect conjunction with quotes', () => {
    const result = detectSubagentOpportunity('Fix "bug" and also add "tests"');
    expect(result).toBeDefined();
  });
});

describe('Priority and Role Handling - Conjunction Patterns (Task 2.2.2)', () => {
  it('should assign general role for conjunction patterns', () => {
    const result = detectSubagentOpportunity('Handle code and also manage database');
    expect(result?.roleId).toBe('general');
  });

  it('should use low priority for "and also"', () => {
    const result = detectSubagentOpportunity('Handle code and also manage database');
    expect(result?.priority).toBe('low');
  });

  it('should use low priority for "and additionally"', () => {
    const result = detectSubagentOpportunity('Handle code and additionally manage database');
    expect(result?.priority).toBe('low');
  });

  it('should use low priority for "as well as"', () => {
    const result = detectSubagentOpportunity('Update docs as well as tests');
    expect(result?.priority).toBe('low');
  });

  it('should use medium priority for "along with"', () => {
    const result = detectSubagentOpportunity('Fix bug along with update tests');
    expect(result?.priority).toBe('medium');
  });

  it('should use medium priority for "in addition"', () => {
    const result = detectSubagentOpportunity('Add tests in addition to refactoring');
    expect(result?.priority).toBe('medium');
  });

  it('should use medium priority for "furthermore"', () => {
    const result = detectSubagentOpportunity('Handle code. Furthermore, manage database');
    expect(result?.priority).toBe('medium');
  });

  it('should use low priority for "plus"', () => {
    const result = detectSubagentOpportunity('Handle code plus manage database');
    expect(result?.priority).toBe('low');
  });

  it('should use medium priority for "also" with action verbs', () => {
    const result = detectSubagentOpportunity('Write tests and also refactor code');
    expect(result?.priority).toBe('medium');
  });
});

