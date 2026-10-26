import { Download, RotateCcw, Upload } from "lucide-react";
import { useMemo, useRef } from "react";
import { useAtlas } from "../atlas/context";
import { isMastered } from "../store/srs";
import { backupFilename, dayKey, exportBackup, importBackup, resetProgress, store, useStore, type Settings } from "../store/store";
import { toast } from "../ui/Toast";
import { streakOf } from "./Today";

export function Me({ privateAvailable }: { privateAvailable: boolean }) {
  const atlas = useAtlas();
  const progress = useStore((s) => s.progress);
  const settings = useStore((s) => s.settings);
  const saveError = useStore((s) => s.saveError);
  const profiles = useStore((s) => s.profiles);
  const profile = profiles.list.find((p) => p.id === profiles.current)!;
  const file = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => {
    const cards = Object.values(progress.cards);
    const days = Object.values(progress.days);
    const r = days.reduce((n, d) => n + d.r, 0);
    const c = days.reduce((n, d) => n + d.c, 0);
    const t = days.reduce((n, d) => n + d.t, 0);
    const now = Date.now();
    const forecast = Array.from({ length: 7 }, (_, i) => {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      end.setDate(end.getDate() + i);
      const start = new Date(end);
      start.setHours(0, 0, 0, 0);
      return cards.filter((x) => (i === 0 ? x.due <= end.getTime() : x.due >= start.getTime() && x.due <= end.getTime())).length;
    });
    void now;
    return { learned: cards.length, mastered: cards.filter(isMastered).length, reviews: r, accuracy: r ? Math.round((c / r) * 100) : 0, minutes: Math.round(t / 60), forecast };
  }, [progress]);

  const set = (patch: Partial<Settings>) => store.settings(patch);
  const download = () => {
    const blob = new Blob([exportBackup()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = backupFilename();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const restore = async (f: File) => {
    if (f.size > 30 * 1024 * 1024) return toast("Файл слишком большой для резервной копии. Допустимо до 30 МБ.", "warn");
    const profileId = store.get().profiles.current;
    const text = await f.text();
    if (store.get().profiles.current !== profileId) return toast("Профиль изменился. Выберите файл резервной копии ещё раз.", "warn");
    if (!confirm(`Заменить прогресс профиля «${profile.name}» в этом словаре данными из резервной копии? Это действие нельзя отменить. Сначала рекомендуем экспортировать текущий прогресс.`)) return;
    const r = importBackup(text);
    toast(r.ok ? `Прогресс восстановлен. Слов: ${r.cards.toLocaleString("ru-RU")}` : r.error, r.ok ? "ok" : "warn");
  };
  const maxF = Math.max(1, ...stats.forecast);

  return (
    <div className="page me">
      <header className="page-head">
        <p className="eyebrow">Мой прогресс</p>
        <h1 className="display">Ваша вселенная слов</h1>
      </header>

      <section className="stat-strip">
        <div>
          <dt>Дней подряд</dt>
          <dd>
            {streakOf(progress.days)}
            <small>дн.</small>
          </dd>
        </div>
        <div>
          <dt>Открыто</dt>
          <dd>{stats.learned.toLocaleString("ru-RU")}</dd>
        </div>
        <div>
          <dt>В долговременной памяти</dt>
          <dd>{stats.mastered.toLocaleString("ru-RU")}</dd>
        </div>
        <div>
          <dt>Точность первого ответа</dt>
          <dd>
            {stats.accuracy}
            <small>%</small>
          </dd>
        </div>
        <div>
          <dt>Время занятий</dt>
          <dd>
            {stats.minutes}
            <small>мин</small>
          </dd>
        </div>
      </section>

      <div className="me-grid">
        <section className="panel">
          <h3 className="eyebrow">Последние 20 недель</h3>
          <Heatmap days={progress.days} />
          <p className="muted">Каждая клетка — один день. Чем темнее цвет, тем больше ответов. В долговременной памяти — слова со стабильностью запоминания не менее 21 дня.</p>
        </section>

        <section className="panel">
          <h3 className="eyebrow">Повторения на ближайшие 7 дней</h3>
          <ol className="forecast">
            {stats.forecast.map((n, i) => (
              <li key={i}>
                <span style={{ height: `${(n / maxF) * 100}%` }} />
                <b>{n}</b>
                <small>{i === 0 ? "Сегодня" : i === 1 ? "Завтра" : `+${i}`}</small>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel settings">
          <h3 className="eyebrow">Настройки обучения</h3>
          <Field label="Новых слов в день" hint="Повторения без лимита: алгоритм выбирает слова, которые начинают забываться.">
            <div className="segmented">
              {[5, 10, 15, 20, 30].map((n) => (
                <button key={n} className={settings.dailyNew === n ? "is-on" : ""} onClick={() => set({ dailyNew: n })}>
                  {n}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Начальный уровень" hint="Пропустить простые слова, которые уже знакомы.">
            <div className="segmented">
              {atlas.cefr.map((l, i) => (
                <button key={l} className={settings.startLevel === i ? "is-on" : ""} onClick={() => set({ startLevel: i })}>
                  {l}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Целевой уровень запоминания" hint="Чем выше значение, тем чаще повторения. Обычно удобно начать с 90%.">
            <div className="segmented">
              {[0.85, 0.9, 0.95].map((n) => (
                <button key={n} className={settings.retention === n ? "is-on" : ""} onClick={() => set({ retention: n })}>
                  {Math.round(n * 100)}%
                </button>
              ))}
            </div>
          </Field>
          <Field label="Произношение">
            <div className="segmented">
              <button className={settings.accent === "uk" ? "is-on" : ""} onClick={() => set({ accent: "uk" })}>
                Британское
              </button>
              <button className={settings.accent === "us" ? "is-on" : ""} onClick={() => set({ accent: "us" })}>
                Американское
              </button>
            </div>
          </Field>
          <Field label="Тема оформления">
            <div className="segmented">
              {(
                [
                  ["system", "Системная"],
                  ["light", "Светлая"],
                  ["dark", "Тёмная"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} className={settings.theme === k ? "is-on" : ""} onClick={() => set({ theme: k })}>
                  {l}
                </button>
              ))}
            </div>
          </Field>
          <Toggle label="Автоматически произносить слова" on={settings.autoplay} set={(v) => set({ autoplay: v })} />
          <Toggle label="Звуки интерфейса" on={settings.sfx} set={(v) => set({ sfx: v })} />
          <Toggle label="Заставка при входе (раз в день)" on={settings.splash} set={(v) => set({ splash: v })} />
          <Toggle label="Задания на написание при повторении" on={settings.spell} set={(v) => set({ spell: v })} />
          {privateAvailable && (
            <Field label="Словарь" hint="Личный словарь доступен только на локальном сервере разработки и не входит в сборку.">
              <div className="segmented">
                <button className={settings.dataset === "open" ? "is-on" : ""} onClick={() => set({ dataset: "open" })}>
                  Открытый атлас
                </button>
                <button className={settings.dataset === "private" ? "is-on" : ""} onClick={() => set({ dataset: "private" })}>
                  Личный словарь 8000
                </button>
              </div>
            </Field>
          )}
        </section>

        <section className="panel">
          <h3>Профиль «{profile.name}»</h3>
          <p className="muted">У каждого профиля свои настройки и прогресс. Профили доступны только на этом устройстве.</p>
          <div className="data-actions">
            <button className="btn btn-ghost" onClick={() => {
              const name = prompt("Новое имя профиля (до 40 символов)", profile.name);
              if (name === null) return;
              if (!name.trim() || name.trim().length > 40) return toast("Введите имя от 1 до 40 символов.", "warn");
              const ok = store.renameProfile(profile.id, name);
              toast(ok ? "Имя профиля сохранено" : "Не удалось сохранить имя профиля. Проверьте свободное место в браузере.", ok ? "ok" : "warn");
            }}>Переименовать профиль</button>
            <button className="btn btn-ghost btn-danger" disabled={profiles.list.length === 1} onClick={() => {
              if (!confirm(`Удалить профиль «${profile.name}» и весь его прогресс во всех словарях? Это действие нельзя отменить. Сначала рекомендуем экспортировать резервную копию.`)) return;
              const ok = store.deleteProfile(profile.id);
              toast(ok ? "Профиль удалён" : "Не удалось полностью удалить профиль. Проверьте доступ к хранилищу браузера.", ok ? "ok" : "warn");
            }}>Удалить профиль</button>
          </div>
          {profiles.list.length === 1 && <p className="muted">Последний профиль удалить нельзя. Чтобы очистить его данные, сбросьте прогресс ниже.</p>}
        </section>

        <section className="panel">
          <h3 className="eyebrow">Данные</h3>
          <p className="muted">Прогресс хранится только в браузере этого устройства. Чтобы перенести его, экспортируйте резервную копию и импортируйте на другом устройстве.</p>
          {saveError && <p className="warn-text">Браузер не может сохранить прогресс: возможно, включён приватный режим или заполнено хранилище. Экспортируйте резервную копию.</p>}
          <div className="data-actions">
            <button className="btn btn-ghost" onClick={download}>
              <Download size={18} /> Экспортировать копию
            </button>
            <button className="btn btn-ghost" onClick={() => file.current?.click()}>
              <Upload size={18} /> Импортировать копию
            </button>
            <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0]).finally(() => (e.target.value = ""))} />
            <button
              className="btn btn-ghost btn-danger"
              onClick={() => {
                if (confirm("Удалить весь прогресс этого словаря? Это действие нельзя отменить. Сначала рекомендуем экспортировать резервную копию.")) {
                  resetProgress();
                  toast("Прогресс удалён");
                }
              }}
            >
              <RotateCcw size={18} /> Сбросить прогресс
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <div>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="field toggle">
      <b>{label}</b>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => set(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

function Heatmap({ days }: { days: Record<string, { r: number }> }) {
  const weeks = 20;
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (weeks * 7 - 1) - end.getDay());
  const cells: { k: string; v: number; future: boolean }[] = [];
  const d = new Date(start);
  for (let i = 0; i < (weeks + 1) * 7; i++) {
    const k = dayKey(d);
    cells.push({ k, v: days[k]?.r ?? 0, future: d > end });
    d.setDate(d.getDate() + 1);
  }
  const lvl = (v: number) => (v === 0 ? 0 : v < 10 ? 1 : v < 25 ? 2 : v < 50 ? 3 : 4);
  return (
    <div className="heatmap" role="img" aria-label="Календарь активности">
      {cells.map((c) => (
        <span key={c.k} className={`h${c.future ? "x" : lvl(c.v)}`} title={`${c.k} · ответов: ${c.v}`} />
      ))}
    </div>
  );
}
