import { useState, useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { useWSStore } from '../store/wsStore'
import { useSyncStore } from '../store/syncStore'
import { useSync } from '../hooks/useSync'

interface SidebarProps {
  activeTab: string
  onTabChange: (tab: string) => void
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { user, logout } = useAuthStore()
  const { isConnected, onlineUsers } = useWSStore()
  const { syncStatus, syncResult, syncError, syncStartedAt, syncProgress, resetSync } = useSyncStore()
  const syncMutation = useSync()
  const [elapsed, setElapsed] = useState(0)
  const isRoot = user?.role === 'root'

  useEffect(() => {
    if (syncStatus !== 'running') {
      setElapsed(0)
      return
    }
    const interval = setInterval(() => {
      if (syncStartedAt) {
        setElapsed(Math.floor((Date.now() - syncStartedAt) / 1000))
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [syncStatus, syncStartedAt])

  useEffect(() => {
    if (syncStatus === 'success') {
      const timer = setTimeout(() => resetSync(), 10000)
      return () => clearTimeout(timer)
    }
  }, [syncStatus, resetSync])

  const tabs = [
    { id: 'loads', label: 'Loads' },
    ...(isRoot ? [
      { id: 'users', label: 'Users Management' },
      { id: 'allowed-ips', label: 'Allowed IPs' },
    ] : []),
  ]

  const handleSync = async () => {
    try {
      await syncMutation.mutateAsync()
    } catch {
      // WS will handle error state
    }
  }

  const progressPct = syncProgress
    ? Math.min(100, Math.round((syncProgress.processed / syncProgress.total) * 100))
    : 0

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
      <style>{`@keyframes sync-spin { to { transform: rotate(360deg); } }`}</style>
      <div
        style={{
          padding: '20px 16px',
          borderBottom: '1px solid #2a2d35',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '16px' }}>BVB Freight</div>
        <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>Dashboard</div>
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
              disabled={syncStatus === 'running'}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: syncStatus === 'running' ? '1px solid #555' : '1px solid #4a90d9',
                background: syncStatus === 'running' ? '#2a2d35' : 'transparent',
                color: syncStatus === 'running' ? '#888' : '#4a90d9',
                cursor: syncStatus === 'running' ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                opacity: syncStatus === 'running' ? 0.7 : 1,
              }}
            >
              {syncStatus === 'running' && (
                <span style={{
                  display: 'inline-block',
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  border: '2px solid #888',
                  borderTopColor: 'transparent',
                  animation: 'sync-spin 0.8s linear infinite',
                }} />
              )}
              {syncStatus === 'running' ? `Syncing${elapsed > 0 ? ` (${elapsed}s)` : ''}` : 'Sync Now'}
            </button>

            {syncStatus === 'running' && syncProgress && syncProgress.total > 0 && (
              <div style={{ marginTop: '8px' }}>
                <div style={{
                  height: '4px',
                  background: '#2a2d35',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${progressPct}%`,
                    background: '#4a90d9',
                    borderRadius: '2px',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <div style={{ fontSize: '10px', color: '#888', marginTop: '2px', textAlign: 'center' }}>
                  {syncProgress.processed} / {syncProgress.total} rows
                </div>
              </div>
            )}

            {syncStatus === 'success' && syncResult && (
              <div style={{
                marginTop: '8px',
                padding: '6px 8px',
                fontSize: '11px',
                color: '#4caf50',
                background: '#1b3a1b',
                borderRadius: '4px',
                textAlign: 'center',
              }}>
                ✓ Synced — {syncResult.inserted} inserted, {syncResult.updated} updated
              </div>
            )}

            {syncStatus === 'error' && syncError && (
              <div style={{
                marginTop: '8px',
                padding: '6px 8px',
                fontSize: '11px',
                color: '#f44336',
                background: '#3a1b1b',
                borderRadius: '4px',
                textAlign: 'center',
                position: 'relative',
                paddingRight: '20px',
              }}>
                {syncError}
                <button
                  onClick={resetSync}
                  style={{
                    position: 'absolute',
                    top: '2px',
                    right: '4px',
                    border: 'none',
                    background: 'none',
                    color: '#f44336',
                    cursor: 'pointer',
                    fontSize: '11px',
                    padding: '0 2px',
                  }}
                >✕</button>
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
