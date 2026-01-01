import { readFileSync } from 'fs';
import { join, normalize } from 'path';
import chalk from 'chalk';

export interface FileRelationship {
  file: string;
  dependsOn: string[];
  dependedOnBy: string[];
  lastEditedWith: string[]; // Files commonly edited together
  lastEditTime?: Date;
}

export interface EditSession {
  files: string[];
  startTime: Date;
  endTime?: Date;
}

/**
 * Tracks file relationships including dependencies and editing patterns
 */
export class FileRelationshipTracker {
  private relationships: Map<string, FileRelationship> = new Map();
  private editSession: EditSession | null = null;
  private editHistory: EditSession[] = [];
  private readonly maxHistorySize = 50;

  /**
   * Record that a file was read or edited
   */
  trackFileAccess(filePath: string, isEdit: boolean = false): void {
    const normalizedPath = this.normalizePath(filePath);
    let relationship = this.relationships.get(normalizedPath);

    if (!relationship) {
      relationship = {
        file: normalizedPath,
        dependsOn: [],
        dependedOnBy: [],
        lastEditedWith: [],
        lastEditTime: new Date(),
      };
      this.relationships.set(normalizedPath, relationship);
    }

    // Track dependencies if this is a source file
    if (isEdit) {
      this.trackDependencies(normalizedPath);
      relationship.lastEditTime = new Date();
    }
  }

  /**
   * Track a file edit session (multiple files edited together)
   */
  startEditSession(files: string[]): void {
    const normalizedFiles = files.map(f => this.normalizePath(f));

    this.editSession = {
      files: normalizedFiles,
      startTime: new Date(),
    };
  }

  /**
   * End current edit session and record relationships
   */
  endEditSession(): void {
    if (!this.editSession) return;

    this.editSession.endTime = new Date();

    // Record that files were edited together
    for (let i = 0; i < this.editSession.files.length; i++) {
      const file1 = this.editSession.files[i];
      const relationship1 = this.getOrCreate(file1);

      for (let j = 0; j < this.editSession.files.length; j++) {
        if (i === j) continue;

        const file2 = this.editSession.files[j];
        relationship1.lastEditedWith = this.updateFrequency(
          relationship1.lastEditedWith,
          file2
        );
      }
    }

    // Store in history
    this.editHistory.unshift(this.editSession);
    if (this.editHistory.length > this.maxHistorySize) {
      this.editHistory.pop();
    }

    this.editSession = null;
  }

  /**
   * Get suggestions for related files when editing
   */
  getSuggestions(filePath: string, maxSuggestions: number = 5): string[] {
    const normalizedPath = this.normalizePath(filePath);
    const relationship = this.relationships.get(normalizedPath);

    if (!relationship) return [];

    const suggestions: Set<string> = new Set();

    // Add dependencies
    relationship.dependsOn.forEach(dep => suggestions.add(dep));

    // Add files that depend on this
    relationship.dependedOnBy.forEach(dep => suggestions.add(dep));

    // Add commonly edited together files
    relationship.lastEditedWith.forEach(file => suggestions.add(file));

    // Sort by frequency of co-editing and return top N
    return Array.from(suggestions).slice(0, maxSuggestions);
  }

  /**
   * Check if we should show a prompt for related files
   */
  shouldPrompt(filePath: string): boolean {
    const normalizedPath = this.normalizePath(filePath);
    const relationship = this.relationships.get(normalizedPath);

    if (!relationship) return false;

    // Prompt if:
    // - Has dependencies OR
    // - Is depended on by others OR
    // - Has been edited with other files recently
    return (
      relationship.dependsOn.length > 0 ||
      relationship.dependedOnBy.length > 0 ||
      relationship.lastEditedWith.length > 0
    );
  }

  /**
   * Display prompt with related file suggestions
   */
  displayPrompt(filePath: string): void {
    const normalizedPath = this.normalizePath(filePath);
    const suggestions = this.getSuggestions(filePath, 5);

    if (suggestions.length === 0) return;

    const relationship = this.relationships.get(normalizedPath);
    if (!relationship) return;

    console.log();
    console.log(chalk.cyan('📁 Related Files:'));
    console.log(chalk.dim(`   Last time you edited ${this.shortPath(normalizedPath)} with:`));

    suggestions.forEach((suggestion, index) => {
      const coEditCount = this.getCoEditCount(normalizedPath, suggestion);
      const isDependency = relationship.dependsOn.includes(suggestion);
      const isDependent = relationship.dependedOnBy.includes(suggestion);

      let label = '';
      if (isDependency) label = chalk.dim('[import]');
      else if (isDependent) label = chalk.dim('[imported by]');
      else label = chalk.dim(`[${coEditCount} edits]`);

      console.log(chalk.dim(`   ${index + 1}. ${label} ${this.shortPath(suggestion)}`));
    });

    console.log();
    console.log(chalk.green('💡 Suggestion:'));
    console.log(chalk.dim('   Consider loading these files for context or editing them together.'));
    console.log();
  }

  /**
   * Get relationships for a file
   */
  getRelationships(filePath: string): FileRelationship | undefined {
    return this.relationships.get(this.normalizePath(filePath));
  }

  /**
   * Get all relationships
   */
  getAllRelationships(): FileRelationship[] {
    return Array.from(this.relationships.values());
  }

  /**
   * Track dependencies by parsing imports/requires
   */
  private trackDependencies(filePath: string): void {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const relationship = this.getOrCreate(filePath);

      // Detect TypeScript/JavaScript imports
      const importMatches = content.matchAll(
        /from ['"]((?!\.|\.)[^'"]+)['"]|require\(['"]((?!\.|\.)[^'"]+)['"]\)/g
      );

      for (const match of importMatches) {
        const dep = match[1] || match[2];
        if (dep) {
          // This is an external dependency, could also track relative imports
          // For now, we focus on co-editing patterns
        }
      }

      // Detect relative imports
      const relativeImportMatches = content.matchAll(
        /from ['"](\.\.?\/[^'"]+)['"]|require\(['"](\.\.?\/[^'"]+)['"]\)/g
      );

      for (const match of relativeImportMatches) {
        const relativePath = match[1] || match[2];
        if (relativePath) {
          // Resolve relative path
          const absolutePath = this.resolveRelativePath(filePath, relativePath);
          if (absolutePath) {
            this.addDependency(filePath, absolutePath);
          }
        }
      }
    } catch (error) {
      // File might not exist or be readable, ignore
    }
  }

  /**
   * Add a dependency relationship
   */
  private addDependency(file: string, dependency: string): void {
    const relationship = this.getOrCreate(file);
    const depRelationship = this.getOrCreate(dependency);

    // Record that file depends on dependency
    if (!relationship.dependsOn.includes(dependency)) {
      relationship.dependsOn.push(dependency);
    }

    // Record that dependency is depended on by file
    if (!depRelationship.dependedOnBy.includes(file)) {
      depRelationship.dependedOnBy.push(file);
    }
  }

  /**
   * Update frequency count for co-edited files
   */
  private updateFrequency(files: string[], fileToAdd: string): string[] {
    // Move file to front if exists, add to front if not
    const index = files.indexOf(fileToAdd);
    if (index > -1) {
      files.splice(index, 1);
    }
    files.unshift(fileToAdd);

    // Keep only top 10 most frequent
    if (files.length > 10) {
      return files.slice(0, 10);
    }

    return files;
  }

  /**
   * Get or create relationship for a file
   */
  private getOrCreate(filePath: string): FileRelationship {
    const normalizedPath = this.normalizePath(filePath);
    let relationship = this.relationships.get(normalizedPath);

    if (!relationship) {
      relationship = {
        file: normalizedPath,
        dependsOn: [],
        dependedOnBy: [],
        lastEditedWith: [],
        lastEditTime: new Date(),
      };
      this.relationships.set(normalizedPath, relationship);
    }

    return relationship;
  }

  /**
   * Normalize file path
   */
  private normalizePath(filePath: string): string {
    return normalize(filePath);
  }

  /**
   * Get shortened path for display
   */
  private shortPath(filePath: string): string {
    // Show just filename and parent directory
    const parts = filePath.split(/[/\\]/);
    if (parts.length <= 2) return filePath;
    return join(...parts.slice(-2));
  }

  /**
   * Resolve relative import path to absolute
   */
  private resolveRelativePath(fromFile: string, relativePath: string): string | null {
    try {
      const fromDir = normalize(fromFile).split(/[/\\]/);
      fromDir.pop(); // Remove filename

      const relParts = relativePath.split(/[\\/]/);
      let resolvedParts = [...fromDir];

      for (const part of relParts) {
        if (part === '..') {
          resolvedParts.pop();
        } else if (part !== '.') {
          resolvedParts.push(part);
        }
      }

      return resolvedParts.join('/');
    } catch {
      return null;
    }
  }

  /**
   * Get co-edit count from history
   */
  private getCoEditCount(file1: string, file2: string): number {
    let count = 0;
    for (const session of this.editHistory) {
      const has1 = session.files.includes(file1);
      const has2 = session.files.includes(file2);
      if (has1 && has2) count++;
    }
    return count;
  }
}
