use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Puzzle {
    pub n: usize,
    pub k: usize,
    pub alphabet: Vec<char>,
}

impl Puzzle {
    pub fn new(n: usize, k: usize, alphabet: Vec<char>) -> Self {
        Self { n, k, alphabet }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Assignment {
    pub positions: Vec<Vec<char>>,
}

impl Assignment {
    pub fn new(positions: Vec<Vec<char>>) -> Self {
        Self { positions }
    }

    pub fn n(&self) -> usize {
        self.positions.len()
    }

    pub fn k(&self) -> usize {
        self.positions.first().map_or(0, Vec::len)
    }

    pub fn contains(&self, position: usize, letter: char) -> bool {
        self.positions
            .get(position)
            .is_some_and(|choices| choices.contains(&letter))
    }

    pub fn validate(&self, puzzle: &Puzzle) -> crate::Result<()> {
        if self.positions.len() != puzzle.n {
            return Err(crate::error::AppError::DimensionMismatch {
                expected_n: puzzle.n,
                expected_k: puzzle.k,
                got_n: self.positions.len(),
                got_k: self.k(),
            });
        }

        for choices in &self.positions {
            if choices.len() != puzzle.k {
                return Err(crate::error::AppError::DimensionMismatch {
                    expected_n: puzzle.n,
                    expected_k: puzzle.k,
                    got_n: self.positions.len(),
                    got_k: choices.len(),
                });
            }
        }

        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SolutionWord {
    pub word: String,
    pub score_weight: usize,
}
