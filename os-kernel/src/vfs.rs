use std::collections::{BTreeMap, BTreeSet};

const EEXIST: i32 = -17;
const EINVAL: i32 = -22;
const ENOENT: i32 = -2;

#[derive(Debug, Clone, Copy)]
pub struct BlockDelta {
  pub fd: u32,
  pub block_index: u64,
  pub checksum: u32,
}

#[derive(Debug, Clone)]
struct FileHandleState {
  path: String,
  block_size: u32,
  dirty_blocks: BTreeSet<u64>,
}

pub struct DeltaTrackedVfs {
  mounts: BTreeSet<String>,
  handles: BTreeMap<u32, FileHandleState>,
  next_fd: u32,
}

impl DeltaTrackedVfs {
  pub fn new() -> Self {
    Self {
      mounts: BTreeSet::new(),
      handles: BTreeMap::new(),
      next_fd: 4,
    }
  }

  pub fn mount(&mut self, path: &str) -> Result<(), i32> {
    if !path.starts_with('/') {
      return Err(EINVAL);
    }

    if !self.mounts.insert(path.to_owned()) {
      return Err(EEXIST);
    }

    Ok(())
  }

  pub fn open(&mut self, path: &str, block_size: u32) -> Result<u32, i32> {
    if !path.starts_with('/') || block_size == 0 {
      return Err(EINVAL);
    }

    let fd = self.next_fd;
    self.next_fd = self.next_fd.wrapping_add(1);
    self.handles.insert(
      fd,
      FileHandleState {
        path: path.to_owned(),
        block_size,
        dirty_blocks: BTreeSet::new(),
      },
    );

    Ok(fd)
  }

  pub fn close(&mut self, fd: u32) -> Result<(), i32> {
    if self.handles.remove(&fd).is_some() {
      Ok(())
    } else {
      Err(ENOENT)
    }
  }

  pub fn track_write(&mut self, fd: u32, byte_offset: u64, len: u32) -> Result<(), i32> {
    if len == 0 {
      return Ok(());
    }

    let Some(handle) = self.handles.get_mut(&fd) else {
      return Err(ENOENT);
    };

    let block_size = handle.block_size as u64;
    let start = byte_offset / block_size;
    let end = (byte_offset + len as u64 - 1) / block_size;
    for block in start..=end {
      handle.dirty_blocks.insert(block);
    }

    Ok(())
  }

  pub fn collect_deltas(&mut self, limit: usize) -> Vec<BlockDelta> {
    let mut out = Vec::with_capacity(limit);
    if limit == 0 {
      return out;
    }

    for (fd, state) in &mut self.handles {
      while out.len() < limit {
        let Some(block) = state.dirty_blocks.pop_first() else {
          break;
        };

        out.push(BlockDelta {
          fd: *fd,
          block_index: block,
          checksum: cheap_checksum(*fd, block, &state.path),
        });
      }

      if out.len() == limit {
        break;
      }
    }

    out
  }

  pub fn pending_delta_blocks(&self) -> usize {
    self
      .handles
      .values()
      .map(|state| state.dirty_blocks.len())
      .sum()
  }

  pub fn handle_count(&self) -> usize {
    self.handles.len()
  }
}

fn cheap_checksum(fd: u32, block_index: u64, path: &str) -> u32 {
  let mut hash = 0x811c9dc5_u32 ^ fd;
  for byte in block_index.to_le_bytes() {
    hash ^= byte as u32;
    hash = hash.wrapping_mul(16777619);
  }

  for byte in path.as_bytes() {
    hash ^= *byte as u32;
    hash = hash.wrapping_mul(16777619);
  }

  hash
}
