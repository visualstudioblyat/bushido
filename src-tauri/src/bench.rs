use std::time::Instant;
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct BenchResult {
    pub name: String,
    pub iterations: u64,
    pub total_ms: f64,
    pub avg_us: f64,
    pub min_us: f64,
    pub max_us: f64,
    pub p99_us: f64,
}

pub fn run_bench<F: FnMut()>(name: &str, iterations: u64, mut f: F) -> BenchResult {
    let mut times = Vec::with_capacity(iterations as usize);

    // warmup
    for _ in 0..5 { f(); }

    for _ in 0..iterations {
        let start = Instant::now();
        f();
        times.push(start.elapsed().as_nanos() as f64 / 1000.0);
    }

    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let total_us: f64 = times.iter().sum();
    let p99_idx = ((iterations as f64 * 0.99) as usize).min(times.len() - 1);

    BenchResult {
        name: name.to_string(),
        iterations,
        total_ms: total_us / 1000.0,
        avg_us: total_us / iterations as f64,
        min_us: times[0],
        max_us: *times.last().unwrap(),
        p99_us: times[p99_idx],
    }
}
