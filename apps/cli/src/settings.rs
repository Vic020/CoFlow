use crate::{Failure, Result};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

pub fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

pub fn dir() -> Result<PathBuf> {
    let home = if cfg!(windows) {
        env::var_os("USERPROFILE").or_else(|| env::var_os("HOME"))
    } else {
        env::var_os("HOME")
    };
    home.map(|home| PathBuf::from(home).join(".config/coflow/cli"))
        .ok_or_else(|| Failure::new("CREDENTIAL_STORAGE", "Could not find the home directory."))
}

pub fn binding() -> Result<PathBuf> {
    Ok(dir()?.join(format!(
        "{}.binding",
        hash(&env::current_dir()?.to_string_lossy())
    )))
}

pub fn read(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(raw) => Ok(Some(raw)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub fn remove(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub fn private(path: &Path, directory: bool) -> Result<()> {
    let meta = fs::symlink_metadata(path)?;
    let valid_type = if directory {
        meta.is_dir()
    } else {
        meta.is_file()
    };
    #[cfg(unix)]
    let safe_mode = {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o077 == 0
    };
    #[cfg(not(unix))]
    let safe_mode = true;
    if !valid_type || !safe_mode {
        return Err(Failure::new(
            "CREDENTIAL_STORAGE",
            "The CLI credential path is not private.",
        ));
    }
    Ok(())
}

pub fn write(path: &Path, value: &str, exclusive: bool) -> Result<()> {
    let parent = path.parent().expect("settings directory");
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(parent)?;
    private(parent, true)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    writeln!(file, "{value}")?;
    file.as_file().sync_all()?;
    if exclusive {
        file.persist_noclobber(path)
            .map_err(|failure| failure.error)?;
    } else {
        file.persist(path).map_err(|failure| failure.error)?;
    }
    Ok(())
}
