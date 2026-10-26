#!/usr/bin/env node
/** Validate the public Word Atlas dataset: structure, references and media files. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public/atlas");
const index = JSON.parse(fs.readFileSync(path.join(pub, "index.json"), "utf8"));
const source = JSON.parse(fs.readFileSync(path.join(root, "data/word-atlas.json"), "utf8"));
const russian = JSON.parse(fs.readFileSync(path.join(root, "data/word-atlas.ru.json"), "utf8"));
const errors = [];
const warn = { headwordNotInExample: 0, missingIpa: 0, oneExample: 0 };
const fail = (msg) => errors.length < 50 && errors.push(msg);
const chinese = /\p{Script=Han}/u;

if (index.words.length !== index.count) fail(`count ${index.count} != rows ${index.words.length}`);
if (index.locale !== "ru-RU" || index.fields[2] !== "ru") fail("Russian locale/schema missing");
if (JSON.stringify(index.fields) !== JSON.stringify(["id", "word", "ru", "ipa", "cefr", "topic", "media", "search"])) fail("Search index schema changed");
if (typeof index.rev !== "string" || !/^[a-f0-9]{64}$/.test(index.rev)) fail("Content revision missing or invalid");
if (index.id !== "word-atlas-open") fail("Dataset ID changed; existing progress would be lost");
if (russian.length !== source.length || russian.length !== index.count) fail("Russian export is incomplete");
if (chinese.test(JSON.stringify(index))) fail("Chinese remains in the search index or topics");
const ids = new Set();
index.words.forEach((r, i) => {
  const [id, word, ru, , cefr, topic, media, search] = r;
  if (r.length !== 8 || typeof search !== "string" || !search) fail(`bad search text: ${id}`);
  if (!/^[a-z0-9-]{1,64}$/.test(id) || ids.has(id)) fail(`bad or duplicate id at ${i}: ${id}`);
  ids.add(id);
  if (!word || !ru) fail(`empty word or meaning: ${id}`);
  if (!(cefr >= 0 && cefr < index.cefr.length)) fail(`bad level: ${id}`);
  if (!(topic >= 0 && topic < index.topics.length)) fail(`bad topic: ${id}`);
  const need = [
    [1, `img/${id}.webp`],
    [1, `thumb/${id}.webp`],
    [2, `audio/uk/${id}.mp3`],
    [4, `audio/us/${id}.mp3`],
    [8, `audio/ex/${id}.mp3`],
    [16, `audio/ex2/${id}.mp3`],
  ];
  for (const [bit, file] of need) if (media & bit && !fs.existsSync(path.join(pub, file))) fail(`missing ${file}`);
});

let entries = 0;
let examples = 0;
const revision = createHash("sha256");
for (let n = 0; n * index.chunk < index.count; n++) {
  const raw = fs.readFileSync(path.join(pub, `entries/${n}.json`));
  revision.update(raw);
  const chunk = JSON.parse(raw.toString("utf8"));
  chunk.forEach((e, k) => {
    const row = index.words[n * index.chunk + k];
    if (!row || row[0] !== e.id) return fail(`chunk ${n} out of order at ${e.id}`);
    entries++;
    if (!Array.isArray(e.senses) || !e.senses.length || e.senses.some((s) => !s.ru)) fail(`no Russian senses: ${e.id}`);
    if (row[2] !== `${e.senses[0]?.pos} ${e.senses[0]?.ru}` || row[7] !== e.senses.map((s) => s.ru).join("; ")) fail(`indexed meanings differ: ${e.id}`);
    if (!Array.isArray(e.ex) || !e.ex.length || e.ex.some((x) => !x.en || !x.ru)) fail(`bad Russian examples: ${e.id}`);
    if (chinese.test(JSON.stringify(e))) fail(`Chinese remains in entry: ${e.id}`);
    const position = n * index.chunk + k;
    const original = source[position];
    if (!original || ["id", "w", "uk", "us", "cefr", "topic"].some((field) => e[field] !== original[field])) fail(`original identity/order changed: ${e.id}`);
    if (original && (JSON.stringify(e.ex.map((x) => x.en)) !== JSON.stringify(original.ex.map((x) => x.en)) || JSON.stringify(e.senses.map((s) => s.en)) !== JSON.stringify(original.senses.map((s) => s.en)))) fail(`English teaching text changed: ${e.id}`);
    if (original && ["senses", "ex", "col", "fam", "syn", "ant"].some((field) => e[field].length !== original[field].length)) fail(`content omitted: ${e.id}`);
    const { m, ...exported } = e;
    if (JSON.stringify(exported) !== JSON.stringify(russian[position])) fail(`runtime and download differ: ${e.id}`);
    if (m !== row[6]) fail(`media flags differ: ${e.id}`);
    examples += e.ex.length;
    if (e.ex.length < 2) warn.oneExample++;
    if (!e.uk && !e.us) warn.missingIpa++;
    const stem = e.w.toLowerCase().split(" ")[0].replace(/(e|y)$/, "").slice(0, 5);
    if (e.ex[0] && !e.ex[0].en.toLowerCase().includes(stem)) warn.headwordNotInExample++;
    for (const k of ["col", "fam", "syn", "ant"]) if (!Array.isArray(e[k])) fail(`${k} not array: ${e.id}`);
  });
}
if (entries !== index.count) fail(`entries ${entries} != count ${index.count}`);
if (examples !== index.examples) fail(`examples ${examples} != ${index.examples}`);
if (revision.digest("hex") !== index.rev) fail("Content revision differs from entry chunks");

for (const directory of ["src", "docs"]) {
  for (const entry of fs.readdirSync(path.join(root, directory), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(tsx?|css|md)$/.test(entry.name) || entry.name.endsWith(".test.ts")) continue;
    const filename = path.join(entry.parentPath, entry.name);
    if (chinese.test(fs.readFileSync(filename, "utf8"))) fail(`untranslated interface/documentation: ${path.relative(root, filename)}`);
  }
}
for (const filename of ["README.md", "README.en.md", "SECURITY.md", "CONTRIBUTING.md", "CONTENT_LICENSE.md", "data/README.md", "index.html", "public/manifest.webmanifest"]) {
  if (chinese.test(fs.readFileSync(path.join(root, filename), "utf8"))) fail(`untranslated text: ${filename}`);
}

const bits = (b) => index.words.filter((r) => r[6] & b).length;
console.log(
  JSON.stringify(
    { words: index.count, examples, illustrated: bits(1), ukAudio: bits(2), usAudio: bits(4), sentenceAudio: bits(8), ieltsSentenceAudio: bits(16), warnings: warn, errors: errors.length },
    null,
    1,
  ),
);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
