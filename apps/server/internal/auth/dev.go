package auth

import (
	"context"
	"net/url"
)

// DevLogin is the username used by the Dev provider.
const DevLogin = "dev"

// Dev is a provider for local development that signs in without leaving the
// server: its "provider page" redirects straight back to the callback.
// It runs through the normal state check and session handling, so the rest
// of the app behaves exactly as with a real provider.
// Only enable it on localhost (config enforces this for DEV_LOGIN).
type Dev struct{}

// Name implements Provider.
func (Dev) Name() string { return "dev" }

// AuthCodeURL implements Provider.
func (Dev) AuthCodeURL(state, redirectURI string) string {
	return redirectURI + "?" + url.Values{"code": {"dev"}, "state": {state}}.Encode()
}

// Identify implements Provider.
func (Dev) Identify(context.Context, string, string) (Identity, error) {
	return Identity{ID: "dev", Login: DevLogin}, nil
}
