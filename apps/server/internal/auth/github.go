package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// GitHub signs users in with a GitHub OAuth App.
// Create one at https://github.com/settings/developers with the callback URL
// <PUBLIC_URL>/api/auth/github/callback.
type GitHub struct {
	ClientID     string
	ClientSecret string

	// Endpoints; overridable in tests. Empty values use github.com.
	AuthURL  string
	TokenURL string
	APIURL   string
	Client   *http.Client
}

// Name implements Provider.
func (g *GitHub) Name() string { return "github" }

// AuthCodeURL implements Provider. Only read:user is requested.
func (g *GitHub) AuthCodeURL(state, redirectURI string) string {
	q := url.Values{
		"client_id":    {g.ClientID},
		"redirect_uri": {redirectURI},
		"scope":        {"read:user"},
		"state":        {state},
		"allow_signup": {"false"},
	}
	return or(g.AuthURL, "https://github.com/login/oauth/authorize") + "?" + q.Encode()
}

// Identify implements Provider. The access token is used once and discarded.
func (g *GitHub) Identify(ctx context.Context, code, redirectURI string) (Identity, error) {
	form := url.Values{
		"client_id":     {g.ClientID},
		"client_secret": {g.ClientSecret},
		"code":          {code},
		"redirect_uri":  {redirectURI},
	}
	// Endpoints are fixed GitHub URLs; they are only overridden in tests.
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, //nolint:gosec // G704: not user-controlled
		or(g.TokenURL, "https://github.com/login/oauth/access_token"), strings.NewReader(form.Encode()))
	if err != nil {
		return Identity{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	var tok struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		Description string `json:"error_description"`
	}
	if err := g.do(req, &tok); err != nil {
		return Identity{}, fmt.Errorf("token exchange: %w", err)
	}
	if tok.AccessToken == "" {
		return Identity{}, fmt.Errorf("token exchange: %s %s", tok.Error, tok.Description)
	}

	req, err = http.NewRequestWithContext(ctx, http.MethodGet, or(g.APIURL, "https://api.github.com")+"/user", nil) //nolint:gosec // G704: not user-controlled
	if err != nil {
		return Identity{}, err
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	var user struct {
		ID    int64  `json:"id"`
		Login string `json:"login"`
	}
	if err := g.do(req, &user); err != nil {
		return Identity{}, fmt.Errorf("fetch user: %w", err)
	}
	if user.ID == 0 || user.Login == "" {
		return Identity{}, errors.New("fetch user: empty response")
	}
	return Identity{ID: strconv.FormatInt(user.ID, 10), Login: user.Login}, nil
}

func (g *GitHub) do(req *http.Request, v any) error {
	client := g.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req) //nolint:gosec // G704: request URLs are fixed GitHub endpoints
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %s", resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

func or(v, def string) string {
	if v != "" {
		return v
	}
	return def
}
