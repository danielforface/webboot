mod apps;
mod android_runtime;
mod memory;
mod vfs;
mod window_manager;

use android_runtime::{AndroidRuntime, DalvikIntent};
use apps::editor::EditorState;
use apps::fs_explorer::FsExplorerState;
use apps::media_pipeline::MediaPipelineState;
use apps::terminal::TerminalState;
use memory::{
  read_bytes_from_ptr,
  read_utf8_from_ptr,
  ArenaSlice,
  DirtyPageBitmap,
  LinearMemoryImage,
  PageArenaAllocator,
  PAGE_SIZE,
};
use std::cmp::min;
use std::collections::BTreeMap;
use std::slice;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use vfs::DeltaTrackedVfs;
use window_manager::{UiEvent, WindowManager, WindowNode};

const E2BIG: i32 = -7;
const EBUSY: i32 = -16;
const EFAULT: i32 = -14;
const EINVAL: i32 = -22;
const ENOENT: i32 = -2;

const COMPACTION_MAGIC: u32 = 0x3144_5043;
const DEFAULT_APP_ARENA_BYTES: u32 = (PAGE_SIZE as u32) * 8;
const MAX_COMPACTION_PAGES: usize = 512;
const METRICS_SLOTS: usize = 16;
const HAL_MAX_F32_VALUES: usize = 64;
const HAL_MAX_U32_VALUES: usize = 32;

const APP_KIND_TERMINAL: u32 = 1;
const APP_KIND_EDITOR: u32 = 2;
const APP_KIND_SETTINGS: u32 = 3;
const APP_KIND_LAUNCHER: u32 = 4;
const APP_KIND_FILE_EXPLORER: u32 = 5;
const APP_KIND_PHOTO_VIEWER: u32 = 6;
const APP_KIND_SCREEN_CAPTURE: u32 = 7;
const APP_KIND_VOICE_RECORDER: u32 = 8;
const APP_KIND_AUDIO_PLAYER: u32 = 9;
const APP_KIND_ANDROID_RUNTIME: u32 = 10;

const APP_STATUS_RUNNING: u32 = 1;
const APP_STATUS_SUSPENDED: u32 = 2;
const APP_STATUS_TERMINATED: u32 = 3;

const INPUT_EVENT_TERMINAL_KEY: u32 = 16;
const INPUT_EVENT_EDITOR_KEY: u32 = 17;
const INPUT_EVENT_LOAD_APP: u32 = 18;

const RESERVED_KERNEL_PAGES: u32 = 10;
const DEFAULT_MEDIA_CAPTURE_BYTES: usize = PAGE_SIZE * 2;

static KERNEL_ACTIVE: AtomicBool = AtomicBool::new(false);
static SCHEDULER_TICK: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
mod tests;

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct AppDescriptor {
  pub app_id: u32,
  pub window_id: u32,
  pub kind: u32,
  pub status: u32,
  pub arena_offset: u32,
  pub arena_len: u32,
}

#[derive(Clone)]
struct AppInstance {
  descriptor: AppDescriptor,
  path: String,
}

#[derive(Clone)]
struct OpenFileState {
  path: String,
  data: Vec<u8>,
}

#[derive(Clone, Copy)]
struct WindowBufferBinding {
  window_id: u32,
  buffer_ptr: u32,
  buffer_len: u32,
}

pub struct NomadOSKernel {
  total_memory: u32,
  session_flags: u32,
  suspended: bool,
  memory: LinearMemoryImage,
  dirty_bitmap: DirtyPageBitmap,
  vfs: DeltaTrackedVfs,
  window_manager: WindowManager,
  session_fd: u32,
  active_apps: Vec<AppInstance>,
  next_app_id: u32,
  next_window_id: u32,
  arena_allocator: PageArenaAllocator,
  compaction_sequence: u32,
  last_compacted_pages: u32,
  dirty_scratch_pages: Vec<u32>,
  page_scratch: Vec<u8>,
  compression_scratch: Vec<u8>,
  fs_handles: BTreeMap<u32, OpenFileState>,
  window_bindings: Vec<WindowBufferBinding>,
  terminal: TerminalState,
  editor: EditorState,
  media_pipeline: MediaPipelineState,
  fs_explorer: FsExplorerState,
  media_capture_scratch: Vec<u8>,
  android_runtime: AndroidRuntime,
}

static KERNEL_INSTANCE: Mutex<Option<NomadOSKernel>> = Mutex::new(None);

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "host-sync")]
unsafe extern "C" {
  fn host_sync(delta_ptr: u32, length: u32) -> i32;
  fn host_log(msg_ptr: u32, msg_len: u32);
}

#[cfg(not(target_arch = "wasm32"))]
unsafe fn host_sync(_delta_ptr: u32, _length: u32) -> i32 {
  0
}

#[cfg(not(target_arch = "wasm32"))]
unsafe fn host_log(_msg_ptr: u32, _msg_len: u32) {}

fn main() {}

#[cfg(test)]
fn reset_kernel_for_tests() {
  let mut guard = KERNEL_INSTANCE
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner());
  *guard = None;
  KERNEL_ACTIVE.store(false, Ordering::SeqCst);
  SCHEDULER_TICK.store(0, Ordering::SeqCst);
}

fn with_kernel_mut<F>(mutator: F) -> i32
where
  F: FnOnce(&mut NomadOSKernel) -> i32,
{
  let mut guard = KERNEL_INSTANCE
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner());
  let Some(kernel) = guard.as_mut() else {
    return ENOENT;
  };

  mutator(kernel)
}

fn log_host(message: &str) {
  unsafe {
    host_log(message.as_ptr() as usize as u32, message.len() as u32);
  }
}

fn push_u32(buffer: &mut Vec<u8>, value: u32) {
  buffer.extend_from_slice(&value.to_le_bytes());
}

fn push_u64(buffer: &mut Vec<u8>, value: u64) {
  buffer.extend_from_slice(&value.to_le_bytes());
}

fn decode_f32_list_from_bytes(bytes: &[u8], max_values: usize) -> Vec<f32> {
  let count = min(bytes.len() / 4, max_values);
  let mut values = Vec::with_capacity(count);

  for idx in 0..count {
    let start = idx * 4;
    let mut raw = [0_u8; 4];
    raw.copy_from_slice(&bytes[start..start + 4]);
    values.push(f32::from_le_bytes(raw));
  }

  values
}

fn decode_u32_list_from_bytes(bytes: &[u8], max_values: usize) -> Vec<u32> {
  let count = min(bytes.len() / 4, max_values);
  let mut values = Vec::with_capacity(count);

  for idx in 0..count {
    let start = idx * 4;
    let mut raw = [0_u8; 4];
    raw.copy_from_slice(&bytes[start..start + 4]);
    values.push(u32::from_le_bytes(raw));
  }

  values
}

fn build_suspend_manifest(kernel: &mut NomadOSKernel) -> Vec<u8> {
  let deltas = kernel.vfs.collect_deltas(192);
  let mut manifest = Vec::with_capacity(128 + deltas.len() * 16);

  manifest.extend_from_slice(b"NMSP");
  push_u32(&mut manifest, 2);
  push_u32(&mut manifest, kernel.total_memory);
  push_u32(&mut manifest, kernel.session_flags);
  push_u64(&mut manifest, SCHEDULER_TICK.load(Ordering::Relaxed));
  push_u32(&mut manifest, kernel.window_manager.pending_input());
  push_u32(&mut manifest, kernel.compaction_sequence);
  push_u32(&mut manifest, kernel.active_apps.len() as u32);
  push_u32(&mut manifest, deltas.len() as u32);

  for app in &kernel.active_apps {
    push_u32(&mut manifest, app.descriptor.app_id);
    push_u32(&mut manifest, app.descriptor.window_id);
    push_u32(&mut manifest, app.descriptor.kind);
    push_u32(&mut manifest, app.descriptor.status);
  }

  for delta in deltas {
    push_u32(&mut manifest, delta.fd);
    push_u64(&mut manifest, delta.block_index);
    push_u32(&mut manifest, delta.checksum);
  }

  manifest
}

fn allocate_app_arena(kernel: &mut NomadOSKernel, requested: u32) -> Result<(u32, u32), i32> {
  let requested_pages = ((requested as usize + PAGE_SIZE - 1) / PAGE_SIZE) as u32;
  let Some(slice) = kernel.arena_allocator.allocate_pages(requested_pages) else {
    return Err(E2BIG);
  };

  let offset = slice.base_page.saturating_mul(PAGE_SIZE as u32);
  let len = slice.page_count.saturating_mul(PAGE_SIZE as u32);
  Ok((offset, len))
}

fn app_name_from_kind(kind: u32) -> &'static str {
  match kind {
    APP_KIND_TERMINAL => "terminal",
    APP_KIND_EDITOR => "editor",
    APP_KIND_SETTINGS => "settings",
    APP_KIND_LAUNCHER => "launcher",
    APP_KIND_FILE_EXPLORER => "files",
    APP_KIND_PHOTO_VIEWER => "photo-viewer",
    APP_KIND_SCREEN_CAPTURE => "screen-cap",
    APP_KIND_VOICE_RECORDER => "voice-rec",
    APP_KIND_AUDIO_PLAYER => "audio-player",
    APP_KIND_ANDROID_RUNTIME => "android-runtime",
    _ => "app",
  }
}

fn app_kind_from_uri(uri: &str) -> u32 {
  let lower = uri.to_ascii_lowercase();

  if lower.contains("terminal") {
    return APP_KIND_TERMINAL;
  }

  if lower.contains("editor") {
    return APP_KIND_EDITOR;
  }

  if lower.contains("setting") {
    return APP_KIND_SETTINGS;
  }

  if lower.contains("launcher") {
    return APP_KIND_LAUNCHER;
  }

  if lower.contains("file") || lower.contains("explorer") {
    return APP_KIND_FILE_EXPLORER;
  }

  if lower.contains("photo") || lower.contains("image") {
    return APP_KIND_PHOTO_VIEWER;
  }

  if lower.contains("capture") || lower.contains("screen") {
    return APP_KIND_SCREEN_CAPTURE;
  }

  if lower.contains("voice") || lower.contains("record") {
    return APP_KIND_VOICE_RECORDER;
  }

  if lower.contains("audio") || lower.contains("media") {
    return APP_KIND_AUDIO_PLAYER;
  }

  if lower.ends_with(".apk") || lower.contains("android") {
    return APP_KIND_ANDROID_RUNTIME;
  }

  APP_KIND_LAUNCHER
}

fn load_component_internal(kernel: &mut NomadOSKernel, kind: u32, path: &str) -> Result<u32, i32> {
  let arena_bytes = match kind {
    APP_KIND_TERMINAL | APP_KIND_EDITOR => DEFAULT_APP_ARENA_BYTES,
    APP_KIND_PHOTO_VIEWER | APP_KIND_AUDIO_PLAYER | APP_KIND_VOICE_RECORDER => {
      DEFAULT_APP_ARENA_BYTES * 2
    }
    _ => DEFAULT_APP_ARENA_BYTES / 2,
  };

  let (arena_offset, arena_len) = allocate_app_arena(kernel, arena_bytes)?;

  let app_id = kernel.next_app_id;
  kernel.next_app_id = kernel.next_app_id.wrapping_add(1);

  let window_id = kernel.next_window_id;
  kernel.next_window_id = kernel.next_window_id.wrapping_add(1);

  kernel.window_manager.spawn_window(window_id, kind);

  let descriptor = AppDescriptor {
    app_id,
    window_id,
    kind,
    status: APP_STATUS_RUNNING,
    arena_offset,
    arena_len,
  };

  kernel.active_apps.push(AppInstance {
    descriptor,
    path: path.to_owned(),
  });

  if kind == APP_KIND_TERMINAL {
    kernel
      .terminal
      .inject_system_line(&format!("loaded {} from {path}", app_name_from_kind(kind)));
  }

  if kind == APP_KIND_EDITOR {
    kernel.editor.set_flags(1);
  }

  if kind == APP_KIND_FILE_EXPLORER {
    kernel.fs_explorer.add_path("/home/documents", 1, 2);
    kernel.fs_explorer.add_path("/home/media", 1, 2);
  }

  if kind == APP_KIND_AUDIO_PLAYER {
    let _ = kernel.media_pipeline.stream_open(2, 48_000, 2);
  }

  kernel.fs_explorer.add_path(path, 2, 2);

  Ok(app_id)
}

fn terminate_app_by_id(kernel: &mut NomadOSKernel, app_id: u32, exit_code: i32) -> i32 {
  let _ = exit_code;

  let Some(index) = kernel
    .active_apps
    .iter()
    .position(|app| app.descriptor.app_id == app_id)
  else {
    return ENOENT;
  };

  let mut app = kernel.active_apps.remove(index);
  app.descriptor.status = APP_STATUS_TERMINATED;

  let arena = ArenaSlice {
    base_page: app.descriptor.arena_offset / PAGE_SIZE as u32,
    page_count: app.descriptor.arena_len / PAGE_SIZE as u32,
  };
  kernel.arena_allocator.release(arena);
  kernel.window_manager.close_window(app.descriptor.window_id);
  kernel
    .window_bindings
    .retain(|binding| binding.window_id != app.descriptor.window_id);
  kernel
    .terminal
    .inject_system_line(&format!("terminated app {}", app.path));
  kernel.android_runtime.terminate(app_id);

  0
}

#[no_mangle]
pub extern "C" fn os_boot(ram_bytes: u32, flags: u32) -> i32 {
  if ram_bytes < PAGE_SIZE as u32 {
    return EINVAL;
  }

  if KERNEL_ACTIVE.swap(true, Ordering::SeqCst) {
    return EBUSY;
  }

  let page_count = ((ram_bytes as usize + PAGE_SIZE - 1) / PAGE_SIZE) as u32;
  let dirty_bitmap = DirtyPageBitmap::new(page_count);
  let mut memory = LinearMemoryImage::new(ram_bytes);

  let mut vfs = DeltaTrackedVfs::new();
  if vfs.mount("/home").is_err()
    || vfs.mount("/apps").is_err()
    || vfs.mount("/data").is_err()
    || vfs.mount("/data/app").is_err()
  {
    KERNEL_ACTIVE.store(false, Ordering::SeqCst);
    return EFAULT;
  }

  let session_fd = match vfs.open("/home/session.delta", PAGE_SIZE as u32) {
    Ok(fd) => fd,
    Err(code) => {
      KERNEL_ACTIVE.store(false, Ordering::SeqCst);
      return code;
    }
  };

  let boot_record = SCHEDULER_TICK.load(Ordering::Relaxed).to_le_bytes();
  let _ = memory.write_at(0, &boot_record, &dirty_bitmap);
  let _ = vfs.track_write(session_fd, 0, boot_record.len() as u32);

  let mut kernel = NomadOSKernel {
    total_memory: ram_bytes,
    session_flags: flags,
    suspended: false,
    memory,
    dirty_bitmap,
    vfs,
    window_manager: WindowManager::new(),
    session_fd,
    active_apps: Vec::with_capacity(16),
    next_app_id: 1,
    next_window_id: 100,
    arena_allocator: PageArenaAllocator::new(page_count, RESERVED_KERNEL_PAGES),
    compaction_sequence: 0,
    last_compacted_pages: 0,
    dirty_scratch_pages: vec![0_u32; MAX_COMPACTION_PAGES],
    page_scratch: vec![0_u8; PAGE_SIZE],
    compression_scratch: vec![0_u8; PAGE_SIZE * 2],
    fs_handles: BTreeMap::new(),
    window_bindings: Vec::with_capacity(32),
    terminal: TerminalState::new(),
    editor: EditorState::new(),
    media_pipeline: MediaPipelineState::new(),
    fs_explorer: FsExplorerState::new(),
    media_capture_scratch: vec![0_u8; DEFAULT_MEDIA_CAPTURE_BYTES],
    android_runtime: AndroidRuntime::new(),
  };

  kernel.fs_explorer.add_path("/home/session.delta", 2, 1);
  kernel.fs_explorer.add_path("/data", 1, 2);
  kernel.fs_explorer.add_path("/data/app", 1, 2);

  let _ = load_component_internal(&mut kernel, APP_KIND_TERMINAL, "/apps/terminal.wasm");
  let _ = load_component_internal(&mut kernel, APP_KIND_EDITOR, "/apps/editor.wasm");

  let mut guard = KERNEL_INSTANCE
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner());
  if guard.is_some() {
    KERNEL_ACTIVE.store(false, Ordering::SeqCst);
    return EBUSY;
  }

  *guard = Some(kernel);
  log_host("[EVERYWHERE-OS] boot complete");
  0
}

#[no_mangle]
pub extern "C" fn os_poll(deadline_ns: u64) -> i32 {
  let _ = deadline_ns;

  with_kernel_mut(|kernel| {
    if kernel.suspended {
      return 0;
    }

    let processed = kernel.window_manager.process_events(512);
    let close_requests = kernel.window_manager.take_close_requests();
    for window_id in close_requests {
      if let Some(app) = kernel
        .active_apps
        .iter()
        .find(|app| app.descriptor.window_id == window_id)
      {
        let _ = terminate_app_by_id(kernel, app.descriptor.app_id, 0);
      } else {
        let _ = kernel.window_manager.close_window(window_id);
      }
    }

    let android_ticks = kernel
      .android_runtime
      .tick_some(2, &mut kernel.memory, &kernel.dirty_bitmap);
    let hal_stats = kernel.android_runtime.hal_stats();
    let hal_total = hal_stats
      .sensor_samples
      .saturating_add(hal_stats.location_samples)
      .saturating_add(hal_stats.audio_frames)
      .saturating_add(hal_stats.camera_frames)
      .saturating_add(hal_stats.peripheral_tokens)
      .saturating_add(hal_stats.nfc_packets)
      .saturating_add(hal_stats.gamepad_packets)
      .saturating_add(hal_stats.serial_packets)
      .saturating_add(hal_stats.xr_packets)
      .saturating_add(hal_stats.haptic_events);
    let tick = SCHEDULER_TICK.fetch_add(1, Ordering::Relaxed) + 1;

    if processed > 0 || tick % 120 == 0 {
      let mut frame = [0_u8; 24];
      frame[0..8].copy_from_slice(&tick.to_le_bytes());
      frame[8..12].copy_from_slice(&processed.to_le_bytes());
      frame[12..16].copy_from_slice(&kernel.window_manager.pending_input().to_le_bytes());
      frame[16..20].copy_from_slice(&(kernel.active_apps.len() as u32).to_le_bytes());
      frame[20..24].copy_from_slice(&kernel.dirty_bitmap.count_dirty_pages().to_le_bytes());

      let frame_offset = PAGE_SIZE as u32;
      if kernel
        .memory
        .write_at(frame_offset, &frame, &kernel.dirty_bitmap)
        .is_ok()
      {
        let _ = kernel
          .vfs
          .track_write(kernel.session_fd, frame_offset as u64, frame.len() as u32);
      }
    }

    if tick % 300 == 0 {
      kernel.terminal.inject_system_line(&format!(
        "tick={} active_apps={} android_ticks={} hal_total={} last_sensor_ns={}",
        tick,
        kernel.active_apps.len(),
        android_ticks,
        hal_total,
        hal_stats.last_sensor_interrupt_ns,
      ));
    }

    0
  })
}

#[no_mangle]
pub extern "C" fn os_suspend() -> i32 {
  with_kernel_mut(|kernel| {
    kernel.suspended = true;
    for app in &mut kernel.active_apps {
      app.descriptor.status = APP_STATUS_SUSPENDED;
    }

    let manifest = build_suspend_manifest(kernel);

    let rc = unsafe { host_sync(manifest.as_ptr() as usize as u32, manifest.len() as u32) };
    if rc < 0 {
      rc
    } else {
      kernel.fs_explorer.mark_synced("/home/session.delta");
      0
    }
  })
}

#[no_mangle]
pub extern "C" fn os_resume(ptr: *const u8, len: usize) -> i32 {
  if ptr.is_null() && len > 0 {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let session_id = unsafe { read_utf8_from_ptr(ptr, len) };
    let session_id = match session_id {
      Ok(value) => value,
      Err(code) => return code,
    };

    kernel.suspended = false;
    for app in &mut kernel.active_apps {
      app.descriptor.status = APP_STATUS_RUNNING;
    }

    let base_offset = (PAGE_SIZE * 2) as u32;
    let _ = kernel
      .memory
      .write_at(base_offset, session_id.as_bytes(), &kernel.dirty_bitmap);
    let tick = SCHEDULER_TICK.load(Ordering::Relaxed).to_le_bytes();
    let _ = kernel
      .memory
      .write_at(base_offset + session_id.len() as u32, &tick, &kernel.dirty_bitmap);
    let _ = kernel
      .vfs
      .track_write(kernel.session_fd, base_offset as u64, session_id.len() as u32 + 8);
    kernel.fs_explorer.mark_dirty("/home/session.delta");

    kernel
      .terminal
      .inject_system_line(&format!("resumed session {session_id}"));

    0
  })
}

#[no_mangle]
pub extern "C" fn os_process_input(
  event_type: u32,
  param_a: f32,
  param_b: f32,
  modifier_flags: u32,
) -> i32 {
  with_kernel_mut(|kernel| {
    if kernel.suspended {
      return EBUSY;
    }

    match event_type {
      INPUT_EVENT_TERMINAL_KEY => {
        kernel
          .terminal
          .handle_key(param_a.max(0.0).round() as u32, modifier_flags);
        return 0;
      }
      INPUT_EVENT_EDITOR_KEY => {
        kernel
          .editor
          .handle_key(param_a.max(0.0).round() as u32, modifier_flags);
        return 0;
      }
      INPUT_EVENT_LOAD_APP => {
        let kind = param_a.max(0.0).round() as u32;
        let path = format!("/apps/{}.wasm", app_name_from_kind(kind));
        return match load_component_internal(kernel, kind, &path) {
          Ok(_) => 0,
          Err(code) => code,
        };
      }
      _ => {}
    }

    let event = UiEvent {
      event_type,
      param_a,
      param_b,
      modifier_flags,
      timestamp_ns: SCHEDULER_TICK.load(Ordering::Relaxed),
    };

    match kernel.window_manager.enqueue_event(event) {
      Ok(()) => 0,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn os_get_render_tree(dst_ptr: *mut WindowNode, capacity: u32) -> i32 {
  if dst_ptr.is_null() {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let out = unsafe { slice::from_raw_parts_mut(dst_ptr, capacity as usize) };
    kernel.window_manager.snapshot(out) as i32
  })
}

#[no_mangle]
pub extern "C" fn os_collect_dirty_pages(out_ptr: *mut u32, max_pages: u32) -> i32 {
  if out_ptr.is_null() {
    return EFAULT;
  }

  if max_pages == 0 {
    return 0;
  }

  with_kernel_mut(|kernel| {
    let out = unsafe { slice::from_raw_parts_mut(out_ptr, max_pages as usize) };
    kernel.dirty_bitmap.collect_dirty_pages(out) as i32
  })
}

#[no_mangle]
pub extern "C" fn os_compact_dirty(out_ptr: *mut u8, out_len: u32, max_pages: u32) -> i32 {
  if out_ptr.is_null() || out_len == 0 || max_pages == 0 {
    return EINVAL;
  }

  with_kernel_mut(|kernel| {
    let max_pages_usize = min(max_pages as usize, kernel.dirty_scratch_pages.len());
    if max_pages_usize == 0 {
      return 0;
    }

    let drained = {
      let scratch = &mut kernel.dirty_scratch_pages[..max_pages_usize];
      kernel.dirty_bitmap.collect_dirty_pages(scratch)
    };
    if drained == 0 {
      return 0;
    }

    let out = unsafe { slice::from_raw_parts_mut(out_ptr, out_len as usize) };
    if out.len() < 16 {
      for page in &kernel.dirty_scratch_pages[..drained] {
        kernel.dirty_bitmap.mark_page(*page);
      }
      return E2BIG;
    }

    let mut cursor = 16_usize;
    let mut encoded_pages = 0_usize;

    for i in 0..drained {
      let page = kernel.dirty_scratch_pages[i];

      if cursor + 12 >= out.len() {
        for page in &kernel.dirty_scratch_pages[i..drained] {
          kernel.dirty_bitmap.mark_page(*page);
        }
        break;
      }

      if kernel
        .memory
        .read_page(page, &mut kernel.page_scratch)
        .is_err()
      {
        kernel.dirty_bitmap.mark_page(page);
        continue;
      }

      let encoded_len = match memory::rle_zero_encode(
        &kernel.page_scratch,
        &mut kernel.compression_scratch,
      ) {
        Ok(len) => len,
        Err(_) => {
          kernel.dirty_bitmap.mark_page(page);
          continue;
        }
      };

      if cursor + 12 + encoded_len > out.len() {
        for page in &kernel.dirty_scratch_pages[i..drained] {
          kernel.dirty_bitmap.mark_page(*page);
        }
        break;
      }

      out[cursor..cursor + 4].copy_from_slice(&page.to_le_bytes());
      out[cursor + 4..cursor + 8].copy_from_slice(&(PAGE_SIZE as u32).to_le_bytes());
      out[cursor + 8..cursor + 12].copy_from_slice(&(encoded_len as u32).to_le_bytes());
      out[cursor + 12..cursor + 12 + encoded_len]
        .copy_from_slice(&kernel.compression_scratch[..encoded_len]);
      cursor += 12 + encoded_len;
      encoded_pages += 1;
    }

    if encoded_pages == 0 {
      return 0;
    }

    kernel.compaction_sequence = kernel.compaction_sequence.wrapping_add(1);
    kernel.last_compacted_pages = encoded_pages as u32;

    out[0..4].copy_from_slice(&COMPACTION_MAGIC.to_le_bytes());
    out[4..8].copy_from_slice(&kernel.compaction_sequence.to_le_bytes());
    out[8..12].copy_from_slice(&(encoded_pages as u32).to_le_bytes());
    out[12..16].copy_from_slice(&(PAGE_SIZE as u32).to_le_bytes());

    cursor as i32
  })
}

#[no_mangle]
pub extern "C" fn os_load_component(kind: u32, path_ptr: *const u8, path_len: u32) -> i32 {
  with_kernel_mut(|kernel| {
    let path = if path_ptr.is_null() || path_len == 0 {
      format!("/apps/{}.wasm", app_name_from_kind(kind))
    } else {
      match unsafe { read_utf8_from_ptr(path_ptr, path_len as usize) } {
        Ok(path) => path,
        Err(code) => return code,
      }
    };

    match load_component_internal(kernel, kind, &path) {
      Ok(app_id) => app_id as i32,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn activity_launch(app_uri_ptr: *const u8, app_uri_len: u32, launch_flags: u32) -> i32 {
  if app_uri_ptr.is_null() && app_uri_len > 0 {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let app_uri = match unsafe { read_utf8_from_ptr(app_uri_ptr, app_uri_len as usize) } {
      Ok(uri) => uri,
      Err(code) => return code,
    };

    let requested_kind = launch_flags & 0xff;
    let kind = if requested_kind != 0 {
      requested_kind
    } else {
      app_kind_from_uri(&app_uri)
    };

    match load_component_internal(kernel, kind, &app_uri) {
      Ok(app_id) => app_id as i32,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn activity_terminate(app_id: u32, exit_code: i32) -> i32 {
  with_kernel_mut(|kernel| terminate_app_by_id(kernel, app_id, exit_code))
}

#[no_mangle]
pub extern "C" fn activity_send_intent(
  target_app_id: u32,
  action_code: u32,
  payload_ptr: *const u8,
  payload_len: u32,
) -> i32 {
  if payload_ptr.is_null() && payload_len > 0 {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let Some(target_app) = kernel
      .active_apps
      .iter()
      .find(|app| app.descriptor.app_id == target_app_id)
    else {
      return ENOENT;
    };

    let payload = match unsafe { read_bytes_from_ptr(payload_ptr, payload_len as usize) } {
      Ok(bytes) => bytes,
      Err(code) => return code,
    };

    match target_app.descriptor.kind {
      APP_KIND_TERMINAL => {
        if action_code == 1 {
          if let Ok(line) = core::str::from_utf8(payload) {
            kernel.terminal.inject_system_line(line);
          }
        }
      }
      APP_KIND_EDITOR => {
        if action_code == 1 {
          for byte in payload {
            kernel.editor.handle_key(*byte as u32, 0);
          }
        }
      }
      APP_KIND_FILE_EXPLORER => {
        if let Ok(path) = core::str::from_utf8(payload) {
          if action_code == 0x5048_4f54 {
            let lower = path.to_ascii_lowercase();
            if lower.ends_with(".png")
              || lower.ends_with(".jpg")
              || lower.ends_with(".jpeg")
              || lower.ends_with(".webp")
            {
              let _ = load_component_internal(kernel, APP_KIND_PHOTO_VIEWER, "/apps/photo-viewer.wasm");
            }
          }

          kernel.fs_explorer.mark_dirty(path);
        }
      }
      APP_KIND_AUDIO_PLAYER => {
        if action_code == 2 {
          let _ = kernel.media_pipeline.stream_open(2, 48_000, 2);
        }
      }
      _ => {}
    }

    0
  })
}

#[no_mangle]
pub extern "C" fn window_create(app_id: u32, layout_flags: u32) -> i32 {
  with_kernel_mut(|kernel| {
    if !kernel
      .active_apps
      .iter()
      .any(|app| app.descriptor.app_id == app_id)
    {
      return ENOENT;
    }

    let window_id = kernel.next_window_id;
    kernel.next_window_id = kernel.next_window_id.wrapping_add(1);
    kernel.window_manager.spawn_window(window_id, layout_flags & 0xff);

    window_id as i32
  })
}

#[no_mangle]
pub extern "C" fn window_attach_buffer(window_id: u32, buffer_ptr: u32, buffer_len: u32) -> i32 {
  if buffer_ptr == 0 || buffer_len == 0 {
    return EINVAL;
  }

  with_kernel_mut(|kernel| {
    if !kernel.window_manager.has_window(window_id) {
      return ENOENT;
    }

    if let Some(binding) = kernel
      .window_bindings
      .iter_mut()
      .find(|binding| binding.window_id == window_id)
    {
      binding.buffer_ptr = buffer_ptr;
      binding.buffer_len = buffer_len;
      return 0;
    }

    kernel.window_bindings.push(WindowBufferBinding {
      window_id,
      buffer_ptr,
      buffer_len,
    });

    0
  })
}

#[no_mangle]
pub extern "C" fn window_set_visuals(
  window_id: u32,
  opacity: f32,
  blur_radius: u32,
  depth_z: u32,
) -> i32 {
  with_kernel_mut(|kernel| {
    if kernel
      .window_manager
      .set_visuals(window_id, opacity, blur_radius, depth_z)
    {
      0
    } else {
      ENOENT
    }
  })
}

#[no_mangle]
pub extern "C" fn fs_open(path_ptr: *const u8, path_len: u32, mode_flags: u32) -> i32 {
  if path_ptr.is_null() && path_len > 0 {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let path = match unsafe { read_utf8_from_ptr(path_ptr, path_len as usize) } {
      Ok(value) if !value.is_empty() => value,
      Ok(_) => return EINVAL,
      Err(code) => return code,
    };

    let fd = match kernel.vfs.open(&path, PAGE_SIZE as u32) {
      Ok(fd) => fd,
      Err(code) => return code,
    };

    kernel.fs_handles.insert(
      fd,
      OpenFileState {
        path: path.clone(),
        data: Vec::new(),
      },
    );
    kernel.fs_explorer.add_path(&path, 2, 2);

    if mode_flags & 0x1 != 0 {
      kernel.fs_explorer.mark_dirty(&path);
    }

    fd as i32
  })
}

#[no_mangle]
pub extern "C" fn fs_read_async(fd: u32, offset: u64, dest_ptr: *mut u8, len: u32) -> i32 {
  if len == 0 {
    return 0;
  }

  if dest_ptr.is_null() {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let Some(handle) = kernel.fs_handles.get(&fd) else {
      return ENOENT;
    };

    let out = unsafe { slice::from_raw_parts_mut(dest_ptr, len as usize) };
    let start = min(offset as usize, handle.data.len());
    let end = min(start.saturating_add(len as usize), handle.data.len());
    let copied = end.saturating_sub(start);

    if copied > 0 {
      out[..copied].copy_from_slice(&handle.data[start..end]);
    }
    if copied < out.len() {
      out[copied..].fill(0);
    }

    copied as i32
  })
}

#[no_mangle]
pub extern "C" fn fs_write_async(fd: u32, offset: u64, src_ptr: *const u8, len: u32) -> i32 {
  if len == 0 {
    return 0;
  }

  if src_ptr.is_null() {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let src = match unsafe { read_bytes_from_ptr(src_ptr, len as usize) } {
      Ok(bytes) => bytes,
      Err(code) => return code,
    };

    let start = offset as usize;
    let end = match start.checked_add(src.len()) {
      Some(value) => value,
      None => return E2BIG,
    };

    let path = {
      let Some(handle) = kernel.fs_handles.get_mut(&fd) else {
        return ENOENT;
      };

      if handle.data.len() < end {
        handle.data.resize(end, 0);
      }
      handle.data[start..end].copy_from_slice(src);
      handle.path.clone()
    };

    let _ = kernel.vfs.track_write(fd, offset, len);
    kernel.fs_explorer.mark_dirty(&path);
    len as i32
  })
}

#[no_mangle]
pub extern "C" fn media_stream_open(stream_type: u32, rate: u32, channels: u32) -> i32 {
  with_kernel_mut(|kernel| kernel.media_pipeline.stream_open(stream_type, rate, channels) as i32)
}

#[no_mangle]
pub extern "C" fn media_push_pcm(stream_id: u32, buffer_ptr: *const u8, sample_count: u32) -> i32 {
  if sample_count == 0 {
    return 0;
  }

  if buffer_ptr.is_null() {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let byte_len = (sample_count as usize).saturating_mul(2);
    if let Err(code) = unsafe { read_bytes_from_ptr(buffer_ptr, byte_len) } {
      return code;
    }

    match kernel.media_pipeline.push_pcm(stream_id, sample_count) {
      Ok(()) => sample_count as i32,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn media_capture_frame(window_id: u32) -> u32 {
  let mut guard = KERNEL_INSTANCE
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner());
  let Some(kernel) = guard.as_mut() else {
    return 0;
  };

  if !kernel.window_manager.has_window(window_id) {
    return 0;
  }

  let frame_len = kernel
    .media_pipeline
    .capture_frame(window_id, &mut kernel.media_capture_scratch);
  if frame_len == 0 {
    return 0;
  }

  let ptr = os_alloc(frame_len as u32);
  if ptr == 0 {
    return 0;
  }

  unsafe {
    let dst = slice::from_raw_parts_mut(ptr as usize as *mut u8, frame_len);
    dst.copy_from_slice(&kernel.media_capture_scratch[..frame_len]);
  }

  ptr
}

#[no_mangle]
pub extern "C" fn hal_inject_sensor(
  sensor_id: u32,
  x: f32,
  y: f32,
  z: f32,
  timestamp_ns: u64,
) -> i32 {
  with_kernel_mut(|kernel| {
    match kernel.android_runtime.hal_inject_sensor(
      sensor_id,
      x,
      y,
      z,
      timestamp_ns,
      &mut kernel.memory,
      &kernel.dirty_bitmap,
    ) {
      Ok(code) => code,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn hal_inject_location(
  latitude: f64,
  longitude: f64,
  altitude: f64,
  accuracy: f32,
  heading: f32,
  speed: f32,
  timestamp_ns: u64,
) -> i32 {
  with_kernel_mut(|kernel| {
    match kernel.android_runtime.hal_inject_location(
      latitude,
      longitude,
      altitude,
      accuracy,
      heading,
      speed,
      timestamp_ns,
      &mut kernel.memory,
      &kernel.dirty_bitmap,
    ) {
      Ok(code) => code,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn hal_inject_audio_frame(
  channels: u32,
  sample_rate: u32,
  buffer_ptr: *const u8,
  buffer_len: u32,
  timestamp_ns: u64,
) -> i32 {
  if buffer_ptr.is_null() && buffer_len > 0 {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let payload = match unsafe { read_bytes_from_ptr(buffer_ptr, buffer_len as usize) } {
      Ok(bytes) => bytes,
      Err(code) => return code,
    };

    match kernel.android_runtime.hal_inject_audio_frame(
      channels,
      sample_rate,
      payload,
      timestamp_ns,
      &mut kernel.memory,
      &kernel.dirty_bitmap,
    ) {
      Ok(code) => code,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn hal_inject_camera_frame(
  width: u32,
  height: u32,
  pixel_format: u32,
  frame_ptr: *const u8,
  frame_len: u32,
  timestamp_ns: u64,
) -> i32 {
  if frame_ptr.is_null() && frame_len > 0 {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let payload = match unsafe { read_bytes_from_ptr(frame_ptr, frame_len as usize) } {
      Ok(bytes) => bytes,
      Err(code) => return code,
    };

    match kernel.android_runtime.hal_inject_camera_frame(
      width,
      height,
      pixel_format,
      payload,
      timestamp_ns,
      &mut kernel.memory,
      &kernel.dirty_bitmap,
    ) {
      Ok(code) => code,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn hal_inject_peripheral_token(
  token_kind: u32,
  token_ptr: *const u8,
  token_len: u32,
  timestamp_ns: u64,
) -> i32 {
  if token_ptr.is_null() && token_len > 0 {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let payload = match unsafe { read_bytes_from_ptr(token_ptr, token_len as usize) } {
      Ok(bytes) => bytes,
      Err(code) => return code,
    };

    match kernel.android_runtime.hal_inject_peripheral_token(
      token_kind,
      payload,
      timestamp_ns,
      &mut kernel.memory,
      &kernel.dirty_bitmap,
    ) {
      Ok(code) => code,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn hal_inject_nfc(
  record_type_ptr: *const u8,
  record_type_len: u32,
  media_type_ptr: *const u8,
  media_type_len: u32,
  payload_ptr: *const u8,
  payload_len: u32,
  timestamp_ns: u64,
) -> i32 {
  if (record_type_ptr.is_null() && record_type_len > 0)
    || (media_type_ptr.is_null() && media_type_len > 0)
    || (payload_ptr.is_null() && payload_len > 0)
  {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let record_type = match unsafe { read_utf8_from_ptr(record_type_ptr, record_type_len as usize) } {
      Ok(value) => value,
      Err(code) => return code,
    };

    let media_type = match unsafe { read_utf8_from_ptr(media_type_ptr, media_type_len as usize) } {
      Ok(value) => value,
      Err(code) => return code,
    };

    let payload = match unsafe { read_bytes_from_ptr(payload_ptr, payload_len as usize) } {
      Ok(bytes) => bytes,
      Err(code) => return code,
    };

    match kernel.android_runtime.hal_inject_nfc(
      &record_type,
      &media_type,
      payload,
      timestamp_ns,
      &mut kernel.memory,
      &kernel.dirty_bitmap,
    ) {
      Ok(code) => code,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn hal_inject_gamepad(
  index: u32,
  buttons_bitmap_low: u32,
  buttons_bitmap_high: u32,
  axes_ptr: *const u8,
  axes_len: u32,
  timestamp_ns: u64,
) -> i32 {
  if axes_ptr.is_null() && axes_len > 0 {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let axes_bytes = match unsafe { read_bytes_from_ptr(axes_ptr, axes_len as usize) } {
      Ok(bytes) => bytes,
      Err(code) => return code,
    };

    let axes = decode_f32_list_from_bytes(axes_bytes, HAL_MAX_F32_VALUES);
    let buttons_bitmap = ((buttons_bitmap_high as u64) << 32) | buttons_bitmap_low as u64;

    match kernel.android_runtime.hal_inject_gamepad(
      index,
      buttons_bitmap,
      &axes,
      timestamp_ns,
      &mut kernel.memory,
      &kernel.dirty_bitmap,
    ) {
      Ok(code) => code,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn hal_inject_serial_read(
  port_id: u32,
  data_ptr: *const u8,
  data_len: u32,
  timestamp_ns: u64,
) -> i32 {
  if data_ptr.is_null() && data_len > 0 {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let data = match unsafe { read_bytes_from_ptr(data_ptr, data_len as usize) } {
      Ok(bytes) => bytes,
      Err(code) => return code,
    };

    match kernel.android_runtime.hal_inject_serial_read(
      port_id,
      data,
      timestamp_ns,
      &mut kernel.memory,
      &kernel.dirty_bitmap,
    ) {
      Ok(code) => code,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn hal_inject_xr(
  transform_ptr: *const u8,
  transform_len: u32,
  hand_ptr: *const u8,
  hand_len: u32,
  timestamp_ns: u64,
) -> i32 {
  if (transform_ptr.is_null() && transform_len > 0) || (hand_ptr.is_null() && hand_len > 0) {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let transform_bytes = match unsafe { read_bytes_from_ptr(transform_ptr, transform_len as usize) } {
      Ok(bytes) => bytes,
      Err(code) => return code,
    };
    let hand_bytes = match unsafe { read_bytes_from_ptr(hand_ptr, hand_len as usize) } {
      Ok(bytes) => bytes,
      Err(code) => return code,
    };

    let transform = decode_f32_list_from_bytes(transform_bytes, HAL_MAX_F32_VALUES);
    let hand = decode_f32_list_from_bytes(hand_bytes, HAL_MAX_F32_VALUES);

    match kernel.android_runtime.hal_inject_xr(
      &transform,
      &hand,
      timestamp_ns,
      &mut kernel.memory,
      &kernel.dirty_bitmap,
    ) {
      Ok(code) => code,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn hal_set_haptics(
  pattern_ptr: *const u8,
  pattern_len: u32,
  timestamp_ns: u64,
) -> i32 {
  if pattern_ptr.is_null() && pattern_len > 0 {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let pattern_bytes = match unsafe { read_bytes_from_ptr(pattern_ptr, pattern_len as usize) } {
      Ok(bytes) => bytes,
      Err(code) => return code,
    };

    let pattern = decode_u32_list_from_bytes(pattern_bytes, HAL_MAX_U32_VALUES);
    match kernel.android_runtime.hal_set_haptics(
      &pattern,
      timestamp_ns,
      &mut kernel.memory,
      &kernel.dirty_bitmap,
    ) {
      Ok(code) => code,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn android_deploy_apk(vfs_path_ptr: *const u8, vfs_path_len: u32) -> i32 {
  if vfs_path_ptr.is_null() && vfs_path_len > 0 {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let vfs_path = match unsafe { read_utf8_from_ptr(vfs_path_ptr, vfs_path_len as usize) } {
      Ok(path) if !path.is_empty() => path,
      Ok(_) => return EINVAL,
      Err(code) => return code,
    };

    let manifest = match kernel
      .android_runtime
      .deploy_apk(&vfs_path, &mut kernel.fs_explorer)
    {
      Ok(manifest) => manifest,
      Err(code) => return code,
    };

    kernel.terminal.inject_system_line(&format!(
      "android deploy package={} main={} min_sdk={}",
      manifest.package_name, manifest.main_activity, manifest.min_sdk,
    ));

    kernel.fs_explorer.mark_dirty(&vfs_path);
    kernel.android_runtime.installed_count() as i32
  })
}

#[no_mangle]
pub extern "C" fn android_start_activity(intent_ptr: *const u8, intent_len: u32) -> i32 {
  if intent_ptr.is_null() && intent_len > 0 {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let intent_bytes = match unsafe { read_bytes_from_ptr(intent_ptr, intent_len as usize) } {
      Ok(bytes) => bytes,
      Err(code) => return code,
    };

    let intent = match DalvikIntent::decode_from_bytes(intent_bytes) {
      Ok(intent) => intent,
      Err(code) => return code,
    };

    let app_id = kernel.next_app_id;
    kernel.next_app_id = kernel.next_app_id.wrapping_add(1).max(1);

    let launch = match kernel.android_runtime.start_activity(
      app_id,
      intent,
      &mut kernel.arena_allocator,
      &mut kernel.memory,
      &kernel.dirty_bitmap,
      &mut kernel.fs_explorer,
    ) {
      Ok(result) => result,
      Err(code) => return code,
    };

    let window_id = kernel.next_window_id;
    kernel.next_window_id = kernel.next_window_id.wrapping_add(1);
    kernel
      .window_manager
      .spawn_window(window_id, APP_KIND_ANDROID_RUNTIME);
    let _ = kernel.window_manager.set_visuals(window_id, 0.93, 14, 180);

    if kernel.window_bindings.len() < 256 {
      kernel.window_bindings.push(WindowBufferBinding {
        window_id,
        buffer_ptr: launch.arena_offset,
        buffer_len: launch.arena_len.min(PAGE_SIZE as u32),
      });
    }

    let descriptor = AppDescriptor {
      app_id,
      window_id,
      kind: APP_KIND_ANDROID_RUNTIME,
      status: APP_STATUS_RUNNING,
      arena_offset: launch.arena_offset,
      arena_len: launch.arena_len,
    };

    let app_path = format!("/data/app/{}/base.apk#{}", launch.package_name, launch.activity);
    kernel.active_apps.push(AppInstance {
      descriptor,
      path: app_path,
    });

    kernel.terminal.inject_system_line(&format!(
      "android start app_id={} package={} activity={} binder_bytes={}",
      launch.app_id, launch.package_name, launch.activity, launch.binder_packet_bytes,
    ));

    app_id as i32
  })
}

#[no_mangle]
pub extern "C" fn android_vm_tick(app_id: u32) -> i32 {
  with_kernel_mut(|kernel| {
    match kernel
      .android_runtime
      .vm_tick(app_id, &mut kernel.memory, &kernel.dirty_bitmap)
    {
      Ok(code) => code,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn os_list_apps(dst_ptr: *mut AppDescriptor, capacity: u32) -> i32 {
  if dst_ptr.is_null() {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let out = unsafe { slice::from_raw_parts_mut(dst_ptr, capacity as usize) };
    let count = min(out.len(), kernel.active_apps.len());
    for (dst, app) in out.iter_mut().zip(kernel.active_apps.iter()).take(count) {
      *dst = app.descriptor;
    }

    count as i32
  })
}

#[no_mangle]
pub extern "C" fn os_get_metrics(out_ptr: *mut u32, capacity: u32) -> i32 {
  if out_ptr.is_null() {
    return EFAULT;
  }

  with_kernel_mut(|kernel| {
    let out = unsafe { slice::from_raw_parts_mut(out_ptr, capacity as usize) };
    if out.len() < METRICS_SLOTS {
      return E2BIG;
    }

    let tick = SCHEDULER_TICK.load(Ordering::Relaxed);
    out.fill(0);
    out[0] = tick as u32;
    out[1] = (tick >> 32) as u32;
    out[2] = kernel.memory.page_count();
    out[3] = kernel.dirty_bitmap.count_dirty_pages();
    out[4] = kernel.active_apps.len() as u32;
    out[5] = kernel.window_manager.pending_input();
    out[6] = kernel.compaction_sequence;
    out[7] = kernel.last_compacted_pages;
    out[8] = kernel.window_manager.window_count();
    out[9] = kernel.editor.len() as u32;
    out[10] = kernel.vfs.pending_delta_blocks() as u32;
    out[11] = kernel.fs_explorer.entry_count();
    out[12] = kernel.media_pipeline.stream_count();
    out[13] = kernel.media_pipeline.total_pcm_samples() as u32;
    out[14] = (kernel.media_pipeline.total_pcm_samples() >> 32) as u32;
    out[15] = (kernel.android_runtime.running_count() << 16)
      | (kernel.android_runtime.installed_count() & 0xffff);

    METRICS_SLOTS as i32
  })
}

#[no_mangle]
pub extern "C" fn os_terminal_snapshot(dst_ptr: *mut u8, max_len: u32) -> i32 {
  if dst_ptr.is_null() || max_len == 0 {
    return EINVAL;
  }

  with_kernel_mut(|kernel| {
    let out = unsafe { slice::from_raw_parts_mut(dst_ptr, max_len as usize) };
    kernel.terminal.snapshot(out) as i32
  })
}

#[no_mangle]
pub extern "C" fn os_editor_snapshot(dst_ptr: *mut u8, max_len: u32) -> i32 {
  if dst_ptr.is_null() || max_len == 0 {
    return EINVAL;
  }

  with_kernel_mut(|kernel| {
    let out = unsafe { slice::from_raw_parts_mut(dst_ptr, max_len as usize) };
    kernel.editor.snapshot(out) as i32
  })
}

#[no_mangle]
pub extern "C" fn os_media_snapshot(dst_ptr: *mut u8, max_len: u32) -> i32 {
  if dst_ptr.is_null() || max_len == 0 {
    return EINVAL;
  }

  with_kernel_mut(|kernel| {
    let out = unsafe { slice::from_raw_parts_mut(dst_ptr, max_len as usize) };
    kernel.media_pipeline.snapshot(out) as i32
  })
}

#[no_mangle]
pub extern "C" fn os_fs_explorer_snapshot(dst_ptr: *mut u8, max_len: u32) -> i32 {
  if dst_ptr.is_null() || max_len == 0 {
    return EINVAL;
  }

  with_kernel_mut(|kernel| {
    let out = unsafe { slice::from_raw_parts_mut(dst_ptr, max_len as usize) };
    kernel.fs_explorer.snapshot(out) as i32
  })
}

#[no_mangle]
pub extern "C" fn os_read_page(page_index: u32, dst_ptr: *mut u8, dst_len: u32) -> i32 {
  if dst_ptr.is_null() {
    return EFAULT;
  }

  if dst_len < PAGE_SIZE as u32 {
    return EINVAL;
  }

  with_kernel_mut(|kernel| {
    let out = unsafe { slice::from_raw_parts_mut(dst_ptr, PAGE_SIZE) };
    match kernel.memory.read_page(page_index, out) {
      Ok(bytes) => bytes as i32,
      Err(code) => code,
    }
  })
}

#[no_mangle]
pub extern "C" fn os_write_page(page_index: u32, src_ptr: *const u8, src_len: u32) -> i32 {
  if src_ptr.is_null() {
    return EFAULT;
  }

  if src_len == 0 || src_len > PAGE_SIZE as u32 {
    return EINVAL;
  }

  with_kernel_mut(|kernel| {
    let src = unsafe { slice::from_raw_parts(src_ptr, src_len as usize) };
    if let Err(code) = kernel.memory.hydrate_page(page_index, src, &kernel.dirty_bitmap) {
      return code;
    }

    let byte_offset = page_index as u64 * PAGE_SIZE as u64;
    let _ = kernel.vfs.track_write(kernel.session_fd, byte_offset, src_len);
    0
  })
}

#[no_mangle]
pub extern "C" fn os_alloc(len: u32) -> u32 {
  if len == 0 {
    return 0;
  }

  let mut buffer = vec![0_u8; len as usize];
  let ptr = buffer.as_mut_ptr() as usize as u32;
  std::mem::forget(buffer);
  ptr
}

#[no_mangle]
pub extern "C" fn os_free(ptr: u32, len: u32) {
  if ptr == 0 || len == 0 {
    return;
  }

  unsafe {
    let buffer = Vec::from_raw_parts(ptr as usize as *mut u8, len as usize, len as usize);
    drop(buffer);
  }
}
