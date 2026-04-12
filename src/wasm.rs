#[cfg(feature = "wasm")]
use crate::dictionary::Dictionary;
#[cfg(feature = "wasm")]
use crate::domain::Puzzle;
#[cfg(feature = "wasm")]
use crate::search::{IterationSnapshot, OptimizationConfig, SearchMode, SearchResult, Solver};
#[cfg(feature = "wasm")]
use js_sys::Function;
#[cfg(feature = "wasm")]
use serde::{Deserialize, Serialize};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(feature = "wasm")]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WasmDictionaryEntry {
    pub word: String,
    pub weight: Option<usize>,
}

#[cfg(feature = "wasm")]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WasmRequest {
    pub n: usize,
    pub k: usize,
    pub alphabet: Vec<char>,
    #[serde(default)]
    pub fixed_solution_word: Option<String>,
    #[serde(default)]
    pub dictionary_words: Vec<String>,
    #[serde(default)]
    pub dictionary_entries: Vec<WasmDictionaryEntry>,
    #[serde(default)]
    pub mode: Option<String>,
    pub iterations: usize,
}

#[cfg(feature = "wasm")]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WasmSolveWithSnapshotsResponse {
    pub result: SearchResult,
    pub snapshots: Vec<IterationSnapshot>,
    pub selected_mode: SearchMode,
}

#[cfg(feature = "wasm")]
fn decode_request(request_json: &str) -> std::result::Result<(WasmRequest, SearchMode), JsValue> {
    let request: WasmRequest = serde_json::from_str(request_json)
        .map_err(|error| JsValue::from_str(&format!("invalid request: {error}")))?;

    let mode = match request.mode.as_deref().unwrap_or("auto") {
        "auto" => SearchMode::Auto,
        "hill-climb" => SearchMode::HillClimb,
        "exact" => SearchMode::Exact,
        other => {
            return Err(JsValue::from_str(&format!(
                "invalid mode '{other}', expected auto|hill-climb|exact"
            )))
        }
    };

    Ok((request, mode))
}

#[cfg(feature = "wasm")]
fn effective_mode(mode: SearchMode, alphabet_len: usize, n: usize) -> SearchMode {
    match mode {
        SearchMode::Auto => {
            if alphabet_len <= 8 && n <= 6 {
                SearchMode::Exact
            } else {
                SearchMode::HillClimb
            }
        }
        other => other,
    }
}

#[cfg(feature = "wasm")]
fn dictionary_from_request(request: WasmRequest) -> std::result::Result<Dictionary, JsValue> {
    let weighted_entries: Vec<(String, usize)> = if request.dictionary_entries.is_empty() {
        request
            .dictionary_words
            .into_iter()
            .map(|word| (word, 1usize))
            .collect()
    } else {
        request
            .dictionary_entries
            .into_iter()
            .map(|entry| (entry.word, entry.weight.unwrap_or(1)))
            .collect()
    };

    Dictionary::from_weighted_words(weighted_entries)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn solve_json(request_json: &str) -> std::result::Result<String, JsValue> {
    let (request, mode) = decode_request(request_json)?;
    let dictionary = dictionary_from_request(request.clone())?;
    let solver = Solver::new(&dictionary, Puzzle::new(request.n, request.k, request.alphabet));

    let result = solver
        .solve(OptimizationConfig {
            mode,
            max_iterations: request.iterations,
            fixed_solution_word: request.fixed_solution_word,
        })
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    serde_json::to_string(&result)
        .map_err(|error| JsValue::from_str(&format!("serialization error: {error}")))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn solve_json_with_snapshots(request_json: &str) -> std::result::Result<String, JsValue> {
    let (request, mode) = decode_request(request_json)?;
    let dictionary = dictionary_from_request(request.clone())?;
    let puzzle = Puzzle::new(request.n, request.k, request.alphabet);
    let selected_mode = effective_mode(mode.clone(), puzzle.alphabet.len(), puzzle.n);
    let solver = Solver::new(&dictionary, puzzle);

    let (result, snapshots) = solver
        .solve_with_snapshots(OptimizationConfig {
            mode,
            max_iterations: request.iterations,
            fixed_solution_word: request.fixed_solution_word,
        })
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    let payload = WasmSolveWithSnapshotsResponse {
        result,
        snapshots,
        selected_mode,
    };

    serde_json::to_string(&payload)
        .map_err(|error| JsValue::from_str(&format!("serialization error: {error}")))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn solve_json_with_progress(
    request_json: &str,
    snapshot_callback: &Function,
) -> std::result::Result<String, JsValue> {
    let (request, mode) = decode_request(request_json)?;
    let dictionary = dictionary_from_request(request.clone())?;
    let puzzle = Puzzle::new(request.n, request.k, request.alphabet);
    let selected_mode = effective_mode(mode.clone(), puzzle.alphabet.len(), puzzle.n);
    let solver = Solver::new(&dictionary, puzzle);

    let (result, snapshots) = solver
        .solve_with_snapshot_callback(
            OptimizationConfig {
                mode,
                max_iterations: request.iterations,
                fixed_solution_word: request.fixed_solution_word,
            },
            |snapshot| {
                if let Ok(snapshot_json) = serde_json::to_string(snapshot) {
                    let _ = snapshot_callback.call1(&JsValue::NULL, &JsValue::from_str(&snapshot_json));
                }
            },
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    let payload = WasmSolveWithSnapshotsResponse {
        result,
        snapshots,
        selected_mode,
    };

    serde_json::to_string(&payload)
        .map_err(|error| JsValue::from_str(&format!("serialization error: {error}")))
}
