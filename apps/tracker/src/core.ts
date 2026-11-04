export type Props = Record<string, string | number | boolean>;

export interface Config {
  /** Site id from the dashboard. */
  site: string;
  /** Absolute URL of the collection endpoint. */
  endpoint: string;
  /** Track page views automatically (default true). */
  auto: boolean;
  /** Include the URL hash in page paths, for hash-based routers (default false). */
  hash: boolean;
  /** Also track on localhost / file: (default false). */
  allowLocalhost: boolean;
  /** Honour navigator.doNotTrack (default false; tracking is already anonymous). */
  respectDnt: boolean;
}

export interface Api {
  /** Send a custom event, e.g. track('signup', { plan: 'pro' }). */
  track(name: string, props?: Props): void;
  /** Send a page view manually (useful with data-auto="false"). */
  pageview(url?: string): void;
}

interface Payload {
  type: "pageview" | "event";
  name?: string;
  url: string;
  referrer?: string;
  props?: Props;
}

/**
 * Replaced at build time: false in script.js (esbuild --define), true in tests (vitest define).
 * Code behind `MLZ_TEST` is removed from the production bundle.
 */
declare const MLZ_TEST: boolean;

/** Starts tracking and returns the public API (plus `stop`, in tests only). */
export function init(cfg: Config): Api & { stop?(): void } {
  const disabled = isDisabled(cfg);
  let lastUrl = "";

  function send(p: Payload): void {
    if (disabled) return;
    // A string body is sent as text/plain, a CORS-safelisted type: no preflight request is needed.
    // undefined fields (name, referrer, props) are dropped by JSON.stringify.
    const body = JSON.stringify({ site: cfg.site, ...p });
    if (!navigator.sendBeacon?.(cfg.endpoint, body)) {
      fetch(cfg.endpoint, { method: "POST", body, keepalive: true }).catch(() => {});
    }
  }

  function currentUrl(): string {
    return cfg.hash ? location.href : location.href.split("#")[0]!;
  }

  function pageview(url = currentUrl()): void {
    if (url === lastUrl) return; // ignore duplicate navigations (e.g. replaceState, hash-only changes)
    // The referrer only describes how the visitor arrived, so it is sent with the first page view only.
    send({ type: "pageview", url, referrer: lastUrl ? undefined : document.referrer || undefined });
    lastUrl = url;
  }

  function track(name: string, props?: Props): void {
    if (name) send({ type: "event", name, url: currentUrl(), props });
  }

  function onClick(e: MouseEvent): void {
    if (e.type === "auxclick" && e.button !== 1) return; // only middle-click
    const target = e.target as Element | null;

    const tracked = target?.closest?.<HTMLElement>("[data-track]");
    if (tracked) return track(tracked.dataset.track!, dataProps(tracked));

    const link = target?.closest?.<HTMLAnchorElement>("a[href]");
    if (link && /^https?:$/.test(link.protocol) && link.host !== location.host) {
      track("outbound-link", { url: link.href });
    }
  }

  const onNavigate = () => pageview();
  const push = history.pushState;

  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", onClick, true);

  if (cfg.auto) {
    history.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
      push.apply(this, args);
      pageview();
    };
    addEventListener("popstate", onNavigate);
    if (cfg.hash) addEventListener("hashchange", onNavigate);

    // Don't count prerendered pages (Speculation Rules) until the user actually navigates to them.
    if ((document as Document & { prerendering?: boolean }).prerendering) {
      document.addEventListener("prerenderingchange", onNavigate, { once: true });
    } else {
      pageview();
    }
  }

  return MLZ_TEST
    ? {
        track,
        pageview,
        stop() {
          document.removeEventListener("click", onClick, true);
          document.removeEventListener("auxclick", onClick, true);
          removeEventListener("popstate", onNavigate);
          removeEventListener("hashchange", onNavigate);
          document.removeEventListener("prerenderingchange", onNavigate);
          if (cfg.auto) history.pushState = push;
        },
      }
    : { track, pageview };
}

/** Collects data-track-* attributes as props: data-track-plan="pro" -> { plan: "pro" }. */
export function dataProps(el: HTMLElement): Props | undefined {
  let props: Props | undefined;
  for (const key in el.dataset) {
    if (key.length > 5 && key.startsWith("track")) {
      (props ??= {})[key[5]!.toLowerCase() + key.slice(6)] = el.dataset[key]!;
    }
  }
  return props;
}

function isDisabled(cfg: Config): boolean {
  try {
    return (
      // An empty hostname means file: (or another non-network URL).
      (!cfg.allowLocalhost && /^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(location.hostname)) ||
      !!navigator.webdriver ||
      (cfg.respectDnt && navigator.doNotTrack === "1") ||
      // Lets site owners exclude their own visits: localStorage.setItem("mlz_ignore", "true")
      localStorage.getItem("mlz_ignore") === "true"
    );
  } catch {
    // storage unavailable (privacy mode, sandboxed iframe): only the opt-out check can throw, so track
    return false;
  }
}
