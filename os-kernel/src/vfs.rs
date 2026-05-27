use std::collections::BTreeMap;

const EEXIST: i32 = -17;
const EINVAL: i32 = -22;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum DriverClass {
  Device,
  System,
  Storage,
  Graphics,
  Network,
}

#[derive(Debug, Clone)]
pub struct MountPoint {
  pub path: String,
  pub class: DriverClass,
  pub fd: Option<u32>,
}

pub struct Vfs {
  mounts: BTreeMap<String, MountPoint>,
}

impl Vfs {
  pub fn new() -> Self {
    Self {
      mounts: BTreeMap::new(),
    }
  }

  pub fn mount(&mut self, path: &str, class: DriverClass) -> Result<(), i32> {
    if !path.starts_with('/') {
      return Err(EINVAL);
    }

    if self.mounts.contains_key(path) {
      return Err(EEXIST);
    }

    self.mounts.insert(
      path.to_owned(),
      MountPoint {
        path: path.to_owned(),
        class,
        fd: None,
      },
    );

    Ok(())
  }

  pub fn attach_fd(&mut self, path: &str, fd: u32) -> Result<(), i32> {
    if !path.starts_with('/') {
      return Err(EINVAL);
    }

    if let Some(node) = self.mounts.get_mut(path) {
      node.fd = Some(fd);
      return Ok(());
    }

    self.mounts.insert(
      path.to_owned(),
      MountPoint {
        path: path.to_owned(),
        class: DriverClass::Storage,
        fd: Some(fd),
      },
    );

    Ok(())
  }

  pub fn resolve_fd(&self, path: &str) -> Option<u32> {
    self.mounts.get(path).and_then(|node| node.fd)
  }

  pub fn mount_count(&self) -> usize {
    self.mounts.len()
  }
}
