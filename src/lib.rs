#[cfg(feature = "cli")]
pub mod cli;
pub mod dictionary;
pub mod domain;
pub mod error;
pub mod evaluator;
pub mod search;

#[cfg(feature = "wasm")]
pub mod wasm;

pub use dictionary::Dictionary;
pub use domain::{Assignment, Puzzle, SolutionWord};
pub use error::{AppError, Result};
pub use evaluator::{Evaluation, Evaluator};
pub use search::{IterationSnapshot, OptimizationConfig, SearchMode, SearchResult, Solver};
