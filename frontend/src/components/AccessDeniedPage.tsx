import { useState } from 'react'
import { useIpCheck } from '../hooks/useIpCheck'

export function AccessDeniedPage() {
  const { data, refetch, isFetching } = useIpCheck()
  const [checking, setChecking] = useState(false)

  const handleRetry = async () => {
    setChecking(true)
    await refetch()
    setChecking(false)
  }

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

        {data?.currentIp && (
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
            Your IP: {data.currentIp}
          </div>
        )}

        <button
          onClick={handleRetry}
          disabled={checking || isFetching}
          style={{
            padding: '10px 24px',
            borderRadius: '4px',
            border: 'none',
            background: '#4a90d9',
            color: '#fff',
            fontSize: '14px',
            cursor: checking || isFetching ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            opacity: checking || isFetching ? 0.7 : 1,
          }}
        >
          {checking || isFetching ? 'Checking...' : 'Retry Connection'}
        </button>

        {data?.isAllowed && (
          <p style={{ margin: '16px 0 0', fontSize: '13px', color: '#4caf50', fontWeight: 600 }}>
            Your IP is now allowed. Redirecting...
          </p>
        )}
      </div>
    </div>
  )
}
