import { ArrowUpRight, Database, Github, Heart } from "lucide-react";
import { useAtlas } from "../atlas/context";
import { REPO_URL } from "../config";

const BASE = import.meta.env.BASE_URL;

export function About() {
  const atlas = useAtlas();
  return (
    <div className="page about">
      <header className="about-hero">
        <img src={`${BASE}brand/og.webp`} alt="" />
        <div>
          <p className="eyebrow">О Word Atlas</p>
          <h1 className="display">У каждого слова — своя история.</h1>
          <p className="lede">
            Word Atlas объединяет {atlas.count.toLocaleString("ru-RU")} английских слов для подготовки к IELTS. У каждого — иллюстрация, бытовой пример и пример в контексте IELTS, британское и американское произношение, сочетания и подсказки. Изучите слово — на вашей карте зажжётся новая звезда.
          </p>
          <p className="lede">Бесплатно, с открытым кодом, без регистрации. Код доступен по лицензии MIT, словарь — по CC BY 4.0.</p>
          <div className="about-actions">
            <a className="btn btn-primary" href={REPO_URL} target="_blank" rel="noreferrer">
              <Github size={18} /> Открыть на GitHub
            </a>
            <a className="btn btn-ghost" href={`${REPO_URL}/tree/main/data`} target="_blank" rel="noreferrer">
              <Database size={18} /> Скачать словарь: JSON / CSV
            </a>
          </div>
        </div>
      </header>

      <div className="about-grid">
        <section className="panel">
          <h3 className="eyebrow">Как запоминаются слова</h3>
          <ul className="feature-list">
            <li>
              <b>Сначала увидеть.</b>Иллюстрация к каждому слову показывает ситуацию из первого примера.
            </li>
            <li>
              <b>Затем вспомнить.</b>Выбор значения, пропуски в предложениях, аудирование и написание: от узнавания к уверенному владению.
            </li>
            <li>
              <b>Повторить вовремя.</b>FSRS — открытый алгоритм интервального повторения, который используется и в Anki. Он предлагает повторить слово, когда оно начинает забываться.
            </li>
            <li>
              <b>Честная статистика.</b>Засчитывается только первый ответ. Слова с ошибками встретятся снова в другом задании; повторные попытки не повышают точность.
            </li>
            <li>
              <b>Ваш прогресс принадлежит вам.</b>Без аккаунтов и сервера: прогресс хранится в браузере. Его можно в любой момент выгрузить в файл.
            </li>
          </ul>
        </section>

        <section className="panel">
          <h3 className="eyebrow">Горячие клавиши</h3>
          <dl className="keys">
            <div>
              <dt>
                <kbd>⌘</kbd>
                <kbd>K</kbd> или <kbd>/</kbd>
              </dt>
              <dd>Поиск по всему словарю</dd>
            </div>
            <div>
              <dt>
                <kbd>1</kbd>–<kbd>4</kbd>
              </dt>
              <dd>Выбрать ответ</dd>
            </div>
            <div>
              <dt>
                <kbd>Enter</kbd>
              </dt>
              <dd>Ответить / продолжить</dd>
            </div>
            <div>
              <dt>
                <kbd>←</kbd> <kbd>→</kbd>
              </dt>
              <dd>Предыдущее / следующее слово в карточке</dd>
            </div>
            <div>
              <dt>
                <kbd>Esc</kbd>
              </dt>
              <dd>Закрыть окно</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h3 className="eyebrow">Откуда взяты материалы</h3>
          <p className="muted">
            Значения, примеры, сочетания и подсказки созданы языковой моделью по единому словарному стандарту. Иллюстрации сгенерированы в едином стиле, английская озвучка — в ElevenLabs: Alice (британский вариант) и Sarah (американский). Русские переводы подготовлены языковыми моделями по английским и китайским исходникам. Структура и полнота проверяются автоматически; постатейной редакторской проверки не было. Об ошибках можно сообщить в GitHub Issues или предложить исправление через PR.
          </p>
          <p className="muted">Word Atlas не является официальным словарём IELTS и не гарантирует рост балла. Его задача — сделать изучение слов нагляднее и осмысленнее.</p>
        </section>

        <section className="panel">
          <h3 className="eyebrow">Разработчикам</h3>
          <p className="muted">
            <code>data/word-atlas.ru.json</code> и <code>word-atlas.ru.csv</code> — полный русский словарь; <code>public/atlas</code> содержит данные приложения, иллюстрации и аудио. Можно создавать колоды Anki, приложения, расширения и наборы для оценки ИИ, указав авторство.
          </p>
          <a className="link" href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer">
            Документация <ArrowUpRight size={14} />
          </a>
        </section>
      </div>
      <p className="colophon">
        <Heart size={14} /> Для всех, кто учит слова.
      </p>
    </div>
  );
}
