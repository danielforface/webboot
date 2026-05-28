use std::cmp::min;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

pub const MAX_SERIAL_PORTS: usize = 8;
pub const MAX_SERIAL_BYTES: usize = 512;

#[derive(Debug, Clone, Copy)]
pub struct SerialPacket {
  pub port_id: u32,
  pub len: u32,
  pub bytes: [u8; MAX_SERIAL_BYTES],
  pub timestamp_ns: u64,
  pub sequence: u64,
}

impl Default for SerialPacket {
  fn default() -> Self {
    Self {
      port_id: 0,
      len: 0,
      bytes: [0_u8; MAX_SERIAL_BYTES],
      timestamp_ns: 0,
      sequence: 0,
    }
  }
}

pub struct SerialIotHalRegistry {
  ports: Mutex<[SerialPacket; MAX_SERIAL_PORTS]>,
  sequence: AtomicU64,
  samples: AtomicU64,
}

impl SerialIotHalRegistry {
  pub fn new() -> Self {
    Self {
      ports: Mutex::new([SerialPacket::default(); MAX_SERIAL_PORTS]),
      sequence: AtomicU64::new(0),
      samples: AtomicU64::new(0),
    }
  }

  pub fn inject(&self, port_id: u32, data: &[u8], timestamp_ns: u64) -> SerialPacket {
    let mut packet = SerialPacket::default();
    packet.port_id = port_id;
    packet.timestamp_ns = timestamp_ns;

    let copy_len = min(data.len(), MAX_SERIAL_BYTES);
    packet.len = copy_len as u32;
    if copy_len > 0 {
      packet.bytes[0..copy_len].copy_from_slice(&data[0..copy_len]);
    }

    let sequence = self.sequence.fetch_add(1, Ordering::AcqRel) + 1;
    packet.sequence = sequence;

    let slot = (port_id as usize) % MAX_SERIAL_PORTS;
    {
      let mut lock = self
        .ports
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      lock[slot] = packet;
    }

    self.samples.fetch_add(1, Ordering::AcqRel);
    packet
  }

  pub fn snapshot(&self, port_id: u32) -> SerialPacket {
    let slot = (port_id as usize) % MAX_SERIAL_PORTS;
    let lock = self
      .ports
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
