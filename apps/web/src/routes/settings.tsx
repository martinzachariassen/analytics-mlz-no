import { useMutation, useQueryClient } from "@tanstack/react-query"
import { formatDistanceToNow } from "date-fns"
import { LoaderCircle } from "lucide-react"
import { type FormEvent, type ReactNode, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { ErrorNote } from "@/components/error-note"
import { GoalsSettings } from "@/components/goals-settings"
import { PixelSettings } from "@/components/pixel-settings"
import { type NavSection, SectionNav } from "@/components/section-nav"
import { TrackingSnippet } from "@/components/tracking-snippet"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type Site } from "@/lib/api"
import { useSite } from "@/lib/queries"
import { cn } from "@/lib/utils"

export function SettingsPage() {
  const { id = "" } = useParams()
  // Live, so "Last event … ago" stays current while the page is open.
  const site = useSite(id, { live: true })
  const sections: NavSection[] = [
    { id: "tracking", label: "Tracking code" },
    { id: "pixel", label: "Tracking pixel" },
    { id: "goals", label: "Goals" },
    { id: "general", label: "General" },
    { id: "danger", label: "Delete site" },
  ]

  return (
    <div className="mx-auto grid w-full max-w-4xl grid-cols-[minmax(0,1fr)] gap-6 p-4 sm:p-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10 lg:py-10">
      <SectionNav sections={sections} label="Settings" ready={!!site.data} />
      <div className="flex min-w-0 flex-col gap-6">
        {site.data && <SetupStatus site={site.data} />}

        <Section id="tracking">
          <Card>
            <CardHeader>
              <CardTitle>Tracking code</CardTitle>
              {site.data?.last_event_at && (
                <CardDescription>
                  Last event{" "}
                  <time dateTime={site.data.last_event_at}>
                    {formatDistanceToNow(site.data.last_event_at, {
                      addSuffix: true,
                    })}
                  </time>
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <TrackingSnippet siteId={site.data?.id ?? id} />
            </CardContent>
          </Card>
        </Section>

        <Section id="pixel">
          {site.data ? (
            <PixelSettings site={site.data} />
          ) : (
            <Skeleton className="h-40" />
          )}
        </Section>

        <Section id="goals">
          {site.data ? (
            <GoalsSettings siteId={site.data.id} />
          ) : (
            <Skeleton className="h-40" />
          )}
        </Section>

        <Section id="general">
          {site.data ? (
            <GeneralForm key={site.data.id} site={site.data} />
          ) : site.isError ? (
            <ErrorNote queries={[site]} />
          ) : (
            <Skeleton className="h-56" />
          )}
        </Section>

        {site.data && (
          <Section id="danger" className="mt-6 border-t pt-8">
            <DangerZone id={id} name={site.data.name} />
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({
  id,
  className,
  children,
}: {
  id: string
  className?: string
  children: ReactNode
}) {
  return (
    <section id={id} className={cn("scroll-mt-28 lg:scroll-mt-20", className)}>
      {children}
    </section>
  )
}

/** Until the first event arrives (useSite polls meanwhile), says what is missing. */
function SetupStatus({ site }: { site: Site }) {
  if (site.first_event_at !== null) return null
  return (
    <Alert role="status">
      <LoaderCircle className="text-violet motion-safe:animate-spin" />
      <AlertTitle>Waiting for the first event…</AlertTitle>
      <AlertDescription>
        Add the snippet below to every page on {site.domain} and open the site
        in a browser. This updates by itself.
      </AlertDescription>
    </Alert>
  )
}

function GeneralForm({
  site,
}: {
  site: { id: string; name: string; domain: string }
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(site.name)
  const [domain, setDomain] = useState(site.domain)

  const update = useMutation({
    mutationFn: () => api.updateSite(site.id, { name, domain }),
    onSuccess: (s) => {
      queryClient.setQueryData(["site", s.id], s)
      void queryClient.invalidateQueries({ queryKey: ["sites"] })
      toast.success("Site updated")
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    update.mutate()
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            Events are only accepted from this domain and its subdomains.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="domain">Domain</Label>
            <Input
              id="domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              required
            />
          </div>
          {update.isError && (
            <p className="text-sm text-destructive">{update.error.message}</p>
          )}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function DangerZone({ id, name }: { id: string; name: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const remove = useMutation({
    mutationFn: () => api.deleteSite(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sites"] })
      toast.success(`Deleted ${name}`)
      navigate("/sites")
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card className="shadow-[0_0_0_1px_color-mix(in_oklch,var(--destructive)_45%,transparent)]!">
      <CardHeader>
        <CardTitle>Delete site</CardTitle>
        <CardDescription>
          Permanently deletes the site and all of its collected data.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">Delete site</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
              <AlertDialogDescription>
                All page views and events for this site will be deleted. This
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => remove.mutate()}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  )
}
