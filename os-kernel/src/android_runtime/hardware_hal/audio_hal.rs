use std::cmp::min;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

const EINVAL: i32 = -22;

pub const MAX_AUDIO_PACKET_BYTES: usize = 8192;

#[derive(Debug, Clone, Copy, Default)]
pub struct AudioPacketHeader {
  pub channels: u32,
  pub sample_rate: u32,
  pub buffer_len: u32,
  pub timestamp_ns: u64,
}

pub struct AudioHalRegistry {
  header: Mutex<AudioPacketHeader>,
  shadow_pcm: Mutex<[u8; MAX_AUDIO_PACKET_BYTES]>,
  sequence: AtomicU64,
  samples: AtomicU64,
}

impl AudioHalRegistry {
  pub fn new() -> Self {
    Self {
      header: Mutex::new(AudioPacketHeader::default()),
      shadow_pcm: Mutex::new([0_u8; MAX_AUDIO_PACKET_BYTES]),
      sequence: AtomicU64::new(0),
      samples: AtomicU64::new(0),
    }
  }

  pub fn inject(
    &self,
    channels: u32,
    sample_rate: u32,
    pcm: &[u8],
    timestamp_ns: u64,
  ) -> Result<AudioPacketHeader, i32> {
    if channels == 0 || sample_rate == 0 {
      return Err(EINVAL);
    }

    let copy_len = min(pcm.len(), MAX_AUDIO_PACKET_BYTES);
    {
      let mut lock = self
        .shadow_pcm
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      lock[0..copy_len].copy_from_slice(&pcm[0..copy_len]);
      if copy_len < lock.len() {
        lock[copy_len..].fill(0);
      }
    }

    let header = AudioPacketHeader {
      channels,
      sample_rate,
      buffer_len: copy_len as u32,
      timestamp_ns,
    };

    {
      let mut lock = self
        .header
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      *lock = header;
    }

    self.sequence.fetch_add(1, Ordering::AcqRel);
    self.samples.fetch_add(1, Ordering::AcqRel);
    Ok(header)
  }

  pub fn latest_packet(&self, out: &mut [u8]) -> (AudioPacketHeader, usize) {
    let header = *self
      .header
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner());
    let max_len = min(header.buffer_len as usize, MAX_AUDIO_PACKET_BYTES);
    let copy_len = min(max_len, out.len());

    if copy_len > 0 {
      let lock = self
        .shadow_pcm
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      out[0..copy_len].copy_from_slice(&lock[0..copy_len]);
    }

    (header, copy_len)
  }

  pub fn sequence(&self) -> u64 {
    self.sequence.load(Ordering::Acquire)
  }

  pub fn sample_count(&self) -> u64 {
    self.samples.load(Ordering::Acquire)
  }
}
