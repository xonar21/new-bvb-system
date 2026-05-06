import { create } from 'zustand'

interface SyncProgress {
  processed: number
  total: number
}

interface SyncResult {
  inserted: number
  updated: number
}

interface SyncState {
  syncStatus: 'idle' | 'running' | 'success' | 'error'
  syncResult: SyncResult | null
  syncError: string | null
  syncStartedAt: number | null
  syncProgress: SyncProgress | null

  setSyncStatus: (status: 'idle' | 'running' | 'success' | 'error') => void
  setSyncResult: (result: SyncResult | null) => void
  setSyncError: (error: string | null) => void
  setSyncStartedAt: (timestamp: number | null) => void
  setSyncProgress: (progress: SyncProgress | null) => void
  resetSync: () => void
}

export const useSyncStore = create<SyncState>((set) => ({
  syncStatus: 'idle',
  syncResult: null,
  syncError: null,
  syncStartedAt: null,
  syncProgress: null,

  setSyncStatus: (status) => set({ syncStatus: status }),
  setSyncResult: (result) => set({ syncResult: result }),
  setSyncError: (error) => set({ syncError: error }),
  setSyncStartedAt: (timestamp) => set({ syncStartedAt: timestamp }),
  setSyncProgress: (progress) => set({ syncProgress: progress }),
  resetSync: () => set({
    syncStatus: 'idle',
    syncResult: null,
    syncError: null,
    syncStartedAt: null,
    syncProgress: null,
  }),
}))
