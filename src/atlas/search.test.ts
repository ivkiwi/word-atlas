import assert from "node:assert/strict";
import { test } from "node:test";
import type { Atlas, WordRef } from "./types";
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
