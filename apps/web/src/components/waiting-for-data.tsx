import { Link } from "react-router"

import { CodeBlock, snippetFor } from "@/components/tracking-snippet"
import type { Site } from "@/lib/api"

/** A pulsing dot that stays still for people who prefer reduced motion. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={`relative flex size-2 shrink-0 ${className ?? ""}`}>
      <span className="absolute inline-flex size-full rounded-full bg-accent opacity-60 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2 rounded-full bg-accent" />
    </span>
  )
}

/**
 * Shown instead of a site's dashboard until its first event arrives: what to do, and a
 * live status that the site query (polled by useSite) replaces with the dashboard.
 */
export function WaitingForData({ site }: { site: Site }) {
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-lg border bg-surface p-6 sm:p-8">
      <div className="flex flex-col gap-2">
        <p
          role="status"
          className="flex items-center gap-2.5 text-sm font-medium text-fg"
        >
          <LiveDot />
          Waiting for the first event…
        </p>
        <h2 className="display text-2xl">No data for {site.name} yet</h2>
        <p className="text-fg-secondary">
          Add the snippet to the{" "}
          <code className="font-mono text-xs">&lt;head&gt;</code> of every page
          on {site.domain}, then open the site in a browser. This page switches
          to the dashboard as soon as the first page view arrives.
        </p>
      </div>
      <CodeBlock code={snippetFor(site.id)} />
      <div className="flex flex-col gap-2 text-sm text-fg-secondary">
        <p className="font-medium text-fg">Nothing after a minute?</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Events are only accepted from {site.domain} and its subdomains.
            Check the domain in{" "}
            <Link
              to={`/sites/${site.id}/settings`}
              className="text-accent-deep underline"
            >
              settings
            </Link>
            .
          </li>
          <li>
            Ad and tracking blockers may block the script. Try a private window
            without extensions.
          </li>
          <li>
            Look for <code className="font-mono text-xs">/api/script.js</code>{" "}
            and <code className="font-mono text-xs">/api/event</code> in the
            network tab of the browser&apos;s developer tools.
          </li>
        </ul>
      </div>
    </section>
  )
}
