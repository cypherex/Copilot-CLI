/**
 * Header region - renders a pinned header at the top of the terminal UI
 */

import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BaseRegion } from './base-region.js';
import { uiState, type UIStateData } from '../ui-state.js';
import { getRenderManager } from '../render-manager.js';

export class HeaderRegion extends BaseRegion {
  private unsubscribe?: () => void;
  private readonly version: string;

  constructor() {
    super({
      id: 'header',
      height: 3,
      position: 'top',
      zIndex: 80,
    });
    this.version = this.readVersionSafe();
  }

  startListening(): void {
    this.unsubscribe = uiState.subscribe((_state, changedKeys) => {
      const relevant: (keyof UIStateData)[] = [
        'modelName',
        'providerName',
        'agentStatus',
        'statusMessage',
        'currentToolExecution',
      ];
      if (changedKeys.some(k => relevant.includes(k))) {
        this.render();
      }
    });
    this.render();
  }

  stopListening(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  render(): void {
    const state = uiState.getState();
    const width = getRenderManager()?.getTerminalWidth() ?? process.stdout.columns ?? 80;
    const innerWidth = Math.max(10, width - 2);

    const title = chalk.bold.cyan(`copilot-cli`) + chalk.dim(` v${this.version}`);
    const subtitleParts: string[] = [];
    if (state.providerName) subtitleParts.push(state.providerName);
    if (state.modelName) subtitleParts.push(state.modelName);
    const subtitle = subtitleParts.length > 0 ? chalk.dim(subtitleParts.join(' · ')) : '';

    const status = this.renderStatus(state);

    const shortcuts = chalk.dim('Commands: ') +
      chalk.cyan('/help') + chalk.dim(' · ') +
      chalk.cyan('/tasks') + chalk.dim(' · ') +
      chalk.cyan('/sessions') + chalk.dim(' · ') +
      chalk.cyan('/plugins') + chalk.dim(' · ') +
      chalk.cyan('/exit') +
      chalk.dim('   ') +
      chalk.dim('Ctrl+C pause');

    const top = chalk.dim('┌' + '─'.repeat(innerWidth) + '┐');
    const mid = this.boxLineLR(width, title + (subtitle ? chalk.dim('  ') + subtitle : ''), status);
    const bot = this.boxLine(width, shortcuts);

    this.update([top, mid, bot]);
  }

  private boxLine(width: number, content: string): string {
    const innerWidth = Math.max(10, width - 2);
    const plain = this.stripAnsi(content);
    const trimmedPlain = plain.length > innerWidth ? plain.slice(0, innerWidth - 1) + '…' : plain;

    // If we trimmed based on plain text length, also trim the original string crudely.
    // This isn't perfect for ANSI, but avoids overflow in most cases.
    const trimmed = plain.length > innerWidth ? content.slice(0, Math.max(0, content.length - (plain.length - innerWidth + 1))) + '…' : content;

    const padLen = Math.max(0, innerWidth - this.stripAnsi(trimmed).length);
    return chalk.dim('│') + trimmed + ' '.repeat(padLen) + chalk.dim('│');
  }

  private boxLineLR(width: number, left: string, right: string): string {
    const innerWidth = Math.max(10, width - 2);
    const leftPlain = this.stripAnsi(left);
    const rightPlain = this.stripAnsi(right);

    const spacer = '  ';
    const available = innerWidth - rightPlain.length - spacer.length;
    const leftTrimmedPlain =
      leftPlain.length > available
        ? leftPlain.slice(0, Math.max(0, available - 1)) + '…'
        : leftPlain;

    // crude ANSI-trim to match plain trim
    const overflow = leftPlain.length - leftTrimmedPlain.length;
    const leftTrimmed = overflow > 0 ? left.slice(0, Math.max(0, left.length - overflow)) + '…' : left;

    const padLen = Math.max(
      0,
      innerWidth - this.stripAnsi(leftTrimmed).length - spacer.length - rightPlain.length
    );

    return chalk.dim('│') + leftTrimmed + ' '.repeat(padLen) + spacer + right + chalk.dim('│');
  }

  private renderStatus(state: Readonly<UIStateData>): string {
    const statusColors: Record<string, (s: string) => string> = {
      idle: chalk.gray,
      thinking: chalk.yellow,
      executing: chalk.blue,
      waiting: chalk.cyan,
      error: chalk.red,
    };
    const statusIcons: Record<string, string> = {
      idle: '○',
      thinking: '…',
      executing: '▶',
      waiting: '⏳',
      error: '✗',
    };

    const icon = statusIcons[state.agentStatus] || '○';
    const color = statusColors[state.agentStatus] || chalk.gray;

    let label = state.statusMessage || state.agentStatus;
    if (state.agentStatus === 'executing' && state.currentToolExecution?.status === 'running') {
      label = `↪ ${state.currentToolExecution.name}`;
    }

    return color(`${icon} ${label}`);
  }

  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  private readVersionSafe(): string {
    try {
      const pkgPath = join(process.cwd(), 'package.json');
      if (!existsSync(pkgPath)) return '0.0.0';
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
}
