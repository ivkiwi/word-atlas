#!/usr/bin/env node
/** Check a running Russian atlas: node scripts/check-russian-ui.mjs [URL]. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = process.argv[2] || "http://127.0.0.1:5188/";
const output = path.join(root, ".local/russian-ui-check");
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const progressKey = "word-atlas:v2:word-atlas-open";
const words = new Map(JSON.parse(fs.readFileSync(path.join(root, "public/atlas/index.json"), "utf8")).words.map(([id, word]) => [id, word]));
const settings = { onboarded: true, startLevel: 0, dailyNew: 10, splash: false, autoplay: false, sfx: false, ambience: "off" };
let assertions = 0;

async function checkPage(page) {
  await page.locator(".page, .learn").first().waitFor();
  const state = await page.evaluate(() => ({
    language: document.documentElement.lang,
    text: document.body.innerText,
    labels: [...document.querySelectorAll("[aria-label],[title],[placeholder],[alt]")].flatMap((element) => ["aria-label", "title", "placeholder", "alt"].map((key) => element.getAttribute(key) || "")).join("\n"),
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  assert.equal(state.language, "ru");
  assert.ok(!/\p{Script=Han}/u.test(state.text + state.labels), "Chinese remains in the rendered interface");
  assert.ok(state.width <= state.viewport + 1, `Horizontal overflow at ${page.url()}: ${state.width} > ${state.viewport}`);
  assertions += 3;
}

async function makeContext(width, theme = "light", patch = {}) {
  // Block service workers so page.route() failure injection also works against a production build.
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 812 : 900 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: theme, acceptDownloads: true, serviceWorkers: "block" });
  await context.addInitScript((saved) => {
    if (!localStorage.getItem("word-atlas:settings")) localStorage.setItem("word-atlas:settings", JSON.stringify(saved));
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  }, { ...settings, theme, ...patch });
  return context;
}

try {
  for (const width of [320, 375, 768, 1440]) {
    for (const theme of ["light", "dark"]) {
      const context = await makeContext(width, theme);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const [name, hash] of [["today", "#/"], ["atlas", "#/atlas"], ["word", "#/atlas?w=library"], ["galaxy", "#/atlas?view=galaxy"], ["practice", "#/practice"], ["me", "#/me"], ["about", "#/about"]]) {
        await page.goto(new URL(hash, app).href, { waitUntil: "networkidle" });
        if (name === "word") await page.locator(".senses .ru").first().waitFor();
        await checkPage(page);
        if (theme === "light" && ["today", "atlas", "word", "galaxy"].includes(name)) await page.screenshot({ path: path.join(output, `${name}-${width < 600 ? "mobile" : "desktop"}.png`) });
      }
      assert.deepEqual(errors, [], "Unexpected browser errors");
      await context.close();
      console.log(`Rendered pages: ${width}px, ${theme}`);
    }
  }

  const context = await makeContext(1440);
  const page = await context.newPage();
  await page.goto(new URL("#/atlas", app).href, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Слово или перевод на русский").fill("БИБЛИОТЕКА");
  await page.locator(".tile").filter({ hasText: "library" }).first().click();
  await page.getByRole("heading", { name: "library", exact: true }).waitFor();
  assert.match(await page.locator(".senses .ru").first().innerText(), /библиотека/i);
  const wordDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Создать карточку для публикации", exact: true }).click();
  await (await wordDownload).saveAs(path.join(output, "word-card.png"));
  await page.keyboard.press("Escape");
  await page.getByPlaceholder("Слово или перевод на русский").blur();
  await page.keyboard.press("/");
  await page.getByPlaceholder("Поиск: serendipity / природа").fill("БИБЛИОТЕКА");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "library", exact: true }).waitFor();
  assertions += 3;

  await page.goto(new URL("#/", app).href, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Начать занятие", exact: true }).click();
  for (let n = 0; n < 5; n++) await page.getByRole("button", { name: "Запомнили", exact: true }).click();
  await page.locator(".option").first().waitFor();
  await page.waitForFunction((key) => {
    const session = JSON.parse(localStorage.getItem(key) || "{}").session;
    return session && session.steps[session.index]?.kind !== "intro";
  }, progressKey);
  const questionId = await page.evaluate((key) => { const session = JSON.parse(localStorage.getItem(key)).session; return session.steps[session.index].id; }, progressKey);
  await page.locator(`.option[data-option="${questionId}"]`).click();
  assert.match(await page.locator(".feedback-verdict").innerText(), /Верно/);
  await page.getByRole("button", { name: "Приостановить и вернуться", exact: true }).click();
  await page.goto(new URL("#/", app).href, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Продолжить занятие", exact: true }).click();
  let finished = false;
  for (let n = 0; n < 60; n++) {
    await page.waitForFunction((key) => {
      const session = JSON.parse(localStorage.getItem(key)).session;
      return session.finished ? !!document.querySelector(".summary") : session.index === Number(document.querySelector(".learn-progress")?.getAttribute("aria-valuenow")) && !!session.pending === !!document.querySelector(".feedback");
    }, progressKey);
    const session = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).session, progressKey);
    if (session.finished) { finished = true; break; }
    const step = session.steps[session.index];
    if (session.pending) {
      await page.getByRole("button", { name: "Продолжить", exact: true }).click();
    } else if (step.kind === "intro") {
      await page.getByRole("button", { name: "Запомнили", exact: true }).click();
    } else {
      if (step.kind === "spell") {
        await page.locator(".spell-input").fill(words.get(step.id));
        await page.getByRole("button", { name: /Ответить/ }).click();
      } else {
        await page.locator(`.option[data-option="${step.id}"]`).click();
      }
      assert.match(await page.locator(".feedback-verdict").innerText(), /Верно/);
      assertions++;
    }
    await page.waitForFunction(({ key, index, answered }) => {
      const current = JSON.parse(localStorage.getItem(key)).session;
      return answered ? current.index === index && !!current.pending : current.index > index;
    }, { key: progressKey, index: session.index, answered: !session.pending && step.kind !== "intro" });
  }
  assert.ok(finished, "Learning session did not finish");
  await page.getByText("Занятие завершено", { exact: true }).waitFor();
  await checkPage(page);
  await page.evaluate(() => {
    window.__cardText = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) { window.__cardText.push(text); return fillText.call(this, text, ...args); };
  });
  const resultDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Поделиться результатом", exact: true }).click();
  await (await resultDownload).saveAs(path.join(output, "session-card.png"));
  assert.ok((await page.evaluate(() => window.__cardText)).includes("Слов: 10 · Точность: 100%"), "Session card undercounts words");
  assertions++;

  await page.goto(new URL("#/me", app).href, { waitUntil: "networkidle" });
  const backupDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Экспортировать копию", exact: true }).click();
  const backup = path.join(output, "backup.json");
  await (await backupDownload).saveAs(backup);
  const originalCards = Object.keys(JSON.parse(fs.readFileSync(backup, "utf8")).progress.cards).length;
  assert.ok(originalCards > 0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Сбросить прогресс", exact: true }).click();
  await page.waitForFunction((key) => Object.keys(JSON.parse(localStorage.getItem(key) || "{}").cards || {}).length === 0, progressKey);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('input[type="file"]').setInputFiles(backup);
  await page.waitForFunction(({ key, count }) => Object.keys(JSON.parse(localStorage.getItem(key) || "{}").cards || {}).length === count, { key: progressKey, count: originalCards });
  assertions += 3;

  await page.goto(new URL("#/practice", app).href, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Путь изучения", exact: true }).click();
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).click();
  const target = await page.locator(".typing-text").innerText();
  await page.getByRole("textbox", { name: "Введите ответ здесь", exact: true }).fill(target);
  await page.getByText("Задание 2 из 10", { exact: false }).waitFor();
  assertions++;
  await context.close();
  console.log("Search, word card, learning, backup/restore and typing passed");

  const missing = await makeContext(375);
  const missingPage = await missing.newPage();
  await missingPage.route("**/atlas/entries/*.json*", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await missingPage.goto(app, { waitUntil: "networkidle" });
  await missingPage.getByRole("button", { name: "Начать занятие", exact: true }).click();
  await missingPage.getByRole("button", { name: "Повторить загрузку", exact: true }).waitFor();
  assert.match(await missingPage.getByRole("alert").innerText(), /Не удалось загрузить/);
  await missingPage.unroute("**/atlas/entries/*.json*");
  await missingPage.getByRole("button", { name: "Повторить загрузку", exact: true }).click();
  await missingPage.getByRole("button", { name: "Запомнили", exact: true }).waitFor();
  await missing.close();

  const practiceFailure = await makeContext(375);
  const practicePage = await practiceFailure.newPage();
  await practicePage.route("**/atlas/entries/*.json*", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await practicePage.goto(new URL("#/practice", app).href, { waitUntil: "networkidle" });
  await practicePage.getByRole("button", { name: "Начать тренировку", exact: true }).click();
  assert.match(await practicePage.getByRole("alert").innerText(), /Не удалось загрузить/);
  await practicePage.unroute("**/atlas/entries/*.json*");
  await practicePage.getByRole("button", { name: "Начать тренировку", exact: true }).click();
  await practicePage.getByRole("textbox", { name: "Введите ответ здесь", exact: true }).waitFor();
  await practiceFailure.close();
  assertions += 4;

  const welcome = await makeContext(375, "light", { onboarded: false });
  const welcomePage = await welcome.newPage();
  await welcomePage.goto(app, { waitUntil: "networkidle" });
  await welcomePage.getByRole("dialog", { name: "Добро пожаловать", exact: true }).waitFor();
  await checkPage(welcomePage);
  await welcomePage.getByRole("button", { name: "Начать", exact: true }).click();
  await welcomePage.locator(".greet").waitFor();
  await welcome.close();

  for (const mode of ["http", "network", "json"]) {
    const failure = await makeContext(375);
    const errorPage = await failure.newPage();
    await errorPage.route("**/atlas/index.json*", (route) => mode === "network" ? route.abort() : route.fulfill({ status: mode === "http" ? 503 : 200, contentType: "application/json", body: "broken" }));
    await errorPage.goto(app, { waitUntil: "networkidle" });
    await errorPage.getByRole("button", { name: "Перезагрузить", exact: true }).waitFor();
    const message = await errorPage.locator(".boot p").innerText();
    assert.match(message, /Не удалось|повреждены/);
    assert.ok(!/Failed to fetch|Unexpected token/.test(message));
    assertions += 2;
    await failure.close();
  }

  // Russian voice lines are muted (VOICE_LINES = false); re-enable the spoken check when they return.
  for (const voices of [[{ lang: "ru-RU", name: "Milena" }], [{ lang: "en-GB", name: "Daniel" }]]) {
    const voice = await makeContext(375, "light", { splash: true, sfx: true });
    await voice.addInitScript((voices) => {
      window.__spoken = [];
      speechSynthesis.getVoices = () => voices;
      Object.defineProperty(SpeechSynthesisUtterance.prototype, "voice", { configurable: true, get() { return this.__voice ?? null; }, set(v) { this.__voice = v; } });
      speechSynthesis.speak = (utterance) => { window.__spoken.push({ text: utterance.text, lang: utterance.lang }); setTimeout(() => utterance.onend?.(new Event("end")), 0); };
    }, voices);
    const voicePage = await voice.newPage();
    await voicePage.goto(app, { waitUntil: "networkidle" });
    await voicePage.locator(".splash").click({ position: { x: 180, y: 250 } });
    // VOICE_LINES is off in src/config.ts: no Russian line may be spoken, with or without a Russian voice.
    await voicePage.waitForTimeout(1500);
    assert.deepEqual(await voicePage.evaluate(() => window.__spoken.filter((s) => s.lang === "ru-RU")), []);
    await voice.close();
    assertions++;
  }
  console.log(`Russian UI checks passed: ${assertions} assertions. Screenshots: ${path.relative(root, output)}`);
} finally {
  await browser.close();
}
