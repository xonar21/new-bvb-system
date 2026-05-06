import { create } from 'zustand'

export interface PasteError {
  row: number
  col: string
  reason: string
}

interface ClipboardStore {
  pasteErrors: PasteError[] | null
  isPasting: boolean
  copyToast: string | null

  setPasteErrors: (errors: PasteError[] | null) => void
  setIsPasting: (v: boolean) => void
  setCopyToast: (msg: string | null) => void
  clearClipboard: () => void
}

export const useClipboardStore = create<ClipboardStore>((set) => ({
  pasteErrors: null,
  isPasting: false,
  copyToast: null,

  setPasteErrors: (errors) => set({ pasteErrors: errors }),
  setIsPasting: (v) => set({ isPasting: v }),
  setCopyToast: (msg) => set({ copyToast: msg }),
  clearClipboard: () => set({ pasteErrors: null, copyToast: null }),
}))
