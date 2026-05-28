use std::cmp::min;
use std::collections::BTreeMap;

const MAX_CAPTURE_BYTES: usize = 128 * 1024;

#[derive(Clone, Copy)]
pub struct MediaStream {
  pub stream_id: u32,
  pub stream_type: u32,
  pub rate: u32,
  pub channels: u32,
  pub queued_samples: u64,
}

pub struct MediaPipelineState {
  streams: BTreeMap<u32, MediaStream>,
  next_stream_id: u32,
  capture_sequence: u32,
  total_pcm_samples: u64,
  sequence: u32,
}

impl MediaPipelineState {
  pub fn new() -> Self {
    Self {
      streams: BTreeMap::new(),
      next_stream_id: 1,
      capture_sequence: 1,
      total_pcm_samples: 0,
      sequence: 1,
    }
  }

  pub fn stream_open(&mut self, stream_type: u32, rate: u32, channels: u32) -> u32 {
    let stream_id = self.next_stream_id;
    self.next_stream_id = self.next_stream_id.wrapping_add(1).max(1);

    let stream = MediaStream {
      stream_id,
      stream_type,
      rate,
      channels,
      queued_samples: 0,
    };

    self.streams.insert(stream_id, stream);
    self.sequence = self.sequence.wrapping_add(1);
    stream_id
  }

  pub fn push_pcm(&mut self, stream_id: u32, sample_count: u32) -> Result<(), i32> {
    let Some(stream) = self.streams.get_mut(&stream_id) else {
      return Err(-2);
    };

    stream.queued_samples = stream.queued_samples.saturating_add(sample_count as u64);
    self.total_pcm_samples = self.total_pcm_samples.saturating_add(sample_count as u64);
    self.sequence = self.sequence.wrapping_add(1);
    Ok(())
  }

  pub fn capture_frame(&mut self, window_id: u32, out: &mut [u8]) -> usize {
    if out.len() < 24 {
      return 0;
    }

    let payload_len = min(out.len().saturating_sub(24), MAX_CAPTURE_BYTES);

    out[0..4].copy_from_slice(&window_id.to_le_bytes());
    out[4..8].copy_from_slice(&self.capture_sequence.to_le_bytes());
    out[8..12].copy_from_slice(&(payload_len as u32).to_le_bytes());
    out[12..16].copy_from_slice(&(320_u32).to_le_bytes());
    out[16..20].copy_from_slice(&(180_u32).to_le_bytes());
    out[20..24].copy_from_slice(&(4_u32).to_le_bytes());

    for (idx, byte) in out[24..24 + payload_len].iter_mut().enumerate() {
      let x = (idx % 320) as u8;
      let y = ((idx / 320) % 180) as u8;
      *byte = x ^ y ^ (window_id as u8);
    }

    self.capture_sequence = self.capture_sequence.wrapping_add(1);
    self.sequence = self.sequence.wrapping_add(1);
    24 + payload_len
  }

  pub fn stream_count(&self) -> u32 {
    self.streams.len() as u32
  }

  pub fn total_pcm_samples(&self) -> u64 {
    self.total_pcm_samples
  }

  pub fn snapshot(&self, out: &mut [u8]) -> usize {
    if out.len() < 20 {
      return 0;
    }

    out[0..4].copy_from_slice(&self.sequence.to_le_bytes());
    out[4..8].copy_from_slice(&(self.streams.len() as u32).to_le_bytes());
    out[8..12].copy_from_slice(&(self.total_pcm_samples as u32).to_le_bytes());
    out[12..16].copy_from_slice(&((self.total_pcm_samples >> 32) as u32).to_le_bytes());
    out[16..20].copy_from_slice(&self.capture_sequence.to_le_bytes());

    let mut cursor = 20;
    for stream in self.streams.values() {
      if cursor + 20 > out.len() {
        break;
      }

      out[cursor..cursor + 4].copy_from_slice(&stream.stream_id.to_le_bytes());
      out[cursor + 4..cursor + 8].copy_from_slice(&stream.stream_type.to_le_bytes());
      out[cursor + 8..cursor + 12].copy_from_slice(&stream.rate.to_le_bytes());
      out[cursor + 12..cursor + 16].copy_from_slice(&stream.channels.to_le_bytes());
      out[cursor + 16..cursor + 20].copy_from_slice(&(stream.queued_samples as u32).to_le_bytes());
      cursor += 20;
    }

    cursor
  }
}
