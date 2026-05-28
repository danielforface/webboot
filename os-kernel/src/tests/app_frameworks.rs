use crate::apps::editor::EditorState;
use crate::apps::media_pipeline::MediaPipelineState;
use crate::apps::terminal::TerminalState;

use super::{alloc_bytes, alloc_utf8, boot_kernel, free_alloc, list_apps, lock_kernel};

#[test]
fn core_terminal_parses_vt100_escape_sequences_and_updates_snapshot() {
  let mut terminal = TerminalState::new();
  terminal.apply_ansi_for_tests(b"\x1b[2J\x1b[HHELLO\nWORLD");

  let mut snapshot = vec![0_u8; 4096];
  let bytes = terminal.snapshot(&mut snapshot);
  assert!(bytes > 16);

  let text_len = u32::from_le_bytes(snapshot[12..16].try_into().expect("text length")) as usize;
  let text = core::str::from_utf8(&snapshot[16..16 + text_len]).expect("utf8 snapshot text");
  assert!(text.contains("HELLO"));
  assert!(text.contains("WORLD"));
}

#[test]
fn spatial_editor_handles_heavy_copy_paste_payloads_without_state_loss() {
  let mut editor = EditorState::new();

  let payload = "let x = 42;\n".repeat(4096);
  for byte in payload.bytes() {
    editor.handle_key(byte as u32, 0);
  }

  let mut snapshot = vec![0_u8; 256 * 1024];
  let bytes = editor.snapshot(&mut snapshot);
  assert!(bytes > 16);

  let text_len = u32::from_le_bytes(snapshot[8..12].try_into().expect("text len")) as usize;
  assert!(text_len >= payload.len());

  let text = core::str::from_utf8(&snapshot[16..16 + text_len]).expect("editor text utf8");
  assert!(text.contains("let x = 42;"));
  assert!(text.ends_with("let x = 42;\n"));
}

#[test]
fn spatial_editor_payload_syncs_to_vfs_without_loss() {
  let _guard = lock_kernel();
  boot_kernel(224);

  let (path_ptr, path_len) = alloc_utf8("/home/editor-heavy.txt");
  let fd = crate::fs_open(path_ptr as usize as *const u8, path_len, 0x3);
  free_alloc(path_ptr, path_len);
  assert!(fd > 0, "fs_open should return a descriptor");

  let payload = "fn sync() { return 1; }\n".repeat(4096).into_bytes();
  let (src_ptr, src_len) = alloc_bytes(&payload);
  let write_rc = crate::fs_write_async(fd as u32, 0, src_ptr as usize as *const u8, src_len);
  free_alloc(src_ptr, src_len);
  assert_eq!(write_rc, src_len as i32);

  let dst_ptr = crate::os_alloc(src_len);
  assert_ne!(dst_ptr, 0);
  let read_rc = crate::fs_read_async(fd as u32, 0, dst_ptr as usize as *mut u8, src_len);
  assert_eq!(read_rc, src_len as i32);

  let restored = unsafe { std::slice::from_raw_parts(dst_ptr as usize as *const u8, src_len as usize) };
  assert_eq!(restored, payload.as_slice());
  crate::os_free(dst_ptr, src_len);

  crate::reset_kernel_for_tests();
}

#[test]
fn mime_intent_routing_from_explorer_launches_photo_viewer_component() {
  let _guard = lock_kernel();
  boot_kernel(224);

  let (explorer_uri_ptr, explorer_uri_len) = alloc_utf8("/apps/files.wasm");
  let launch_rc = crate::activity_launch(
    explorer_uri_ptr as usize as *const u8,
    explorer_uri_len,
    5,
  );
  free_alloc(explorer_uri_ptr, explorer_uri_len);
  assert!(launch_rc > 0, "explorer launch should succeed");

  let apps = list_apps(64);
  let explorer_id = apps
    .iter()
    .find(|app| app.kind == 5)
    .map(|app| app.app_id)
    .expect("app id must exist");

  let before = list_apps(128)
    .iter()
    .filter(|app| app.kind == 6)
    .count();

  let (ptr, len) = alloc_utf8("/home/media/photo-001.png");
  let rc = crate::activity_send_intent(explorer_id, 0x5048_4f54, ptr as usize as *const u8, len);
  free_alloc(ptr, len);
  assert_eq!(rc, 0);

  let after = list_apps(128)
    .iter()
    .filter(|app| app.kind == 6)
    .count();

  assert!(after >= before + 1, "photo viewer app should be launched by mime intent route");
  crate::reset_kernel_for_tests();
}

#[test]
fn media_pipeline_keeps_audio_chunk_sequence_contiguous_under_load() {
  let mut media = MediaPipelineState::new();
  let stream_id = media.stream_open(1, 48_000, 2);

  let mut expected_total = 0_u64;
  for i in 0..20_000_u32 {
    let chunk = (i % 1024) + 1;
    media
      .push_pcm(stream_id, chunk)
      .expect("push pcm should succeed for open stream");
    expected_total = expected_total.saturating_add(chunk as u64);
  }

  assert_eq!(media.total_pcm_samples(), expected_total);

  let mut snapshot = vec![0_u8; 4096];
  let bytes = media.snapshot(&mut snapshot);
  assert!(bytes >= 20);

  let stream_count = u32::from_le_bytes(snapshot[4..8].try_into().expect("stream count"));
  let total_low = u32::from_le_bytes(snapshot[8..12].try_into().expect("total low"));
  let total_high = u32::from_le_bytes(snapshot[12..16].try_into().expect("total high"));
  let total = (u64::from(total_high) << 32) | u64::from(total_low);

  assert_eq!(stream_count, 1);
  assert_eq!(total, expected_total);
}
