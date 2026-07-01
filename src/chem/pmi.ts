/**
 * Principal Moments of Inertia (PMI) shape descriptors via OpenChemLib.
 *
 * OCL generates a 3D conformer (pure JS, the DataWarrior engine); we build the
 * mass-weighted inertia tensor, take its eigenvalues I1≤I2≤I3, and return the
 * normalized ratios NPR1 = I1/I3, NPR2 = I2/I3 — the axes of the rod–disc–sphere
 * triangle. OCL is large, so it's lazy-loaded on first use. Cached by SMILES.
 */
export interface NPR {
  npr1: number;
  npr2: number;
}

const MASS: Record<number, number> = {
  1: 1.008, 5: 10.81, 6: 12.011, 7: 14.007, 8: 15.999, 9: 18.998,
  14: 28.085, 15: 30.974, 16: 32.06, 17: 35.45, 35: 79.904, 53: 126.904,
};
const massOf = (z: number) => MASS[z] ?? 12;

const cache = new Map<string, NPR | null>();
const CACHE_MAX = 100_000;

let oclPromise: Promise<typeof import('openchemlib')> | null = null;
function getOCL() {
  if (!oclPromise) {
    oclPromise = (async () => {
      const OCL = await import('openchemlib');
      // ConformerGenerator needs its torsion/fragment resources registered.
      await OCL.Resources.registerFromUrl('/ocl/resources.json');
      return OCL;
    })();
  }
  return oclPromise;
}

/** Eigenvalues of a symmetric 3×3 matrix via cyclic Jacobi rotation. */
function eig3(
  xx: number, yy: number, zz: number,
  xy: number, xz: number, yz: number,
): [number, number, number] {
  const a = [
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    let p = 0, q = 1, max = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > max) { max = Math.abs(a[0][2]); p = 0; q = 2; }
    if (Math.abs(a[1][2]) > max) { max = Math.abs(a[1][2]); p = 1; q = 2; }
    if (max < 1e-12) break;
    const phi = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(phi), s = Math.sin(phi);
    for (let k = 0; k < 3; k++) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = c * akp - s * akq;
      a[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p][k], aqk = a[q][k];
      a[p][k] = c * apk - s * aqk;
      a[q][k] = s * apk + c * aqk;
    }
  }
  return [a[0][0], a[1][1], a[2][2]];
}

/** Compute NPR1/NPR2 for a SMILES (cached). Null if 3D generation fails. */
export async function computeNPR(smiles: string): Promise<NPR | null> {
  const cached = cache.get(smiles);
  if (cached !== undefined) return cached;

  let result: NPR | null = null;
  try {
    const OCL = await getOCL();
    const mol = OCL.Molecule.fromSmiles(smiles);
    const conf = new OCL.ConformerGenerator(42).getOneConformerAsMolecule(mol);
    if (conf) {
      const n = conf.getAllAtoms();
      let mx = 0, my = 0, mz = 0, M = 0;
      const ms = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        const m = massOf(conf.getAtomicNo(i));
        ms[i] = m;
        M += m;
        mx += m * conf.getAtomX(i);
        my += m * conf.getAtomY(i);
        mz += m * conf.getAtomZ(i);
      }
      if (M > 0 && n >= 2) {
        mx /= M; my /= M; mz /= M;
        let Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0;
        for (let i = 0; i < n; i++) {
          const m = ms[i];
          const x = conf.getAtomX(i) - mx;
          const y = conf.getAtomY(i) - my;
          const z = conf.getAtomZ(i) - mz;
          Ixx += m * (y * y + z * z);
          Iyy += m * (x * x + z * z);
          Izz += m * (x * x + y * y);
          Ixy -= m * x * y;
          Ixz -= m * x * z;
          Iyz -= m * y * z;
        }
        const [I1, I2, I3] = eig3(Ixx, Iyy, Izz, Ixy, Ixz, Iyz).sort(
          (p, q) => p - q,
        );
        if (I3 > 1e-9) result = { npr1: I1 / I3, npr2: I2 / I3 };
      }
    }
  } catch {
    /* parse / 3D failure → null */
  }

  cache.set(smiles, result);
  if (cache.size > CACHE_MAX) {
    const k = cache.keys().next().value;
    if (k !== undefined) cache.delete(k);
  }
  return result;
}

export interface NPRBatchOptions {
  /** Return true to abort early (e.g. the filter/library changed). */
  shouldStop?: () => boolean;
  /** Called after each molecule with (done, total) for progress display. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Compute NPRs for many SMILES, yielding after each so the UI stays responsive.
 * `shouldStop` lets a superseded run (e.g. filter changed) bail out early
 * instead of grinding through hundreds of 3D generations in the background.
 */
export async function computeNPRBatch(
  smilesList: string[],
  opts?: NPRBatchOptions,
): Promise<(NPR | null)[]> {
  const out: (NPR | null)[] = new Array(smilesList.length).fill(null);
  for (let i = 0; i < smilesList.length; i++) {
    if (opts?.shouldStop?.()) break;
    out[i] = await computeNPR(smilesList[i]);
    opts?.onProgress?.(i + 1, smilesList.length);
    await new Promise((r) => setTimeout(r));
  }
  return out;
}
