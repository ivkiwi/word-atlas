import type { Atlas, Entry, IndexRow, WordRef } from "./types";
import { MEDIA } from "./types";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const url = (p: string) => `${BASE}/atlas/${p}`;

interface IndexFile {
  id: string;
  rev: string;
  name: string;
  count: number;
  examples: number;
  illustrated: number;
  chunk: number;
  topics: [string, string][];
  cefr: string[];
  words: IndexRow[];
}

export async function loadOpenAtlas(): Promise<Atlas> {
  const res = await fetch(url("index.json"), { cache: "no-cache" }).catch(() => {
    throw new Error("Не удалось загрузить словарь. Проверьте подключение к сети и перезагрузите страницу.");
  });
  if (!res.ok) throw new Error(`Не удалось загрузить индекс словаря (HTTP ${res.status}). Попробуйте перезагрузить страницу.`);
  const idx = (await res.json().catch(() => {
    throw new Error("Данные словаря повреждены. Попробуйте перезагрузить страницу.");
  })) as IndexFile;
  const words: WordRef[] = idx.words.map((r, order) => ({
    id: r[0],
    word: r[1],
    ru: r[2],
    ipa: r[3],
    cefr: r[4],
    topic: r[5],
    media: r[6],
    search: r[7],
    order,
  }));
  const byId = new Map(words.map((w) => [w.id, w]));
  const cache = new Map<string, Entry>();
  const pending = new Map<number, Promise<void>>();

  const loadChunk = (n: number) => {
    let p = pending.get(n);
    if (!p) {
      p = fetch(url(`entries/${n}.json?v=${encodeURIComponent(idx.rev)}`))
        .then((r) => {
          if (!r.ok) throw new Error(`Не удалось загрузить карточку слова (HTTP ${r.status}). Попробуйте открыть её ещё раз.`);
          return r.json() as Promise<Entry[]>;
        })
        .then((list) => list.forEach((e) => cache.set(e.id, e)))
        .catch((e) => {
          pending.delete(n);
          throw e instanceof TypeError || e instanceof SyntaxError
            ? new Error("Не удалось загрузить карточку слова. Проверьте подключение к сети и откройте её ещё раз.")
            : e;
        });
      pending.set(n, p);
    }
    return p;
  };

  return {
    id: idx.id,
    name: idx.name,
    kind: "open",
    count: idx.count,
    examples: idx.examples,
    illustrated: idx.illustrated,
    topics: idx.topics,
    cefr: idx.cefr,
    words,
    byId,
    peek: (id) => cache.get(id),
    async entry(id) {
      const hit = cache.get(id);
      if (hit) return hit;
      const ref = byId.get(id);
      if (!ref) throw new Error(`Слово «${id}» не найдено.`);
      await loadChunk(Math.floor(ref.order / idx.chunk));
      const e = cache.get(id);
      if (!e) throw new Error(`Слово «${id}» не найдено.`);
      return e;
    },
    img: (ref, size = "full") =>
      ("media" in ref && typeof ref.media === "number" ? ref.media : (ref as Entry).m) & MEDIA.img
        ? url(`${size === "thumb" ? "thumb" : "img"}/${ref.id}.webp`)
        : null,
    audio(ref, kind) {
      const m = "media" in ref && typeof ref.media === "number" ? ref.media : (ref as Entry).m;
      const bit = MEDIA[kind];
      return m & bit ? url(`audio/${kind}/${ref.id}.mp3`) : null;
    },
  };
}

/** Rows from the legacy private catalog served only by the local dev server. */
interface PrivateWord {
  id: string;
  seq: number;
  word: string;
  meaning: string;
  phonetic: string;
  sentence: string;
  translation: string;
  hint: string;
  image?: string | null;
  uk?: string | null;
  us?: string | null;
  sentenceAudio?: string | null;
}

export async function loadPrivateAtlas(open: Atlas | null): Promise<Atlas | null> {
  let res: Response;
  try {
    res = await fetch("/local/catalog.json", { cache: "no-store" });
  } catch {
    return null;
  }
  if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) return null;
  const cat = (await res.json()) as { id: string; name: string; words: PrivateWord[] };
  const entries = new Map<string, Entry>();
  const twins = new Map(open?.words.map((o) => [o.word.toLowerCase(), o]) ?? []);
  const words: WordRef[] = cat.words.map((w, order) => {
    const twin = twins.get(w.word.toLowerCase());
    const pos = (w.meaning.match(/·\s*([a-z]+\.)\s*$/) || [])[1] || "";
    const ru = w.meaning.replace(/\s*·\s*[a-z]+\.\s*$/, "");
    entries.set(w.id, {
      id: w.id,
      w: w.word,
      uk: w.phonetic,
      us: "",
      senses: [{ pos, ru, en: "" }],
      ex: w.sentence ? [{ en: w.sentence, ru: w.translation }] : [],
      col: [],
      fam: [],
      syn: [],
      ant: [],
      tip: w.hint,
      cefr: twin ? (open?.cefr[twin.cefr] ?? "B1") : "B1",
      topic: twin ? (open?.topics[twin.topic]?.[0] ?? "thinking") : "thinking",
      m: (w.image ? MEDIA.img : 0) | (w.uk ? MEDIA.uk : 0) | (w.us ? MEDIA.us : 0) | (w.sentenceAudio ? MEDIA.ex : 0),
      media: { img: w.image, uk: w.uk, us: w.us, ex: w.sentenceAudio },
    });
    return {
      id: w.id,
      word: w.word,
      ru: `${pos} ${ru}`.trim(),
      ipa: w.phonetic,
      cefr: twin?.cefr ?? 2,
      topic: twin?.topic ?? 16,
      media: entries.get(w.id)!.m,
      order,
    };
  });
  const byId = new Map(words.map((w) => [w.id, w]));
  const pick = (ref: WordRef | Entry) => entries.get(ref.id)?.media;
  return {
    id: cat.id,
    name: cat.name,
    kind: "private",
    count: words.length,
    examples: [...entries.values()].reduce((n, e) => n + e.ex.length, 0),
    illustrated: words.filter((w) => w.media & MEDIA.img).length,
    topics: open?.topics ?? [["thinking", "Общее"]],
    cefr: open?.cefr ?? ["A1", "A2", "B1", "B2", "C1", "C2"],
    words,
    byId,
    peek: (id) => entries.get(id),
    entry: async (id) => {
      const e = entries.get(id);
      if (!e) throw new Error(`Слово «${id}» не найдено.`);
      return e;
    },
    img: (ref) => pick(ref)?.img ?? null,
    audio: (ref, kind) => pick(ref)?.[kind] ?? null,
  };
}
