import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, Navigate, useSearchParams } from "react-router"
import { ArrowRight, CircleAlert } from "lucide-react"

import { Wordmark } from "@/components/brand-mark"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
    title: "No cookies, no banner",
    text: "Visitors are counted anonymously with a daily rotating hash, so there is nothing to consent to.",
  },
  {
    title: "No personal data",
    text: "IP addresses and user agents are never stored. Only coarse country, browser and device.",
  },
  {
    title: "Realtime",
    text: "See who is on your site right now, and how today compares with yesterday.",
  },
  {
    title: "Goals and events",
    text: "Track sign-ups, downloads and outbound links with one HTML attribute.",
  },
  {
    title: "Works with SPAs",
    text: "Page changes in React, Vue and other single-page apps are picked up automatically.",
  },
  {
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
        <p className="max-w-[52ch] text-xs leading-relaxed text-fg-muted">
          No account or password needed: you will be signed in as{" "}
          <span className="font-medium">dev</span>. This only works when the
          server runs with{" "}
          <code className="rounded-sm bg-accent px-1 py-0.5 font-mono">
            DEV_LOGIN=1
          </code>{" "}
          on localhost.
        </p>
      )}
    </div>
  )

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-4 pt-7 pb-4 sm:px-8">
        <Link to="/" aria-label="Home">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-3">
          {dev && (
            <span className="eyebrow max-sm:hidden">Local development</span>
          )}
          {(dev || github) && (
            <Button asChild size="sm" variant="outline">
              <a href={dev ? "/api/auth/dev/login" : "/api/auth/github/login"}>
                Sign in
              </a>
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid max-w-[1200px] items-center gap-14 px-4 pt-14 pb-20 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:pt-24 lg:pb-28">
          <div className="flex flex-col gap-7">
            <p className="eyebrow rise">
              Cookie-free <span className="text-accent-deep">/</span>{" "}
              self-hosted <span className="text-accent-deep">/</span> open
              source
            </p>
            <h1
              className="display rise text-[44px] text-balance sm:text-[64px] lg:text-[76px]"
              style={{ "--i": 1 } as React.CSSProperties}
            >
              Honest numbers, <span className="text-accent-deep">nothing</span>{" "}
              more.
            </h1>
            <p
              className="rise max-w-[46ch] text-[17px] leading-relaxed text-fg-secondary"
              style={{ "--i": 2 } as React.CSSProperties}
            >
              See how many people visit, where they come from and what they
              read, without cookies and without tracking anyone. Self-hosted, so
              the data stays yours.
            </p>
            <div className="rise" style={{ "--i": 3 } as React.CSSProperties}>
              {signIn}
            </div>
          </div>
          <div className="rise" style={{ "--i": 4 } as React.CSSProperties}>
            <DashboardPreview />
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-20 sm:px-8 lg:grid-cols-[1fr_2fr]">
            <SectionTitle
              eyebrow="What you get"
              title="Everything you need, nothing you don't"
            />
            <ol className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
              {FEATURES.map(({ title, text }, i) => (
                <li
                  key={title}
                  className="flex flex-col gap-2 bg-background p-6"
                >
                  <span className="eyebrow text-accent-deep">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="display text-[26px]">{title}</h3>
                  <p className="text-sm leading-relaxed text-fg-secondary">
                    {text}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-20 sm:px-8 lg:grid-cols-[1fr_2fr]">
            <SectionTitle eyebrow="Setup" title="Up and running in a minute" />
            <div className="grid gap-10 md:grid-cols-2">
              <ol className="flex flex-col">
                {STEPS.map((st, i) => (
                  <li
                    key={st.title}
                    className="flex gap-5 border-b py-5 first:pt-0 last:border-0"
                  >
                    <span className="display text-[36px] text-accent-deep">
                      {i + 1}
                    </span>
                    <div className="flex flex-col gap-1">
                      <h3 className="font-medium">{st.title}</h3>
                      <p className="text-sm text-fg-secondary">{st.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="flex flex-col justify-center gap-3">
                <Code>
                  <span className="opacity-55">{"<!-- in <head> -->"}</span>
                  {"\n"}
                  {'<script defer src="https://t.example.com/api/script.js"'}
                  {"\n"}
                  {'        data-site="SITE_ID"></script>'}
                </Code>
                <Code>
                  <span className="opacity-55">{"<!-- a goal -->"}</span>
                  {"\n"}
                  {'<button data-track="signup">Sign up</button>'}
                </Code>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto flex max-w-[1200px] flex-col items-start gap-5 px-4 py-20 sm:px-8">
            <p className="eyebrow">Your data, your server</p>
            <p className="display max-w-[22ch] text-[36px] text-balance sm:text-[48px]">
              One small Go binary and a SQLite file.{" "}
              <span className="text-fg-muted">Nothing shared with anyone.</span>
            </p>
            <p className="max-w-[56ch] text-fg-secondary">
              Backed up continuously. It runs for close to nothing on Cloud Run,
              a VPS or a Raspberry Pi.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-2 px-4 py-6 text-[11px] text-fg-muted sm:px-8">
          <span>
            mlz<span className="text-accent-deep">.</span> analytics —
            self-hosted, open source
          </span>
          <span>IP geolocation by DB-IP (CC BY 4.0)</span>
        </div>
      </footer>
    </div>
  )
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="display max-w-[14ch] text-[40px] text-balance sm:text-[48px]">
        {title}
      </h2>
    </div>
  )
}

function Code({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg border bg-surface-2 p-4 font-mono text-xs leading-relaxed text-fg">
      <code>{children}</code>
    </pre>
  )
}

/** A static picture of the dashboard, so visitors know what they will get. Not real data. */
function DashboardPreview() {
  const values = [42, 48, 45, 60, 55, 50, 64, 70, 66, 61, 75, 82, 78, 90]
  const prev = [38, 40, 44, 41, 47, 45, 50, 52, 49, 55, 54, 58, 60, 62]
  const w = 400
  const h = 120
  const toPts = (vs: number[]) =>
    vs
      .map(
        (v, i) =>
          `${((i / (vs.length - 1)) * w).toFixed(1)},${(h - (v / 100) * h).toFixed(1)}`
      )
      .join(" ")
  const pts = toPts(values)
  return (
    <div
      aria-hidden
      className="pointer-events-none overflow-hidden rounded-xl border border-border-strong bg-surface shadow-(--shadow-pop) select-none"
    >
      <div className="flex items-center justify-between border-b px-5 py-4">
        <span className="display text-[26px]">example.com</span>
        <span className="eyebrow flex items-center gap-2 text-fg">
          <span className="size-1.5 rounded-full bg-accent-deep" />
          12 online
        </span>
      </div>
      <div className="grid grid-cols-3 border-b">
        {[
          ["Visitors", "2,481", "▲ +18%"],
          ["Page views", "6,904", "▲ +12%"],
          ["Bounce", "41%", "▼ −4%"],
        ].map(([label, value, delta], i) => (
          <div
            key={label}
            className={"flex flex-col gap-2 p-4 " + (i < 2 ? "border-r" : "")}
          >
            <span className="eyebrow">{label}</span>
            <span className="figure text-[26px]">{value}</span>
            <span className="text-[11px] text-accent-deep">{delta}</span>
          </div>
        ))}
      </div>
      <div className="px-5 pt-5">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-28 w-full"
          preserveAspectRatio="none"
        >
          <polygon
            points={`0,${h} ${pts} ${w},${h}`}
            fill="var(--accent)"
            opacity={0.16}
          />
          <polyline
            points={toPts(prev)}
            fill="none"
            stroke="var(--fg-muted)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={pts}
            fill="none"
            stroke="var(--accent-deep)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="flex flex-col p-5 text-[13px]">
        {[
          ["google.com", 82, "1,204"],
          ["news.ycombinator.com", 54, "788"],
          ["github.com", 31, "452"],
        ].map(([name, pct, n], i) => (
          <div key={name} className="flex h-8 items-center gap-2">
            <span className="w-6 text-[11px] text-fg-muted">0{i + 1}</span>
            <span className="relative flex h-full flex-1 items-center">
              <span
                className="absolute inset-y-1 left-0 rounded-r-sm border-l-2 border-accent-deep bg-violet/15"
                style={{ width: `${pct}%` }}
              />
              <span className="relative px-2">{name}</span>
            </span>
            <span className="tnum w-12 text-right">{n}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  )
}
