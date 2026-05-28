use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

pub const MAX_HAPTIC_PATTERN_VALUES: usize = 16;

#[derive(Debug, Clone, Copy)]
pub struct HapticPatternState {
  pub pattern_ms: [u32; MAX_HAPTIC_PATTERN_VALUES],
  pub pattern_len: u32,
  pub timestamp_ns: u64,
  pub sequence: u64,
}

impl Default for HapticPatternState {
  fn default() -> Self {
    Self {
      pattern_ms: [0_u32; MAX_HAPTIC_PATTERN_VALUES],
      pattern_len: 0,
      timestamp_ns: 0,
      sequence: 0,
    }
  }
}

pub struct HapticFeedbackHalRegistry {
  latest: Mutex<HapticPatternState>,
  sequence: AtomicU64,
  samples: AtomicU64,
}

impl HapticFeedbackHalRegistry {
  pub fn new() -> Self {
    Self {
      latest: Mutex::new(HapticPatternState::default()),
      sequence: AtomicU64::new(0),
      samples: AtomicU64::new(0),
    }
  }

  pub fn set_pattern(&self, pattern_ms: &[u32], timestamp_ns: u64) -> HapticPatternState {
    let mut state = HapticPatternState::default();
    state.timestamp_ns = timestamp_ns;

    let copy_len = pattern_ms.len().min(MAX_HAPTIC_PATTERN_VALUES);
    state.pattern_len = copy_len as u32;
    if copy_len > 0 {
      state.pattern_ms[0..copy_len].copy_from_slice(&pattern_ms[0..copy_len]);
    }

    let sequence = self.sequence.fetch_add(1, Ordering::AcqRel) + 1;
    state.sequence = sequence;

    {
      let mut lock = self
        .latest
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      *lock = state;
    }

    self.samples.fetch_add(1, Ordering::AcqRel);
    state
  }

  pub fn snapshot(&self) -> HapticPatternState {
    *self
      .latest
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner())
  }

  pub fn sequence(&self) -> u64 {
    self.sequence.load(Ordering::Acquire)
  }

  pub fn sample_count(&self) -> u64 {
    self.samples.load(Ordering::Acquire)
  }
}
