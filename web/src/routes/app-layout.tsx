import { Suspense } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, Navigate, Outlet, useLocation } from "react-router"
import {
  ChartNoAxesColumn,
  FlaskConical,
  LogOut,
  Moon,
  Sun,
} from "lucide-react"

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
import { api, ApiError, type User } from "@/lib/api"

/** Authenticated shell: sends visitors without a session to the home page. */
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
    // Keep ?auth_error=… from a failed OAuth callback so the home page can show it.
    return <Navigate to={`/${location.search}`} replace />
  }
  if (me.isError) {
    return (
      <p className="p-6 text-destructive">
        Could not reach the server: {me.error.message}
      </p>
    )
  }

  const dev = me.data.provider === "dev"
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        {dev && (
          <div className="flex items-center justify-center gap-1.5 bg-amber-500/10 px-4 py-1 text-xs text-amber-800 dark:text-amber-300">
            <FlaskConical className="size-3.5" />
            Local development · demo data, automatic sign-in
          </div>
        )}
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/sites" className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-chart-1 text-white">
              <ChartNoAxesColumn className="size-4" />
            </span>
            analytics
          </Link>
          <UserMenu user={me.data} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}

function UserMenu({ user }: { user: User }) {
  const queryClient = useQueryClient()
  const { theme, setTheme } = useTheme()
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  const github = user.provider === "github"

  async function logout() {
    await api.logout()
    queryClient.clear()
    window.location.assign("/")
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Avatar className="size-6">
            {/* GitHub avatars are public; only loaded for the signed-in admin. */}
            {github && (
              <AvatarImage
                src={`https://github.com/${user.login}.png?size=48`}
                alt=""
              />
            )}
            <AvatarFallback className="text-[10px]">
              {user.login.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline">{user.login}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-muted-foreground">
          {github ? "Signed in with GitHub" : "Local demo user"}
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
