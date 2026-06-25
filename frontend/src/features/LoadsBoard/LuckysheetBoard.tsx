import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Workbook } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import { useLoads, useDeleteLoad } from '../../hooks/useLoads';
import { Load } from '../../types/Load';
import { useWSStore } from '../../store/wsStore';
import { useAuthStore } from '../../store/authStore';
import { apiClient } from '../../api/client';

// Column index in the Fortune Sheet → DB field name mapping.
// Col 0 is the hidden internal ID column — never modified by users.
const columnKeys: (keyof Load)[] = [
  'pick_up_date_col1', 'commodity_col2', 'pickup_date_location_col3',
  'delivery_date_location_col4', 'assigned_user_col5', 'gate_code_col6',
  'rate_col7', 'rate_min', 'rate_max', 'is_bold', 'is_mcc', 'is_lock',
  'font_size', 'status', 'note_mcc', 'comments', 'order_number',
];

const NUMERIC_FIELDS = new Set(['rate_col7', 'rate_min', 'rate_max', 'font_size', 'order_number']);
const BOOL_FIELDS = new Set(['is_bold', 'is_mcc', 'is_lock']);

// Legacy formats coming from Google Sheets sync are keyed by col1..col9.
// WS-driven Fortune Sheet formats are persisted keyed by DB field name.
const legacyColByField: Record<string, string> = {
  pick_up_date_col1: 'col1',
  commodity_col2: 'col2',
  pickup_date_location_col3: 'col3',
  delivery_date_location_col4: 'col4',
  assigned_user_col5: 'col5',
  gate_code_col6: 'col6',
  rate_col7: 'col7',
};

function toLuckysheetCellFormat(fmt: any): Record<string, any> {
  if (!fmt) return {};
  const out: Record<string, any> = {};
  if (fmt.bg) out.bg = fmt.bg;
  if (fmt.fg) out.fc = fmt.fg;
  if (fmt.bold) out.bl = 1;
  if (fmt.italic) out.it = 1;
  if (fmt.underline) out.un = 1;
  if (fmt.strikethrough) out.st = 1;
  if (typeof fmt.fontSize === 'number') out.fs = fmt.fontSize;
  // Alignments are intentionally skipped here: Fortune Sheet / Luckysheet use numeric codes.
  return out;
}

const USER_COLORS = [
  '#4a90d9', '#e67e22', '#2ecc71', '#9b59b6',
  '#e74c3c', '#1abc9c', '#f39c12', '#3498db',
  '#8e44ad', '#16a085', '#d35400', '#27ae60',
];
function getUserColor(userId: number): string {
  return USER_COLORS[userId % USER_COLORS.length];
}

function normalizeCellValue(field: keyof Load, raw: unknown): unknown {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw as object).length === 0) return null;
  const text = String(raw).trim();
  if (text === '') return null;
  if (NUMERIC_FIELDS.has(field as string)) {
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  if (BOOL_FIELDS.has(field as string)) {
    const lowered = text.toLowerCase();
    return lowered === 'true' || lowered === '1' || lowered === 'yes' || lowered === 'y';
  }
  return text;
}

const formatValue = (val: any, key: string): string => {
  if (val === undefined || val === null) return '';
  // Only format as date for the main pick_up_date column if it's a valid date string
  if (key === 'pick_up_date_col1' && val && String(val).length >= 8) {
    try {
      const d = new Date(val);
      if (!isNaN(d.getTime())) return d.toLocaleDateString();
    } catch { /* fallback to string */ }
  }
  return String(val);
};

function buildSheetConfig(loadsData: Load[]) {
  const celldata: Array<{ r: number; c: number; v: { v: string; m: string } }> = [];
  loadsData.forEach((load, r) => {
    columnKeys.forEach((key, c) => {
      const strVal = formatValue(load[key], key as string);
      const fieldKey = String(key);
      const fmt =
        (load as any)?.cell_formats?.[fieldKey] ??
        ((legacyColByField[fieldKey] ? (load as any)?.cell_formats?.[legacyColByField[fieldKey]] : null));
      const style = toLuckysheetCellFormat(fmt);
      celldata.push({ r, c, v: { v: strVal, m: strVal, ...style } as any });
    });
  });
  return {
    name: 'Loads',
    id: 'sheet-1',
    status: 1,
    order: 0,
    celldata,
    row: Math.max(loadsData.length, 100),
    column: columnKeys.length,
    config: {
      columnlen: {
        "0": 120, // pick_up_date_col1
        "1": 120, // commodity_col2
        "2": 250, // pickup_date_location_col3
        "3": 250, // delivery_date_location_col4
        "4": 150, // assigned_user_col5
        "5": 120, // gate_code_col6
        "6": 100, // rate_col7
      }
    },
  };
}

function toMatrix(sheet: any): any[][] {
  if (Array.isArray(sheet?.data)) return sheet.data;
  if (!Array.isArray(sheet?.celldata)) return [];
  const rows = Math.max(0, ...(sheet.celldata as any[]).map((c: any) => Number(c?.r) || 0)) + 1;
  const cols = Math.max(0, ...(sheet.celldata as any[]).map((c: any) => Number(c?.c) || 0)) + 1;
  const matrix: any[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ v: '' })),
  );
  (sheet.celldata as any[]).forEach((cell: any) => {
    const r = Number(cell?.r);
    const c = Number(cell?.c);
    if (!Number.isNaN(r) && !Number.isNaN(c)) matrix[r][c] = cell?.v ?? { v: '' };
  });
  return matrix;
}

type CellSnapshot = {
  v: any
  bg?: any
  fc?: any
  bl?: any
  it?: any
  un?: any
  st?: any
  fs?: any
}

function snapshotCell(cell: any): CellSnapshot {
  // Fortune Sheet cells usually look like: { v: "text", bg: "#fff", fc: "#000", bl: 1, fs: 12, ... }
  // Sometimes value is nested: { v: { v: "text", ...style } }
  const c = cell?.v && typeof cell.v === 'object' && !Array.isArray(cell.v) ? cell.v : cell
  const src = c ?? {}
  return {
    v: (src as any).v,
    bg: (src as any).bg,
    fc: (src as any).fc,
    bl: (src as any).bl,
    it: (src as any).it,
    un: (src as any).un,
    st: (src as any).st,
    fs: (src as any).fs,
  }
}

function sameSnapshot(a: CellSnapshot, b: CellSnapshot): boolean {
  return a.v === b.v &&
    a.bg === b.bg &&
    a.fc === b.fc &&
    a.bl === b.bl &&
    a.it === b.it &&
    a.un === b.un &&
    a.st === b.st &&
    a.fs === b.fs
}

// Memoized Workbook: props are kept stable → memo prevents ALL re-renders from parent.
// The only way Fortune Sheet redraws is via explicit updateSheet() / applyOp() calls.
const MemoWorkbook = memo(Workbook);

export function LuckysheetBoard() {
  const queryClient = useQueryClient();
  const { data: loads, isLoading, isError, error } = useLoads();
  const deleteMutation = useDeleteLoad();
  const sendMessage = useWSStore((s) => s.sendMessage);
  const focusedCells = useWSStore((s) => s.focusedCells);
  const setApplySheetOp = useWSStore((s) => s.setApplySheetOp);
  const fullRefreshSeq = useWSStore((s) => s.fullRefreshSeq);
  const currentUser = useAuthStore((s) => s.user);

  const [sheets, setSheets] = useState<any[]>([]);

  // ── Internal refs ──────────────────────────────────────────────────────────
  const lastLoadsKeyRef = useRef<string>('');
  const lastMatrixRef = useRef<any[][]>([]);
  const workbookHostRef = useRef<HTMLDivElement | null>(null);
  const workbookRef = useRef<any>(null);
  const myFocusRef = useRef<{ row: number; col: number } | null>(null);
  const presenceKeysRef = useRef<Set<string>>(new Set());
  const isExternalUpdateRef = useRef(false);

  // ── STABLE row→loadId map (source of truth for loadId lookup) ─────────────
  // This is built from `loads` (server data), NOT from lastMatrixRef.
  // Reason: when the user pastes data starting at column A (colIdx 0),
  // Fortune Sheet overwrites matrix[row][0] with arbitrary clipboard text,
  // corrupting the implicit ID lookup via matrix[row][0].v.
  // By maintaining a separate map from the authoritative loads array,
  // we guarantee loadId lookups are always correct regardless of what
  // the user pastes or edits in the visible spreadsheet.
  const rowLoadIdMapRef = useRef<Map<number, number>>(new Map());

  // ── "Latest value" refs — updated in render body (no useEffect needed) ────
  // Callbacks read from these at call time → stable identity (empty deps).
  const sendMsgRef = useRef(sendMessage);
  sendMsgRef.current = sendMessage;

  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const deleteMutateRef = useRef(deleteMutation.mutate);
  deleteMutateRef.current = deleteMutation.mutate;

  // ── applySheetOp: incoming sheet.op from other users ──────────────────────
  // Handles both value changes AND formatting (bold/color/etc.) via Fortune Sheet's
  // native applyOp — single surgical DOM update, zero flash.
  useEffect(() => {
    const applySheetOp = (ops: any[]) => {
      if (!workbookRef.current) return;
      isExternalUpdateRef.current = true;
      try {
        workbookRef.current.applyOp(ops);
      } catch (e) {
        console.warn('[applySheetOp] error:', e);
      } finally {
        setTimeout(() => { isExternalUpdateRef.current = false; }, 0);
      }
    };
    setApplySheetOp(applySheetOp);
    return () => setApplySheetOp(null);
  }, [setApplySheetOp]);


  // NOTE: We do NOT register applyCellUpdate.
  // Fortune Sheet already receives value updates via sheet.op → applyOp (above).
  // Registering applyCellUpdate would double-apply and potentially strip cell styles.

  // ── Sync server data → Fortune Sheet ──────────────────────────────────────
  useEffect(() => {
    if (!loads) return;
    const sortedIds = loads.map((l) => l.id).sort((a, b) => a - b).join(',');
    const loadsKey = `${sortedIds}:${fullRefreshSeq}`;
    if (loadsKey === lastLoadsKeyRef.current) return;
    lastLoadsKeyRef.current = loadsKey;

    // Rebuild stable row→loadId map from authoritative server data
    const newMap = new Map<number, number>();
    loads.forEach((load, rowIdx) => { newMap.set(rowIdx, load.id); });
    rowLoadIdMapRef.current = newMap;

    const sheetConfig = buildSheetConfig(loads);
    lastMatrixRef.current = loads.map((load) =>
      columnKeys.map((key) => ({ v: formatValue(load[key], key as string) })),
    );

    if (workbookRef.current) {
      isExternalUpdateRef.current = true;
      try {
        workbookRef.current.updateSheet([sheetConfig]);
      } finally {
        setTimeout(() => { isExternalUpdateRef.current = false; }, 0);
      }
    } else {
      setSheets([sheetConfig]);
    }
  }, [loads, fullRefreshSeq]);

  // ── STABLE: sendCurrentSelectionFocus ─────────────────────────────────────
  // Presence is tracked by sheet COORDINATES (row/col), so it works on any cell
  // — including empty ones with no backing load record. We broadcast our cursor
  // to other users; we do NOT highlight our own cell (Fortune Sheet already shows
  // our selection), which also keeps our own cell freely editable.
  const sendCurrentSelectionFocus = useCallback(() => {
    const send = sendMsgRef.current;
    const user = currentUserRef.current;
    if (!send || !user || !workbookRef.current) return;
    const selection = workbookRef.current.getSelection()?.[0];
    if (!selection || !Array.isArray(selection.row) || !Array.isArray(selection.column)) return;

    const rowIdx = Number(selection.row[0]);
    const colIdx = Number(selection.column[0]);
    if (Number.isNaN(rowIdx) || Number.isNaN(colIdx) || rowIdx < 0 || colIdx < 0) return;

    if (myFocusRef.current?.row === rowIdx && myFocusRef.current?.col === colIdx) return;
    if (myFocusRef.current) {
      send(JSON.stringify({
        type: 'cell.focus',
        payload: { row: myFocusRef.current.row, col: myFocusRef.current.col, action: 'blur' },
      }));
    }
    myFocusRef.current = { row: rowIdx, col: colIdx };
    send(JSON.stringify({ type: 'cell.focus', payload: { row: rowIdx, col: colIdx, action: 'focus' } }));
  }, []); // EMPTY DEPS — stable forever

  // ── STABLE: detectAndSendChanges ────────────────────────────────────────
  const detectAndSendChangesRef = useRef<((currentMatrix: any[][]) => void) | null>(null);
  
  // Update the ref whenever needed
  useEffect(() => {
    detectAndSendChangesRef.current = (currentMatrix: any[][]) => {
      const send = sendMsgRef.current;
      if (isExternalUpdateRef.current) {
        return;
      }
      if (lastMatrixRef.current.length === 0) {
        lastMatrixRef.current = currentMatrix;
        return;
      }
      const changes: { load_id: number; field: string; value: unknown }[] = [];
      const styleChanges: { load_id: number; field: string; style: any; value: unknown }[] = [];
      const rows = Math.min(currentMatrix.length, lastMatrixRef.current.length);
      const cols = columnKeys.length;
      for (let r = 0; r < rows; r++) {
        for (let c = 1; c < cols; c++) {
          const oldSnap = snapshotCell(lastMatrixRef.current[r]?.[c]);
          const newSnap = snapshotCell(currentMatrix[r]?.[c]);

          // Value change
          const oldVal = oldSnap.v ?? '';
          const newVal = newSnap.v ?? '';
          if (oldVal !== newVal) {
            const u = buildUpdate(r, c, newVal === '' ? null : newVal);
            if (u) changes.push(u);
          }

          // Style change (bg/fg/bold/fontSize/etc.)
          if (!sameSnapshot(oldSnap, newSnap)) {
            const loadId = rowLoadIdMapRef.current.get(r);
            if (!loadId) continue;
            const field = String(columnKeys[c]);
            const style: any = {};
            if (oldSnap.bg !== newSnap.bg) style.bg = newSnap.bg ?? null;
            if (oldSnap.fc !== newSnap.fc) style.fg = newSnap.fc ?? null;
            if (oldSnap.bl !== newSnap.bl) style.bold = !!newSnap.bl && newSnap.bl !== 0;
            if (oldSnap.it !== newSnap.it) style.italic = !!newSnap.it && newSnap.it !== 0;
            if (oldSnap.un !== newSnap.un) style.underline = !!newSnap.un && newSnap.un !== 0;
            if (oldSnap.st !== newSnap.st) style.strikethrough = !!newSnap.st && newSnap.st !== 0;
            if (oldSnap.fs !== newSnap.fs) {
              const fs = typeof newSnap.fs === 'number' ? newSnap.fs : Number(newSnap.fs);
              style.fontSize = Number.isFinite(fs) ? fs : null;
            }
            if (Object.keys(style).length > 0) {
              styleChanges.push({ load_id: loadId, field, style, value: newSnap.v ?? oldSnap.v ?? null });
            }
          }
        }
      }
      if (changes.length > 0 || styleChanges.length > 0) {
        if (send) {
          if (changes.length === 1) {
            send(JSON.stringify({ type: 'cell.update', payload: changes[0] }))
          } else if (changes.length > 1) {
            send(JSON.stringify({ type: 'cell.bulk-update', payload: { updates: changes } }))
          }
          for (const sc of styleChanges.slice(0, 200)) {
            send(JSON.stringify({ type: 'cell.update', payload: { load_id: sc.load_id, field: sc.field, value: sc.value, style: sc.style } }))
          }
        }
      }

      // Keep snapshots stable for the next diff cycle.
      lastMatrixRef.current = currentMatrix.map((row) => row.map((cell) => ({ ...(cell ?? {}) })));
    };
  }, []);

  // ── STABLE: onChange ──────────────────────────────────────────────────────
  const onChange = useCallback((data: any[]) => {
    if (!data || data.length === 0) return;
    const newMatrix = toMatrix(data[0]);
    if (isExternalUpdateRef.current) {
      lastMatrixRef.current = newMatrix;
      sendCurrentSelectionFocus();
      return;
    }
    if (detectAndSendChangesRef.current) {
      detectAndSendChangesRef.current(newMatrix);
    }
    sendCurrentSelectionFocus();
  }, [sendCurrentSelectionFocus]);

  // ── STABLE: Fortune Sheet hooks ───────────────────────────────────────────
  // afterSelectionChange fires on every cell click/selection (not just edits),
  // so this is what actually emits cell.focus when a user clicks a cell.
  // Memoized with a stable dep → does not break MemoWorkbook.
  const workbookHooks = useMemo(() => ({
    afterSelectionChange: () => sendCurrentSelectionFocus(),
  }), [sendCurrentSelectionFocus]);

  // ── Helper: build WS update list from (rowIdx, colIdx, rawValue) ──────────
  // Uses rowLoadIdMapRef instead of matrix[row][0] — safe even if col A was pasted into.
  function buildUpdate(rowIdx: number, colIdx: number, rawVal: unknown) {
    if (colIdx <= 0 || colIdx >= columnKeys.length) return null;
    const loadId = rowLoadIdMapRef.current.get(rowIdx);
    if (!loadId) return null;
    const fieldKey = columnKeys[colIdx];
    return {
      load_id: loadId,
      field: String(fieldKey),
      value: normalizeCellValue(fieldKey, rawVal),
    };
  }

// ── STABLE: onOp ──────────────────────────────────────────────────────────
  // Flow for cell edit / delete / TSV paste:
  //   Fortune Sheet fires onOp
  //   → sheet.op forwarded to other users (applyOp — surgical)
  //   → cell.update / cell.bulk-update sent to backend for DB persistence (no REST)
  //   Sender doesn't receive their own messages (BroadcastExcept) → zero flash.
  const onOp = useCallback((ops: any[]) => {
    if (!Array.isArray(ops) || ops.length === 0) return;
    if (isExternalUpdateRef.current) return;

    const send = sendMsgRef.current;

    // Forward ALL ops to other clients via sheet.op (value + formatting)
    if (send) {
      send(JSON.stringify({ type: 'sheet.op', payload: { ops } }));
    }

    const valueChanges: { load_id: number; field: string; value: unknown }[] = [];
    const styleChanges: { load_id: number; field: string; style: any }[] = [];
    const STYLE_KEYS = new Set(['bg', 'fc', 'bl', 'it', 'un', 'st', 'fs']);

    for (const op of ops) {
      const opType: string = op?.op ?? '';
      const path: (string | number)[] = Array.isArray(op?.path) ? op.path : [];

      // Row deletion must be handled before any value/style parsing that may `continue`
      // (otherwise TS narrows opType to "remove" | "replace" and deleteRowCol becomes unreachable).
      if (opType === 'deleteRowCol') {
        const val = op?.value ?? {};
        if (val.type !== 'row') continue;
        const start = Number(val.start);
        const end = Number(val.end ?? val.start);
        if (Number.isNaN(start)) continue;
        for (let rowIdx = start; rowIdx <= end; rowIdx++) {
          const loadId = rowLoadIdMapRef.current.get(rowIdx);
          if (!loadId) continue;
          deleteMutateRef.current(loadId);
        }
        continue;
      }

      // Row insertion: Fortune Sheet can add rows visually, but DB won't change
      // unless we create actual loads records. We create placeholder loads with
      // unique gate_code_col6 so they persist across reloads.
      if (opType === 'insertRowCol') {
        const val = op?.value ?? {};
        if (val.type !== 'row') continue;
        const start = Number(val.start);
        const count = Number(val.len ?? val.count ?? 1);
        if (Number.isNaN(start) || Number.isNaN(count) || count <= 0) continue;

        const now = Date.now();
        const creates = Array.from({ length: Math.min(count, 200) }, (_, i) => ({
          gate_code_col6: `MANUAL-${now}-${start + i}-${Math.floor(Math.random() * 1e6)}`,
        }));

        // Fire-and-forget; after creates complete, refresh loads so sheet rebuilds from DB.
        Promise.allSettled(
          creates.map((data) => apiClient.post<{ load: Load }>('/api/loads', data)),
        ).then(() => {
          useWSStore.getState().requestFullRefresh();
          queryClient.invalidateQueries({ queryKey: ['loads'] });
        });
        continue;
      }

      // Cell value edit - support both "data" prefix and raw index paths
      let rowIdx: number | undefined;
      let colIdx: number | undefined;
      let rawVal: unknown;

      if (path[0] === 'data' && path.length >= 3) {
        // Standard format: ["data", row, col, "v"]
        rowIdx = Number(path[1]);
        colIdx = Number(path[2]);
        if (Number.isNaN(rowIdx!) || Number.isNaN(colIdx!)) continue;
        if (path.length === 4 && path[3] !== 'v' && path[3] !== 'm') continue;
        if (opType === 'remove') {
          rawVal = null;
        } else if (opType === 'replace') {
          rawVal = path.length === 3 ? op?.value?.v : (path[3] === 'v' ? op?.value : undefined);
        } else {
          continue;
        }
      } else if (path.length >= 2 && typeof path[0] === 'number' && typeof path[1] === 'number') {
        // Alternative format: [row, col, "v"]
        rowIdx = Number(path[0]);
        colIdx = Number(path[1]);
        if (Number.isNaN(rowIdx!) || Number.isNaN(colIdx!)) continue;
        if (path.length === 3 && path[2] !== 'v' && path[2] !== 'm') continue;
        if (opType === 'remove') {
          rawVal = null;
        } else if (opType === 'replace') {
          rawVal = path.length === 2 ? op?.value?.v : (path[2] === 'v' ? op?.value : undefined);
        } else {
          continue;
        }
      } else {
        continue;
      }

      if (rawVal !== undefined) {
        const u = buildUpdate(rowIdx!, colIdx!, rawVal);
        if (u) valueChanges.push(u);
      }

      // ── Style persistence ────────────────────────────────────────────────
      // Fortune Sheet style ops can arrive as:
      //   ["data", r, c, "bg"]             (direct key)
      //   ["data", r, c, "v", "bg"]        (nested under v)
      //   ["data", r, c] with op.value {... bg/fc/bl/fs ...} (replace whole cell)
      if (path[0] === 'data' && path.length >= 3) {
        const r = Number(path[1]);
        const c = Number(path[2]);
        if (!Number.isNaN(r) && !Number.isNaN(c) && c > 0 && c < columnKeys.length) {
          const loadId = rowLoadIdMapRef.current.get(r);
          if (loadId) {
            const field = String(columnKeys[c]);
            const style: any = {};

            // Case A: key-based update (path ends with a style key)
            const lastKey = String(path[path.length - 1]);
            if (STYLE_KEYS.has(lastKey)) {
              const v = opType === 'remove' ? null : op?.value;
              if (lastKey === 'bg') style.bg = v;
              else if (lastKey === 'fc') style.fg = v;
              else if (lastKey === 'bl') style.bold = !!v && v !== 0;
              else if (lastKey === 'it') style.italic = !!v && v !== 0;
              else if (lastKey === 'un') style.underline = !!v && v !== 0;
              else if (lastKey === 'st') style.strikethrough = !!v && v !== 0;
              else if (lastKey === 'fs') style.fontSize = typeof v === 'number' ? v : Number(v);
            }

            // Case B: whole-cell replace where op.value contains style keys
            if (Object.keys(style).length === 0 && opType === 'replace' && path.length === 3) {
              const cellObj = op?.value;
              if (cellObj && typeof cellObj === 'object') {
                const co: any = cellObj;
                const maybe = co?.v && typeof co.v === 'object' ? co.v : co;
                if (maybe && typeof maybe === 'object') {
                  if ('bg' in maybe) style.bg = (maybe as any).bg ?? null;
                  if ('fc' in maybe) style.fg = (maybe as any).fc ?? null;
                  if ('bl' in maybe) style.bold = !!(maybe as any).bl && (maybe as any).bl !== 0;
                  if ('it' in maybe) style.italic = !!(maybe as any).it && (maybe as any).it !== 0;
                  if ('un' in maybe) style.underline = !!(maybe as any).un && (maybe as any).un !== 0;
                  if ('st' in maybe) style.strikethrough = !!(maybe as any).st && (maybe as any).st !== 0;
                  if ('fs' in maybe) style.fontSize = typeof (maybe as any).fs === 'number' ? (maybe as any).fs : Number((maybe as any).fs);
                }
              }
            }

            // Drop NaN fontSize
            if (style.fontSize != null && Number.isNaN(style.fontSize)) delete style.fontSize;

            if (Object.keys(style).length > 0) {
              styleChanges.push({ load_id: loadId, field, style });
            }
          }
        }
      }
    }

    if (!send) return;
    if (valueChanges.length === 1) {
      send(JSON.stringify({ type: 'cell.update', payload: valueChanges[0] }));
    } else if (valueChanges.length > 1) {
      send(JSON.stringify({ type: 'cell.bulk-update', payload: { updates: valueChanges } }));
    }

    // Persist formatting (bg/fg/bold/fontSize/etc.) as DB cell_formats via ws cell.update.style.
    for (const sc of styleChanges.slice(0, 200)) {
      send(JSON.stringify({ type: 'cell.update', payload: { load_id: sc.load_id, field: sc.field, style: sc.style } }));
    }

    sendCurrentSelectionFocus();
  }, [sendCurrentSelectionFocus]);

  // ── handlePaste: TSV clipboard → WS bulk update ───────────────────────────
  // Fortune Sheet handles the visual paste natively (no preventDefault).
  // This handler independently parses the TSV data and sends a cell.bulk-update
  // BEFORE Fortune Sheet alters the DOM — ensuring persistence even if onOp
  // doesn't fire for external clipboard content (cross-app paste edge case).
  //
  // Uses rowLoadIdMapRef for loadId lookup → immune to column-A paste corruption.
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    const send = sendMsgRef.current;
    if (!send || !workbookRef.current) return;

    // Read selection BEFORE Fortune Sheet processes the paste
    const selection = workbookRef.current.getSelection()?.[0];
    if (!selection || !Array.isArray(selection.row) || !Array.isArray(selection.column)) return;

    const startRow = Number(selection.row[0]);
    const startCol = Number(selection.column[0]);
    if (Number.isNaN(startRow) || Number.isNaN(startCol)) return;

    // Parse TSV: Google Sheets uses \r\n or \n for rows, \t for columns
    const rows = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
    const updates: { load_id: number; field: string; value: unknown }[] = [];

    rows.forEach((rowStr, ri) => {
      const cols = rowStr.split('\t');
      cols.forEach((cellVal, ci) => {
        const u = buildUpdate(startRow + ri, startCol + ci, cellVal.trim() || null);
        if (u) updates.push(u);
      });
    });

    if (updates.length === 0) return;

    if (updates.length === 1) {
      send(JSON.stringify({ type: 'cell.update', payload: updates[0] }));
    } else {
      send(JSON.stringify({ type: 'cell.bulk-update', payload: { updates } }));
    }
  }, []);

  // ── Blur focus on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      const send = sendMsgRef.current;
      if (myFocusRef.current && send) {
        send(JSON.stringify({
          type: 'cell.focus',
          payload: { row: myFocusRef.current.row, col: myFocusRef.current.col, action: 'blur' },
        }));
      }
    };
  }, []);

  // ── Presence indicators ───────────────────────────────────────────────────
  // focusedCells changes trigger this effect and the presence bar JSX.
  // MemoWorkbook is NOT re-rendered (all its props are stable).
  useEffect(() => {
    if (!workbookRef.current) return
    const sheetId = workbookRef.current.getSheet?.()?.id ?? 'sheet-1';
    const nextKeys = new Set<string>();

    Object.values(focusedCells).forEach((f) => {
      const key = String(f.user_id);
      nextKeys.add(key);
      if (typeof workbookRef.current?.addPresences === 'function') {
        workbookRef.current?.addPresences([{
          sheetId,
          username: f.user_name,
          userId: String(f.user_id),
          color: f.color || getUserColor(f.user_id),
          selection: { r: f.row, c: f.col },
        } as any]);
      }
    });

    for (const key of presenceKeysRef.current) {
      if (!nextKeys.has(key)) {
        workbookRef.current?.removePresences?.([{ userId: key } as any]);
      }
    }
    presenceKeysRef.current = nextKeys;
  }, [focusedCells]);

  // ── Presence: single-cell color + email tooltip on hover ───────────────────
  // Fortune Sheet's native presence renders a single-cell box (.fortune-presence-selection)
  // with a username label (.fortune-presence-username). We:
  //   • keep the colored box purely visual (pointer-events:none → never blocks clicks)
  //   • hide the native label
  //   • show the email in our OWN tooltip when the mouse hovers a presence cell,
  //     detected by hit-testing the box rects (robust vs canvas stacking/z-index).
  useEffect(() => {
    const styleId = 'presence-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .fortune-presence-selection { pointer-events: none !important; }
        .fortune-presence-username { display: none !important; }
      `;
      document.head.appendChild(style);
    }

    const host = workbookHostRef.current;
    if (!host) return;

    const tip = document.createElement('div');
    tip.style.cssText =
      'position:absolute; pointer-events:none; z-index:1000; padding:2px 8px;' +
      'border-radius:4px; font-size:11px; font-family:sans-serif; color:#fff;' +
      'white-space:nowrap; display:none; box-shadow:0 1px 4px rgba(0,0,0,0.3);';
    host.appendChild(tip);

    const onMove = (e: MouseEvent) => {
      const hostRect = host.getBoundingClientRect();
      let hit: { name: string; color: string } | null = null;
      for (const b of Array.from(host.querySelectorAll('.fortune-presence-selection'))) {
        const el = b as HTMLElement;
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          const label = el.querySelector('.fortune-presence-username') as HTMLElement | null;
          hit = { name: label?.textContent || '', color: el.style.borderColor || '#4a90d9' };
        }
      }
      if (hit) {
        tip.textContent = hit.name;
        tip.style.background = hit.color;
        tip.style.left = `${e.clientX - hostRect.left + 12}px`;
        tip.style.top = `${e.clientY - hostRect.top + 12}px`;
        tip.style.display = 'block';
      } else {
        tip.style.display = 'none';
      }
    };
    host.addEventListener('mousemove', onMove);
    return () => {
      host.removeEventListener('mousemove', onMove);
      tip.remove();
    };
  }, [sheets.length]);

  // ── Scroll fix for wheel/trackpad ─────────────────────────────────────────
  useEffect(() => {
    const host = workbookHostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      const bar = host.querySelector('.luckysheet-scrollbar-y') as HTMLElement | null;
      if (!bar) return;
      bar.scrollTop += e.deltaY;
      e.preventDefault();
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [sheets.length]);

// ── Fallback: periodic check - try multiple methods to get data ────────────
  useEffect(() => {
    const interval = setInterval(() => {
      if (!workbookRef.current || !detectAndSendChangesRef.current) return;
      try {
        let currentMatrix: any[][] = [];
        
        // Method 1: getAllSheets
        const sheets = workbookRef.current.getAllSheets?.();
        if (sheets && sheets.length > 0) {
          currentMatrix = toMatrix(sheets[0]);
        }
        
        // If empty, try getData method
        if (currentMatrix.length === 0 && workbookRef.current.getData) {
          const data = workbookRef.current.getData();
          if (data && data[0]) {
            currentMatrix = toMatrix({ data: data[0].data });
          }
        }
        
        if (currentMatrix.length > 0) {
          detectAndSendChangesRef.current(currentMatrix);
        }
      } catch (e) {}
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading && sheets.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', fontFamily: 'sans-serif' }}>
        <div style={{ fontSize: '18px', fontWeight: 500 }}>Connecting to database...</div>
        <div style={{ color: '#666' }}>Fetching loads data</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ padding: '40px', color: '#d32f2f', fontFamily: 'sans-serif' }}>
        <h2 style={{ marginBottom: '8px' }}>Database Connection Error</h2>
        <p style={{ opacity: 0.8 }}>{error?.message}</p>
      </div>
    );
  }


  return (
    <div style={{ width: '100%', height: 'calc(100vh - 70px)', background: '#f5f5f5', display: 'flex', flexDirection: 'column' }}>
      {/* Presence bar — re-renders on focusedCells change, MemoWorkbook below does NOT */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid #e0e0e0', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px', background: '#fff', minHeight: 32 }}>
        <span style={{ color: '#666', marginRight: '4px' }}>Active cells:</span>
        {Object.values(focusedCells).slice(0, 20).map((f) => {
          const c = f.color || getUserColor(f.user_id)
          return (
            <span
              key={f.user_id}
              title={`${f.user_name}: row ${f.row + 1}, col ${f.col + 1}${f.editing ? ' (editing)' : ''}`}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '2px 8px', borderRadius: '4px', border: `1px solid ${c}`, background: `${c}14`, fontSize: '11px', fontWeight: 500 }}
            >
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: c }} />
              <span>{f.user_name}</span>
              {f.editing && <span style={{ fontSize: '9px', opacity: 0.7 }}>(editing)</span>}
            </span>
          )
        })}
      </div>

      {sheets.length > 0 ? (
        <div
          ref={workbookHostRef}
          style={{ flex: 1, position: 'relative' }}
          onPaste={handlePaste}
        >
          {/*
            MemoWorkbook = memo(Workbook):
              data      — same array ref after initial setSheets, never recreated
              onChange  — stable (empty deps chain via sendCurrentSelectionFocus)
              onOp      — stable (empty deps chain)
              ref       — stable ref object
            → MemoWorkbook NEVER re-renders from parent re-renders.
            → Only updateSheet() / applyOp() calls change the Fortune Sheet DOM.
          */}
          <MemoWorkbook
            ref={workbookRef}
            data={sheets}
            onChange={onChange}
            onOp={onOp}
            hooks={workbookHooks}
          />
        </div>
      ) : (
        <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif' }}>
          <h2 style={{ color: '#666' }}>No data available</h2>
          <p style={{ color: '#888' }}>The loads table appears to be empty.</p>
        </div>
      )}
    </div>
  );
}
