import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { beforeEach, test } from "node:test";

const saved = new Map<string, string>();
const writes: string[] = [];
let failKey: string | undefined;
let readFailKey: string | undefined;
let removeFailKey: string | undefined;
let persistCalls = 0;
const events = new EventTarget();
const documentEvents = new EventTarget();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  get length() { return saved.size; },
  key: (index: number) => [...saved.keys()][index] ?? null,
  getItem: (key: string) => {
    if (key === readFailKey) throw new Error("Storage unavailable");
    return saved.get(key) ?? null;
  },
  removeItem: (key: string) => {
    if (key === removeFailKey) throw new Error("Storage unavailable");
    saved.delete(key);
  },
  setItem: (key: string, value: string) => {
    writes.push(key);
    if (key === failKey) throw new Error("QuotaExceededError");
    saved.set(key, value);
  },
} });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
  storage: { persist: () => { persistCalls++; return Promise.reject(new Error("Permission denied")); } },
} });
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  addEventListener: events.addEventListener.bind(events),
  setTimeout: () => 1,
  clearTimeout: () => {},
} });
Object.defineProperty(globalThis, "document", { configurable: true, value: {
  addEventListener: documentEvents.addEventListener.bind(documentEvents),
  visibilityState: "hidden",
} });
const datasetId = "word-atlas-open";
const key = `word-atlas:v2:${datasetId}`;
const settingsKey = "word-atlas:settings";
const profilesKey = "word-atlas:profiles";
saved.set(settingsKey, JSON.stringify({ accent: "us", onboarded: true }));
saved.set(key, JSON.stringify({ version: 2, datasetId, bookmarks: ["legacy"] }));
const { sanitizeProgress, sanitizeSettings, sanitizeProfiles, defaultSettings, emptyProgress, store, flush, importBackup, toggleBookmark, backupFilename } = await import("./store");
store.useDataset(datasetId);
const initial = store.get();
const initialWrites = [...writes];

beforeEach(() => {
  failKey = undefined;
  readFailKey = undefined;
  removeFailKey = undefined;
  flush();
  saved.clear();
  foreignWrite(profilesKey, { current: "default", list: [{ id: "default", name: "Основной" }] });
  store.useDataset(datasetId);
  store.settings(defaultSettings);
  flush();
  writes.length = 0;
});

function foreignWrite(key: string, value: unknown) {
  const newValue = JSON.stringify(value);
  saved.set(key, newValue);
  const event = Object.assign(new Event("storage"), { key, newValue });
  events.dispatchEvent(event);
  return event;
}

const card = { due: 1, s: 2, d: 5, el: 0, sd: 1, ls: 0, reps: 1, lapses: 0, st: 2 as const, seen: 1 };

test("keeps valid progress and drops malformed records", () => {
  const p = sanitizeProgress(
    {
      version: 2,
      cards: { ok: card, bad: { ...card, d: 99 }, worse: "x" },
      bookmarks: ["ok", 3],
      days: { "2026-10-25": { n: 1, r: 2, c: 1, t: 30 }, nope: { n: 1, r: 1, c: 1, t: 1 } },
      typing: [{ at: 1, mode: "word", items: 10, wpm: 40, accuracy: 98 }, { at: 1, mode: "hack", items: 1, wpm: 1, accuracy: 1 }],
    },
    "word-atlas-open",
  );
  assert.deepEqual(Object.keys(p.cards), ["ok"]);
  assert.deepEqual(p.bookmarks, ["ok"]);
  assert.deepEqual(Object.keys(p.days), ["2026-10-25"]);
  assert.equal(p.typing.length, 1);
});

test("rejects other versions and unknown settings", () => {
  assert.deepEqual(sanitizeProgress({ version: 1, cards: { ok: card } }, "x").cards, {});
  const s = sanitizeSettings({ accent: "fr", dailyNew: 1e9, theme: "dark", retention: 0.5 });
  assert.equal(s.accent, "uk");
  assert.equal(s.dailyNew, 10);
  assert.equal(s.theme, "dark");
  assert.equal(s.retention, 0.9);
});

test("unsupported backup progress versions leave memory and storage untouched", () => {
  store.progress((p) => ({ ...p, cards: { ok: card }, bookmarks: ["ok"] }));
  flush();
  const before = store.get();
  const disk = new Map(saved);
  for (const version of [1, 3, undefined, "2"]) {
    const result = importBackup(JSON.stringify({ app: "word-atlas", version: 2, progress: { ...emptyProgress(datasetId), version } }));
    assert.equal(result.ok, false, `progress.version=${version}`);
    assert.equal(store.get(), before);
    assert.deepEqual(saved, disk);
  }
});

test("supported backup restores cards and settings without a session", () => {
  const result = importBackup(JSON.stringify({ app: "word-atlas", version: 2, progress: { ...emptyProgress(datasetId), cards: { ok: card }, session: { broken: true } }, settings: { accent: "us" } }));
  assert.deepEqual(result, { ok: true, cards: 1 });
  assert.deepEqual(store.get().progress.cards, { ok: card });
  assert.equal(store.get().progress.session, null);
  assert.equal(store.get().settings.accent, "us");
  assert.equal(store.get().settings.onboarded, true);
  assert.deepEqual(JSON.parse(saved.get(key)!).cards, { ok: card });
});

const session = {
  id: "s1", started: 1, index: 0, newIds: ["ok"], reviewIds: [], graded: { ok: 3 },
  steps: [{ id: "ok", kind: "intro" }, { id: "ok", kind: "meaning", options: ["ok", "other"], retry: true }],
  pending: { correct: true, value: "ok" },
};

test("valid active and completed sessions survive sanitization", () => {
  for (const s of [session, { ...session, index: session.steps.length, finished: 2 }]) {
    assert.deepEqual(sanitizeProgress({ ...emptyProgress(datasetId), session: s }, datasetId).session, s);
  }
});

test("malformed session fields drop only the session", () => {
  const corruptions = [
    { newIds: undefined }, { newIds: [1] }, { reviewIds: undefined }, { reviewIds: "ok" },
    { started: undefined }, { started: "1" }, { started: NaN },
    { steps: [null] }, { steps: [{ id: 1, kind: "intro" }] }, { steps: [{ id: "ok", kind: "unknown" }] },
    { steps: [{ id: "ok", kind: "meaning", options: [1] }] }, { steps: [{ id: "ok", kind: "spell", retry: "yes" }] },
    { index: 0.5 }, { index: 99 }, { graded: { ok: 5 } },
    { pending: { correct: "yes", value: "ok" } }, { pending: { correct: true, value: 1 } }, { finished: "now" },
  ];
  const progress = { ...emptyProgress(datasetId), cards: { ok: card }, bookmarks: ["ok"], days: { "2026-10-25": { n: 1, r: 1, c: 1, t: 10 } } };
  for (const patch of corruptions) {
    assert.deepEqual(sanitizeProgress({ ...progress, session: { ...session, ...patch } }, datasetId), progress, JSON.stringify(patch));
  }
});

test("foreign writes cannot discard a pending local bookmark or review", () => {
  store.progress((p) => ({ ...p, cards: { ok: card }, days: { "2026-10-25": { n: 1, r: 1, c: 1, t: 10 } } }));
  toggleBookmark("ok");
  store.settings({ accent: "us" });
  const local = store.get();
  const oldEvent = foreignWrite(key, emptyProgress(datasetId));
  assert.deepEqual(store.get().progress, local.progress);
  assert.deepEqual(JSON.parse(saved.get(key)!), local.progress);
  assert.equal(JSON.parse(saved.get(settingsKey)!).accent, "us");
  events.dispatchEvent(oldEvent);
  assert.deepEqual(store.get().progress, local.progress, "a queued stale event must not overwrite the flushed edit");
});

test("idle tabs adopt current foreign progress and settings", () => {
  const incoming = { ...emptyProgress(datasetId), bookmarks: ["foreign"] };
  foreignWrite(key, incoming);
  foreignWrite(settingsKey, { ...defaultSettings, accent: "us" });
  assert.deepEqual(store.get().progress, incoming);
  assert.equal(store.get().settings.accent, "us");
  assert.equal(writes.length, 0);
});

test("a foreign settings event also preserves dirty local progress", () => {
  toggleBookmark("ok");
  store.settings({ accent: "us" });
  foreignWrite(settingsKey, defaultSettings);
  assert.equal(store.get().settings.accent, "us");
  assert.deepEqual(JSON.parse(saved.get(key)!).bookmarks, ["ok"]);
});

test("failed writes retry on flush, pagehide and visibilitychange", () => {
  for (const failed of [key, settingsKey]) for (const retry of [flush, () => events.dispatchEvent(new Event("pagehide")), () => documentEvents.dispatchEvent(new Event("visibilitychange"))]) {
    failKey = failed;
    toggleBookmark("ok");
    const wanted = store.get().progress;
    flush();
    assert.equal(store.get().saveError, true);
    const attempts = writes.length;
    failKey = undefined;
    retry();
    assert.ok(writes.length > attempts, "failed writes must stay dirty");
    assert.equal(store.get().saveError, false);
    assert.deepEqual(JSON.parse(saved.get(key)!), wanted);
    const succeeded = writes.length;
    flush();
    assert.equal(writes.length, succeeded, "a successful flush becomes clean");
  }
});

test("a failed conflict flush keeps the local edit for the next retry", () => {
  toggleBookmark("ok");
  failKey = key;
  foreignWrite(key, emptyProgress(datasetId));
  assert.deepEqual(store.get().progress.bookmarks, ["ok"]);
  assert.equal(store.get().saveError, true);
  failKey = undefined;
  flush();
  assert.deepEqual(JSON.parse(saved.get(key)!).bookmarks, ["ok"]);
});

test("default profile loads legacy keys without migrating or rewriting them", () => {
  assert.equal(initial.profiles.current, "default");
  assert.equal(initial.settings.accent, "us");
  assert.equal(initial.settings.onboarded, true);
  assert.deepEqual(initial.progress.bookmarks, ["legacy"]);
  assert.deepEqual(initialWrites, []);
});

test("a fresh startup restores the selected extra profile without reading legacy progress", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    const saved = ${JSON.stringify({
      [profilesKey]: JSON.stringify({ current: "child", list: [{ id: "default", name: "Основной" }, { id: "child", name: "Аня" }] }),
      [settingsKey]: JSON.stringify({ accent: "uk", dailyNew: 30 }),
      [key]: JSON.stringify({ version: 2, datasetId, bookmarks: ["parent"] }),
      "word-atlas:p:child:settings": JSON.stringify({ accent: "us", dailyNew: 5 }),
      [`word-atlas:p:child:v2:${datasetId}`]: JSON.stringify({ version: 2, datasetId, bookmarks: ["child"] }),
    })};
    globalThis.localStorage = { getItem: (key) => saved[key] ?? null, setItem: () => { throw new Error("unexpected write"); } };
    globalThis.window = { addEventListener() {}, clearTimeout() {} };
    globalThis.document = { addEventListener() {} };
    const { store } = await import(${JSON.stringify(new URL("./store.ts", import.meta.url).href)});
    store.useDataset(${JSON.stringify(datasetId)});
    process.stdout.write(JSON.stringify(store.get()));
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(result.stdout);
  assert.equal(state.profiles.current, "child");
  assert.equal(state.settings.accent, "us");
  assert.equal(state.settings.dailyNew, 5);
  assert.deepEqual(state.progress.bookmarks, ["child"]);
});

test("profile registry rejects malformed ids, duplicate ids and empty names", () => {
  assert.deepEqual(sanitizeProfiles(null), { current: "default", list: [{ id: "default", name: "Основной" }] });
  assert.deepEqual(sanitizeProfiles({ current: "missing", list: [null, { id: "x:settings", name: "Bad" }, { id: "a", name: " Аня " }, { id: "a", name: "Duplicate" }, { id: "b", name: " " }] }), { current: "a", list: [{ id: "a", name: "Аня" }] });
});

test("profiles isolate progress and settings and switching flushes pending edits", () => {
  toggleBookmark("parent");
  store.settings({ accent: "us", dailyNew: 20, onboarded: true });
  assert.equal(store.addProfile("  Аня  "), true);
  const child = store.get().profiles.current;
  assert.notEqual(child, "default");
  assert.equal(store.get().profiles.list.at(-1)!.name, "Аня");
  assert.deepEqual(JSON.parse(saved.get(key)!).bookmarks, ["parent"]);
  assert.equal(JSON.parse(saved.get(settingsKey)!).dailyNew, 20);
  assert.deepEqual(store.get().progress.bookmarks, []);
  assert.equal(store.get().settings.accent, "uk");
  assert.equal(store.get().settings.onboarded, false);
  toggleBookmark("child");
  store.settings({ dailyNew: 5, onboarded: true });
  assert.equal(store.switchProfile("default"), true);
  assert.deepEqual(JSON.parse(saved.get(`word-atlas:p:${child}:v2:${datasetId}`)!).bookmarks, ["child"]);
  assert.equal(JSON.parse(saved.get(`word-atlas:p:${child}:settings`)!).dailyNew, 5);
  assert.deepEqual(store.get().progress.bookmarks, ["parent"]);
  assert.equal(store.get().settings.dailyNew, 20);
  assert.equal(store.switchProfile(child), true);
  assert.deepEqual(store.get().progress.bookmarks, ["child"]);
  readFailKey = profilesKey;
  foreignWrite(profilesKey, { ...store.get().profiles, current: "default" });
  assert.equal(store.get().profiles.current, child);
  assert.deepEqual(store.get().progress.bookmarks, ["child"]);
  readFailKey = undefined;
  assert.equal(store.get().settings.dailyNew, 5);
});

test("profiles keep each dataset separate", () => {
  toggleBookmark("parent-open");
  store.useDataset("private-dataset");
  toggleBookmark("parent-private");
  assert.equal(store.addProfile("Боря"), true);
  const child = store.get().profiles.current;
  assert.deepEqual(store.get().progress.bookmarks, []);
  toggleBookmark("child-private");
  store.useDataset(datasetId);
  assert.deepEqual(store.get().progress.bookmarks, []);
  toggleBookmark("child-open");
  assert.equal(store.switchProfile("default"), true);
  assert.deepEqual(store.get().progress.bookmarks, ["parent-open"]);
  store.useDataset("private-dataset");
  assert.deepEqual(store.get().progress.bookmarks, ["parent-private"]);
  assert.equal(store.switchProfile(child), true);
  assert.deepEqual(store.get().progress.bookmarks, ["child-private"]);
});

test("failed progress or registry writes never switch away from unsaved progress", () => {
  for (const failed of [key, profilesKey]) {
    toggleBookmark("pending");
    const wanted = store.get().progress;
    failKey = failed;
    assert.equal(store.addProfile("Аня"), false);
    assert.equal(store.get().profiles.current, "default");
    assert.equal(store.get().profiles.list.length, 1);
    assert.deepEqual(store.get().progress, wanted);
    assert.equal(store.get().saveError, true);
    failKey = undefined;
    flush();
  }
  assert.equal(store.addProfile("Аня"), true);
  toggleBookmark("child-pending");
  failKey = `word-atlas:p:${store.get().profiles.current}:settings`;
  assert.equal(store.switchProfile("default"), false);
  assert.notEqual(store.get().profiles.current, "default");
  assert.deepEqual(store.get().progress.bookmarks, ["child-pending"]);
});

test("foreign profile events are ignored, including while current progress is dirty", () => {
  assert.equal(store.addProfile("Аня"), true);
  const child = store.get().profiles.current;
  assert.equal(store.switchProfile("default"), true);
  toggleBookmark("pending");
  const before = store.get();
  const attempts = writes.length;
  foreignWrite(`word-atlas:p:${child}:settings`, { ...defaultSettings, accent: "us" });
  foreignWrite(`word-atlas:p:${child}:v2:${datasetId}`, { ...emptyProgress(datasetId), bookmarks: ["foreign"] });
  assert.strictEqual(store.get(), before);
  assert.equal(writes.length, attempts);
  assert.equal(store.switchProfile(child), true);
  assert.equal(store.get().settings.accent, "us");
  assert.deepEqual(store.get().progress.bookmarks, ["foreign"]);
  const active = store.get();
  foreignWrite(key, emptyProgress(datasetId));
  foreignWrite(settingsKey, defaultSettings);
  assert.strictEqual(store.get(), active);
  foreignWrite(`word-atlas:p:${child}:settings`, { ...defaultSettings, dailyNew: 30 });
  assert.equal(store.get().settings.dailyNew, 30);
});

test("failed reads cannot replace a saved profile with empty progress", () => {
  toggleBookmark("parent");
  assert.equal(store.addProfile("Аня"), true);
  const child = store.get().profiles.current;
  toggleBookmark("child");
  assert.equal(store.switchProfile("default"), true);
  const before = new Map(saved);
  for (const failed of [profilesKey, `word-atlas:p:${child}:settings`, `word-atlas:p:${child}:v2:${datasetId}`]) {
    readFailKey = failed;
    assert.equal(store.switchProfile(child), false);
    assert.equal(store.get().profiles.current, "default");
    assert.deepEqual(store.get().progress.bookmarks, ["parent"]);
    assert.deepEqual(saved, before);
    readFailKey = undefined;
  }
  assert.equal(store.switchProfile(child), true);
  assert.deepEqual(store.get().progress.bookmarks, ["child"]);
});

test("registry changes flush the old profile before loading the selected profile", () => {
  assert.equal(store.addProfile("Аня"), true);
  const profiles = store.get().profiles;
  const child = profiles.current;
  assert.equal(store.switchProfile("default"), true);
  toggleBookmark("pending-parent");
  foreignWrite(profilesKey, profiles);
  assert.equal(store.get().profiles.current, child);
  assert.deepEqual(store.get().progress.bookmarks, []);
  assert.deepEqual(JSON.parse(saved.get(key)!).bookmarks, ["pending-parent"]);
  const renamed = { ...profiles, list: profiles.list.map((p) => ({ ...p, name: p.id === child ? "Анна" : p.name })) };
  foreignWrite(profilesKey, renamed);
  assert.equal(store.get().profiles.list.at(-1)!.name, "Анна");
});

test("a registry switch waits for a failed flush and retries on the next flush", () => {
  assert.equal(store.addProfile("Аня"), true);
  const profiles = store.get().profiles;
  assert.equal(store.switchProfile("default"), true);
  toggleBookmark("pending");
  failKey = key;
  foreignWrite(profilesKey, profiles);
  assert.equal(store.get().profiles.current, "default");
  assert.deepEqual(store.get().progress.bookmarks, ["pending"]);
  failKey = undefined;
  assert.equal(flush(), true);
  assert.equal(store.get().profiles.current, profiles.current);
  assert.deepEqual(JSON.parse(saved.get(key)!).bookmarks, ["pending"]);
});

test("deleting an extra profile removes only its namespace across all datasets", () => {
  toggleBookmark("parent");
  assert.equal(store.addProfile("Аня"), true);
  const child = store.get().profiles.current;
  toggleBookmark("child");
  flush();
  saved.set(`word-atlas:p:${child}:v2:other`, "{}");
  saved.set(`word-atlas:p:${child}-other:settings`, "keep");
  saved.set("other-app:data", "keep");
  assert.equal(store.deleteProfile(child), true);
  assert.equal(store.get().profiles.current, "default");
  assert.deepEqual(store.get().progress.bookmarks, ["parent"]);
  assert.equal([...saved.keys()].some((key) => key.startsWith(`word-atlas:p:${child}:`)), false);
  assert.equal(saved.get(`word-atlas:p:${child}-other:settings`), "keep");
  assert.equal(saved.get("other-app:data"), "keep");
  assert.equal(JSON.parse(saved.get(profilesKey)!).list.length, 1);
});

test("deleting the default profile removes legacy keys but preserves other profiles and app metadata", () => {
  toggleBookmark("parent");
  assert.equal(store.addProfile("Аня"), true);
  const child = store.get().profiles.current;
  toggleBookmark("child");
  saved.set("word-atlas:v2:other", "{}");
  saved.set("word-atlas:splash", "keep");
  saved.set("word-atlas:view", "keep");
  assert.equal(store.deleteProfile("default"), true);
  assert.equal(store.get().profiles.current, child);
  assert.equal(saved.has(settingsKey), false);
  assert.equal([...saved.keys()].some((key) => key.startsWith("word-atlas:v2:")), false);
  assert.deepEqual(JSON.parse(saved.get(`word-atlas:p:${child}:v2:${datasetId}`)!).bookmarks, ["child"]);
  assert.equal(saved.get("word-atlas:splash"), "keep");
  assert.equal(saved.get("word-atlas:view"), "keep");
  const before = new Map(saved);
  assert.equal(store.deleteProfile(child), false);
  assert.deepEqual(saved, before);
  assert.equal(store.get().saveError, false);
});

test("a delayed tab flush cannot recreate a deleted profile", () => {
  assert.equal(store.addProfile("Аня"), true);
  const child = store.get().profiles.current;
  toggleBookmark("unsaved-child");
  saved.set(profilesKey, JSON.stringify({ current: "default", list: [{ id: "default", name: "Основной" }] }));
  assert.equal(flush(), true);
  assert.equal(store.get().profiles.current, "default");
  assert.equal(saved.has(`word-atlas:p:${child}:settings`), false);
  assert.equal(saved.has(`word-atlas:p:${child}:v2:${datasetId}`), false);
});

test("failed deletion reports failure without touching another profile", () => {
  assert.equal(store.addProfile("Аня"), true);
  const child = store.get().profiles.current;
  toggleBookmark("child");
  flush();
  const childKey = `word-atlas:p:${child}:v2:${datasetId}`;
  const parent = saved.get(settingsKey);
  failKey = profilesKey;
  assert.equal(store.deleteProfile(child), false);
  assert.equal(saved.has(childKey), true);
  assert.equal(store.get().profiles.current, child);
  failKey = undefined;
  removeFailKey = childKey;
  assert.equal(store.deleteProfile(child), false);
  assert.equal(store.get().saveError, true);
  assert.equal(saved.get(settingsKey), parent);
});

test("renaming persists without changing profile data and backups use the current name", () => {
  toggleBookmark("legacy");
  failKey = profilesKey;
  assert.equal(store.renameProfile("default", "Маша / Оля"), false);
  assert.equal(store.get().saveError, true);
  failKey = undefined;
  assert.equal(store.renameProfile("default", "Маша / Оля"), true);
  assert.equal(store.get().saveError, false);
  assert.equal(JSON.parse(saved.get(profilesKey)!).list[0].name, "Маша / Оля");
  assert.deepEqual(JSON.parse(saved.get(key)!).bookmarks, ["legacy"]);
  assert.match(backupFilename(), /^word-atlas-Маша _ Оля-backup-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(store.addProfile(""), false);
  assert.equal(store.addProfile("x".repeat(41)), false);
  assert.equal(store.renameProfile("default", "  "), false);
  assert.equal(store.switchProfile("missing"), false);
  assert.equal(store.renameProfile("missing", "Тест"), false);
});

test("backup import writes only to the selected profile", () => {
  toggleBookmark("parent");
  assert.equal(store.addProfile("Аня"), true);
  const child = store.get().profiles.current;
  const result = importBackup(JSON.stringify({ app: "word-atlas", version: 2, progress: { ...emptyProgress(datasetId), cards: { ok: card } } }));
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(saved.get(key)!).bookmarks, ["parent"]);
  assert.deepEqual(JSON.parse(saved.get(`word-atlas:p:${child}:v2:${datasetId}`)!).cards, { ok: card });
});

test("persistent storage is requested once and rejection is harmless", () => {
  assert.equal(persistCalls, 1);
  assert.equal(store.addProfile("Аня"), true);
  assert.equal(store.switchProfile("default"), true);
  assert.equal(persistCalls, 1);
});
