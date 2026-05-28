use std::cmp::min;

const MAX_EDITOR_BYTES: usize = 192 * 1024;

pub struct EditorState {
  text: Vec<u8>,
  cursor: usize,
  sequence: u32,
  flags: u32,
}

impl EditorState {
  pub fn new() -> Self {
    let initial = b"# Untitled Document\n\nWelcome to Everywhere Editor.\n";
    Self {
      text: initial.to_vec(),
      cursor: initial.len(),
      sequence: 1,
      flags: 0,
    }
  }

  pub fn handle_key(&mut self, key_code: u32, modifiers: u32) {
    match key_code {
      8 | 127 => {
        if self.cursor > 0 {
          self.cursor -= 1;
          self.text.remove(self.cursor);
        }
      }
      13 => {
        self.insert_byte(b'\n');
      }
      37 => {
        if self.cursor > 0 {
          self.cursor -= 1;
        }
      }
      39 => {
        if self.cursor < self.text.len() {
          self.cursor += 1;
        }
      }
      46 => {
        if self.cursor < self.text.len() {
          self.text.remove(self.cursor);
        }
      }
      32..=126 => {
        if modifiers & (1 << 2) != 0 {
          return;
        }
        self.insert_byte(key_code as u8);
      }
      _ => {}
    }

    self.sequence = self.sequence.wrapping_add(1);
  }

  pub fn snapshot(&self, out: &mut [u8]) -> usize {
    if out.len() < 16 {
      return 0;
    }

    let text_len = min(self.text.len(), out.len().saturating_sub(16));
    out[0..4].copy_from_slice(&self.sequence.to_le_bytes());
    out[4..8].copy_from_slice(&(self.cursor as u32).to_le_bytes());
    out[8..12].copy_from_slice(&(text_len as u32).to_le_bytes());
    out[12..16].copy_from_slice(&self.flags.to_le_bytes());
    out[16..16 + text_len].copy_from_slice(&self.text[..text_len]);
    16 + text_len
  }

  pub fn set_flags(&mut self, flags: u32) {
    self.flags = flags;
    self.sequence = self.sequence.wrapping_add(1);
  }

  pub fn len(&self) -> usize {
    self.text.len()
  }

  fn insert_byte(&mut self, byte: u8) {
    if self.text.len() >= MAX_EDITOR_BYTES {
      return;
    }

    self.text.insert(self.cursor, byte);
    self.cursor += 1;
  }
}
