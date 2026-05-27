mod memory;
mod vfs;
mod window_manager;

use memory::{read_utf8_from_ptr, DirtyPageBitmap, LinearMemoryImage, PAGE_SIZE};
use std::slice;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use vfs::DeltaTrackedVfs;
use window_manager::{UiEvent, WindowManager, WindowNode};

const EBUSY: i32 = -16;
const EFAULT: i32 = -14;
const EINVAL: i32 = -22;
const ENOENT: i32 = -2;

static KERNEL_ACTIVE: AtomicBool = AtomicBool::new(false);
static SCHEDULER_TICK: AtomicU64 = AtomicU64::new(0);

pub struct NomadOSKernel {
  total_memory: u32,
  session_flags: u32,
  suspended: bool,
  memory: LinearMemoryImage,
  dirty_bitmap: DirtyPageBitmap,
  vfs: DeltaTrackedVfs,
  window_manager: WindowManager,
  session_fd: u32,
}

static KERNEL_INSTANCE: Mutex<Option<NomadOSKernel>> = Mutex::new(None);

#[link(wasm_import_module = "host-sync")]
unsafe extern "C" {
  fn host_sync(delta_ptr: u32, length: u32) -> i32;
  fn host_log(msg_ptr: u32, msg_len: u32);
}

fn main() {}

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

fn build_suspend_manifest(kernel: &mut NomadOSKernel) -> Vec<u8> {
  let deltas = kernel.vfs.collect_deltas(96);
  let mut manifest = Vec::with_capacity(64 + deltas.len() * 16);

  manifest.extend_from_slice(b"NMSP");
  push_u32(&mut manifest, 1);
  push_u32(&mut manifest, kernel.total_memory);
  push_u32(&mut manifest, kernel.session_flags);
  push_u64(&mut manifest, SCHEDULER_TICK.load(Ordering::Relaxed));
  push_u32(&mut manifest, kernel.window_manager.pending_input());
  push_u32(&mut manifest, deltas.len() as u32);

  for delta in deltas {
    push_u32(&mut manifest, delta.fd);
    push_u64(&mut manifest, delta.block_index);
    push_u32(&mut manifest, delta.checksum);
  }

  manifest
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
  if vfs.mount("/home").is_err() {
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

  let kernel = NomadOSKernel {
    total_memory: ram_bytes,
    session_flags: flags,
    suspended: false,
    memory,
    dirty_bitmap,
    vfs,
    window_manager: WindowManager::new(),
    session_fd,
  };

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
    let tick = SCHEDULER_TICK.fetch_add(1, Ordering::Relaxed) + 1;

    if processed > 0 || tick % 120 == 0 {
      let mut frame = [0_u8; 16];
      frame[0..8].copy_from_slice(&tick.to_le_bytes());
      frame[8..12].copy_from_slice(&processed.to_le_bytes());
      frame[12..16].copy_from_slice(&kernel.window_manager.pending_input().to_le_bytes());

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

    0
  })
}

#[no_mangle]
pub extern "C" fn os_suspend() -> i32 {
  with_kernel_mut(|kernel| {
    kernel.suspended = true;
    let manifest = build_suspend_manifest(kernel);

    let rc = unsafe { host_sync(manifest.as_ptr() as usize as u32, manifest.len() as u32) };
    if rc < 0 {
      rc
    } else {
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

    log_host("[EVERYWHERE-OS] session resumed");
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
