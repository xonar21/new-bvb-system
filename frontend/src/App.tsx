import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './store/authStore'
import { useWebSocket } from './hooks/useWebSocket'
import { useIpCheck } from './hooks/useIpCheck'
import { LoginPage } from './components/LoginPage'
import { AccessDeniedPage } from './components/AccessDeniedPage'
import { Layout } from './components/Layout'
import { LuckysheetBoard } from './features/LoadsBoard/LuckysheetBoard'
import { SheetHistory } from './features/LoadsBoard/SheetHistory'
import { UsersManagement } from './features/UsersManagement/UsersManagement'
import { AllowedIps } from './features/AllowedIps/AllowedIps'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function AppContent() {
  const { token, user, logout } = useAuthStore()
  const [activeTab, setActiveTab] = useState('loads')
  const [ipDenied, setIpDenied] = useState<boolean | null>(null)
  const isAdmin = user?.role === 'admin' || user?.role === 'root'
  // Standalone route: when opened in its own browser tab via #/logs, render only
  // the logs page (no sidebar). Used by the "Loguri & istoric" button.
  const isLogsRoute = window.location.hash.replace(/^#/, '') === '/logs'

  useWebSocket(token)

  const { data: ipCheck, isLoading: ipCheckLoading } = useIpCheck()

  // Redirect to loads if user tries to access admin-only tabs
  useEffect(() => {
    if ((activeTab === 'users' || activeTab === 'allowed-ips' || activeTab === 'logs') && !isAdmin) {
      setActiveTab('loads')
    }
  }, [activeTab, isAdmin])

  useEffect(() => {
    if (ipCheck) {
      setIpDenied(!ipCheck.isAllowed)
      if (!ipCheck.isAllowed) {
        logout()
      }
    }
  }, [ipCheck, logout])

  if (ipDenied === true) {
    return <AccessDeniedPage ipCheck={ipCheck} />
  }

  if (ipDenied === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif', color: '#666', fontSize: '14px' }}>
        Checking access...
      </div>
    )
  }

  if (!token || !user) {
    return <LoginPage />
  }

  if (ipCheckLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif', color: '#666', fontSize: '14px' }}>
        Loading...
      </div>
    )
  }

  // Standalone logs page (opened in its own browser tab).
  if (isLogsRoute) {
    if (!isAdmin) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif', color: '#c0392b', fontSize: '15px' }}>
          Acces interzis — doar administratorii pot vedea logurile.
        </div>
      )
    }
    return <SheetHistory />
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'users':
        return <UsersManagement />
      case 'allowed-ips':
        return <AllowedIps />
      case 'logs':
        return <SheetHistory />
      case 'loads':
      default:
        return <LuckysheetBoard />
    }
  }

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {renderContent()}
    </Layout>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  )
}
