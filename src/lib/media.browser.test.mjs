// Browser checks: start `npm run dev -- --port 5204 --strictPort`, then `node --test src/lib/media.browser.test.mjs`.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

let browser;
before(async () => {
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
});
after(async () => { await browser?.close(); });

async function pageForTest(t) {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  t.after(() => page.close());
  await page.addInitScript(() => localStorage.setItem("word-atlas:settings", JSON.stringify({ onboarded: true, splash: false, autoplay: false, sfx: false, ambience: "off" })));
  await page.goto("http://127.0.0.1:5204/#/atlas", { waitUntil: "networkidle" });
  return page;
}

test("WebGL context restoration redraws the galaxy and keeps star state", async (t) => {
  const page = await pageForTest(t);
  const result = await page.evaluate(async () => {
    const { GalaxyEngine } = await import("/src/galaxy/engine.ts");
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:240px;height:240px";
    document.body.append(canvas);
    const layout = { n: 1, positions: new Float32Array([0, 0, 0]), colors: new Float32Array([1, 0.8, 0.3]), seeds: new Float32Array([0.5]), ids: ["word"], index: new Map([["word", 0]]), topicCenters: [[0, 0, 0]] };
    const engine = new GalaxyEngine(canvas, layout, { quality: "low", reducedMotion: true, preserve: true });
    engine.resize();
    engine.setState(0, 3);
    engine.start();
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await frame();
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 required for this regression check");
    const pixel = () => { const p = new Uint8Array(4); gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return [...p]; };
    const before = pixel();
    const extension = gl.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("WEBGL_lose_context required");
    const lost = new Promise((resolve) => canvas.addEventListener("webglcontextlost", (e) => resolve(e.defaultPrevented), { once: true }));
    extension.loseContext();
    const prevented = await lost;
    if (!prevented) { engine.destroy(); canvas.remove(); return { prevented }; }
    engine.setState(0, 2);
    const restored = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Context was not restored")), 3000);
      canvas.addEventListener("webglcontextrestored", () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
    // Chromium allows restoreContext() only after the lost event has finished dispatching.
    await new Promise((resolve) => setTimeout(resolve, 0));
    extension.restoreContext();
    await restored;
    await frame();
    const after = pixel();
    const values = new Float32Array(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, engine.stateBuf);
    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, values);
    const error = gl.getError();
    engine.destroy();
    const detached = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(detached);
    canvas.remove();
    return { prevented, before, after, state: values[0], error, listenerRemoved: !detached.defaultPrevented };
  });
  assert.equal(result.prevented, true);
  assert.ok(result.before[0] > 0);
  assert.ok(result.after[0] > 0, "restored context must contain rendered pixels");
  assert.equal(result.state, 2, "state changed while lost must reach the rebuilt GPU buffer");
  assert.equal(result.error, 0);
  assert.equal(result.listenerRemoved, true);
});

for (const kind of ["word", "session", "galaxy"]) {
  for (const failure of ["NotAllowedError", "AbortError", "success"]) test(`${kind} share: ${failure}`, async (t) => {
    const page = await pageForTest(t);
    const downloads = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    await page.evaluate(async ({ kind, failure }) => {
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
      Object.defineProperty(navigator, "share", { configurable: true, value: async () => { if (failure !== "success") throw new DOMException("test share response", failure); } });
      const atlas = { img: () => null, byId: new Map() };
      if (kind === "word") {
        const { shareWord } = await import("/src/ui/share.ts");
        await shareWord(atlas, { id: "test", w: "test", senses: [{ pos: "n.", ru: "тест" }], ex: [] });
      } else if (kind === "session") {
        const { shareSession } = await import("/src/ui/shareSession.ts");
        await shareSession(atlas, { steps: [], graded: {}, newIds: [], reviewIds: [] });
      } else {
        const { shareGalaxy } = await import("/src/galaxy/share.ts");
        await shareGalaxy(document.createElement("canvas"), 1, 1);
      }
    }, { kind, failure });
    if (failure === "NotAllowedError") {
      await page.waitForFunction(() => document.querySelector(".toast"), undefined, { timeout: 2000 });
      assert.equal(downloads.length, 1);
      assert.match((await page.locator(".toast").allTextContents()).join(" "), /сохранена/);
    } else {
      await page.waitForTimeout(100);
      assert.equal(downloads.length, 0);
      assert.equal(await page.locator(".toast").count(), 0);
    }
  });
}
