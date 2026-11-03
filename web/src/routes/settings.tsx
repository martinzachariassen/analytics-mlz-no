import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import { ArrowLeft, PartyPopper } from "lucide-react"
import { toast } from "sonner"

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
import { api } from "@/lib/api"

export function SettingsPage() {
  const { id = "" } = useParams()
  const [params] = useSearchParams()
  const site = useQuery({ queryKey: ["site", id], queryFn: () => api.site(id) })

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="self-start">
        <Link to={`/sites/${id}`}>
          <ArrowLeft />
          Back to dashboard
        </Link>
      </Button>

      {params.get("new") && (
        <Alert>
          <PartyPopper />
          <AlertTitle>Site added</AlertTitle>
          <AlertDescription>
            Add the snippet below to your website to start collecting data.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tracking code</CardTitle>
        </CardHeader>
        <CardContent>
          <TrackingSnippet siteId={id} />
        </CardContent>
      </Card>

      {site.data ? (
        <GeneralForm key={site.data.id} site={site.data} />
      ) : (
        <Skeleton className="h-56" />
      )}
      {site.data && <DangerZone id={id} name={site.data.name} />}
    </div>
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
    <Card className="border-destructive/40">
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
