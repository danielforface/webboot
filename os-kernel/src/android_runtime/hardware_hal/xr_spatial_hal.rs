use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

pub const XR_TRANSFORM_VALUES: usize = 16;
pub const MAX_XR_HAND_VECTOR: usize = 32;

#[derive(Debug, Clone, Copy)]
pub struct XrPoseMatrix {
  pub transform: [f32; XR_TRANSFORM_VALUES],
  pub hand_tracking: [f32; MAX_XR_HAND_VECTOR],
  pub hand_tracking_len: u32,
  pub timestamp_ns: u64,
  pub sequence: u64,
}

impl Default for XrPoseMatrix {
  fn default() -> Self {
    Self {
      transform: [0.0; XR_TRANSFORM_VALUES],
      hand_tracking: [0.0; MAX_XR_HAND_VECTOR],
      hand_tracking_len: 0,
      timestamp_ns: 0,
      sequence: 0,
    }
  }
}

pub struct XrSpatialHalRegistry {
  latest: Mutex<XrPoseMatrix>,
  sequence: AtomicU64,
  samples: AtomicU64,
}

impl XrSpatialHalRegistry {
  pub fn new() -> Self {
    Self {
      latest: Mutex::new(XrPoseMatrix::default()),
      sequence: AtomicU64::new(0),
      samples: AtomicU64::new(0),
    }
  }

  pub fn inject(
    &self,
    transform: &[f32],
    hand_tracking: &[f32],
    timestamp_ns: u64,
  ) -> XrPoseMatrix {
    let mut pose = XrPoseMatrix::default();
    pose.timestamp_ns = timestamp_ns;

    let transform_len = transform.len().min(XR_TRANSFORM_VALUES);
    if transform_len > 0 {
      pose.transform[0..transform_len].copy_from_slice(&transform[0..transform_len]);
    }

    let hand_len = hand_tracking.len().min(MAX_XR_HAND_VECTOR);
    pose.hand_tracking_len = hand_len as u32;
    if hand_len > 0 {
      pose.hand_tracking[0..hand_len].copy_from_slice(&hand_tracking[0..hand_len]);
    }

    let sequence = self.sequence.fetch_add(1, Ordering::AcqRel) + 1;
    pose.sequence = sequence;

    {
      let mut lock = self
        .latest
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      *lock = pose;
    }

    self.samples.fetch_add(1, Ordering::AcqRel);
    pose
  }

  pub fn snapshot(&self) -> XrPoseMatrix {
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
