/**
 * Spinner region - replaces ora for managed spinner display
 */

import chalk from 'chalk';
import { BaseRegion } from './base-region.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Managed spinner that integrates with RenderManager
 * Use this instead of ora when RenderManager is active
 */
export class SpinnerRegion extends BaseRegion {
  private message = '';
  private frameIndex = 0;
  private intervalId: NodeJS.Timeout | null = null;
  private isSpinning = false;
  private spinnerColor: (s: string) => string = chalk.cyan;

  constructor(regionId: string = 'spinner') {
    super({
      id: regionId,
      height: 1,
      position: 'top',
      zIndex: 50,
    });
    this.visible = false;
  }

  /**
   * Start the spinner with a message
   */
  start(message: string): void {
    this.message = message;
    this.isSpinning = true;
    this.frameIndex = 0;
    this.setVisible(true);

    // Start animation
    this.intervalId = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
      this.render();
    }, 80);

    this.render();
  }

  /**
   * Update the spinner message
   */
  updateMessage(message: string): void {
    this.message = message;
    this.render();
  }

  /**
   * Stop the spinner with success
   */
  succeed(message?: string): void {
    this.stop();
    if (message) {
      this.message = message;
    }
    this.update([chalk.green('✔ ') + this.message]);

    // Auto-hide after a moment
    setTimeout(() => this.setVisible(false), 1000);
  }

  /**
   * Stop the spinner with failure
   */
  fail(message?: string): void {
    this.stop();
    if (message) {
      this.message = message;
    }
    this.update([chalk.red('✖ ') + this.message]);

    // Auto-hide after a moment
    setTimeout(() => this.setVisible(false), 2000);
  }

  /**
   * Stop the spinner with warning
   */
  warn(message?: string): void {
    this.stop();
    if (message) {
      this.message = message;
    }
    this.update([chalk.yellow('⚠ ') + this.message]);

    setTimeout(() => this.setVisible(false), 1500);
  }

  /**
   * Stop the spinner with info
   */
  info(message?: string): void {
    this.stop();
    if (message) {
      this.message = message;
    }
    this.update([chalk.blue('ℹ ') + this.message]);

    setTimeout(() => this.setVisible(false), 1000);
  }

  /**
   * Stop the spinner (no final state)
   */
  stop(): void {
    this.isSpinning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Clear and hide the spinner
   */
  clear(): void {
    this.stop();
    this.setVisible(false);
  }

  /**
   * Set spinner color
   */
  setColor(colorFn: (s: string) => string): void {
    this.spinnerColor = colorFn;
  }

  /**
   * Render the spinner
   */
  render(): void {
    if (!this.isSpinning) return;

    const frame = SPINNER_FRAMES[this.frameIndex];
    const spinnerLine = this.spinnerColor(frame) + ' ' + this.message;
    this.update([spinnerLine]);
  }
}
