# quiz-grid-optimizer

[![CI](https://github.com/genietim/quiz-grid-optimizer/actions/workflows/ci.yml/badge.svg)](https://github.com/genietim/quiz-grid-optimizer/actions/workflows/ci.yml)
[![GitHub Pages](https://github.com/genietim/quiz-grid-optimizer/actions/workflows/deploy-pages.yml/badge.svg)](https://genietim.github.io/quiz-grid-optimizer/)

There are quizzes out there, with, say, `n` questions, and to each question you have, say, `k` different answer possibilities, each associated with a letter.
If you answer the questions correctly, you get a word out from those letters, a solution word.
This project aims to make a quiz where also incorrect answers lead to a solution word.
The trivial answer is yes (just use `k` words with each `n` letters), but now the project would like to optimize this, i.e., find more words that arise from mixing the letters.

## Current Implementation

The project now has an initial Rust implementation with:

- a CLI entry point,
- Unicode-aware dictionary normalization,
- a basic evaluator that counts solution words,
- a greedy hill-climbing search mode,
- an exact solver for tiny cases,
- a wasm-friendly library boundary for later embedding.

German characters and other non-ASCII letters are supported through Unicode normalization instead of ASCII-only handling.

## Run

```bash
cargo test
cargo run -- --dictionary path/to/words.txt --n 4 --k 2 --alphabet aeiouäöüß --mode auto --fixed-solution-word haus
```

Weighted dictionaries are now supported in the library and wasm paths. Plain line-based dictionary files still work exactly as before, with implicit weight `1` per word.

## Web App (WASM)

The repository now includes a Vite + TypeScript frontend in `web/` that downloads dictionaries dynamically in the browser, parses them, and calls the wasm solver.

### Prerequisites

- Rust toolchain with `wasm32-unknown-unknown` target
- `wasm-pack` installed and available on PATH
- Node.js + npm

### Build and run

```bash
cd web
npm install
npm run build:wasm
npm run dev
```

The wasm output is written to `web/public/wasm` and loaded dynamically by the worker.

### Runtime dictionary sources

The web app currently includes these source adapters:

- English Norvig count list (`count_1w` style, includes frequencies)
- English DWYL alpha list (word-only)
- German plain list (word-only)
- German DECOW cistem frequency archive (`.csv.7z`, parsed in browser)

No third-party dictionaries are bundled in repository assets; data is fetched at runtime.

## Notes

- `auto` uses exact solving only for very small cases and hill climbing otherwise.
- The current objective is raw solution-word count.
