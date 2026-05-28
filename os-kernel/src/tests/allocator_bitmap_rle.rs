use std::collections::BTreeSet;
use std::sync::Arc;
use std::thread;

use crate::memory::{
  rle_zero_decode,
  rle_zero_encode,
  DirtyPageBitmap,
  PageArenaAllocator,
  PAGE_SIZE,
};

#[test]
fn page_allocator_exhaustion_and_coalescing_under_fragmentation() {
  let mut allocator = PageArenaAllocator::new(64, 4);

  let a = allocator.allocate_pages(8).expect("allocate a");
  let b = allocator.allocate_pages(8).expect("allocate b");
  let c = allocator.allocate_pages(8).expect("allocate c");

  assert_eq!(a.base_page, 4);
  assert_eq!(b.base_page, 12);
  assert_eq!(c.base_page, 20);

  allocator.release(b);
  allocator.release(a);

  let merged = allocator
    .allocate_pages(15)
    .expect("coalesced allocation should succeed");
  assert_eq!(merged.base_page, 4);
  assert_eq!(merged.page_count, 15);

  allocator.release(merged);
  allocator.release(c);

  let mut allocated = 0_u32;
  while let Some(slice) = allocator.allocate_pages(1) {
    allocated = allocated.saturating_add(slice.page_count);
  }

  assert_eq!(allocated + 4, 64);
}

#[test]
fn dirty_bitmap_marks_expected_pages_without_false_positives() {
  let bitmap = Arc::new(DirtyPageBitmap::new(2048));
  let plans = vec![
    vec![3_u32, 8, 13, 21],
    vec![55_u32, 89, 144, 233],
    vec![377_u32, 610, 987],
    vec![1024_u32, 1300, 1600, 1999],
  ];

  let mut expected = BTreeSet::new();
  for plan in &plans {
    for page in plan {
      expected.insert(*page);
    }
  }

  let mut handles = Vec::with_capacity(plans.len());
  for plan in plans {
    let bitmap = Arc::clone(&bitmap);
    handles.push(thread::spawn(move || {
      for page in plan {
        bitmap.mark_page(page);
      }
    }));
  }

  for handle in handles {
    handle.join().expect("thread join should succeed");
  }

  let mut out = vec![0_u32; 128];
  let count = bitmap.collect_dirty_pages(&mut out);
  let found = out[..count].iter().copied().collect::<BTreeSet<_>>();

  assert_eq!(found, expected);
  assert_eq!(bitmap.count_dirty_pages(), 0);
}

#[test]
fn rle_zero_compaction_matches_expected_signature_and_roundtrip() {
  let input = [0_u8, 0, 0, 1, 2, 0];
  let mut encoded = [0_u8; 32];

  let encoded_len = rle_zero_encode(&input, &mut encoded).expect("encode should succeed");
  assert_eq!(&encoded[..encoded_len], &[0x82, 0x01, 0x01, 0x02, 0x80]);

  let mut decoded = [0_u8; 32];
  let decoded_len =
    rle_zero_decode(&encoded[..encoded_len], &mut decoded).expect("decode should succeed");

  assert_eq!(decoded_len, input.len());
  assert_eq!(&decoded[..decoded_len], &input);
}

#[test]
fn rle_zero_handles_sparse_and_dense_pages() {
  let mut sparse = vec![0_u8; PAGE_SIZE];
  for index in (0..PAGE_SIZE).step_by(997) {
    sparse[index] = (index & 0xff) as u8;
  }

  let dense = vec![0xAB_u8; PAGE_SIZE];

  let mut sparse_encoded = vec![0_u8; PAGE_SIZE * 2];
  let mut dense_encoded = vec![0_u8; PAGE_SIZE * 2];
  let sparse_len = rle_zero_encode(&sparse, &mut sparse_encoded).expect("sparse encode");
  let dense_len = rle_zero_encode(&dense, &mut dense_encoded).expect("dense encode");

  assert!(sparse_len < dense_len, "sparse stream should compress more effectively");

  let mut sparse_decoded = vec![0_u8; PAGE_SIZE];
  let mut dense_decoded = vec![0_u8; PAGE_SIZE];

  let sparse_out =
    rle_zero_decode(&sparse_encoded[..sparse_len], &mut sparse_decoded).expect("sparse decode");
  let dense_out =
    rle_zero_decode(&dense_encoded[..dense_len], &mut dense_decoded).expect("dense decode");

  assert_eq!(sparse_out, PAGE_SIZE);
  assert_eq!(dense_out, PAGE_SIZE);
  assert_eq!(sparse_decoded, sparse);
  assert_eq!(dense_decoded, dense);
}
