// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GoalButton } from "@/components/goal-button"
import type { Goal } from "@/lib/api"
import { mockFetch, renderInSite } from "@/test/render"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
afterEach(() => {
  cleanup()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})

const goal = (g: Partial<Goal>): Goal => ({
  id: 1,
  kind: "event",
  value: "signup",
  created_at: "2026-11-01T00:00:00Z",
  ...g,
})

describe("GoalButton", () => {
  it("makes an event a goal and then says it is one", async () => {
    let goals: Goal[] = []
    let sent: unknown
    mockFetch({
      "/api/sites/abc/goals": (init: RequestInit | undefined) => {
        if (init?.method === "POST") {
          sent = JSON.parse(String(init.body))
          const g = goal({ value: "signup" })
          goals = [g]
          return g
        }
        return goals
      },
    })
    renderInSite(() => <GoalButton siteId="abc" kind="event" value="signup" />)

    await userEvent.click(
      await screen.findByRole("button", { name: "Make this a goal" })
    )
    await waitFor(() =>
      expect(sent).toEqual({ kind: "event", value: "signup" })
    )
    expect(await screen.findByRole("button", { name: "Goal" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Goal" }).hasAttribute("disabled")
    ).toBe(true)
    expect(toast.success).toHaveBeenCalledWith("signup is now a goal")
  })

  it("shows why a goal could not be added", async () => {
    mockFetch({
      "/api/sites/abc/goals": (init: RequestInit | undefined) =>
        init?.method === "POST"
          ? new Response(JSON.stringify({ error: "too many goals" }), {
              status: 400,
            })
          : [],
    })
    renderInSite(() => <GoalButton siteId="abc" kind="path" value="/thanks" />)
    await userEvent.click(
      await screen.findByRole("button", { name: "Make this a goal" })
    )
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("too many goals")
    )
  })

  it("is not offered for the empty value", async () => {
    const calls = mockFetch({ "/api/sites/abc/goals": [] })
    renderInSite(() => <GoalButton siteId="abc" kind="path" value="" />)
    await waitFor(() => expect(calls).toContain("/api/sites/abc/goals"))
    expect(screen.queryByRole("button")).toBeNull()
  })
})
