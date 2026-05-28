use std::cmp::min;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

pub const MAX_NFC_TEXT_BYTES: usize = 96;
pub const MAX_NFC_PAYLOAD_BYTES: usize = 2048;

#[derive(Debug, Clone, Default)]
pub struct NfcRecord {
  pub record_type: String,
  pub media_type: String,
  pub payload: Vec<u8>,
  pub timestamp_ns: u64,
}

pub struct NfcHalRegistry {
  latest: Mutex<NfcRecord>,
  sequence: AtomicU64,
  samples: AtomicU64,
}

impl NfcHalRegistry {
  pub fn new() -> Self {
    Self {
      latest: Mutex::new(NfcRecord::default()),
      sequence: AtomicU64::new(0),
      samples: AtomicU64::new(0),
    }
  }

  pub fn inject(
    &self,
    record_type: &str,
    media_type: &str,
    payload: &[u8],
    timestamp_ns: u64,
  ) -> NfcRecord {
    let record = NfcRecord {
      record_type: truncate_utf8(record_type, MAX_NFC_TEXT_BYTES),
      media_type: truncate_utf8(media_type, MAX_NFC_TEXT_BYTES),
      payload: payload[0..min(payload.len(), MAX_NFC_PAYLOAD_BYTES)].to_vec(),
      timestamp_ns,
    };

    {
      let mut lock = self
        .latest
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      *lock = record.clone();
    }

    self.sequence.fetch_add(1, Ordering::AcqRel);
    self.samples.fetch_add(1, Ordering::AcqRel);
    record
  }

  pub fn snapshot(&self) -> NfcRecord {
    self
      .latest
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner())
      .clone()
  }

  pub fn sequence(&self) -> u64 {
    self.sequence.load(Ordering::Acquire)
  }

  pub fn sample_count(&self) -> u64 {
    self.samples.load(Ordering::Acquire)
  }
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
  if value.len() <= max_bytes {
    return value.to_owned();
  }

  let mut out = String::new();
  for ch in value.chars() {
    let next_len = out.len() + ch.len_utf8();
    if next_len > max_bytes {
      break;
    }
    out.push(ch);
  }
  out
}
