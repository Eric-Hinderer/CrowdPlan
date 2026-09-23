// User-supplied URLs are never fetched by the server (no SSRF surface). They
// are validated, normalized, and mined for a place name/coordinates only.

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|.*\.lan)$/i;

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || /^\[.*\]$/.test(host);
}

export type SafeUrlResult = { ok: true; url: string; host: string } | { ok: false; reason: string };

export function checkExternalUrl(raw: string): SafeUrlResult {
  const trimmed = raw.trim();
  if (trimmed.length > 1000) return { ok: false, reason: "That link is too long." };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, reason: "That doesn't look like a link." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: "Only web links (https) are supported." };
  if (u.username || u.password) return { ok: false, reason: "Links with embedded credentials aren't allowed." };
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || PRIVATE_HOST.test(host) || isIpLiteral(host)) {
    return { ok: false, reason: "Use a public website link." };
  }
  u.hash = "";
  return { ok: true, url: u.toString(), host };
}

export interface ParsedPlaceUrl {
  title: string | null;
  lat: number | null;
  lng: number | null;
  url: string;
  source: "google_maps" | "yelp" | "tripadvisor" | "web";
}

function titleFromSlug(slug: string): string {
  return decodeURIComponent(slug)
    .replace(/[+_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

export function parsePlaceUrl(raw: string): ParsedPlaceUrl | { error: string } {
  const safe = checkExternalUrl(raw);
  if (!safe.ok) return { error: safe.reason };
  const u = new URL(safe.url);
  const host = safe.host;
  if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname.includes("/maps")) {
    const place = /\/maps\/place\/([^/]+)/.exec(u.pathname);
    const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(u.pathname);
    const q = u.searchParams.get("q") ?? u.searchParams.get("query");
    return {
      title: place ? titleFromSlug(place[1]) : q ? q.trim().slice(0, 160) : null,
      lat: at ? Number(at[1]) : null,
      lng: at ? Number(at[2]) : null,
      url: safe.url,
      source: "google_maps",
    };
  }
  if (host === "maps.app.goo.gl" || host === "goo.gl") {
    return { title: null, lat: null, lng: null, url: safe.url, source: "google_maps" };
  }
  if (/(^|\.)yelp\.com$/.test(host)) {
    const biz = /\/biz\/([^/?]+)/.exec(u.pathname);
    // Yelp slugs are "<name>-<city>[-n]"; drop the numeric suffix and the city segment.
    const parts = biz ? biz[1].replace(/-\d+$/, "").split("-") : [];
    const nameParts = parts.length >= 3 ? parts.slice(0, -1) : parts;
    return { title: nameParts.length ? titleFromSlug(nameParts.join("-")) : null, lat: null, lng: null, url: safe.url, source: "yelp" };
  }
  if (/(^|\.)tripadvisor\.[a-z.]+$/.test(host)) {
    const m = /-Reviews-([^-]+)-/.exec(u.pathname);
    return { title: m ? titleFromSlug(m[1]) : null, lat: null, lng: null, url: safe.url, source: "tripadvisor" };
  }
  return { title: null, lat: null, lng: null, url: safe.url, source: "web" };
}
