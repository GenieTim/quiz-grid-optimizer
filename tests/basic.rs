use quiz_grid_optimizer::dictionary::{normalize_word, Dictionary};
use quiz_grid_optimizer::domain::{Assignment, Puzzle};
use quiz_grid_optimizer::evaluator::Evaluator;
use quiz_grid_optimizer::search::{OptimizationConfig, SearchMode, Solver};

#[test]
fn normalizes_unicode_words() {
    assert_eq!(normalize_word("MÄdchen"), "mädchen");
}

#[test]
fn evaluates_matching_words() {
    let dictionary = Dictionary::from_words(["haus", "maus", "baum"]).unwrap();
    let evaluator = Evaluator::new(&dictionary, 4);
    let assignment = Assignment::new(vec![
        vec!['h', 'm'],
        vec!['a', 'u'],
        vec!['u', 'a'],
        vec!['s', 'm'],
    ]);

    let direct = evaluator.evaluate(&assignment).unwrap();
    assert_eq!(direct.score, 2);
    assert_eq!(direct.match_count, 2);
    assert!(direct.words.iter().any(|word| word.word == "haus"));
    assert!(direct.words.iter().any(|word| word.word == "maus"));
}

#[test]
fn evaluates_with_weights() {
    let dictionary = Dictionary::from_weighted_words([
        ("haus", 10usize),
        ("maus", 3usize),
        ("baum", 1usize),
    ])
    .unwrap();
    let evaluator = Evaluator::new(&dictionary, 4);
    let assignment = Assignment::new(vec![
        vec!['h', 'm'],
        vec!['a', 'u'],
        vec!['u', 'a'],
        vec!['s', 'm'],
    ]);

    let direct = evaluator.evaluate(&assignment).unwrap();
    assert_eq!(direct.match_count, 2);
    assert_eq!(direct.score, 13);
    assert!(
        direct
            .words
            .iter()
            .any(|word| word.word == "haus" && word.score_weight == 10)
    );
    assert!(
        direct
            .words
            .iter()
            .any(|word| word.word == "maus" && word.score_weight == 3)
    );
}

#[test]
fn hill_climb_produces_a_valid_result() {
    let dictionary = Dictionary::from_words(["haus", "maus", "baum"]).unwrap();
    let solver = Solver::new(&dictionary, Puzzle::new(4, 2, dictionary.alphabet().to_vec()));

    let result = solver
        .solve(OptimizationConfig {
            mode: SearchMode::HillClimb,
            max_iterations: 10,
            fixed_solution_word: None,
        })
        .unwrap();

    assert_eq!(result.assignment.n(), 4);
    assert_eq!(result.assignment.k(), 2);
}

#[test]
fn hill_climb_snapshots_are_monotonic() {
    let dictionary = Dictionary::from_words(["haus", "maus", "baum", "huhn", "mahl"]).unwrap();
    let solver = Solver::new(&dictionary, Puzzle::new(4, 2, dictionary.alphabet().to_vec()));

    let (result, snapshots) = solver
        .solve_with_snapshots(OptimizationConfig {
            mode: SearchMode::HillClimb,
            max_iterations: 20,
            fixed_solution_word: None,
        })
        .unwrap();

    assert!(!snapshots.is_empty());
    assert_eq!(snapshots[0].iteration, 0);

    for pair in snapshots.windows(2) {
        assert!(pair[1].best_score >= pair[0].best_score);
        assert_eq!(pair[1].iteration, pair[0].iteration + 1);
    }

    let last = snapshots.last().unwrap();
    assert_eq!(last.best_score, result.evaluation.score);
    assert_eq!(last.match_count, result.evaluation.match_count);
}

#[test]
fn fixed_solution_word_is_enforced() {
    let dictionary = Dictionary::from_words(["haus", "maus", "baum", "huhn"]).unwrap();
    let solver = Solver::new(&dictionary, Puzzle::new(4, 2, dictionary.alphabet().to_vec()));

    let result = solver
        .solve(OptimizationConfig {
            mode: SearchMode::HillClimb,
            max_iterations: 25,
            fixed_solution_word: Some("haus".into()),
        })
        .unwrap();

    let required: Vec<char> = "haus".chars().collect();
    for (position, letter) in required.iter().enumerate() {
        assert!(result.assignment.contains(position, *letter));
    }
}
