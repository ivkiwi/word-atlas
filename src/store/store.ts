import { useSyncExternalStore } from "react";
import type { Accent } from "../atlas/types";
import type { CardState, Grade } from "./srs";

export type QuizKind = "meaning" | "picture" | "listen" | "spell";
export type Step = { id: string; kind: "intro" } | { id: string; kind: QuizKind; retry?: boolean; options?: string[] };

export interface ActiveSession {
  id: string;
  started: number;
  steps: Step[];
  index: number;
  /** First-attempt grade per word; retries never change it. */
  graded: Record<string, Grade>;
  newIds: string[];
  reviewIds: string[];
  /** Answer shown but not yet continued; survives reload without double counting. */
  pending?: { correct: boolean; value: string };
  finished?: number;
}

export interface DayStat {
  n: number; // new words met
  r: number; // graded reviews (first attempts)
  c: number; // correct first attempts
  t: number; // active seconds
}

export interface TypingRound {
  at: number;
  mode: "word" | "sentence" | "dictation";
  items: number;
  wpm: number;
  accuracy: number;
}

export interface Progress {
  version: 2;
  datasetId: string;
  cards: Record<string, CardState>;
  bookmarks: string[];
  days: Record<string, DayStat>;
  typing: TypingRound[];
  session: ActiveSession | null;
  /** Rolling list of recent mistakes, newest first. */
  mistakes: string[];
}

export interface Settings {
  accent: Accent;
  autoplay: boolean;
  dailyNew: number;
  retention: number;
  theme: "system" | "light" | "dark";
  sfx: boolean;
  spell: boolean;
  startLevel: number;
  onboarded: boolean;
  dataset: "open" | "private";
  ambience: "off" | "stars" | "rain" | "sea" | "forest" | "fire" | "voyage" | "cafe";
  ambienceVolume: number;
  splash: boolean;
}

export const defaultSettings: Settings = {
  accent: "uk",
  autoplay: true,
  dailyNew: 10,
  retention: 0.9,
  theme: "dark",
  sfx: true,
  spell: true,
  startLevel: 0,
  onboarded: false,
  dataset: "open",
  ambience: "stars",
  ambienceVolume: 0.45,
  splash: true,
};

export const emptyProgress = (datasetId: string): Progress => ({
  version: 2,
  datasetId,
  cards: {},
  bookmarks: [],
  days: {},
  typing: [],
  session: null,
  mistakes: [],
});

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface Profiles {
  current: string;
  list: { id: string; name: string }[];
}

const PROFILES_KEY = "word-atlas:profiles";
const profilePrefix = (id: string) => id === "default" ? "word-atlas:" : `word-atlas:p:${id}:`;
const settingsKey = (profile = state.profiles.current) => `${profilePrefix(profile)}settings`;
const progressKey = (id: string, profile = state.profiles.current) => `${profilePrefix(profile)}v2:${id}`;

function read<T>(key: string, strict = false): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    if (strict) throw error;
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ---------- validation (backups and stored data are untrusted) ---------- */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, lo = -Infinity, hi = Infinity) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export function sanitizeProfiles(v: unknown): Profiles {
  const list: Profiles["list"] = [];
  if (isObj(v) && Array.isArray(v.list)) for (const p of v.list) {
    if (isObj(p) && typeof p.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(p.id) && typeof p.name === "string" && p.name.trim() && !list.some((x) => x.id === p.id))
      list.push({ id: p.id, name: p.name.trim().slice(0, 40) });
  }
  if (!list.length) list.push({ id: "default", name: "Основной" });
  const current = isObj(v) && list.some((p) => p.id === v.current) ? v.current as string : list[0].id;
  return { current, list };
}

function validCard(v: unknown): v is CardState {
  return (
    isObj(v) &&
    num(v.due, 0) &&
    num(v.s, 0) &&
    num(v.d, 0, 11) &&
    num(v.el, 0) &&
    num(v.sd, 0) &&
    num(v.ls, 0) &&
    num(v.reps, 0) &&
    num(v.lapses, 0) &&
    [0, 1, 2, 3].includes(v.st as number) &&
    (v.last === undefined || num(v.last, 0)) &&
    num(v.seen, 0)
  );
}

export function sanitizeProgress(v: unknown, datasetId: string): Progress {
  const out = emptyProgress(datasetId);
  if (!isObj(v) || v.version !== 2) return out;
  if (isObj(v.cards)) for (const [k, c] of Object.entries(v.cards)) if (validCard(c)) out.cards[k] = c;
  if (Array.isArray(v.bookmarks)) out.bookmarks = v.bookmarks.filter((x): x is string => typeof x === "string").slice(0, 20000);
  if (Array.isArray(v.mistakes)) out.mistakes = v.mistakes.filter((x): x is string => typeof x === "string").slice(0, 300);
  if (isObj(v.days))
    for (const [k, d] of Object.entries(v.days))
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && isObj(d) && num(d.n, 0) && num(d.r, 0) && num(d.c, 0) && num(d.t, 0))
        out.days[k] = { n: d.n as number, r: d.r as number, c: d.c as number, t: d.t as number };
  if (Array.isArray(v.typing))
    out.typing = v.typing
      .filter(
        (t): t is TypingRound =>
          isObj(t) && num(t.at, 0) && ["word", "sentence", "dictation"].includes(t.mode as string) && num(t.items, 0) && num(t.wpm, 0, 400) && num(t.accuracy, 0, 100),
      )
      .slice(-500);
  const s = v.session;
  if (
    isObj(s) && typeof s.id === "string" && num(s.started, 0) && strings(s.newIds) && strings(s.reviewIds) &&
    Array.isArray(s.steps) && s.steps.every((step) =>
      isObj(step) && typeof step.id === "string" && ["intro", "meaning", "picture", "listen", "spell"].includes(step.kind as string) &&
      (step.retry === undefined || typeof step.retry === "boolean") && (step.options === undefined || strings(step.options)),
    ) && Number.isInteger(s.index) && num(s.index, 0, s.steps.length) &&
    isObj(s.graded) && Object.values(s.graded).every((grade) => [1, 2, 3, 4].includes(grade as number)) &&
    (s.pending === undefined || (isObj(s.pending) && typeof s.pending.correct === "boolean" && typeof s.pending.value === "string")) &&
    (s.finished === undefined || num(s.finished, 0))
  )
    out.session = s as unknown as ActiveSession;
  return out;
}

export function sanitizeSettings(v: unknown): Settings {
  const s = { ...defaultSettings };
  if (!isObj(v)) return s;
  if (v.accent === "uk" || v.accent === "us") s.accent = v.accent;
  if (typeof v.autoplay === "boolean") s.autoplay = v.autoplay;
  if (num(v.dailyNew, 0, 100)) s.dailyNew = Math.round(v.dailyNew as number);
  if (num(v.retention, 0.7, 0.97)) s.retention = v.retention as number;
  if (v.theme === "system" || v.theme === "light" || v.theme === "dark") s.theme = v.theme;
  if (typeof v.sfx === "boolean") s.sfx = v.sfx;
  if (typeof v.spell === "boolean") s.spell = v.spell;
  if (num(v.startLevel, 0, 5)) s.startLevel = Math.round(v.startLevel as number);
  if (typeof v.onboarded === "boolean") s.onboarded = v.onboarded;
  if (v.dataset === "open" || v.dataset === "private") s.dataset = v.dataset;
  if (["off", "stars", "rain", "sea", "forest", "fire", "voyage", "cafe"].includes(v.ambience as string)) s.ambience = v.ambience as Settings["ambience"];
  if (num(v.ambienceVolume, 0, 1)) s.ambienceVolume = v.ambienceVolume as number;
  if (typeof v.splash === "boolean") s.splash = v.splash;
  return s;
}

/* ---------- store ---------- */

interface State {
  profiles: Profiles;
  progress: Progress;
  settings: Settings;
  saveError: boolean;
}

const profiles = sanitizeProfiles(read(PROFILES_KEY));
let state: State = {
  profiles,
  progress: emptyProgress("word-atlas-open"),
  settings: sanitizeSettings(read(settingsKey(profiles.current))),
  saveError: false,
};
const listeners = new Set<() => void>();
let saveTimer: number | undefined;
/** Only write when this tab changed something, so idle tabs never clobber newer data. */
let dirty = false;
/** Progress is written only after it has been read from storage for this dataset. */
let loadedId: string | null = null;

function emit() {
  listeners.forEach((l) => l());
}

function scheduleSave() {
  dirty = true;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flush, 250);
}

function saveError(failed: boolean) {
  if (state.saveError !== failed) {
    state = { ...state, saveError: failed };
    emit();
  }
}

function loadProfile(profiles: Profiles, persist = false) {
  try {
    const changed = profiles.current !== state.profiles.current;
    const id = state.progress.datasetId;
    const next = changed
      ? { ...state, profiles, progress: sanitizeProgress(read(progressKey(id, profiles.current), true), id), settings: sanitizeSettings(read(settingsKey(profiles.current), true)), saveError: false }
      : { ...state, profiles };
    if (persist && !write(PROFILES_KEY, profiles)) {
      saveError(true);
      return false;
    }
    if (changed) {
      window.clearTimeout(saveTimer);
      dirty = false;
      loadedId = id;
    }
    state = persist ? { ...next, saveError: false } : next;
    emit();
    return true;
  } catch {
    saveError(true);
    return false;
  }
}

export function flush() {
  window.clearTimeout(saveTimer);
  const registered = read(PROFILES_KEY);
  const profiles = registered ? sanitizeProfiles(registered) : state.profiles;
  // A deleted profile must not be recreated by a delayed write from another tab.
  if (!profiles.list.some((p) => p.id === state.profiles.current)) {
    return loadProfile(profiles);
  }
  if (dirty) {
    const progressOk = loadedId !== state.progress.datasetId || write(progressKey(state.progress.datasetId), state.progress);
    const ok = progressOk && write(settingsKey(), state.settings);
    dirty = !ok;
    saveError(!ok);
    if (!ok) return false;
  }
  if (profiles.current !== state.profiles.current) return loadProfile(profiles);
  return true;
}

if (typeof window !== "undefined") {
  try { void navigator.storage?.persist?.().catch(() => {}); } catch { /* optional browser permission */ }
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  // shortcut: pending local edits win conflicts; merge per record if simultaneous edits must preserve both tabs.
  window.addEventListener("storage", (e) => {
    if (e.key === PROFILES_KEY) {
      let profiles;
      try { profiles = sanitizeProfiles(read(PROFILES_KEY, true)); } catch { saveError(true); return; }
      if (profiles.list.some((p) => p.id === state.profiles.current) && !flush()) return;
      loadProfile(profiles);
      return;
    }
    if (!e.newValue || (e.key !== settingsKey() && e.key !== progressKey(state.progress.datasetId))) return;
    if (dirty) {
      flush();
      return;
    }
    try {
      const value = localStorage.getItem(e.key);
      if (!value) return;
      if (e.key === settingsKey()) state = { ...state, settings: sanitizeSettings(JSON.parse(value)) };
      else state = { ...state, progress: sanitizeProgress(JSON.parse(value), state.progress.datasetId) };
      emit();
    } catch {
      /* ignore malformed writes */
    }
  });
}

function profilesForEdit() {
  if (!flush()) return null;
  try { return sanitizeProfiles(read(PROFILES_KEY, true) ?? state.profiles); } catch (error) {
    if (error instanceof SyntaxError) return state.profiles;
    saveError(true);
    return null;
  }
}

export const store = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  switchProfile(id: string) {
    const profiles = profilesForEdit();
    if (!profiles) return false;
    if (!profiles.list.some((p) => p.id === id)) return false;
    return loadProfile({ ...profiles, current: id }, true);
  },
  addProfile(name: string) {
    name = name.trim();
    if (!name || name.length > 40) return false;
    const profiles = profilesForEdit();
    if (!profiles) return false;
    const id = crypto.randomUUID();
    return loadProfile({ current: id, list: [...profiles.list, { id, name }] }, true);
  },
  renameProfile(id: string, name: string) {
    name = name.trim();
    if (!name || name.length > 40) return false;
    const profiles = profilesForEdit();
    if (!profiles) return false;
    if (!profiles.list.some((p) => p.id === id)) return false;
    return loadProfile({ ...profiles, list: profiles.list.map((p) => p.id === id ? { ...p, name } : p) }, true);
  },
  deleteProfile(id: string) {
    const profiles = profilesForEdit();
    if (!profiles) return false;
    const list = profiles.list.filter((p) => p.id !== id);
    if (!list.length || list.length === profiles.list.length) return false;
    const keys: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (id === "default" ? key === settingsKey(id) || key.startsWith("word-atlas:v2:") : key.startsWith(profilePrefix(id)))) keys.push(key);
      }
      if (!loadProfile({ current: profiles.current === id ? list[0].id : profiles.current, list }, true)) return false;
      keys.forEach((key) => localStorage.removeItem(key));
      return true;
    } catch {
      saveError(true);
      return false;
    }
  },
  useDataset(datasetId: string) {
    flush();
    state = { ...state, progress: sanitizeProgress(read(progressKey(datasetId)), datasetId) };
    loadedId = datasetId;
    emit();
  },
  progress(fn: (p: Progress) => Progress) {
    state = { ...state, progress: fn(state.progress) };
    emit();
    scheduleSave();
  },
  settings(patch: Partial<Settings>) {
    state = { ...state, settings: { ...state.settings, ...patch } };
    emit();
    scheduleSave();
  },
};

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(state), () => select(state));
}

export function bumpDay(p: Progress, patch: Partial<DayStat>): Progress {
  const k = dayKey();
  const d = p.days[k] ?? { n: 0, r: 0, c: 0, t: 0 };
  return {
    ...p,
    days: {
      ...p.days,
      [k]: { n: d.n + (patch.n ?? 0), r: d.r + (patch.r ?? 0), c: d.c + (patch.c ?? 0), t: d.t + (patch.t ?? 0) },
    },
  };
}

export function toggleBookmark(id: string) {
  store.progress((p) => ({
    ...p,
    bookmarks: p.bookmarks.includes(id) ? p.bookmarks.filter((x) => x !== id) : [id, ...p.bookmarks],
  }));
}

/* ---------- backup ---------- */

export function exportBackup() {
  flush();
  const { progress, settings } = state;
  return JSON.stringify({ app: "word-atlas", version: 2, exported: new Date().toISOString(), progress: { ...progress, session: null }, settings }, null, 1);
}

export function backupFilename() {
  const profile = state.profiles.list.find((p) => p.id === state.profiles.current)!;
  return `word-atlas-${profile.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")}-backup-${dayKey()}.json`;
}

function markDirty() {
  dirty = true;
}

export function importBackup(text: string): { ok: true; cards: number } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Файл содержит некорректный JSON." };
  }
  if (!isObj(data) || data.app !== "word-atlas" || data.version !== 2 || !isObj(data.progress))
    return { ok: false, error: "Это не резервная копия Word Atlas." };
  if (data.progress.version !== 2) return { ok: false, error: "Эта версия прогресса в резервной копии не поддерживается." };
  const id = state.progress.datasetId;
  if (data.progress.datasetId !== id) return { ok: false, error: "Эта копия относится к другому словарю. Сначала выберите его в настройках." };
  const progress = sanitizeProgress({ ...data.progress, session: null }, id);
  state = { ...state, progress, settings: { ...sanitizeSettings(data.settings), onboarded: true } };
  emit();
  markDirty();
  flush();
  return { ok: true, cards: Object.keys(progress.cards).length };
}

export function resetProgress() {
  state = { ...state, progress: emptyProgress(state.progress.datasetId) };
  emit();
  markDirty();
  flush();
}
