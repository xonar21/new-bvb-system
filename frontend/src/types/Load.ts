export interface CellFormat {
  bg?: string | null
  fg?: string | null
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  fontSize?: number | null
  textAlign?: 'left' | 'center' | 'right' | null
  verticalAlign?: 'top' | 'middle' | 'bottom' | null
}

export interface BulkFormatCell {
  load_id: number
  column: string
  format: CellFormat
}

export interface Load {
  id: number
  pick_up_date_col1: string | null
  commodity_col2: string | null
  pickup_date_location_col3: string | null
  delivery_date_location_col4: string | null
  assigned_user_col5: string | null
  gate_code_col6: string
  rate_col7: number | null
  rate_min: number | null
  rate_max: number | null
  is_bold: boolean
  is_mcc: boolean
  is_lock: boolean
  font_size: number | null
  status: string | null
  note_mcc: string | null
  comments: string | null
  order_number: number | null
  cell_formats: Record<string, CellFormat> | null
  created_at: string
  updated_at: string
}

export interface UpdateCellFormatArgs {
  id: number
  column: string
  format: CellFormat
}

export interface UpdateLoadRequest {
  pick_up_date_col1?: string | null
  commodity_col2?: string | null
  pickup_date_location_col3?: string | null
  delivery_date_location_col4?: string | null
  assigned_user_col5?: string | null
  gate_code_col6?: string | null
  rate_col7?: number | null
  rate_min?: number | null
  rate_max?: number | null
  is_bold?: boolean | null
  is_lock?: boolean | null
  font_size?: number | null
  status?: string | null
  comments?: string | null
  order_number?: number | null
}

export interface BulkOrderItem {
  id: number
  order_number: number
}

export interface LoadsResponse {
  loads: Load[]
}

export interface User {
  id: number
  email: string
  name: string
  role: string
  color: string
  is_blocked: boolean
  last_active_at: string | null
  created_at: string
  updated_at: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  token: string
  user: User
}

export interface WSMessage {
  type: 'load.created' | 'load.updated' | 'load.deleted' | 'load.order-updated' | 'presence' | 'cell.focus' | 'focus.snapshot' | 'ip.restriction-changed' | 'layout.column-width-changed' | 'layout.row-height-changed' | 'layout.lock-acquired' | 'layout.lock-released' | 'layout.reset' | 'loads.synced' | 'sync.error' | 'sheet.op' | 'cell.update' | 'cell.bulk-update'
  payload: unknown
}

/** Payload received from other clients via cell.update WS message. */
export interface CellUpdateWSPayload {
  load_id: number
  field: string       // DB column name, e.g. "pick_up_date_col1"
  value?: unknown
  style?: Record<string, unknown>
  user_id?: number
  user_name?: string
}

/** Payload received from other clients via cell.bulk-update WS message. */
export interface CellBulkUpdateWSPayload {
  updates: Array<{
    load_id: number
    field: string
    value?: unknown
  }>
  user_id?: number
  user_name?: string
}

export interface CellFocusPayload {
  load_id: number
  field: string
  action: 'focus' | 'blur' | 'editing'
  user_id?: number
  user_name?: string
  color?: string
}

export interface AllowedIp {
  id: number
  ip: string
  created_at: string
  updated_at: string
}

export interface AllowedIpsResponse {
  allowed_ips: AllowedIp[]
}

// --- Table Layout types ---

export interface LockInfo {
  user_id: number
  user_name: string
  expires_at: string
}

export interface ActiveLocks {
  columns: Record<string, LockInfo>
  rows: Record<string, LockInfo>
}

export interface TableLayoutResponse {
  column_widths: Record<string, number>
  row_heights: Record<string, number>
  active_locks: ActiveLocks
}

export interface ColumnWidthRequest {
  width: number
  request_id?: string
}

export interface RowHeightRequest {
  height: number
  request_id?: string
}

export interface LockAcquireRequest {
  target_type: 'column' | 'row'
  target_name: string
}

export interface LockAcquireResponse {
  success: boolean
  locked_by?: LockInfo
}

export interface LockReleaseRequest {
  target_type: 'column' | 'row'
  target_name: string
}

export interface LayoutColumnWidthChanged {
  column_name: string
  width: number
  changed_by: number
  user_name: string
}

export interface LayoutRowHeightChanged {
  row_index: string
  height: number
  changed_by: number
  user_name: string
}

export interface LayoutLockAcquired {
  target_type: string
  target_name: string
  user_id: number
  user_name: string
  expires_at: string | null
}

export interface LayoutLockReleased {
  target_type: string
  target_name: string
  user_id?: number
  user_name?: string
}
