use crate::dictionary::{normalize_word, Dictionary};
use crate::domain::{Assignment, Puzzle, SolutionWord};
use crate::error::{AppError, Result};
use crate::evaluator::{Evaluation, Evaluator};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum SearchMode {
    HillClimb,
    Exact,
    Auto,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OptimizationConfig {
    pub mode: SearchMode,
    pub max_iterations: usize,
    #[serde(default)]
    pub fixed_solution_word: Option<String>,
}

impl Default for OptimizationConfig {
    fn default() -> Self {
        Self {
            mode: SearchMode::Auto,
            max_iterations: 200,
            fixed_solution_word: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub assignment: Assignment,
    pub evaluation: Evaluation,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IterationSnapshot {
    pub iteration: usize,
    pub best_score: usize,
    pub match_count: usize,
    pub improved: bool,
    pub words: Vec<SolutionWord>,
}

pub struct Solver<'a> {
    dictionary: &'a Dictionary,
    evaluator: Evaluator,
    puzzle: Puzzle,
}

impl<'a> Solver<'a> {
    pub fn new(dictionary: &'a Dictionary, puzzle: Puzzle) -> Self {
        let evaluator = Evaluator::new(dictionary, puzzle.n);
        Self {
            dictionary,
            evaluator,
            puzzle,
        }
    }

    pub fn solve(&self, config: OptimizationConfig) -> Result<SearchResult> {
        let (result, _) = self.solve_with_snapshots(config)?;
        Ok(result)
    }

    pub fn solve_with_snapshots(
        &self,
        config: OptimizationConfig,
    ) -> Result<(SearchResult, Vec<IterationSnapshot>)> {
        self.solve_with_snapshot_callback(config, |_| {})
    }

    pub fn solve_with_snapshot_callback<F>(
        &self,
        config: OptimizationConfig,
        mut on_snapshot: F,
    ) -> Result<(SearchResult, Vec<IterationSnapshot>)>
    where
        F: FnMut(&IterationSnapshot),
    {
        let fixed_word_chars = self.parse_fixed_solution_word(config.fixed_solution_word.as_deref())?;
        let mode = match config.mode {
            SearchMode::Auto => {
                if self.puzzle.alphabet.len() <= 8 && self.puzzle.n <= 6 {
                    SearchMode::Exact
                } else {
                    SearchMode::HillClimb
                }
            }
            other => other,
        };

        let mut snapshots = Vec::new();

        let result = match mode {
            SearchMode::Exact => {
                let result = self.solve_exact(fixed_word_chars.as_deref())?;
                let snapshot = IterationSnapshot {
                    iteration: 0,
                    best_score: result.evaluation.score,
                    match_count: result.evaluation.match_count,
                    improved: true,
                    words: result.evaluation.words.clone(),
                };
                on_snapshot(&snapshot);
                snapshots.push(snapshot);
                result
            }
            SearchMode::HillClimb => {
                self.solve_hill_climb_with_snapshots(
                    config.max_iterations,
                    fixed_word_chars.as_deref(),
                    &mut snapshots,
                    &mut on_snapshot,
                )?
            }
            SearchMode::Auto => unreachable!(),
        };

        Ok((result, snapshots))
    }

    fn solve_hill_climb_with_snapshots(
        &self,
        max_iterations: usize,
        fixed_word_chars: Option<&[char]>,
        snapshots: &mut Vec<IterationSnapshot>,
        on_snapshot: &mut dyn FnMut(&IterationSnapshot),
    ) -> Result<SearchResult> {
        let mut current = self.initial_assignment(fixed_word_chars)?;
        let mut current_eval = self
            .evaluate_with_constraint(&current, fixed_word_chars)?
            .ok_or_else(|| {
                AppError::InvalidInput(
                    "could not build an initial assignment that satisfies fixed solution word"
                        .into(),
                )
            })?;

        let initial_snapshot = IterationSnapshot {
            iteration: 0,
            best_score: current_eval.score,
            match_count: current_eval.match_count,
            improved: true,
            words: current_eval.words.clone(),
        };
        on_snapshot(&initial_snapshot);
        snapshots.push(initial_snapshot);

        for iteration in 1..=max_iterations {
            let mut best_neighbor: Option<(Assignment, Evaluation)> = None;

            for position in 0..current.positions.len() {
                for &replacement in &self.puzzle.alphabet {
                    if current.contains(position, replacement) {
                        continue;
                    }

                    for slot in 0..current.positions[position].len() {
                        let mut candidate = current.clone();
                        candidate.positions[position][slot] = replacement;
                        candidate.positions[position].sort_unstable();

                        if candidate.positions[position]
                            .windows(2)
                            .any(|window| window[0] == window[1])
                        {
                            continue;
                        }

                        let Some(evaluation) =
                            self.evaluate_with_constraint(&candidate, fixed_word_chars)?
                        else {
                            continue;
                        };
                        if best_neighbor
                            .as_ref()
                            .is_none_or(|(_, best_eval)| evaluation.score > best_eval.score)
                        {
                            best_neighbor = Some((candidate, evaluation));
                        }
                    }
                }
            }

            let improved = match best_neighbor {
                Some((neighbor, evaluation)) if evaluation.score > current_eval.score => {
                    current = neighbor;
                    current_eval = evaluation;
                    true
                }
                _ => false,
            };

            let snapshot = IterationSnapshot {
                iteration,
                best_score: current_eval.score,
                match_count: current_eval.match_count,
                improved,
                words: current_eval.words.clone(),
            };
            on_snapshot(&snapshot);
            snapshots.push(snapshot);

            if !improved {
                break;
            }
        }

        Ok(SearchResult {
            assignment: current,
            evaluation: current_eval,
        })
    }

    fn solve_exact(&self, fixed_word_chars: Option<&[char]>) -> Result<SearchResult> {
        let mut best: Option<(Assignment, Evaluation)> = None;
        let mut positions = Vec::with_capacity(self.puzzle.n);
        self.enumerate_exact(0, fixed_word_chars, &mut positions, &mut best)?;

        best.map(|(assignment, evaluation)| SearchResult { assignment, evaluation })
            .ok_or_else(|| AppError::InvalidInput("exact solver found no feasible assignment".into()))
    }

    fn enumerate_exact(
        &self,
        position: usize,
        fixed_word_chars: Option<&[char]>,
        positions: &mut Vec<Vec<char>>,
        best: &mut Option<(Assignment, Evaluation)>,
    ) -> Result<()> {
        if position == self.puzzle.n {
            let assignment = Assignment::new(positions.clone());
            let Some(evaluation) = self.evaluate_with_constraint(&assignment, fixed_word_chars)? else {
                return Ok(());
            };
            if best
                .as_ref()
                .is_none_or(|(_, best_eval)| evaluation.score > best_eval.score)
            {
                *best = Some((assignment, evaluation));
            }
            return Ok(());
        }

        for choice in k_combinations(self.puzzle.alphabet.clone(), self.puzzle.k) {
            positions.push(choice);
            self.enumerate_exact(position + 1, fixed_word_chars, positions, best)?;
            positions.pop();
        }

        Ok(())
    }

    fn initial_assignment(&self, fixed_word_chars: Option<&[char]>) -> Result<Assignment> {
        let mut per_position_counts: Vec<BTreeMap<char, usize>> = vec![BTreeMap::new(); self.puzzle.n];

        for word in self.evaluator.words() {
            for (position, &letter) in word.iter().enumerate() {
                *per_position_counts[position].entry(letter).or_default() += 1;
            }
        }

        let mut positions = Vec::with_capacity(self.puzzle.n);
        let fallback_alphabet: Vec<char> = if self.puzzle.alphabet.is_empty() {
            self.dictionary.alphabet().to_vec()
        } else {
            self.puzzle.alphabet.clone()
        };

        for (position, counts) in per_position_counts.into_iter().enumerate() {
            let required_letter = fixed_word_chars.map(|chars| chars[position]);
            let mut ranked: Vec<(char, usize)> = counts.into_iter().collect();
            ranked.sort_by_key(|(letter, count)| (Reverse(*count), *letter));

            let mut choices: Vec<char> = Vec::with_capacity(self.puzzle.k);
            if let Some(letter) = required_letter {
                choices.push(letter);
            }

            for (letter, _) in ranked {
                if choices.len() >= self.puzzle.k {
                    break;
                }
                if choices.contains(&letter) {
                    continue;
                }
                choices.push(letter);
            }

            for letter in &fallback_alphabet {
                if choices.len() >= self.puzzle.k {
                    break;
                }
                if choices.contains(letter) {
                    continue;
                }
                choices.push(*letter);
            }

            if choices.len() < self.puzzle.k {
                return Err(AppError::InvalidInput(format!(
                    "not enough letters to build an initial assignment for k={}",
                    self.puzzle.k
                )));
            }

            choices.sort_unstable();
            positions.push(choices);
        }

        Ok(Assignment::new(positions))
    }

    fn parse_fixed_solution_word(&self, value: Option<&str>) -> Result<Option<Vec<char>>> {
        let Some(raw_word) = value else {
            return Ok(None);
        };

        let normalized = normalize_word(raw_word.trim());
        if normalized.is_empty() {
            return Ok(None);
        }

        if self.puzzle.k == 0 {
            return Err(AppError::InvalidInput(
                "fixed solution word requires k to be at least 1".into(),
            ));
        }

        let chars: Vec<char> = normalized.chars().collect();
        if chars.len() != self.puzzle.n {
            return Err(AppError::InvalidInput(format!(
                "fixed solution word length {} does not match n={}",
                chars.len(),
                self.puzzle.n
            )));
        }

        for &letter in &chars {
            if !self.puzzle.alphabet.contains(&letter) {
                return Err(AppError::InvalidInput(format!(
                    "fixed solution word contains '{letter}' which is not in the alphabet"
                )));
            }
        }

        Ok(Some(chars))
    }

    fn evaluate_with_constraint(
        &self,
        assignment: &Assignment,
        fixed_word_chars: Option<&[char]>,
    ) -> Result<Option<Evaluation>> {
        if let Some(chars) = fixed_word_chars {
            let fixed_word_matches = chars
                .iter()
                .enumerate()
                .all(|(position, letter)| assignment.contains(position, *letter));
            if !fixed_word_matches {
                return Ok(None);
            }
        }

        self.evaluator.evaluate(assignment).map(Some)
    }
}

fn k_combinations(alphabet: Vec<char>, k: usize) -> Vec<Vec<char>> {
    fn recurse(
        alphabet: &[char],
        k: usize,
        start: usize,
        current: &mut Vec<char>,
        output: &mut Vec<Vec<char>>,
    ) {
        if current.len() == k {
            output.push(current.clone());
            return;
        }

        for index in start..alphabet.len() {
            current.push(alphabet[index]);
            recurse(alphabet, k, index + 1, current, output);
            current.pop();
        }
    }

    let mut output = Vec::new();
    recurse(&alphabet, k, 0, &mut Vec::new(), &mut output);
    output
}
