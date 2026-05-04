import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './store/authStore'
import { useWebSocket } from './hooks/useWebSocket'
import { LoginPage } from './components/LoginPage'
import { Layout } from './components/Layout'
import { LiveDatatable } from './features/LiveDatatable/LiveDatatable'
import { UsersManagement } from './features/UsersManagement/UsersManagement'

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

  if (!token || !user) {
    return <LoginPage />
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'users':
        return <UsersManagement />
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
