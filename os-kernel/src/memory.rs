use core::mem::{align_of, size_of};
use core::sync::atomic::{AtomicU32, Ordering};

pub const MIN_RING_BYTES: u32 = 4096;

pub const OP_NOP: u16 = 0;
pub const OP_GPU_SUBMIT: u16 = 1;
pub const OP_STORAGE_FLUSH: u16 = 2;

const HEADER_BYTES: usize = 64;

const EFAULT: i32 = -14;
const EINVAL: i32 = -22;
const EILSEQ: i32 = -84;
const EOVERFLOW: i32 = -75;

#[repr(C, align(64))]
struct RingHeader {
  write_index: AtomicU32,
  read_index: AtomicU32,
  capacity: u32,
  _reserved0: u32,
  dropped: AtomicU32,
  _reserved1: [u32; 10],
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct KernelPacket {
  pub opcode: u16,
  pub flags: u16,
  pub len: u32,
  pub arg0: u32,
  pub arg1: u32,
}

pub struct RingBuffer {
  header: *mut RingHeader,
  data: *mut KernelPacket,
}

unsafe impl Send for RingBuffer {}
unsafe impl Sync for RingBuffer {}

impl RingBuffer {
  pub unsafe fn from_linear_memory(offset: u32, len: u32) -> Result<Self, i32> {
    if len < MIN_RING_BYTES || offset == 0 {
      return Err(EINVAL);
    }

    if (offset as usize) % align_of::<RingHeader>() != 0 {
      return Err(EINVAL);
    }

    let usable_bytes = (len as usize).saturating_sub(HEADER_BYTES);
    let slots = usable_bytes / size_of::<KernelPacket>();
    if slots < 2 {
      return Err(EINVAL);
    }

    let header = offset as usize as *mut RingHeader;
    let data = (offset as usize + HEADER_BYTES) as *mut KernelPacket;

    (*header).write_index.store(0, Ordering::Relaxed);
    (*header).read_index.store(0, Ordering::Relaxed);
    (*header).capacity = slots as u32;
    (*header).dropped.store(0, Ordering::Relaxed);

    Ok(Self { header, data })
  }

  pub unsafe fn pop_packet(&self) -> Option<KernelPacket> {
    let header = &*self.header;
    let read = header.read_index.load(Ordering::Acquire);
    let write = header.write_index.load(Ordering::Acquire);
    if read == write {
      return None;
    }

    let slot = (read % header.capacity) as usize;
    let packet = *self.data.add(slot);
    header.read_index.store(read.wrapping_add(1), Ordering::Release);
    Some(packet)
  }

  pub unsafe fn push_packet(&self, packet: KernelPacket) -> Result<(), i32> {
    let header = &*self.header;
    let read = header.read_index.load(Ordering::Acquire);
    let write = header.write_index.load(Ordering::Acquire);

    if write.wrapping_sub(read) >= header.capacity {
      header.dropped.fetch_add(1, Ordering::Relaxed);
      return Err(EOVERFLOW);
    }

    let slot = (write % header.capacity) as usize;
    *self.data.add(slot) = packet;
    header.write_index.store(write.wrapping_add(1), Ordering::Release);
    Ok(())
  }
}

pub unsafe fn read_bytes<'a>(ptr: u32, len: u32) -> Result<&'a [u8], i32> {
  if len == 0 {
    return Ok(&[]);
  }

  if ptr == 0 {
    return Err(EFAULT);
  }

  let start = ptr as usize;
  let end = start.checked_add(len as usize).ok_or(EOVERFLOW)?;
  if end > u32::MAX as usize {
    return Err(EOVERFLOW);
  }

  Ok(core::slice::from_raw_parts(ptr as *const u8, len as usize))
}

pub unsafe fn read_utf8(ptr: u32, len: u32) -> Result<String, i32> {
  let bytes = read_bytes(ptr, len)?;
  match core::str::from_utf8(bytes) {
    Ok(value) => Ok(value.to_string()),
    Err(_) => Err(EILSEQ),
  }
}

pub fn looks_like_wasm_component(header: &[u8; 8]) -> bool {
  let core_module = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  let component_model = [0x00, 0x61, 0x73, 0x6d, 0x0a, 0x00, 0x01, 0x00];
  *header == core_module || *header == component_model
}
