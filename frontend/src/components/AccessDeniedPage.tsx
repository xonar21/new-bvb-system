import { useEffect, useRef } from 'react'
import { useAuthStore } from '../store/authStore'

interface IpCheckData {
  currentIp: string
  isAllowed: boolean
}

export function AccessDeniedPage({ ipCheck }: { ipCheck?: IpCheckData }) {
  const logout = useAuthStore((s) => s.logout)
  const clearedRef = useRef(false)
  const redirectedRef = useRef(false)

  useEffect(() => {
    if (!clearedRef.current) {
      clearedRef.current = true
      logout()
    }
  }, [logout])

  useEffect(() => {
    if (ipCheck?.isAllowed && !redirectedRef.current) {
      redirectedRef.current = true
      setTimeout(() => window.location.reload(), 1000)
    }
  }, [ipCheck?.isAllowed])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        background: '#fafafa',
        padding: '24px',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '8px',
          padding: '40px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          maxWidth: '420px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#128274;</div>
        <h1 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 600, color: '#333' }}>
          Access Denied
        </h1>
        <p style={{ margin: '0 0 20px', fontSize: '14px', color: '#666', lineHeight: 1.5 }}>
          Your IP address is not allowed to access this application.
          Please contact your administrator.
        </p>

        {ipCheck?.currentIp && (
          <div
            style={{
              background: '#f5f5f5',
              borderRadius: '4px',
              padding: '8px 12px',
              marginBottom: '20px',
              fontSize: '13px',
              color: '#555',
              fontFamily: 'monospace',
            }}
          >
            Your IP: {ipCheck.currentIp}
          </div>
        )}

        {ipCheck?.isAllowed && (
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#4caf50', fontWeight: 600 }}>
            Your IP is now allowed. Redirecting...
          </p>
        )}

        {!ipCheck?.isAllowed && (
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px',
              borderRadius: '4px',
              border: 'none',
              background: '#4a90d9',
              color: '#fff',
              fontSize: '14px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Retry Connection
          </button>
        )}
      </div>
    </div>
  )
}
