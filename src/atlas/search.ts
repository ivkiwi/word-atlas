import type { Atlas, WordRef } from "./types";

const normalize = (text: string) => text.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");

export function searchAtlas(atlas: Atlas, raw: string, limit = 40): WordRef[] {
  const q = normalize(raw.trim());
  if (!q) return [];
  const hits: [number, WordRef][] = [];
  for (const w of atlas.words) {
    const word = normalize(w.word);
    const meaning = normalize(w.ru);
    let score = 0;
    if (word === q) score = 1000;
    else if (word.startsWith(q)) score = 500 - word.length;
    else if (word.includes(q)) score = 200 - word.indexOf(q) - word.length;
    else if (meaning.includes(q)) score = Math.max(1, 60 - Math.min(40, meaning.indexOf(q)) - meaning.length * 0.2);
    if (score > 0) hits.push([score, w]);
  }
  hits.sort((a, b) => b[0] - a[0] || a[1].order - b[1].order);
  return hits.slice(0, limit).map(([, word]) => word);
}
