/* Word Atlas offline cache: app shell network-first, everything else cache-first. */
const PREFIX = "atlas-";
const VERSION = `${PREFIX}ru-v3`;
const SHELL = `${VERSION}-shell`;
const MEDIA = `${VERSION}-media`;

async function precache() {
  const cache = await caches.open(SHELL);
  const base = self.registration.scope;
  const page = await fetch(new URL("./", base), { cache: "no-cache" });
  if (!page.ok) throw new Error("Could not cache the app shell");
  const html = await page.clone().text();
  const urls = new Set([new URL("atlas/index.json", base).href]);
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const url = new URL(match[1], base);
    if (url.href.startsWith(base)) urls.add(url.href);
  }
  await Promise.all([...urls].map(async (url) => {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Could not cache ${url}`);
    if (new URL(url).pathname.endsWith(".css")) {
      const css = await res.clone().text();
      const fonts = new Set([...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/g)].map((m) => new URL(m[1] ?? m[2] ?? m[3], url).href).filter((u) => u.startsWith(base)));
      await cache.addAll([...fonts]);
    }
    await cache.put(url, res);
  }));
  await cache.put(base, page.clone());
  await cache.put(new URL("index.html", base), page);
}

self.addEventListener("install", (event) => event.waitUntil(precache().then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== SHELL && k !== MEDIA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function partial(response, range) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return response;
  const bytes = await response.arrayBuffer();
  const size = bytes.byteLength;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.set("Accept-Ranges", "bytes");
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    headers.set("Content-Range", `bytes */${size}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const isShell = req.mode === "navigate" || url.pathname.endsWith("/index.json");
  if (isShell) {
    event.respondWith(
      fetch(req, { cache: "no-cache" })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            event.waitUntil(caches.open(SHELL).then((c) => c.put(req, copy)));
          }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req, { cacheName: SHELL });
          if (hit) return hit;
          if (req.mode === "navigate") return caches.match(self.registration.scope, { cacheName: SHELL });
          throw new Error("Offline data is not cached");
        }),
    );
    return;
  }
  const range = req.headers.get("range");
  const headers = new Headers(req.headers);
  headers.delete("range");
  headers.delete("if-range");
  const full = range ? new Request(req, { headers }) : req;
  const name = /\/atlas\/(img|thumb|audio)\//.test(url.pathname) ? MEDIA : SHELL;
  event.respondWith(
    caches.match(full, { cacheName: name }).then(async (hit) => {
      const res = hit || await fetch(full);
      if (!hit && res.status === 200 && res.type === "basic") {
        const copy = res.clone();
        event.waitUntil(caches.open(name).then((c) => c.put(full, copy)).then(() => name === MEDIA && trim(MEDIA, 1500)));
      }
      return range && res.status === 200 ? partial(res, range) : res;
    }),
  );
});
