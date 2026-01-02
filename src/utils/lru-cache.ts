/**
 * Simple LRU (Least Recently Used) Cache implementation
 * Automatically evicts least recently used entries when capacity is reached
 */

export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private capacity: number;

  constructor(capacity: number = 100) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  /**
   * Get a value from the cache
   * Updates the item as most recently used
   */
  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }

    // Move to end to mark as recently used
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Set a value in the cache
   * If capacity is exceeded, evicts the least recently used item
   */
  set(key: K, value: V): void {
    // Delete first to update position (LRU behavior)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict least recently used (first item in Map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, value);
  }

  /**
   * Check if key exists in cache
   * Does not update recency
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete a key from cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache entries as array (for debugging)
   */
  entries(): Array<[K, V]> {
    return Array.from(this.cache.entries());
  }

  /**
   * Get cache keys as array (for debugging)
   */
  keys(): K[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache values as array
   */
  values(): V[] {
    return Array.from(this.cache.values());
  }
}
