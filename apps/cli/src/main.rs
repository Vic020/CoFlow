mod auth;
mod client;
mod settings;

use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    env,
    io::{self, Read},
};
use url::Url;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const CONNECTION: [&str; 2] = ["--space", "--server"];
const GLOBAL: [&str; 5] = ["--json", "--non-interactive", "--prepare", "--help", "-h"];
type Args = BTreeMap<String, String>;
type Result<T> = std::result::Result<T, Failure>;

#[derive(Debug)]
struct Failure {
    code: &'static str,
    message: String,
    steps: Vec<String>,
    status: Option<u16>,
    retry_after: u64,
}
impl Failure {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            steps: vec![],
            status: None,
            retry_after: 0,
        }
    }
    fn hint(mut self, step: impl Into<String>) -> Self {
        self.steps.push(step.into());
        self
    }
    fn exit_code(&self) -> i32 {
        match self.code {
            "INVALID_FLAG" | "UNKNOWN_COMMAND" | "MISSING_FLAG" | "MISSING_VALUE"
            | "INVALID_JSON" | "INVALID_ID" | "INVALID_PAYLOAD" => 2,
            "UNAUTHENTICATED" => 3,
            "FORBIDDEN" => 4,
            "CONFLICT" => 5,
            "BROWSER_CONFIRMATION_REQUIRED" => 6,
            "NETWORK_ERROR" => 7,
            _ => 1,
        }
    }
}
impl From<io::Error> for Failure {
    fn from(_: io::Error) -> Self {
        Self::new(
            "CREDENTIAL_STORAGE",
            "Could not access the local CLI settings.",
        )
        .hint("Check ownership and permissions of ~/.config/coflow/cli.")
    }
}
#[derive(Deserialize)]
struct Command {
    usage: String,
    description: String,
    details: String,
    effect: String,
    scopes: Vec<String>,
    flags: Vec<String>,
    required: Option<Vec<String>>,
    path: Option<String>,
    method: Option<String>,
    recovery: Option<String>,
    #[serde(default)]
    browser: bool,
    #[serde(default)]
    requires: Vec<String>,
}
impl Command {
    fn required(&self) -> &[String] {
        self.required.as_deref().unwrap_or(&self.flags)
    }
    fn flags(&self, name: &str) -> Vec<&str> {
        let mut flags: Vec<_> = self.flags.iter().map(String::as_str).collect();
        if name != "update check" {
            for flag in CONNECTION {
                if !flags.contains(&flag) {
                    flags.push(flag);
                }
            }
        }
        flags
    }
}
type Commands = BTreeMap<String, Command>;

fn print(value: &Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).expect("valid JSON")
    );
}
fn arg<'a>(args: &'a Args, flag: &str) -> Option<&'a str> {
    args.get(flag).map(String::as_str)
}
fn env_value(key: &str) -> Option<String> {
    env::var(key).ok().filter(|value| !value.is_empty())
}
fn distance(a: &str, b: &str) -> usize {
    let a = a.as_bytes();
    let b = b.as_bytes();
    let mut rows = vec![(0..=b.len()).collect::<Vec<_>>()];
    for (i, left) in a.iter().enumerate() {
        let mut row = vec![i + 1];
        for (j, right) in b.iter().enumerate() {
            let previous = &rows[i];
            let mut cost = (row[j] + 1)
                .min(previous[j + 1] + 1)
                .min(previous[j] + usize::from(left != right));
            if i > 0 && j > 0 && left == &b[j - 1] && &a[i - 1] == right {
                cost = cost.min(rows[i - 1][j - 1] + 1);
            }
            row.push(cost);
        }
        rows.push(row);
    }
    rows[a.len()][b.len()]
}
fn unknown(name: &str, commands: &Commands) -> Failure {
    let mut error = Failure::new(
        "UNKNOWN_COMMAND",
        format!("This version does not have a \"{name}\" command."),
    );
    if name.len() <= 80 {
        for candidate in commands
            .keys()
            .filter(|c| distance(name, c) <= if c.len() > 4 { 2 } else { 1 })
        {
            error.steps.push(format!(
                "Did you mean coflow {candidate}? See coflow help {candidate}."
            ));
        }
    }
    error.hint("Run coflow help to see what you can use.")
}
fn help(topic: &str, commands: &Commands, machine: bool) -> Result<()> {
    let entries: Vec<_> = commands
        .iter()
        .filter(|(name, _)| {
            topic.is_empty() || name.as_str() == topic || name.starts_with(&format!("{topic} "))
        })
        .collect();
    if entries.is_empty() {
        return Err(unknown(topic, commands));
    }
    if machine {
        let entries: Vec<_> = entries.iter().map(|(name, command)| {
            let mut value = json!({"name":name,"usage":command.usage,"description":command.description,
                "details":command.details,"effect":command.effect,"scopes":command.scopes,
                "parameters":command.flags(name).iter().map(|flag| json!({
                    "flag":flag,"required":command.required().iter().any(|req| req == flag),"type":"string"
                })).collect::<Vec<_>>(),
                "examples":[command.usage.replace(" [--json]", "")]});
            if command.browser { value["confirmation"] = json!("browser"); }
            if let Some(recovery) = &command.recovery { value["recovery"] = json!(recovery); }
            value
        }).collect();
        print(
            &json!({"version":VERSION,"global_flags":GLOBAL,"commands":entries,
            "recommended_workflow":["coflow whoami","coflow workspace show","coflow handoff read --todo TODO_ID",
            "coflow todo show --id TODO_ID","coflow report upsert --file report.json",
            "coflow data detail --metric reports_created --from 2026-11-01 --to 2026-11-08"]}),
        );
    } else if topic.is_empty() {
        println!("CoFlow CLI {VERSION}\n\nStart with coflow whoami to check your account and space.\nUse coflow auth login for browser sign-in. Set --server or COFLOW_URL for your instance.\nUse coflow help --json for all commands and coflow update check for updates.\n");
        let groups: std::collections::BTreeSet<_> = entries
            .iter()
            .filter_map(|(name, _)| name.split_once(' ').map(|(group, _)| group))
            .collect();
        for group in groups {
            println!("  coflow help {group}");
        }
    } else {
        for (name, command) in entries {
            println!(
                "{}\n  {}\n  {}",
                command.usage, command.description, command.details
            );
            let optional: Vec<_> = command
                .flags(name)
                .into_iter()
                .filter(|flag| !command.required().iter().any(|item| item == flag))
                .collect();
            if !optional.is_empty() {
                println!("  Optional flags: {}", optional.join(", "));
            }
            if !command.scopes.is_empty() {
                println!("  Team permissions: {}", command.scopes.join(", "));
            }
            if command.effect == "write" {
                println!("  This command changes saved CoFlow data.");
            }
            if let Some(recovery) = &command.recovery {
                println!("  {recovery}");
            }
        }
    }
    Ok(())
}
fn parse_flags(name: &str, command: &Command, input: &[String]) -> Result<Args> {
    let mut args = Args::new();
    let mut iter = input.iter();
    while let Some(raw) = iter.next() {
        let (flag, inline) = raw
            .split_once('=')
            .map_or((raw.as_str(), None), |(f, v)| (f, Some(v)));
        if !command.flags(name).contains(&flag) || args.contains_key(flag) {
            return Err(Failure::new(
                "INVALID_FLAG",
                format!("\"{flag}\" is unknown or repeated."),
            )
            .hint(format!("Run coflow help {name} for the right flags.")));
        }
        let value = inline.or_else(|| iter.next().map(String::as_str));
        let value = value
            .filter(|v| !v.trim().is_empty() && (inline.is_some() || !v.starts_with("--")))
            .ok_or_else(|| {
                Failure::new("MISSING_VALUE", format!("{flag} needs a value."))
                    .hint(format!("Try {}", command.usage))
            })?;
        args.insert(flag.into(), value.into());
    }
    for flag in command.required() {
        if !args.contains_key(flag) {
            return Err(Failure::new("MISSING_FLAG", format!("Add {flag}."))
                .hint(format!("Try {}", command.usage)));
        }
    }
    Ok(args)
}
fn payload(file: &str, command: &Command, name: &str) -> Result<Value> {
    let mut bytes = vec![];
    let reader: Box<dyn Read> = if file == "-" {
        Box::new(io::stdin())
    } else {
        Box::new(
            std::fs::File::open(file)
                .map_err(|_| Failure::new("FILE_UNREADABLE", "I could not open the JSON file."))?,
        )
    };
    reader
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Failure::new("FILE_UNREADABLE", "I could not read the JSON input."))?;
    if bytes.len() > 1024 * 1024 {
        return Err(Failure::new(
            "INVALID_PAYLOAD",
            "The JSON input exceeds 1 MiB.",
        ));
    }
    let body: Value = serde_json::from_slice(&bytes)
        .ok()
        .filter(Value::is_object)
        .ok_or_else(|| {
            Failure::new(
                "INVALID_JSON",
                "The input must contain a valid JSON object.",
            )
            .hint(format!("Run coflow help {name} for an example."))
        })?;
    for key in &command.requires {
        let valid = if key == "expected_revision" {
            body[key]
                .as_u64()
                .is_some_and(|v| v > 0 && v <= 9_007_199_254_740_991)
        } else {
            body[key].as_str().is_some_and(|v| !v.trim().is_empty())
        };
        if !valid {
            return Err(
                Failure::new("INVALID_PAYLOAD", format!("Add a valid {key}."))
                    .hint(format!("Run coflow help {name} for an example.")),
            );
        }
    }
    Ok(body)
}

fn main() {
    let commands: Commands =
        serde_json::from_str(include_str!("../commands.json")).expect("valid command registry");
    let mut globals = Vec::new();
    let mut words: Vec<String> = Vec::new();
    for word in env::args().skip(1) {
        let takes_value = words.last().is_some_and(|last| {
            CONNECTION.contains(&last.as_str()) || commands.values().any(|c| c.flags.contains(last))
        });
        if GLOBAL.contains(&word.as_str()) && !takes_value {
            globals.push(word);
        } else {
            words.push(word);
        }
    }
    let machine = globals.iter().any(|flag| flag == "--json");
    if let Err(error) = run(&words, &globals, &commands, machine) {
        if machine {
            let mut value =
                json!({"code":error.code,"message":error.message,"next_steps":error.steps});
            if let Some(status) = error.status {
                value["http_status"] = json!(status);
            }
            eprintln!("{value}");
        } else {
            eprintln!("coflow: {}", error.message);
            for step in &error.steps {
                eprintln!("{step}");
            }
        }
        std::process::exit(error.exit_code());
    }
}

fn run(words: &[String], globals: &[String], commands: &Commands, machine: bool) -> Result<()> {
    let has = |flag: &str| globals.iter().any(|global| global == flag);
    let first = words.first().map(String::as_str).unwrap_or("");
    if matches!(first, "version" | "--version") {
        if machine {
            print(&json!({"version":VERSION}));
        } else {
            println!("{VERSION}");
        }
        return Ok(());
    }
    if first.is_empty() || first == "help" {
        return help(
            &words.get(1..).unwrap_or_default().join(" "),
            commands,
            machine,
        );
    }
    let two = words.get(1).is_some_and(|word| !word.starts_with('-'));
    let index = if two { 2 } else { 1 };
    let name = words[..index].join(" ");
    if has("--help") || has("-h") {
        return help(&name, commands, machine);
    }
    let command = commands
        .get(&name)
        .ok_or_else(|| unknown(&name, commands))?;
    let args = parse_flags(&name, command, &words[index..])?;
    if name == "update check" {
        return client::update(machine);
    }
    business(
        &name,
        command,
        &args,
        has("--prepare"),
        has("--non-interactive"),
    )
}

fn valid_url(raw: &str) -> Option<Url> {
    Url::parse(raw).ok().filter(|url| {
        matches!(url.scheme(), "http" | "https")
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
    })
}
fn secure(url: &Url) -> bool {
    url.scheme() == "https" || matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
}
fn identity(meta: &Value, team: Option<&str>, user: Option<&str>) -> Result<()> {
    if team.is_some_and(|expected| meta["team"]["id"] != expected)
        || user.is_some_and(|expected| meta["current_user"] != expected)
    {
        return Err(Failure::new(
            "IDENTITY_MISMATCH",
            "The credential belongs to a different user or space.",
        )
        .hint("Run coflow whoami with the correct server and credential."));
    }
    Ok(())
}

fn route(template: &str, args: &Args) -> Result<(String, Vec<String>)> {
    let mut flags = Vec::new();
    let mut path = Vec::new();
    for part in template.split('/') {
        if let Some(key) = part.strip_prefix('{').and_then(|key| key.strip_suffix('}')) {
            let flag = format!("--{key}");
            let id = arg(args, &flag)
                .filter(|id| {
                    !matches!(*id, "." | "..")
                        && !id.contains(['/', '\\', '%', '?', '#'])
                        && !id.chars().any(char::is_control)
                })
                .ok_or_else(|| Failure::new("INVALID_ID", "Use the record ID from CoFlow."))?;
            let mut segment = String::new();
            for byte in id.bytes() {
                if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                    segment.push(byte as char);
                } else {
                    segment.push_str(&format!("%{byte:02X}"));
                }
            }
            path.push(segment);
            flags.push(flag);
        } else {
            path.push(part.into());
        }
    }
    Ok((path.join("/"), flags))
}
fn business(
    name: &str,
    command: &Command,
    args: &Args,
    prepare: bool,
    non_interactive: bool,
) -> Result<()> {
    if name == "workspace unbind" {
        settings::remove(&settings::binding()?)?;
        print(&json!({"bound":false}));
        return Ok(());
    }
    if prepare && !command.browser {
        return Err(Failure::new(
            "INVALID_FLAG",
            "--prepare is only used for browser-confirmed commands.",
        ));
    }
    if command.browser && !prepare {
        return Err(Failure::new(
            "BROWSER_CONFIRMATION_REQUIRED",
            "This action needs your browser login.",
        )
        .hint(format!(
            "Run {} --prepare, then review the request on the Agent credentials page.",
            command.usage
        )));
    }
    if name == "handoff read" && arg(args, "--todo").is_some() == arg(args, "--project").is_some() {
        return Err(
            Failure::new("MISSING_SCOPE", "Choose one task or one project.")
                .hint("Try coflow handoff read --todo TODO_ID."),
        );
    }
    let explicit = arg(args, "--server")
        .map(str::to_owned)
        .or_else(|| env_value("COFLOW_URL"));
    let binding: Value = if explicit.is_none() {
        settings::read(&settings::binding()?)?
            .map(|raw| serde_json::from_str(&raw))
            .transpose()
            .map_err(|_| Failure::new("CREDENTIAL_STORAGE", "The directory binding is invalid."))?
            .unwrap_or_default()
    } else {
        Value::Null
    };
    let target = valid_url(
        explicit
            .as_deref()
            .or_else(|| binding["server"].as_str())
            .unwrap_or("http://127.0.0.1:8080"),
    )
    .ok_or_else(|| {
        Failure::new(
            "INVALID_SERVER",
            "Use a CoFlow URL without login details, a query or a fragment.",
        )
    })?;
    let server = target.as_str().trim_end_matches('/');
    let api = client::Client::new(server, name, command);
    let is_auth = auth::handles(name);
    let space = arg(args, "--space").or_else(|| {
        if is_auth {
            None
        } else {
            binding["team_id"].as_str()
        }
    });
    let external = env_value("COFLOW_TOKEN");
    let saved = if is_auth || external.is_some() {
        None
    } else {
        auth::load(server, space)?
    };
    let token = external.as_deref().or_else(|| {
        saved
            .as_ref()
            .and_then(|saved| saved.data["token"].as_str())
    });
    if (is_auth || token.is_some()) && !secure(&target) {
        return Err(Failure::new(
            "INSECURE_SERVER",
            "Use HTTPS to send a credential to this server.",
        ));
    }
    if is_auth {
        print(&auth::run(&api, args, non_interactive)?);
        return Ok(());
    }
    if space.is_some() && token.is_none() {
        return Err(Failure::new(
            "SPACE_NOT_LOGGED_IN",
            "No CLI login is saved for this space.",
        )
        .hint("Run coflow auth login --space TEAM_ID first."));
    }
    let team_env = env_value("COFLOW_EXPECT_TEAM");
    let user_env = env_value("COFLOW_EXPECT_USER");
    let expect_team = space.or(team_env.as_deref()).or_else(|| {
        saved
            .as_ref()
            .and_then(|saved| saved.data["team_id"].as_str())
    });
    let expect_user = user_env
        .as_deref()
        .or_else(|| {
            if arg(args, "--space").is_none() {
                binding["user_id"].as_str()
            } else {
                None
            }
        })
        .or_else(|| {
            saved
                .as_ref()
                .and_then(|saved| saved.data["user_id"].as_str())
        });
    let mut meta = Value::Null;
    if name == "whoami"
        || name == "workspace bind"
        || command.browser
        || expect_team.is_some()
        || expect_user.is_some()
        || name.starts_with("handoff ")
    {
        if (command.browser || name == "workspace bind") && token.is_none() {
            return Err(Failure::new(
                "UNAUTHENTICATED",
                "Sign in to identify the space for this action.",
            )
            .hint("Run coflow auth login."));
        }
        let health = api.get("/health", None)?;
        if token.is_some() && health["mode"] != "team" {
            return Err(Failure::new(
                "WRONG_SERVER_MODE",
                "This server is not running in team mode.",
            ));
        }
        meta = api.get("/meta", token)?;
        identity(&meta, expect_team, expect_user)?;
        match name {
            "whoami" => {
                let mut result = json!({"server":server,"version":health["version"],"mode":meta["mode"],
                    "user_id":meta["current_user"],"team":meta["team"],"role":meta["role"],
                    "capabilities":meta["agent_capabilities"].as_array().cloned().unwrap_or_default()});
                if let Some(saved) = &saved {
                    for key in ["scope", "expires_at", "grant_id", "project_id", "todo_id"] {
                        if let Some(value) = saved.data.get(key) {
                            result[key] = value.clone();
                        }
                    }
                }
                print(&result);
                return Ok(());
            }
            "workspace show" => {
                print(&meta);
                return Ok(());
            }
            "workspace bind" => {
                if limited(&meta) || meta["current_user"].as_str().is_none() {
                    return Err(Failure::new(
                        "IDENTITY_MISMATCH",
                        "The credential does not cover the chosen space.",
                    ));
                }
                let binding =
                    json!({"server":server,"team_id":space,"user_id":meta["current_user"]});
                settings::write(&settings::binding()?, &binding.to_string(), false)?;
                print(&binding);
                return Ok(());
            }
            _ => {}
        }
    }
    let capability = match name {
        "handoff read" => Some("context-v1"),
        "handoff changes" => Some("changes-v1"),
        _ => None,
    };
    if capability.is_some_and(|capability| {
        !meta["agent_capabilities"]
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item == capability))
    }) {
        return Err(Failure::new(
            "CAPABILITY_UNAVAILABLE",
            "This server does not offer this handoff command.",
        )
        .hint("Read the task directly with coflow todo show --id TODO_ID."));
    }
    let (mut path, route_params) = route(command.path.as_deref().expect("command path"), args)?;
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    for (flag, value) in args {
        if !route_params.contains(flag)
            && ![
                "--file",
                "--body",
                "--space",
                "--server",
                "--checkpoint",
                "--save-cursor",
            ]
            .contains(&flag.as_str())
        {
            query.append_pair(&flag[2..].replace('-', "_"), value);
        }
    }
    if let Some(label) = arg(args, "--checkpoint") {
        let mut scopes = meta["scopes"].as_array().cloned().unwrap_or_default();
        scopes.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
        let cursor_identity = json!([
            server,
            meta["team"]["id"],
            meta["current_user"],
            meta["grant_id"],
            scopes,
            arg(args, "--project").unwrap_or(""),
            label
        ]);
        let file = settings::dir()?.join(format!(
            "{}.cursor",
            settings::hash(&cursor_identity.to_string())
        ));
        if let Some(cursor) = arg(args, "--save-cursor") {
            if args.contains_key("--cursor") {
                return Err(Failure::new(
                    "INVALID_FLAG",
                    "Use --save-cursor without --cursor.",
                ));
            }
            settings::write(&file, cursor, false)?;
            print(&json!({"saved":true}));
            return Ok(());
        }
        if !args.contains_key("--cursor") {
            if let Some(cursor) = settings::read(&file)? {
                query.append_pair("cursor", cursor.trim());
            }
        }
    } else if args.contains_key("--save-cursor") {
        return Err(Failure::new(
            "MISSING_FLAG",
            "Add --checkpoint NAME to save a cursor.",
        ));
    }
    let query = query.finish();
    if !query.is_empty() {
        path.push('?');
        path.push_str(&query);
    }
    let body = if let Some(file) = arg(args, "--file") {
        Some(payload(file, command, name)?)
    } else {
        arg(args, "--body").map(|text| json!({"body":text}))
    };
    let method = command.method.as_deref().unwrap_or("GET");
    if command.browser {
        if limited(&meta) {
            return Err(Failure::new(
                "FORBIDDEN",
                "A task-scoped login cannot prepare this workspace operation.",
            ));
        }
        if meta["mode"] != "team"
            || meta["team"]["id"].as_str().is_none()
            || meta["current_user"].as_str().is_none()
        {
            return Err(Failure::new(
                "WRONG_SERVER_MODE",
                "This action needs a CoFlow team.",
            ));
        }
        let mut draft = json!({"command":name,"server":server,"team_id":meta["team"]["id"],
            "user_id":meta["current_user"],"path":path,"method":method});
        if let Some(body) = body {
            draft["body"] = body;
        }
        print(&draft);
    } else {
        print(&api.request(method, &path, token, body.as_ref())?);
    }
    Ok(())
}
fn limited(meta: &Value) -> bool {
    ["project_id", "todo_id"]
        .iter()
        .any(|key| meta[key].as_str().is_some_and(|value| !value.is_empty()))
}
