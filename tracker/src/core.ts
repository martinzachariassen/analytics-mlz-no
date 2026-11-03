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
  site: string;
  type: "pageview" | "event";
  name?: string;
  url: string;
  referrer?: string;
  props?: Props;
}

const OUTBOUND = "outbound-link";

/** Starts tracking in `win` and returns the public API plus a stop function (used in tests). */
export function init(cfg: Config, win: Window = window): Api & { stop(): void } {
  const doc = win.document;
  const loc = win.location;
  const nav = win.navigator;

  const disabled = isDisabled(cfg, win);
  let lastUrl = "";
  let sentFirst = false;

  function send(p: Payload): void {
    if (disabled) return;
    const body = JSON.stringify(p);
    // text/plain is a CORS-safelisted type: no preflight request is needed.
    const blob = new Blob([body], { type: "text/plain" });
    if (nav.sendBeacon && nav.sendBeacon(cfg.endpoint, blob)) return;
    win
      .fetch(cfg.endpoint, { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } })
      .catch(() => {});
  }

  function currentUrl(): string {
    return cfg.hash ? loc.href : loc.href.split("#")[0]!;
  }

  function pageview(url?: string): void {
    const u = url ?? currentUrl();
    if (u === lastUrl) return; // ignore duplicate navigations (e.g. replaceState, hash-only changes)
    lastUrl = u;
    const p: Payload = { site: cfg.site, type: "pageview", url: u };
    if (!sentFirst && doc.referrer) p.referrer = doc.referrer;
    sentFirst = true;
    send(p);
  }

  function track(name: string, props?: Props): void {
    if (!name) return;
    const p: Payload = { site: cfg.site, type: "event", name, url: currentUrl() };
    if (props && Object.keys(props).length) p.props = props;
    send(p);
  }

  function onClick(e: MouseEvent): void {
    if (e.type === "auxclick" && e.button !== 1) return; // only middle-click
    const target = e.target as Element | null;
    if (!target || typeof target.closest !== "function") return;

    const tracked = target.closest<HTMLElement>("[data-track]");
    if (tracked) {
      track(tracked.dataset.track!, dataProps(tracked));
      return;
    }

    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (link && isOutbound(link, loc)) {
      track(OUTBOUND, { url: link.href });
    }
  }

  const onNavigate = () => pageview();
  const hist = win.history;
  const push = hist.pushState;

  doc.addEventListener("click", onClick, true);
  doc.addEventListener("auxclick", onClick, true);

  if (cfg.auto) {
    hist.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
      push.apply(this, args);
      pageview();
    };
    win.addEventListener("popstate", onNavigate);
    if (cfg.hash) win.addEventListener("hashchange", onNavigate);

    // Don't count prerendered pages (Speculation Rules) until the user actually navigates to them.
    if ((doc as Document & { prerendering?: boolean }).prerendering) {
      doc.addEventListener("prerenderingchange", onNavigate, { once: true });
    } else {
      pageview();
    }
  }

  function stop(): void {
    doc.removeEventListener("click", onClick, true);
    doc.removeEventListener("auxclick", onClick, true);
    win.removeEventListener("popstate", onNavigate);
    win.removeEventListener("hashchange", onNavigate);
    doc.removeEventListener("prerenderingchange", onNavigate);
    if (cfg.auto) hist.pushState = push;
  }

  return { track, pageview, stop };
}

/** Collects data-track-* attributes as props: data-track-plan="pro" -> { plan: "pro" }. */
export function dataProps(el: HTMLElement): Props | undefined {
  let props: Props | undefined;
  for (const [key, value] of Object.entries(el.dataset)) {
    if (key.length > 5 && key.startsWith("track") && value !== undefined) {
      const name = key[5]!.toLowerCase() + key.slice(6);
      (props ??= {})[name] = value;
    }
  }
  return props;
}

function isOutbound(a: HTMLAnchorElement, loc: Location): boolean {
  return /^https?:$/.test(a.protocol) && a.host !== loc.host;
}

function isDisabled(cfg: Config, win: Window): boolean {
  const { hostname, protocol } = win.location;
  if (!cfg.allowLocalhost && (protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname))) {
    return true;
  }
  if ((win.navigator as Navigator & { webdriver?: boolean }).webdriver) return true;
  if (cfg.respectDnt && win.navigator.doNotTrack === "1") return true;
  try {
    // Lets site owners exclude their own visits: localStorage.setItem("mlz_ignore", "true")
    if (win.localStorage.getItem("mlz_ignore") === "true") return true;
  } catch {
    // storage unavailable (privacy mode, sandboxed iframe) — ignore
  }
  return false;
}
