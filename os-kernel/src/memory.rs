use core::sync::atomic::{AtomicU8, Ordering};
use std::cmp::min;
use std::collections::BTreeMap;

pub const PAGE_SIZE: usize = 64 * 1024;

const EFAULT: i32 = -14;
const EINVAL: i32 = -22;
const EILSEQ: i32 = -84;
const EOVERFLOW: i32 = -75;

pub struct DirtyPageBitmap {
  bits: Vec<AtomicU8>,
  page_count: u32,
}

impl DirtyPageBitmap {
  pub fn new(page_count: u32) -> Self {
    let bytes = (page_count as usize + 7) / 8;
    let mut bits = Vec::with_capacity(bytes);
    for _ in 0..bytes {
      bits.push(AtomicU8::new(0));
    }

    Self { bits, page_count }
  }

  pub fn mark_page(&self, page_index: u32) {
    if page_index >= self.page_count {
      return;
    }

    let byte_index = (page_index / 8) as usize;
    let bit = 1_u8 << (page_index % 8);
    self.bits[byte_index].fetch_or(bit, Ordering::AcqRel);
  }

  pub fn clear_page(&self, page_index: u32) {
    if page_index >= self.page_count {
      return;
    }

    let byte_index = (page_index / 8) as usize;
    let bit = !(1_u8 << (page_index % 8));
    self.bits[byte_index].fetch_and(bit, Ordering::AcqRel);
  }

  pub fn mark_range(&self, offset: u32, len: u32) {
    if len == 0 {
      return;
    }

    let start = offset as usize;
    let end = start.saturating_add(len as usize).saturating_sub(1);
    let start_page = (start / PAGE_SIZE) as u32;
    let end_page = (end / PAGE_SIZE) as u32;

    for page in start_page..=end_page {
      self.mark_page(page);
    }
  }

  pub fn collect_dirty_pages(&self, out: &mut [u32]) -> usize {
    if out.is_empty() {
      return 0;
    }

    let mut count = 0;

    for (byte_index, cell) in self.bits.iter().enumerate() {
      if count >= out.len() {
        break;
      }

      let mut pending = cell.swap(0, Ordering::AcqRel);
      while pending != 0 {
        let bit = pending.trailing_zeros() as usize;
        let mask = 1_u8 << bit;
        pending &= !mask;

        let page = byte_index * 8 + bit;
        if page >= self.page_count as usize {
          continue;
        }

        if count == out.len() {
          cell.fetch_or(mask | pending, Ordering::AcqRel);
          return count;
        }

        out[count] = page as u32;
        count += 1;
      }
    }

    count
  }
}

pub struct LinearMemoryImage {
  total_bytes: u32,
  page_count: u32,
  pages: BTreeMap<u32, Box<[u8; PAGE_SIZE]>>,
}

impl LinearMemoryImage {
  pub fn new(total_bytes: u32) -> Self {
    let page_count = ((total_bytes as usize + PAGE_SIZE - 1) / PAGE_SIZE) as u32;
    Self {
      total_bytes,
      page_count,
      pages: BTreeMap::new(),
    }
  }

  pub fn total_bytes(&self) -> u32 {
    self.total_bytes
  }

  pub fn page_count(&self) -> u32 {
    self.page_count
  }

  pub fn write_at(&mut self, offset: u32, src: &[u8], dirty: &DirtyPageBitmap) -> Result<(), i32> {
    if src.is_empty() {
      return Ok(());
    }

    let start = offset as usize;
    let end = start.checked_add(src.len()).ok_or(EOVERFLOW)?;
    if end > self.total_bytes as usize {
      return Err(EFAULT);
    }

    let mut cursor = start;
    let mut src_offset = 0;

    while src_offset < src.len() {
      let page_index = (cursor / PAGE_SIZE) as u32;
      let in_page = cursor % PAGE_SIZE;
      let chunk = min(PAGE_SIZE - in_page, src.len() - src_offset);

      let page = self
        .pages
        .entry(page_index)
        .or_insert_with(|| Box::new([0_u8; PAGE_SIZE]));
      page[in_page..in_page + chunk].copy_from_slice(&src[src_offset..src_offset + chunk]);

      dirty.mark_page(page_index);
      cursor += chunk;
      src_offset += chunk;
    }

    Ok(())
  }

  pub fn hydrate_page(
    &mut self,
    page_index: u32,
    src: &[u8],
    dirty: &DirtyPageBitmap,
  ) -> Result<(), i32> {
    if page_index >= self.page_count {
      return Err(EINVAL);
    }

    if src.is_empty() || src.len() > PAGE_SIZE {
      return Err(EINVAL);
    }

    let page = self
      .pages
      .entry(page_index)
      .or_insert_with(|| Box::new([0_u8; PAGE_SIZE]));
    page[0..src.len()].copy_from_slice(src);
    if src.len() < PAGE_SIZE {
      page[src.len()..PAGE_SIZE].fill(0);
    }

    dirty.clear_page(page_index);
    Ok(())
  }

  pub fn read_page(&self, page_index: u32, out: &mut [u8]) -> Result<usize, i32> {
    if page_index >= self.page_count {
      return Err(EINVAL);
    }

    if out.len() < PAGE_SIZE {
      return Err(EINVAL);
    }

    if let Some(page) = self.pages.get(&page_index) {
      out[0..PAGE_SIZE].copy_from_slice(&page[..]);
    } else {
      out[0..PAGE_SIZE].fill(0);
    }

    Ok(PAGE_SIZE)
  }
}

pub unsafe fn read_bytes_from_ptr<'a>(ptr: *const u8, len: usize) -> Result<&'a [u8], i32> {
  if len == 0 {
    return Ok(&[]);
  }

  if ptr.is_null() {
    return Err(EFAULT);
  }

  let start = ptr as usize;
  let end = start.checked_add(len).ok_or(EOVERFLOW)?;
  if end > u32::MAX as usize {
    return Err(EOVERFLOW);
  }

  Ok(core::slice::from_raw_parts(ptr, len))
}

pub unsafe fn read_utf8_from_ptr(ptr: *const u8, len: usize) -> Result<String, i32> {
  let bytes = read_bytes_from_ptr(ptr, len)?;
  match core::str::from_utf8(bytes) {
    Ok(value) => Ok(value.to_owned()),
    Err(_) => Err(EILSEQ),
  }
}
