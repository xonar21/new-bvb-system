export interface CellFormat {
  bg?: string | null
  fg?: string | null
  bold?: boolean
  fontSize?: number | null
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
  type: 'load.created' | 'load.updated' | 'load.deleted' | 'load.order-updated' | 'presence' | 'cell.focus'
  payload: unknown
}

export interface CellFocusPayload {
  load_id: number
  field: string
  action: 'focus' | 'blur' | 'editing'
  user_id?: number
  user_name?: string
}
