import { useEffect, type MutableRefObject, type RefObject } from 'react'

// Fortune Sheet has no native row drag-reorder. This hook adds it by intercepting
// mousedown on the row-header gutter (.fortune-row-header), tracking the drag, and
// on drop rewriting the affected contiguous block of rows via the workbook API
// (setCellValuesByRange). That API emits an op → the board's onOp forwards it to
// other users (sheet.op) in real time; we also force a save so it persists.
//
// Cell styles are preserved because we move the full cell objects (getCellsByRange
// returns { v, m, bg, bl, ht, fc, fs, ... } and setCellValuesByRange copies them).

const DEFAULT_ROW_HEIGHT = 19
const DRAG_THRESHOLD_PX = 4
// .fortune-row-header has padding-top:2px → row content starts 2px below its top.
const GUTTER_PAD_TOP = 2

// Vertical scroll offset in content pixels. The row-header gutter has
// overflow:hidden (its scrollTop can read 0 even when scrolled), so prefer the
// real vertical scrollbar element the sheet uses.
function getScrollTop(host: HTMLElement, gutterEl: HTMLElement): number {
  const bar = host.querySelector('.luckysheet-scrollbar-y') as HTMLElement | null
  if (bar && bar.scrollTop > 0) return bar.scrollTop
  return gutterEl.scrollTop || 0
}

// Cursor clientY → content Y (row coordinate space matching cumulative heights).
function contentYFromEvent(host: HTMLElement, gutterEl: HTMLElement, clientY: number): number {
  const gRect = gutterEl.getBoundingClientRect()
  return clientY - gRect.top - GUTTER_PAD_TOP + getScrollTop(host, gutterEl)
}

type Params = {
  hostRef: RefObject<HTMLDivElement | null>
  workbookRef: RefObject<any>
  isReadOnlyRef: RefObject<boolean>
  doSaveRef: RefObject<(reason?: 'auto' | 'manual') => void>
  // Set true right before we mutate rows so the board's onOp doesn't misread the
  // block rewrite (which may blank some cells) as a deletion.
  isReorderingRef: MutableRefObject<boolean>
}

// Number of data rows / columns in the active sheet (from its sparse celldata).
function getActiveSheetInfo(wb: any): { rowCount: number; colCount: number } {
  const sheet = wb.getSheet?.()
  const celldata: Array<{ r: number; c: number }> = sheet?.celldata ?? []
  let maxRow = -1
  let maxCol = -1
  for (const cell of celldata) {
    if (cell.r > maxRow) maxRow = cell.r
    if (cell.c > maxCol) maxCol = cell.c
  }
  return { rowCount: maxRow + 1, colCount: maxCol + 1 }
}

// cum[r] = top Y (content coords) of row r; cum[rowCount] = bottom of last row.
function buildCumHeights(wb: any, rowCount: number): number[] {
  const idxs = Array.from({ length: rowCount }, (_, i) => i)
  let heights: Record<number, number> = {}
  try {
    heights = wb.getRowHeight?.(idxs) ?? {}
  } catch {
    heights = {}
  }
  const cum = new Array(rowCount + 1)
  cum[0] = 0
  for (let i = 0; i < rowCount; i++) {
    const h = Number(heights[i]) || DEFAULT_ROW_HEIGHT
    cum[i + 1] = cum[i] + h
  }
  return cum
}

function rowAtContentY(cum: number[], contentY: number): number {
  if (contentY <= 0) return 0
  for (let r = 0; r < cum.length - 1; r++) {
    if (contentY < cum[r + 1]) return r
  }
  return cum.length - 2
}

// Boundary index in [0, rowCount] = the gap the row will be inserted into.
function boundaryAtContentY(cum: number[], contentY: number, rowCount: number): number {
  if (contentY <= 0) return 0
  const r = rowAtContentY(cum, contentY)
  const mid = (cum[r] + cum[r + 1]) / 2
  let b = contentY < mid ? r : r + 1
  if (b < 0) b = 0
  if (b > rowCount) b = rowCount
  return b
}

export function useRowDragReorder({
  hostRef,
  workbookRef,
  isReadOnlyRef,
  doSaveRef,
  isReorderingRef,
}: Params, deps: unknown[]) {
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Discoverability: show a grab cursor over the row-number gutter.
    const styleId = 'row-drag-cursor-style'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `.fortune-row-header { cursor: grab; }
        .fortune-row-header .fortune-rows-change-size { cursor: row-resize; }`
      document.head.appendChild(style)
    }

    // Blue insertion line + drag label overlay (pointer-events:none so it never blocks).
    const line = document.createElement('div')
    line.style.cssText =
      'position:absolute; left:0; right:0; height:2px; background:#2563eb;' +
      'box-shadow:0 0 3px rgba(37,99,235,0.8); z-index:60; display:none; pointer-events:none;'
    const label = document.createElement('div')
    label.style.cssText =
      'position:absolute; z-index:61; display:none; pointer-events:none;' +
      'background:#2563eb; color:#fff; font:11px sans-serif; padding:2px 8px;' +
      'border-radius:4px; box-shadow:0 1px 4px rgba(0,0,0,0.3); white-space:nowrap;'
    host.appendChild(line)
    host.appendChild(label)

    let pending = false
    let dragging = false
    let srcRow = -1
    let startY = 0
    let cum: number[] = []
    let rowCount = 0
    let colCount = 0
    let boundary = 0
    let gutterEl: HTMLElement | null = null

    const positionIndicator = () => {
      if (!gutterEl) return
      const hostRect = host.getBoundingClientRect()
      const gRect = gutterEl.getBoundingClientRect()
      const scrollTop = getScrollTop(host, gutterEl)
      const y = cum[boundary] - scrollTop + GUTTER_PAD_TOP + (gRect.top - hostRect.top)
      // Keep the line within the visible grid area.
      if (y < gRect.top - hostRect.top || y > gRect.bottom - hostRect.top) {
        line.style.display = 'none'
      } else {
        line.style.top = `${y}px`
        line.style.display = 'block'
      }
      label.style.left = `${gRect.right - hostRect.left + 6}px`
      label.style.top = `${y - 9}px`
      label.style.display = 'block'
    }

    const hideIndicator = () => {
      line.style.display = 'none'
      label.style.display = 'none'
    }

    const performReorder = () => {
      const wb = workbookRef.current
      if (!wb?.getCellsByRange || !wb?.setCellValuesByRange) {
        console.warn('[rowDrag] workbook API missing', wb)
        return
      }
      let dst = boundary > srcRow ? boundary - 1 : boundary
      if (srcRow < 0 || dst === srcRow) {
        console.log('[rowDrag] no move (src=%d dst=%d boundary=%d)', srcRow, dst, boundary)
        return
      }
      if (dst < 0) dst = 0
      if (dst > rowCount - 1) dst = rowCount - 1

      // Rewrite the affected contiguous block of rows with the reordered cells.
      // getCellsByRange returns flat cell objects from the (frozen) state; we clone
      // them so setCellValuesByRange writes fresh objects into the immer draft.
      const lo = Math.min(srcRow, dst)
      const hi = Math.max(srcRow, dst)
      const width = Math.max(colCount, 1)
      const range = { row: [lo, hi], column: [0, width - 1] }

      let block: any[][]
      try {
        block = wb.getCellsByRange(range)
      } catch (err) {
        console.error('[rowDrag] getCellsByRange failed', err)
        return
      }
      if (!Array.isArray(block) || block.length !== hi - lo + 1) {
        console.warn('[rowDrag] unexpected block shape', { got: block?.length, want: hi - lo + 1 })
        return
      }

      // Normalize every cell to a fresh, width-consistent row (null for empties).
      const cloned: any[][] = block.map((r) => {
        const row = Array.isArray(r) ? r : []
        return Array.from({ length: width }, (_, c) => {
          const cell = row[c]
          return cell && typeof cell === 'object' ? { ...cell } : cell ?? null
        })
      })
      const moved = cloned.splice(srcRow - lo, 1)[0]
      cloned.splice(dst - lo, 0, moved)
      console.log('[rowDrag] moving row %d → %d (block %d..%d, w=%d)', srcRow + 1, dst + 1, lo + 1, hi + 1, width)

      isReorderingRef.current = true
      try {
        wb.setCellValuesByRange(cloned, range)
        console.log('[rowDrag] setCellValuesByRange OK')
      } catch (err) {
        console.error('[rowDrag] setCellValuesByRange failed', err)
      } finally {
        // Let the op flush, then persist the full snapshot and clear the guard.
        setTimeout(() => {
          try {
            doSaveRef.current?.('manual')
          } finally {
            isReorderingRef.current = false
          }
        }, 80)
      }
    }

    const onMove = (e: MouseEvent) => {
      if (!pending) return
      if (!dragging) {
        if (Math.abs(e.clientY - startY) < DRAG_THRESHOLD_PX) return
        dragging = true
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }
      e.preventDefault()
      if (!gutterEl) return
      const contentY = contentYFromEvent(host, gutterEl, e.clientY)
      boundary = boundaryAtContentY(cum, contentY, rowCount)
      // Excel-style: "Moving row <src> → <target>" (target = row it lands above).
      const targetNum = boundary >= rowCount ? rowCount : boundary + 1
      label.textContent =
        boundary >= rowCount
          ? `Moving row ${srcRow + 1} → end`
          : `Moving row ${srcRow + 1} → ${targetNum}`
      positionIndicator()
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseup', onUp, true)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      hideIndicator()
      if (dragging && srcRow >= 0) performReorder()
      pending = false
      dragging = false
      srcRow = -1
      gutterEl = null
    }

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      if (isReadOnlyRef.current) return
      const target = e.target as HTMLElement | null
      if (!target) return
      const g = target.closest('.fortune-row-header') as HTMLElement | null
      if (!g) return
      // Preserve native row-height resize + freeze handles.
      if (target.closest('.fortune-rows-change-size, .fortune-rows-freeze-handle')) return

      const wb = workbookRef.current
      if (!wb?.getAllSheets || !wb?.updateSheet) {
        console.warn('[rowDrag] mousedown but workbook API not ready')
        return
      }
      const info = getActiveSheetInfo(wb)
      console.log('[rowDrag] gutter mousedown — rows=%d cols=%d', info.rowCount, info.colCount)
      if (info.rowCount <= 1) return

      gutterEl = g
      rowCount = info.rowCount
      colCount = info.colCount
      cum = buildCumHeights(wb, rowCount)

      const gRect0 = g.getBoundingClientRect()
      const bar = host.querySelector('.luckysheet-scrollbar-y') as HTMLElement | null
      const contentY = contentYFromEvent(host, g, e.clientY)
      srcRow = rowAtContentY(cum, contentY)
      console.log(
        '[rowDrag] srcRow=%d | clientY=%d gTop=%d barScroll=%s gutterScroll=%d contentY=%d rowH≈%d',
        srcRow,
        Math.round(e.clientY),
        Math.round(gRect0.top),
        bar ? Math.round(bar.scrollTop) : 'n/a',
        Math.round(g.scrollTop || 0),
        Math.round(contentY),
        Math.round(cum[1] - cum[0]),
      )
      if (srcRow < 0 || srcRow >= rowCount) {
        gutterEl = null
        return
      }
      startY = e.clientY
      pending = true
      boundary = srcRow

      // Fully intercept so Fortune Sheet's native gutter selection doesn't fire.
      e.preventDefault()
      e.stopPropagation()
      document.addEventListener('mousemove', onMove, true)
      document.addEventListener('mouseup', onUp, true)
    }

    host.addEventListener('mousedown', onDown, true)
    return () => {
      host.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseup', onUp, true)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      line.remove()
      label.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
