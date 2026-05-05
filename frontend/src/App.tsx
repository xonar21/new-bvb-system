import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './store/authStore'
import { useWebSocket } from './hooks/useWebSocket'
import { useIpCheck } from './hooks/useIpCheck'
import { LoginPage } from './components/LoginPage'
import { AccessDeniedPage } from './components/AccessDeniedPage'
import { Layout } from './components/Layout'
import { LiveDatatable } from './features/LiveDatatable/LiveDatatable'
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
  const { token, user } = useAuthStore()
  const [activeTab, setActiveTab] = useState('loads')

  useWebSocket(token)

  const { data: ipCheck, isLoading: ipCheckLoading } = useIpCheck()

  if (!token || !user) {
    return <LoginPage />
  }

  if (ipCheckLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif', color: '#666', fontSize: '14px' }}>
        Checking access...
      </div>
    )
  }

  if (ipCheck && !ipCheck.isAllowed) {
    return <AccessDeniedPage />
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'users':
        return <UsersManagement />
      case 'allowed-ips':
        return <AllowedIps />
      case 'loads':
      default:
        return <LiveDatatable />
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
