use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    process::{Command, Output, Stdio},
    thread,
};
use tempfile::TempDir;

const TOKEN: &str = "cf_cli_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const DEVICE: &str = "cd_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

fn command(home: &TempDir) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_coflow"));
    cmd.env("HOME", home.path())
        .env("USERPROFILE", home.path())
        .env("COFLOW_CREDENTIAL_STORE", "file")
        .current_dir(home.path());
    for key in [
        "COFLOW_URL",
        "COFLOW_TOKEN",
        "COFLOW_EXPECT_TEAM",
        "COFLOW_EXPECT_USER",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ] {
        cmd.env_remove(key);
    }
    cmd
}
fn value(output: Output) -> Value {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}
fn error(output: Output, status: i32, code: &str) {
    assert_eq!(
        output.status.code(),
        Some(status),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.is_empty());
    let body: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(body["code"], code);
}
fn invoke(home: &TempDir, server: &str, args: &[&str], token: bool, input: &str) -> Output {
    let mut cmd = command(home);
    cmd.env("COFLOW_URL", server).args(args).arg("--json");
    if token {
        cmd.env("COFLOW_TOKEN", TOKEN);
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}
struct Request {
    method: String,
    path: String,
    auth: Option<String>,
    body: String,
}
fn serve(
    count: usize,
    mut respond: impl FnMut(Request) -> (u16, Value) + Send + 'static,
) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let task = thread::spawn(move || {
        for incoming in listener.incoming().take(count) {
            let mut socket = incoming.unwrap();
            let mut reader = BufReader::new(&mut socket);
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let mut words = line.split_whitespace();
            let (method, path) = (
                words.next().unwrap().to_owned(),
                words.next().unwrap().to_owned(),
            );
            let (mut auth, mut size) = (None, 0);
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line.trim().is_empty() {
                    break;
                }
                let (key, val) = line.split_once(':').unwrap();
                if key.eq_ignore_ascii_case("authorization") {
                    auth = Some(val.trim().to_owned());
                }
                if key.eq_ignore_ascii_case("content-length") {
                    size = val.trim().parse().unwrap();
                }
            }
            let mut bytes = vec![0; size];
            reader.read_exact(&mut bytes).unwrap();
            let (status, value) = respond(Request {
                method,
                path,
                auth,
                body: String::from_utf8(bytes).unwrap(),
            });
            let body = value.to_string();
            write!(socket, "HTTP/1.1 {status} Test\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        }
    });
    (format!("http://{addr}"), task)
}
fn meta() -> Value {
    json!({"mode":"team","team":{"id":"team-1"},"current_user":"user-1","role":"member",
        "agent_capabilities":["context-v1","changes-v1"],"scopes":["todos:read"],"grant_id":"grant-1"})
}
fn auth(request: &Request) {
    assert_eq!(
        request.auth.as_deref(),
        Some(format!("Bearer {TOKEN}").as_str())
    );
}

#[test]
fn command_registry_help_and_typo_contract() {
    let home = TempDir::new().unwrap();
    let data = value(command(&home).args(["help", "--json"]).output().unwrap());
    assert_eq!(data["version"], env!("CARGO_PKG_VERSION"));
    let entries = data["commands"].as_array().unwrap();
    assert_eq!(entries.len(), 110);
    let item = entries
        .iter()
        .find(|entry| entry["name"] == "catalog merge")
        .unwrap();
    assert_eq!(item["confirmation"], "browser");
    let output = command(&home).args(["lsit", "--json"]).output().unwrap();
    assert!(String::from_utf8_lossy(&output.stderr).contains("coflow list"));
    error(output, 2, "UNKNOWN_COMMAND");
}

#[test]
fn writes_conflicts_and_browser_review_transport() {
    let home = TempDir::new().unwrap();
    let (server, thread) = serve(4, |req| match req.path.as_str() {
        "/api/v1/health" => {
            assert!(req.auth.is_none());
            (200, json!({"mode":"team","version":"0.6.0"}))
        }
        "/api/v1/meta" => {
            auth(&req);
            (200, meta())
        }
        "/api/v1/reports" => {
            auth(&req);
            assert_eq!(req.method, "POST");
            (200, serde_json::from_str(&req.body).unwrap())
        }
        "/api/v1/todos/task-1" => {
            auth(&req);
            assert_eq!(req.method, "PATCH");
            (409, json!({"error":"stale"}))
        }
        _ => panic!("Unexpected request {}", req.path),
    });
    let report = r#"{"source_id":"weekly","title":"Example"}"#;
    assert_eq!(
        value(invoke(
            &home,
            &server,
            &["report", "upsert", "--file", "-"],
            true,
            report
        ))["source_id"],
        "weekly"
    );
    let stale = invoke(
        &home,
        &server,
        &["todo", "change", "--id", "task-1", "--file", "-"],
        true,
        r#"{"operation_id":"move-1","expected_revision":2}"#,
    );
    assert!(String::from_utf8_lossy(&stale.stderr).contains("coflow todo show"));
    error(stale, 5, "CONFLICT");
    error(
        invoke(
            &home,
            &server,
            &["todo", "show", "--id", "%2e%2e"],
            true,
            "",
        ),
        2,
        "INVALID_ID",
    );
    let draft = value(invoke(
        &home,
        &server,
        &[
            "catalog",
            "merge",
            "--kind",
            "project",
            "--id",
            "old",
            "--file",
            "-",
            "--prepare",
        ],
        true,
        r#"{"target_id":"new"}"#,
    ));
    assert_eq!(
        draft,
        json!({"command":"catalog merge","server":server,"team_id":"team-1","user_id":"user-1",
        "path":"/catalog/project/old/merge","method":"POST","body":{"target_id":"new"}})
    );
    thread.join().unwrap();
}

#[test]
fn browser_login_and_legacy_file_are_compatible() {
    let home = TempDir::new().unwrap();
    let (server, thread) = serve(6, |req| match req.path.as_str() {
        "/api/v1/health" => {
            assert!(req.auth.is_none());
            (200, json!({"mode":"team","version":"0.6.0"}))
        }
        "/api/v1/meta" => {
            auth(&req);
            (200, meta())
        }
        "/api/v1/oauth/device" => {
            assert!(
                req.auth.is_none()
                    && req.body.contains("client_id=coflow-cli")
                    && req.body.contains("team_id=team-1")
            );
            (
                200,
                json!({"verification_uri":"http://127.0.0.1:3000/credentials","user_code":"BCDF-GHJK",
                "device_code":DEVICE,"interval":5,"expires_in":600}),
            )
        }
        "/api/v1/oauth/token" => {
            assert!(req.auth.is_none() && req.body.contains(DEVICE));
            (
                200,
                json!({"token_type":"Bearer","access_token":TOKEN,"expires_in":86400,"user_id":"user-1","team_id":"team-1","scope":"todos:read"}),
            )
        }
        "/api/v1/cli/revoke" => {
            auth(&req);
            (200, json!({"ok":true}))
        }
        _ => panic!("Unexpected request {}", req.path),
    });
    error(
        invoke(
            &home,
            &server,
            &["auth", "login", "--non-interactive"],
            false,
            "",
        ),
        6,
        "BROWSER_CONFIRMATION_REQUIRED",
    );
    let login = invoke(
        &home,
        &server,
        &[
            "auth",
            "login",
            "--space",
            "team-1",
            "--scope",
            "todos:read",
        ],
        false,
        "",
    );
    let err = String::from_utf8_lossy(&login.stderr);
    assert!(err.contains("BCDF-GHJK") && !err.contains(DEVICE));
    assert!(!String::from_utf8_lossy(&login.stdout).contains(TOKEN));
    assert_eq!(value(login)["team_id"], "team-1");

    // Recreate the on-disk shape used by the previous implementation before checking status.
    let dir = home.path().join(".config/coflow/cli");
    let file = std::fs::read_dir(&dir)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    std::fs::write(
        file,
        json!({"token":TOKEN,"user_id":"user-1","team_id":"team-1",
        "scope":"todos:read","expires_at":"2030-01-01T00:00:00.000Z"})
        .to_string(),
    )
    .unwrap();
    assert_eq!(
        value(invoke(
            &home,
            &server,
            &["space", "use", "--space", "team-1"],
            false,
            ""
        ))["current_space"],
        "team-1"
    );
    assert_eq!(
        value(invoke(&home, &server, &["auth", "status"], false, ""))["logged_in"],
        true
    );
    assert_eq!(
        value(invoke(&home, &server, &["auth", "logout"], false, ""))["logged_in"],
        false
    );
    assert_eq!(
        value(invoke(&home, &server, &["auth", "status"], false, ""))["logged_in"],
        false
    );
    thread.join().unwrap();
}

#[test]
fn directory_pin_and_checkpoint_stay_in_scope() {
    let home = TempDir::new().unwrap();
    let (server, thread) = serve(10, |req| {
        if req.path == "/api/v1/health" {
            assert!(req.auth.is_none());
            return (200, json!({"mode":"team","version":"0.6.0"}));
        }
        auth(&req);
        if req.path == "/api/v1/meta" {
            return (200, meta());
        }
        assert!(req.path.starts_with("/api/v1/agent/changes?"));
        let query = req.path.split_once('?').unwrap().1;
        let parsed: std::collections::HashMap<_, _> =
            url::form_urlencoded::parse(query.as_bytes()).collect();
        (
            200,
            json!({"cursor":parsed.get("cursor"),"next_cursor":"page-one"}),
        )
    });
    let output = command(&home)
        .args([
            "workspace",
            "bind",
            "--server",
            &server,
            "--space",
            "team-1",
            "--json",
        ])
        .env("COFLOW_TOKEN", TOKEN)
        .output()
        .unwrap();
    assert_eq!(value(output)["user_id"], "user-1");
    let args = [
        "handoff",
        "changes",
        "--project",
        "project-a",
        "--checkpoint",
        "review",
    ];
    let run = |args: &[&str]| {
        value(
            command(&home)
                .args(args)
                .arg("--json")
                .env("COFLOW_TOKEN", TOKEN)
                .output()
                .unwrap(),
        )
    };
    assert_eq!(run(&args)["cursor"], Value::Null);
    let mut save = args.to_vec();
    save.extend(["--save-cursor", "page-one"]);
    assert_eq!(run(&save)["saved"], true);
    assert_eq!(run(&args)["cursor"], "page-one");
    thread.join().unwrap();
}
