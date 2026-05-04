import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './store/authStore'
import { useWebSocket } from './hooks/useWebSocket'
import { LoginPage } from './components/LoginPage'
import { LiveDatatable } from './features/LiveDatatable/LiveDatatable'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function AppContent() {
  const { token, user, logout, loadFromStorage } = useAuthStore()

  useEffect(() => {
    loadFromStorage()
  }, [loadFromStorage])

  useWebSocket(token)

  if (!token || !user) {
    return <LoginPage />
  }

  return (
    <div style={{ minHeight: '100vh', background: '#fafafa' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 16px',
          background: '#fff',
          borderBottom: '1px solid #ddd',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '16px' }}>BVB Freight</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px' }}>
          <span style={{ color: '#666' }}>{user.name} ({user.role})</span>
          <button
            onClick={logout}
            style={{
              padding: '4px 12px',
              borderRadius: '4px',
              border: '1px solid #ccc',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Sign Out
          </button>
        </div>
      </header>
      <LiveDatatable />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  )
}
