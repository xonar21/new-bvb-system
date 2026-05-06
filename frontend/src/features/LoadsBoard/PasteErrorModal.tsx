import { useClipboardStore } from '../../store/clipboardStore'

export function PasteErrorModal() {
  const pasteErrors = useClipboardStore((s) => s.pasteErrors)
  const clearPasteErrors = useClipboardStore((s) => s.setPasteErrors)

  if (!pasteErrors || pasteErrors.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={() => clearPasteErrors(null)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: '8px',
          padding: '24px',
          minWidth: '420px',
          maxWidth: '600px',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: '16px', color: '#c62828' }}>
          Paste failed — fix errors and try again
        </h2>
        {pasteErrors.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>Row</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>Column</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>Error</th>
              </tr>
            </thead>
            <tbody>
              {pasteErrors.map((e, i) => (
                <tr key={i}>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', color: '#666', fontFamily: 'monospace' }}>
                    {e.row > 0 ? e.row : '-'}
                  </td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', color: '#666', fontFamily: 'monospace' }}>
                    {e.col || '-'}
                  </td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee', color: '#c62828' }}>
                    {e.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: '16px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={() => clearPasteErrors(null)}
            style={{
              padding: '6px 16px',
              borderRadius: '4px',
              border: '1px solid #ccc',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
