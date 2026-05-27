mod memory;
mod vfs;

use core::sync::atomic::{AtomicU64, Ordering};
use memory::{KernelPacket, RingBuffer, MIN_RING_BYTES};
use std::sync::{Mutex, OnceLock};
use vfs::{DriverClass, Vfs};

const EVENT_BOOT_OK: u32 = 0x01;
const EVENT_COMPONENT_OK: u32 = 0x02;
const EVENT_COMPONENT_ERR: u32 = 0x03;
const EVENT_GPU_SUBMIT: u32 = 0x04;

const EFAULT: i32 = -14;
const EBUSY: i32 = -16;
const EINVAL: i32 = -22;
const ENOEXEC: i32 = -8;
const ENOSYS: i32 = -38;

#[link(wasm_import_module = "host")]
unsafe extern "C" {
  fn host_event_notify(event_code: u32, arg0: u32, arg1: u32) -> u32;
  fn host_storage_read(fd: u32, offset: u64, dst_ptr: u32, len: u32) -> i32;
  fn host_storage_write(fd: u32, offset: u64, src_ptr: u32, len: u32) -> i32;
  fn host_gpu_submit(queue: u32, cmd_ptr: u32, cmd_len: u32) -> i32;
  fn host_clock_time_ns() -> u64;
}

struct KernelState {
  ring: RingBuffer,
  vfs: Vfs,
  ticks: AtomicU64,
  root_disk_fd: u32,
}

static KERNEL_STATE: OnceLock<Mutex<KernelState>> = OnceLock::new();

fn main() {}

#[no_mangle]
pub extern "C" fn kernel_boot(memory_bytes: u32, ring_offset: u32, ring_len: u32, flags: u32) -> i32 {
  if memory_bytes == 0 || ring_offset == 0 || ring_len < MIN_RING_BYTES {
    return EINVAL;
  }

  let ring = unsafe {
    match RingBuffer::from_linear_memory(ring_offset, ring_len) {
      Ok(ring) => ring,
      Err(code) => return code,
    }
  };

  let mut vfs = Vfs::new();
  if vfs.mount("/dev", DriverClass::Device).is_err() {
    return EFAULT;
  }
  if vfs.mount("/sys", DriverClass::System).is_err() {
    return EFAULT;
  }
  if vfs.mount("/net", DriverClass::Network).is_err() {
    return EFAULT;
  }

  let kernel = KernelState {
    ring,
    vfs,
    ticks: AtomicU64::new(0),
    root_disk_fd: flags,
  };

  if KERNEL_STATE.set(Mutex::new(kernel)).is_err() {
    return EBUSY;
  }

  unsafe {
    let _ = host_event_notify(EVENT_BOOT_OK, memory_bytes, ring_len);
  }

  0
}

#[no_mangle]
pub extern "C" fn kernel_poll(deadline_ns: u64) -> i32 {
  let Some(state_lock) = KERNEL_STATE.get() else {
    return ENOSYS;
  };

  let now = unsafe { host_clock_time_ns() };
  if now >= deadline_ns {
    return 0;
  }

  let mut state = state_lock
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner());

  while let Some(packet) = unsafe { state.ring.pop_packet() } {
    let code = handle_packet(&mut state, packet);
    if code != 0 {
      return code;
    }
  }

  let ticks = state.ticks.fetch_add(1, Ordering::Relaxed) + 1;
  if ticks & 0x3ff == 0 {
    unsafe {
      let _ = host_event_notify(0x10, ticks as u32, (ticks >> 32) as u32);
    }
  }

  0
}

#[no_mangle]
pub extern "C" fn kernel_mount_component(fd: u32, path_ptr: u32, path_len: u32) -> i32 {
  let Some(state_lock) = KERNEL_STATE.get() else {
    return ENOSYS;
  };

  let path = unsafe {
    match memory::read_utf8(path_ptr, path_len) {
      Ok(path) => path,
      Err(code) => return code,
    }
  };

  let mut magic = [0_u8; 8];
  let read = unsafe {
    host_storage_read(
      fd,
      0,
      magic.as_mut_ptr() as usize as u32,
      magic.len() as u32,
    )
  };
  if read < 8 {
    unsafe {
      let _ = host_event_notify(EVENT_COMPONENT_ERR, fd, read.max(0) as u32);
    }
    return ENOEXEC;
  }

  if !memory::looks_like_wasm_component(&magic) {
    unsafe {
      let _ = host_event_notify(EVENT_COMPONENT_ERR, fd, 0);
    }
    return ENOEXEC;
  }

  let mut state = state_lock
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner());
  if state.vfs.attach_fd(&path, fd).is_err() {
    return EFAULT;
  }

  unsafe {
    let _ = host_event_notify(EVENT_COMPONENT_OK, fd, path_len);
  }

  0
}

fn handle_packet(state: &mut KernelState, packet: KernelPacket) -> i32 {
  match packet.opcode {
    memory::OP_NOP => 0,
    memory::OP_GPU_SUBMIT => {
      let rc = unsafe { host_gpu_submit(packet.arg0, packet.arg1, packet.len) };
      unsafe {
        let _ = host_event_notify(EVENT_GPU_SUBMIT, packet.arg0, packet.len);
      }
      if rc < 0 {
        rc
      } else {
        0
      }
    }
    memory::OP_STORAGE_FLUSH => {
      if state.root_disk_fd == 0 {
        return 0;
      }

      let marker = [0_u8; 1];
      let rc = unsafe {
        host_storage_write(
          state.root_disk_fd,
          0,
          marker.as_ptr() as usize as u32,
          0,
        )
      };
      if rc < 0 {
        rc
      } else {
        0
      }
    }
    _ => EINVAL,
  }
}
