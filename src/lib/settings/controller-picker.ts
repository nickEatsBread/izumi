/** Centre the current value's row in the controller picker's list (spec §3.5: it opens scrolled to
 *  the current value, not just focused on it). Returns the row, or null when the value has none. */
export function centrePickerValue(list: ParentNode, value: string): HTMLElement | null {
  const row = [...list.querySelectorAll<HTMLElement>('[data-select-value]')].find((el) => el.dataset.selectValue === value) ?? null
  row?.scrollIntoView?.({ block: 'center' })
  return row
}
