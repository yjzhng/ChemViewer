/** Deterministic even sampling (no RNG) — picks up to `k` spread-out indices. */
export function sampleIndices(total: number, k: number): number[] {
  if (total <= k) return Array.from({ length: total }, (_, i) => i);
  const out: number[] = [];
  const step = total / k;
  for (let i = 0; i < k; i++) out.push(Math.floor(i * step));
  return out;
}
