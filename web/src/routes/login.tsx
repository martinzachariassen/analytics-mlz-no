import { useQuery } from "@tanstack/react-query"
import { Navigate, useSearchParams } from "react-router"
import { ChartNoAxesColumn, CircleAlert } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { api } from "@/lib/api"

// Error codes set by the server's OAuth callback (?auth_error=…).
const AUTH_ERRORS: Record<string, string> = {
  not_allowed:
    "This GitHub account is not allowed to sign in. Ask the owner to add you to ALLOWED_GITHUB_USERS.",
  conflict: "This GitHub username is already linked to a different account.",
  denied: "Sign-in was cancelled.",
  state: "The sign-in link expired. Please try again.",
  failed: "Sign-in failed. Please try again.",
}

export function LoginPage() {
  const [params] = useSearchParams()
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false })
  const config = useQuery({
    queryKey: ["auth-config"],
    queryFn: api.authConfig,
  })

  if (me.isSuccess) return <Navigate to="/" replace />

  const error = params.get("auth_error")
  const github = config.data?.providers.includes("github")

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <ChartNoAxesColumn className="mx-auto mb-2 size-8" />
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>
            Privacy-friendly analytics for your websites
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Could not sign in</AlertTitle>
              <AlertDescription>
                {AUTH_ERRORS[error] ?? AUTH_ERRORS.failed}
              </AlertDescription>
            </Alert>
          )}
          {config.isSuccess && !github && (
            <Alert>
              <CircleAlert />
              <AlertTitle>Sign-in is not configured</AlertTitle>
              <AlertDescription>
                Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and
                ALLOWED_GITHUB_USERS on the server.
              </AlertDescription>
            </Alert>
          )}
          <Button asChild size="lg" disabled={!github}>
            {/* Full page navigation: the server redirects to GitHub. */}
            <a href="/api/auth/github/login" aria-disabled={!github}>
              <GitHubIcon />
              Continue with GitHub
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  )
}
