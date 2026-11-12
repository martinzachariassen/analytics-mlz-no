// @vitest-environment happy-dom
import { cleanup, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { GoalsCard } from "@/components/goals-card"
import { GoalsSettings } from "@/components/goals-settings"
import type { Goal, GoalStat, GoalStats } from "@/lib/api"
import { mockFetch, renderInSite } from "@/test/render"

afterEach(cleanup)

const stat = (g: Partial<GoalStat>): GoalStat => ({
  id: 1,
  kind: "event",
  value: "newsletter-signup",
  created_at: "2026-11-01T00:00:00Z",
  visitors: 0,
  completions: 0,
  conversion_rate: 0,
  previous_visitors: 0,
  previous_conversion_rate: 0,
  ...g,
})
const stats = (goals: GoalStat[]): GoalStats => ({
  period: { from: "2026-11-05", to: "2026-11-11", tz: "UTC", interval: "day" },
  visitors: 1000,
  previous_visitors: 800,
  goals,
})

describe("GoalsCard", () => {
  it("points to settings when the site has no goals", async () => {
    mockFetch({ "/api/sites/abc/goals/stats": stats([]) })
    renderInSite(() => <GoalsCard />)
    const link = await screen.findByRole("link", { name: "Add a goal" })
    expect(link.getAttribute("href")).toBe("/sites/abc/settings#goals")
  })

  it("lists conversions and filters the dashboard by a goal", async () => {
    mockFetch({
      "/api/sites/abc/goals/stats": stats([
        stat({ visitors: 42, completions: 50, conversion_rate: 0.042 }),
        stat({
          id: 2,
          kind: "path",
          value: "/blog/*",
          visitors: 300,
          completions: 900,
          conversion_rate: 0.3,
        }),
      ]),
    })
    const { search } = renderInSite(
      () => <GoalsCard />,
      "/sites/abc?compare=off"
    )
    const signup = await screen.findByRole("button", {
      name: /newsletter-signup/,
    })
    expect(within(signup).getByText("4.2%")).toBeTruthy()
    expect(within(signup).getByText("50")).toBeTruthy()
    // No comparison selected, so no change column.
    expect(screen.queryByText("Change")).toBeNull()

    // A wildcard path cannot become a filter.
    const blog = screen.getByText("/blog/*").closest("button")!
    expect(blog.disabled).toBe(true)

    await userEvent.click(signup)
    expect(search().getAll("f")).toEqual(["event:is:newsletter-signup"])
  })

  it("shows the change in conversion rate when comparing", async () => {
    mockFetch({
      "/api/sites/abc/goals/stats": stats([
        stat({ conversion_rate: 0.06, previous_conversion_rate: 0.04 }),
      ]),
    })
    renderInSite(() => <GoalsCard />, "/sites/abc?compare=previous")
    expect(await screen.findByText("Change")).toBeTruthy()
    expect(screen.getByText("+50%")).toBeTruthy()
  })
})

describe("GoalsSettings", () => {
  it("adds and removes goals", async () => {
    let goals: Goal[] = [
      {
        id: 1,
        kind: "path",
        value: "/thanks",
        created_at: "2026-11-01T00:00:00Z",
      },
    ]
    const sent: unknown[] = []
    mockFetch({
      "/api/sites/abc/goals": (init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body))
          sent.push(body)
          const g = { id: 2, created_at: "2026-11-12T00:00:00Z", ...body }
          goals = [...goals, g]
          return g
        }
        return goals
      },
      "/api/sites/abc/goals/1": (init?: RequestInit) => {
        if (init?.method !== "DELETE") return undefined
        goals = goals.filter((g) => g.id !== 1)
        return new Response(null, { status: 204 })
      },
    })
    renderInSite(() => <GoalsSettings siteId="abc" />)
    expect(await screen.findByText("/thanks")).toBeTruthy()

    await userEvent.type(screen.getByLabelText("Add a goal"), "signup")
    await userEvent.click(screen.getByRole("button", { name: "Add" }))
    await screen.findByText("signup")
    expect(sent).toEqual([{ kind: "event", value: "signup" }])
    expect(
      (screen.getByLabelText("Add a goal") as HTMLInputElement).value
    ).toBe("")

    await userEvent.click(
      screen.getByRole("button", { name: "Remove goal /thanks" })
    )
    await waitFor(() => expect(screen.queryByText("/thanks")).toBeNull())
  })

  it("shows why a goal was refused", async () => {
    mockFetch({
      "/api/sites/abc/goals": (init?: RequestInit) =>
        init?.method === "POST"
          ? new Response(
              JSON.stringify({ error: "this goal already exists" }),
              { status: 409, headers: { "Content-Type": "application/json" } }
            )
          : [],
    })
    renderInSite(() => <GoalsSettings siteId="abc" />)
    await screen.findByText("No goals yet.")
    await userEvent.type(screen.getByLabelText("Add a goal"), "signup")
    await userEvent.click(screen.getByRole("button", { name: "Add" }))
    expect(await screen.findByText("this goal already exists")).toBeTruthy()
  })
})
