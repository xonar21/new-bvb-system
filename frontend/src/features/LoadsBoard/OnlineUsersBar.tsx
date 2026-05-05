import { useState, useRef, useEffect } from 'react'
import { useWSStore } from '../../store/wsStore'

export function OnlineUsersBar() {
  const { isConnected, onlineUsers } = useWSStore()
  const [expanded, setExpanded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          background: isConnected ? '#e8f5e9' : '#ffebee',
          borderRadius: '4px',
          fontSize: '13px',
          border: `1px solid ${isConnected ? '#c8e6c9' : '#ffcdd2'}`,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: isConnected ? '#4caf50' : '#f44336',
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
        <span style={{ whiteSpace: 'nowrap' }}>
          Online: {onlineUsers.length}
        </span>
      </div>

      {expanded && onlineUsers.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '4px',
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            minWidth: '180px',
            zIndex: 100,
            padding: '4px 0',
            fontSize: '13px',
          }}
        >
          {onlineUsers.map((u) => (
            <div
              key={u.user_id}
              style={{
                padding: '4px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#4caf50',
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: '#333' }}>{u.user_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
