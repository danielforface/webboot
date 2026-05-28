use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

const EINVAL: i32 = -22;

pub const SENSOR_ACCELEROMETER: u32 = 0;
pub const SENSOR_GYROSCOPE: u32 = 1;
pub const SENSOR_MAGNETOMETER: u32 = 2;
pub const SENSOR_ORIENTATION: u32 = 3;

#[derive(Debug, Clone, Copy, Default)]
pub struct SensorDataRaw {
  pub x: f32,
  pub y: f32,
  pub z: f32,
  pub timestamp_ns: u64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SensorSnapshot {
  pub accelerometer: SensorDataRaw,
  pub gyroscope: SensorDataRaw,
  pub magnetometer: SensorDataRaw,
  pub orientation: SensorDataRaw,
  pub last_interrupt_ns: u64,
  pub sequence: u64,
}

pub struct SensorHalRegistry {
  accelerometer: Mutex<SensorDataRaw>,
  gyroscope: Mutex<SensorDataRaw>,
  magnetometer: Mutex<SensorDataRaw>,
  orientation: Mutex<SensorDataRaw>,
  last_interrupt_ns: AtomicU64,
  sequence: AtomicU64,
  samples: AtomicU64,
}

impl SensorHalRegistry {
  pub fn new() -> Self {
    Self {
      accelerometer: Mutex::new(SensorDataRaw::default()),
      gyroscope: Mutex::new(SensorDataRaw::default()),
      magnetometer: Mutex::new(SensorDataRaw::default()),
      orientation: Mutex::new(SensorDataRaw::default()),
      last_interrupt_ns: AtomicU64::new(0),
      sequence: AtomicU64::new(0),
      samples: AtomicU64::new(0),
    }
  }

  pub fn inject(
    &self,
    sensor_id: u32,
    x: f32,
    y: f32,
    z: f32,
    timestamp_ns: u64,
  ) -> Result<SensorDataRaw, i32> {
    let data = SensorDataRaw {
      x,
      y,
      z,
      timestamp_ns,
    };

    match sensor_id {
      SENSOR_ACCELEROMETER => {
        let mut lock = self
          .accelerometer
          .lock()
          .unwrap_or_else(|poisoned| poisoned.into_inner());
        *lock = data;
      }
      SENSOR_GYROSCOPE => {
        let mut lock = self
          .gyroscope
          .lock()
          .unwrap_or_else(|poisoned| poisoned.into_inner());
        *lock = data;
      }
      SENSOR_MAGNETOMETER => {
        let mut lock = self
          .magnetometer
          .lock()
          .unwrap_or_else(|poisoned| poisoned.into_inner());
        *lock = data;
      }
      SENSOR_ORIENTATION => {
        let mut lock = self
          .orientation
          .lock()
          .unwrap_or_else(|poisoned| poisoned.into_inner());
        *lock = data;
      }
      _ => return Err(EINVAL),
    }

    self.last_interrupt_ns.store(timestamp_ns, Ordering::Release);
    self.sequence.fetch_add(1, Ordering::AcqRel);
    self.samples.fetch_add(1, Ordering::AcqRel);
    Ok(data)
  }

  pub fn snapshot(&self) -> SensorSnapshot {
    let accelerometer = *self
      .accelerometer
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner());
    let gyroscope = *self
      .gyroscope
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner());
    let magnetometer = *self
      .magnetometer
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner());
    let orientation = *self
      .orientation
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner());

    SensorSnapshot {
      accelerometer,
      gyroscope,
      magnetometer,
      orientation,
      last_interrupt_ns: self.last_interrupt_ns.load(Ordering::Acquire),
      sequence: self.sequence.load(Ordering::Acquire),
    }
  }

  pub fn sequence(&self) -> u64 {
    self.sequence.load(Ordering::Acquire)
  }

  pub fn sample_count(&self) -> u64 {
    self.samples.load(Ordering::Acquire)
  }
}
