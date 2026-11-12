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
  await expect(page.getByRole("link", { name: /Demo blog/ })).toBeVisible()
  await expect(page.getByRole("link", { name: /Demo docs/ })).toBeVisible()
  await expectAccessible(page)
})

test("overview shows numbers and survives a filter round trip", async ({
  page,
}) => {
  await openSite(page, "Demo blog")
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
  const base = await openSite(page, "Demo blog")
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
    const base = await openSite(page, "Demo docs")
    await page.goto(`${base}/${view}`)
    await expect(page.locator("main")).toBeVisible()
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("alert")).toHaveCount(0)
    await expectAccessible(page)
    expect(errors).toEqual([])
  })
}

test("settings shows the tracking code", async ({ page }) => {
  const base = await openSite(page, "Demo docs")
  await page.goto(`${base}/settings`)
  await expect(page.getByText("Tracking code")).toBeVisible()
  await expect(page.locator("pre").first()).toContainText("data-site")
  await expectAccessible(page)
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
  await openSite(page, "Demo docs")
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

  await expect(page).toHaveURL(/\/settings\?new=1$/)
  const status = page.getByRole("status").filter({ hasText: "Waiting" })
  await expect(status).toContainText("Site added. Waiting for the first event")
  await expectAccessible(page)
  const siteId = new URL(page.url()).pathname.split("/")[2]!

  await page.goto(`/sites/${siteId}`)
  await expect(page.getByText(`No data for ${domain} yet`)).toBeVisible()
  await expectAccessible(page)

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
  await expect(page.getByText(`No data for ${domain} yet`)).toBeHidden({
    timeout: 15_000,
  })
  await expect(page.getByText("Visitors").first()).toBeVisible()
})
