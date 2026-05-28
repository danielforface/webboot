use core::cell::UnsafeCell;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

const VIRTUAL_WIDTH: f32 = 1920.0;
const VIRTUAL_HEIGHT: f32 = 1080.0;
const HEADER_DRAG_HEIGHT: f32 = 32.0;

const EAGAIN: i32 = -11;
const INPUT_RING_CAPACITY: usize = 2048;

const ACTIVE_FOCUS_FLAG: u32 = 1 << 0;
const WINDOW_FLAG_HIDDEN: u32 = 1 << 1;
const WINDOW_FLAG_MAXIMIZED: u32 = 1 << 2;

const WINDOW_EVT_POINTER_DOWN: u32 = 64;
const WINDOW_EVT_POINTER_MOVE: u32 = 65;
const WINDOW_EVT_POINTER_UP: u32 = 66;
const WINDOW_EVT_WHEEL: u32 = 67;
const WINDOW_EVT_CLOSE: u32 = 68;
const WINDOW_EVT_TOGGLE_MAXIMIZE: u32 = 69;
const WINDOW_EVT_MINIMIZE: u32 = 70;

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct UiEvent {
  pub event_type: u32,
  pub param_a: f32,
  pub param_b: f32,
  pub modifier_flags: u32,
  pub timestamp_ns: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct WindowNode {
  pub id: u32,
  pub x: f32,
  pub y: f32,
  pub width: f32,
  pub height: f32,
  pub z_order: u32,
  pub flags: u32,
  pub opacity: f32,
  pub alpha: f32,
  pub blur_radius: f32,
  pub transform: [f32; 6],
}

pub struct EventRing {
  capacity: u32,
  head: AtomicU32,
  tail: AtomicU32,
  dropped: AtomicU32,
  slots: Vec<UnsafeCell<UiEvent>>,
}

unsafe impl Send for EventRing {}
unsafe impl Sync for EventRing {}

impl EventRing {
  pub fn new(capacity: usize) -> Self {
    let safe_capacity = capacity.max(2).next_power_of_two();
    let mut slots = Vec::with_capacity(safe_capacity);
    for _ in 0..safe_capacity {
      slots.push(UnsafeCell::new(UiEvent::default()));
    }

    Self {
      capacity: safe_capacity as u32,
      head: AtomicU32::new(0),
      tail: AtomicU32::new(0),
      dropped: AtomicU32::new(0),
      slots,
    }
  }

  pub fn push(&self, event: UiEvent) -> Result<(), i32> {
    let head = self.head.load(Ordering::Relaxed);
    let tail = self.tail.load(Ordering::Acquire);
    if head.wrapping_sub(tail) >= self.capacity {
      self.dropped.fetch_add(1, Ordering::Relaxed);
      return Err(EAGAIN);
    }

    let slot = (head & (self.capacity - 1)) as usize;
    unsafe {
      *self.slots[slot].get() = event;
    }
    self.head.store(head.wrapping_add(1), Ordering::Release);
    Ok(())
  }

  pub fn pop(&self) -> Option<UiEvent> {
    let tail = self.tail.load(Ordering::Relaxed);
    let head = self.head.load(Ordering::Acquire);
    if tail == head {
      return None;
    }

    let slot = (tail & (self.capacity - 1)) as usize;
    let event = unsafe { *self.slots[slot].get() };
    self.tail.store(tail.wrapping_add(1), Ordering::Release);
    Some(event)
  }

  pub fn pending(&self) -> u32 {
    self
      .head
      .load(Ordering::Acquire)
      .wrapping_sub(self.tail.load(Ordering::Acquire))
  }

  pub fn dropped(&self) -> u32 {
    self.dropped.load(Ordering::Acquire)
  }
}

pub struct WindowManager {
  windows: Vec<WindowNode>,
  input_ring: EventRing,
  focused_id: u32,
  is_dragging: AtomicBool,
  drag_window_id: u32,
  drag_offset_x: f32,
  drag_offset_y: f32,
  restore_bounds: Vec<WindowRestoreBounds>,
  close_requests: Vec<u32>,
}

#[derive(Clone, Copy)]
struct WindowRestoreBounds {
  window_id: u32,
  x: f32,
  y: f32,
  width: f32,
  height: f32,
}

impl WindowManager {
  pub fn new() -> Self {
    Self {
      windows: vec![
        WindowNode {
          id: 1,
          x: 72.0,
          y: 84.0,
          width: 780.0,
          height: 460.0,
          z_order: 2,
          flags: ACTIVE_FOCUS_FLAG,
          opacity: 0.92,
          alpha: 0.9,
          blur_radius: 18.0,
          transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        },
        WindowNode {
          id: 2,
          x: 920.0,
          y: 120.0,
          width: 360.0,
          height: 320.0,
          z_order: 3,
          flags: 0,
          opacity: 0.84,
          alpha: 0.82,
          blur_radius: 26.0,
          transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        },
      ],
      input_ring: EventRing::new(INPUT_RING_CAPACITY),
      focused_id: 1,
      is_dragging: AtomicBool::new(false),
      drag_window_id: 0,
      drag_offset_x: 0.0,
      drag_offset_y: 0.0,
      restore_bounds: Vec::new(),
      close_requests: Vec::new(),
    }
  }

  pub fn enqueue_event(&self, event: UiEvent) -> Result<(), i32> {
    self.input_ring.push(event)
  }

  pub fn spawn_window(&mut self, window_id: u32, profile: u32) -> u32 {
    if let Some(existing) = self.windows.iter().find(|window| window.id == window_id) {
      return existing.id;
    }

    let idx = self.windows.len() as f32;
    let x = 120.0 + (idx % 4.0) * 120.0;
    let y = 88.0 + (idx % 3.0) * 76.0;
    let width = if profile == 2 { 900.0 } else { 640.0 };
    let height = if profile == 2 { 520.0 } else { 380.0 };
    let z = self
      .windows
      .iter()
      .map(|window| window.z_order)
      .max()
      .unwrap_or(1)
      + 1;

    self.clear_focus_flags();
    self.focused_id = window_id;
    self.windows.push(WindowNode {
      id: window_id,
      x,
      y,
      width,
      height,
      z_order: z,
      flags: ACTIVE_FOCUS_FLAG,
      opacity: 0.9,
      alpha: 0.88,
      blur_radius: 22.0,
      transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    });

    self.sort_windows_by_z();

    window_id
  }

  pub fn has_window(&self, window_id: u32) -> bool {
    self.windows.iter().any(|window| window.id == window_id)
  }

  pub fn close_window(&mut self, window_id: u32) -> bool {
    let Some(index) = self.windows.iter().position(|window| window.id == window_id) else {
      return false;
    };

    self.windows.remove(index);
    self
      .restore_bounds
      .retain(|entry| entry.window_id != window_id);

    if self.drag_window_id == window_id {
      self.drag_window_id = 0;
      self.is_dragging.store(false, Ordering::Release);
    }

    if self.windows.is_empty() {
      self.focused_id = 0;
      return true;
    }

    if self.focused_id == window_id {
      if let Some(next) = self.top_visible_window_id() {
        self.focused_id = next;
      } else {
        self.focused_id = self.windows[0].id;
      }
    }

    self.sync_focus_flags();
    self.sort_windows_by_z();

    true
  }

  pub fn set_visuals(&mut self, window_id: u32, opacity: f32, blur_radius: u32, depth_z: u32) -> bool {
    let Some(window) = self.windows.iter_mut().find(|window| window.id == window_id) else {
      return false;
    };

    window.opacity = opacity.clamp(0.0, 1.0);
    window.alpha = (opacity * 0.94 + 0.05).clamp(0.1, 1.0);
    window.blur_radius = (blur_radius as f32).clamp(0.0, 56.0);
    window.z_order = depth_z.max(1);
    self.sort_windows_by_z();
    true
  }

  pub fn focus_window(&mut self, window_id: u32) {
    let Some(target) = self.windows.iter().find(|window| window.id == window_id) else {
      return;
    };

    if target.flags & WINDOW_FLAG_HIDDEN != 0 {
      return;
    }

    self.focused_id = window_id;
    let max_z = self
      .windows
      .iter()
      .map(|window| window.z_order)
      .max()
      .unwrap_or(1)
      + 1;

    for window in &mut self.windows {
      if window.id == window_id {
        window.flags |= ACTIVE_FOCUS_FLAG;
        window.opacity = 0.96;
        window.z_order = max_z;
      } else {
        window.flags &= !ACTIVE_FOCUS_FLAG;
        if window.flags & WINDOW_FLAG_HIDDEN == 0 {
          window.opacity = 0.78;
        }
      }
    }

    self.sort_windows_by_z();
  }

  pub fn process_events(&mut self, budget: u32) -> u32 {
    let mut processed = 0_u32;
    while processed < budget {
      let Some(event) = self.input_ring.pop() else {
        break;
      };

      self.apply_event(event);
      processed = processed.wrapping_add(1);
    }

    processed
  }

  fn apply_event(&mut self, event: UiEvent) {
    match event.event_type {
      WINDOW_EVT_POINTER_DOWN => self.handle_pointer_down(event.param_a, event.param_b, event.modifier_flags),
      WINDOW_EVT_POINTER_MOVE => self.handle_pointer_move(event.param_a, event.param_b),
      WINDOW_EVT_POINTER_UP => self.handle_pointer_up(),
      WINDOW_EVT_WHEEL => self.handle_wheel(event.param_a, event.param_b),
      WINDOW_EVT_CLOSE => {
        let hinted = (event.modifier_flags >> 16) & 0xffff;
        let window_id = if hinted != 0 {
          hinted
        } else {
          event.param_a.max(0.0).round() as u32
        };
        self.request_close(window_id);
      }
      WINDOW_EVT_TOGGLE_MAXIMIZE => {
        let hinted = (event.modifier_flags >> 16) & 0xffff;
        let window_id = if hinted != 0 {
          hinted
        } else {
          event.param_a.max(0.0).round() as u32
        };
        self.toggle_maximize(window_id);
      }
      WINDOW_EVT_MINIMIZE => {
        let hinted = (event.modifier_flags >> 16) & 0xffff;
        let window_id = if hinted != 0 {
          hinted
        } else {
          event.param_a.max(0.0).round() as u32
        };
        self.minimize_window(window_id);
      }
      _ => {}
    }
  }

  fn handle_pointer_down(&mut self, x: f32, y: f32, modifier_flags: u32) {
    let hinted_window = (modifier_flags >> 16) & 0xffff;
    let target_id = if hinted_window != 0 && self.has_window(hinted_window) {
      hinted_window
    } else {
      let Some(window) = self.top_window_at(x, y) else {
        self.handle_pointer_up();
        return;
      };
      window.id
    };

    self.focus_window(target_id);

    let Some(window) = self.windows.iter().find(|window| window.id == target_id) else {
      self.handle_pointer_up();
      return;
    };

    if window.flags & WINDOW_FLAG_HIDDEN != 0 || window.flags & WINDOW_FLAG_MAXIMIZED != 0 {
      self.handle_pointer_up();
      return;
    }

    let local_y = y - window.y;
    let in_header = local_y >= 0.0 && local_y <= HEADER_DRAG_HEIGHT;
    if !in_header {
      self.handle_pointer_up();
      return;
    }

    self.drag_window_id = target_id;
    self.drag_offset_x = (x - window.x).clamp(0.0, window.width.max(1.0));
    self.drag_offset_y = local_y.clamp(0.0, HEADER_DRAG_HEIGHT);
    self.is_dragging.store(true, Ordering::Release);
  }

  fn handle_pointer_move(&mut self, x: f32, y: f32) {
    if !self.is_dragging.load(Ordering::Acquire) {
      return;
    }

    let drag_window_id = self.drag_window_id;
    if drag_window_id == 0 {
      self.is_dragging.store(false, Ordering::Release);
      return;
    }

    let Some(window) = self
      .windows
      .iter_mut()
      .find(|window| window.id == drag_window_id)
    else {
      self.is_dragging.store(false, Ordering::Release);
      self.drag_window_id = 0;
      return;
    };

    if window.flags & WINDOW_FLAG_HIDDEN != 0 || window.flags & WINDOW_FLAG_MAXIMIZED != 0 {
      self.is_dragging.store(false, Ordering::Release);
      self.drag_window_id = 0;
      return;
    }

    let max_x = (VIRTUAL_WIDTH - window.width).max(0.0);
    let max_y = (VIRTUAL_HEIGHT - window.height).max(0.0);
    window.x = (x - self.drag_offset_x).clamp(0.0, max_x);
    window.y = (y - self.drag_offset_y).clamp(0.0, max_y);
    window.transform[4] = 0.0;
    window.transform[5] = 0.0;
  }

  fn handle_pointer_up(&mut self) {
    self.is_dragging.store(false, Ordering::Release);
    self.drag_window_id = 0;
    self.drag_offset_x = 0.0;
    self.drag_offset_y = 0.0;
  }

  fn handle_wheel(&mut self, delta_x: f32, delta_y: f32) {
    let Some(window) = self
      .windows
      .iter_mut()
      .find(|window| window.id == self.focused_id)
    else {
      return;
    };

    if window.flags & WINDOW_FLAG_HIDDEN != 0 {
      window.flags &= !WINDOW_FLAG_HIDDEN;
      window.opacity = 0.9;
    }

    window.blur_radius = (window.blur_radius + delta_x * 0.05).clamp(0.0, 48.0);
    window.alpha = (window.alpha + delta_y * 0.002).clamp(0.45, 1.0);
  }

  fn request_close(&mut self, window_id: u32) {
    if window_id == 0 || !self.has_window(window_id) {
      return;
    }

    if !self.close_requests.contains(&window_id) {
      self.close_requests.push(window_id);
    }
  }

  fn toggle_maximize(&mut self, window_id: u32) {
    let Some(window) = self
      .windows
      .iter_mut()
      .find(|window| window.id == window_id)
    else {
      return;
    };

    if window.flags & WINDOW_FLAG_HIDDEN != 0 {
      return;
    }

    if window.flags & WINDOW_FLAG_MAXIMIZED != 0 {
      if let Some(index) = self
        .restore_bounds
        .iter()
        .position(|entry| entry.window_id == window_id)
      {
        let restore = self.restore_bounds.swap_remove(index);
        window.x = restore.x;
        window.y = restore.y;
        window.width = restore.width;
        window.height = restore.height;
      }

      window.flags &= !WINDOW_FLAG_MAXIMIZED;
      window.transform[4] = 0.0;
      window.transform[5] = 0.0;
      return;
    }

    self
      .restore_bounds
      .retain(|entry| entry.window_id != window_id);
    self.restore_bounds.push(WindowRestoreBounds {
      window_id,
      x: window.x,
      y: window.y,
      width: window.width,
      height: window.height,
    });

    window.x = 0.0;
    window.y = 0.0;
    window.width = VIRTUAL_WIDTH;
    window.height = VIRTUAL_HEIGHT;
    window.flags |= WINDOW_FLAG_MAXIMIZED;
    window.flags &= !WINDOW_FLAG_HIDDEN;
    window.transform[4] = 0.0;
    window.transform[5] = 0.0;
  }

  fn minimize_window(&mut self, window_id: u32) {
    let Some(window) = self
      .windows
      .iter_mut()
      .find(|window| window.id == window_id)
    else {
      return;
    };

    window.flags |= WINDOW_FLAG_HIDDEN;
    window.flags &= !ACTIVE_FOCUS_FLAG;
    window.opacity = 0.0;

    if self.focused_id == window_id {
      self.focused_id = self.top_visible_window_id().unwrap_or(0);
      self.sync_focus_flags();
    }

    if self.drag_window_id == window_id {
      self.handle_pointer_up();
    }
  }

  fn top_window_at(&self, x: f32, y: f32) -> Option<&WindowNode> {
    self
      .windows
      .iter()
      .filter(|window| {
        window.flags & WINDOW_FLAG_HIDDEN == 0
          && x >= window.x
          && y >= window.y
          && x <= window.x + window.width
          && y <= window.y + window.height
      })
      .max_by_key(|window| window.z_order)
  }

  fn top_visible_window_id(&self) -> Option<u32> {
    self
      .windows
      .iter()
      .filter(|window| window.flags & WINDOW_FLAG_HIDDEN == 0)
      .max_by_key(|window| window.z_order)
      .map(|window| window.id)
  }

  fn clear_focus_flags(&mut self) {
    for window in &mut self.windows {
      window.flags &= !ACTIVE_FOCUS_FLAG;
    }
  }

  fn sync_focus_flags(&mut self) {
    for window in &mut self.windows {
      if window.id == self.focused_id && window.flags & WINDOW_FLAG_HIDDEN == 0 {
        window.flags |= ACTIVE_FOCUS_FLAG;
      } else {
        window.flags &= !ACTIVE_FOCUS_FLAG;
      }
    }
  }

  fn sort_windows_by_z(&mut self) {
    self
      .windows
      .sort_by(|left, right| left.z_order.cmp(&right.z_order));
  }

  pub fn snapshot(&self, out: &mut [WindowNode]) -> usize {
    let count = out.len().min(self.windows.len());
    out[..count].copy_from_slice(&self.windows[..count]);
    count
  }

  pub fn pending_input(&self) -> u32 {
    self.input_ring.pending()
  }

  pub fn dropped_input(&self) -> u32 {
    self.input_ring.dropped()
  }

  pub fn window_count(&self) -> u32 {
    self.windows.len() as u32
  }

  pub fn take_close_requests(&mut self) -> Vec<u32> {
    let mut out = Vec::with_capacity(self.close_requests.len());
    out.extend(self.close_requests.drain(..));
    out
  }
}
