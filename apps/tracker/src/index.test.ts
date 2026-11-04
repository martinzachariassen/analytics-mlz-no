import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// index.ts runs on import and reads document.currentScript, so each test loads a fresh module
// with its own <script> element in place.
async function load(attrs: Record<string, string>, src = "https://stats.example.com/api/script.js") {
  const script = document.createElement("script");
  script.src = src;
  for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v);
  Object.defineProperty(document, "currentScript", { configurable: true, value: script });
  vi.resetModules();
  await import("./index");
}

let sent: Array<{ url: string; body: Record<string, unknown> }>;

beforeEach(() => {
  sent = [];
  window.happyDOM.setURL("https://www.example.com/page");
  Object.defineProperty(navigator, "webdriver", { configurable: true, value: false });
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: vi.fn((url: string, body: string) => {
      sent.push({ url, body: JSON.parse(body) });
      return true;
    }),
  });
});

afterEach(() => {
  delete window.mlz;
  Object.defineProperty(document, "currentScript", { configurable: true, value: null });
});

describe("script attributes", () => {
  it("starts with the site id and posts to the script's own origin", async () => {
    await load({ "data-site": "site123" });
    expect(window.mlz).toBeDefined();
    expect(sent).toEqual([
      {
        url: "https://stats.example.com/api/event",
        body: { site: "site123", type: "pageview", url: "https://www.example.com/page" },
      },
    ]);
  });

  it("uses data-api as the endpoint", async () => {
    await load({ "data-site": "site123", "data-api": "https://collect.example.net/api/event" });
    expect(sent[0]!.url).toBe("https://collect.example.net/api/event");
  });

  it("does nothing without data-site", async () => {
    await load({});
    expect(window.mlz).toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("does not start twice", async () => {
    await load({ "data-site": "site123" });
    const first = window.mlz;
    await load({ "data-site": "other" });
    expect(window.mlz).toBe(first);
    expect(sent).toHaveLength(1);
  });

  it("reads data-auto, data-hash, data-allow-localhost and data-respect-dnt", async () => {
    window.happyDOM.setURL("http://localhost:3000/app#/route");
    Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "1" });
    await load({ "data-site": "site123", "data-auto": "false", "data-hash": "true", "data-allow-localhost": "true" });
    expect(sent).toHaveLength(0); // auto off
    window.mlz!.pageview();
    expect(sent[0]!.body.url).toBe("http://localhost:3000/app#/route"); // hash kept, localhost allowed

    delete window.mlz;
    await load({ "data-site": "site123", "data-allow-localhost": "true", "data-respect-dnt": "true" });
    expect(sent).toHaveLength(1); // DNT honoured
    Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: null });
  });
});
