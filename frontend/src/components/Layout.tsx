import { useState } from 'react'
import { Sidebar } from './Sidebar'

interface LayoutProps {
  activeTab: string
  onTabChange: (tab: string) => void
  children: React.ReactNode
}

export function Layout({ activeTab, onTabChange, children }: LayoutProps) {
  // Sidebar is a collapsible drawer, closed by default so the board uses the
  // full width. The ☰ button reopens it when the user needs status / Sign Out.
  const [open, setOpen] = useState(false)

  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: '#fafafa', position: 'relative' }}>
      {/* Full-width content */}
      <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>

      {/* Toggle button (top-left hamburger) */}
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Hide menu' : 'Show menu'}
        style={{
          position: 'fixed',
          top: 6,
          left: 6,
          zIndex: 1100,
          width: 30,
          height: 30,
          borderRadius: 6,
          border: '1px solid #ccc',
          background: '#fff',
          color: '#333',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        }}
      >
        {open ? '✕' : '☰'}
      </button>

      {/* Drawer sidebar + backdrop (only when open) */}
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000 }}
          />
          <div style={{ position: 'fixed', top: 0, left: 0, zIndex: 1050 }}>
            <Sidebar
              activeTab={activeTab}
              onTabChange={(tab) => {
                onTabChange(tab)
                setOpen(false)
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
