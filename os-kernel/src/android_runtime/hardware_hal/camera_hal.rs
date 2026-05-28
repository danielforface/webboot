use std::cmp::min;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

const EINVAL: i32 = -22;

pub const MAX_CAMERA_FRAME_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone, Copy, Default)]
pub struct CameraFrameMeta {
  pub width: u32,
  pub height: u32,
  pub pixel_format: u32,
  pub frame_len: u32,
  pub timestamp_ns: u64,
}

pub struct CameraHalRegistry {
  meta: Mutex<CameraFrameMeta>,
  shadow_frame: Mutex<[u8; MAX_CAMERA_FRAME_BYTES]>,
  sequence: AtomicU64,
  samples: AtomicU64,
}

impl CameraHalRegistry {
  pub fn new() -> Self {
    Self {
      meta: Mutex::new(CameraFrameMeta::default()),
      shadow_frame: Mutex::new([0_u8; MAX_CAMERA_FRAME_BYTES]),
      sequence: AtomicU64::new(0),
      samples: AtomicU64::new(0),
    }
  }

  pub fn inject(
    &self,
    width: u32,
    height: u32,
    pixel_format: u32,
    frame: &[u8],
    timestamp_ns: u64,
  ) -> Result<CameraFrameMeta, i32> {
    if width == 0 || height == 0 {
      return Err(EINVAL);
    }

    let copy_len = min(frame.len(), MAX_CAMERA_FRAME_BYTES);
    {
      let mut lock = self
        .shadow_frame
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      lock[0..copy_len].copy_from_slice(&frame[0..copy_len]);
      if copy_len < lock.len() {
        lock[copy_len..].fill(0);
      }
    }

    let meta = CameraFrameMeta {
      width,
      height,
      pixel_format,
      frame_len: copy_len as u32,
      timestamp_ns,
    };

    {
      let mut lock = self
        .meta
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      *lock = meta;
    }

    self.sequence.fetch_add(1, Ordering::AcqRel);
    self.samples.fetch_add(1, Ordering::AcqRel);
    Ok(meta)
  }

  pub fn latest_frame(&self, out: &mut [u8]) -> (CameraFrameMeta, usize) {
    let meta = *self
      .meta
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner());
    let max_len = min(meta.frame_len as usize, MAX_CAMERA_FRAME_BYTES);
    let copy_len = min(max_len, out.len());

    if copy_len > 0 {
      let lock = self
        .shadow_frame
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      out[0..copy_len].copy_from_slice(&lock[0..copy_len]);
    }

    (meta, copy_len)
  }

  pub fn sequence(&self) -> u64 {
    self.sequence.load(Ordering::Acquire)
  }

  pub fn sample_count(&self) -> u64 {
    self.samples.load(Ordering::Acquire)
  }
}
