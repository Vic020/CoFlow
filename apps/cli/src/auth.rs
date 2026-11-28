use crate::{
    arg, client::Client, env_value, identity, secure, settings, valid_url, Args, Failure, Result,
};
use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use std::{
    fs, io,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

const READ_SCOPES: &str = "reports:read todos:read calendar:read context:read";
const GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";
#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "com.coflow.cli.device";

pub struct Saved {
    pub data: Value,
    path: PathBuf,
}
pub fn handles(name: &str) -> bool {
    matches!(
        name,
        "auth login" | "auth grant" | "auth status" | "auth logout" | "space list" | "space use"
    )
}
fn fields(value: &Value) -> Value {
    let mut output = json!({});
    for key in [
        "user_id",
        "team_id",
        "scope",
        "expires_at",
        "grant_id",
        "project_id",
        "todo_id",
    ] {
        if let Some(value) = value.get(key) {
            output[key] = value.clone();
        }
    }
    output
}
fn path(server: &str, space: Option<&str>, suffix: &str) -> Result<PathBuf> {
    let key = settings::hash(server);
    let name = match space.filter(|s| !s.is_empty()) {
        Some(space) => format!("{key}.{}.{suffix}", settings::hash(space)),
        None => format!("{key}.{suffix}"),
    };
    Ok(settings::dir()?.join(name))
}
fn opaque(value: &Value, prefix: &str) -> bool {
    value
        .as_str()
        .and_then(|raw| raw.strip_prefix(prefix))
        .is_some_and(|raw| {
            raw.len() == 43
                && raw
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        })
}
fn selection(server: &str) -> Result<Option<String>> {
    Ok(settings::read(&path(server, None, "space")?)?
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty()))
}
fn read(path: PathBuf, metadata_only: bool) -> Result<Option<Saved>> {
    match fs::symlink_metadata(&path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
        Ok(_) => settings::private(&path, false)?,
    }
    let invalid = || Failure::new("CREDENTIAL_STORAGE", "The saved CLI login file is invalid.");
    let raw = settings::read(&path)?.ok_or_else(invalid)?;
    let mut data: Value = serde_json::from_str(&raw).map_err(|_| invalid())?;
    let keychain = data["storage"] == "keychain";
    if keychain && !metadata_only {
        data["token"] = json!(keychain_read(&path)?);
    }
    if !(opaque(&data["token"], "cf_cli_") || metadata_only && keychain)
        || !nonempty(&data["user_id"])
        || !nonempty(&data["team_id"])
        || data["expires_at"]
            .as_str()
            .is_none_or(|v| chrono::DateTime::parse_from_rfc3339(v).is_err())
    {
        return Err(invalid());
    }
    Ok(Some(Saved { data, path }))
}
pub fn load(server: &str, space: Option<&str>) -> Result<Option<Saved>> {
    let default = selection(server)?;
    let team = space.or(default.as_deref());
    let mut found = read(path(server, team, "json")?, false)?;
    if found.is_none() && space.is_some() {
        found = read(path(server, None, "json")?, false)?
            .filter(|item| item.data["team_id"].as_str() == team);
    }
    if found
        .as_ref()
        .is_some_and(|item| team.is_some_and(|team| item.data["team_id"] != team))
    {
        return Err(Failure::new(
            "IDENTITY_MISMATCH",
            "Saved login does not match the selected space.",
        ));
    }
    Ok(found)
}
fn nonempty(value: &Value) -> bool {
    value.as_str().is_some_and(|s| !s.is_empty())
}
fn revoke(api: &Client, token: &str) -> Result<()> {
    match api.request("POST", "/cli/revoke", Some(token), Some(&json!({}))) {
        Ok(_) => Ok(()),
        Err(error) if error.status == Some(401) => Ok(()),
        Err(error) => Err(error),
    }
}
fn status(server: &str, item: Option<&Saved>) -> Value {
    let mut result = item
        .map(|item| fields(&item.data))
        .unwrap_or_else(|| json!({}));
    result["logged_in"] = json!(item.is_some());
    result["server"] = json!(server);
    result
}
fn list(server: &str) -> Result<Value> {
    let key = settings::hash(server);
    let selected = selection(server)?;
    let entries = match fs::read_dir(settings::dir()?) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(json!({"server":server,"current_space":null,"items":[]}))
        }
        Err(error) => return Err(error.into()),
    };
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(stem) = name
            .strip_prefix(&key)
            .and_then(|name| name.strip_suffix(".json"))
        else {
            continue;
        };
        if stem.is_empty()
            || stem
                .strip_prefix('.')
                .is_some_and(|hash| hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            files.push((stem.is_empty(), entry.path()));
        }
    }
    files.sort();
    let mut items = Vec::new();
    let mut current = Value::Null;
    for (legacy, path) in files {
        if let Some(item) = read(path, true)? {
            if selected
                .as_deref()
                .map_or(legacy, |team| item.data["team_id"] == team)
            {
                current = item.data["team_id"].clone();
            }
            items.push(fields(&item.data));
        }
    }
    Ok(json!({"server":server,"current_space":current,"items":items}))
}

pub fn run(api: &Client, args: &Args, non_interactive: bool) -> Result<Value> {
    let space = arg(args, "--space");
    let server = api.server;
    match api.name {
        "space list" => list(server),
        "auth login" | "auth grant" => login(api, args, non_interactive),
        "space use" | "auth status" | "auth logout" => {
            let saved = load(server, space)?;
            let Some(item) = saved else {
                if api.name == "space use" {
                    return Err(Failure::new(
                        "SPACE_NOT_LOGGED_IN",
                        "No CLI login is saved for this space.",
                    ));
                }
                return Ok(status(server, None));
            };
            let token = item.data["token"].as_str().expect("validated token");
            if api.name == "auth logout" {
                revoke(api, token)?;
                if read(item.path.clone(), false)?
                    .is_some_and(|current| current.data["token"] == token)
                {
                    if item.data["storage"] == "keychain" {
                        keychain_delete(&item.path)?;
                    }
                    settings::remove(&item.path)?;
                }
                return Ok(status(server, None));
            }
            let meta = api.get("/meta", Some(token))?;
            identity(
                &meta,
                item.data["team_id"].as_str(),
                item.data["user_id"].as_str(),
            )?;
            if api.name == "space use" {
                let space = space.expect("required flag");
                identity(
                    &meta,
                    Some(space),
                    env_value("COFLOW_EXPECT_USER").as_deref(),
                )?;
                settings::write(&path(server, None, "space")?, space, false)?;
                return Ok(json!({"server":server,"current_space":space}));
            }
            Ok(status(server, Some(&item)))
        }
        _ => unreachable!(),
    }
}

fn login(api: &Client, args: &Args, non_interactive: bool) -> Result<Value> {
    if non_interactive {
        return Err(Failure::new(
            "BROWSER_CONFIRMATION_REQUIRED",
            "A person must approve this login in a browser.",
        )
        .hint("Run coflow auth login in a private terminal."));
    }
    let space = arg(args, "--space");
    let file = path(api.server, space, "json")?;
    if read(file.clone(), true)?.is_some() {
        return Err(Failure::new(
            "ALREADY_LOGGED_IN",
            "A browser login is already saved for this server.",
        )
        .hint("Run coflow auth logout before starting another login."));
    }
    let grant = api.name == "auth grant";
    let todo = arg(args, "--todo").unwrap_or("");
    let project = arg(args, "--project").unwrap_or("");
    if grant && (todo.is_empty() == project.is_empty()) {
        return Err(Failure::new(
            "MISSING_SCOPE",
            "Choose exactly one task or project.",
        ));
    }
    let days = arg(args, "--days").unwrap_or(if grant { "1" } else { "7" });
    if !days
        .parse::<u8>()
        .is_ok_and(|v| (1..=30).contains(&v) && v.to_string() == days)
    {
        return Err(Failure::new(
            "INVALID_FLAG",
            "--days must be between 1 and 30.",
        ));
    }
    if api.get("/health", None)?["mode"] != "team" {
        return Err(Failure::new(
            "WRONG_SERVER_MODE",
            "CLI login needs a CoFlow team server.",
        ));
    }
    let team_env = env_value("COFLOW_EXPECT_TEAM");
    let team = space.or(team_env.as_deref());
    let started = api.form(
        "/oauth/device",
        &[
            ("client_id", "coflow-cli"),
            ("days", days),
            ("name", arg(args, "--name").unwrap_or("CoFlow CLI")),
            (
                "scope",
                arg(args, "--scope").unwrap_or(if grant { "todos:read" } else { READ_SCOPES }),
            ),
            ("team_id", team.unwrap_or("")),
            ("todo_id", todo),
            ("project_id", project),
        ],
    )?;
    let invalid = || {
        Failure::new(
            "INVALID_RESPONSE",
            "The server did not return a valid CLI login.",
        )
    };
    let verify = started["verification_uri"]
        .as_str()
        .and_then(valid_url)
        .filter(|url| secure(url) && (!api.server.starts_with("https:") || url.scheme() == "https"))
        .ok_or_else(invalid)?;
    let code = started["user_code"]
        .as_str()
        .filter(|code| {
            code.len() == 9
                && code.bytes().enumerate().all(|(i, b)| {
                    if i == 4 {
                        b == b'-'
                    } else {
                        b.is_ascii_uppercase() || matches!(b, b'2' | b'3')
                    }
                })
        })
        .ok_or_else(invalid)?;
    if !opaque(&started["device_code"], "cd_") {
        return Err(invalid());
    }
    let device = started["device_code"]
        .as_str()
        .expect("validated device code");
    eprintln!("Open {verify}\nEnter {code}, then check the account, space and permissions before approving.");
    let mut interval = started["interval"].as_u64().unwrap_or(5).max(5);
    let deadline = Instant::now()
        + Duration::from_secs(started["expires_in"].as_u64().ok_or_else(invalid)?.min(600));
    while Duration::from_secs(interval) <= deadline.saturating_duration_since(Instant::now()) {
        thread::sleep(Duration::from_secs(interval));
        let out = match api.form(
            "/oauth/token",
            &[
                ("client_id", "coflow-cli"),
                ("grant_type", GRANT),
                ("device_code", device),
            ],
        ) {
            Ok(out) => out,
            Err(error) => match error.code {
                "authorization_pending" => continue,
                "slow_down" | "RATE_LIMITED" => {
                    interval = interval.saturating_add(5).max(error.retry_after);
                    continue;
                }
                "NETWORK_ERROR" => {
                    interval = interval.saturating_mul(2);
                    continue;
                }
                "expired_token" => break,
                "access_denied" => {
                    return Err(Failure::new(
                        "ACCESS_DENIED",
                        "The browser declined this login.",
                    ))
                }
                _ => return Err(error),
            },
        };
        let ttl = out["expires_in"]
            .as_i64()
            .filter(|seconds| (1..=30 * 86400).contains(seconds))
            .ok_or_else(invalid)?;
        if !opaque(&out["access_token"], "cf_cli_")
            || out["token_type"] != "Bearer"
            || !nonempty(&out["user_id"])
            || !nonempty(&out["team_id"])
            || !out["scope"].is_string()
        {
            return Err(invalid());
        }
        let token = out["access_token"].as_str().expect("validated token");
        if team.is_some_and(|team| out["team_id"] != team)
            || env_value("COFLOW_EXPECT_USER").is_some_and(|user| out["user_id"] != user)
            || (grant
                && (out["todo_id"].as_str().unwrap_or("") != todo
                    || out["project_id"].as_str().unwrap_or("") != project))
        {
            revoke(api, token)?;
            return Err(Failure::new(
                "IDENTITY_MISMATCH",
                "The browser approved a different account, space or scope.",
            ));
        }
        let mut data = fields(&out);
        data["expires_at"] = json!((Utc::now() + chrono::TimeDelta::seconds(ttl))
            .to_rfc3339_opts(SecondsFormat::Millis, true));
        let keychain = cfg!(target_os = "macos")
            && env_value("COFLOW_CREDENTIAL_STORE").as_deref() != Some("file");
        let write = if keychain {
            data["storage"] = json!("keychain");
            save_keychain(&file, &data, token)
        } else {
            data["token"] = json!(token);
            settings::write(&file, &data.to_string(), true)
        };
        if let Err(error) = write {
            revoke(api, token)?;
            return Err(error);
        }
        return Ok(status(api.server, Some(&Saved { data, path: file })));
    }
    Err(Failure::new("PAIRING_EXPIRED", "The browser code expired.")
        .hint("Run coflow auth login again when you are ready to approve it."))
}

fn keychain_error() -> Failure {
    Failure::new("CREDENTIAL_STORAGE", "Could not access the macOS Keychain.")
        .hint("Unlock your login keychain, or choose COFLOW_CREDENTIAL_STORE=file for a new login.")
}
#[cfg(target_os = "macos")]
fn account(path: &Path) -> &str {
    path.file_stem()
        .and_then(|s| s.to_str())
        .expect("generated path")
}
#[cfg(target_os = "macos")]
fn keychain_read(path: &Path) -> Result<String> {
    let password =
        security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, account(path))
            .map_err(|_| keychain_error())?;
    String::from_utf8(password).map_err(|_| keychain_error())
}
#[cfg(target_os = "macos")]
fn keychain_delete(path: &Path) -> Result<()> {
    security_framework::passwords::delete_generic_password(KEYCHAIN_SERVICE, account(path))
        .map_err(|_| keychain_error())
}
#[cfg(target_os = "macos")]
fn save_keychain(path: &Path, data: &Value, token: &str) -> Result<()> {
    settings::write(path, &data.to_string(), true)?;
    if security_framework::passwords::set_generic_password(
        KEYCHAIN_SERVICE,
        account(path),
        token.as_bytes(),
    )
    .is_err()
    {
        settings::remove(path)?;
        return Err(keychain_error());
    }
    Ok(())
}
#[cfg(not(target_os = "macos"))]
fn keychain_read(_: &Path) -> Result<String> {
    Err(keychain_error())
}
#[cfg(not(target_os = "macos"))]
fn keychain_delete(_: &Path) -> Result<()> {
    Err(keychain_error())
}
#[cfg(not(target_os = "macos"))]
fn save_keychain(_: &Path, _: &Value, _: &str) -> Result<()> {
    Err(keychain_error())
}
