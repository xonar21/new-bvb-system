import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../api/client'

// The full Fortune Sheet workbook snapshot persisted on the server.
// `data` is the Fortune Sheet Sheet[] array (cells, styles, config, merges…)
// or {} when nothing has been saved yet.
export interface SheetDocResponse {
  name: string
  data: any
}

export function useSheetDoc() {
  return useQuery<SheetDocResponse>({
    queryKey: ['sheet-doc'],
    queryFn: () => apiClient.get<SheetDocResponse>('/api/sheet'),
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })
}

// Persist the whole workbook (name + all sheets) to the server.
export async function saveSheetDoc(name: string, data: any, reason: 'auto' | 'manual' = 'auto'): Promise<void> {
  await apiClient.put('/api/sheet', { name, data, reason })
}

// Record a deletion: keeps the before + after snapshots and an audit entry.
export async function saveDeleteEvent(args: {
  name: string
  before: any
  after: any
  action: 'delete_rows' | 'delete_cols' | 'clear_cells'
  details: any
}): Promise<void> {
  await apiClient.post('/api/sheet/delete-event', args)
}

// ── History (admin only) ───────────────────────────────────────────────────
export interface SheetVersionMeta {
  id: number
  name: string
  reason: string
  created_by: number | null
  created_by_email: string
  created_at: string
}

export interface AuditEntry {
  id: number
  user_id: number | null
  user_email: string
  action: string
  details: any
  created_at: string
}

export function listSheetVersions() {
  return apiClient.get<{ versions: SheetVersionMeta[] }>('/api/sheet/versions')
}

export function listSheetAudit() {
  return apiClient.get<{ audit: AuditEntry[] }>('/api/sheet/audit')
}

export function restoreSheetVersion(id: number) {
  return apiClient.post<{ success: boolean; name: string; data: any }>(`/api/sheet/versions/${id}/restore`)
}

// Full content of a single version (incl. the Fortune Sheet data blob) for
// previewing it as a spreadsheet.
export interface SheetVersionFull extends SheetVersionMeta {
  data: any
}

export function getSheetVersion(id: number) {
  return apiClient.get<SheetVersionFull>(`/api/sheet/versions/${id}`)
}
