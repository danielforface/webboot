use crate::memory::{ArenaSlice, DirtyPageBitmap, LinearMemoryImage, PAGE_SIZE};

const EFAULT: i32 = -14;

pub struct DalvikVm {
  arena: ArenaSlice,
  registers: [i32; 32],
  stack_cursor: u32,
  object_cursor: u32,
  method_count: u32,
  tick_count: u64,
  pending_binder_packet: Vec<u8>,
}

impl DalvikVm {
  pub fn new(arena: ArenaSlice, method_count: u32) -> Self {
    Self {
      arena,
      registers: [0_i32; 32],
      stack_cursor: 0,
      object_cursor: 0,
      method_count: method_count.max(1),
      tick_count: 0,
      pending_binder_packet: Vec::new(),
    }
  }

  pub fn inject_binder_packet(
    &mut self,
    packet: &[u8],
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<(), i32> {
    self.pending_binder_packet.clear();
    self.pending_binder_packet.extend_from_slice(packet);

    let mut header = [0_u8; 8];
    header[0..4].copy_from_slice(&(packet.len() as u32).to_le_bytes());
    header[4..8].copy_from_slice(&(self.tick_count as u32).to_le_bytes());

    self.write_arena(memory, dirty, 0, &header)?;
    self.write_arena(memory, dirty, 8, packet)?;
    Ok(())
  }

  pub fn tick(
    &mut self,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
  ) -> Result<(), i32> {
    self.tick_count = self.tick_count.wrapping_add(1);

    let reg_index = (self.tick_count as usize) % self.registers.len();
    self.registers[reg_index] = self.registers[reg_index].wrapping_add(1);
    let method_slot = (self.tick_count as u32) % self.method_count;

    let mut frame = [0_u8; 24];
    frame[0..8].copy_from_slice(&self.tick_count.to_le_bytes());
    frame[8..12].copy_from_slice(&method_slot.to_le_bytes());
    frame[12..16].copy_from_slice(&(reg_index as u32).to_le_bytes());
    frame[16..20].copy_from_slice(&self.registers[reg_index].to_le_bytes());
    frame[20..24].copy_from_slice(&(self.pending_binder_packet.len() as u32).to_le_bytes());

    let arena_bytes = self.arena.page_count.saturating_mul(PAGE_SIZE as u32);
    if arena_bytes < 4096 {
      return Err(EFAULT);
    }

    let stack_region_start = 1024_u32;
    let stack_region_len = arena_bytes.saturating_sub(stack_region_start + 1024).max(256);
    let stack_offset = stack_region_start + (self.stack_cursor % stack_region_len);
    self.write_arena(memory, dirty, stack_offset, &frame)?;
    self.stack_cursor = self.stack_cursor.wrapping_add(frame.len() as u32);

    let mut object_patch = [0_u8; 16];
    object_patch[0..4].copy_from_slice(&(self.object_cursor / 16).to_le_bytes());
    object_patch[4..8].copy_from_slice(&(method_slot ^ reg_index as u32).to_le_bytes());
    object_patch[8..12].copy_from_slice(&(self.tick_count as u32).to_le_bytes());
    object_patch[12..16].copy_from_slice(&(self.tick_count >> 32).to_le_bytes());

    let heap_start = arena_bytes / 2;
    let heap_capacity = arena_bytes.saturating_sub(heap_start + 32).max(32);
    let heap_offset = heap_start + (self.object_cursor % heap_capacity);
    self.write_arena(memory, dirty, heap_offset, &object_patch)?;
    self.object_cursor = self.object_cursor.wrapping_add(object_patch.len() as u32);

    if !self.pending_binder_packet.is_empty() && self.tick_count % 8 == 0 {
      let inbox_offset = 256_u32;
      let copy_len = self.pending_binder_packet.len().min(512);
      self.write_arena(memory, dirty, inbox_offset, &self.pending_binder_packet[..copy_len])?;
    }

    Ok(())
  }

  fn write_arena(
    &self,
    memory: &mut LinearMemoryImage,
    dirty: &DirtyPageBitmap,
    relative_offset: u32,
    src: &[u8],
  ) -> Result<(), i32> {
    let arena_offset = self.arena.base_page.saturating_mul(PAGE_SIZE as u32);
    let arena_bytes = self.arena.page_count.saturating_mul(PAGE_SIZE as u32);

    let end = relative_offset
      .checked_add(src.len() as u32)
      .ok_or(EFAULT)?;
    if end > arena_bytes {
      return Err(EFAULT);
    }

    memory.write_at(arena_offset.saturating_add(relative_offset), src, dirty)
  }
}
