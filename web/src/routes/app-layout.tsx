import { Suspense } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, Navigate, Outlet, useLocation } from "react-router"
import { LogOut, Moon, Sun } from "lucide-react"

import { Wordmark } from "@/components/brand-mark"

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
      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-8">
        <Skeleton className="h-6 w-32" />
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
      {dev && (
        <div className="eyebrow border-b py-1.5 text-center text-[10px]">
          Local development <span className="text-accent-deep">/</span> demo
          data, automatic sign-in
        </div>
      )}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-8">
          <div className="flex items-center gap-6">
            <Link to="/sites" aria-label="All sites" className="group">
              <Wordmark />
            </Link>
            <nav className="flex items-center gap-4">
              <NavLink to="/sites" active={location.pathname === "/sites"}>
                Sites
              </NavLink>
            </nav>
          </div>
          <UserMenu user={me.data} />
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8 sm:py-10">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-2 px-4 pt-4 pb-10 text-[11px] text-fg-muted sm:px-8">
        <span>Cookie-free. No IPs or user agents stored.</span>
        <span>
          Press <kbd className="text-fg-secondary">D</kbd> to switch theme
        </span>
      </footer>
    </div>
  )
}

function NavLink({
  to,
  active,
  children,
}: {
  to: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      className={
        "eyebrow tracking-[0.14em] transition-colors hover:text-fg " +
        (active ? "text-fg" : "")
      }
    >
      {children}
    </Link>
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
        <Button variant="ghost" size="sm" className="gap-2 px-1.5">
          <Avatar className="size-6 rounded-sm after:rounded-sm">
            {/* GitHub avatars are public; only loaded for the signed-in admin. */}
            {github && (
              <AvatarImage
                src={`https://github.com/${user.login}.png?size=48`}
                alt=""
              />
            )}
            <AvatarFallback className="rounded-sm text-[10px]">
              {user.login.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-xs sm:inline">{user.login}</span>
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
