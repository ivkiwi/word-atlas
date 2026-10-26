import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Atlas, IndexRow, WordRef } from "./types";
import { searchAtlas } from "./search";

const words = [
  { id: "library", word: "library", ru: "сущ. библиотека; читальный зал", order: 0 },
  { id: "tree", word: "tree", ru: "сущ. дерево; ёлка", order: 1 },
  { id: "liberate", word: "liberate", ru: "гл. освобождать", order: 2 },
] as WordRef[];
const atlas = { words } as Atlas;

test("searches Russian meanings regardless of case and е/ё spelling", () => {
  assert.equal(searchAtlas(atlas, "  БИБЛИОТЕКА ")[0]?.id, "library");
  assert.equal(searchAtlas(atlas, "елка")[0]?.id, "tree");
  assert.equal(searchAtlas(atlas, "ЁЛКА")[0]?.id, "tree");
});

test("keeps English exact/prefix ranking, result limits and empty queries", () => {
  assert.deepEqual(searchAtlas(atlas, "lib").map((word) => word.id), ["library", "liberate"]);
  assert.equal(searchAtlas(atlas, "library")[0]?.id, "library");
  assert.equal(searchAtlas(atlas, "lib", 1).length, 1);
  assert.deepEqual(searchAtlas(atlas, " "), []);
  assert.deepEqual(searchAtlas(atlas, "несуществующее"), []);
});

test("searches every sense without changing the first meaning shown on tiles", () => {
  const words = [
    { id: "miss", word: "miss", ru: "гл. пропустить", search: "пропустить; скучать", order: 0 },
    { id: "spring", word: "spring", ru: "сущ. весна", search: "весна; пружина; родник", order: 1 },
    { id: "fir", word: "fir", ru: "сущ. пихта", search: "пихта; ёлка", order: 2 },
  ] as WordRef[];
  const atlas = { words } as Atlas;
  for (const [query, id] of [["СКУЧАТЬ", "miss"], ["пружина", "spring"], ["родник", "spring"], ["елка", "fir"]])
    assert.equal(searchAtlas(atlas, query)[0]?.id, id);
  assert.equal(searchAtlas(atlas, "пружина")[0]?.ru, "сущ. весна");
  assert.equal(searchAtlas(atlas, "spring")[0]?.id, "spring");
});

test("ranks the intended words first in the real Russian index", () => {
  const index = JSON.parse(readFileSync(new URL("../../public/atlas/index.json", import.meta.url), "utf8")) as { words: IndexRow[] };
  const atlas = { words: index.words.map((r, order) => ({ id: r[0], word: r[1], ru: r[2], search: r[7], order })) } as Atlas;
  for (const [query, id] of [["дом", "house"], ["библиотека", "library"], ["дерево", "tree"], ["скучать", "miss"], ["пружина", "spring"]])
    assert.equal(searchAtlas(atlas, query)[0]?.id, id, query);
});

test("ranks separate meanings by exact, prefix, word-start and substring matches", () => {
  const words = [
    { id: "substring", word: "beside", search: "рядом с", order: 0 },
    { id: "word-start", word: "cottage", search: "загородный дом", order: 1 },
    { id: "prefix", word: "housewife", search: `домохозяйка ${"длинное пояснение ".repeat(20)}`, order: 2 },
    { id: "exact", word: "house", search: `${"другие значения; ".repeat(20)}дом, жильё`, order: 3 },
  ] as WordRef[];
  assert.deepEqual(searchAtlas({ words } as Atlas, "дом").map((w) => w.id), ["exact", "prefix", "word-start", "substring"]);
  const expanded = words.map((w) => ({ ...w, search: `${w.search}; ${"другое значение, ".repeat(20)}` }));
  assert.deepEqual(searchAtlas({ words: expanded } as Atlas, "дом").map((w) => w.id), ["exact", "prefix", "word-start", "substring"]);
});

test("finds later word-start matches and treats multiword queries literally", () => {
  for (const [query, inside, boundary] of [["дом", "рядом", "рядом с домом"], ["жилой дом", "нежилой дом", "большой жилой дом"], ["c++", "abc++", "язык c++"]]) {
    const words = [
      { id: "inside", word: "one", search: inside, order: 0 },
      { id: "boundary", word: "two", search: boundary, order: 1 },
    ] as WordRef[];
    assert.deepEqual(searchAtlas({ words } as Atlas, query).map((w) => w.id), ["boundary", "inside"], query);
  }
});

test("uses the matching segment length when ranking matches of the same kind", () => {
  const words = [
    { id: "longer", word: "one", search: "домовой", order: 0 },
    { id: "shorter", word: "two", search: `домик; ${"прочее значение, ".repeat(20)}`, order: 1 },
  ] as WordRef[];
  assert.deepEqual(searchAtlas({ words } as Atlas, "дом").map((w) => w.id), ["shorter", "longer"]);
});

test("keeps English matches ahead of exact Russian meaning matches", () => {
  const words = [
    { id: "meaning", word: "meaning", search: "cat", order: 0 },
    { id: "bobcat", word: "bobcat", search: "рысь", order: 1 },
    { id: "catalogue", word: "catalogue", search: "каталог", order: 2 },
    { id: "cater", word: "cater", search: "обслуживать", order: 3 },
    { id: "cat", word: "cat", search: "кошка", order: 4 },
  ] as WordRef[];
  assert.deepEqual(searchAtlas({ words } as Atlas, "CAT").map((w) => w.id), ["cat", "cater", "catalogue", "bobcat", "meaning"]);
});
