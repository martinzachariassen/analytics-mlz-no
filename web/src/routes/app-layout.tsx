import { Suspense } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, Navigate, Outlet, useLocation } from "react-router"
import { ChartNoAxesColumn, LogOut, Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { useTheme } from "@/components/theme-provider"
import { api, ApiError } from "@/lib/api"

/** Authenticated shell: redirects to /login without a session. */
export function AppLayout() {
  const location = useLocation()
  const me = useQuery({ queryKey: ["me"], queryFn: api.me })

  if (me.isPending) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <Skeleton className="h-8 w-48" />
      </div>
    )
  }
  if (me.error instanceof ApiError && me.error.status === 401) {
    // Keep ?auth_error=… from a failed OAuth callback so the login page can show it.
    return <Navigate to={`/login${location.search}`} replace />
  }
  if (me.isError) {
    return (
      <p className="p-6 text-destructive">
        Could not reach the server: {me.error.message}
      </p>
    )
  }

  return (
    <div className="min-h-svh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-medium">
            <ChartNoAxesColumn className="size-5" />
            analytics
          </Link>
          <UserMenu login={me.data.login} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}

function UserMenu({ login }: { login: string }) {
  const queryClient = useQueryClient()
  const { theme, setTheme } = useTheme()
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)

  async function logout() {
    await api.logout()
    queryClient.clear()
    window.location.assign("/login")
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Avatar className="size-6">
            {/* GitHub avatars are public; only loaded for the signed-in admin. */}
            <AvatarImage
              src={`https://github.com/${login}.png?size=48`}
              alt=""
            />
            <AvatarFallback>{login.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline">{login}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-muted-foreground">
          Signed in with GitHub
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTheme(dark ? "light" : "dark")}>
          {dark ? <Sun /> : <Moon />}
          {dark ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
