import type { DictionarySource } from "./types";

const SOURCES: DictionarySource[] = [
  {
    id: "en-norvig-1w",
    language: "en",
    label: "English: Norvig count_1w",
    url: "https://api.codetabs.com/v1/proxy/?quest=https://norvig.com/ngrams/count_1w.txt",
    kind: "norvig-count",
    supportsFrequency: true,
  },
  {
    id: "en-dwyl-alpha",
    language: "en",
    label: "English: DWYL words_alpha",
    url: "https://raw.githubusercontent.com/dwyl/english-words/refs/heads/master/words_alpha.txt",
    kind: "plain-wordlist",
    supportsFrequency: false,
  },
  {
    id: "de-gist-plain",
    language: "de",
    label: "Deutsch: MarvinJWendt wordlist",
    url: "https://gist.githubusercontent.com/MarvinJWendt/2f4f4154b8ae218600eb091a5706b5f4/raw/36b70dd6be330aa61cd4d4cdfda6234dcb0b8784/wordlist-german.txt",
    kind: "plain-wordlist",
    supportsFrequency: false,
  },
  {
    id: "de-decow-7z",
    language: "de",
    label: "Deutsch: DECOW cistem frequencies (7z)",
    url: "https://nlp-data-filestorage.s3.eu-central-1.amazonaws.com/word-frequencies/decow_wordfreq_cistem.csv.7z",
    kind: "csv-7z",
    supportsFrequency: true,
    note: "Large archive. CORS or static-host proxy may be required.",
  },
];

export function getSources(): DictionarySource[] {
  return SOURCES;
}

export function getSourceById(sourceId: string): DictionarySource | undefined {
  return SOURCES.find((source) => source.id === sourceId);
}
