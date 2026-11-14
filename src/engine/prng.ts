export const DEFAULT_SEED = 20260801;

/**
 * Deterministic hash from seed + string key -> 32-bit unsigned int.
 */
export function hashString(seed: number, key: string): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Final avalanche mix (Murmur3)
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Deterministic unit float in [0, 1) for a seed and key.
 */
export function seededUnit(seed: number, key: string): number {
  return hashString(seed, key) / 4294967296;
}

/**
 * Deterministic float in [min, max] for a seed and key.
 */
export function seededRange(seed: number, key: string, min: number, max: number): number {
  return min + (max - min) * seededUnit(seed, key);
}
