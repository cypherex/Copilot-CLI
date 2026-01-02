// Box drawing utilities for hierarchical display

import chalk from 'chalk';

/**
 * Box drawing characters for creating visual hierarchy
 */
export const BOX_CHARS = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  verticalRight: '├',
  horizontalDown: '┬',
  horizontalUp: '┴',
  cross: '┼',
} as const;

/**
 * Tree drawing characters for nested structures
 */
export const TREE_CHARS = {
  branch: '├─',
  lastBranch: '└─',
  vertical: '│ ',
  space: '  ',
} as const;

/**
 * Draw a box around content
 */
export function drawBox(content: string, title?: string, width?: number): string {
  const lines = content.split('\n');
  const contentWidth = width || Math.max(...lines.map(l => stripAnsi(l).length), title ? title.length + 2 : 0);

  const topBorder = BOX_CHARS.topLeft + BOX_CHARS.horizontal.repeat(contentWidth) + BOX_CHARS.topRight;
  const bottomBorder = BOX_CHARS.bottomLeft + BOX_CHARS.horizontal.repeat(contentWidth) + BOX_CHARS.bottomRight;

  const result: string[] = [];

  if (title) {
    result.push(chalk.blue(topBorder));
    result.push(chalk.blue(BOX_CHARS.vertical) + ' ' + chalk.bold(title) + ' '.repeat(contentWidth - title.length - 1) + chalk.blue(BOX_CHARS.vertical));
    result.push(chalk.blue(BOX_CHARS.verticalRight + BOX_CHARS.horizontal.repeat(contentWidth) + BOX_CHARS.vertical));
  } else {
    result.push(chalk.blue(topBorder));
  }

  for (const line of lines) {
    const padding = ' '.repeat(Math.max(0, contentWidth - stripAnsi(line).length));
    result.push(chalk.blue(BOX_CHARS.vertical) + ' ' + line + padding + ' ' + chalk.blue(BOX_CHARS.vertical));
  }

  result.push(chalk.blue(bottomBorder));

  return result.join('\n');
}

/**
 * Create indented block with tree characters
 */
export function indent(content: string, level: number, isLast: boolean = false): string {
  const lines = content.split('\n');
  const prefix = isLast ? TREE_CHARS.lastBranch : TREE_CHARS.branch;
  const continuation = isLast ? TREE_CHARS.space : TREE_CHARS.vertical;

  const indentStr = TREE_CHARS.space.repeat(level);

  return lines.map((line, idx) => {
    if (idx === 0) {
      return indentStr + chalk.dim(prefix) + ' ' + line;
    }
    return indentStr + chalk.dim(continuation) + ' ' + line;
  }).join('\n');
}

/**
 * Create a simple indented block without tree characters
 */
export function simpleIndent(content: string, spaces: number): string {
  const indentStr = ' '.repeat(spaces);
  return content.split('\n').map(line => indentStr + line).join('\n');
}

/**
 * Draw a horizontal separator
 */
export function separator(width?: number, char: string = BOX_CHARS.horizontal): string {
  const w = width || process.stdout.columns || 80;
  return chalk.dim(char.repeat(w));
}

/**
 * Create a collapsible section header
 */
export function collapsibleHeader(title: string, isExpanded: boolean, count?: number): string {
  const icon = isExpanded ? '▼' : '▶';
  const countStr = count !== undefined ? chalk.dim(` (${count})`) : '';
  return chalk.bold(`${icon} ${title}`) + countStr;
}

/**
 * Format a key-value pair for display
 */
export function keyValue(key: string, value: string, keyColor = chalk.gray, valueColor = chalk.white): string {
  return keyColor(key + ':') + ' ' + valueColor(value);
}

/**
 * Create a nested list item
 */
export function listItem(content: string, level: number = 0, bullet: string = '•'): string {
  const indentStr = '  '.repeat(level);
  return indentStr + chalk.dim(bullet) + ' ' + content;
}

/**
 * Strip ANSI escape codes to get plain text length
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Wrap text to specified width while preserving indentation
 */
export function wrapText(text: string, width: number, indent: number = 0): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  const indentStr = ' '.repeat(indent);

  for (const word of words) {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    if (stripAnsi(testLine).length <= width - indent) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(indentStr + currentLine);
      }
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(indentStr + currentLine);
  }

  return lines.join('\n');
}

/**
 * Create a progress bar
 */
export function progressBar(current: number, total: number, width: number = 20): string {
  const percentage = Math.min(100, Math.max(0, (current / total) * 100));
  const filled = Math.floor((width * percentage) / 100);
  const empty = width - filled;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const percentStr = `${Math.floor(percentage)}%`;

  let color = chalk.green;
  if (percentage < 33) color = chalk.red;
  else if (percentage < 66) color = chalk.yellow;

  return color(`[${bar}]`) + ' ' + chalk.white(percentStr);
}

/**
 * Create a status badge
 */
export function statusBadge(status: 'success' | 'error' | 'warning' | 'info' | 'pending'): string {
  switch (status) {
    case 'success':
      return chalk.green('✓');
    case 'error':
      return chalk.red('✗');
    case 'warning':
      return chalk.yellow('⚠');
    case 'info':
      return chalk.blue('ℹ');
    case 'pending':
      return chalk.gray('○');
  }
}

/**
 * Create a hierarchical structure display
 */
export interface TreeNode {
  label: string;
  children?: TreeNode[];
  expanded?: boolean;
  metadata?: string;
}

export function renderTree(node: TreeNode, level: number = 0, isLast: boolean = true, prefix: string = ''): string {
  const lines: string[] = [];

  const connector = isLast ? TREE_CHARS.lastBranch : TREE_CHARS.branch;
  const currentPrefix = level === 0 ? '' : prefix;

  const labelLine = currentPrefix + chalk.dim(connector) + ' ' + node.label;
  const metadataStr = node.metadata ? ' ' + chalk.dim(node.metadata) : '';
  lines.push(labelLine + metadataStr);

  if (node.children && node.children.length > 0 && node.expanded !== false) {
    const childPrefix = level === 0 ? '' : prefix + (isLast ? TREE_CHARS.space : TREE_CHARS.vertical);

    node.children.forEach((child, idx) => {
      const childIsLast = idx === node.children!.length - 1;
      lines.push(renderTree(child, level + 1, childIsLast, childPrefix));
    });
  }

  return lines.join('\n');
}
