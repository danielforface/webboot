use crate::vfs::DeltaTrackedVfs;

#[test]
fn vfs_handles_rapid_open_write_close_without_descriptor_leaks() {
  let mut vfs = DeltaTrackedVfs::new();
  vfs.mount("/home").expect("mount should succeed");

  for index in 0..10_000_u32 {
    let path = format!("/home/leak-test-{index}.bin");
    let fd = vfs.open(&path, 4096).expect("open should succeed");

    vfs.track_write(fd, 0, 4096).expect("write tracking should succeed");
    vfs
      .track_write(fd, 4096 * 3, 4096)
      .expect("second write tracking should succeed");

    vfs.close(fd).expect("close should succeed");
  }

  assert_eq!(vfs.handle_count(), 0, "all file handles must be released");
  assert_eq!(
    vfs.pending_delta_blocks(),
    0,
    "closing every descriptor must clear pending tracked deltas",
  );
}
