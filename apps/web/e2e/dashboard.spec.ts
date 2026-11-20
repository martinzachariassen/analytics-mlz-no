import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

/** Fails on serious and critical WCAG 2.1 AA violations on the current page. */
async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  const blocking = violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical"
  )
  expect(
    blocking.map(
      (v) =>
        `${v.id}: ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(" ")} — ${n.failureSummary?.split("\n").slice(1).join(" ")}`).join("\n")}`
    )
  ).toEqual([])
}

/** Opens a demo site's overview from the site list; returns its base path. */
async function openSite(page: Page, name: string) {
  await page.goto("/sites")
  await page.getByRole("link", { name: new RegExp(name) }).click()
  await expect(page).toHaveURL(/\/sites\/[^/?]+(\?.*)?$/)
  return new URL(page.url()).pathname
}

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("the landing page offers sign-in and is accessible", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(
      page.getByRole("link", { name: "Open demo dashboard" })
    ).toBeVisible()
    await expectAccessible(page)
  })

  test("the dashboard sends signed-out visitors home", async ({ page }) => {
    await page.goto("/sites")
    await expect(page).toHaveURL(/\/$/)
  })
})

test("the site list shows the demo sites", async ({ page }) => {
  await page.goto("/sites")
  await expect(page.getByRole("link", { name: /Fjord Labs Blog/ })).toBeVisible()
  await expect(page.getByRole("link", { name: /Fjord Labs Docs/ })).toBeVisible()
  await expectAccessible(page)
})

test("overview shows numbers and survives a filter round trip", async ({
  page,
}) => {
  await openSite(page, "Fjord Labs Blog")
  await expect(page.getByText("Visitors").first()).toBeVisible()
  await expectAccessible(page)

  await page.getByRole("button", { name: "Filter", exact: true }).click()
  await page.getByRole("option", { name: "Device" }).click()
  await page.getByRole("option").first().click()
  await expect(page).toHaveURL(/[?&]f=device%3Ais%3A/)

  await page.getByLabel("Remove filter").click()
  await expect(page).not.toHaveURL(/[?&]f=/)
})

test("a report row opens the detail sheet, which can filter the dashboard", async ({
  page,
}) => {
  const base = await openSite(page, "Fjord Labs Blog")
  await page.goto(`${base}/pages`)
  await expect(page.getByRole("row").nth(1)).toBeVisible()
  await expectAccessible(page)

  await page.getByRole("row").nth(1).getByRole("button").first().click()
  const sheet = page.getByRole("dialog")
  await expect(sheet).toBeVisible()
  await expectAccessible(page)

  await sheet.getByRole("button", { name: "Filter dashboard by this" }).click()
  await expect(sheet).toBeHidden()
  await expect(page).toHaveURL(/[?&]f=path%3Ais%3A/)
  await expect(page).not.toHaveURL(/[?&]detail=/)
})

for (const view of ["realtime", "sources", "locations", "devices", "events"]) {
  test(`the ${view} view renders and is accessible`, async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    const base = await openSite(page, "Fjord Labs Docs")
    await page.goto(`${base}/${view}`)
    await expect(page.locator("main")).toBeVisible()
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("alert")).toHaveCount(0)
    await expectAccessible(page)
    expect(errors).toEqual([])
  })
}

test("settings shows the tracking code", async ({ page }) => {
  const base = await openSite(page, "Fjord Labs Docs")
  await page.goto(`${base}/settings`)
  await expect(
    page.getByRole("navigation", { name: "Settings" })
  ).toBeVisible()
  await expect(page.getByText("Tracking code").first()).toBeVisible()
  await expect(page.locator("pre").first()).toContainText("data-site")
  await expectAccessible(page)
})

test("the overview shows conversions for the seeded goals", async ({
  page,
}) => {
  await openSite(page, "Fjord Labs Blog")
  const goals = page.getByTitle("Filter by this goal").filter({
    hasText: "newsletter-signup",
  })
  await expect(goals).toBeVisible()
  await expect(goals).toContainText("%")
  await expectAccessible(page)

  await goals.click()
  await expect(page).toHaveURL(/[?&]f=event%3Ais%3Anewsletter-signup/)
})

test("goals can be added and removed in settings", async ({ page }) => {
  const base = await openSite(page, "Fjord Labs Docs")
  await page.goto(`${base}/settings#goals`)
  await page.getByRole("combobox", { name: "Goal type" }).click()
  await page.getByRole("option", { name: "Page" }).click()
  await page.getByLabel("Add a goal").fill("/docs/e2e-goal")
  await page.getByRole("button", { name: "Add", exact: true }).click()
  const remove = page.getByRole("button", {
    name: "Remove goal /docs/e2e-goal",
  })
  await expect(remove).toBeVisible()
  await expectAccessible(page)

  await remove.click()
  await expect(remove).toHaveCount(0)
})

test("a report table exports the filtered rows as CSV", async ({ page }) => {
  const base = await openSite(page, "Fjord Labs Blog")
  await page.goto(`${base}/pages?f=device%3Ais%3Adesktop`)
  const download = page.waitForEvent("download")
  await page.getByRole("link", { name: "Export pages as CSV" }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^localhost-path-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/)
  const stream = await file.createReadStream()
  let csv = ""
  for await (const chunk of stream) csv += chunk
  const [header, first] = csv.split("\n")
  expect(header).toBe(
    "\uFEFFpath,visitors,pageviews,visits,bounce_rate,avg_duration_seconds,previous_visitors"
  )
  expect(first).toMatch(/^\/[^,]*,\d+,\d+,\d+,\d\.\d{4},\d+\.\d,\d+$/)
})

test("a failed panel says so and recovers with Try again", async ({ page }) => {
  let fail = true
  await page.route("**/api/sites/*/heatmap*", (route) =>
    fail
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "database is locked" }),
        })
      : route.fallback()
  )
  await openSite(page, "Fjord Labs Docs")
  const alert = page.getByRole("alert")
  // The query retries 5xx twice with backoff before giving up.
  await expect(alert).toContainText("database is locked", { timeout: 15_000 })
  await expect(alert).toHaveCount(1)

  fail = false
  await page.getByRole("button", { name: "Try again" }).click()
  await expect(alert).toHaveCount(0)
  await expect(page.getByText("Active hours")).toBeVisible()
  await expectAccessible(page)
})

test("a new site waits for its first event, then moves on by itself", async ({
  page,
}, testInfo) => {
  // One site per project and run: the projects share the database, and `seed -reset`
  // keeps sites added by an earlier run.
  const domain = `onboarding-${testInfo.project.name}-${Date.now()}.example`
  await page.goto("/sites")
  await page.getByRole("button", { name: "Add site" }).first().click()
  await page.getByLabel("Domain").fill(domain)
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add site" })
    .click()

  // Adding a site lands on its overview, which waits for the first event.
  await expect(page).toHaveURL(/\/sites\/[^/]+\?new=1$/)
  const status = page.getByRole("status").filter({ hasText: "Waiting" })
  await expect(status).toContainText("Site added. Waiting for the first event")
  await expect(page.getByRole("heading", { name: `Install ${domain}` })).toBeVisible()
  await expectAccessible(page)
  const siteId = new URL(page.url()).pathname.split("/")[2]!

  // What the tracking script sends, straight to the API server (the preview proxy may
  // rewrite headers). A browser user agent, since bots are dropped silently.
  const res = await page.request.post("http://localhost:18080/api/event", {
    headers: {
      "Content-Type": "text/plain",
      Origin: `https://${domain}`,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    data: JSON.stringify({ site: siteId, url: `https://${domain}/` }),
  })
  expect(res.status()).toBe(202)

  // The overview polls the site every 5 seconds and swaps in the dashboard.
  await expect(status).toBeHidden({ timeout: 15_000 })
  await expect(page.getByText("Visitors").first()).toBeVisible()
  await expect(page).not.toHaveURL(/[?&]new=/)
})

test("the tracking pixel can be turned on and records a proxied view", async ({
  page,
}, testInfo) => {
  const domain = `pixel-${testInfo.project.name}-${Date.now()}.example`
  await page.goto("/sites")
  await page.getByRole("button", { name: "Add site" }).first().click()
  await page.getByLabel("Domain").fill(domain)
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add site" })
    .click()
  await expect(page).toHaveURL(/\/sites\/[^/]+\?new=1$/)
  const siteId = new URL(page.url()).pathname.split("/")[2]!
  await page.getByText("Custom events and the tracking pixel").click()
  await page.getByRole("link", { name: "tracking pixel" }).click()
  await expect(page).toHaveURL(/\/settings#pixel$/)

  const pixel = (ua: string) =>
    page.request.get(
      `http://localhost:18080/api/pixel.gif?site=${siteId}&p=/readme`,
      { headers: { "User-Agent": ua } }
    )
  // Off by default: still an image, but nothing is stored.
  const off = await pixel("github-camo (e2e)")
  expect(off.status()).toBe(200)
  expect(off.headers()["content-type"]).toBe("image/gif")

  const toggle = page.getByRole("switch", {
    name: "Accept events from the pixel",
  })
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
  await expect(page.locator("pre").filter({ hasText: "![](" })).toContainText(
    `/api/pixel.gif?site=${siteId}&p=%2Freadme`
  )
  await expectAccessible(page)

  expect((await pixel("github-camo (e2e)")).status()).toBe(200)
  // Settings polls the site while it waits and shows when the first event arrived.
  await expect(
    page.getByRole("status").filter({ hasText: "Waiting" })
  ).toBeHidden({ timeout: 15_000 })
  await expect(page.getByText(/^Last event/)).toBeVisible()
})

/** A site of its own for a test that changes it: the projects share one database. */
async function addSite(page: Page, prefix: string, project: string) {
  const domain = `${prefix}-${project}-${Date.now()}.example`
  await page.goto("/sites")
  await page.getByRole("button", { name: "Add site" }).first().click()
  await page.getByLabel("Domain").fill(domain)
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add site" })
    .click()
  await expect(page).toHaveURL(/\/sites\/[^/]+\?new=1$/)
  return { domain, id: new URL(page.url()).pathname.split("/")[2]! }
}

test("the period, comparison and interval controls change the view", async ({
  page,
}) => {
  await openSite(page, "Fjord Labs Blog")

  await page.getByRole("button", { name: "Last 7 days", exact: true }).click()
  await page.getByRole("button", { name: /^Last 30 days/ }).click()
  await expect(page).toHaveURL(/[?&]period=30d/)

  // Picked in the calendar: the 1st to the 3rd of the month shown.
  await page.getByRole("button", { name: "Last 30 days", exact: true }).click()
  const calendar = page.getByRole("dialog")
  const days = calendar.getByRole("gridcell").getByRole("button")
  await days.filter({ hasText: /^1$/ }).first().click()
  await days.filter({ hasText: /^3$/ }).first().click()
  await calendar.getByRole("button", { name: "Apply" }).click()
  await expect(page).toHaveURL(/[?&]period=custom&from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-03/)

  // The comparison picker is there on phones too.
  await page.getByRole("combobox", { name: "Compare with" }).click()
  await page.getByRole("option", { name: "Year over year" }).click()
  await expect(page).toHaveURL(/[?&]compare=year/)

  await page.goto(`${new URL(page.url()).pathname}?period=30d`)
  await page.getByRole("combobox", { name: "Interval" }).first().click()
  await page.getByRole("option", { name: "Weekly" }).click()
  await expect(page).toHaveURL(/[?&]interval=week/)
  await expect(page.getByText("Visitors").first()).toBeVisible()
  await expectAccessible(page)
})

test("the overview groups its reports and keeps card tabs in the URL", async ({
  page,
}) => {
  await openSite(page, "Fjord Labs Blog")
  for (const name of [
    "Content and acquisition",
    "Conversions",
    "Audience",
    "Technology and time",
  ])
    await expect(page.getByRole("region", { name })).toBeVisible()

  await page.getByRole("tab", { name: "Entry" }).click()
  await expect(page).toHaveURL(/[?&]pages_tab=entry/)
  await page.reload()
  await expect(page.getByRole("tab", { name: "Entry" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
})

test("the main chart exports its time series as CSV", async ({ page }) => {
  await openSite(page, "Fjord Labs Blog")
  const download = page.waitForEvent("download")
  await page.getByRole("link", { name: "Export the time series as CSV" }).click()
  const file = await download
  let csv = ""
  for await (const chunk of await file.createReadStream()) csv += chunk
  const [header, first] = csv.split("\n")
  // The default period compares with the one before it.
  expect(header).toBe(
    "\uFEFFstart,pageviews,visitors,visits,bounce_rate,avg_duration_seconds,previous_start,previous_pageviews,previous_visitors,previous_visits,previous_bounce_rate,previous_avg_duration_seconds"
  )
  expect(first).toMatch(/^\d{4}-\d{2}-\d{2}T/)
})

test("a site can be renamed and deleted", async ({ page }, testInfo) => {
  const { domain, id } = await addSite(page, "settings", testInfo.project.name)
  await page.goto(`/sites/${id}/settings#general`)

  await page.getByLabel("Name").fill(`Renamed ${testInfo.project.name}`)
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page.getByText("Site updated")).toBeVisible()
  await page.reload()
  await expect(page.getByLabel("Name")).toHaveValue(
    `Renamed ${testInfo.project.name}`
  )

  await page.getByRole("button", { name: "Delete site" }).click()
  const confirm = page.getByRole("alertdialog")
  await expect(confirm).toContainText(`Delete Renamed ${testInfo.project.name}?`)
  await expectAccessible(page)
  await confirm.getByRole("button", { name: "Delete" }).click()
  await expect(page).toHaveURL(/\/sites$/)
  await expect(page.getByText(domain)).toHaveCount(0)
  const gone = await page.request.get(`/api/sites/${id}`)
  expect(gone.status()).toBe(404)
})

test("keyboard: shortcut help, ⌘K and theme", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcuts need a keyboard")
  await openSite(page, "Fjord Labs Blog")
  await expect(page.getByText("Visitors").first()).toBeVisible()

  await page.keyboard.press("?")
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" })
  await expect(help).toContainText("Toggle the comparison")
  await expectAccessible(page)
  await page.keyboard.press("Escape")

  await page.keyboard.press("ControlOrMeta+k")
  await page.getByPlaceholder("Go to a view, site or period…").fill("year over")
  await page.getByRole("option", { name: "Compare year over year" }).click()
  await expect(page).toHaveURL(/[?&]compare=year/)
  await expect(page.getByRole("dialog")).toHaveCount(0)

  const theme = await page.locator("html").getAttribute("data-theme")
  await page.keyboard.press("d")
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", theme!)
})

test("the user menu switches the theme", async ({ page, isMobile }) => {
  await openSite(page, "Fjord Labs Blog")
  if (isMobile) await page.getByRole("button", { name: "Toggle Sidebar" }).first().click()
  const theme = await page.locator("html").getAttribute("data-theme")
  await page.getByRole("button", { name: /Local demo/ }).click()
  await page
    .getByRole("menuitem", { name: theme === "dark" ? /Light mode/ : /Dark mode/ })
    .click()
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    theme === "dark" ? "light" : "dark"
  )
})

test.describe("own session", () => {
  // Signing out revokes the session, so this test must not share the stored one.
  test.use({ storageState: { cookies: [], origins: [] } })

  test("signing out ends the session", async ({ page, isMobile }) => {
    await page.goto("/")
    await page.getByRole("link", { name: "Open demo dashboard" }).click()
    await expect(page).toHaveURL(/\/sites$/)
    if (isMobile)
      await page.getByRole("button", { name: "Toggle Sidebar" }).first().click()
    await page.getByRole("button", { name: /Local demo/ }).click()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/$/)
    expect((await page.request.get("/api/auth/me")).status()).toBe(401)
    await page.goto("/sites")
    await expect(page).toHaveURL(/\/$/)
  })
})

test("the real tracking script records a page view and an event", async ({
  page,
}, testInfo) => {
  // The tracker stays quiet in automated browsers and headless user agents, which is right
  // for real sites; here it has to run.
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false })
  )
  const sites = await (await page.request.get("/api/sites")).json()
  const blog = sites.find((s: { domain: string }) => s.domain === "localhost")
  const path = `/e2e-tracker-${testInfo.project.name}-${Date.now()}`
  const event = `e2e-click-${testInfo.project.name}`
  // A page "on" the blog's domain (localhost), served by the test itself on the API server's
  // origin: Chrome blocks a page it did not load from a loopback address from reaching one.
  const origin = "http://localhost:18080"
  await page.route(`${origin}${path}`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><title>Tracker test</title>
<script defer src="${origin}/api/script.js" data-site="${blog.id}" data-allow-localhost="true"></script>
</head><body><button data-mlz-event="${event}" data-mlz-event-plan="pro">Sign up</button></body></html>`,
    })
  )
  const sent = page.waitForResponse(
    (r) => r.url() === `${origin}/api/event` && r.request().method() === "POST"
  )
  await page.goto(`${origin}${path}`)
  expect((await sent).status()).toBe(202)

  await expect
    .poll(
      async () => {
        const rt = await (
          await page.request.get(`/api/sites/${blog.id}/realtime?detail=1`)
        ).json()
        return (rt.pages ?? []).map((p: { value: string }) => p.value)
      },
      { timeout: 15_000 }
    )
    .toContain(path)

  const clicked = page.waitForResponse(
    (r) => r.url() === `${origin}/api/event` && r.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Sign up" }).click()
  expect((await clicked).status()).toBe(202)
  const today = new Date().toISOString().slice(0, 10)
  await expect
    .poll(
      async () => {
        const rows = await (
          await page.request.get(
            `/api/sites/${blog.id}/breakdown?dim=event&from=${today}&to=${today}&tz=UTC&limit=100`
          )
        ).json()
        return rows.map((r: { value: string }) => r.value)
      },
      { timeout: 15_000 }
    )
    .toContain(event)
})
