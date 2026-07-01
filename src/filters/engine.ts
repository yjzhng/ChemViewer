/**
 * Pure filter engine. Given a library's compounds, the active rules, a global
 * search string, and (optionally) precomputed substructure matches, return the
 * indices of compounds that pass every constraint.
 *
 * Substructure matching is async/expensive, so it is computed elsewhere and
 * passed in as a Set of indices keyed to the active SMARTS.
 */
import type { Compound, FilterRule } from '../data/types';

export interface FilterContext {
  rules: FilterRule[];
  globalSearch: string;
  /** Indices matching the active substructure rule, if it has been run. */
  substructureMatches: Set<number> | null;
  /** Restrict to these compound ids (active subset), or null for no restriction. */
  memberIds: Set<string> | null;
}

function passesGlobal(c: Compound, q: string): boolean {
  if (q === '') return true;
  const needle = q.toLowerCase();
  return (
    c.id.toLowerCase().includes(needle) ||
    c.smiles.toLowerCase().includes(needle)
  );
}

function passesRule(
  c: Compound,
  index: number,
  rule: FilterRule,
  substructureMatches: Set<number> | null,
): boolean {
  switch (rule.type) {
    case 'number-range': {
      const v = c.props[rule.column];
      if (typeof v !== 'number' || Number.isNaN(v)) return false;
      if (rule.min !== undefined && v < rule.min) return false;
      if (rule.max !== undefined && v > rule.max) return false;
      return true;
    }
    case 'text-contains': {
      const v = rule.column === 'id' ? c.id : c.props[rule.column];
      return String(v ?? '')
        .toLowerCase()
        .includes(rule.query.toLowerCase());
    }
    case 'substructure':
      // If not yet computed, the rule is inert (matches nothing is too harsh).
      return substructureMatches === null || substructureMatches.has(index);
    case 'value-in': {
      if (rule.values.length === 0) return true;
      const v = rule.column === 'id' ? c.id : c.props[rule.column];
      return rule.values.includes(String(v ?? ''));
    }
  }
}

export function applyFilters(
  compounds: Compound[],
  ctx: FilterContext,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < compounds.length; i++) {
    const c = compounds[i];
    if (ctx.memberIds && !ctx.memberIds.has(c.id)) continue;
    if (!passesGlobal(c, ctx.globalSearch)) continue;
    let ok = true;
    for (const rule of ctx.rules) {
      if (!passesRule(c, i, rule, ctx.substructureMatches)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}
