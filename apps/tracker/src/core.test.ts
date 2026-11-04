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
let pending: Array<Promise<unknown>>;
const stops: Array<() => void> = [];

/** Starts the tracker and registers it for cleanup after the test. */
function start(cfg: Config) {
  const t = init(cfg);
  stops.push(t.stop);
  return t;
}

async function decode(blob: Blob) {
  return JSON.parse(await blob.text()) as Record<string, unknown>;
}

/** Waits for queued beacons to be decoded. */
async function flush() {
  await Promise.all(pending);
}

beforeEach(() => {
  sent = [];
  pending = [];
  window.happyDOM.setURL("https://www.example.com/start?utm_source=newsletter#top");
  document.body.innerHTML = "";
  localStorage.clear();
  // happy-dom reports itself as an automated browser; the tracker would ignore it.
  Object.defineProperty(navigator, "webdriver", { configurable: true, value: false });
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: vi.fn((_url: string, blob: Blob) => {
      const target = sent;
      pending.push(decode(blob).then((p) => target.push(p)));
      return true;
    }),
  });
});

afterEach(() => {
  while (stops.length) stops.pop()!();
});

describe("page views", () => {
  it("sends an initial page view without the hash", async () => {
    start(base);
    await flush();
    expect(sent).toEqual([
      { site: "site123", type: "pageview", url: "https://www.example.com/start?utm_source=newsletter" },
    ]);
    expect(navigator.sendBeacon).toHaveBeenCalledWith(base.endpoint, expect.any(Blob));
  });

  it("tracks SPA navigation via pushState and popstate, ignoring duplicates", async () => {
    start(base);
    history.pushState({}, "", "/a");
    history.pushState({}, "", "/a"); // duplicate
    history.pushState({}, "", "/b");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flush();
    expect(sent.map((p) => p.url)).toEqual([
      "https://www.example.com/start?utm_source=newsletter",
      "https://www.example.com/a",
      "https://www.example.com/b",
    ]);
  });

  it("does nothing automatically when auto is false", async () => {
    const api = start({ ...base, auto: false });
    await flush();
    expect(sent).toHaveLength(0);
    api.pageview();
    await flush();
    expect(sent).toHaveLength(1);
  });

  it("keeps the hash in hash mode", async () => {
    start({ ...base, hash: true });
    await flush();
    expect(sent[0]!.url).toBe("https://www.example.com/start?utm_source=newsletter#top");
  });
});

describe("events", () => {
  it("tracks custom events via the API", async () => {
    const api = start({ ...base, auto: false });
    api.track("signup", { plan: "pro", seats: 3 });
    await flush();
    expect(sent[0]).toMatchObject({ type: "event", name: "signup", props: { plan: "pro", seats: 3 } });
  });

  it("tracks clicks on data-track elements, including nested targets", async () => {
    document.body.innerHTML = `<button data-track="signup" data-track-plan="pro" data-track-billing-cycle="yearly"><span id="inner">Go</span></button>`;
    start({ ...base, auto: false });
    document.getElementById("inner")!.click();
    await flush();
    expect(sent[0]).toMatchObject({ name: "signup", props: { plan: "pro", billingCycle: "yearly" } });
  });

  it("tracks outbound links but not internal ones", async () => {
    document.body.innerHTML = `
      <a id="out" href="https://github.com/x">GitHub</a>
      <a id="in" href="/about">About</a>
      <a id="mail" href="mailto:hi@example.com">Mail</a>`;
    start({ ...base, auto: false });
    for (const id of ["out", "in", "mail"]) {
      document.getElementById(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
    await flush();
    expect(sent).toEqual([
      expect.objectContaining({ name: "outbound-link", props: { url: "https://github.com/x" } }),
    ]);
  });

  it("prefers data-track over outbound tracking on the same link", async () => {
    document.body.innerHTML = `<a id="l" href="https://github.com/x" data-track="github">GitHub</a>`;
    start({ ...base, auto: false });
    document.getElementById("l")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
    expect(sent.map((p) => p.name)).toEqual(["github"]);
  });
});

describe("disabling", () => {
  it("ignores localhost unless allowed", async () => {
    window.happyDOM.setURL("http://localhost:5173/");
    start(base);
    await flush();
    expect(sent).toHaveLength(0);

    start({ ...base, allowLocalhost: true });
    await flush();
    expect(sent).toHaveLength(1);
  });

  it("ignores automated browsers", async () => {
    Object.defineProperty(navigator, "webdriver", { configurable: true, value: true });
    start(base);
    await flush();
    expect(sent).toHaveLength(0);
  });

  it("respects the mlz_ignore opt-out", async () => {
    localStorage.setItem("mlz_ignore", "true");
    start(base);
    await flush();
    expect(sent).toHaveLength(0);
  });
});

describe("dataProps", () => {
  it("maps data-track-* to camelCase props and skips data-track itself", () => {
    const el = document.createElement("div");
    el.dataset.track = "x";
    el.dataset.trackPlan = "pro";
    el.dataset.other = "nope";
    expect(dataProps(el)).toEqual({ plan: "pro" });
  });

  it("returns undefined when there are no props", () => {
    const el = document.createElement("div");
    el.dataset.track = "x";
    expect(dataProps(el)).toBeUndefined();
  });
});
