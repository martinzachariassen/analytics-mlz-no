import { cn } from "@/lib/utils"

/** A row of uppercase mono buttons in the brand's control style; the active one is filled. */
export function Segmented<T extends string>({
  value,
  onChange,
  items,
  label,
  className,
}: {
  value: T | undefined
  onChange: (v: T) => void
  items: { value: T; label: string; title?: string }[]
  label: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex h-8 items-stretch overflow-hidden rounded-lg border-[1.5px] border-fg",
        className
      )}
    >
      {items.map((it, i) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={it.title}
            onClick={() => onChange(it.value)}
            className={cn(
              "px-2.5 text-[11px] tracking-[0.14em] uppercase transition-colors sm:px-3",
              i > 0 && "border-l border-fg/30",
              active
                ? "bg-fg text-bg"
                : "text-fg-secondary hover:bg-accent hover:text-fg"
            )}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
