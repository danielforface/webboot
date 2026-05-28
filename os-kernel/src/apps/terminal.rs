use std::cmp::min;

const MAX_SCROLLBACK_BYTES: usize = 48 * 1024;

pub struct TerminalState {
  cols: u16,
  rows: u16,
  cursor_x: u16,
  cursor_y: u16,
  sequence: u32,
  scrollback: Vec<u8>,
  input_line: Vec<u8>,
}

impl TerminalState {
  pub fn new() -> Self {
    let mut state = Self {
      cols: 112,
      rows: 34,
      cursor_x: 0,
      cursor_y: 0,
      sequence: 0,
      scrollback: Vec::with_capacity(MAX_SCROLLBACK_BYTES),
      input_line: Vec::with_capacity(256),
    };

    state.write_ansi(b"\x1b[2J\x1b[H");
    state.push_line("Everywhere Nomadic Terminal v0.2");
    state.push_line("Type 'help' for available commands.");
    state.push_prompt();
    state
  }

  pub fn handle_key(&mut self, key_code: u32, _modifiers: u32) {
    match key_code {
      8 | 127 => {
        self.input_line.pop();
      }
      13 => {
        self.commit_line();
      }
      9 => {
        self.input_line.extend_from_slice(b"  ");
      }
      32..=126 => {
        if self.input_line.len() < 512 {
          self.input_line.push(key_code as u8);
        }
      }
      _ => {}
    }

    self.refresh_cursor();
    self.bump_sequence();
  }

  pub fn inject_system_line(&mut self, line: &str) {
    self.push_line(line);
    self.push_prompt();
    self.bump_sequence();
  }

  #[cfg(test)]
  pub fn apply_ansi_for_tests(&mut self, bytes: &[u8]) {
    self.write_ansi(bytes);
    self.refresh_cursor();
    self.bump_sequence();
  }

  pub fn snapshot(&mut self, out: &mut [u8]) -> usize {
    if out.len() < 16 {
      return 0;
    }

    let text = self.compose_text();
    let text_len = min(text.len(), out.len().saturating_sub(16));

    out[0..2].copy_from_slice(&self.cols.to_le_bytes());
    out[2..4].copy_from_slice(&self.rows.to_le_bytes());
    out[4..6].copy_from_slice(&self.cursor_x.to_le_bytes());
    out[6..8].copy_from_slice(&self.cursor_y.to_le_bytes());
    out[8..12].copy_from_slice(&self.sequence.to_le_bytes());
    out[12..16].copy_from_slice(&(text_len as u32).to_le_bytes());
    out[16..16 + text_len].copy_from_slice(&text[..text_len]);

    16 + text_len
  }

  fn compose_text(&self) -> Vec<u8> {
    let mut text = Vec::with_capacity(self.scrollback.len() + self.input_line.len());
    text.extend_from_slice(&self.scrollback);
    text.extend_from_slice(&self.input_line);
    text
  }

  fn commit_line(&mut self) {
    let command = String::from_utf8_lossy(&self.input_line).trim().to_owned();

    self.scrollback.extend_from_slice(&self.input_line);
    self.scrollback.push(b'\n');

    if command.is_empty() {
      self.push_prompt();
      self.input_line.clear();
      self.trim_scrollback();
      return;
    }

    if command == "help" {
      self.push_line("help      show this help");
      self.push_line("apps      list installed apps");
      self.push_line("time      print monotonic shell tick");
      self.push_line("clear     clear terminal screen");
      self.push_line("echo ...  print text");
      self.push_line("about     show runtime profile");
    } else if command == "apps" {
      self.push_line("terminal  status=running");
      self.push_line("editor    status=running");
      self.push_line("settings  status=available");
      self.push_line("launcher  status=available");
    } else if command == "time" {
      self.push_line(&format!("tick={}", self.sequence));
    } else if command == "clear" {
      self.write_ansi(b"\x1b[2J\x1b[H");
      self.push_line("screen cleared");
    } else if command == "about" {
      self.push_line("Everywhere OS terminal uses an in-memory VT facade.");
      self.push_line("Input path: lockless ring -> wasm kernel -> snapshot buffer.");
    } else if let Some(rest) = command.strip_prefix("echo ") {
      self.push_line(rest);
    } else {
      self.push_line(&format!("unknown command: {command}"));
    }

    self.push_prompt();
    self.input_line.clear();
    self.trim_scrollback();
  }

  fn push_prompt(&mut self) {
    self.scrollback.extend_from_slice(b"$ ");
    self.refresh_cursor();
  }

  fn push_line(&mut self, line: &str) {
    self.scrollback.extend_from_slice(line.as_bytes());
    self.scrollback.push(b'\n');
  }

  fn trim_scrollback(&mut self) {
    if self.scrollback.len() <= MAX_SCROLLBACK_BYTES {
      return;
    }

    let drop_bytes = self.scrollback.len() - MAX_SCROLLBACK_BYTES;
    self.scrollback.drain(0..drop_bytes);
  }

  fn refresh_cursor(&mut self) {
    let visible = self.compose_text();
    let mut row = 0_u16;
    let mut col = 0_u16;
    for byte in visible {
      if byte == b'\n' {
        row = row.saturating_add(1);
        col = 0;
      } else {
        col = col.saturating_add(1);
        if col >= self.cols {
          row = row.saturating_add(1);
          col = 0;
        }
      }
    }

    self.cursor_x = col;
    self.cursor_y = row;
  }

  fn bump_sequence(&mut self) {
    self.sequence = self.sequence.wrapping_add(1);
  }

  fn write_ansi(&mut self, bytes: &[u8]) {
    let mut i = 0;
    while i < bytes.len() {
      if bytes[i] == 0x1b && i + 2 < bytes.len() && bytes[i + 1] == b'[' {
        let mut j = i + 2;
        while j < bytes.len() {
          let ch = bytes[j];
          if ch.is_ascii_alphabetic() {
            break;
          }
          j += 1;
        }

        if j >= bytes.len() {
          break;
        }

        let command = bytes[j];
        let params = &bytes[i + 2..j];
        if command == b'J' && params == b"2" {
          self.scrollback.clear();
          self.cursor_x = 0;
          self.cursor_y = 0;
        } else if command == b'H' {
          self.cursor_x = 0;
          self.cursor_y = 0;
        }

        i = j + 1;
        continue;
      }

      self.scrollback.push(bytes[i]);
      i += 1;
    }

    self.trim_scrollback();
  }
}
