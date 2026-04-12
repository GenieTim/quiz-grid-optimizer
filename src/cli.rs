use crate::dictionary::Dictionary;
use crate::domain::Puzzle;
use crate::error::{AppError, Result};
use crate::search::{OptimizationConfig, SearchMode, Solver};
use clap::Parser;

#[derive(Debug, Parser)]
#[command(author, version, about)]
pub struct Args {
    #[arg(short, long)]
    pub dictionary: String,

    #[arg(short, long)]
    pub n: usize,

    #[arg(short, long)]
    pub k: usize,

    #[arg(long)]
    pub alphabet: Option<String>,

    #[arg(long)]
    pub fixed_solution_word: Option<String>,

    #[arg(long, default_value_t = 200)]
    pub iterations: usize,

    #[arg(long, default_value = "auto")]
    pub mode: String,
}

pub fn run() -> Result<()> {
    let args = Args::parse();
    let dictionary = Dictionary::from_file(&args.dictionary)?;
    let alphabet = args
        .alphabet
        .map(|value| value.chars().collect())
        .unwrap_or_else(|| dictionary.alphabet().to_vec());

    if alphabet.is_empty() {
        return Err(AppError::InvalidInput(
            "alphabet is empty; provide one explicitly or use a non-empty dictionary".into(),
        ));
    }

    let puzzle = Puzzle::new(args.n, args.k, alphabet);
    let solver = Solver::new(&dictionary, puzzle);
    let mode = match args.mode.as_str() {
        "auto" => SearchMode::Auto,
        "hill-climb" => SearchMode::HillClimb,
        "exact" => SearchMode::Exact,
        other => return Err(AppError::InvalidInput(format!("unknown mode '{other}'"))),
    };

    let result = solver.solve(OptimizationConfig {
        mode,
        max_iterations: args.iterations,
        fixed_solution_word: args.fixed_solution_word,
    })?;

    println!("score: {}", result.evaluation.score);
    for (index, choices) in result.assignment.positions.iter().enumerate() {
        let letters: String = choices.iter().collect();
        println!("position {}: {}", index + 1, letters);
    }
    if !result.evaluation.words.is_empty() {
        println!("words:");
        for word in result.evaluation.words {
            println!("- {}", word.word);
        }
    }

    Ok(())
}
