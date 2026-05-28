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

  pub fn count_dirty_pages(&self) -> u32 {
    let mut total = 0_u32;
    for cell in &self.bits {
      total = total.saturating_add(cell.load(Ordering::Acquire).count_ones());
    }

    total
  }
}

pub struct LinearMemoryImage {
  total_bytes: u32,
  page_count: u32,
  pages: BTreeMap<u32, Box<[u8; PAGE_SIZE]>>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ArenaSlice {
  pub base_page: u32,
  pub page_count: u32,
}

pub struct PageArenaAllocator {
  cursor: u32,
  total_pages: u32,
  free_list: Vec<ArenaSlice>,
}

impl PageArenaAllocator {
  pub fn new(total_pages: u32, reserved_pages: u32) -> Self {
    let cursor = reserved_pages.min(total_pages);
    Self {
      cursor,
      total_pages,
      free_list: Vec::new(),
    }
  }

  pub fn allocate_pages(&mut self, requested_pages: u32) -> Option<ArenaSlice> {
    if requested_pages == 0 {
      return None;
    }

    if let Some(index) = self
      .free_list
      .iter()
      .position(|entry| entry.page_count >= requested_pages)
    {
      let mut entry = self.free_list[index];
      if entry.page_count == requested_pages {
        self.free_list.swap_remove(index);
        return Some(entry);
      }

      entry.page_count -= requested_pages;
      self.free_list[index].page_count = entry.page_count;
      self.free_list[index].base_page = self.free_list[index]
        .base_page
        .saturating_add(requested_pages);
      return Some(ArenaSlice {
        base_page: entry.base_page,
        page_count: requested_pages,
      });
    }

    if self.cursor.saturating_add(requested_pages) > self.total_pages {
      return None;
    }

    let slice = ArenaSlice {
      base_page: self.cursor,
      page_count: requested_pages,
    };
    self.cursor = self.cursor.saturating_add(requested_pages);
    Some(slice)
  }

  pub fn release(&mut self, slice: ArenaSlice) {
    if slice.page_count == 0 || slice.base_page >= self.total_pages {
      return;
    }

    let max_count = self.total_pages.saturating_sub(slice.base_page);
    let clamped = ArenaSlice {
      base_page: slice.base_page,
      page_count: slice.page_count.min(max_count),
    };

    self.free_list.push(clamped);
    self.coalesce();
  }

  fn coalesce(&mut self) {
    self
      .free_list
      .sort_by(|left, right| left.base_page.cmp(&right.base_page));

    let mut merged: Vec<ArenaSlice> = Vec::with_capacity(self.free_list.len());
    for entry in &self.free_list {
      if let Some(last) = merged.last_mut() {
        let end = last.base_page.saturating_add(last.page_count);
        if end >= entry.base_page {
          let next_end = entry.base_page.saturating_add(entry.page_count);
          let merged_end = end.max(next_end);
          last.page_count = merged_end.saturating_sub(last.base_page);
          continue;
        }
      }

      merged.push(*entry);
    }

    self.free_list = merged;
  }
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

pub fn rle_zero_encode(input: &[u8], output: &mut [u8]) -> Result<usize, i32> {
  let mut i = 0;
  let mut o = 0;

  while i < input.len() {
    if input[i] == 0 {
      let mut run = 1;
      while i + run < input.len() && run < 128 && input[i + run] == 0 {
        run += 1;
      }

      if o >= output.len() {
        return Err(EOVERFLOW);
      }

      output[o] = 0x80 | ((run - 1) as u8);
      o += 1;
      i += run;
      continue;
    }

    let mut run = 1;
    while i + run < input.len() && run < 128 && input[i + run] != 0 {
      run += 1;
    }

    if o + 1 + run > output.len() {
      return Err(EOVERFLOW);
    }

    output[o] = (run - 1) as u8;
    o += 1;
    output[o..o + run].copy_from_slice(&input[i..i + run]);
    o += run;
    i += run;
  }

  Ok(o)
}

pub fn rle_zero_decode(input: &[u8], output: &mut [u8]) -> Result<usize, i32> {
  let mut i = 0;
  let mut o = 0;

  while i < input.len() {
    let token = input[i];
    i += 1;

    let run = ((token & 0x7f) as usize) + 1;
    if token & 0x80 != 0 {
      if o + run > output.len() {
        return Err(EOVERFLOW);
      }

      output[o..o + run].fill(0);
      o += run;
      continue;
    }

    if i + run > input.len() || o + run > output.len() {
      return Err(EOVERFLOW);
    }

    output[o..o + run].copy_from_slice(&input[i..i + run]);
    i += run;
    o += run;
  }

  Ok(o)
}
