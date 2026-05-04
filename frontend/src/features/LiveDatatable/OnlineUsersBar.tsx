import { useWSStore } from '../../store/wsStore'

export function OnlineUsersBar() {
  const { isConnected, onlineUsers } = useWSStore()

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '6px 12px',
        background: isConnected ? '#e8f5e9' : '#ffebee',
        borderRadius: '4px',
        fontSize: '13px',
        border: `1px solid ${isConnected ? '#c8e6c9' : '#ffcdd2'}`,
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: isConnected ? '#4caf50' : '#f44336',
          display: 'inline-block',
        }}
      />
      <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
      {onlineUsers.length > 0 && (
        <span style={{ color: '#666' }}>
          | {onlineUsers.length} online:{' '}
          {onlineUsers.map((u) => u.user_name).join(', ')}
        </span>
      )}
    </div>
  )
}
