import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useLocation, useNavigate, useParams } from "react-router"
import {
  Activity,
  ChevronsUpDown,
  FileText,
  LayoutGrid,
  LayoutDashboard,
  LogOut,
  MapPin,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  Share2,
  Sun,
  Zap,
  type LucideIcon,
} from "lucide-react"

import { BrandMark } from "@/components/brand-mark"
import { useTheme } from "@/components/theme-provider"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { api, type User } from "@/lib/api"
import { useScope } from "@/lib/use-scope"

export type View = { path: string; label: string; icon: LucideIcon }

/** The views of a site, in sidebar order. Paths are relative to /sites/:id. */
export const VIEWS: View[] = [
  { path: "", label: "Overview", icon: LayoutDashboard },
  { path: "realtime", label: "Realtime", icon: Activity },
  { path: "pages", label: "Pages", icon: FileText },
  { path: "sources", label: "Sources", icon: Share2 },
  { path: "locations", label: "Locations", icon: MapPin },
  { path: "devices", label: "Devices", icon: Monitor },
  { path: "events", label: "Events", icon: Zap },
]

export function AppSidebar({
  user,
  onSearch,
}: {
  user: User
  onSearch: () => void
}) {
  const { id } = useParams()
  const { pathname } = useLocation()
  const sc = useScope()
  const base = `/sites/${id}`
  const sub = id ? pathname.slice(base.length).replace(/^\//, "") : null

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SitePicker />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onSearch}
              tooltip="Search (⌘K)"
              className="text-fg-muted"
            >
              <Search />
              <span>Search</span>
              <Kbd className="ml-auto">⌘K</Kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {id && (
          <SidebarGroup>
            <SidebarGroupLabel>Analytics</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {VIEWS.map((v) => (
                  <SidebarMenuItem key={v.path}>
                    <SidebarMenuButton
                      asChild
                      isActive={sub === v.path}
                      tooltip={v.label}
                    >
                      <Link
                        to={`${base}${v.path ? `/${v.path}` : ""}${sc.search}`}
                      >
                        <v.icon />
                        <span>{v.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {v.path === "realtime" && <LiveBadge siteId={id} />}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/sites"}
                  tooltip="All sites"
                >
                  <Link to="/sites">
                    <LayoutGrid />
                    <span>All sites</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {id && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={sub === "settings"}
                    tooltip="Site settings"
                  >
                    <Link to={`${base}/settings`}>
                      <Settings />
                      <span>Site settings</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function LiveBadge({ siteId }: { siteId: string }) {
  const rt = useQuery({
    queryKey: ["realtime", siteId],
    queryFn: () => api.realtime(siteId),
    refetchInterval: 15_000,
  })
  const n = rt.data?.visitors ?? 0
  return (
    <SidebarMenuBadge className="gap-1.5 text-fg-muted">
      <span
        className={
          n > 0
            ? "size-1.5 animate-pulse rounded-full bg-positive"
            : "size-1.5 rounded-full bg-fg-muted/40"
        }
      />
      <span className="tnum">{n}</span>
    </SidebarMenuBadge>
  )
}

function SitePicker() {
  const { id } = useParams()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const sc = useScope()
  const sites = useQuery({ queryKey: ["sites"], queryFn: api.sites })
  const site = sites.data?.find((s) => s.id === id)
  // Keep the current view when switching site.
  const sub = id ? pathname.slice(`/sites/${id}`.length) : ""

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          className="data-[state=open]:bg-sidebar-accent"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface">
            <BrandMark className="size-4" />
          </span>
          <span className="grid min-w-0 flex-1 text-left leading-tight">
            <span className="truncate text-[13px] font-semibold text-fg">
              {site?.name ?? "mlz. analytics"}
            </span>
            <span className="truncate text-xs text-fg-muted">
              {site?.domain ?? "All sites"}
            </span>
          </span>
          <ChevronsUpDown className="ml-auto text-fg-muted" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs text-fg-muted">
          Sites
        </DropdownMenuLabel>
        {sites.data?.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onSelect={() =>
              navigate(
                `/sites/${s.id}${sub === "/settings" ? "" : sub}${sc.search}`
              )
            }
            className="flex-col items-start gap-0"
          >
            <span className="font-medium">{s.name}</span>
            <span className="text-xs text-fg-muted">{s.domain}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/sites?add=1")}>
          <Plus />
          Add site
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <Avatar className="size-7 rounded-md after:rounded-md">
                {/* GitHub avatars are public; only loaded for the signed-in admin. */}
                {github && (
                  <AvatarImage
                    src={`https://github.com/${user.login}.png?size=56`}
                    alt=""
                  />
                )}
                <AvatarFallback className="rounded-md text-[10px]">
                  {user.login.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-[13px] font-medium text-fg">
                  {user.login}
                </span>
                <span className="truncate text-xs text-fg-muted">
                  {github ? "GitHub" : "Local demo"}
                </span>
              </span>
              <ChevronsUpDown className="ml-auto text-fg-muted" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuItem
              onSelect={() => setTheme(dark ? "light" : "dark")}
            >
              {dark ? <Sun /> : <Moon />}
              {dark ? "Light mode" : "Dark mode"}
              <Kbd className="ml-auto">D</Kbd>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void logout()}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
