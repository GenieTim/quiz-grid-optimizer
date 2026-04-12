/// <reference lib="webworker" />
import Papa from "papaparse";
import { getSourceById } from "./sources";
import type { SolveInput, WordEntry, WorkerMessage } from "./types";

type SolveWithSnapshotsResponse = {
  result: {
    assignment: { positions: string[][] };
    evaluation: {
      score: number;
      match_count: number;
      words: Array<{ word: string; score_weight: number }>;
    };
  };
  snapshots: Array<{
    iteration: number;
    best_score: number;
    match_count: number;
    improved: boolean;
    words: Array<{ word: string; score_weight: number }>;
  }>;
  selected_mode: "HillClimb" | "Exact" | "Auto";
};

type SolverExports = {
  solve_json: (requestJson: string) => string;
  solve_json_with_snapshots?: (requestJson: string) => string;
  solve_json_with_progress?: (
    requestJson: string,
    onSnapshot: (snapshotJson: string) => void
  ) => string;
};

let solverExports: SolverExports | null = null;

function post(message: WorkerMessage): void {
  self.postMessage(message);
}

async function fetchWithProgress(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }

  const contentLengthHeader = response.headers.get("content-length");
  const total = contentLengthHeader ? Number(contentLengthHeader) : 0;

  if (!response.body) {
    const data = new Uint8Array(await response.arrayBuffer());
    post({
      type: "progress",
      phase: "downloading",
      percent: 100,
      detail: `Downloaded ${data.length} bytes`,
    });
    return data;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }

    chunks.push(value);
    loaded += value.length;
    const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    post({
      type: "progress",
      phase: "downloading",
      percent: pct,
      detail: total > 0 ? `${loaded}/${total} bytes` : `${loaded} bytes`,
    });
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function parseNorvig(text: string): WordEntry[] {
  const entries: WordEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [word, countRaw] = trimmed.split(/\s+/);
    const count = Number(countRaw);
    if (!word || !Number.isFinite(count) || count <= 0) {
      continue;
    }
    entries.push({ word, weight: Math.max(1, Math.round(Math.log10(count + 1) * 100)) });
  }
  return entries;
}

function parsePlainList(text: string): WordEntry[] {
  const entries: WordEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const word = line.trim();
    if (!word) {
      continue;
    }
    entries.push({ word, weight: 1 });
  }
  return entries;
}

async function parseDecowArchive(bytes: Uint8Array): Promise<WordEntry[]> {
  const { default: SevenZip } = await import("7z-wasm");
  post({ type: "progress", phase: "extracting", percent: 20, detail: "Initializing 7z runtime" });
  const sevenZip = await SevenZip();
  const archiveName = "decow.7z";

  const stream = sevenZip.FS.open(archiveName, "w+");
  sevenZip.FS.write(stream, bytes, 0, bytes.length);
  sevenZip.FS.close(stream);

  post({ type: "progress", phase: "extracting", percent: 55, detail: "Extracting archive" });
  sevenZip.callMain(["x", archiveName]);

  const files = sevenZip.FS.readdir("/") as string[];
  const csvFile = files.find((name) => name.endsWith(".csv"));
  if (!csvFile) {
    throw new Error("No CSV file found after extracting DECOW archive");
  }

  const csvData = sevenZip.FS.readFile(csvFile) as Uint8Array;
  const csvText = new TextDecoder().decode(csvData);
  return parseDecowCsv(csvText);
}

function parseDecowCsv(csvText: string): WordEntry[] {
  const firstLine = csvText.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes(";") ? ";" : ",";

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    delimiter,
    skipEmptyLines: true,
    transformHeader: (value) => value.trim().toLowerCase(),
  });

  if (parsed.errors.length > 0) {
    throw new Error(`CSV parse error: ${parsed.errors[0].message}`);
  }

  const entries: WordEntry[] = [];
  for (const row of parsed.data) {
    const keys = Object.keys(row);
    if (keys.length === 0) {
      continue;
    }

    const wordKey = keys.find((key) => /(word|lemma|token|form|cistem)/i.test(key));
    const freqKey = keys.find((key) => /(freq|count)/i.test(key));

    const word = (wordKey ? row[wordKey] : "")?.trim() ?? "";
    const freqRaw = (freqKey ? row[freqKey] : "")?.trim() ?? "";
    const frequency = Number(freqRaw.replace(",", "."));

    if (!word || !Number.isFinite(frequency) || frequency <= 0) {
      continue;
    }

    entries.push({ word, weight: Math.max(1, Math.round(Math.log10(frequency + 1) * 100)) });
  }

  return entries;
}

function normalizeEntries(entries: WordEntry[]): WordEntry[] {
  const merged = new Map<string, number>();

  for (const entry of entries) {
    const normalized = entry.word.normalize("NFC").toLowerCase().trim();
    if (!/^\p{L}+$/u.test(normalized)) {
      continue;
    }

    const previous = merged.get(normalized) ?? 0;
    merged.set(normalized, previous + Math.max(1, Math.floor(entry.weight)));
  }

  return [...merged.entries()].map(([word, weight]) => ({ word, weight }));
}

function alphabetFromEntries(entries: WordEntry[]): string[] {
  const letters = new Set<string>();
  for (const entry of entries) {
    for (const letter of entry.word) {
      letters.add(letter);
    }
  }
  return [...letters].sort((a, b) => a.localeCompare(b));
}

async function getSolver(): Promise<SolverExports> {
  if (solverExports) {
    return solverExports;
  }

  const wasmJsUrl = new URL("/wasm/quiz_grid_optimizer.js", self.location.origin).toString();
  const wasmBgUrl = new URL("/wasm/quiz_grid_optimizer_bg.wasm", self.location.origin).toString();
  let wasmModule: {
    default: (input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module) => Promise<unknown>;
    solve_json: (requestJson: string) => string;
    solve_json_with_snapshots?: (requestJson: string) => string;
    solve_json_with_progress?: (
      requestJson: string,
      onSnapshot: (snapshotJson: string) => void
    ) => string;
  };
  try {
    const response = await fetch(wasmJsUrl);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} while fetching wasm loader`);
    }
    const moduleText = await response.text();
    const moduleUrl = URL.createObjectURL(new Blob([moduleText], { type: "text/javascript" }));
    try {
      wasmModule = await import(/* @vite-ignore */ moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  } catch (error) {
    throw new Error(
      `Failed to load wasm module at ${wasmJsUrl}. Run 'npm run build:wasm' in web/ first. Original error: ${String(error)}`
    );
  }

  await wasmModule.default(wasmBgUrl);
  solverExports = {
    solve_json: wasmModule.solve_json as (requestJson: string) => string,
    solve_json_with_snapshots: wasmModule.solve_json_with_snapshots as
      | ((requestJson: string) => string)
      | undefined,
    solve_json_with_progress: wasmModule.solve_json_with_progress as
      | ((requestJson: string, onSnapshot: (snapshotJson: string) => void) => string)
      | undefined,
  };
  return solverExports;
}

async function runSolve(input: SolveInput): Promise<void> {
  const source = getSourceById(input.sourceId);
  if (!source) {
    throw new Error(`Unknown source: ${input.sourceId}`);
  }

  post({ type: "progress", phase: "downloading", percent: 0, detail: `Downloading ${source.label}` });
  const bytes = await fetchWithProgress(source.url);

  post({ type: "progress", phase: "parsing", percent: 0, detail: "Parsing dictionary" });
  const text = new TextDecoder().decode(bytes);
  let parsedEntries: WordEntry[] = [];

  if (source.kind === "norvig-count") {
    parsedEntries = parseNorvig(text);
  } else if (source.kind === "plain-wordlist") {
    parsedEntries = parsePlainList(text);
  } else if (source.kind === "csv-7z") {
    parsedEntries = await parseDecowArchive(bytes);
  }

  post({ type: "progress", phase: "normalizing", percent: 75, detail: "Normalizing words" });
  const normalized = normalizeEntries(parsedEntries);
  if (normalized.length === 0) {
    throw new Error("No valid dictionary entries after normalization");
  }

  const autoAlphabet = alphabetFromEntries(normalized);
  const alphabet = input.alphabet.trim().length > 0 ? [...input.alphabet.trim()] : autoAlphabet;
  const selectedMode: "HillClimb" | "Exact" | "Auto" =
    input.mode === "hill-climb"
      ? "HillClimb"
      : input.mode === "exact"
        ? "Exact"
        : alphabet.length <= 8 && input.n <= 6
          ? "Exact"
          : "HillClimb";

  post({ type: "progress", phase: "solving", percent: 85, detail: "Running wasm solver" });
  const solver = await getSolver();
  const requestJson = JSON.stringify({
    n: input.n,
    k: input.k,
    alphabet,
    fixed_solution_word:
      input.fixedSolutionWord.trim().length > 0 ? input.fixedSolutionWord.trim() : undefined,
    dictionary_entries: normalized,
    iterations: input.iterations,
    mode: input.mode,
  });

  let solvePayload: SolveWithSnapshotsResponse;
  if (solver.solve_json_with_progress) {
    const streamedSnapshots: SolveWithSnapshotsResponse["snapshots"] = [];
    let lastPublishedIteration = -1;

    const publishIntermediate = (force = false): void => {
      const latest = streamedSnapshots[streamedSnapshots.length - 1];
      if (!latest) {
        return;
      }

      if (!force && latest.iteration === lastPublishedIteration) {
        return;
      }

      lastPublishedIteration = latest.iteration;
      const ratio = Math.min(1, latest.iteration / Math.max(1, input.iterations));
      const pct = Math.min(99, 85 + Math.round(ratio * 14));
      post({
        type: "progress",
        phase: "solving",
        percent: pct,
        detail: `iter ${latest.iteration}: score=${latest.best_score}, matches=${latest.match_count}`,
      });

      post({
        type: "intermediate",
        snapshots: [...streamedSnapshots],
        selectedMode,
        dictionaryStats: {
          totalEntries: normalized.length,
          uniqueAlphabetSize: autoAlphabet.length,
        },
      });
    };

    const progressResponseJson = solver.solve_json_with_progress(requestJson, (snapshotJson) => {
      const snapshot = JSON.parse(snapshotJson) as SolveWithSnapshotsResponse["snapshots"][number];
      streamedSnapshots.push({
        ...snapshot,
        words: snapshot.words ?? [],
      });

      if (snapshot.improved || snapshot.iteration === 0 || snapshot.iteration % 5 === 0) {
        publishIntermediate();
      }
    });

    publishIntermediate(true);
    solvePayload = JSON.parse(progressResponseJson) as SolveWithSnapshotsResponse;
  } else if (solver.solve_json_with_snapshots) {
    const snapshotResponseJson = solver.solve_json_with_snapshots(requestJson);
    solvePayload = JSON.parse(snapshotResponseJson) as SolveWithSnapshotsResponse;
  } else {
    const fallbackResultJson = solver.solve_json(requestJson);
    solvePayload = {
      result: JSON.parse(fallbackResultJson),
      snapshots: [],
      selected_mode: "Auto",
    };
  }

  const snapshots = solvePayload.snapshots;
  const snapshotsWithWords = snapshots.map((snapshot) => ({
    ...snapshot,
    words: snapshot.words ?? [],
  }));

  if (snapshotsWithWords.length > 0 && !solver.solve_json_with_progress) {
    const stride = Math.max(1, Math.ceil(snapshotsWithWords.length / 12));
    for (let index = 0; index < snapshotsWithWords.length; index += stride) {
      const snapshot = snapshotsWithWords[index];
      const ratio = Math.min(1, snapshot.iteration / Math.max(1, input.iterations));
      const pct = Math.min(99, 85 + Math.round(ratio * 14));
      post({
        type: "progress",
        phase: "solving",
        percent: pct,
        detail: `iter ${snapshot.iteration}: score=${snapshot.best_score}, matches=${snapshot.match_count}`,
      });
    }
  }

  post({ type: "progress", phase: "solving", percent: 99, detail: "Finalizing result" });
  post({
    type: "result",
    sourceId: source.id,
    request: input,
    selectedMode: solvePayload.selected_mode,
    snapshots: snapshotsWithWords,
    result: solvePayload.result,
    dictionaryStats: {
      totalEntries: normalized.length,
      uniqueAlphabetSize: autoAlphabet.length,
    },
  });

  post({ type: "progress", phase: "done", percent: 100, detail: "Completed" });
}

self.onmessage = async (event: MessageEvent<SolveInput>) => {
  try {
    await runSolve(event.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post({ type: "error", message });
  }
};
