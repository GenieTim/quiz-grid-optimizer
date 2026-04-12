export type SourceKind = "norvig-count" | "plain-wordlist" | "csv-7z";

export interface WordEntry {
  word: string;
  weight: number;
}

export interface DictionarySource {
  id: string;
  language: string;
  label: string;
  url: string;
  kind: SourceKind;
  supportsFrequency: boolean;
  note?: string;
}

export interface SolveInput {
  sourceId: string;
  n: number;
  k: number;
  alphabet: string;
  fixedSolutionWord: string;
  iterations: number;
  mode: "auto" | "hill-climb" | "exact";
}

export type WorkerPhase =
  | "idle"
  | "downloading"
  | "extracting"
  | "parsing"
  | "normalizing"
  | "solving"
  | "done"
  | "error";

export interface WorkerProgressMessage {
  type: "progress";
  phase: WorkerPhase;
  percent: number;
  detail: string;
}

export interface WorkerResultMessage {
  type: "result";
  sourceId: string;
  request: SolveInput;
  selectedMode: "HillClimb" | "Exact" | "Auto";
  snapshots: Array<{
    iteration: number;
    best_score: number;
    match_count: number;
    improved: boolean;
    words?: Array<{ word: string; score_weight: number }>;
  }>;
  result: {
    assignment: { positions: string[][] };
    evaluation: {
      score: number;
      match_count: number;
      words: Array<{ word: string; score_weight: number }>;
    };
  };
  dictionaryStats: {
    totalEntries: number;
    uniqueAlphabetSize: number;
  };
}

export interface WorkerIntermediateMessage {
  type: "intermediate";
  snapshots: Array<{
    iteration: number;
    best_score: number;
    match_count: number;
    improved: boolean;
    words?: Array<{ word: string; score_weight: number }>;
  }>;
  selectedMode: "HillClimb" | "Exact" | "Auto";
  dictionaryStats: {
    totalEntries: number;
    uniqueAlphabetSize: number;
  };
}

export interface WorkerErrorMessage {
  type: "error";
  message: string;
}

export type WorkerMessage =
  | WorkerProgressMessage
  | WorkerIntermediateMessage
  | WorkerResultMessage
  | WorkerErrorMessage;
