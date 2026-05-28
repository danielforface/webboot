use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, Default)]
pub struct GpsCoords {
  pub latitude: f64,
  pub longitude: f64,
  pub altitude: f64,
  pub accuracy: f32,
  pub heading: f32,
  pub speed: f32,
  pub timestamp_ns: u64,
}

pub struct GpsHalRegistry {
  latest: Mutex<GpsCoords>,
  sequence: AtomicU64,
  samples: AtomicU64,
}

impl GpsHalRegistry {
  pub fn new() -> Self {
    Self {
      latest: Mutex::new(GpsCoords::default()),
      sequence: AtomicU64::new(0),
      samples: AtomicU64::new(0),
    }
  }

  pub fn inject(
    &self,
    latitude: f64,
    longitude: f64,
    altitude: f64,
    accuracy: f32,
    heading: f32,
    speed: f32,
    timestamp_ns: u64,
  ) -> GpsCoords {
    let coords = GpsCoords {
      latitude,
      longitude,
      altitude,
      accuracy,
      heading,
      speed,
      timestamp_ns,
    };

    {
      let mut lock = self
        .latest
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      *lock = coords;
    }

    self.sequence.fetch_add(1, Ordering::AcqRel);
    self.samples.fetch_add(1, Ordering::AcqRel);
    coords
  }

  pub fn snapshot(&self) -> GpsCoords {
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
