import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

test("offline cache keeps the index after the app consumes its network response", async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const saved = new Map<string, Response>();
  let openCache!: () => void;
  const ready = new Promise<void>((resolve) => { openCache = resolve; });
  const caches = {
    async open() {
      await ready;
      return { async put(request: Request, response: Response) { saved.set(request.url, response); } };
    },
    async match(request: Request) { return saved.get(request.url)?.clone(); },
  };
  let online = true;
  vm.runInNewContext(fs.readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), {
    self: { addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener) },
    caches,
    location: { origin: "https://atlas.example" },
    URL,
    fetch: async () => {
      if (!online) throw new Error("offline");
      return new Response(JSON.stringify({ locale: "ru-RU", count: 7298 }), { headers: { "Content-Type": "application/json" } });
    },
  });
  const request = new Request("https://atlas.example/words/atlas/index.json?v=ru-2");
  let response!: Promise<Response>;
  const lifetime: Promise<unknown>[] = [];
  const event = { request, respondWith: (value: Promise<Response>) => { response = value; }, waitUntil: (value: Promise<unknown>) => lifetime.push(value) };
  listeners.get("fetch")!(event);
  assert.equal((await (await response).json()).count, 7298);
  openCache();
  assert.ok(lifetime.length > 0, "Cache writes must keep the worker alive");
  await Promise.all(lifetime);
  assert.ok(saved.has(request.url));
  online = false;
  listeners.get("fetch")!(event);
  assert.deepEqual(await (await response).json(), { locale: "ru-RU", count: 7298 });
});
