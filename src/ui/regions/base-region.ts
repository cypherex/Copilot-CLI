/**
 * Base class for UI regions that own a portion of the screen
 */

import type { RenderManager } from '../render-manager.js';

export interface RegionConfig {
  id: string;
  height: number;        // Fixed height in lines
  position: 'top' | 'bottom';  // Anchor position
  zIndex?: number;
}

/**
 * Base class for screen regions
 * Each region owns a specific area and manages its own content
 */
export abstract class BaseRegion {
  protected id: string;
  protected height: number;
  protected position: 'top' | 'bottom';
  protected zIndex: number;
  protected renderManager: RenderManager | null = null;
  protected content: string[] = [];
  protected visible = true;

  constructor(config: RegionConfig) {
    this.id = config.id;
    this.height = config.height;
    this.position = config.position;
    this.zIndex = config.zIndex ?? 0;
  }

  /**
   * Attach to a render manager
   */
  attach(renderManager: RenderManager): void {
    this.renderManager = renderManager;
    this.renderManager.registerRegion({
      id: this.id,
      startRow: this.position === 'bottom' ? -1 : 0,
      height: this.height,
      zIndex: this.zIndex,
      visible: this.visible,
      stack: true,
    });
  }

  /**
   * Detach from render manager
   */
  detach(): void {
    if (this.renderManager) {
      this.renderManager.unregisterRegion(this.id);
      this.renderManager = null;
    }
  }

  /**
   * Update the region's content
   */
  protected update(content: string[]): void {
    this.content = content;
    if (this.renderManager) {
      this.renderManager.updateRegion(this.id, content);
    }
  }

  /**
   * Show/hide the region
   */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.renderManager) {
      this.renderManager.setRegionVisible(this.id, visible);
    }
  }

  /**
   * Get region ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get region height
   */
  getHeight(): number {
    return this.height;
  }

  /**
   * Abstract render method - subclasses implement their rendering logic
   */
  abstract render(): void;
}
