// Pure predicate for the file list (콘솔 개편 S4).
// The filename cell carries a data marker; a double-click anywhere inside it
// opens the file body popup. A double-click elsewhere in the row does not.
// Keeping this separate lets row single-click (select) and filename
// double-click (popup) stay cleanly distinct.

export const FILENAME_CELL_MARKER = 'filename'

/** True when the event target sits inside a marked filename cell. */
export function isFilenameCellTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest(`[data-cell="${FILENAME_CELL_MARKER}"]`) != null
}
