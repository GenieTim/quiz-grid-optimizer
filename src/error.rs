use thiserror::Error;

pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("dictionary is empty after normalization and filtering")]
    EmptyDictionary,

    #[error("mismatching puzzle dimensions: expected n={expected_n}, k={expected_k}, got n={got_n}, k={got_k}")]
    DimensionMismatch {
        expected_n: usize,
        expected_k: usize,
        got_n: usize,
        got_k: usize,
    },
}
