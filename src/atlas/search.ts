import type { Atlas, WordRef } from "./types";

const normalize = (text: string) => text.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");

export function searchAtlas(atlas: Atlas, raw: string, limit = 40): WordRef[] {
  const q = normalize(raw.trim());
  if (!q) return [];
  const hits: [number, WordRef][] = [];
  for (const w of atlas.words) {
    const word = normalize(w.word);
    const meaning = normalize(w.search ?? w.ru);
    let score = 0;
    if (word === q) score = 1000;
    else if (word.startsWith(q)) score = 500 - word.length;
    else if (word.includes(q)) score = 200 - word.indexOf(q) - word.length;
    else if (meaning.includes(q)) {
      for (const value of meaning.split(/[;,]/)) {
        const segment = value.trim();
        const first = segment.indexOf(q);
        if (first < 0) continue;
        let rank = segment === q ? 80 : first === 0 ? 60 : 20;
        if (rank === 20)
          for (let at = first; at >= 0; at = segment.indexOf(q, at + 1))
            if (!/[\p{L}\p{N}_]$/u.test(segment.slice(0, at))) {
              rank = 40;
              break;
            }
        // Length must not move a match below a weaker match tier.
        score = Math.max(score, rank - Math.min(19, segment.length * 0.2));
      }
    }
    if (score > 0) hits.push([score, w]);
  }
  hits.sort((a, b) => b[0] - a[0] || a[1].order - b[1].order);
  return hits.slice(0, limit).map(([, word]) => word);
}
