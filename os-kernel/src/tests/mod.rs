mod abi_compliance;
mod app_frameworks;
mod allocator_bitmap_rle;
mod vfs_descriptor;

use std::sync::{Mutex, MutexGuard};

use crate::memory::PAGE_SIZE;
use crate::AppDescriptor;

static TEST_MUTEX: Mutex<()> = Mutex::new(());

pub(super) fn lock_kernel() -> MutexGuard<'static, ()> {
  TEST_MUTEX
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(super) fn boot_kernel(ram_pages: u32) {
  crate::reset_kernel_for_tests();
  let ram_bytes = ram_pages.saturating_mul(PAGE_SIZE as u32);
  let rc = crate::os_boot(ram_bytes, 0);
  assert_eq!(rc, 0, "os_boot failed with {rc}");
}

pub(super) fn alloc_utf8(text: &str) -> (u32, u32) {
  let bytes = text.as_bytes();
  if bytes.is_empty() {
    return (0, 0);
  }

  let ptr = crate::os_alloc(bytes.len() as u32);
  assert_ne!(ptr, 0);

  unsafe {
    let dst = std::slice::from_raw_parts_mut(ptr as usize as *mut u8, bytes.len());
    dst.copy_from_slice(bytes);
  }

  (ptr, bytes.len() as u32)
}

pub(super) fn alloc_bytes(bytes: &[u8]) -> (u32, u32) {
  if bytes.is_empty() {
    return (0, 0);
  }

  let ptr = crate::os_alloc(bytes.len() as u32);
  assert_ne!(ptr, 0);

  unsafe {
    let dst = std::slice::from_raw_parts_mut(ptr as usize as *mut u8, bytes.len());
    dst.copy_from_slice(bytes);
  }

  (ptr, bytes.len() as u32)
}

pub(super) fn free_alloc(ptr: u32, len: u32) {
  if ptr != 0 && len != 0 {
    crate::os_free(ptr, len);
  }
}

pub(super) fn list_apps(capacity: usize) -> Vec<AppDescriptor> {
  let mut out = vec![AppDescriptor::default(); capacity];
  let rc = crate::os_list_apps(out.as_mut_ptr(), out.len() as u32);
  assert!(rc >= 0, "os_list_apps failed with {rc}");
  out.truncate(rc as usize);
  out
}
