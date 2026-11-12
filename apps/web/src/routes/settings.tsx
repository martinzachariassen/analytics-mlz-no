import { useMutation, useQueryClient } from "@tanstack/react-query"
import { formatDistanceToNow } from "date-fns"
import { CircleCheck, LoaderCircle } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import { toast } from "sonner"

import { ErrorNote } from "@/components/error-note"
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

export function SettingsPage() {
  const { id = "" } = useParams()
  const [params] = useSearchParams()
  // Live, so "Last event … ago" stays current while the page is open.
  const site = useSite(id, { live: true })

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6 lg:py-10">
      {site.data && (
        <SetupStatus site={site.data} isNew={params.get("new") !== null} />
      )}

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

      {site.data ? (
        <GeneralForm key={site.data.id} site={site.data} />
      ) : site.isError ? (
        <ErrorNote queries={[site]} />
      ) : (
        <Skeleton className="h-56" />
      )}
      {site.data && <DangerZone id={id} name={site.data.name} />}
    </div>
  )
}

/**
 * Onboarding status: waiting until the first event arrives (useSite polls meanwhile),
 * then, for a site that was just added, a way on to the dashboard.
 */
function SetupStatus({ site, isNew }: { site: Site; isNew: boolean }) {
  if (site.first_event_at === null)
    return (
      <Alert role="status">
        <LoaderCircle className="text-violet motion-safe:animate-spin" />
        <AlertTitle>
          {isNew ? "Site added. " : ""}Waiting for the first event…
        </AlertTitle>
        <AlertDescription>
          Add the snippet below to every page on {site.domain} and open the site
          in a browser. This updates by itself.
        </AlertDescription>
      </Alert>
    )
  if (!isNew) return null
  return (
    <Alert role="status">
      <CircleCheck className="text-positive" />
      <AlertTitle>Receiving data</AlertTitle>
      <AlertDescription>
        <Link to={`/sites/${site.id}`} className="text-accent-deep underline">
          Open the dashboard
        </Link>
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
