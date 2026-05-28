use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

pub const MAX_GAMEPAD_SLOTS: usize = 8;
pub const MAX_GAMEPAD_AXES: usize = 8;

#[derive(Debug, Clone, Copy)]
pub struct GamepadPacket {
  pub index: u32,
  pub buttons_bitmap: u64,
  pub axes: [f32; MAX_GAMEPAD_AXES],
  pub axes_len: u32,
  pub timestamp_ns: u64,
  pub sequence: u64,
}

impl Default for GamepadPacket {
  fn default() -> Self {
    Self {
      index: 0,
      buttons_bitmap: 0,
      axes: [0.0; MAX_GAMEPAD_AXES],
      axes_len: 0,
      timestamp_ns: 0,
      sequence: 0,
    }
  }
}

pub struct GamepadHalRegistry {
  slots: Mutex<[GamepadPacket; MAX_GAMEPAD_SLOTS]>,
  sequence: AtomicU64,
  samples: AtomicU64,
}

impl GamepadHalRegistry {
  pub fn new() -> Self {
    Self {
      slots: Mutex::new([GamepadPacket::default(); MAX_GAMEPAD_SLOTS]),
      sequence: AtomicU64::new(0),
      samples: AtomicU64::new(0),
    }
  }

  pub fn inject(
    &self,
    index: u32,
    buttons_bitmap: u64,
    axes: &[f32],
    timestamp_ns: u64,
  ) -> GamepadPacket {
    let mut packet = GamepadPacket::default();
    packet.index = index;
    packet.buttons_bitmap = buttons_bitmap;
    packet.timestamp_ns = timestamp_ns;

    let copy_len = axes.len().min(MAX_GAMEPAD_AXES);
    packet.axes_len = copy_len as u32;
    if copy_len > 0 {
      packet.axes[0..copy_len].copy_from_slice(&axes[0..copy_len]);
    }

    let sequence = self.sequence.fetch_add(1, Ordering::AcqRel) + 1;
    packet.sequence = sequence;

    let slot = (index as usize) % MAX_GAMEPAD_SLOTS;
    {
      let mut lock = self
        .slots
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      lock[slot] = packet;
    }

    self.samples.fetch_add(1, Ordering::AcqRel);
    packet
  }

  pub fn snapshot(&self, index: u32) -> GamepadPacket {
    let slot = (index as usize) % MAX_GAMEPAD_SLOTS;
    let lock = self
      .slots
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner());
    lock[slot]
  }

  pub fn sequence(&self) -> u64 {
    self.sequence.load(Ordering::Acquire)
  }

  pub fn sample_count(&self) -> u64 {
    self.samples.load(Ordering::Acquire)
  }
}
