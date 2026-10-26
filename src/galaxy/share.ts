import { toast } from "../ui/Toast";

const SERIF = '"Fraunces Variable", "Literata Variable", Georgia, "Times New Roman", serif';
const SANS = '-apple-system, "Segoe UI", Arial, sans-serif';

/** "My word galaxy": the live render framed as a 4:5 poster. */
export async function shareGalaxy(source: HTMLCanvasElement, lit: number, total: number) {
  try {
    const W = 1080;
    const H = 1350;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    await document.fonts.load(`600 72px ${SERIF}`).catch(() => null);
    g.fillStyle = "#090c18";
    g.fillRect(0, 0, W, H);
    // Cover-fit the galaxy into the upper part of the poster.
    const box = { x: 0, y: 0, w: W, h: 1020 };
    const s = Math.max(box.w / source.width, box.h / source.height);
    const sw = box.w / s;
    const sh = box.h / s;
    g.drawImage(source, (source.width - sw) / 2, (source.height - sh) / 2, sw, sh, box.x, box.y, box.w, box.h);
    const fade = g.createLinearGradient(0, 760, 0, 1080);
    fade.addColorStop(0, "rgba(9,12,24,0)");
    fade.addColorStop(1, "rgba(9,12,24,1)");
    g.fillStyle = fade;
    g.fillRect(0, 760, W, 330);
    const pad = 72;
    g.fillStyle = "rgba(243,236,223,.62)";
    g.font = `500 28px ${SANS}`;
    g.fillText("Моя звёздная карта слов", pad, 1110);
    g.fillStyle = "#f3ecdf";
    g.font = `600 76px ${SERIF}`;
    g.fillText(`Открыто звёзд: ${lit.toLocaleString("ru-RU")}`, pad, 1196, W - pad * 2);
    g.font = `400 28px ${SANS}`;
    g.fillStyle = "rgba(243,236,223,.6)";
    g.fillText(`Всего слов IELTS: ${total.toLocaleString("ru-RU")} · Каждое — новая звезда`, pad, 1248, W - pad * 2);
    g.fillStyle = "rgba(243,236,223,.16)";
    g.fillRect(pad, H - 66, W - pad * 2, 1);
    g.fillStyle = "#f3ecdf";
    g.font = `600 30px ${SERIF}`;
    g.fillText("Word Atlas · Атлас слов", pad, H - 26);
    g.font = `400 24px ${SANS}`;
    g.fillStyle = "rgba(243,236,223,.55)";
    const tag = "Слова в картинках. Подготовка к IELTS";
    g.fillText(tag, W - pad - g.measureText(tag).width, H - 28);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (!blob) throw new Error("no blob");
    const file = new File([blob], "word-atlas-galaxy.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (error) {
        if ((error as { name?: string } | null)?.name === "AbortError") return;
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("Звёздная карта сохранена", "ok");
  } catch {
    toast("Не удалось создать звёздную карту", "warn");
  }
}
