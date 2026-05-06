import { create } from 'zustand'

export interface UndoEntry {
  id: string
  loadId: number
  field: string
  oldValue: unknown
  newValue: unknown
  timestamp: number
}

interface UndoState {
  entry: UndoEntry | null
  push: (data: { loadId: number; field: string; oldValue: unknown; newValue: unknown }) => void
  pop: () => UndoEntry | null
  clear: () => void
}

export const useUndoStore = create<UndoState>((set, get) => ({
  entry: null,

  push: (data) => {
    set({
      entry: {
        id: crypto.randomUUID(),
        loadId: data.loadId,
        field: data.field,
        oldValue: data.oldValue,
        newValue: data.newValue,
        timestamp: Date.now(),
      },
    })
  },

  pop: () => {
    const entry = get().entry
    if (entry) {
      set({ entry: null })
    }
    return entry
  },

  clear: () => {
    set({ entry: null })
  },
}))
