pub mod audio_hal;
pub mod camera_hal;
pub mod gps_hal;
pub mod haptic_feedback_hal;
pub mod hid_gamepad_hal;
pub mod nfc_hal;
pub mod sensor_hal;
pub mod serial_iot_hal;
pub mod xr_spatial_hal;

use std::cmp::min;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::memory::{DirtyPageBitmap, LinearMemoryImage, PAGE_SIZE};

use self::audio_hal::AudioHalRegistry;
use self::camera_hal::CameraHalRegistry;
use self::gps_hal::GpsHalRegistry;
use self::haptic_feedback_hal::HapticFeedbackHalRegistry;
use self::hid_gamepad_hal::GamepadHalRegistry;
use self::nfc_hal::NfcHalRegistry;
use self::sensor_hal::SensorHalRegistry;
use self::serial_iot_hal::SerialIotHalRegistry;
use self::xr_spatial_hal::XrSpatialHalRegistry;

const EINVAL: i32 = -22;

const HAL_BASE_OFFSET: u32 = (PAGE_SIZE as u32) * 4;

pub const SENSOR_STATE_OFFSET: u32 = HAL_BASE_OFFSET;
pub const SENSOR_STATE_BYTES: u32 = 2 * 1024;

pub const LOCATION_STATE_OFFSET: u32 = SENSOR_STATE_OFFSET + SENSOR_STATE_BYTES;
pub const LOCATION_STATE_BYTES: u32 = 512;

pub const AUDIO_STATE_OFFSET: u32 = LOCATION_STATE_OFFSET + LOCATION_STATE_BYTES;
pub const AUDIO_STATE_BYTES: u32 = 12 * 1024;

pub const CAMERA_STATE_OFFSET: u32 = AUDIO_STATE_OFFSET + AUDIO_STATE_BYTES;
pub const CAMERA_STATE_BYTES: u32 = 32 * 1024;

pub const PERIPHERAL_STATE_OFFSET: u32 = CAMERA_STATE_OFFSET + CAMERA_STATE_BYTES;
pub const PERIPHERAL_STATE_BYTES: u32 = 1024;

pub const NFC_STATE_OFFSET: u32 = PERIPHERAL_STATE_OFFSET + PERIPHERAL_STATE_BYTES;
pub const NFC_STATE_BYTES: u32 = 4 * 1024;

pub const GAMEPAD_STATE_OFFSET: u32 = NFC_STATE_OFFSET + NFC_STATE_BYTES;
pub const GAMEPAD_STATE_BYTES: u32 = 4 * 1024;

pub const SERIAL_STATE_OFFSET: u32 = GAMEPAD_STATE_OFFSET + GAMEPAD_STATE_BYTES;
pub const SERIAL_STATE_BYTES: u32 = 8 * 1024;

pub const XR_STATE_OFFSET: u32 = SERIAL_STATE_OFFSET + SERIAL_STATE_BYTES;
pub const XR_STATE_BYTES: u32 = 4 * 1024;

pub const HAPTIC_STATE_OFFSET: u32 = XR_STATE_OFFSET + XR_STATE_BYTES;
pub const HAPTIC_STATE_BYTES: u32 = 1024;

pub const HAL_TOTAL_BYTES: u32 = HAPTIC_STATE_OFFSET + HAPTIC_STATE_BYTES - HAL_BASE_OFFSET;

const PERIPHERAL_TOKEN_BYTES: usize = 256;

#[derive(Clone, Copy)]
struct PeripheralTokenState {
  token_kind: u32,
  token_len: u32,
  timestamp_ns: u64,
  sequence: u64,
  bytes: [u8; PERIPHERAL_TOKEN_BYTES],
}

impl Default for PeripheralTokenState {
  fn default() -> Self {
    Self {
      token_kind: 0,
      token_len: 0,
      timestamp_ns: 0,
      sequence: 0,
      bytes: [0_u8; PERIPHERAL_TOKEN_BYTES],
    }
  }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct HalStats {
  pub sensor_samples: u64,
  pub location_samples: u64,
  pub audio_frames: u64,
  pub camera_frames: u64,
  pub peripheral_tokens: u64,
  pub nfc_packets: u64,
  pub gamepad_packets: u64,
  pub serial_packets: u64,
  pub xr_packets: u64,
  pub haptic_events: u64,
  pub last_sensor_interrupt_ns: u64,
}

pub struct HardwareHal {
  sensors: SensorHalRegistry,
  gps: GpsHalRegistry,
  audio: AudioHalRegistry,
  camera: CameraHalRegistry,
  nfc: NfcHalRegistry,
  gamepad: GamepadHalRegistry,
  serial: SerialIotHalRegistry,
  xr: XrSpatialHalRegistry,
  haptics: HapticFeedbackHalRegistry,
  peripheral: Mutex<PeripheralTokenState>,
  peripheral_samples: AtomicU64,
}

impl HardwareHal {
  pub fn new() -> Self {
    Self {
      sensors: SensorHalRegistry::new(),
      gps: GpsHalRegistry::new(),
      audio: AudioHalRegistry::new(),
      camera: CameraHalRegistry::new(),
      nfc: NfcHalRegistry::new(),
      gamepad: GamepadHalRegistry::new(),
      serial: SerialIotHalRegistry::new(),
      xr: XrSpatialHalRegistry::new(),
      haptics: HapticFeedbackHalRegistry::new(),
      peripheral: Mutex::new(PeripheralTokenState::default()),
      peripheral_samples: AtomicU64::new(0),
    }
  }

  pub fn inject_sensor(
    &self,
    sensor_id: u32,
    x: f32,
    y: f32,
    z: f32,
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    let sample = self.sensors.inject(sensor_id, x, y, z, timestamp_ns)?;
    let snapshot = self.sensors.snapshot();

    let mut header = [0_u8; 32];
    header[0..8].copy_from_slice(&snapshot.sequence.to_le_bytes());
    header[8..16].copy_from_slice(&snapshot.last_interrupt_ns.to_le_bytes());
    header[16..24].copy_from_slice(&self.sensors.sample_count().to_le_bytes());
    write_state(memory, dirty, SENSOR_STATE_OFFSET, &header)?;

    let mut packet = [0_u8; 32];
    packet[0..4].copy_from_slice(&sensor_id.to_le_bytes());
    packet[4..8].copy_from_slice(&sample.x.to_le_bytes());
    packet[8..12].copy_from_slice(&sample.y.to_le_bytes());
    packet[12..16].copy_from_slice(&sample.z.to_le_bytes());
    packet[16..24].copy_from_slice(&sample.timestamp_ns.to_le_bytes());
    packet[24..32].copy_from_slice(&self.sensors.sequence().to_le_bytes());

    let slot = sensor_id.min(15);
    let offset = SENSOR_STATE_OFFSET + 64 + slot.saturating_mul(packet.len() as u32);
    write_state(memory, dirty, offset, &packet)?;
    Ok(0)
  }

  pub fn inject_location(
    &self,
    latitude: f64,
    longitude: f64,
    altitude: f64,
    accuracy: f32,
    heading: f32,
    speed: f32,
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    let coords = self.gps.inject(
      latitude,
      longitude,
      altitude,
      accuracy,
      heading,
      speed,
      timestamp_ns,
    );

    let mut packet = [0_u8; 56];
    packet[0..8].copy_from_slice(&coords.latitude.to_le_bytes());
    packet[8..16].copy_from_slice(&coords.longitude.to_le_bytes());
    packet[16..24].copy_from_slice(&coords.altitude.to_le_bytes());
    packet[24..28].copy_from_slice(&coords.accuracy.to_le_bytes());
    packet[28..32].copy_from_slice(&coords.heading.to_le_bytes());
    packet[32..36].copy_from_slice(&coords.speed.to_le_bytes());
    packet[36..44].copy_from_slice(&coords.timestamp_ns.to_le_bytes());
    packet[44..52].copy_from_slice(&self.gps.sequence().to_le_bytes());
    write_state(memory, dirty, LOCATION_STATE_OFFSET, &packet)?;
    Ok(0)
  }

  pub fn inject_audio_frame(
    &self,
    channels: u32,
    sample_rate: u32,
    pcm: &[u8],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    let header = self.audio.inject(channels, sample_rate, pcm, timestamp_ns)?;

    let mut packet = [0_u8; 40];
    packet[0..4].copy_from_slice(&header.channels.to_le_bytes());
    packet[4..8].copy_from_slice(&header.sample_rate.to_le_bytes());
    packet[8..12].copy_from_slice(&header.buffer_len.to_le_bytes());
    packet[12..20].copy_from_slice(&header.timestamp_ns.to_le_bytes());
    packet[20..28].copy_from_slice(&self.audio.sequence().to_le_bytes());
    packet[28..36].copy_from_slice(&self.audio.sample_count().to_le_bytes());
    write_state(memory, dirty, AUDIO_STATE_OFFSET, &packet)?;

    let mut shadow = [0_u8; audio_hal::MAX_AUDIO_PACKET_BYTES];
    let (_, copied) = self.audio.latest_packet(&mut shadow);
    if copied > 0 {
      write_state(memory, dirty, AUDIO_STATE_OFFSET + 64, &shadow[0..copied])?;
    }

    Ok(0)
  }

  pub fn inject_camera_frame(
    &self,
    width: u32,
    height: u32,
    pixel_format: u32,
    frame: &[u8],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    let meta = self
      .camera
      .inject(width, height, pixel_format, frame, timestamp_ns)?;

    let mut packet = [0_u8; 40];
    packet[0..4].copy_from_slice(&meta.width.to_le_bytes());
    packet[4..8].copy_from_slice(&meta.height.to_le_bytes());
    packet[8..12].copy_from_slice(&meta.pixel_format.to_le_bytes());
    packet[12..16].copy_from_slice(&meta.frame_len.to_le_bytes());
    packet[16..24].copy_from_slice(&meta.timestamp_ns.to_le_bytes());
    packet[24..32].copy_from_slice(&self.camera.sequence().to_le_bytes());
    packet[32..40].copy_from_slice(&self.camera.sample_count().to_le_bytes());
    write_state(memory, dirty, CAMERA_STATE_OFFSET, &packet)?;

    let mut shadow = [0_u8; camera_hal::MAX_CAMERA_FRAME_BYTES];
    let (_, copied) = self.camera.latest_frame(&mut shadow);
    if copied > 0 {
      write_state(memory, dirty, CAMERA_STATE_OFFSET + 64, &shadow[0..copied])?;
    }

    Ok(0)
  }

  pub fn inject_peripheral_token(
    &self,
    token_kind: u32,
    token_bytes: &[u8],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    let copy_len = min(token_bytes.len(), PERIPHERAL_TOKEN_BYTES);
    let sequence = self.peripheral_samples.fetch_add(1, Ordering::AcqRel) + 1;

    {
      let mut lock = self
        .peripheral
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
      lock.token_kind = token_kind;
      lock.token_len = copy_len as u32;
      lock.timestamp_ns = timestamp_ns;
      lock.sequence = sequence;
      lock.bytes.fill(0);
      if copy_len > 0 {
        lock.bytes[0..copy_len].copy_from_slice(&token_bytes[0..copy_len]);
      }
    }

    let snapshot = *self
      .peripheral
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner());

    let mut packet = [0_u8; 32 + PERIPHERAL_TOKEN_BYTES];
    packet[0..4].copy_from_slice(&snapshot.token_kind.to_le_bytes());
    packet[4..8].copy_from_slice(&snapshot.token_len.to_le_bytes());
    packet[8..16].copy_from_slice(&snapshot.timestamp_ns.to_le_bytes());
    packet[16..24].copy_from_slice(&snapshot.sequence.to_le_bytes());
    packet[32..32 + copy_len].copy_from_slice(&snapshot.bytes[0..copy_len]);
    write_state(memory, dirty, PERIPHERAL_STATE_OFFSET, &packet)?;

    Ok(0)
  }

  pub fn inject_nfc(
    &self,
    record_type: &str,
    media_type: &str,
    payload: &[u8],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    let record = self.nfc.inject(record_type, media_type, payload, timestamp_ns);

    let mut bytes = Vec::with_capacity(256 + record.payload.len());
    bytes.extend_from_slice(&self.nfc.sequence().to_le_bytes());
    bytes.extend_from_slice(&record.timestamp_ns.to_le_bytes());

    let record_type_len = min(record.record_type.len(), u16::MAX as usize) as u16;
    let media_type_len = min(record.media_type.len(), u16::MAX as usize) as u16;
    let payload_len = min(record.payload.len(), u32::MAX as usize) as u32;

    bytes.extend_from_slice(&record_type_len.to_le_bytes());
    bytes.extend_from_slice(&record.record_type.as_bytes()[0..record_type_len as usize]);
    bytes.extend_from_slice(&media_type_len.to_le_bytes());
    bytes.extend_from_slice(&record.media_type.as_bytes()[0..media_type_len as usize]);
    bytes.extend_from_slice(&payload_len.to_le_bytes());
    bytes.extend_from_slice(&record.payload[0..payload_len as usize]);

    if bytes.len() as u32 > NFC_STATE_BYTES {
      return Err(EINVAL);
    }

    write_state(memory, dirty, NFC_STATE_OFFSET, &bytes)?;
    Ok(0)
  }

  pub fn inject_gamepad(
    &self,
    index: u32,
    buttons_bitmap: u64,
    axes: &[f32],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    let packet = self
      .gamepad
      .inject(index, buttons_bitmap, axes, timestamp_ns);

    let mut bytes = [0_u8; 128];
    bytes[0..4].copy_from_slice(&packet.index.to_le_bytes());
    bytes[4..12].copy_from_slice(&packet.buttons_bitmap.to_le_bytes());
    bytes[12..16].copy_from_slice(&packet.axes_len.to_le_bytes());
    bytes[16..24].copy_from_slice(&packet.timestamp_ns.to_le_bytes());
    bytes[24..32].copy_from_slice(&packet.sequence.to_le_bytes());

    let axis_count = min(packet.axes_len as usize, hid_gamepad_hal::MAX_GAMEPAD_AXES);
    for axis in 0..axis_count {
      let start = 32 + axis * 4;
      bytes[start..start + 4].copy_from_slice(&packet.axes[axis].to_le_bytes());
    }

    let slot = (index as usize % hid_gamepad_hal::MAX_GAMEPAD_SLOTS) as u32;
    let offset = GAMEPAD_STATE_OFFSET + slot.saturating_mul(128);
    write_state(memory, dirty, offset, &bytes)?;
    Ok(0)
  }

  pub fn inject_serial_read(
    &self,
    port_id: u32,
    data: &[u8],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    let packet = self.serial.inject(port_id, data, timestamp_ns);

    let mut bytes = [0_u8; 640];
    bytes[0..4].copy_from_slice(&packet.port_id.to_le_bytes());
    bytes[4..8].copy_from_slice(&packet.len.to_le_bytes());
    bytes[8..16].copy_from_slice(&packet.timestamp_ns.to_le_bytes());
    bytes[16..24].copy_from_slice(&packet.sequence.to_le_bytes());

    let copy_len = min(packet.len as usize, serial_iot_hal::MAX_SERIAL_BYTES);
    if copy_len > 0 {
      bytes[32..32 + copy_len].copy_from_slice(&packet.bytes[0..copy_len]);
    }

    let slot = (port_id as usize % serial_iot_hal::MAX_SERIAL_PORTS) as u32;
    let offset = SERIAL_STATE_OFFSET + slot.saturating_mul(640);
    write_state(memory, dirty, offset, &bytes)?;
    Ok(0)
  }

  pub fn inject_xr(
    &self,
    transform: &[f32],
    hand_tracking: &[f32],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    let pose = self.xr.inject(transform, hand_tracking, timestamp_ns);

    let mut bytes = [0_u8; 224];
    bytes[0..8].copy_from_slice(&pose.sequence.to_le_bytes());
    bytes[8..16].copy_from_slice(&pose.timestamp_ns.to_le_bytes());

    for i in 0..xr_spatial_hal::XR_TRANSFORM_VALUES {
      let start = 16 + i * 4;
      bytes[start..start + 4].copy_from_slice(&pose.transform[i].to_le_bytes());
    }

    bytes[80..84].copy_from_slice(&pose.hand_tracking_len.to_le_bytes());
    let hand_len = min(pose.hand_tracking_len as usize, xr_spatial_hal::MAX_XR_HAND_VECTOR);
    for i in 0..hand_len {
      let start = 84 + i * 4;
      bytes[start..start + 4].copy_from_slice(&pose.hand_tracking[i].to_le_bytes());
    }

    write_state(memory, dirty, XR_STATE_OFFSET, &bytes)?;
    Ok(0)
  }

  pub fn set_haptics(
    &self,
    pattern_ms: &[u32],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    let state = self.haptics.set_pattern(pattern_ms, timestamp_ns);

    let mut bytes = [0_u8; 96];
    bytes[0..8].copy_from_slice(&state.sequence.to_le_bytes());
    bytes[8..16].copy_from_slice(&state.timestamp_ns.to_le_bytes());
    bytes[16..20].copy_from_slice(&state.pattern_len.to_le_bytes());

    let pattern_len = min(
      state.pattern_len as usize,
      haptic_feedback_hal::MAX_HAPTIC_PATTERN_VALUES,
    );
    for i in 0..pattern_len {
      let start = 20 + i * 4;
      bytes[start..start + 4].copy_from_slice(&state.pattern_ms[i].to_le_bytes());
    }

    write_state(memory, dirty, HAPTIC_STATE_OFFSET, &bytes)?;
    Ok(0)
  }

  pub fn stats(&self) -> HalStats {
    let sensor_snapshot = self.sensors.snapshot();
    HalStats {
      sensor_samples: self.sensors.sample_count(),
      location_samples: self.gps.sample_count(),
      audio_frames: self.audio.sample_count(),
      camera_frames: self.camera.sample_count(),
      peripheral_tokens: self.peripheral_samples.load(Ordering::Acquire),
      nfc_packets: self.nfc.sample_count(),
      gamepad_packets: self.gamepad.sample_count(),
      serial_packets: self.serial.sample_count(),
      xr_packets: self.xr.sample_count(),
      haptic_events: self.haptics.sample_count(),
      last_sensor_interrupt_ns: sensor_snapshot.last_interrupt_ns,
    }
  }
}

fn write_state(
  memory: &mut LinearMemoryImage,
  dirty: &DirtyPageBitmap,
  offset: u32,
  bytes: &[u8],
) -> Result<(), i32> {
  memory.write_at(offset, bytes, dirty)
}
