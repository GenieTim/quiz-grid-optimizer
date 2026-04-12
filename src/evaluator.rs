use crate::dictionary::Dictionary;
use crate::domain::{Assignment, SolutionWord};
use crate::error::Result;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Evaluation {
    pub score: usize,
    pub match_count: usize,
    pub words: Vec<SolutionWord>,
}

#[derive(Clone, Debug)]
pub struct Evaluator {
    words: Vec<Vec<char>>,
    original_words: Vec<String>,
    word_weights: Vec<usize>,
    length: usize,
}

impl Evaluator {
    pub fn new(dictionary: &Dictionary, length: usize) -> Self {
        Self {
            words: dictionary.words_of_length(length).to_vec(),
            original_words: dictionary
                .all_words()
                .iter()
                .filter(|word| word.chars().count() == length)
                .cloned()
                .collect(),
            word_weights: dictionary.weights_of_length(length).to_vec(),
            length,
        }
    }

    pub fn words(&self) -> &[Vec<char>] {
        &self.words
    }

    pub fn evaluate(&self, assignment: &Assignment) -> Result<Evaluation> {
        if assignment.n() != self.length {
            return Err(crate::error::AppError::InvalidInput(format!(
                "assignment length {} does not match evaluator length {}",
                assignment.n(), self.length
            )));
        }

        let mut score = 0;
        let mut match_count = 0;
        let mut words = Vec::new();

        for (index, word) in self.words.iter().enumerate() {
            if word
                .iter()
                .enumerate()
                .all(|(position, letter)| assignment.contains(position, *letter))
            {
                let weight = self.word_weights.get(index).copied().unwrap_or(1);
                score += weight;
                match_count += 1;
                words.push(SolutionWord {
                    word: self.original_words[index].clone(),
                    score_weight: weight,
                });
            }
        }

        Ok(Evaluation {
            score,
            match_count,
            words,
        })
    }
}
