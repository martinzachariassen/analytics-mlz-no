// "Lumen", the fictional product analytics SaaS the demo shows: a marketing site with a
// blog, docs on their own hostname, campaigns, launches and sign-ups. Domains end in
// .example (reserved, RFC 2606), so no real site is implied.

import type { Page, Profile, Rng, Source, Weighted } from "./generate"

export const LUMEN_HOST = "lumen.example"
const DOCS = "docs.lumen.example"

const blog = (slug: string, since: number, seo: number, buzz = 3): Page => ({
  path: `/blog/${slug}`,
  kind: "post",
  dwell: [70, 320],
  since,
  seo,
  buzz,
})
const docs = (path: string, seo: number, since?: number): Page => ({
  path,
  host: DOCS,
  kind: "docs",
  dwell: [35, 210],
  seo,
  since,
})
const page = (
  path: string,
  kind: string,
  seo: number,
  dwell: readonly [number, number] = [15, 70],
  since?: number
): Page => ({ path, kind, seo, dwell, since })

const PAGES: Page[] = [
  page("/", "home", 14, [12, 60]),
  page("/pricing", "pricing", 5, [30, 110]),
  page("/features", "features", 2),
  page("/features/dashboards", "features", 2),
  page("/features/funnels", "features", 1.6),
  page("/features/alerts", "features", 0.9),
  page("/features/realtime", "features", 0.8, [15, 70], 95),
  page("/integrations", "features", 1),
  page("/integrations/slack", "features", 1.2),
  page("/integrations/stripe", "features", 1),
  page("/integrations/segment", "features", 0.8),
  page("/integrations/zapier", "features", 0.6),
  page("/integrations/postgres", "features", 0.7),
  page("/customers", "customers", 0.8),
  page("/customers/northwind", "customers", 0.4, [40, 180]),
  page("/customers/fernhill-books", "customers", 0.3, [40, 180]),
  page("/customers/orbit-labs", "customers", 0.3, [40, 180], 160),
  page("/compare/google-analytics", "compare", 4, [40, 160]),
  page("/compare/mixpanel", "compare", 2.2, [40, 160]),
  page("/compare/amplitude", "compare", 1.4, [40, 160], 140),
  page("/changelog", "changelog", 0.8, [20, 120]),
  page("/about", "company", 0.4),
  page("/careers", "company", 0.4),
  page("/contact", "contact", 0.3, [20, 90]),
  page("/demo", "demo", 0.2, [25, 100]),
  page("/security", "legal", 0.3),
  page("/privacy", "legal", 0.3),
  page("/terms", "legal", 0.2),
  page("/signup", "signup", 0.3, [30, 120]),
  page("/login", "login", 1.5, [5, 25]),
  page("/blog", "blogindex", 0.6, [10, 45]),

  blog("introducing-lumen", 720, 0.5),
  blog("why-we-built-lumen", 690, 0.7),
  blog("what-is-bounce-rate", 600, 2.2, 1),
  blog("how-we-price-lumen", 560, 0.6),
  blog("event-tracking-best-practices", 520, 1.6, 1.5),
  blog("funnels-without-cookies", 480, 1.1),
  blog("utm-parameters-guide", 450, 2.4, 1),
  blog("sqlite-in-production", 410, 1.2, 4),
  blog("privacy-first-analytics-and-gdpr", 380, 1.4),
  blog("dashboards-for-founders", 330, 0.8),
  blog("ga4-alternatives", 300, 1.9, 2),
  blog("building-an-sdk-in-go", 260, 0.7),
  blog("postmortem-api-latency", 245, 0.4, 2),
  blog("introducing-lumen-2", 200, 0.8, 4),
  blog("hiring-our-first-engineer", 180, 0.25),
  blog("designing-dark-mode", 150, 0.6),
  blog("realtime-at-scale", 95, 0.6, 2),
  blog("product-hunt-launch-recap", 63, 0.4, 2),
  blog("ingest-v3-is-here", 45, 0.25, 1.5),
  blog("why-we-left-kubernetes", 22, 0.9, 3),
  blog("funnels-2", 15, 0.25, 1.5),
  blog("self-hosting-lumen", 9, 0.8, 3),

  docs("/getting-started", 10),
  docs("/install", 5),
  docs("/sdk/javascript", 7),
  docs("/sdk/react", 5),
  docs("/sdk/python", 4),
  docs("/sdk/go", 3),
  docs("/sdk/ios", 1.2),
  docs("/api", 4.5),
  docs("/api/authentication", 3),
  docs("/api/events", 4),
  docs("/api/webhooks", 2.2),
  docs("/guides/funnels", 2.6),
  docs("/guides/alerts", 1.6),
  docs("/guides/dashboards", 2.2),
  docs("/guides/migrating-from-mixpanel", 1.8),
  docs("/guides/migrating-from-ga4", 2.8, 300),
  docs("/self-hosting", 2.6),
  docs("/faq", 1.8),
]

const src = (
  ref: string,
  land: string,
  extra: Partial<Source> = {}
): Source => ({ ref, land, ...extra })
const utm = (
  ref: string,
  land: string,
  tags: [string, string, string],
  extra: Partial<Source> = {}
): Source => ({ ref: ref || undefined, land, utm: tags, ...extra })

/** Search engines send people to answers: posts, docs, comparisons. */
const SEARCH = "@search"
const AI = "@ai"

// [source, weight, started (days ago), ended (days ago)]
const SOURCES: Profile["sources"] = [
  [{ land: "@direct" }, 26],
  [src("google.com", SEARCH), 34],
  [src("bing.com", SEARCH), 3.5],
  [src("duckduckgo.com", SEARCH), 3],
  [src("search.brave.com", SEARCH), 0.8],
  [src("ecosia.org", SEARCH), 0.6],
  [src("kagi.com", SEARCH), 0.4, 400],
  [src("yandex.ru", SEARCH), 0.3],
  [src("chatgpt.com", AI, { intent: 1.6 }), 3.2, 520],
  [src("perplexity.ai", AI, { intent: 1.4 }), 1, 420],
  [src("claude.ai", AI, { intent: 1.5 }), 0.8, 300],
  [src("gemini.google.com", AI), 0.5, 240],
  [src("github.com", "@devdocs", { stay: 1.2 }), 4.5],
  [src("stackoverflow.com", "@apidocs", { stay: 0.8 }), 1.5],
  [src("linkedin.com", "@posts", { mobile: 1.8 }), 2.6],
  [src("t.co", "@posts", { mobile: 1.8, stay: 0.7 }), 1.5],
  [src("bsky.app", "@posts", { mobile: 1.6 }), 0.9, 380],
  [src("mastodon.social", "@posts", { mobile: 1.4 }), 0.7],
  [src("reddit.com", "@posts", { mobile: 1.7, stay: 0.7 }), 1.8],
  [src("news.ycombinator.com", "@posts", { stay: 0.6 }), 1],
  [src("lobste.rs", "@posts", { stay: 0.7 }), 0.3],
  [src("youtube.com", "/", { mobile: 1.5 }), 0.7],
  [src("dev.to", "@posts"), 0.6],
  [src("medium.com", "@posts"), 0.4],
  [src("g2.com", "@review", { intent: 2.2 }), 0.7],
  [src("capterra.com", "@review", { intent: 2 }), 0.35],
  [src("alternativeto.net", "@review", { intent: 1.6 }), 0.7],
  [src("producthunt.com", "/", { intent: 1.3 }), 0.4, 70],
  [src("slack.com", "/integrations/slack", { intent: 1.4 }), 0.5],
  [src("zapier.com", "/integrations/zapier"), 0.3],
  [utm("google.com", "/", ["google", "cpc", "brand"], { intent: 1.8 }), 1.4],
  [
    utm(
      "google.com",
      "/compare/google-analytics",
      ["google", "cpc", "analytics-alternative"],
      { intent: 1.5, stay: 0.8 }
    ),
    1.6,
    120,
  ],
  [
    utm(
      "linkedin.com",
      "/features/dashboards",
      ["linkedin", "paid-social", "awareness-dashboards"],
      { stay: 0.6, mobile: 1.6 }
    ),
    0.9,
    45,
  ],
  [
    utm(
      "",
      "/integrations/stripe",
      ["partner", "referral", "stripe-app-marketplace"],
      { intent: 1.6 }
    ),
    0.35,
    330,
  ],
  [
    utm("", "@onboarding", ["lumen", "email", "onboarding"], { stay: 1.3 }),
    1.1,
  ],
  [utm("", "/pricing", ["lumen", "email", "trial-ending"], { intent: 3 }), 0.4],
]

const newsletter = (daysAgo: number, campaign: string, land: string) => ({
  daysAgo,
  amp: 0.1,
  decay: 0.8,
  source: utm("", land, ["newsletter", "email", campaign], { stay: 1.1 }),
})

const SPIKES: Profile["spikes"] = [
  {
    daysAgo: 410,
    amp: 1.6,
    decay: 0.9,
    source: src("news.ycombinator.com", "/blog/sqlite-in-production", {
      stay: 0.45,
    }),
    countries: [
      ["US", 45],
      ["GB", 8],
      ["DE", 8],
      ["CA", 6],
      ["IN", 6],
      ["NL", 4],
      ["FR", 4],
      ["SE", 3],
      ["AU", 3],
    ],
  },
  {
    daysAgo: 200,
    amp: 0.9,
    decay: 2.5,
    source: src("t.co", "/blog/introducing-lumen-2", {
      mobile: 1.6,
      intent: 1.3,
    }),
  },
  newsletter(200, "lumen-2-launch", "/blog/introducing-lumen-2"),
  {
    daysAgo: 70,
    amp: 2.4,
    decay: 1.4,
    source: src("producthunt.com", "/", { intent: 1.6, mobile: 1.3 }),
    countries: [
      ["US", 40],
      ["IN", 10],
      ["GB", 7],
      ["DE", 5],
      ["CA", 5],
      ["FR", 4],
      ["BR", 4],
      ["ES", 3],
      ["NL", 3],
    ],
  },
  {
    daysAgo: 19,
    amp: 2.8,
    decay: 0.8,
    source: src("news.ycombinator.com", "/blog/why-we-left-kubernetes", {
      stay: 0.4,
    }),
    countries: [
      ["US", 45],
      ["GB", 8],
      ["DE", 8],
      ["CA", 6],
      ["IN", 5],
      ["NL", 4],
      ["FR", 4],
      ["SE", 3],
      ["AU", 3],
      ["NO", 2],
    ],
  },
  {
    daysAgo: 5,
    amp: 0.4,
    decay: 1,
    source: src("reddit.com", "/blog/self-hosting-lumen", {
      mobile: 1.8,
      stay: 0.6,
    }),
  },
  newsletter(45, "product-update-ingest-v3", "/blog/ingest-v3-is-here"),
  newsletter(15, "product-update-funnels", "/blog/funnels-2"),
]

// A weekly digest goes out every Tuesday for the last 40 weeks.
for (let w = 0; w < 40; w++) {
  SPIKES.push(newsletter(6 + w * 7, "weekly-digest", "@posts"))
}

const NEXT: Profile["next"] = {
  home: [
    ["/pricing", 25],
    ["@features", 22],
    ["/signup", 5],
    ["@devdocs", 9],
    ["/customers", 6],
    ["/blog", 6],
    ["/login", 6],
    ["@integrations", 8],
    ["/demo", 2],
    ["/changelog", 3],
  ],
  pricing: [
    ["/signup", 15],
    ["@features", 14],
    ["/", 8],
    ["/demo", 7],
    ["/contact", 5],
    ["/customers", 6],
    ["@devdocs", 8],
    ["/compare/google-analytics", 4],
    ["/security", 3],
  ],
  features: [
    ["/pricing", 30],
    ["@features", 20],
    ["@integrations", 12],
    ["/signup", 4],
    ["@devdocs", 10],
    ["/customers", 6],
    ["/", 8],
  ],
  compare: [
    ["/pricing", 34],
    ["/signup", 7],
    ["@features", 18],
    ["/", 14],
    ["@compare", 8],
    ["@devdocs", 6],
  ],
  customers: [
    ["@customers", 30],
    ["/pricing", 25],
    ["/signup", 5],
    ["/demo", 8],
    ["/", 15],
  ],
  post: [
    ["/blog", 18],
    ["@posts", 22],
    ["/", 20],
    ["/pricing", 12],
    ["/signup", 3],
    ["@devdocs", 8],
    ["@features", 8],
  ],
  blogindex: [
    ["@posts", 85],
    ["/", 10],
    ["/pricing", 5],
  ],
  docs: [
    ["@docs", 86],
    ["/pricing", 5],
    ["/signup", 2],
    ["/changelog", 4],
  ],
  changelog: [
    ["@posts", 15],
    ["@docs", 30],
    ["/", 25],
    ["/pricing", 15],
    ["/login", 15],
  ],
  company: [
    ["/careers", 15],
    ["/about", 15],
    ["/", 40],
    ["/customers", 15],
    ["/pricing", 15],
  ],
  demo: [
    ["/pricing", 50],
    ["/", 50],
  ],
  contact: [
    ["/", 60],
    ["/pricing", 40],
  ],
  legal: [
    ["/", 50],
    ["/pricing", 30],
    ["/security", 20],
  ],
  "*": [["/", 1]],
}

const STAY: Profile["stay"] = {
  home: 0.6,
  pricing: 0.62,
  features: 0.58,
  compare: 0.52,
  customers: 0.55,
  post: 0.32,
  blogindex: 0.8,
  docs: 0.7,
  changelog: 0.45,
  company: 0.4,
  demo: 0.3,
  contact: 0.25,
  legal: 0.25,
  signup: 0,
  login: 0,
}

const GROUPS: Profile["groups"] = {
  "@direct": (p) =>
    ["home", "login", "pricing", "changelog"].includes(p.kind) ||
    (p.kind === "docs" && (p.seo ?? 0) > 3),
  [SEARCH]: (p) =>
    ["post", "docs", "compare", "home", "features", "pricing"].includes(p.kind),
  [AI]: (p) =>
    ["home", "compare", "pricing", "docs", "features"].includes(p.kind),
  "@posts": (p) => p.kind === "post",
  "@docs": (p) => p.kind === "docs",
  "@devdocs": (p) =>
    p.kind === "docs" &&
    /^\/(getting-started|install|sdk|self-hosting)/.test(p.path),
  "@apidocs": (p) => p.kind === "docs" && /^\/(api|sdk|faq)/.test(p.path),
  "@features": (p) => p.kind === "features" && p.path.startsWith("/features"),
  "@integrations": (p) => p.path.startsWith("/integrations/"),
  "@customers": (p) => p.path.startsWith("/customers/"),
  "@compare": (p) => p.kind === "compare",
  "@review": (p) =>
    ["home", "pricing", "customers", "compare"].includes(p.kind),
  "@onboarding": (p) =>
    p.kind === "login" ||
    (p.kind === "docs" && /^\/(getting-started|install|guides)/.test(p.path)),
}

const pick = <T>(r: Rng, w: Weighted<T>) => r.pick(w)

const OUTBOUND_DOCS: Weighted<string> = [
  ["https://github.com/lumen-example/lumen-js", 5],
  ["https://www.npmjs.com/package/@lumen-example/sdk", 4],
  ["https://pypi.org/project/lumen-example", 2],
  ["https://pkg.go.dev/lumen.example/go", 1.5],
  ["https://github.com/lumen-example/lumen-self-hosted", 2],
]
const OUTBOUND_SITE: Weighted<string> = [
  ["https://github.com/lumen-example", 4],
  ["https://www.linkedin.com/company/lumen-example", 2],
  ["https://x.com/lumen_example", 1.5],
  ["https://bsky.app/profile/lumen.example", 1],
  ["https://status.lumen.example", 1.2],
]

const EVENTS: Profile["events"] = (r, p, visit) => {
  const out: [string, Record<string, string>][] = []
  switch (p.kind) {
    case "signup":
      if (!visit.signedUp && r.chance(0.44)) {
        visit.signedUp = true
        const plan = pick(r, [
          ["free", 62],
          ["pro", 28],
          ["team", 10],
        ])
        out.push([
          "signup",
          {
            plan,
            method: pick(r, [
              ["email", 45],
              ["google", 35],
              ["github", 20],
            ]),
          },
        ])
        if (plan !== "free" && r.chance(0.85)) {
          out.push(["trial-started", { plan }])
        }
      }
      break
    case "pricing":
      if (r.chance(0.08)) {
        out.push([
          "pricing-toggle",
          {
            billing: pick(r, [
              ["yearly", 65],
              ["monthly", 35],
            ]),
          },
        ])
      }
      if (r.chance(0.011 * (visit.source.intent ?? 1))) {
        out.push([
          "checkout",
          {
            plan: pick(r, [
              ["pro", 65],
              ["team", 30],
              ["enterprise", 5],
            ]),
            billing: pick(r, [
              ["monthly", 58],
              ["yearly", 42],
            ]),
          },
        ])
      }
      break
    case "demo":
      if (r.chance(0.28)) {
        out.push([
          "demo-requested",
          {
            company_size: pick(r, [
              ["1-10", 30],
              ["11-50", 35],
              ["51-200", 20],
              ["201-1000", 10],
              ["1000+", 5],
            ]),
          },
        ])
      }
      break
    case "contact":
      if (r.chance(0.18)) {
        out.push([
          "contact-submit",
          {
            topic: pick(r, [
              ["sales", 40],
              ["support", 35],
              ["partnership", 15],
              ["press", 10],
            ]),
          },
        ])
      }
      break
    case "post":
      if (r.chance(0.018)) {
        out.push([
          "newsletter-signup",
          {
            position: pick(r, [
              ["inline", 60],
              ["footer", 40],
            ]),
          },
        ])
      }
      if (r.chance(0.06)) {
        out.push(["outbound-link", { url: pick(r, OUTBOUND_SITE) }])
      }
      break
    case "docs":
      if (r.chance(0.14)) {
        out.push([
          "copy-code",
          {
            lang: pick(r, [
              ["javascript", 38],
              ["curl", 22],
              ["python", 18],
              ["go", 12],
              ["bash", 10],
            ]),
          },
        ])
      }
      if (r.chance(0.1)) {
        out.push([
          "docs-search",
          {
            has_results: pick(r, [
              ["true", 86],
              ["false", 14],
            ]),
          },
        ])
      }
      if (r.chance(0.04)) {
        out.push(["outbound-link", { url: pick(r, OUTBOUND_DOCS) }])
      }
      break
    case "home":
      if (r.chance(0.05)) {
        out.push([
          "video-play",
          {
            video: pick(r, [
              ["product-tour", 70],
              ["customer-story", 30],
            ]),
          },
        ])
      }
      if (r.chance(0.02)) {
        out.push(["outbound-link", { url: pick(r, OUTBOUND_SITE) }])
      }
      break
  }
  return out
}

export const LUMEN: Profile = {
  hostname: LUMEN_HOST,
  visitsNow: 950,
  visitsThen: 330,
  pages: PAGES,
  sources: SOURCES,
  spikes: SPIKES,
  next: NEXT,
  stay: STAY,
  groups: GROUPS,
  events: EVENTS,
}

export const LUMEN_GOALS: [kind: "event" | "path", value: string][] = [
  ["event", "signup"],
  ["event", "trial-started"],
  ["event", "checkout"],
  ["event", "demo-requested"],
  ["path", "/pricing"],
  ["path", "/blog/*"],
]

/** The status page: quiet, until something breaks. */
export const STATUS: Profile = {
  hostname: "status.lumen.example",
  visitsNow: 45,
  visitsThen: 12,
  pages: [
    page("/", "status", 10, [8, 40]),
    page("/history", "status", 1, [10, 60]),
    page("/incidents/api-latency", "incident", 0.2, [30, 150], 245),
    page("/incidents/delayed-ingest", "incident", 0.2, [30, 150], 33),
    page("/subscribe", "status", 0.3, [10, 40]),
  ],
  sources: [
    [{ land: "/" }, 55],
    [src(LUMEN_HOST, "/"), 20],
    [src("docs.lumen.example", "/"), 6],
    [src("google.com", "/"), 8],
    [src("github.com", "/"), 4],
    [src("t.co", "/", { mobile: 1.8 }), 2],
    [utm("", "/", ["lumen", "email", "incident"]), 3],
  ],
  spikes: [
    {
      daysAgo: 245,
      amp: 7,
      decay: 0.7,
      source: src("t.co", "/incidents/api-latency", { mobile: 1.6 }),
    },
    {
      daysAgo: 33,
      amp: 4,
      decay: 0.6,
      source: utm("", "/incidents/delayed-ingest", [
        "lumen",
        "email",
        "incident",
      ]),
    },
  ],
  next: {
    status: [
      ["/history", 60],
      ["/subscribe", 25],
      ["/", 15],
    ],
    incident: [
      ["/", 60],
      ["/history", 40],
    ],
    "*": [["/", 1]],
  },
  stay: { status: 0.25, incident: 0.35 },
  groups: {},
  events: (r, p) =>
    p.path === "/subscribe" && r.chance(0.3)
      ? [
          [
            "status-subscribe",
            {
              channel: r.pick([
                ["email", 60],
                ["rss", 25],
                ["slack", 15],
              ]),
            },
          ],
        ]
      : [],
}

export const STATUS_GOALS: [kind: "event" | "path", value: string][] = [
  ["event", "status-subscribe"],
]
