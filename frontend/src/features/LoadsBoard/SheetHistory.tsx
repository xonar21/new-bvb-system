import { useEffect, useState } from 'react'
import {
  listSheetVersions, listSheetAudit, restoreSheetVersion,
  type SheetVersionMeta, type AuditEntry,
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

// Full-page admin view of sheet modification history: versions (snapshots over
// time, who/when) + the deletion audit log, with restore.
export function SheetHistory() {
  const [tab, setTab] = useState<'versions' | 'audit'>('versions')
  const [versions, setVersions] = useState<SheetVersionMeta[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<number | null>(null)

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
    <div style={{ padding: '20px 24px', height: 'calc(100vh - 0px)', overflowY: 'auto', fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box' }}>
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
              {versions.map((v) => {
                const r = reasonLabel[v.reason] ?? { text: v.reason, color: '#7f8c8d' }
                return (
                  <tr key={v.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmt(v.created_at)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ background: r.color, color: '#fff', padding: '2px 10px', borderRadius: '10px', fontSize: '11px' }}>{r.text}</span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>{v.created_by_email || '—'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
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
    </div>
  )
}
