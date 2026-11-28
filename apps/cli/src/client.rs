use crate::{print, Command, Failure, Result, VERSION};
use serde_json::{json, Value};
use std::{io::Read, time::Duration};

pub struct Client<'a> {
    pub server: &'a str,
    pub name: &'a str,
    pub command: &'a Command,
    agent: ureq::Agent,
}

impl<'a> Client<'a> {
    pub fn new(server: &'a str, name: &'a str, command: &'a Command) -> Self {
        Self {
            server,
            name,
            command,
            agent: agent(25),
        }
    }

    pub fn get(&self, path: &str, token: Option<&str>) -> Result<Value> {
        self.request("GET", path, token, None)
    }

    pub fn request(
        &self,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: Option<&Value>,
    ) -> Result<Value> {
        self.send(
            method,
            path,
            token,
            "application/json",
            body.map(Value::to_string),
        )
    }

    pub fn form(&self, path: &str, fields: &[(&str, &str)]) -> Result<Value> {
        let mut encoder = url::form_urlencoded::Serializer::new(String::new());
        encoder.extend_pairs(fields.iter().copied());
        self.send(
            "POST",
            path,
            None,
            "application/x-www-form-urlencoded",
            Some(encoder.finish()),
        )
    }

    fn send(
        &self,
        method: &str,
        path: &str,
        token: Option<&str>,
        content: &str,
        body: Option<String>,
    ) -> Result<Value> {
        let mut request = self
            .agent
            .request(method, &format!("{}/api/v1{path}", self.server))
            .set("Content-Type", content);
        if let Some(token) = token {
            if !token.bytes().all(|b| b.is_ascii_graphic()) {
                return Err(Failure::new(
                    "UNAUTHENTICATED",
                    "The credential contains invalid characters.",
                ));
            }
            request = request.set("Authorization", &format!("Bearer {token}"));
        }
        let result = match &body {
            Some(raw) => request.send_string(raw),
            None => request.call(),
        };
        let response = match result {
            Ok(response) | Err(ureq::Error::Status(_, response)) => response,
            Err(_) => return Err(
                Failure::new("NETWORK_ERROR", "Could not reach CoFlow.").hint(if method == "GET" {
                    "Check COFLOW_URL and your connection, then run the read again."
                } else {
                    "Check your connection and whether the write was saved before trying again."
                }),
            ),
        };
        let status = response.status();
        let retry_after = response
            .header("Retry-After")
            .and_then(|raw| raw.parse().ok())
            .unwrap_or(0);
        let parsed = decode(response);
        if (200..300).contains(&status) {
            return parsed.ok_or_else(|| {
                Failure::new("INVALID_RESPONSE", "CoFlow did not return JSON.").hint(
                    if method == "GET" {
                        "Check COFLOW_URL points to your API server."
                    } else {
                        "Check whether the write was saved before trying again."
                    },
                )
            });
        }
        if (300..400).contains(&status) {
            return Err(
                Failure::new("NETWORK_ERROR", "CoFlow redirected the request.")
                    .hint("Use the final server URL in COFLOW_URL."),
            );
        }
        let message = parsed
            .as_ref()
            .and_then(|data| data["error"].as_str())
            .unwrap_or("");
        let code = match (path, status, message) {
            ("/oauth/token", _, "authorization_pending") => "authorization_pending",
            ("/oauth/token", _, "slow_down") => "slow_down",
            ("/oauth/token", _, "access_denied") => "access_denied",
            ("/oauth/token", _, "expired_token") => "expired_token",
            (_, 400, _) => "INVALID_REQUEST",
            (_, 401, _) => "UNAUTHENTICATED",
            (_, 403, _) => "FORBIDDEN",
            (_, 404, _) => "NOT_FOUND",
            (_, 409, _) => "CONFLICT",
            (_, 429, _) => "RATE_LIMITED",
            _ => "HTTP_ERROR",
        };
        let text = if message.is_empty() {
            format!("The server returned HTTP {status}.")
        } else {
            format!("The server returned HTTP {status}. {message}")
        };
        let step = match status {
            401 => "Check COFLOW_URL and the credential for this space.".into(),
            403 => format!("Check the permissions listed by coflow help {}.", self.name),
            404 => format!(
                "Check the server, space and record ID. Run coflow help {}.",
                self.name
            ),
            409 => self.command.recovery.clone().unwrap_or_else(|| {
                "Read the latest report with coflow list before trying a new write.".into()
            }),
            429 => "The server is busy. Wait before trying again.".into(),
            500..=599 if method != "GET" => {
                "Check whether the write was saved before sending it again.".into()
            }
            _ => format!("Run coflow help {} to check the inputs.", self.name),
        };
        let mut error = Failure::new(code, text).hint(step);
        error.status = Some(status);
        error.retry_after = retry_after;
        Err(error)
    }
}

fn decode(response: ureq::Response) -> Option<Value> {
    serde_json::from_reader(response.into_reader().take(32 * 1024 * 1024)).ok()
}

fn agent(seconds: u64) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .redirects(0)
        .timeout(Duration::from_secs(seconds))
        .build()
}

const RELEASES: &str = "https://github.com/Vic020/CoFlow/releases";
const LATEST: &str = "https://api.github.com/repos/Vic020/CoFlow/releases/latest";

fn stable(version: &str) -> Option<[u64; 3]> {
    let mut parts = version.split('.');
    let mut result = [0; 3];
    for part in &mut result {
        let raw = parts.next()?;
        if raw.is_empty()
            || (raw.len() > 1 && raw.starts_with('0'))
            || !raw.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        *part = raw.parse().ok()?;
    }
    parts.next().is_none().then_some(result)
}

fn release_status(release: &Value) -> Option<(&str, &'static str)> {
    let latest = release["tag_name"].as_str()?.strip_prefix('v')?;
    if release["draft"] != false || release["prerelease"] != false {
        return None;
    }
    let status = match stable(latest)?.cmp(&stable(VERSION)?) {
        std::cmp::Ordering::Greater => "available",
        std::cmp::Ordering::Equal => "current",
        std::cmp::Ordering::Less => "ahead",
    };
    Some((latest, status))
}

pub fn update(machine: bool) -> Result<()> {
    let error = |message| {
        Failure::new("UPDATE_CHECK_FAILED", message)
            .hint("Try coflow update check again later.")
            .hint(format!("Open {RELEASES} to check manually."))
    };
    let release = agent(10)
        .get(LATEST)
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", "CoFlow-CLI")
        .call()
        .map_err(|_| error("Could not check CoFlow's GitHub releases."))?;
    if release.status() != 200 {
        return Err(error("GitHub did not return a release."));
    }
    let release =
        decode(release).ok_or_else(|| error("GitHub did not return a stable CoFlow release."))?;
    let (latest, status) = release_status(&release)
        .ok_or_else(|| error("GitHub did not return a stable CoFlow release."))?;
    let url = format!("{RELEASES}/tag/v{latest}");
    let hint = "Read the release notes, then update using the method you used to install CoFlow.";
    if machine {
        print(
            &json!({"current":VERSION,"latest":latest,"status":status,"update_available":status=="available",
            "release_url":url,"server_compatibility":"unknown",
            "next_steps":if status=="available" { vec![hint] } else { vec![] }}),
        );
    } else {
        match status {
            "current" => println!("You have the latest stable release, {VERSION}."),
            "ahead" => println!("Your CLI is {VERSION}. The latest stable release is {latest}."),
            _ => {
                println!("Your CLI is {VERSION}. CoFlow {latest} is available.");
                eprintln!("{hint}\n{url}");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn update_only_accepts_stable_releases() {
        assert_eq!(
            release_status(&json!({"tag_name":"v99.0.0","draft":false,"prerelease":false})),
            Some(("99.0.0", "available"))
        );
        for tag in ["v01.0.0", "v1.0.0-rc1", "v1.0.0/extra", "v1.0.0.0"] {
            assert!(
                release_status(&json!({"tag_name":tag,"draft":false,"prerelease":false})).is_none()
            );
        }
        assert!(
            release_status(&json!({"tag_name":"v1.0.0","draft":true,"prerelease":false})).is_none()
        );
    }
}
