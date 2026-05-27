use core::cell::UnsafeCell;
use core::sync::atomic::{AtomicU32, Ordering};

const EAGAIN: i32 = -11;
const INPUT_RING_CAPACITY: usize = 2048;
const ACTIVE_FOCUS_FLAG: u32 = 1 << 0;

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
    }
  }

  pub fn enqueue_event(&self, event: UiEvent) -> Result<(), i32> {
    self.input_ring.push(event)
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
    let Some(window) = self
      .windows
      .iter_mut()
      .find(|window| window.id == self.focused_id)
    else {
      return;
    };

    match event.event_type {
      0 => {
        window.x = event.param_a.clamp(0.0, 2048.0) - window.width * 0.5;
        window.y = event.param_b.clamp(0.0, 2048.0) - 28.0;
      }
      1 => {
        window.flags ^= ACTIVE_FOCUS_FLAG;
        window.opacity = if window.flags & ACTIVE_FOCUS_FLAG != 0 {
          0.95
        } else {
          0.8
        };
      }
      2 => {
        window.blur_radius = (window.blur_radius + event.param_a * 0.05).clamp(0.0, 48.0);
        window.alpha = (window.alpha + event.param_b * 0.002).clamp(0.45, 1.0);
      }
      _ => {}
    }

    window.transform[4] = event.param_a * 0.01;
    window.transform[5] = event.param_b * 0.01;
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
}
