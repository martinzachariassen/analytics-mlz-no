import { PERIODS, type Period } from "@/lib/period"

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

/** Single-key period shortcuts, in the order the period picker lists them. */
export const PERIOD_KEYS: Record<Period, string> = {
  today: "T",
  yesterday: "Y",
  "7d": "7",
  "30d": "3",
  month: "M",
  last_month: "L",
  "12m": "A",
}

/** Every keyboard shortcut, for the help dialog. */
export const SHORTCUTS: { group: string; keys: string[]; label: string }[] = [
  {
    group: "General",
    keys: ["⌘", "K"],
    label: "Search views, sites and actions",
  },
  { group: "General", keys: ["?"], label: "Show keyboard shortcuts" },
  { group: "General", keys: ["⌘", "B"], label: "Toggle the sidebar" },
  { group: "General", keys: ["D"], label: "Toggle dark mode" },
  { group: "Dashboard", keys: ["X"], label: "Toggle the comparison" },
  ...(Object.keys(PERIOD_KEYS) as Period[]).map((p) => ({
    group: "Period",
    keys: [PERIOD_KEYS[p]],
    label: PERIODS[p],
  })),
]
