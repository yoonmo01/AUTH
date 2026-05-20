// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { isFilenameCellTarget } from './filenameCell'

// Build a minimal table row: one filename cell (marked) + one plain cell.
function buildRow() {
  const tr = document.createElement('tr')
  const nameCell = document.createElement('td')
  nameCell.setAttribute('data-cell', 'filename')
  const nameText = document.createElement('span')
  nameCell.appendChild(nameText)
  const otherCell = document.createElement('td')
  tr.append(nameCell, otherCell)
  return { tr, nameCell, nameText, otherCell }
}

describe('isFilenameCellTarget', () => {
  it('is true for the filename cell itself', () => {
    const { nameCell } = buildRow()
    expect(isFilenameCellTarget(nameCell)).toBe(true)
  })

  it('is true for a descendant of the filename cell', () => {
    const { nameText } = buildRow()
    expect(isFilenameCellTarget(nameText)).toBe(true)
  })

  it('is false for a different cell in the row', () => {
    const { otherCell } = buildRow()
    expect(isFilenameCellTarget(otherCell)).toBe(false)
  })

  it('is false for the row element', () => {
    const { tr } = buildRow()
    expect(isFilenameCellTarget(tr)).toBe(false)
  })

  it('is false for null or a non-element target', () => {
    expect(isFilenameCellTarget(null)).toBe(false)
    expect(isFilenameCellTarget(new EventTarget())).toBe(false)
  })
})
