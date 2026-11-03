import { cn } from "@/lib/utils"

/** The mlz mark: an M cut out of a rounded square, in --fg (brand rule). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-5 shrink-0", className)}
      role="img"
      aria-label="mlz"
    >
      <path
        fill="var(--fg)"
        fillRule="evenodd"
        d="M7 1h18a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6H7a6 6 0 0 1-6-6V7a6 6 0 0 1 6-6ZM7 25V7h4.5L16 18.5 20.5 7H25v18Z"
      />
    </svg>
  )
}

/** Mark + "mlz." wordmark, with the product name after it. */
export function Wordmark({ product = "analytics" }: { product?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandMark />
      <span className="font-brand text-[15px] leading-none font-bold tracking-[-0.03em]">
        mlz<span className="text-accent-deep">.</span>
      </span>
      {product && (
        <span className="eyebrow max-sm:hidden" aria-hidden>
          {product}
        </span>
      )}
    </span>
  )
}
