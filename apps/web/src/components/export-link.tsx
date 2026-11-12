import { Download } from "lucide-react"

import { Button } from "@/components/ui/button"

/** A small "CSV" download link for a panel's action slot. */
export function ExportLink({ href, label }: { href: string; label: string }) {
  return (
    <Button variant="ghost" size="xs" asChild>
      <a href={href} download aria-label={`Export ${label} as CSV`}>
        <Download aria-hidden />
        CSV
      </a>
    </Button>
  )
}
