import { Check, Copy } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

/** Origin that serves /api/script.js and /api/pixel.gif. Same as the dashboard unless VITE_TRACKER_ORIGIN is set. */
const trackerOrigin =
  (import.meta.env.VITE_TRACKER_ORIGIN as string | undefined) ||
  window.location.origin

export function snippetFor(siteId: string): string {
  return `<script defer src="${trackerOrigin}/api/script.js" data-site="${siteId}"></script>`
}

export function pixelUrlFor(
  siteId: string,
  params: Record<string, string> = {}
): string {
  const q = new URLSearchParams({ site: siteId, ...params })
  return `${trackerOrigin}/api/pixel.gif?${q}`
}

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const pre = useRef<HTMLPreElement>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // No clipboard access (an insecure origin, a denied permission): select the code so
      // copying by hand is one keystroke.
      if (pre.current) getSelection()?.selectAllChildren(pre.current)
      toast.error(
        "Could not copy. The code is selected: copy it with your keyboard."
      )
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="relative rounded-lg border bg-surface-2 text-fg">
      <pre
        ref={pre}
        className="overflow-x-auto p-3.5 pr-12 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap"
      >
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
          are tracked automatically. The script sets no cookies.
        </p>
      </div>
      <EventSnippets />
    </div>
  )
}

/** How to send custom events, for settings, onboarding and the empty Events view. */
export function EventSnippets() {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>Track custom events with an attribute or from JavaScript:</p>
      <CodeBlock
        code={`<button data-mlz-event="signup" data-mlz-event-plan="pro">Sign up</button>`}
      />
      <CodeBlock code={`window.mlz?.track("signup", { plan: "pro" })`} />
    </div>
  )
}
