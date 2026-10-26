import { duck } from "./sound";

let current: HTMLAudioElement | null = null;
let token = 0;
let cancel: (() => void) | null = null;

export function stopAudio() {
  token++;
  cancel?.();
  cancel = null;
  current?.pause();
  current = null;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  duck(false);
}

/** Play a recording, falling back to the device voice. Resolves when playback ends. */
export async function play(url: string | null | undefined, text: string, accent: "uk" | "us" | "ru" = "uk", rate = 1) {
  stopAudio();
  const mine = token;
  duck(true);
  try {
    return await speak(url, text, accent, rate, mine);
  } finally {
    if (mine === token) {
      current = null;
      duck(false);
    }
  }
}

async function speak(url: string | null | undefined, text: string, accent: "uk" | "us" | "ru", rate: number, mine: number) {
  if (url) {
    const a = new Audio(url);
    a.playbackRate = rate;
    current = a;
    try {
      await new Promise<void>((resolve, reject) => {
        const clear = () => {
          a.onended = a.onpause = a.onerror = null;
          if (cancel === done) cancel = null;
        };
        const done = () => { clear(); resolve(); };
        const failed = () => { clear(); reject(new Error("audio playback failed")); };
        cancel = done;
        a.onended = a.onpause = done;
        a.onerror = failed;
        try { void a.play().catch(failed); } catch { failed(); }
      });
      return mine === token ? "recorded" as const : "stopped" as const;
    } catch {
      if (mine !== token) return "stopped" as const;
      a.pause();
      current = null;
    }
  }
  if (!("speechSynthesis" in window)) return "unsupported" as const;
  let available = speechSynthesis.getVoices();
  if (accent === "ru" && !available.length) {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        speechSynthesis.removeEventListener("voiceschanged", changed);
        if (cancel === done) cancel = null;
        resolve();
      };
      const changed = () => { if (speechSynthesis.getVoices().length) done(); };
      const timer = setTimeout(done, 1000);
      cancel = done;
      speechSynthesis.addEventListener("voiceschanged", changed);
      changed();
    });
    if (mine !== token) return "stopped" as const;
    available = speechSynthesis.getVoices();
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = accent === "ru" ? "ru-RU" : accent === "uk" ? "en-GB" : "en-US";
  u.rate = rate * 0.95;
  const voices = available.filter((v) => accent === "ru" ? /^ru(?:-|$)/i.test(v.lang.replace("_", "-")) : v.lang.replace("_", "-") === u.lang);
  const best = voices.find((v) => /premium|enhanced|natural|google/i.test(v.name)) || voices[0];
  if (accent === "ru" && !best) return "unsupported" as const;
  if (best) u.voice = best;
  let ended = false;
  await new Promise<void>((r) => {
    const done = () => {
      u.onend = u.onerror = null;
      if (cancel === done) cancel = null;
      r();
    };
    cancel = done;
    u.onend = () => { ended = true; done(); };
    u.onerror = done;
    try { speechSynthesis.speak(u); } catch { done(); }
  });
  if (mine !== token) return "stopped" as const;
  return ended ? "device" as const : "unsupported" as const;
}
