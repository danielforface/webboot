use std::collections::BTreeMap;

#[derive(Clone)]
pub struct ExplorerEntry {
  pub path: String,
  pub kind: u32,
  pub sync_state: u32,
}

pub struct FsExplorerState {
  entries: BTreeMap<String, ExplorerEntry>,
  sequence: u32,
}

impl FsExplorerState {
  pub fn new() -> Self {
    let mut state = Self {
      entries: BTreeMap::new(),
      sequence: 1,
    };

    state.add_path("/home", 1, 2);
    state.add_path("/home/session.delta", 2, 1);
    state.add_path("/apps", 1, 2);
    state
  }

  pub fn add_path(&mut self, path: &str, kind: u32, sync_state: u32) {
    self.entries.insert(
      path.to_owned(),
      ExplorerEntry {
        path: path.to_owned(),
        kind,
        sync_state,
      },
    );
    self.sequence = self.sequence.wrapping_add(1);
  }

  pub fn mark_dirty(&mut self, path: &str) {
    if let Some(entry) = self.entries.get_mut(path) {
      entry.sync_state = 1;
      self.sequence = self.sequence.wrapping_add(1);
      return;
    }

    self.add_path(path, 2, 1);
  }

  pub fn mark_synced(&mut self, path: &str) {
    if let Some(entry) = self.entries.get_mut(path) {
      entry.sync_state = 2;
      self.sequence = self.sequence.wrapping_add(1);
    }
  }

  pub fn snapshot(&self, out: &mut [u8]) -> usize {
    if out.len() < 8 {
      return 0;
    }

    let mut cursor = 0;
    out[cursor..cursor + 4].copy_from_slice(&self.sequence.to_le_bytes());
    cursor += 4;
    out[cursor..cursor + 4].copy_from_slice(&(self.entries.len() as u32).to_le_bytes());
    cursor += 4;

    for entry in self.entries.values() {
      let path_bytes = entry.path.as_bytes();
      if cursor + 12 + path_bytes.len() > out.len() {
        break;
      }

      out[cursor..cursor + 4].copy_from_slice(&(path_bytes.len() as u32).to_le_bytes());
      cursor += 4;
      out[cursor..cursor + 4].copy_from_slice(&entry.kind.to_le_bytes());
      cursor += 4;
      out[cursor..cursor + 4].copy_from_slice(&entry.sync_state.to_le_bytes());
      cursor += 4;
      out[cursor..cursor + path_bytes.len()].copy_from_slice(path_bytes);
      cursor += path_bytes.len();
    }

    cursor
  }

  pub fn entry_count(&self) -> u32 {
    self.entries.len() as u32
  }
}
