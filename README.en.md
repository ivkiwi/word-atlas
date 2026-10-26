# Word Atlas · Russian edition

[Русская документация](README.md)

The Russian edition of [designfuchen/word-atlas](https://github.com/designfuchen/word-atlas): 7,298 English IELTS vocabulary entries, 14,596 examples with Russian translations, illustrations, UK/US audio and FSRS spaced repetition.

The interface, search, learning prompts, meanings, collocations and usage tips are in Russian. English definitions, examples and recordings are preserved. The original English–Chinese exports remain available separately.

<img src="docs/assets/today-desktop.jpg" alt="Russian Word Atlas interface" width="100%">

## Run locally

```bash
npm ci
npm run dev
```

Open `http://localhost:5188`. Run `npm test`, `npm run check:atlas` and `npm run build` to validate the application. `npm run build:atlas` rebuilds Russian exports from the stored translations without calling translation services.

## Data

- [Russian JSON](data/word-atlas.ru.json) and [CSV](data/word-atlas.ru.csv).
- [Translation sources](data/ru/) and [schema](docs/dataset.md).
- [Original English–Chinese data](data/word-atlas.json).

The original author describes the vocabulary list as common IELTS Reading vocabulary; its exact headword source is not identified. Source definitions, examples and illustrations were generated with AI, and the English recordings use ElevenLabs. Russian translations were authored by language models from the English and Chinese source material. Automated validation does not replace editorial review.

Progress stays in the current browser and can be exported or restored under «Мой прогресс». Russian interface narration uses device speech synthesis; voice availability depends on the browser and operating system.

## Licenses

Code and technical documentation: [MIT](LICENSE). Dictionary text, translations, illustrations and English audio: [CC BY 4.0](CONTENT_LICENSE.md), with attribution and a notice of changes. This project is not affiliated with the IELTS organizers.

Upstream: [designfuchen/word-atlas](https://github.com/designfuchen/word-atlas). Russian fork: [ivkiwi/word-atlas](https://github.com/ivkiwi/word-atlas).
