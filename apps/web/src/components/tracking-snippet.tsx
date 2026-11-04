import { useState } from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"

/** Origin that serves /api/script.js. Same as the dashboard unless VITE_TRACKER_ORIGIN is set. */
const trackerOrigin =
  (import.meta.env.VITE_TRACKER_ORIGIN as string | undefined) ||
  window.location.origin

export function snippetFor(siteId: string): string {
  return `<script defer src="${trackerOrigin}/api/script.js" data-site="${siteId}"></script>`
}

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="relative rounded-lg border bg-surface-2 text-fg">
      <pre className="overflow-x-auto p-3.5 pr-12 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
        {code}
      </pre>
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2 text-fg-muted hover:text-fg"
        onClick={() => void copy()}
        aria-label="Copy to clipboard"
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}

export function TrackingSnippet({ siteId }: { siteId: string }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-2">
        <p>
          Add this to the{" "}
          <code className="font-mono text-xs">&lt;head&gt;</code> of every page:
        </p>
        <CodeBlock code={snippetFor(siteId)} />
        <p className="text-fg-muted">
          Page views (including client-side navigation) and outbound link clicks
          are tracked automatically. No cookies, no consent banner needed.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <p>Track custom events with an attribute or from JavaScript:</p>
        <CodeBlock
          code={`<button data-track="signup" data-track-plan="pro">Sign up</button>`}
        />
        <CodeBlock code={`window.mlz?.track("signup", { plan: "pro" })`} />
      </div>
    </div>
  )
}
