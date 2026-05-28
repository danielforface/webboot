use crate::window_manager::WindowNode;

use super::{alloc_bytes, alloc_utf8, boot_kernel, free_alloc, list_apps, lock_kernel};

const EFAULT: i32 = -14;
const ENOENT: i32 = -2;

fn approx_eq(left: f32, right: f32, epsilon: f32) -> bool {
  (left - right).abs() <= epsilon
}

#[test]
fn activity_launch_isolates_on_arena_pressure_instead_of_corrupting_state() {
  let _guard = lock_kernel();
  boot_kernel(128);

  let initial_apps = list_apps(64).len();
  let mut launched = 0_usize;
  let mut last_error = 0;

  for i in 0..1024_u32 {
    let uri = format!("/apps/fuzz-{i}.wasm");
    let (ptr, len) = alloc_utf8(&uri);
    let rc = crate::activity_launch(ptr as usize as *const u8, len, 0);
    free_alloc(ptr, len);

    if rc < 0 {
      last_error = rc;
      break;
    }

    launched += 1;
  }

  assert!(last_error < 0, "launches should eventually fail under fixed arena limits");
  let final_apps = list_apps(2048);
  assert_eq!(
    final_apps.len(),
    initial_apps + launched,
    "kernel should preserve valid app descriptors and reject overflow launches",
  );

  let malformed = crate::activity_launch(core::ptr::null(), 16, 0);
  assert_eq!(malformed, EFAULT);

  crate::reset_kernel_for_tests();
}

#[test]
fn intent_messaging_fuzzing_rejects_invalid_inputs_and_accepts_valid_packets() {
  let _guard = lock_kernel();
  boot_kernel(192);

  let apps = list_apps(64);
  let target = apps
    .iter()
    .find(|app| app.kind == 1)
    .or_else(|| apps.first())
    .expect("boot should provide at least one app")
    .app_id;

  let null_payload_rc = crate::activity_send_intent(target, 1, core::ptr::null(), 32);
  assert_eq!(null_payload_rc, EFAULT);

  let payload = vec![0xA5_u8; 1024 * 64];
  let (payload_ptr, payload_len) = alloc_bytes(&payload);

  let missing_target_rc = crate::activity_send_intent(
    u32::MAX,
    7,
    payload_ptr as usize as *const u8,
    payload_len,
  );
  assert_eq!(missing_target_rc, ENOENT);

  for action in [0_u32, 1, 2, 7, 1024] {
    let rc = crate::activity_send_intent(
      target,
      action,
      payload_ptr as usize as *const u8,
      payload_len,
    );
    assert_eq!(rc, 0, "fuzz action {action} should be handled safely");
  }

  free_alloc(payload_ptr, payload_len);
  crate::reset_kernel_for_tests();
}

#[test]
fn window_set_visuals_updates_snapshot_telemetry_exactly_for_frontend_parser() {
  let _guard = lock_kernel();
  boot_kernel(192);

  let apps = list_apps(64);
  let app_id = apps.first().expect("at least one app must exist").app_id;

  let window_id = crate::window_create(app_id, 0x21);
  assert!(window_id > 0, "window_create should return a valid id");

  let rc = crate::window_set_visuals(window_id as u32, 0.42, 37, 99);
  assert_eq!(rc, 0);

  let mut nodes = vec![WindowNode::default(); 256];
  let count = crate::os_get_render_tree(nodes.as_mut_ptr(), nodes.len() as u32);
  assert!(count > 0, "render tree must contain nodes");

  let node = nodes
    .iter()
    .take(count as usize)
    .find(|node| node.id == window_id as u32)
    .expect("newly created window must appear in snapshot");

  assert!(approx_eq(node.opacity, 0.42, 0.001));
  assert_eq!(node.blur_radius.round() as u32, 37);
  assert_eq!(node.z_order, 99);

  let invalid = crate::window_set_visuals(u32::MAX, 0.1, 1, 1);
  assert_eq!(invalid, ENOENT);

  crate::reset_kernel_for_tests();
}
