import { expect, test as setup } from "@playwright/test"

import { SESSION, SESSION_LIGHT } from "./paths.ts"

setup("sign in with the dev login", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("link", { name: "Open demo dashboard" }).click()
  await expect(page).toHaveURL(/\/sites$/)
  await page.context().storageState({ path: SESSION })

  await page.evaluate(() => localStorage.setItem("theme", "light"))
  await page.context().storageState({ path: SESSION_LIGHT })
})
