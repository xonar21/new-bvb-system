import { useState } from 'react'
import { useAllowedIps, useCreateAllowedIp, useDeleteAllowedIp } from '../../hooks/useAllowedIps'
import type { AllowedIp } from '../../types/Load'

const modalBackdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 1000,
}

const modalBox: React.CSSProperties = {
  background: '#fff',
  borderRadius: '8px',
  padding: '24px',
  width: '420px',
  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
}

const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: '4px',
  border: '1px solid #ccc',
  fontSize: '13px',
  boxSizing: 'border-box',
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '4px',
  border: 'none',
  background: '#4a90d9',
  color: '#fff',
  fontSize: '13px',
  cursor: 'pointer',
  fontWeight: 600,
}

const btnDanger: React.CSSProperties = {
  ...btnPrimary,
  background: '#d32f2f',
}

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '4px',
  border: '1px solid #ccc',
  background: '#fff',
  color: '#555',
  fontSize: '13px',
  cursor: 'pointer',
}

const cellStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: '13px',
  borderBottom: '1px solid #eee',
  textAlign: 'left',
}

const headerCellStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  fontSize: '12px',
  color: '#666',
  borderBottom: '2px solid #ddd',
  textTransform: 'uppercase',
}

export function AllowedIps() {
  const { data: ips, isLoading } = useAllowedIps()
  const createMutation = useCreateAllowedIp()
  const deleteMutation = useDeleteAllowedIp()

  const [newIp, setNewIp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const ip = newIp.trim()
    if (!ip) return

    setError(null)
    try {
      await createMutation.mutateAsync(ip)
      setNewIp('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add IP')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync(id)
      setDeletingId(null)
    } catch {
      // error handled by mutation
    }
  }

  if (isLoading) {
    return (
      <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#666' }}>
        Loading allowed IPs...
      </div>
    )
  }

  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Allowed IPs</h2>
      </div>

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <input
          style={{ ...input, maxWidth: '300px' }}
          placeholder="Enter IP address (e.g. 192.168.1.1)"
          value={newIp}
          onChange={(e) => setNewIp(e.target.value)}
        />
        <button type="submit" style={btnPrimary} disabled={createMutation.isPending || !newIp.trim()}>
          {createMutation.isPending ? 'Adding...' : 'Add IP'}
        </button>
      </form>

      {error && (
        <div style={{ color: '#d32f2f', fontSize: '13px', marginBottom: '12px' }}>
          {error}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '4px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <thead>
            <tr>
              <th style={headerCellStyle}>ID</th>
              <th style={headerCellStyle}>IP Address</th>
              <th style={headerCellStyle}>Created</th>
              <th style={{ ...headerCellStyle, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ips?.map((aip: AllowedIp) => (
              <tr key={aip.id}>
                <td style={cellStyle}>{aip.id}</td>
                <td style={{ ...cellStyle, fontFamily: 'monospace' }}>{aip.ip}</td>
                <td style={cellStyle}>{new Date(aip.created_at).toLocaleString()}</td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>
                  <button onClick={() => setDeletingId(aip.id)} style={btnDanger}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {(!ips || ips.length === 0) && (
              <tr>
                <td colSpan={4} style={{ ...cellStyle, textAlign: 'center', color: '#999' }}>
                  No IPs configured. Add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {deletingId !== null && (
        <div style={modalBackdrop} onClick={(e) => e.target === e.currentTarget && setDeletingId(null)}>
          <div style={modalBox}>
            <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>Confirm Delete</h3>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#666' }}>
              Are you sure you want to delete this IP? Users from this IP will lose access.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setDeletingId(null)} style={btnSecondary}>Cancel</button>
              <button onClick={() => handleDelete(deletingId)} style={btnDanger} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
