import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, Navigate, useSearchParams } from "react-router"
import {
  Activity,
  ArrowRight,
  ChartNoAxesColumn,
  CircleAlert,
  Cookie,
  EyeOff,
  Feather,
  FlaskConical,
  MousePointerClick,
  Route,
  Server,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"

// Error codes set by the server's OAuth callback (?auth_error=…).
const AUTH_ERRORS: Record<string, string> = {
  not_allowed:
    "This GitHub account is not allowed to sign in. Ask the owner to add you to ALLOWED_GITHUB_USERS.",
  conflict: "This GitHub username is already linked to a different account.",
  denied: "Sign-in was cancelled.",
  state: "The sign-in link expired. Please try again.",
  failed: "Sign-in failed. Please try again.",
}

const FEATURES = [
  {
    icon: Cookie,
    title: "No cookies, no banner",
    text: "Visitors are counted anonymously with a daily rotating hash, so there is nothing to consent to.",
  },
  {
    icon: EyeOff,
    title: "No personal data",
    text: "IP addresses and user agents are never stored. Only coarse country, browser and device.",
  },
  {
    icon: Activity,
    title: "Realtime",
    text: "See who is on your site right now, and how today compares with yesterday.",
  },
  {
    icon: MousePointerClick,
    title: "Goals and events",
    text: "Track sign-ups, downloads and outbound links with one HTML attribute.",
  },
  {
    icon: Route,
    title: "Works with SPAs",
    text: "Page changes in React, Vue and other single-page apps are picked up automatically.",
  },
  {
    icon: Feather,
    title: "Tiny script",
    text: "About 1 KB gzipped. It won't slow your site down.",
  },
]

const STEPS = [
  {
    title: "Add your site",
    text: "Give it a name and a domain in the dashboard.",
  },
  {
    title: "Paste one line",
    text: "Put the script tag in your site's <head>. No configuration needed.",
  },
  {
    title: "Watch the numbers",
    text: "Visitors, pages, sources and events show up within seconds.",
  },
]

/**
 * Public home page: what this is, and how to sign in. It renders immediately,
 * without waiting for the session check; signed-in visitors go on to their sites.
 */
export function HomePage() {
  const [params] = useSearchParams()
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false })
  const config = useQuery({
    queryKey: ["auth-config"],
    queryFn: api.authConfig,
  })

  if (me.isSuccess) return <Navigate to="/sites" replace />

  const error = params.get("auth_error")
  const github = config.data?.providers.includes("github")
  // Local development (DEV_LOGIN=1): one click, no account needed.
  const dev = config.data?.providers.includes("dev")

  const signIn = (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Could not sign in</AlertTitle>
          <AlertDescription>
            {AUTH_ERRORS[error] ?? AUTH_ERRORS.failed}
          </AlertDescription>
        </Alert>
      )}
      {config.isPending && <Skeleton className="h-10 w-56" />}
      {config.isError && (
        <p className="text-sm text-destructive">
          Could not reach the server. Is it running?
        </p>
      )}
      {config.isSuccess && !github && !dev && (
        <Alert>
          <CircleAlert />
          <AlertTitle>Sign-in is not configured</AlertTitle>
          <AlertDescription>
            Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and ALLOWED_GITHUB_USERS
            on the server.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-3">
        {dev && (
          <Button asChild size="lg" className="group">
            <a href="/api/auth/dev/login">
              Open demo dashboard
              <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
            </a>
          </Button>
        )}
        {github && (
          <Button asChild size="lg">
            {/* Full page navigation: the server redirects to GitHub. */}
            <a href="/api/auth/github/login">
              <GitHubIcon />
              Sign in with GitHub
            </a>
          </Button>
        )}
      </div>
      {dev && (
        <p className="text-xs text-muted-foreground">
          No account or password needed: you will be signed in as{" "}
          <span className="font-medium">dev</span>. This only works when the
          server runs with{" "}
          <code className="rounded bg-muted px-1 py-0.5">DEV_LOGIN=1</code> on
          localhost.
        </p>
      )}
    </div>
  )

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <div className="flex items-center gap-3">
            {dev && (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-700 max-sm:hidden dark:text-amber-400"
              >
                <FlaskConical />
                Local development
              </Badge>
            )}
            {(dev || github) && (
              <Button asChild size="sm" variant="outline">
                <a
                  href={dev ? "/api/auth/dev/login" : "/api/auth/github/login"}
                >
                  Sign in
                </a>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(50rem_30rem_at_80%_-10%,color-mix(in_oklab,var(--chart-1)_18%,transparent),transparent_70%)]"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
            <div className="flex flex-col gap-6">
              <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                Simple, honest numbers about your websites.
              </h1>
              <p className="max-w-lg text-lg text-muted-foreground">
                See how many people visit, where they come from and what they
                read, without cookies and without tracking anyone. Self-hosted,
                so the data stays yours.
              </p>
              {signIn}
            </div>
            <DashboardPreview />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <SectionTitle
            title="Everything you need, nothing you don't"
            text="The numbers that matter for a website, on one page that is easy to read."
          />
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-chart-1/10 text-chart-1">
                  <Icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-medium">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y bg-muted/40">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
            <div className="flex flex-col gap-8">
              <SectionTitle
                title="Up and running in a minute"
                text="One script tag. No cookie banner, no configuration."
              />
              <ol className="flex flex-col gap-5">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="flex gap-4">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-card text-sm font-medium">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="font-medium">{s.title}</h3>
                      <p className="text-sm text-muted-foreground">{s.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex flex-col justify-center gap-3">
              <Code>
                <span className="text-zinc-500">{"<!-- in <head> -->"}</span>
                {"\n"}
                {'<script defer src="https://t.example.com/api/script.js"'}
                {"\n"}
                {'        data-site="SITE_ID"></script>'}
              </Code>
              <Code>
                <span className="text-zinc-500">{"<!-- a goal -->"}</span>
                {"\n"}
                {'<button data-track="signup">Sign up</button>'}
              </Code>
            </div>
          </div>
        </section>

        <section className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-16 text-center sm:px-6">
          <Server className="size-8 text-chart-1" />
          <h2 className="text-2xl font-semibold tracking-tight">
            Your data, your server
          </h2>
          <p className="max-w-xl text-muted-foreground">
            One small Go binary and a SQLite file, backed up continuously. It
            runs for close to nothing on Cloud Run, a VPS or a Raspberry Pi, and
            nothing is shared with third parties.
          </p>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground sm:px-6">
          <span>Self-hosted analytics · open source</span>
          <span>IP geolocation by DB-IP (CC BY 4.0)</span>
        </div>
      </footer>
    </div>
  )
}

function SectionTitle({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="text-muted-foreground">{text}</p>
    </div>
  )
}

function Code({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-4 text-sm leading-relaxed text-zinc-100 ring-1 ring-white/10">
      <code>{children}</code>
    </pre>
  )
}

/** A static picture of the dashboard, so visitors know what they will get. Not real data. */
function DashboardPreview() {
  const values = [42, 48, 45, 60, 55, 50, 64, 70, 66, 61, 75, 82, 78, 90]
  const w = 400
  const h = 120
  const max = 100
  const pts = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * w).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`
    )
    .join(" ")
  return (
    <div
      aria-hidden
      className="pointer-events-none rounded-2xl border bg-card p-5 shadow-xl shadow-chart-1/5 select-none"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">example.com</span>
        <span className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          12 online now
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {[
          ["Visitors", "2,481", "+18%"],
          ["Page views", "6,904", "+12%"],
          ["Bounce rate", "41%", "−4%"],
        ].map(([label, value, delta]) => (
          <div key={label} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{value}</p>
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {delta}
            </p>
          </div>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="mt-4 h-28 w-full text-chart-1"
        preserveAspectRatio="none"
      >
        <polygon
          points={`0,${h} ${pts} ${w},${h}`}
          fill="currentColor"
          opacity={0.12}
        />
        <polyline
          points={pts}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-4 flex flex-col gap-1.5 text-sm">
        {[
          ["google.com", 82],
          ["news.ycombinator.com", 54],
          ["github.com", 31],
        ].map(([name, pct]) => (
          <div key={name} className="relative flex h-7 items-center px-2">
            <span
              className="absolute inset-y-0 left-0 rounded-md bg-chart-1/14"
              style={{ width: `${pct}%` }}
            />
            <span className="relative">{name}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        Example data
      </p>
    </div>
  )
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold">
      <span className="flex size-7 items-center justify-center rounded-md bg-chart-1 text-white">
        <ChartNoAxesColumn className="size-4" />
      </span>
      analytics
    </Link>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  )
}
