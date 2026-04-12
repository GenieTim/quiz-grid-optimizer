#[cfg(feature = "cli")]
fn main() {
    if let Err(error) = quiz_grid_optimizer::cli::run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

#[cfg(not(feature = "cli"))]
fn main() {}
