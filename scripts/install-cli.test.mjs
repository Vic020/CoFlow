import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("installer selects stable assets and preserves the current binary on failure", (t) => {
  const fixture = mkdtempSync(join(tmpdir(), "coflow-cli-installer-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const shim = join(fixture, "tools");
  const name = "coflow-v1.2.3-linux-amd64";
  const archive = join(fixture, "archive.tar.gz");
  const executable = "#!/bin/sh\nprintf '1.2.3\\n'\n";
  mkdirSync(shim);
  mkdirSync(join(fixture, name));
  writeFileSync(join(fixture, name, "coflow"), executable);
  assert.equal(
    spawnSync("tar", ["-czf", archive, "-C", fixture, name]).status,
    0,
  );
  const checksum = join(fixture, "checksum");
  const digest = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  writeFileSync(checksum, `${digest}  ${name}.tar.gz\n`);
  writeFileSync(
    join(shim, "uname"),
    "#!/bin/sh\ncase $1 in -s) echo Linux;; -m) echo x86_64;; esac\n",
    { mode: 0o755 },
  );
  writeFileSync(
    join(shim, "curl"),
    `#!/bin/sh
while [ "$#" -gt 1 ]; do
  if [ "$1" = --output ]; then dest="$2"; shift; fi
  shift
done
case "$1" in
  https://github.com/Vic020/CoFlow/releases/latest)
    printf '%s' https://github.com/Vic020/CoFlow/releases/tag/v1.2.3 ;;
  https://github.com/Vic020/CoFlow/releases/download/v1.2.3/${name}.tar.gz)
    cp "$QA_ARCHIVE" "$dest" ;;
  https://github.com/Vic020/CoFlow/releases/download/v1.2.3/${name}.tar.gz.sha256)
    cp "$QA_CHECKSUM" "$dest" ;;
  *) exit 22 ;;
esac
`,
    { mode: 0o755 },
  );
  const runForShell = (shell, ...args) =>
    spawnSync("bash", ["scripts/install-cli.sh", ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: fixture,
        SHELL: shell,
        ZDOTDIR: fixture,
        XDG_CONFIG_HOME: join(fixture, ".config"),
        COFLOW_INSTALL_DIR: "",
        PATH: shim + ":" + process.env.PATH,
        QA_ARCHIVE: archive,
        QA_CHECKSUM: checksum,
      },
    });
  const run = (...args) => runForShell("/bin/bash", ...args);
  const installed = run();
  assert.equal(installed.status, 0, installed.stderr);
  const binary = join(fixture, ".coflow/bin/coflow");
  assert.equal(readFileSync(binary, "utf8"), executable);
  const bashrc = join(fixture, ".bashrc");
  const startup = readFileSync(bashrc, "utf8");
  assert.match(startup, /export PATH=/);
  assert.equal(readFileSync(join(fixture, ".bash_profile"), "utf8"), startup);
  assert.equal(run().status, 0);
  assert.equal(readFileSync(bashrc, "utf8"), startup);
  assert.equal(runForShell("/bin/zsh").status, 0);
  assert.match(readFileSync(join(fixture, ".zshrc"), "utf8"), /export PATH=/);
  assert.equal(runForShell("/usr/bin/fish").status, 0);
  assert.match(readFileSync(join(fixture, ".config/fish/conf.d/coflow-path.fish"), "utf8"), /fish_add_path --path/);
  assert.equal(
    run("--version", "v1.2.3", "--bin-dir", join(fixture, "custom bin"), "--no-path").status,
    0,
  );
  assert.equal(readFileSync(bashrc, "utf8"), startup);
  assert.match(run("--version", "v1.2.4").stderr, /no downloadable/);
  writeFileSync(checksum, `${"0".repeat(64)}  ${name}.tar.gz\n`);
  const rejected = run("--version", "v1.2.3");
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Checksum mismatch/);
  assert.equal(readFileSync(binary, "utf8"), executable);
});
