import { createColumnHelper } from '@tanstack/react-table'
import type { Load } from '../../types/Load'

const helper = createColumnHelper<Load>()

export const columnToColKey: Record<string, string> = {
  pick_up_date: 'col1',
  commodity: 'col2',
  pickup_location: 'col3',
  delivery_location: 'col4',
  assigned_user: 'col5',
  gate_code: 'col6',
  rate: 'col7',
}

export const columns = [
  helper.accessor('pick_up_date_col1', {
    header: 'Pick Up Date',
    id: 'pick_up_date',
  }),
  helper.accessor('commodity_col2', {
    header: 'Broker / Commodity',
    id: 'commodity',
  }),
  helper.accessor('pickup_date_location_col3', {
    header: 'Shipper / Pickup',
    id: 'pickup_location',
  }),
  helper.accessor('delivery_date_location_col4', {
    header: 'Delivery',
    id: 'delivery_location',
  }),
  helper.accessor('assigned_user_col5', {
    header: 'Assigned',
    id: 'assigned_user',
  }),
  helper.accessor('gate_code_col6', {
    header: 'Gate Code',
    id: 'gate_code',
  }),
  helper.accessor('rate_col7', {
    header: 'Rate',
    id: 'rate',
  }),
  helper.accessor((row) => `${row.rate_min ?? ''}-${row.rate_max ?? ''}`, {
    header: 'Rate Interval',
    id: 'rate_interval',
  }),
  helper.accessor('note_mcc', {
    header: 'Notes',
    id: 'notes',
  }),
]
