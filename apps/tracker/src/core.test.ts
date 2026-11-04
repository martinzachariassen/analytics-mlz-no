import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init, dataProps, type Config } from "./core";

// Provided by the happy-dom test environment.
declare global {
  interface Window {
    happyDOM: { setURL(url: string): void };
  }
}

const base: Config = {
  site: "site123",
  endpoint: "https://stats.example.com/api/event",
  auto: true,
  hash: false,
  allowLocalhost: false,
  respectDnt: false,
};

let sent: Array<Record<string, unknown>>;
const stops: Array<() => void> = [];

/** Starts the tracker and registers it for cleanup after the test. */
function start(cfg: Config) {
  const t = init(cfg);
  stops.push(t.stop!);
  return t;
}

/** Replaces navigator.sendBeacon; `accept` is what the browser reports (false = not queued). */
function mockBeacon(accept: boolean) {
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: vi.fn((_url: string, body: string) => {
      if (accept) sent.push(JSON.parse(body));
      return accept;
    }),
  });
}

beforeEach(() => {
  sent = [];
  window.happyDOM.setURL("https://www.example.com/start?utm_source=newsletter#top");
  document.body.innerHTML = "";
  localStorage.clear();
  // happy-dom reports itself as an automated browser; the tracker would ignore it.
  Object.defineProperty(navigator, "webdriver", { configurable: true, value: false });
  mockBeacon(true);
});

afterEach(() => {
  while (stops.length) stops.pop()!();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: null });
});

describe("page views", () => {
  it("sends an initial page view without the hash", () => {
    start(base);
    expect(sent).toEqual([
      { site: "site123", type: "pageview", url: "https://www.example.com/start?utm_source=newsletter" },
    ]);
    expect(navigator.sendBeacon).toHaveBeenCalledWith(base.endpoint, expect.any(String));
  });

  it("sends the referrer with the first page view only", () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://news.example.org/");
    start(base);
    history.pushState({}, "", "/a");
    expect(sent.map((p) => p.referrer)).toEqual(["https://news.example.org/", undefined]);
  });

  it("tracks SPA navigation via pushState and popstate, ignoring duplicates", () => {
    start(base);
    history.pushState({}, "", "/a");
    history.pushState({}, "", "/a"); // duplicate
    history.pushState({}, "", "/b");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(sent.map((p) => p.url)).toEqual([
      "https://www.example.com/start?utm_source=newsletter",
      "https://www.example.com/a",
      "https://www.example.com/b",
    ]);
  });

  it("does nothing automatically when auto is false", () => {
    const api = start({ ...base, auto: false });
    expect(sent).toHaveLength(0);
    api.pageview();
    expect(sent).toHaveLength(1);
  });

  it("waits for a prerendered page to be activated", () => {
    Object.defineProperty(document, "prerendering", { configurable: true, value: true });
    start(base);
    expect(sent).toHaveLength(0);
    Object.defineProperty(document, "prerendering", { configurable: true, value: false });
    document.dispatchEvent(new Event("prerenderingchange"));
    document.dispatchEvent(new Event("prerenderingchange")); // listener is { once: true }
    expect(sent.map((p) => p.type)).toEqual(["pageview"]);
    delete (document as { prerendering?: boolean }).prerendering;
  });

  it("keeps the hash in hash mode", () => {
    start({ ...base, hash: true });
    expect(sent[0]!.url).toBe("https://www.example.com/start?utm_source=newsletter#top");
  });
});

describe("sending", () => {
  it("falls back to fetch with keepalive when sendBeacon does not queue the request", async () => {
    mockBeacon(false);
    const fetch = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal("fetch", fetch);
    start(base);
    expect(fetch).toHaveBeenCalledWith(base.endpoint, {
      method: "POST",
      body: JSON.stringify({ site: "site123", type: "pageview", url: "https://www.example.com/start?utm_source=newsletter" }),
      keepalive: true,
    });
  });

  it("swallows fetch errors", async () => {
    mockBeacon(false);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    expect(() => start(base)).not.toThrow();
    await Promise.resolve(); // let the rejection settle; an unhandled one would fail the run
  });
});

describe("events", () => {
  it("tracks custom events via the API", () => {
    const api = start({ ...base, auto: false });
    api.track("signup", { plan: "pro", seats: 3 });
    expect(sent[0]).toMatchObject({ type: "event", name: "signup", props: { plan: "pro", seats: 3 } });
  });

  it("ignores events without a name", () => {
    const api = start({ ...base, auto: false });
    api.track("");
    expect(sent).toHaveLength(0);
  });

  it("tracks clicks on data-mlz-event elements, including nested targets", () => {
    document.body.innerHTML = `<button data-mlz-event="signup" data-mlz-event-plan="pro" data-mlz-event-billing-cycle="yearly"><span id="inner">Go</span></button>`;
    start({ ...base, auto: false });
    document.getElementById("inner")!.click();
    expect(sent[0]).toMatchObject({ name: "signup", props: { plan: "pro", billingCycle: "yearly" } });
  });

  it("ignores the old data-track attribute", () => {
    document.body.innerHTML = `<button id="b" data-track="signup" data-track-plan="pro">Go</button>`;
    start({ ...base, auto: false });
    document.getElementById("b")!.click();
    expect(sent).toHaveLength(0);
  });

  it("tracks outbound links but not internal ones", () => {
    document.body.innerHTML = `
      <a id="out" href="https://github.com/x">GitHub</a>
      <a id="in" href="/about">About</a>
      <a id="mail" href="mailto:hi@example.com">Mail</a>`;
    start({ ...base, auto: false });
    for (const id of ["out", "in", "mail"]) {
      document.getElementById(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
    expect(sent).toEqual([
      expect.objectContaining({ name: "outbound-link", props: { url: "https://github.com/x" } }),
    ]);
  });

  it("counts middle clicks but not other auxiliary clicks", () => {
    document.body.innerHTML = `<a id="out" href="https://github.com/x">GitHub</a>`;
    start({ ...base, auto: false });
    const link = document.getElementById("out")!;
    link.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 })); // middle: opens a tab
    link.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 2 })); // right: context menu
    expect(sent).toHaveLength(1);
  });

  it("ignores clicks whose target is not an element", () => {
    start({ ...base, auto: false });
    expect(() => document.dispatchEvent(new MouseEvent("click", { bubbles: true }))).not.toThrow();
    expect(sent).toHaveLength(0);
  });

  it("prefers data-mlz-event over outbound tracking on the same link", () => {
    document.body.innerHTML = `<a id="l" href="https://github.com/x" data-mlz-event="github">GitHub</a>`;
    start({ ...base, auto: false });
    document.getElementById("l")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(sent.map((p) => p.name)).toEqual(["github"]);
  });
});

describe("disabling", () => {
  it("ignores localhost unless allowed", () => {
    window.happyDOM.setURL("http://localhost:5173/");
    start(base);
    expect(sent).toHaveLength(0);

    start({ ...base, allowLocalhost: true });
    expect(sent).toHaveLength(1);
  });

  it("ignores automated browsers", () => {
    Object.defineProperty(navigator, "webdriver", { configurable: true, value: true });
    start(base);
    expect(sent).toHaveLength(0);
  });

  it("respects the mlz_ignore opt-out", () => {
    localStorage.setItem("mlz_ignore", "true");
    start(base);
    expect(sent).toHaveLength(0);
  });

  it("honours Do Not Track only when asked to", () => {
    Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "1" });
    start(base);
    start({ ...base, respectDnt: true });
    expect(sent).toHaveLength(1);
  });
});

describe("dataProps", () => {
  it("maps data-mlz-event-* to camelCase props and skips data-mlz-event itself", () => {
    const el = document.createElement("div");
    el.dataset.mlzEvent = "x";
    el.dataset.mlzEventPlan = "pro";
    el.dataset.other = "nope";
    expect(dataProps(el)).toEqual({ plan: "pro" });
  });

  it("returns undefined when there are no props", () => {
    const el = document.createElement("div");
    el.dataset.mlzEvent = "x";
    expect(dataProps(el)).toBeUndefined();
  });
});
