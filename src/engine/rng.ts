/** Seeded PRNG (mulberry32) plus a hash mixer so every request/trace gets its own independent stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function mix(a: number, b: number, c: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ c, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
/** Independent random stream for (seed, item index, purpose). Same workload => same randomness, whatever else changes. */
export const rngFor = (seed: number, idx: number, salt: number) => mulberry32(mix(seed, idx, salt));
export const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
