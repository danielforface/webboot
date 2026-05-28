pub mod binder_proxy;
pub mod dalvik_vm;
pub mod dex_parser;
pub mod hardware_hal;

use std::collections::BTreeMap;

use crate::apps::fs_explorer::FsExplorerState;
use crate::memory::{ArenaSlice, DirtyPageBitmap, LinearMemoryImage, PageArenaAllocator, PAGE_SIZE};

use self::dalvik_vm::DalvikVm;
use self::dex_parser::{parse_dex_metadata, DexMetadata, DEX_MAGIC_035};
use self::hardware_hal::{HalStats, HardwareHal};

const E2BIG: i32 = -7;
const EINVAL: i32 = -22;
const ENOENT: i32 = -2;

#[derive(Clone, Debug)]
pub struct ApkManifest {
  pub package_name: String,
  pub main_activity: String,
  pub min_sdk: u32,
}

#[derive(Clone, Debug)]
pub struct DalvikIntent {
  pub action: String,
  pub categories: Vec<String>,
  pub data_uri: String,
  pub comp_package: String,
  pub comp_class: String,
}

impl DalvikIntent {
  pub fn decode_from_bytes(bytes: &[u8]) -> Result<Self, i32> {
    let text = core::str::from_utf8(bytes).map_err(|_| EINVAL)?;
    let mut lines = text.splitn(5, '\n');

    let action = lines.next().unwrap_or_default().to_owned();
    let categories_line = lines.next().unwrap_or_default();
    let categories = if categories_line.is_empty() {
      Vec::new()
    } else {
      categories_line
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>()
    };

    let data_uri = lines.next().unwrap_or_default().to_owned();
    let comp_package = lines.next().unwrap_or_default().to_owned();
    let comp_class = lines.next().unwrap_or_default().to_owned();

    Ok(Self {
      action,
      categories,
      data_uri,
      comp_package,
      comp_class,
    })
  }
}

#[derive(Clone)]
struct InstalledApk {
  manifest: ApkManifest,
  mount_path: String,
  dex_metadata: DexMetadata,
}

struct RunningAndroidApp {
  app_id: u32,
  package_name: String,
  activity: String,
  arena: ArenaSlice,
  vm: DalvikVm,
  last_packet_bytes: u32,
}

#[derive(Clone)]
pub struct AndroidLaunchResult {
  pub app_id: u32,
  pub package_name: String,
  pub activity: String,
  pub arena_offset: u32,
  pub arena_len: u32,
  pub binder_packet_bytes: u32,
}

pub struct AndroidRuntime {
  installed: BTreeMap<String, InstalledApk>,
  running: BTreeMap<u32, RunningAndroidApp>,
  binder_sequence: u32,
  hardware_hal: HardwareHal,
}

impl AndroidRuntime {
  pub fn new() -> Self {
    Self {
      installed: BTreeMap::new(),
      running: BTreeMap::new(),
      binder_sequence: 1,
      hardware_hal: HardwareHal::new(),
    }
  }

  pub fn deploy_apk(
    &mut self,
    vfs_path: &str,
    fs_explorer: &mut FsExplorerState,
  ) -> Result<ApkManifest, i32> {
    if !vfs_path.ends_with(".apk") {
      return Err(EINVAL);
    }

    let package_name = derive_package_name(vfs_path);
    let mount_path = format!("/data/app/{package_name}");

    fs_explorer.add_path("/data", 1, 2);
    fs_explorer.add_path("/data/app", 1, 2);
    fs_explorer.add_path(&mount_path, 1, 1);
    fs_explorer.add_path(vfs_path, 2, 1);

    let dex_bytes = synthetic_dex_blob(&package_name);
    let dex_metadata = parse_dex_metadata(&dex_bytes)?;

    let manifest = ApkManifest {
      package_name: package_name.clone(),
      main_activity: "MainActivity".to_owned(),
      min_sdk: 26,
    };

    self.installed.insert(
      package_name,
      InstalledApk {
        manifest: manifest.clone(),
        mount_path,
        dex_metadata,
      },
    );

    fs_explorer.mark_synced(vfs_path);
    Ok(manifest)
  }

  pub fn start_activity(
    &mut self,
    app_id: u32,
    intent: DalvikIntent,
    allocator: &mut PageArenaAllocator,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
    fs_explorer: &mut FsExplorerState,
  ) -> Result<AndroidLaunchResult, i32> {
    let package_name = resolve_package_name(&intent, &self.installed)?;
    let Some(installed) = self.installed.get(&package_name).cloned() else {
      return Err(ENOENT);
    };

    let method_count = installed.dex_metadata.method_count.max(1);
    let arena_pages = ((method_count as usize / 96) + 6) as u32;
    let Some(arena) = allocator.allocate_pages(arena_pages) else {
      return Err(E2BIG);
    };

    let activity = if intent.comp_class.is_empty() {
      installed.manifest.main_activity.clone()
    } else {
      intent.comp_class.clone()
    };

    let mut vm = DalvikVm::new(arena, method_count);
    let packet = binder_proxy::translate_intent_to_packet(self.binder_sequence, app_id, &intent);
    self.binder_sequence = self.binder_sequence.wrapping_add(1);

    vm.inject_binder_packet(&packet, memory, dirty)?;
    vm.tick(memory, dirty)?;

    let state_path = format!("{}/runtime-{}.state", installed.mount_path, app_id);
    fs_explorer.add_path(&state_path, 2, 1);

    self.running.insert(
      app_id,
      RunningAndroidApp {
        app_id,
        package_name: package_name.clone(),
        activity: activity.clone(),
        arena,
        vm,
        last_packet_bytes: packet.len() as u32,
      },
    );

    Ok(AndroidLaunchResult {
      app_id,
      package_name,
      activity,
      arena_offset: arena.base_page.saturating_mul(PAGE_SIZE as u32),
      arena_len: arena.page_count.saturating_mul(PAGE_SIZE as u32),
      binder_packet_bytes: packet.len() as u32,
    })
  }

  pub fn vm_tick(
    &mut self,
    app_id: u32,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    let Some(process) = self.running.get_mut(&app_id) else {
      return Err(ENOENT);
    };

    process.vm.tick(memory, dirty)?;
    Ok(0)
  }

  pub fn tick_some(
    &mut self,
    budget: usize,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> usize {
    if budget == 0 {
      return 0;
    }

    let mut ticked = 0_usize;
    let app_ids = self.running.keys().copied().collect::<Vec<_>>();
    for app_id in app_ids.into_iter().take(budget) {
      if let Some(process) = self.running.get_mut(&app_id) {
        if process.vm.tick(memory, dirty).is_ok() {
          ticked += 1;
        }
      }
    }

    ticked
  }

  pub fn terminate(&mut self, app_id: u32) {
    self.running.remove(&app_id);
  }

  pub fn installed_count(&self) -> u32 {
    self.installed.len() as u32
  }

  pub fn running_count(&self) -> u32 {
    self.running.len() as u32
  }

  pub fn describe_app(&self, app_id: u32) -> Option<(String, String)> {
    self
      .running
      .get(&app_id)
      .map(|app| (app.package_name.clone(), app.activity.clone()))
  }

  pub fn hal_inject_sensor(
    &mut self,
    sensor_id: u32,
    x: f32,
    y: f32,
    z: f32,
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    self
      .hardware_hal
      .inject_sensor(sensor_id, x, y, z, timestamp_ns, memory, dirty)
  }

  pub fn hal_inject_location(
    &mut self,
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
    self.hardware_hal.inject_location(
      latitude,
      longitude,
      altitude,
      accuracy,
      heading,
      speed,
      timestamp_ns,
      memory,
      dirty,
    )
  }

  pub fn hal_inject_audio_frame(
    &mut self,
    channels: u32,
    sample_rate: u32,
    pcm: &[u8],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    self
      .hardware_hal
      .inject_audio_frame(channels, sample_rate, pcm, timestamp_ns, memory, dirty)
  }

  pub fn hal_inject_camera_frame(
    &mut self,
    width: u32,
    height: u32,
    pixel_format: u32,
    frame: &[u8],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    self.hardware_hal.inject_camera_frame(
      width,
      height,
      pixel_format,
      frame,
      timestamp_ns,
      memory,
      dirty,
    )
  }

  pub fn hal_inject_peripheral_token(
    &mut self,
    token_kind: u32,
    token: &[u8],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    self.hardware_hal.inject_peripheral_token(
      token_kind,
      token,
      timestamp_ns,
      memory,
      dirty,
    )
  }

  pub fn hal_inject_nfc(
    &mut self,
    record_type: &str,
    media_type: &str,
    payload: &[u8],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    self.hardware_hal.inject_nfc(
      record_type,
      media_type,
      payload,
      timestamp_ns,
      memory,
      dirty,
    )
  }

  pub fn hal_inject_gamepad(
    &mut self,
    index: u32,
    buttons_bitmap: u64,
    axes: &[f32],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    self.hardware_hal.inject_gamepad(
      index,
      buttons_bitmap,
      axes,
      timestamp_ns,
      memory,
      dirty,
    )
  }

  pub fn hal_inject_serial_read(
    &mut self,
    port_id: u32,
    data: &[u8],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    self.hardware_hal.inject_serial_read(
      port_id,
      data,
      timestamp_ns,
      memory,
      dirty,
    )
  }

  pub fn hal_inject_xr(
    &mut self,
    transform: &[f32],
    hand_tracking: &[f32],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    self.hardware_hal.inject_xr(
      transform,
      hand_tracking,
      timestamp_ns,
      memory,
      dirty,
    )
  }

  pub fn hal_set_haptics(
    &mut self,
    pattern_ms: &[u32],
    timestamp_ns: u64,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<i32, i32> {
    self
      .hardware_hal
      .set_haptics(pattern_ms, timestamp_ns, memory, dirty)
  }

  pub fn hal_stats(&self) -> HalStats {
    self.hardware_hal.stats()
  }
}

fn resolve_package_name(
  intent: &DalvikIntent,
  installed: &BTreeMap<String, InstalledApk>,
) -> Result<String, i32> {
  if !intent.comp_package.is_empty() {
    if installed.contains_key(&intent.comp_package) {
      return Ok(intent.comp_package.clone());
    }
    return Err(ENOENT);
  }

  if !intent.data_uri.is_empty() {
    let lower = intent.data_uri.to_ascii_lowercase();
    for key in installed.keys() {
      if lower.contains(key) {
        return Ok(key.clone());
      }
    }
  }

  installed
    .keys()
    .next()
    .cloned()
    .ok_or(ENOENT)
}

fn derive_package_name(vfs_path: &str) -> String {
  let file_name = vfs_path
    .rsplit('/')
    .next()
    .unwrap_or("app.apk")
    .trim_end_matches(".apk");

  let mut package = String::with_capacity(file_name.len());
  for ch in file_name.chars() {
    if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
      package.push(ch.to_ascii_lowercase());
    } else {
      package.push('-');
    }
  }

  if package.is_empty() {
    "app".to_owned()
  } else {
    package
  }
}

fn synthetic_dex_blob(package_name: &str) -> Vec<u8> {
  let mut dex = vec![0_u8; 160];
  dex[0..8].copy_from_slice(&DEX_MAGIC_035);

  let file_size = dex.len() as u32;
  dex[32..36].copy_from_slice(&file_size.to_le_bytes());
  dex[36..40].copy_from_slice(&(112_u32).to_le_bytes());
  dex[40..44].copy_from_slice(&(0x1234_5678_u32).to_le_bytes());

  let string_count = package_name.len().max(8) as u32;
  let type_count = (string_count / 2).max(4);
  let method_count = (string_count * 3).max(32);
  let class_count = (method_count / 4).max(8);

  dex[56..60].copy_from_slice(&string_count.to_le_bytes());
  dex[60..64].copy_from_slice(&(112_u32).to_le_bytes());
  dex[64..68].copy_from_slice(&type_count.to_le_bytes());
  dex[68..72].copy_from_slice(&(120_u32).to_le_bytes());
  dex[72..76].copy_from_slice(&(8_u32).to_le_bytes());
  dex[76..80].copy_from_slice(&(128_u32).to_le_bytes());
  dex[80..84].copy_from_slice(&(16_u32).to_le_bytes());
  dex[84..88].copy_from_slice(&(136_u32).to_le_bytes());
  dex[88..92].copy_from_slice(&method_count.to_le_bytes());
  dex[92..96].copy_from_slice(&(144_u32).to_le_bytes());
  dex[96..100].copy_from_slice(&class_count.to_le_bytes());
  dex[100..104].copy_from_slice(&(152_u32).to_le_bytes());

  dex
}
