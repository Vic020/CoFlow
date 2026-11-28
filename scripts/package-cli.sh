#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(cat "$root/VERSION")"
if [[ ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "VERSION must be a stable semantic version." >&2
  exit 1
fi

case "$(uname -s):$(uname -m)" in
  Linux:x86_64) platform=linux-amd64 ;;
  Darwin:arm64) platform=macos-arm64 ;;
  *) echo "This release packager supports Linux x64 and Apple Silicon." >&2; exit 1 ;;
esac

target_dir="${CARGO_TARGET_DIR:-$root/apps/cli/target}"
mkdir -p -- "$target_dir"
target_dir="$(cd -- "$target_dir" && pwd)"
output="${1:-$target_dir/dist}"
mkdir -p -- "$output"
output="$(cd -- "$output" && pwd)"
work="$(mktemp -d "$output/.coflow-cli.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

cargo build --locked --release --manifest-path "$root/apps/cli/Cargo.toml" \
  --target-dir "$target_dir"
binary="$target_dir/release/coflow"
[[ "$("$binary" --version)" == "$version" ]]
"$binary" help --json >/dev/null

name="coflow-v$version-$platform"
mkdir -- "$work/$name"
install -m 755 "$binary" "$work/$name/coflow"
install -m 644 "$root/LICENSE" "$work/$name/LICENSE"
tar -C "$work" -czf "$work/$name.tar.gz" "$name"
(
  cd -- "$work"
  shasum -a 256 "$name.tar.gz" > "$name.tar.gz.sha256"
  shasum -a 256 -c "$name.tar.gz.sha256"
)
mv -- "$work/$name.tar.gz" "$work/$name.tar.gz.sha256" "$output/"
