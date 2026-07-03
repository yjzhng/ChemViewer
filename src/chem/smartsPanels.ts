/**
 * SMARTS panels for functional-group enrichment and structural-alert flagging.
 * The worker compiles these and tests each sampled molecule; the main thread
 * turns per-compound hits into per-set rates. All patterns are validated to
 * compile in RDKit's minimal WASM build.
 */
export interface SmartsPattern {
  label: string;
  smarts: string;
}

/** Common functional groups (for "what is this library made of"). */
export const FUNCTIONAL_GROUPS: SmartsPattern[] = [
  { label: 'Carboxylic acid', smarts: '[CX3](=O)[OX2H1]' },
  { label: 'Ester', smarts: '[CX3](=O)[OX2][#6]' },
  { label: 'Amide', smarts: '[NX3][CX3]=[OX1]' },
  { label: '1° amine', smarts: '[NX3;H2;!$(NC=O);!$(N=*)][#6]' },
  { label: '2° amine', smarts: '[NX3;H1;!$(NC=O);!$(N=*)]([#6])[#6]' },
  { label: '3° amine', smarts: '[NX3;H0;!$(NC=O);!$(N=*);!$([NX3][a])]([#6])([#6])[#6]' },
  { label: 'Hydroxyl', smarts: '[OX2H]' },
  { label: 'Ether', smarts: '[OD2]([#6])[#6]' },
  { label: 'Halide', smarts: '[F,Cl,Br,I]' },
  { label: 'Nitrile', smarts: '[NX1]#[CX2]' },
  { label: 'Nitro', smarts: '[$([NX3](=O)=O),$([NX3+](=O)[O-])]' },
  { label: 'Sulfonamide', smarts: '[SX4](=O)(=O)[NX3]' },
  { label: 'Ketone', smarts: '[#6][CX3](=O)[#6]' },
  { label: 'Aromatic ring', smarts: 'c1ccccc1' },
  { label: 'Aromatic N', smarts: '[n]' },
  { label: 'CF3', smarts: '[CX4](F)(F)F' },
  { label: 'Phenol', smarts: 'c[OX2H]' },
];

/** Reactive / undesirable groups (a light structural-alert set). */
export const STRUCTURAL_ALERTS: SmartsPattern[] = [
  { label: 'Michael acceptor', smarts: '[CX3]=[CX3][CX3]=[OX1]' },
  { label: 'Acyl halide', smarts: '[CX3](=[OX1])[F,Cl,Br,I]' },
  { label: 'Aldehyde', smarts: '[CX3H1]=O' },
  { label: 'Epoxide', smarts: '[OX2r3]1[#6r3][#6r3]1' },
  { label: 'Isocyanate', smarts: '[NX2]=[CX2]=[OX1]' },
  { label: 'Thiol', smarts: '[SX2H]' },
  { label: 'Hydrazine', smarts: '[NX3][NX3]' },
  { label: 'Azide', smarts: '[NX1]=[NX2]=[NX1]' },
  { label: 'Alkyl halide', smarts: '[CX4][Cl,Br,I]' },
  { label: 'Peroxide', smarts: '[OX2][OX2]' },
];
