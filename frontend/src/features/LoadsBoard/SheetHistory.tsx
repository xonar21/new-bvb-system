import { useEffect, useState } from 'react'
import { Workbook } from '@fortune-sheet/react'
import '@fortune-sheet/react/dist/index.css'
import {
  listSheetVersions, listSheetAudit, restoreSheetVersion, getSheetVersion, listSheetCellChanges,
  type SheetVersionMeta, type AuditEntry, type SheetVersionFull, type CellChange,
} from '../../hooks/useSheetDoc'

// 0-based column index → spreadsheet letter (0→A, 25→Z, 26→AA…).
function colLetter(n: number): string {
  let s = ''
  let x = n
  do { s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26) - 1 } while (x >= 0)
  return s
}

type TimelineEvent = {
  id: string
  kind: 'edit' | 'delete' | 'restore'
  at: string
  userEmail: string
  changeCount?: number
  raw: SheetVersionMeta | AuditEntry
}

const tokens = {
  cardStyle: { padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: '12px' } as React.CSSProperties,
  dayHeaderStyle: { padding: '12px 16px', fontWeight: 600, fontSize: '12px', color: '#666', background: '#f7f8fa', position: 'sticky' as const, top: 0, zIndex: 10, textTransform: 'uppercase' as const, letterSpacing: '0.5px' } as React.CSSProperties,
  chipStyle: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%', fontSize: '12px', fontWeight: 600, color: '#fff', flexShrink: 0 } as React.CSSProperties,
  timeStyle: { fontSize: '13px', fontWeight: 600, color: '#333', minWidth: '50px' } as React.CSSProperties,
  actionTextStyle: { flex: 1, fontSize: '13px', color: '#555' } as React.CSSProperties,
  btnSmallGhost: { padding: '5px 12px', border: '1px solid #ccc', background: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', marginRight: '6px' } as React.CSSProperties,
  btnSmallPrimary: { padding: '5px 12px', border: '1px solid #4a90d9', background: '#fff', color: '#4a90d9', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' } as React.CSSProperties,
  containerStyle: { padding: '20px 24px', height: '100%', flex: 1, overflowY: 'auto' as const, fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box' as const } as React.CSSProperties,
}

function colorForEmail(email: string): string {
  const colors = ['#E53935', '#D81B60', '#8E24AA', '#5E35B1', '#3949AB', '#1E88E5', '#0097A7', '#00796B', '#43A047', '#FB8C00']
  let hash = 0
  for (let i = 0; i < email.length; i++) {
    hash = ((hash << 5) - hash) + email.charCodeAt(i)
    hash = hash & hash
  }
  return colors[Math.abs(hash) % colors.length]
}

function dayLabel(ts: string): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const isSameDay = (date1: Date, date2: Date) => date1.toDateString() === date2.toDateString()

  if (isSameDay(d, today)) return 'Astăzi'
  if (isSameDay(d, yesterday)) return 'Ieri'

  return new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}

function fmt(ts: string): string {
  try { return new Date(ts).toLocaleString() } catch { return ts }
}

function timeOnly(ts: string): string {
  try { return new Date(ts).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }) } catch { return ts }
}

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

function countChangesForVersion(
  version: SheetVersionMeta,
  index: number,
  allVersions: SheetVersionMeta[],
  allChanges: CellChange[]
): number {
  const tCur = new Date(version.created_at).getTime()
  const prevMeta = allVersions[index + 1]
  const tPrev = prevMeta ? new Date(prevMeta.created_at).getTime() : 0
  return allChanges.filter((c) => {
    const t = new Date(c.created_at).getTime()
    return t > tPrev && t <= tCur
  }).length
}

function buildDiffPreview(curData: any, prevData: any): { sheet: any; changeCount: number } {
  const curSheet = Array.isArray(curData) ? curData[0] : null
  const prevSheet = Array.isArray(prevData) ? prevData[0] : null
  const cur = cellValueMap(curSheet)
  const prev = cellValueMap(prevSheet)

  const celldata: any[] = []
  let changeCount = 0
  let maxR = 0
  let maxC = 0

  for (const [key, value] of cur) {
    const [r, c] = key.split(',').map(Number)
    maxR = Math.max(maxR, r); maxC = Math.max(maxC, c)
    const isChanged = prevSheet ? prev.get(key) !== value : false
    if (isChanged) changeCount++
    const cell: any = { v: value, m: value, ct: { fa: 'General', t: 'g' } }
    if (isChanged) cell.bg = '#fff59d'
    celldata.push({ r, c, v: cell })
  }
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

// Builds a renderable (celldata) read-only sheet from a version's data, with an
// optional set of "row,col" keys highlighted in the given colour.
function buildPlainPreview(data: any, highlight?: Set<string>, color = '#ffcdd2'): any {
  const sheet = Array.isArray(data) ? data[0] : null
  const map = cellValueMap(sheet)
  const celldata: any[] = []
  let maxR = 0, maxC = 0
  for (const [key, value] of map) {
    const [r, c] = key.split(',').map(Number)
    maxR = Math.max(maxR, r); maxC = Math.max(maxC, c)
    const vObj: any = { v: value, m: value }
    if (highlight?.has(key)) { vObj.bg = color; vObj.fc = '#b71c1c' }
    celldata.push({ r, c, v: vObj })
  }
  return {
    id: 'preview', name: 'Foaie', status: 1, order: 0,
    row: Math.max(maxR + 5, 30), column: Math.max(maxC + 2, 12), celldata, config: {},
  }
}

interface ViewState {
  meta: SheetVersionFull
  preview: any[]
  changeCount: number
  hasPrev: boolean
  cellChanges: CellChange[]
}

interface DelViewState {
  entry: AuditEntry
  before: any[]
  after: any[]
  deletedCount: number
  side: 'before' | 'after'
}

function EventRow({ event, onView, onRestore, onViewDelete, viewLoading, delLoading }: {
  event: TimelineEvent
  onView: (id: number, idx: number) => void
  onRestore: (id: number) => void
  onViewDelete: (a: AuditEntry) => void
  viewLoading: number | null
  delLoading: number | null
}) {
  const bgColor = colorForEmail(event.userEmail)
  const initial = event.userEmail.charAt(0).toUpperCase()

  const actionText = {
    edit: `a modificat ${event.changeCount || 0} ${event.changeCount === 1 ? 'celulă' : 'celule'}`,
    delete: `a șters ${event.changeCount || 0} ${event.changeCount === 1 ? 'celulă' : 'celule'}`,
    restore: 'a restaurat o versiune',
  }[event.kind]

  const icon = { edit: '✏️', delete: '🗑', restore: '↺' }[event.kind]

  if (event.kind === 'edit') {
    const v = event.raw as SheetVersionMeta
    return (
      <div style={tokens.cardStyle}>
        <span style={tokens.timeStyle}>{timeOnly(event.at)}</span>
        <div style={{ ...tokens.chipStyle, background: bgColor }} title={event.userEmail}>{initial}</div>
        <span style={tokens.actionTextStyle}>{icon} {actionText}</span>
        <button
          onClick={() => {
            const idx = 0
            onView(v.id, idx)
          }}
          disabled={viewLoading !== null}
          style={{ ...tokens.btnSmallGhost, borderColor: '#27ae60', color: '#27ae60' }}
        >
          {viewLoading === v.id ? 'Se încarcă…' : '👁'}
        </button>
        <button
          onClick={() => onRestore(v.id)}
          style={{ ...tokens.btnSmallPrimary }}
        >
          ↺
        </button>
      </div>
    )
  }

  if (event.kind === 'delete') {
    const a = event.raw as AuditEntry
    return (
      <div style={tokens.cardStyle}>
        <span style={tokens.timeStyle}>{timeOnly(event.at)}</span>
        <div style={{ ...tokens.chipStyle, background: bgColor }} title={event.userEmail}>{initial}</div>
        <span style={tokens.actionTextStyle}>{icon} {actionText}</span>
        <button
          onClick={() => onViewDelete(a)}
          disabled={delLoading !== null}
          style={{ ...tokens.btnSmallGhost, borderColor: '#27ae60', color: '#27ae60' }}
        >
          {delLoading === a.id ? 'Se încarcă…' : '👁'}
        </button>
      </div>
    )
  }

  const v = event.raw as SheetVersionMeta
  return (
    <div style={tokens.cardStyle}>
      <span style={tokens.timeStyle}>{timeOnly(event.at)}</span>
      <div style={{ ...tokens.chipStyle, background: bgColor }} title={event.userEmail}>{initial}</div>
      <span style={tokens.actionTextStyle}>{icon} {actionText}</span>
      <button
        onClick={() => {
          const idx = 0
          onView(v.id, idx)
        }}
        disabled={viewLoading !== null}
        style={{ ...tokens.btnSmallGhost, borderColor: '#27ae60', color: '#27ae60' }}
      >
        {viewLoading === v.id ? 'Se încarcă…' : '👁'}
      </button>
    </div>
  )
}

export function SheetHistory() {
  const [versions, setVersions] = useState<SheetVersionMeta[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [changes, setChanges] = useState<CellChange[]>([])
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<number | null>(null)
  const [viewing, setViewing] = useState<ViewState | null>(null)
  const [viewLoading, setViewLoading] = useState<number | null>(null)
  const [delView, setDelView] = useState<DelViewState | null>(null)
  const [delLoading, setDelLoading] = useState<number | null>(null)

  const handleViewDeletion = async (a: AuditEntry) => {
    if (delLoading || !a.before_version_id || !a.after_version_id) return
    setDelLoading(a.id)
    try {
      const [b, af] = await Promise.all([
        getSheetVersion(a.before_version_id),
        getSheetVersion(a.after_version_id),
      ])
      const bMap = cellValueMap(Array.isArray(b.data) ? b.data[0] : null)
      const aMap = cellValueMap(Array.isArray(af.data) ? af.data[0] : null)
      const deleted = new Set<string>()
      for (const [k, v] of bMap) if (!aMap.has(k)) deleted.add(k)
      setDelView({
        entry: a,
        before: [buildPlainPreview(b.data, deleted, '#ffcdd2')],
        after: [buildPlainPreview(af.data)],
        deletedCount: deleted.size,
        side: 'before',
      })
    } catch (e) {
      console.warn('[history] deletion view failed', e)
    } finally {
      setDelLoading(null)
    }
  }

  const handleView = async (id: number, index: number) => {
    if (viewLoading) return
    setViewLoading(id)
    try {
      const cur = await getSheetVersion(id)
      const prevMeta = versions[index + 1]
      const prev = prevMeta ? await getSheetVersion(prevMeta.id) : null
      const { sheet, changeCount } = buildDiffPreview(cur.data, prev?.data)
      const tCur = new Date(cur.created_at).getTime()
      const tPrev = prevMeta ? new Date(prevMeta.created_at).getTime() : 0
      const cellChanges = changes.filter((c) => {
        const t = new Date(c.created_at).getTime()
        return t > tPrev && t <= tCur
      })
      setViewing({ meta: cur, preview: [sheet], changeCount, hasPrev: !!prev, cellChanges })
    } catch (e) {
      console.warn('[history] view failed', e)
    } finally {
      setViewLoading(null)
    }
  }

  const buildEvents = (vers: SheetVersionMeta[], aud: AuditEntry[], chg: CellChange[]) => {
    const evts: TimelineEvent[] = []

    for (let i = 0; i < vers.length; i++) {
      const v = vers[i]
      if (v.reason === 'before_delete' || v.reason === 'after_delete') continue

      const changeCount = v.reason === 'restore'
        ? 0
        : countChangesForVersion(v, i, vers, chg)

      if (changeCount === 0 && v.reason !== 'restore') continue

      evts.push({
        id: `v-${v.id}`,
        kind: v.reason === 'restore' ? 'restore' : 'edit',
        at: v.created_at,
        userEmail: v.created_by_email || '?',
        changeCount: v.reason === 'restore' ? undefined : changeCount,
        raw: v,
      })
    }

    for (const a of aud) {
      const changeCount = a.details?.cleared_cells || 0
      if (changeCount === 0) continue

      evts.push({
        id: `a-${a.id}`,
        kind: 'delete',
        at: a.created_at,
        userEmail: a.user_email || '?',
        changeCount,
        raw: a,
      })
    }

    return evts.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }

  const reload = () => {
    setLoading(true)
    Promise.all([listSheetVersions(), listSheetAudit(), listSheetCellChanges()])
      .then(([v, a, c]) => {
        const vers = v.versions.filter((x) => x.reason !== 'before_delete' && x.reason !== 'after_delete')
        setVersions(vers)
        setAudit(a.audit)
        setChanges(c.changes)
        setEvents(buildEvents(vers, a.audit, c.changes))
      })
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
      window.location.reload()
    } catch (e) {
      console.warn('[history] restore failed', e)
      setRestoring(null)
    }
  }

  const groupedByDay = events.reduce((acc, event) => {
    const label = dayLabel(event.at)
    if (!acc[label]) acc[label] = []
    acc[label].push(event)
    return acc
  }, {} as Record<string, TimelineEvent[]>)

  const dayOrder = Object.keys(groupedByDay)

  return (
    <div style={tokens.containerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '20px' }}>Timeline - Loguri & istoric</h2>
        <button
          onClick={reload}
          style={{ padding: '6px 14px', border: '1px solid #ccc', background: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
        >
          ↻ Reîmprospătează
        </button>
      </div>

      {loading ? (
        <div style={{ color: '#888', textAlign: 'center', padding: '40px' }}>Se încarcă…</div>
      ) : events.length === 0 ? (
        <div style={{ color: '#888', textAlign: 'center', padding: '40px' }}>Nicio activitate din log.</div>
      ) : (
        <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          {dayOrder.map((dayLbl) => (
            <div key={dayLbl}>
              <div style={tokens.dayHeaderStyle}>
                {dayLbl}
              </div>
              {groupedByDay[dayLbl].map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  onView={handleView}
                  onRestore={handleRestore}
                  onViewDelete={handleViewDeletion}
                  viewLoading={viewLoading}
                  delLoading={delLoading}
                />
              ))}
            </div>
          ))}
        </div>
      )}

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
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
                {viewing.hasPrev ? (
                  <>
                    <span style={{ color: '#555' }}><strong>{viewing.changeCount}</strong> modificări</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, background: '#fff59d', border: '1px solid #e0c200', display: 'inline-block' }} /> modificat/adăugat</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, background: '#ffcdd2', border: '1px solid #e57373', display: 'inline-block' }} /> șters</span>
                  </>
                ) : (
                  <span style={{ color: '#888' }}>prima versiune</span>
                )}
                <button
                  onClick={() => setViewing(null)}
                  style={{ padding: '6px 14px', border: '1px solid #ccc', background: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                >
                  ✕ Închide
                </button>
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <Workbook
                  data={viewing.preview}
                  allowEdit={false}
                  showToolbar={false}
                  showFormulaBar={false}
                />
              </div>
              {viewing.cellChanges.length > 0 && (
                <div style={{ width: 340, borderLeft: '1px solid #eee', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid #eee', fontWeight: 600, fontSize: 13, background: '#f7f8fa' }}>
                    Cine a modificat ({viewing.cellChanges.length})
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {viewing.cellChanges.map((c) => (
                      <div key={c.id} style={{ padding: '8px 12px', borderBottom: '1px solid #f3f3f3', fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555' }}>
                          <strong>{c.user_email || '—'}</strong>
                          <span style={{ fontFamily: 'monospace', color: '#777' }}>Rând {c.row_idx + 1}, {colLetter(c.col_idx)}</span>
                        </div>
                        <div style={{ marginTop: 3 }}>
                          <span style={{ color: '#b71c1c', textDecoration: c.old_value ? 'line-through' : 'none' }}>{c.old_value || '(gol)'}</span>
                          <span style={{ color: '#999', margin: '0 6px' }}>→</span>
                          <span style={{ color: '#1b5e20', fontWeight: 600 }}>{c.new_value || '(șters)'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {delView && (
        <div
          onClick={() => setDelView(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '8px', width: '95vw', height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #eee', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: '14px' }}>
                <strong>Ștergere din {fmt(delView.entry.created_at)}</strong>
                <span style={{ color: '#888', marginLeft: 10 }}>
                  ștearsă de <strong>{delView.entry.user_email || '—'}</strong>
                  {' · '}<strong>{delView.deletedCount}</strong> celule afectate
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', border: '1px solid #ccc', borderRadius: 6, overflow: 'hidden' }}>
                  {(['before', 'after'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setDelView({ ...delView, side: s })}
                      style={{
                        padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                        background: delView.side === s ? (s === 'before' ? '#c0392b' : '#27ae60') : '#fff',
                        color: delView.side === s ? '#fff' : '#555',
                      }}
                    >
                      {s === 'before' ? 'Înainte de ștergere' : 'După ștergere'}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setDelView(null)}
                  style={{ padding: '6px 14px', border: '1px solid #ccc', background: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                >
                  ✕ Închide
                </button>
              </div>
            </div>
            {delView.side === 'before' && (
              <div style={{ padding: '6px 16px', fontSize: 12, color: '#b71c1c', background: '#fff5f5', borderBottom: '1px solid #ffe0e0' }}>
                🔴 Celulele evidențiate cu roșu sunt cele care au fost șterse.
              </div>
            )}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <Workbook
                key={delView.side}
                data={delView.side === 'before' ? delView.before : delView.after}
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
