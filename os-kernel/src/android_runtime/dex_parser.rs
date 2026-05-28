pub const DEX_MAGIC_035: [u8; 8] = [0x64, 0x65, 0x78, 0x0a, 0x30, 0x33, 0x35, 0x00];

const EINVAL: i32 = -22;
const EILSEQ: i32 = -84;

#[derive(Debug, Clone)]
pub struct DexHeader {
  pub magic: [u8; 8],
  pub checksum: u32,
  pub signature: [u8; 20],
  pub file_size: u32,
  pub header_size: u32,
  pub endian_tag: u32,
  pub link_size: u32,
  pub link_off: u32,
  pub map_off: u32,
  pub string_ids_size: u32,
  pub string_ids_off: u32,
  pub type_ids_size: u32,
  pub type_ids_off: u32,
  pub proto_ids_size: u32,
  pub proto_ids_off: u32,
  pub field_ids_size: u32,
  pub field_ids_off: u32,
  pub method_ids_size: u32,
  pub method_ids_off: u32,
  pub class_defs_size: u32,
  pub class_defs_off: u32,
}

#[derive(Debug, Clone)]
pub struct DexMetadata {
  pub header: DexHeader,
  pub string_count: u32,
  pub type_count: u32,
  pub method_count: u32,
  pub class_count: u32,
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, i32> {
  let slice = bytes.get(offset..offset + 4).ok_or(EINVAL)?;
  let arr: [u8; 4] = slice.try_into().map_err(|_| EINVAL)?;
  Ok(u32::from_le_bytes(arr))
}

pub fn parse_dex_header(bytes: &[u8]) -> Result<DexHeader, i32> {
  if bytes.len() < 112 {
    return Err(EINVAL);
  }

  let mut magic = [0_u8; 8];
  magic.copy_from_slice(&bytes[0..8]);
  if magic != DEX_MAGIC_035 {
    return Err(EILSEQ);
  }

  let checksum = read_u32(bytes, 8)?;
  let mut signature = [0_u8; 20];
  signature.copy_from_slice(&bytes[12..32]);

  Ok(DexHeader {
    magic,
    checksum,
    signature,
    file_size: read_u32(bytes, 32)?,
    header_size: read_u32(bytes, 36)?,
    endian_tag: read_u32(bytes, 40)?,
    link_size: read_u32(bytes, 44)?,
    link_off: read_u32(bytes, 48)?,
    map_off: read_u32(bytes, 52)?,
    string_ids_size: read_u32(bytes, 56)?,
    string_ids_off: read_u32(bytes, 60)?,
    type_ids_size: read_u32(bytes, 64)?,
    type_ids_off: read_u32(bytes, 68)?,
    proto_ids_size: read_u32(bytes, 72)?,
    proto_ids_off: read_u32(bytes, 76)?,
    field_ids_size: read_u32(bytes, 80)?,
    field_ids_off: read_u32(bytes, 84)?,
    method_ids_size: read_u32(bytes, 88)?,
    method_ids_off: read_u32(bytes, 92)?,
    class_defs_size: read_u32(bytes, 96)?,
    class_defs_off: read_u32(bytes, 100)?,
  })
}

pub fn parse_dex_metadata(bytes: &[u8]) -> Result<DexMetadata, i32> {
  let header = parse_dex_header(bytes)?;

  if header.file_size as usize > bytes.len() {
    return Err(EINVAL);
  }

  if header.header_size < 112 {
    return Err(EINVAL);
  }

  Ok(DexMetadata {
    string_count: header.string_ids_size,
    type_count: header.type_ids_size,
    method_count: header.method_ids_size,
    class_count: header.class_defs_size,
    header,
  })
}
