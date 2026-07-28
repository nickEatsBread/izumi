use realfft::num_complex::Complex;
use realfft::RealFftPlanner;

const GRID_HZ: f32 = 100.0;
const MAX_LAG_SEC: f32 = 60.0;
const Z_MIN: f32 = 6.0;
const DOMINANCE_MIN: f32 = 1.3;

pub struct Result {
    pub offset_sec: f32,
    pub ratio: f32,
    pub confidence: f32,
}

fn ratios() -> Vec<f32> {
    let mut values = Vec::new();
    for ratio in [1.0f32, 1.25, 0.8, 1.0427, 1.00092, 1.04167] {
        for candidate in [ratio, 1.0 / ratio] {
            if !values.iter().any(|value: &f32| (*value - candidate).abs() < 1e-5) {
                values.push(candidate);
            }
        }
    }
    values
}

fn rasterize(intervals: &[(f32, f32)], scale: f32, length: usize) -> Vec<f32> {
    let mut mask = vec![0.0; length];
    for &(start, end) in intervals {
        let first = (start * scale * GRID_HZ).round().max(0.0) as usize;
        let last = (end * scale * GRID_HZ).round().max(0.0) as usize;
        for point in mask.iter_mut().take(last.min(length)).skip(first.min(length)) {
            *point = 1.0;
        }
    }
    mask
}

fn fft_xcorr(left: &[f32], right: &[f32], max_lag: usize) -> Vec<f32> {
    let size = (left.len().max(right.len()) + max_lag + 1).next_power_of_two();
    let mut planner = RealFftPlanner::<f32>::new();
    let forward = planner.plan_fft_forward(size);
    let inverse = planner.plan_fft_inverse(size);
    let mut left_buf = forward.make_input_vec();
    let mut right_buf = forward.make_input_vec();
    left_buf[..left.len()].copy_from_slice(left);
    right_buf[..right.len()].copy_from_slice(right);
    let mut left_spec = forward.make_output_vec();
    let mut right_spec = forward.make_output_vec();
    if forward.process(&mut left_buf, &mut left_spec).is_err()
        || forward.process(&mut right_buf, &mut right_spec).is_err()
    {
        return vec![0.0; max_lag * 2 + 1];
    }
    let mut product = left_spec
        .iter()
        .zip(right_spec.iter())
        .map(|(&a, &b)| a * b.conj())
        .collect::<Vec<Complex<f32>>>();
    let mut output = inverse.make_output_vec();
    if inverse.process(&mut product, &mut output).is_err() {
        return vec![0.0; max_lag * 2 + 1];
    }
    let mut correlation = vec![0.0; max_lag * 2 + 1];
    for lag in 0..=max_lag {
        correlation[max_lag + lag] = output[lag] / size as f32;
        if lag > 0 {
            correlation[max_lag - lag] = output[size - lag] / size as f32;
        }
    }
    correlation
}

fn peak_stats(correlation: &[f32]) -> (usize, f32, f32) {
    let (index, peak) = correlation
        .iter()
        .copied()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .unwrap_or((0, 0.0));
    let mean = correlation.iter().sum::<f32>() / correlation.len() as f32;
    let deviation = (correlation.iter().map(|value| (value - mean).powi(2)).sum::<f32>()
        / correlation.len() as f32)
        .sqrt()
        .max(1e-9);
    let guard = GRID_HZ as usize;
    let second = correlation
        .iter()
        .copied()
        .enumerate()
        .filter(|(other, _)| other.abs_diff(index) > guard)
        .map(|(_, value)| value)
        .max_by(f32::total_cmp)
        .unwrap_or(0.0);
    (index, (peak - mean) / deviation, if second > 1e-6 { peak / second } else { f32::INFINITY })
}

fn normalized_score(left: &[f32], right: &[f32], lag: isize) -> f32 {
    let pairs = left.iter().copied().enumerate().filter_map(|(index, value)| {
        let other = index as isize - lag;
        (other >= 0 && (other as usize) < right.len()).then_some((value, right[other as usize]))
    }).collect::<Vec<_>>();
    if pairs.is_empty() {
        return 0.0;
    }
    let left_mean = pairs.iter().map(|pair| pair.0).sum::<f32>() / pairs.len() as f32;
    let right_mean = pairs.iter().map(|pair| pair.1).sum::<f32>() / pairs.len() as f32;
    let mut product = 0.0;
    let mut left_square = 0.0;
    let mut right_square = 0.0;
    for (left, right) in pairs {
        let a = left - left_mean;
        let b = right - right_mean;
        product += a * b;
        left_square += a * a;
        right_square += b * b;
    }
    let denominator = (left_square * right_square).sqrt();
    if denominator < 1e-9 { 0.0 } else { product / denominator }
}

pub fn solve(
    audio: &[(f32, f32)],
    subtitles: &[(f32, f32)],
    duration: f32,
    confidence_min: f32,
) -> Option<Result> {
    let length = (duration * GRID_HZ).round().max(1.0) as usize;
    let audio_mask = rasterize(audio, 1.0, length);
    let max_lag = (MAX_LAG_SEC * GRID_HZ) as usize;
    let mut best: Option<(f32, isize, f32, f32, f32)> = None;
    for ratio in ratios() {
        let subtitle_mask = rasterize(subtitles, ratio, length);
        let correlation = fft_xcorr(&audio_mask, &subtitle_mask, max_lag);
        let (peak, z, dominance) = peak_stats(&correlation);
        let lag = peak as isize - max_lag as isize;
        let score = normalized_score(&audio_mask, &subtitle_mask, lag);
        if best.is_none_or(|candidate| score > candidate.2) {
            best = Some((ratio, lag, score, z, dominance));
        }
    }
    let (ratio, lag, confidence, z, dominance) = best?;
    let offset_sec = lag as f32 / GRID_HZ;
    (confidence >= confidence_min
        && z >= Z_MIN
        && dominance >= DOMINANCE_MIN
        && offset_sec.abs() <= MAX_LAG_SEC)
        .then_some(Result { offset_sec, ratio, confidence })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pattern() -> Vec<(f32, f32)> {
        let gaps = [4.3, 6.1, 3.2, 7.4, 5.0, 3.9, 8.2, 4.7];
        let mut time = 5.0;
        (0..26).map(|index| {
            let duration = 1.0 + (index % 4) as f32 * 0.3;
            let cue = (time, time + duration);
            time += duration + gaps[index % gaps.len()];
            cue
        }).collect()
    }

    #[test]
    fn finds_offset() {
        let subtitles = pattern();
        let audio = subtitles.iter().map(|&(a, b)| (a + 7.3, b + 7.3)).collect::<Vec<_>>();
        let result = solve(&audio, &subtitles, 260.0, 0.55).unwrap();
        assert!((result.offset_sec - 7.3).abs() < 0.05);
    }
}
