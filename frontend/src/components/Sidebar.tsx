import { useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { useWSStore } from '../store/wsStore'
import { useSync } from '../hooks/useSync'

interface SidebarProps {
  activeTab: string
  onTabChange: (tab: string) => void
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { user, logout } = useAuthStore()
  const { isConnected, onlineUsers } = useWSStore()
  const syncMutation = useSync()
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const isRoot = user?.role === 'root'

  const tabs = [
    { id: 'loads', label: 'Loads' },
    ...(isRoot ? [
      { id: 'users', label: 'Users Management' },
      { id: 'allowed-ips', label: 'Allowed IPs' },
    ] : []),
  ]

  const handleSync = async () => {
    setSyncMsg(null)
    try {
      await syncMutation.mutateAsync()
      setSyncMsg('Sync started')
    } catch {
      setSyncMsg('Sync failed')
    }
    setTimeout(() => setSyncMsg(null), 3000)
  }

  return (
    <div
      style={{
        width: '220px',
        minWidth: '220px',
        height: '100vh',
        background: '#1a1d23',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          padding: '20px 16px',
          borderBottom: '1px solid #2a2d35',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '16px' }}>BVB Freight</div>
        <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>Live Datatable</div>
      </div>

      <nav style={{ flex: 1, padding: '8px 0' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              display: 'block',
              width: '100%',
              padding: '10px 16px',
              border: 'none',
              background: activeTab === tab.id ? '#2a2d35' : 'transparent',
              color: activeTab === tab.id ? '#fff' : '#999',
              cursor: 'pointer',
              fontSize: '13px',
              textAlign: 'left',
              fontWeight: activeTab === tab.id ? 600 : 400,
            }}
            onMouseEnter={(e) => {
              if (activeTab !== tab.id) e.currentTarget.style.background = '#22252d'
            }}
            onMouseLeave={(e) => {
              if (activeTab !== tab.id) e.currentTarget.style.background = 'transparent'
            }}
          >
            {tab.label}
          </button>
        ))}
        {isRoot && (
          <div style={{ padding: '16px 16px 0' }}>
            <button
              onClick={handleSync}
              disabled={syncMutation.isPending}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: '1px solid #4a90d9',
                background: 'transparent',
                color: '#4a90d9',
                cursor: syncMutation.isPending ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                width: '100%',
                opacity: syncMutation.isPending ? 0.6 : 1,
              }}
            >
              {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
            </button>
            {syncMsg && (
              <div style={{ fontSize: '11px', color: syncMsg === 'Sync failed' ? '#f44336' : '#4caf50', marginTop: '4px', textAlign: 'center' }}>
                {syncMsg}
              </div>
            )}
          </div>
        )}
      </nav>

      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid #2a2d35',
          fontSize: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: isConnected ? '#4caf50' : '#f44336',
              display: 'inline-block',
            }}
          />
          <span style={{ color: '#888' }}>
            {isConnected ? 'Connected' : 'Disconnected'}
            {onlineUsers.length > 0 && ` (${onlineUsers.length})`}
          </span>
        </div>
        <div style={{ color: '#aaa', marginBottom: '4px' }}>
          {user?.name}
        </div>
        <div style={{ color: '#666', fontSize: '11px', marginBottom: '8px' }}>
          {user?.email}
        </div>
        <button
          onClick={logout}
          style={{
            padding: '4px 12px',
            borderRadius: '4px',
            border: '1px solid #444',
            background: 'transparent',
            color: '#ccc',
            cursor: 'pointer',
            fontSize: '12px',
            width: '100%',
          }}
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}
