use super::DalvikIntent;

fn push_u16(buffer: &mut Vec<u8>, value: u16) {
  buffer.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(buffer: &mut Vec<u8>, value: u32) {
  buffer.extend_from_slice(&value.to_le_bytes());
}

fn push_str(buffer: &mut Vec<u8>, value: &str) {
  let bytes = value.as_bytes();
  let bounded = bytes.len().min(u16::MAX as usize);
  push_u16(buffer, bounded as u16);
  buffer.extend_from_slice(&bytes[..bounded]);
}

pub fn translate_intent_to_packet(
  sequence: u32,
  target_app_id: u32,
  intent: &DalvikIntent,
) -> Vec<u8> {
  let mut packet = Vec::with_capacity(128);
  packet.extend_from_slice(b"BNDR");
  push_u32(&mut packet, sequence);
  push_u32(&mut packet, target_app_id);
  push_u16(&mut packet, intent.categories.len().min(u16::MAX as usize) as u16);

  push_str(&mut packet, &intent.action);
  push_str(&mut packet, &intent.data_uri);
  push_str(&mut packet, &intent.comp_package);
  push_str(&mut packet, &intent.comp_class);

  for category in &intent.categories {
    push_str(&mut packet, category);
  }

  packet
}
