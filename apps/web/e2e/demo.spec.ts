import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

// The public demo build: the real dashboard with /api answered in the browser from
// generated data. Every view must load with numbers, behave like the real thing, and be
// accessible in both themes. Paths are relative to /demo/.

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  expect(
    violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)
  ).toEqual([])
}

/** Waits until no skeleton is left, i.e. every query of the view has answered. */
async function loaded(page: Page) {
  await expect(page.locator("[data-slot=skeleton]")).toHaveCount(0, {
    timeout: 30_000,
  })
}

test("opens on Lumen's overview, with the demo banner", async ({ page }) => {
  await page.goto("./")
  await expect(page).toHaveURL(/\/demo\/sites\/lumen/)
  await expect(page.getByText(/Live demo with made-up traffic/)).toBeVisible()
  await loaded(page)
  await expect(page.getByText("Visitors").first()).toBeVisible()
  await expectAccessible(page)
})

for (const view of ["realtime", "pages", "sources", "locations", "devices", "events"]) {
  test(`the ${view} view loads and is accessible`, async ({ page }) => {
    await page.goto(`sites/lumen/${view}?period=30d`)
    await loaded(page)
    await expect(page.getByText("Something went wrong")).toHaveCount(0)
    await expectAccessible(page)
  })
}

test("the light theme is accessible", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("theme", "light"))
  await page.goto("sites/lumen?period=12m&compare=year")
  await loaded(page)
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  await expectAccessible(page)
})

test("filters, periods and the site list work", async ({ page }) => {
  await page.goto("sites/lumen/pages?period=30d&f=path:is:/pricing")
  await loaded(page)
  await expect(page.getByText("/pricing").first()).toBeVisible()
  await page.goto("sites")
  await loaded(page)
  await expect(page.getByRole("link", { name: /Lumen Status/ })).toBeVisible()
})

test("writes are refused politely", async ({ page }) => {
  await page.goto("sites/lumen")
  await loaded(page)
  const res = await page.evaluate(async () => {
    const r = await fetch("/api/sites/lumen", {
      method: "DELETE",
    })
    return { status: r.status, body: await r.json() }
  })
  expect(res).toEqual({
    status: 403,
    body: { error: "This is a read-only demo" },
  })
})
