import "uikit/dist/css/uikit.min.css";
import "./style.css";
import i18next from "./i18n";
import { initI18n, t } from "./i18n";
import { getSources } from "./sources";
import type { SolveInput, WorkerMessage } from "./types";

const sources = getSources();
type WorkerIntermediateMessage = Extract<
  WorkerMessage,
  { type: "intermediate" }
>;
type WorkerResultMessage = Extract<WorkerMessage, { type: "result" }>;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app element");
}
const appRoot = app;

const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});

const state = {
  percent: 0,
  status: "idle",
  detail: "",
  resultData: null as WorkerResultMessage | null,
  intermediateData: null as WorkerIntermediateMessage | null,
  isRunning: false,
  selectedSourceId: "",
};

function sampleSnapshots(
  snapshots: Array<{
    iteration: number;
    best_score: number;
    match_count: number;
    words?: Array<{ word: string; score_weight: number }>;
  }>,
): typeof snapshots {
  const maxCards = 10;
  if (snapshots.length <= maxCards) {
    return snapshots;
  }

  const step = (snapshots.length - 1) / (maxCards - 1);
  const indexes = new Set<number>();
  for (let i = 0; i < maxCards; i += 1) {
    indexes.add(Math.round(i * step));
  }

  return [...indexes].sort((a, b) => a - b).map((index) => snapshots[index]);
}

function renderSnapshotCards(
  snapshots: Array<{
    iteration: number;
    best_score: number;
    match_count: number;
    words?: Array<{ word: string; score_weight: number }>;
  }>,
): string {
  return sampleSnapshots(snapshots)
    .map((snapshot) => {
      const snapshotWords = (snapshot.words ?? [])
        .map(
          (word) =>
            `<li><span class="snapshot-word-label">${word.word}</span><strong title="${t("wordScoreTitle")}">${word.score_weight}</strong></li>`,
        )
        .join("");

      return `
        <article class="snapshot-card">
          <div class="snapshot-summary">
            <span class="snapshot-step" title="${t("snapshotIterationTitle")}">#${snapshot.iteration}</span>
            <div class="snapshot-metrics">
              <strong title="${t("snapshotScoreTitle")}">${snapshot.best_score}</strong>
              <em title="${t("snapshotMatchesTitle")}">${snapshot.match_count} ${t("hitsShort")}</em>
            </div>
          </div>
          <ul class="snapshot-words">${snapshotWords || `<li><span class="muted">${t("noWords")}</span></li>`}</ul>
        </article>
      `;
    })
    .join("");
}

function buildIntermediateHtml(message: WorkerIntermediateMessage): string {
  const latest = message.snapshots[message.snapshots.length - 1];
  const snapshotPreview = renderSnapshotCards(message.snapshots);

  return `
    <h3>${t("progress")}</h3>
    <p class="muted">${t("snapshotsRunningHint")}</p>
    <div class="result-meta">
      <div><label>${t("modeLabel")}</label><strong>${message.selectedMode}</strong></div>
      <div><label>${t("snapshotsLabel")}</label><strong>${message.snapshots.length}</strong></div>
      <div><label>${t("score")}</label><strong>${latest?.best_score ?? 0}</strong></div>
      <div><label>${t("matches")}</label><strong>${latest?.match_count ?? 0}</strong></div>
      <div><label>${t("entriesLabel")}</label><strong>${message.dictionaryStats.totalEntries}</strong></div>
      <div><label>${t("alphabetLabel")}</label><strong>${message.dictionaryStats.uniqueAlphabetSize}</strong></div>
    </div>
    <div class="snapshot-panel">
      <div class="snapshot-headline">
        <h4>${t("iterationSnapshots")}</h4>
        <span>${t("snapshotsLive")}</span>
      </div>
      <div class="snapshot-strip">${snapshotPreview}</div>
    </div>
  `;
}

const selectedSourceFromStorage = localStorage.getItem("qaf.source");
state.selectedSourceId =
  sources.find((source) => source.id === selectedSourceFromStorage)?.id ??
  sources[0]?.id;

function buildResultHtml(message: WorkerResultMessage): string {
  const topWordPeak = Math.max(
    1,
    ...message.result.evaluation.words.map((word) => word.score_weight),
  );

  const topWords = [...message.result.evaluation.words]
    .sort((a, b) => b.score_weight - a.score_weight)
    .slice(0, 25)
    .map((word, index) => {
      const ratio = Math.min(1, word.score_weight / topWordPeak);
      return `
        <li class="word-item" style="--score-ratio:${ratio.toFixed(3)};">
          <span class="word-rank">${index + 1}</span>
          <span class="word-label">${word.word}</span>
          <strong>${word.score_weight}</strong>
          <div class="word-bar"></div>
        </li>
      `;
    })
    .join("");

  const positions = message.result.assignment.positions
    .map((letters, index) => {
      const chips = letters
        .map((letter) => `<span class="letter-chip">${letter}</span>`)
        .join("");

      return `
        <li class="position-card">
          <div class="position-head">
            <span class="position-index">${index + 1}</span>
          </div>
          <div class="position-chips">${chips}</div>
        </li>
      `;
    })
    .join("");

  const snapshotPreview = renderSnapshotCards(message.snapshots);

  return `
    <h3>${t("result")}</h3>
    <div class="result-meta">
      <div><label>${t("score")}</label><strong>${message.result.evaluation.score}</strong></div>
      <div><label>${t("matches")}</label><strong>${message.result.evaluation.match_count}</strong></div>
      <div><label>${t("modeLabel")}</label><strong>${message.selectedMode}</strong></div>
      <div><label>${t("snapshotsLabel")}</label><strong>${message.snapshots.length}</strong></div>
      <div><label>${t("entriesLabel")}</label><strong>${message.dictionaryStats.totalEntries}</strong></div>
      <div><label>${t("alphabetLabel")}</label><strong>${message.dictionaryStats.uniqueAlphabetSize}</strong></div>
    </div>
    <div class="result-grid">
      <div>
        <h4>${t("letters")}</h4>
        <ul class="letter-list">${positions}</ul>
      </div>
      <div>
        <h4>${t("topWords")}</h4>
        <ul class="word-list">${topWords}</ul>
      </div>
    </div>
    <div class="snapshot-panel">
      <div class="snapshot-headline">
        <h4>${t("iterationSnapshots")}</h4>
        <span>${t("snapshotsSampled")}</span>
      </div>
      <div class="snapshot-strip">${snapshotPreview}</div>
    </div>
  `;
}

function render(): void {
  appRoot.innerHTML = `
    <main class="page-shell">
      <section class="hero uk-card uk-card-default uk-card-body">
        <h1>${t("title")}</h1>
        <p>${t("subtitle")}</p>
      </section>

      <section class="uk-grid uk-grid-medium" uk-grid>
        <article class="uk-width-1-1 uk-width-3-5@m">
          <div class="uk-card uk-card-secondary uk-card-body input-card">
            <div class="uk-grid-small" uk-grid>
              <div class="uk-width-1-1">
                <label class="uk-form-label">${t("source")}</label>
                <select class="uk-select" id="source-select">
                  ${sources
                    .map(
                      (source) =>
                        `<option value="${source.id}" ${source.id === state.selectedSourceId ? "selected" : ""}>${source.label}</option>`,
                    )
                    .join("")}
                </select>
              </div>

              <div class="uk-width-1-2@s">
                <label class="uk-form-label">${t("n")}</label>
                <input class="uk-input" id="n-input" type="number" min="2" max="12" value="4" />
              </div>
              <div class="uk-width-1-2@s">
                <label class="uk-form-label">${t("k")}</label>
                <input class="uk-input" id="k-input" type="number" min="2" max="6" value="2" />
              </div>

              <div class="uk-width-1-1">
                <label class="uk-form-label">${t("fixedSolutionWord")}</label>
                <input class="uk-input" id="fixed-solution-word-input" type="text" placeholder="${t("optionalWordPlaceholder")}" />
              </div>

              <details>
                <summary class="uk-text-muted">${t("advancedOptions")}</summary>

                <div class="uk-width-1-1">
                  <label class="uk-form-label">${t("alphabet")}</label>
                  <input class="uk-input" id="alphabet-input" type="text" placeholder="${t("optionalPlaceholder")}" />
                </div>

                <div class="uk-width-1-2@s">
                  <label class="uk-form-label">${t("iterations")}</label>
                  <input class="uk-input" id="iterations-input" type="number" min="1" max="2500" value="300" />
                </div>
                <div class="uk-width-1-2@s">
                  <label class="uk-form-label">${t("mode")}</label>
                  <select class="uk-select" id="mode-select">
                    <option value="auto">auto</option>
                    <option value="hill-climb">hill-climb</option>
                    <option value="exact">exact</option>
                  </select>
                </div>
              </details>

              <div class="uk-width-1-1 control-row">
                <button class="uk-button uk-button-primary" id="solve-btn" ${state.isRunning ? "disabled" : ""}>${t("solve")}</button>
                <button class="uk-button uk-button-default" id="reset-btn">${t("reset")}</button>
              </div>
            </div>
          </div>
        </article>

        <aside class="uk-width-1-1 uk-width-2-5@m">
          <div class="uk-card uk-card-default uk-card-body status-card">
            <h3>${t("progress")}</h3>
            <progress class="uk-progress" id="progress-bar" value="${state.percent}" max="100"></progress>
            <div class="status-line" id="status-line">${state.status}</div>
            <div class="status-detail" id="status-detail">${state.detail}</div>
          </div>
        </aside>
      </section>

      <section class="uk-card uk-card-default uk-card-body result-card">
        <div id="result-content">
          ${state.resultData ? buildResultHtml(state.resultData) : `<h3>${t("result")}</h3><p class="muted">${t("statusIdle")}</p>`}
        </div>
      </section>

      <footer class="app-footer" aria-label="${t("footerLabel")}">
        <div class="footer-links">
          <a href="https://github.com/GenieTim/quiz-grid-optimizer" target="_blank" rel="noopener noreferrer">${t("githubLinkLabel")}</a>
        </div>
        <div class="footer-language">
          <label for="ui-language">${t("language")}</label>
          <select class="uk-select" id="ui-language">
            <option value="en" ${i18next.language.startsWith("en") ? "selected" : ""}>English</option>
            <option value="de" ${i18next.language.startsWith("de") ? "selected" : ""}>Deutsch</option>
          </select>
        </div>
      </footer>
    </main>
  `;

  bindEvents();
  syncView();
}

function bindEvents(): void {
  const solveButton = document.querySelector<HTMLButtonElement>("#solve-btn");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-btn");
  const sourceSelect =
    document.querySelector<HTMLSelectElement>("#source-select");

  if (!solveButton || !resetButton || !sourceSelect) {
    return;
  }

  sourceSelect.addEventListener("change", () => {
    localStorage.setItem("qaf.source", sourceSelect.value);
    state.selectedSourceId = sourceSelect.value;
  });

  solveButton.addEventListener("click", () => {
    if (state.isRunning) {
      return;
    }

    const n = Number(
      (
        document.querySelector<HTMLInputElement>("#n-input")?.value ?? "4"
      ).trim(),
    );
    const k = Number(
      (
        document.querySelector<HTMLInputElement>("#k-input")?.value ?? "2"
      ).trim(),
    );
    const iterations = Number(
      (
        document.querySelector<HTMLInputElement>("#iterations-input")?.value ??
        "300"
      ).trim(),
    );
    const alphabet = (
      document.querySelector<HTMLInputElement>("#alphabet-input")?.value ?? ""
    ).trim();
    const fixedSolutionWord = (
      document.querySelector<HTMLInputElement>("#fixed-solution-word-input")
        ?.value ?? ""
    ).trim();
    const mode =
      (document.querySelector<HTMLSelectElement>("#mode-select")
        ?.value as SolveInput["mode"]) ?? "auto";

    const payload: SolveInput = {
      sourceId: sourceSelect.value,
      n,
      k,
      alphabet,
      fixedSolutionWord,
      iterations,
      mode,
    };

    state.isRunning = true;
    state.percent = 0;
    state.status = t("progress");
    state.detail = "";
    state.resultData = null;
    state.intermediateData = null;
    syncView();
    renderResult();
    worker.postMessage(payload);
  });

  resetButton.addEventListener("click", () => {
    state.percent = 0;
    state.status = t("statusIdle");
    state.detail = "";
    state.resultData = null;
    state.intermediateData = null;
    state.isRunning = false;
    syncView();
    renderResult();
  });
}

function syncView(): void {
  const progressBar =
    document.querySelector<HTMLProgressElement>("#progress-bar");
  const statusLine = document.querySelector<HTMLElement>("#status-line");
  const statusDetail = document.querySelector<HTMLElement>("#status-detail");
  const solveButton = document.querySelector<HTMLButtonElement>("#solve-btn");
  const sourceSelect =
    document.querySelector<HTMLSelectElement>("#source-select");
  const languageSelect =
    document.querySelector<HTMLSelectElement>("#ui-language");

  if (progressBar) {
    progressBar.value = state.percent;
  }
  if (statusLine) {
    statusLine.textContent = state.status;
  }
  if (statusDetail) {
    statusDetail.textContent = state.detail;
  }
  if (solveButton) {
    solveButton.disabled = state.isRunning;
  }
  if (sourceSelect) {
    sourceSelect.value = state.selectedSourceId;
  }
  if (languageSelect) {
    languageSelect.value = i18next.language.startsWith("de") ? "de" : "en";
  }
}

function renderResult(): void {
  const resultContent = document.querySelector<HTMLElement>("#result-content");
  if (!resultContent) {
    return;
  }

  resultContent.innerHTML = state.resultData
    ? buildResultHtml(state.resultData)
    : state.intermediateData && state.isRunning
      ? buildIntermediateHtml(state.intermediateData)
      : `<h3>${t("result")}</h3><p class="muted">${t("statusIdle")}</p>`;
}

worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === "progress") {
    state.percent = message.percent;
    state.status = message.phase === "done" ? t("statusDone") : message.phase;
    state.detail = message.detail;
    if (message.phase === "done") {
      state.isRunning = false;
    }
    syncView();
    return;
  }

  if (message.type === "result") {
    state.resultData = message;
    state.intermediateData = null;
    state.isRunning = false;
    state.status = t("statusDone");
    state.detail = `${message.dictionaryStats.totalEntries} ${t("entriesLabel").toLowerCase()}`;
    syncView();
    renderResult();
    return;
  }

  if (message.type === "intermediate") {
    state.intermediateData = message;
    renderResult();
    return;
  }

  if (message.type === "error") {
    state.status = t("statusError");
    state.detail = message.message;
    state.isRunning = false;
    state.percent = 0;
    state.intermediateData = null;
    syncView();
    renderResult();
  }
};

await initI18n();
state.status = t("statusIdle");

document.addEventListener("change", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target || target.id !== "ui-language") {
    return;
  }

  const select = target as HTMLSelectElement;
  const language = select.value;
  i18next.changeLanguage(language);
  render();
});

render();
