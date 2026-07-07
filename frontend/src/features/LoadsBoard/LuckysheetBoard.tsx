import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Workbook } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import { useDeleteLoad } from '../../hooks/useLoads';
import { useSheetDoc, saveSheetDoc, saveDeleteEvent } from '../../hooks/useSheetDoc';
import { useRowDragReorder } from './useRowDragReorder';
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

// Returns true if a Fortune Sheet sheet contains at least one non-empty cell.
// Handles both the `celldata` (sparse) and `data` (2D matrix) representations
// that getAllSheets() may return.
function sheetHasContent(s: any): boolean {
  if (!s) return false;
  if (Array.isArray(s.celldata) && s.celldata.length > 0) {
    return s.celldata.some((c: any) => {
      const v = c?.v && typeof c.v === 'object' ? c.v.v : c?.v;
      return v !== undefined && v !== null && v !== '';
    });
  }
  if (Array.isArray(s.data)) {
    for (const row of s.data) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        if (cell == null) continue;
        const v = typeof cell === 'object' ? (cell.v && typeof cell.v === 'object' ? cell.v.v : cell.v) : cell;
        if (v !== undefined && v !== null && v !== '') return true;
      }
    }
  }
  return false;
}

// Fortune Sheet's Workbook renders its initial `data` prop from each sheet's
// `celldata` (sparse) array. getAllSheets() however returns the `data` 2D matrix
// (no celldata), so a reloaded document wouldn't render. This converts a sheet
// that only has a `data` matrix into one with `celldata` so it always renders.
function normalizeSheetForLoad(sheet: any): any {
  if (!sheet || typeof sheet !== 'object') return sheet;
  // Already has usable celldata → keep it, drop any stale matrix.
  if (Array.isArray(sheet.celldata) && sheet.celldata.length > 0) {
    const { data, ...rest } = sheet;
    return rest;
  }
  if (Array.isArray(sheet.data)) {
    const celldata: Array<{ r: number; c: number; v: any }> = [];
    sheet.data.forEach((row: any[], r: number) => {
      if (!Array.isArray(row)) return;
      row.forEach((cell, c) => {
        if (cell !== null && cell !== undefined) celldata.push({ r, c, v: cell });
      });
    });
    const { data, ...rest } = sheet;
    return { ...rest, celldata };
  }
  return sheet;
}

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

// Inspect a batch of Fortune Sheet ops and decide whether it represents a
// deletion (row/column removal or cell clearing). Used to keep before/after
// versions and an audit entry for deletions.
function detectDeletion(ops: any[]): { isDelete: boolean; action: 'delete_rows' | 'delete_cols' | 'clear_cells'; details: any } {
  const rows: number[] = [];
  const cols: number[] = [];
  let clearedCells = 0;
  for (const op of ops) {
    const t = op?.op;
    const path = Array.isArray(op?.path) ? op.path : [];
    if (t === 'deleteRowCol') {
      const v = op?.value ?? {};
      const start = Number(v.start);
      const end = Number(v.end ?? v.start);
      if (!Number.isNaN(start)) {
        for (let i = start; i <= end; i++) (v.type === 'column' ? cols : rows).push(i);
      }
    } else if (t === 'remove') {
      clearedCells++;
    } else if (t === 'replace') {
      const isData = path[0] === 'data' || typeof path[0] === 'number';
      if (isData) {
        const val = op?.value;
        const v = val && typeof val === 'object' ? (val.v ?? val.m) : val;
        if (v === '' || v === null || v === undefined) clearedCells++;
      }
    }
  }
  const action: 'delete_rows' | 'delete_cols' | 'clear_cells' =
    rows.length > 0 ? 'delete_rows' : cols.length > 0 ? 'delete_cols' : 'clear_cells';
  return { isDelete: rows.length > 0 || cols.length > 0 || clearedCells > 0, action, details: { rows, cols, cleared_cells: clearedCells } };
}

// Memoized Workbook: props are kept stable → memo prevents ALL re-renders from parent.
// The only way Fortune Sheet redraws is via explicit updateSheet() / applyOp() calls.
const MemoWorkbook = memo(Workbook);

export function LuckysheetBoard() {
  const queryClient = useQueryClient();
  const { data: sheetDoc, isLoading, isError, error } = useSheetDoc();
  const deleteMutation = useDeleteLoad();
  const sendMessage = useWSStore((s) => s.sendMessage);
  const focusedCells = useWSStore((s) => s.focusedCells);
  const setApplySheetOp = useWSStore((s) => s.setApplySheetOp);
  const fullRefreshSeq = useWSStore((s) => s.fullRefreshSeq);
  const currentUser = useAuthStore((s) => s.user);
  // Viewers get a fully read-only board — no editing, formatting, paste, or sync.
  const isReadOnly = currentUser?.role === 'viewer';

  const [sheets, setSheets] = useState<any[]>([]);

  // ── Internal refs ──────────────────────────────────────────────────────────
  const lastLoadsKeyRef = useRef<string>('');
  const lastMatrixRef = useRef<any[][]>([]);
  const workbookHostRef = useRef<HTMLDivElement | null>(null);
  const workbookRef = useRef<any>(null);
  const myFocusRef = useRef<{ row: number; col: number } | null>(null);
  const presenceKeysRef = useRef<Set<string>>(new Set());
  const isExternalUpdateRef = useRef(false);
  const initializedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Snapshot of the workbook BEFORE the current op — used to keep the "before
  // deletion" version. Updated to the post-op state at the end of every op.
  const prevSnapshotRef = useRef<any[]>([]);

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

  const isReadOnlyRef = useRef(isReadOnly);
  isReadOnlyRef.current = isReadOnly;

  // Track if we just did a delete/clear so we don't block empty-save on purpose.
  // After delete/clear, save empty sheet — that's intentional. Reset after 2s.
  const recentDeleteRef = useRef(false);

  // True while a row drag-reorder is rewriting cells, so onOp doesn't misread the
  // block rewrite (which may blank some cells) as a deletion.
  const isReorderingRef = useRef(false);

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

  // ── Load the saved sheet snapshot → Fortune Sheet (once) ───────────────────
  // The full workbook (name, all cells, styles, config, merges) is restored from
  // the server. If nothing was saved yet, start from a default empty sheet.
  useEffect(() => {
    if (!sheetDoc || initializedRef.current) return;
    initializedRef.current = true;

    const saved = Array.isArray(sheetDoc.data) ? sheetDoc.data : null;
    // Convert each saved sheet's `data` matrix → `celldata` so the Workbook
    // actually renders the restored cells on load.
    const initial = (saved && saved.length > 0)
      ? saved.map(normalizeSheetForLoad)
      : [buildSheetConfig([])];
    setSheets(initial);
    prevSnapshotRef.current = initial;
  }, [sheetDoc]);

  // ── Debounced full-snapshot save ───────────────────────────────────────────
  // Persists the ENTIRE workbook (every cell, style, the sheet name, config…)
  // a short moment after the last local change. Other users get changes live via
  // sheet.op; this guarantees nothing is lost on refresh/reconnect.
  // Immediately persist the current workbook (used by the debounce and on exit).
  const doSave = useCallback((reason: 'auto' | 'manual' = 'auto') => {
    if (isReadOnlyRef.current) return;
    const wb = workbookRef.current;
    if (!wb?.getAllSheets) return;
    try {
      const allSheets = wb.getAllSheets() ?? [];
      // SAFETY GUARD: never overwrite the saved document with an empty workbook,
      // UNLESS we just did a delete/clear (recentDeleteRef). An init/refetch race can
      // fire onChange right after the (empty) grid mounts, but a user's intentional
      // Ctrl+A + Backspace should be saved as an empty sheet.
      if (!allSheets.some(sheetHasContent) && !recentDeleteRef.current) {
        console.warn('[saveSheet] skipped — workbook has no cell values (would wipe data)');
        return;
      }
      const name = allSheets[0]?.name ?? 'Loads';
      // Keep the React Query cache in sync so a tab-switch remount (or any
      // refetch) reloads the freshly-saved data instead of stale/empty data.
      queryClient.setQueryData(['sheet-doc'], { name, data: allSheets });
      saveSheetDoc(name, allSheets, reason).catch((e) => console.warn('[saveSheet] failed', e));
    } catch (e) {
      console.warn('[saveSheet] error', e);
    }
  }, [queryClient]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => doSave('auto'), 1200);
  }, [doSave]);

  // Latest doSave for the row-drag hook (stable identity, always current impl).
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  // Enable dragging a row up/down by its row-number gutter. Re-binds when the
  // host (re)mounts, i.e. when sheets first load.
  useRowDragReorder(
    { hostRef: workbookHostRef, workbookRef, isReadOnlyRef, doSaveRef, isReorderingRef },
    [sheets.length],
  );

  // Flush any pending save when leaving the page or switching tabs, so a quick
  // edit-then-refresh never loses data.
  useEffect(() => {
    const flush = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        doSave('auto');
      }
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [doSave]);

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
    // Viewers never persist or broadcast changes — only track their selection.
    if (isReadOnlyRef.current) {
      lastMatrixRef.current = newMatrix;
      sendCurrentSelectionFocus();
      return;
    }
    if (isExternalUpdateRef.current) {
      lastMatrixRef.current = newMatrix;
      sendCurrentSelectionFocus();
      return;
    }
    if (detectAndSendChangesRef.current) {
      detectAndSendChangesRef.current(newMatrix);
    }
    sendCurrentSelectionFocus();
    // Persist the full workbook snapshot (debounced) after a local change.
    scheduleSave();
  }, [sendCurrentSelectionFocus, scheduleSave]);

  // ── STABLE: Fortune Sheet hooks ───────────────────────────────────────────
  // afterSelectionChange fires on every cell click/selection (not just edits),
  // so this is what actually emits cell.focus when a user clicks a cell.
  // Memoized with a stable dep → does not break MemoWorkbook.
  const workbookHooks = useMemo(() => ({
    afterSelectionChange: () => sendCurrentSelectionFocus(),
    // Defense-in-depth read-only guards (in addition to allowEdit={false}):
    // returning false cancels the cell edit / paste before it happens.
    beforeUpdateCell: () => !isReadOnlyRef.current,
    beforePaste: () => !isReadOnlyRef.current,
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
    // Viewers are read-only: never forward ops or persist to the backend.
    if (isReadOnlyRef.current) return;

    const send = sendMsgRef.current;

    // Live collaboration: forward ALL ops (values, styles, insert/delete rows,
    // merges, etc.) to other clients, who apply them surgically via applyOp.
    if (send) {
      send(JSON.stringify({ type: 'sheet.op', payload: { ops } }));
    }

    const wb = workbookRef.current;
    const before = prevSnapshotRef.current;
    const after = wb?.getAllSheets ? wb.getAllSheets() : [];
    const name = after[0]?.name ?? 'Loads';

    // A row drag-reorder rewrites a block of cells (some may blank) — that is NOT
    // a deletion, so skip the delete-event path while reordering.
    const del = isReorderingRef.current
      ? { isDelete: false, action: 'clear_cells' as const, details: {} }
      : detectDeletion(ops);
    if (del.isDelete) {
      // Delete-event is atomic: saves before/after snapshots regardless of content.
      // Even if after is empty (user deleted everything), that's a valid delete.
      recentDeleteRef.current = true;
      setTimeout(() => { recentDeleteRef.current = false; }, 2000);
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      queryClient.setQueryData(['sheet-doc'], { name, data: after });
      saveDeleteEvent({ name, before, after, action: del.action, details: del.details })
        .catch((e) => console.warn('[deleteEvent] failed', e));
    } else {
      // Normal change → debounced full-snapshot save (empty-guarded in doSave).
      scheduleSave();
    }

    prevSnapshotRef.current = after;
    sendCurrentSelectionFocus();
  }, [sendCurrentSelectionFocus, scheduleSave, queryClient]);

  // ── handlePaste: TSV clipboard → WS bulk update ───────────────────────────
  // Fortune Sheet handles the visual paste natively (no preventDefault).
  // This handler independently parses the TSV data and sends a cell.bulk-update
  // BEFORE Fortune Sheet alters the DOM — ensuring persistence even if onOp
  // doesn't fire for external clipboard content (cross-app paste edge case).
  //
  // Uses rowLoadIdMapRef for loadId lookup → immune to column-A paste corruption.
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    // Viewers cannot paste.
    if (isReadOnlyRef.current) { e.preventDefault(); return; }
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

    // On large paste (>100 cells), Fortune Sheet may not trigger enough
    // onChange events, so debounce never fires. Force a save immediately
    // after the paste is applied (setTimeout lets Fortune Sheet DOM update first).
    if (updates.length > 100) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => doSave('auto'), 300);
    }
  }, [doSave]);

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
            allowEdit={!isReadOnly}
            showToolbar={!isReadOnly}
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
