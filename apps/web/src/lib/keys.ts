/** True when a key press is meant for a text field, menu or dialog. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable ||
      t.closest(
        "input, textarea, select, [role=dialog], [role=menu], [role=listbox]"
      ) !== null)
  )
}
