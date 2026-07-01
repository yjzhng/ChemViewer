// DuckDB-backed query layer for large libraries (e.g. Enamine REAL 13.6M).
//
// Runs in the Node process that serves Vite (no Electron native rebuild). A
// library file is ingested ONCE into a cached on-disk DuckDB table (keyed by
// path+mtime+size), then all browsing/filtering/sorting/stats run as SQL over
// the full set — low, constant memory; the renderer only ever holds a page.
//
// Substructure/fingerprint search are NOT done here (need a chem index); the
// renderer keeps those sampled.

import { DuckDBInstance } from '@duckdb/node-api'
import { createHash } from 'node:crypto'
import { statSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SMILES_HEADERS = new Set(['smiles', 'structure', 'canonical_smiles'])
const ID_HEADERS = ['catalog id', 'id', 'name', 'idnumber', 'compound id']
const NUMERIC_TYPES =
  /^(DOUBLE|FLOAT|REAL|DECIMAL|HUGEINT|BIGINT|INTEGER|SMALLINT|TINYINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT)/i

// name -> { conn, meta }
const libs = new Map()

const qcol = (c) => '"' + String(c).replace(/"/g, '""') + '"'
const qstr = (s) => "'" + String(s).replace(/'/g, "''") + "'"

async function rows(conn, sql) {
  return (await conn.runAndReadAll(sql)).getRowObjects()
}

/** Open the cached DB read-only (shareable across processes), or null. */
async function tryReadOnly(dbPath) {
  if (!existsSync(dbPath)) return null
  try {
    const inst = await DuckDBInstance.create(dbPath, { access_mode: 'read_only' })
    const conn = await inst.connect()
    const has = await rows(
      conn,
      `SELECT 1 FROM information_schema.tables WHERE table_name='lib'`,
    )
    if (has.length === 0) {
      conn.closeSync()
      inst.closeSync()
      return null
    }
    return conn
  } catch {
    // e.g. file missing, or a pending WAL that needs a read-write replay.
    return null
  }
}

/** Build the table (if missing) + checkpoint the WAL, then release the lock. */
async function buildAndRelease(dbPath, filePaths, format) {
  const fileList = '[' + filePaths.map(qstr).join(', ') + ']'
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const inst = await DuckDBInstance.create(dbPath) // read-write (exclusive)
      const conn = await inst.connect()
      const has = await rows(
        conn,
        `SELECT 1 FROM information_schema.tables WHERE table_name='lib'`,
      )
      if (has.length === 0) {
        const delim = format === 'csv' ? ',' : '\\t'
        await conn.run(
          `CREATE TABLE lib AS SELECT (row_number() OVER ()) - 1 AS rid, * ` +
            `FROM read_csv(${fileList}, delim='${delim}', header=true, ` +
            `quote='"', sample_size=400000, ignore_errors=true, ` +
            `union_by_name=true)`,
        )
      }
      await conn.run('CHECKPOINT') // flush WAL into the main file
      conn.closeSync()
      inst.closeSync()
      return
    } catch {
      // Another process holds the write lock (building/serving) — wait & retry.
      await sleep(500)
    }
  }
  // Gave up the write lock; the table is presumably already built by another
  // process. The caller falls through to a read-only open.
}

/** Ingest (once, cached) and return library metadata. */
export async function ensureLibrary(cacheDir, name, filePaths, format) {
  const sig = createHash('sha1')
    .update(
      filePaths
        .map((p) => {
          const st = statSync(p)
          return `${p}:${st.mtimeMs}:${st.size}`
        })
        .join('|'),
    )
    .digest('hex')
    .slice(0, 12)

  const cached = libs.get(name)
  if (cached && cached.sig === sig) return cached.meta

  mkdirSync(cacheDir, { recursive: true })
  const dbPath = resolve(cacheDir, `${name}-${sig}.duckdb`)

  // Fast path: already built + clean WAL → share read-only. Otherwise build
  // (read-write) once, checkpoint, release the lock, then open read-only.
  let conn = await tryReadOnly(dbPath)
  if (!conn) {
    await buildAndRelease(dbPath, filePaths, format)
    const inst = await DuckDBInstance.create(dbPath, { access_mode: 'read_only' })
    conn = await inst.connect()
  }

  const info = await rows(conn, `PRAGMA table_info('lib')`)
  const names = info.map((r) => String(r.name))
  const smilesKey =
    names.find((n) => SMILES_HEADERS.has(n.trim().toLowerCase())) ?? null
  const lower = names.map((n) => n.trim().toLowerCase())
  let idKey = null
  for (const cand of ID_HEADERS) {
    const i = lower.indexOf(cand)
    if (i >= 0) {
      idKey = names[i]
      break
    }
  }

  const columns = info
    .filter((r) => r.name !== 'rid' && r.name !== smilesKey)
    .map((r) => ({
      key: String(r.name),
      label: String(r.name),
      kind: NUMERIC_TYPES.test(String(r.type)) ? 'number' : 'text',
    }))

  const total = Number((await rows(conn, `SELECT count(*) n FROM lib`))[0].n)

  const meta = {
    name,
    columns,
    total,
    smilesKey,
    idKey,
    numericKeys: columns.filter((c) => c.kind === 'number').map((c) => c.key),
  }
  libs.set(name, { conn, meta, sig })
  return meta
}

function getConn(name) {
  const entry = libs.get(name)
  if (!entry) throw new Error(`library not ingested: ${name}`)
  return entry
}

/** Build a SQL WHERE clause from filter rules + global search. */
function buildWhere(meta, body) {
  const valid = new Set(meta.columns.map((c) => c.key))
  const numeric = new Set(meta.numericKeys)
  const clauses = []
  for (const r of body.rules ?? []) {
    if (r.type === 'number-range' && numeric.has(r.column)) {
      if (Number.isFinite(r.min)) clauses.push(`${qcol(r.column)} >= ${r.min}`)
      if (Number.isFinite(r.max)) clauses.push(`${qcol(r.column)} <= ${r.max}`)
    } else if (r.type === 'text-contains' && valid.has(r.column) && r.query) {
      clauses.push(`CAST(${qcol(r.column)} AS VARCHAR) ILIKE ${qstr('%' + r.query + '%')}`)
    } else if (
      r.type === 'value-in' &&
      valid.has(r.column) &&
      Array.isArray(r.values) &&
      r.values.length > 0
    ) {
      const list = r.values.map((v) => qstr(String(v))).join(', ')
      clauses.push(`CAST(${qcol(r.column)} AS VARCHAR) IN (${list})`)
    }
  }
  const q = (body.globalSearch ?? '').trim()
  if (q) {
    const parts = []
    if (meta.idKey) parts.push(`CAST(${qcol(meta.idKey)} AS VARCHAR) ILIKE ${qstr('%' + q + '%')}`)
    if (meta.smilesKey) parts.push(`${qcol(meta.smilesKey)} ILIKE ${qstr('%' + q + '%')}`)
    if (parts.length) clauses.push(`(${parts.join(' OR ')})`)
  }
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
}

export async function count(name, body) {
  const { conn, meta } = getConn(name)
  const where = buildWhere(meta, body)
  const r = await rows(conn, `SELECT count(*) n FROM lib ${where}`)
  return Number(r[0].n)
}

export async function page(name, body) {
  const { conn, meta } = getConn(name)
  const where = buildWhere(meta, body)
  const valid = new Set(meta.columns.map((c) => c.key))
  const orderKey =
    body.orderBy && (valid.has(body.orderBy) || body.orderBy === meta.smilesKey)
      ? qcol(body.orderBy)
      : 'rid'
  const dir = body.dir === 'desc' ? 'DESC' : 'ASC'
  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 2000)
  const offset = Math.max(Number(body.offset) || 0, 0)

  const select = ['rid']
  if (meta.smilesKey) select.push(`${qcol(meta.smilesKey)} AS smiles`)
  for (const c of meta.columns) select.push(qcol(c.key))

  const data = await rows(
    conn,
    `SELECT ${select.join(', ')} FROM lib ${where} ` +
      `ORDER BY ${orderKey} ${dir} LIMIT ${limit} OFFSET ${offset}`,
  )

  return data.map((row) => {
    const props = {}
    for (const c of meta.columns) {
      const v = row[c.key]
      props[c.key] = v == null ? '' : c.kind === 'number' ? Number(v) : String(v)
    }
    return {
      index: Number(row.rid),
      id: meta.idKey ? String(row[meta.idKey] ?? row.rid) : String(row.rid),
      smiles: meta.smilesKey ? String(row.smiles ?? '') : '',
      props,
    }
  })
}

/** Distinct values of a column (+ counts) for the categorical "is" filter. */
export async function distinct(name, body) {
  const { conn, meta } = getConn(name)
  const col = String(body.column ?? '')
  if (!meta.columns.some((c) => c.key === col)) return { values: [], capped: false }
  const limit = 500
  const data = await rows(
    conn,
    `SELECT CAST(${qcol(col)} AS VARCHAR) AS v, count(*) c FROM lib ` +
      `GROUP BY 1 ORDER BY c DESC LIMIT ${limit + 1}`,
  )
  const capped = data.length > limit
  return {
    values: data.slice(0, limit).map((r) => ({
      value: r.v == null ? '' : String(r.v),
      count: Number(r.c),
    })),
    capped,
  }
}

/** A random sample of rows (for fingerprint clustering), honoring the filter. */
export async function sample(name, body) {
  const { conn, meta } = getConn(name)
  const where = buildWhere(meta, body)
  const n = Math.min(Math.max(Number(body.n) || 300, 1), 2000)
  if (!meta.smilesKey) return []

  const inner =
    `SELECT rid, ${qcol(meta.smilesKey)} AS smiles` +
    (meta.idKey ? `, ${qcol(meta.idKey)} AS id` : '') +
    ` FROM lib ${where}`
  const data = await rows(
    conn,
    `SELECT * FROM (${inner}) USING SAMPLE ${n} ROWS (reservoir)`,
  )
  return data.map((row) => ({
    index: Number(row.rid),
    id: meta.idKey ? String(row.id ?? row.rid) : String(row.rid),
    smiles: String(row.smiles ?? ''),
    props: {},
  }))
}

export async function stats(name, body) {
  const { conn, meta } = getConn(name)
  const where = buildWhere(meta, body)
  const keys = meta.numericKeys
  if (keys.length === 0) return { count: await count(name, body), columns: [] }

  // One scan for all per-column summaries.
  const aggs = keys
    .map(
      (k, i) =>
        `min(${qcol(k)}) lo${i}, max(${qcol(k)}) hi${i}, ` +
        `avg(${qcol(k)}) mean${i}, median(${qcol(k)}) med${i}, count(${qcol(k)}) n${i}`,
    )
    .join(', ')
  const summary = (await rows(conn, `SELECT count(*) total, ${aggs} FROM lib ${where}`))[0]

  const BINS = 24
  const columns = []
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    const lo = Number(summary[`lo${i}`])
    const hi = Number(summary[`hi${i}`])
    const n = Number(summary[`n${i}`])
    const bins = new Array(BINS).fill(0)
    if (n > 0 && Number.isFinite(lo) && Number.isFinite(hi)) {
      const span = hi - lo
      const expr =
        span === 0
          ? '0'
          : `least(${BINS - 1}, greatest(0, floor((${qcol(k)} - ${lo}) / ${span} * ${BINS})))::INT`
      const hist = await rows(
        conn,
        `SELECT ${expr} b, count(*) c FROM lib ${where} ` +
          `${where ? 'AND' : 'WHERE'} ${qcol(k)} IS NOT NULL GROUP BY b`,
      )
      for (const r of hist) {
        const b = Number(r.b)
        if (b >= 0 && b < BINS) bins[b] = Number(r.c)
      }
    }
    columns.push({
      key: k,
      label: k,
      count: n,
      min: lo,
      max: hi,
      mean: Number(summary[`mean${i}`]),
      median: Number(summary[`med${i}`]),
      bins,
    })
  }
  return { count: Number(summary.total), columns }
}
