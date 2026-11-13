import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { CodeBlock, pixelUrlFor } from "@/components/tracking-snippet"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { api, type Site } from "@/lib/api"

/** Turns the tracking pixel on or off and shows how to embed it. */
export function PixelSettings({ site }: { site: Site }) {
  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: (enabled: boolean) =>
      api.updateSite(site.id, { pixel_enabled: enabled }),
    onSuccess: (s) => {
      queryClient.setQueryData(["site", s.id], s)
      void queryClient.invalidateQueries({ queryKey: ["sites"] })
      toast.success(
        s.pixel_enabled ? "Tracking pixel on" : "Tracking pixel off"
      )
    },
  })

  return (
    <Card id="pixel">
      <CardHeader>
        <CardTitle>Tracking pixel</CardTitle>
        <CardDescription>
          For places that can't run the script, such as a GitHub README or an
          email. Counts views; unique visitors only roughly, and through an
          image proxy (GitHub, Gmail, Yahoo Mail) not at all, nor country or
          device.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex items-center gap-3">
          <Switch
            id="pixel-enabled"
            checked={site.pixel_enabled}
            disabled={update.isPending}
            onCheckedChange={(v) => update.mutate(v)}
          />
          <Label htmlFor="pixel-enabled">Accept events from the pixel</Label>
        </div>
        {update.isError && (
          <p className="text-destructive">{update.error.message}</p>
        )}
        {site.pixel_enabled && (
          <>
            <p className="text-muted-foreground">
              Never put an email address, a name or a per-recipient id in{" "}
              <code className="font-mono text-xs">p</code>,{" "}
              <code className="font-mono text-xs">e</code> or{" "}
              <code className="font-mono text-xs">utm_*</code>: that turns
              anonymous counts into tracking of people. Tracking email opens may
              also need the recipient's consent.
            </p>
            <div className="flex flex-col gap-2">
              <p>Markdown (README):</p>
              <CodeBlock
                code={`![](${pixelUrlFor(site.id, { p: "/readme" })})`}
              />
            </div>
            <div className="flex flex-col gap-2">
              <p>HTML:</p>
              <CodeBlock
                code={`<img src="${pixelUrlFor(site.id, { p: "/" })}" alt="" width="1" height="1">`}
              />
            </div>
            <div className="flex flex-col gap-2">
              <p>
                A custom event instead of a page view, with{" "}
                <code className="font-mono text-xs">e</code>:
              </p>
              <CodeBlock
                code={pixelUrlFor(site.id, {
                  e: "email-open",
                  utm_campaign: "launch",
                })}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
