use crate::error::{AppError, Result};
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Debug)]
pub struct Dictionary {
    words: Vec<String>,
    weights: Vec<usize>,
    words_by_length: std::collections::BTreeMap<usize, Vec<Vec<char>>>,
    weights_by_length: std::collections::BTreeMap<usize, Vec<usize>>,
    alphabet: Vec<char>,
}

impl Dictionary {
    pub fn from_words<I, S>(words: I) -> Result<Self>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        Self::from_weighted_words(words.into_iter().map(|word| (word, 1usize)))
    }

    pub fn from_weighted_words<I, S>(words: I) -> Result<Self>
    where
        I: IntoIterator<Item = (S, usize)>,
        S: AsRef<str>,
    {
        let mut normalized_words = Vec::new();
        let mut normalized_weights = Vec::new();
        let mut alphabet = BTreeSet::new();
        let mut words_by_length: std::collections::BTreeMap<usize, Vec<Vec<char>>> =
            std::collections::BTreeMap::new();
        let mut weights_by_length: std::collections::BTreeMap<usize, Vec<usize>> =
            std::collections::BTreeMap::new();

        for (raw, weight) in words {
            let word = normalize_word(raw.as_ref());
            if word.is_empty() || !word.chars().all(|c| c.is_alphabetic()) {
                continue;
            }
            if weight == 0 {
                continue;
            }

            let chars: Vec<char> = word.chars().collect();
            alphabet.extend(chars.iter().copied());
            words_by_length
                .entry(chars.len())
                .or_default()
                .push(chars.clone());
            weights_by_length.entry(chars.len()).or_default().push(weight);
            normalized_words.push(word);
            normalized_weights.push(weight);
        }

        if normalized_words.is_empty() {
            return Err(AppError::EmptyDictionary);
        }

        Ok(Self {
            words: normalized_words,
            weights: normalized_weights,
            words_by_length,
            weights_by_length,
            alphabet: alphabet.into_iter().collect(),
        })
    }

    pub fn from_text(text: &str) -> Result<Self> {
        Self::from_words(text.lines().map(str::trim).filter(|line| !line.is_empty()))
    }

    pub fn from_file(path: impl AsRef<Path>) -> Result<Self> {
        let text = fs::read_to_string(path)?;
        Self::from_text(&text)
    }

    pub fn words_of_length(&self, length: usize) -> &[Vec<char>] {
        self.words_by_length
            .get(&length)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    pub fn weights_of_length(&self, length: usize) -> &[usize] {
        self.weights_by_length
            .get(&length)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    pub fn alphabet(&self) -> &[char] {
        &self.alphabet
    }

    pub fn all_words(&self) -> &[String] {
        &self.words
    }

    pub fn all_weights(&self) -> &[usize] {
        &self.weights
    }
}

pub fn normalize_word(word: &str) -> String {
    word.nfc().flat_map(|c| c.to_lowercase()).collect()
}
