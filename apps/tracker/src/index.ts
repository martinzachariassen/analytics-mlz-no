// Entry point for script.js:
//   <script defer src="https://analytics.example.com/api/script.js" data-site="SITE_ID"></script>
//
// Optional attributes:
//   data-api="https://…/api/event"  collection endpoint (default: same origin as the script)
//   data-auto="false"               disable automatic page views
//   data-hash="true"                include #hash in paths (hash routers)
//   data-allow-localhost="true"     track on localhost
//   data-respect-dnt="true"         honour Do Not Track
import { type Api, init } from "./core";

declare global {
  interface Window {
    mlz?: Api;
  }
}

const script = document.currentScript as HTMLScriptElement | null;
const ds = script?.dataset;

if (ds?.site && !window.mlz) {
  window.mlz = init({
    site: ds.site,
    endpoint: ds.api || new URL("/api/event", script!.src).href,
    auto: ds.auto !== "false",
    hash: ds.hash === "true",
    allowLocalhost: ds.allowLocalhost === "true",
    respectDnt: ds.respectDnt === "true",
  });
}
