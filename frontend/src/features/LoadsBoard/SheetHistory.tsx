import { useEffect, useState } from 'react'
import { Workbook } from '@fortune-sheet/react'
import '@fortune-sheet/react/dist/index.css'
import {
  listSheetVersions, listSheetAudit, restoreSheetVersion, getSheetVersion,
  type SheetVersionMeta, type AuditEntry, type SheetVersionFull,
} from '../../hooks/useSheetDoc'

const reasonLabel: Record<string, { text: string; color: string }> = {
  before_delete: { text: 'Înainte de ștergere', color: '#e67e22' },
  after_delete: { text: 'După ștergere', color: '#c0392b' },
  auto: { text: 'Automat', color: '#7f8c8d' },
  manual: { text: 'Manual', color: '#2980b9' },
  restore: { text: 'Restaurat', color: '#27ae60' },
}

const actionLabel: Record<string, string> = {
  delete_rows: 'Șters rânduri',
  delete_cols: 'Șters coloane',
  clear_cells: 'Golit celule',
  restore: 'Restaurare versiune',
}

function fmt(ts: string): string {
  try { return new Date(ts).toLocaleString() } catch { return ts }
}

function summarize(d: any): string {
  if (!d || typeof d !== 'object') return ''
  const parts: string[] = []
  if (Array.isArray(d.rows) && d.rows.length) parts.push(`rânduri: ${d.rows.length}`)
  if (Array.isArray(d.cols) && d.cols.length) parts.push(`coloane: ${d.cols.length}`)
  if (d.cleared_cells) parts.push(`celule: ${d.cleared_cells}`)
  if (d.restored_version_id) parts.push(`versiune #${d.restored_version_id}`)
  return parts.join(', ')
}

// Extracts a "row,col" → text-value map from a Fortune Sheet sheet, handling
// both the sparse `celldata` and the 2D `data` matrix representations.
function cellValueMap(sheet: any): Map<string, string> {
  const m = new Map<string, string>()
  const val = (cell: any) => {
    if (cell == null) return null
    const v = typeof cell === 'object' ? (cell.v && typeof cell.v === 'object' ? cell.v.v : cell.v) : cell
    return v === undefined || v === null || v === '' ? null : String(v)
  }
  if (Array.isArray(sheet?.celldata)) {
    for (const c of sheet.celldata) {
      const v = val(c?.v)
      if (v !== null) m.set(`${c.r},${c.c}`, v)
    }
  }
  if (Array.isArray(sheet?.data)) {
    sheet.data.forEach((row: any[], r: number) => {
      if (!Array.isArray(row)) return
      row.forEach((cell, c) => {
        const v = val(cell)
        if (v !== null) m.set(`${r},${c}`, v)
      })
    })
  }
  return m
}

// Builds a read-only preview sheet for a version, highlighting what changed vs
// the previous version: yellow = added/modified (new value), red = removed
// (shows the old value so you can see what was there).
function buildDiffPreview(curData: any, prevData: any): { sheet: any; changeCount: number } {
  const curSheet = Array.isArray(curData) ? curData[0] : null
  const prevSheet = Array.isArray(prevData) ? prevData[0] : null
  const cur = cellValueMap(curSheet)
  const prev = cellValueMap(prevSheet)

  const celldata: any[] = []
  let changeCount = 0
  let maxR = 0
  let maxC = 0

  // Current cells (added / modified / unchanged)
  for (const [key, value] of cur) {
    const [r, c] = key.split(',').map(Number)
    maxR = Math.max(maxR, r); maxC = Math.max(maxC, c)
    const isChanged = prevSheet ? prev.get(key) !== value : false
    if (isChanged) changeCount++
    const cell: any = { v: value, m: value, ct: { fa: 'General', t: 'g' } }
    if (isChanged) cell.bg = '#fff59d' // yellow
    celldata.push({ r, c, v: cell })
  }
  // Removed cells (present before, gone now) — show the old value in red.
  if (prevSheet) {
    for (const [key, value] of prev) {
      if (!cur.has(key)) {
        const [r, c] = key.split(',').map(Number)
        maxR = Math.max(maxR, r); maxC = Math.max(maxC, c)
        changeCount++
        celldata.push({ r, c, v: { v: value, m: value, bg: '#ffcdd2', fc: '#b71c1c' } })
      }
    }
  }

  const sheet = {
    id: 'diff-preview',
    name: 'Versiune',
    status: 1,
    order: 0,
    row: Math.max(maxR + 5, 30),
    column: Math.max(maxC + 2, 12),
    celldata,
    config: {},
  }
  return { sheet, changeCount }
}

interface ViewState {
  meta: SheetVersionFull
  preview: any[]
  changeCount: number
  hasPrev: boolean
}

// Full-page admin view of sheet modification history: versions (snapshots over
// time, who/when) + the deletion audit log, with restore.
export function SheetHistory() {
  const [tab, setTab] = useState<'versions' | 'audit'>('versions')
  const [versions, setVersions] = useState<SheetVersionMeta[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<number | null>(null)
  const [viewing, setViewing] = useState<ViewState | null>(null)
  const [viewLoading, setViewLoading] = useState<number | null>(null)

  // index = position in the (newest-first) versions list, so we can fetch the
  // previous (older) version for the diff.
  const handleView = async (id: number, index: number) => {
    if (viewLoading) return
    setViewLoading(id)
    try {
      const cur = await getSheetVersion(id)
      const prevMeta = versions[index + 1] // next item is older
      const prev = prevMeta ? await getSheetVersion(prevMeta.id) : null
      const { sheet, changeCount } = buildDiffPreview(cur.data, prev?.data)
      setViewing({ meta: cur, preview: [sheet], changeCount, hasPrev: !!prev })
    } catch (e) {
      console.warn('[history] view failed', e)
    } finally {
      setViewLoading(null)
    }
  }

  const reload = () => {
    setLoading(true)
    Promise.all([listSheetVersions(), listSheetAudit()])
      .then(([v, a]) => { setVersions(v.versions); setAudit(a.audit) })
      .catch((e) => console.warn('[history] load failed', e))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  const handleRestore = async (id: number) => {
    if (restoring) return
    if (!window.confirm('Restaurezi această versiune? Starea curentă va fi înlocuită (dar rămâne salvată în istoric).')) return
    setRestoring(id)
    try {
      await restoreSheetVersion(id)
      // Reload the app so the sheet re-initialises from the restored state.
      window.location.reload()
    } catch (e) {
      console.warn('[history] restore failed', e)
      setRestoring(null)
    }
  }

  return (
    <div style={{ padding: '20px 24px', height: '100%', flex: 1, overflowY: 'auto', fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '20px' }}>Loguri & istoric modificări</h2>
        <button
          onClick={reload}
          style={{ padding: '6px 14px', border: '1px solid #ccc', background: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
        >
          ↻ Reîmprospătează
        </button>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
        {(['versions', 'audit'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 18px', border: 'none', borderRadius: '6px', cursor: 'pointer',
              fontSize: '13px', fontWeight: 600,
              background: tab === t ? '#4a90d9' : '#eef0f3',
              color: tab === t ? '#fff' : '#555',
            }}
          >
            {t === 'versions' ? 'Versiuni' : 'Jurnal ștergeri'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: '#888', textAlign: 'center', padding: '40px' }}>Se încarcă…</div>
      ) : tab === 'versions' ? (
        versions.length === 0 ? (
          <div style={{ color: '#888', textAlign: 'center', padding: '40px' }}>Nicio versiune încă.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: '#fff', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#666', background: '#f7f8fa' }}>
                <th style={{ padding: '10px 12px' }}>Când</th>
                <th style={{ padding: '10px 12px' }}>Tip</th>
                <th style={{ padding: '10px 12px' }}>Utilizator</th>
                <th style={{ padding: '10px 12px' }}></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v, index) => {
                const r = reasonLabel[v.reason] ?? { text: v.reason, color: '#7f8c8d' }
                return (
                  <tr key={v.id} style={{ borderTop: '1px solid #f0f0f0', background: index === 0 ? '#f3f9ff' : undefined }}>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {fmt(v.created_at)}
                      {index === 0 && <span style={{ marginLeft: 8, background: '#4a90d9', color: '#fff', padding: '1px 8px', borderRadius: 8, fontSize: 10 }}>cea mai nouă</span>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ background: r.color, color: '#fff', padding: '2px 10px', borderRadius: '10px', fontSize: '11px' }}>{r.text}</span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>{v.created_by_email || '—'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => handleView(v.id, index)}
                        disabled={viewLoading !== null}
                        style={{ padding: '5px 12px', border: '1px solid #27ae60', background: viewLoading === v.id ? '#ccc' : '#fff', color: '#27ae60', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', marginRight: '6px' }}
                      >
                        {viewLoading === v.id ? 'Se încarcă…' : '👁 Vizualizează'}
                      </button>
                      <button
                        onClick={() => handleRestore(v.id)}
                        disabled={restoring !== null}
                        style={{ padding: '5px 12px', border: '1px solid #4a90d9', background: restoring === v.id ? '#ccc' : '#fff', color: '#4a90d9', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                      >
                        {restoring === v.id ? 'Se restaurează…' : 'Restaurează'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )
      ) : (
        audit.length === 0 ? (
          <div style={{ color: '#888', textAlign: 'center', padding: '40px' }}>Nicio ștergere înregistrată.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: '#fff', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#666', background: '#f7f8fa' }}>
                <th style={{ padding: '10px 12px' }}>Când</th>
                <th style={{ padding: '10px 12px' }}>Utilizator</th>
                <th style={{ padding: '10px 12px' }}>Acțiune</th>
                <th style={{ padding: '10px 12px' }}>Detalii</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmt(a.created_at)}</td>
                  <td style={{ padding: '10px 12px' }}>{a.user_email || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{actionLabel[a.action] ?? a.action}</td>
                  <td style={{ padding: '10px 12px', color: '#777', fontFamily: 'monospace', fontSize: '11px' }}>{summarize(a.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {/* Excel-style preview of a selected version (read-only spreadsheet) */}
      {viewing && (
        <div
          onClick={() => setViewing(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '8px', width: '95vw', height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #eee', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: '14px' }}>
                <strong>Versiune din {fmt(viewing.meta.created_at)}</strong>
                <span style={{ color: '#888', marginLeft: 10 }}>
                  modificat de <strong>{viewing.meta.created_by_email || '—'}</strong>
                  {' · '}
                  {(reasonLabel[viewing.meta.reason]?.text) ?? viewing.meta.reason}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
                {viewing.hasPrev ? (
                  <>
                    <span style={{ color: '#555' }}><strong>{viewing.changeCount}</strong> modificări față de versiunea anterioară</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, background: '#fff59d', border: '1px solid #e0c200', display: 'inline-block' }} /> modificat/adăugat</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, background: '#ffcdd2', border: '1px solid #e57373', display: 'inline-block' }} /> șters</span>
                  </>
                ) : (
                  <span style={{ color: '#888' }}>prima versiune (nimic de comparat)</span>
                )}
                <button
                  onClick={() => setViewing(null)}
                  style={{ padding: '6px 14px', border: '1px solid #ccc', background: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                >
                  ✕ Închide
                </button>
              </div>
            </div>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <Workbook
                data={viewing.preview}
                allowEdit={false}
                showToolbar={false}
                showFormulaBar={false}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
