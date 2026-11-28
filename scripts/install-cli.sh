#!/usr/bin/env bash
set -euo pipefail

repo=https://github.com/Vic020/CoFlow
version=''
bin_dir="${COFLOW_INSTALL_DIR:-$HOME/.coflow/bin}"
usage() {
  printf '%s\n' 'Usage: bash install-cli.sh [--version vX.Y.Z] [--bin-dir DIRECTORY]' \
    'Installs CoFlow from GitHub Releases. Defaults to the latest release and ~/.coflow/bin.'
}
die() { printf 'coflow install: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --version|--bin-dir)
      [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "Missing value for $1."
      if [[ "$1" == --version ]]; then version="$2"; else bin_dir="$2"; fi
      shift 2 ;;
    *) die "Unknown argument $1. Use --help." ;;
  esac
done

case "$(uname -s):$(uname -m)" in
  Linux:x86_64) platform=linux-amd64 ;;
  Darwin:arm64) platform=macos-arm64 ;;
  *) die "Prebuilt packages support Linux x64 and Apple Silicon macOS. Install from source with cargo install --path apps/cli --locked --root \"\$HOME/.coflow\"." ;;
esac

if command -v shasum >/dev/null; then
  checksum() { shasum -a 256 "$1"; }
elif command -v sha256sum >/dev/null; then
  checksum() { sha256sum "$1"; }
else
  die "Install shasum or sha256sum to verify the archive."
fi

fetch() { curl --disable --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 120 "$@"; }
if [[ -z "$version" ]]; then
  resolved="$(fetch --output /dev/null --write-out '%{url_effective}' "$repo/releases/latest")" ||
    die "Could not find the latest release. See $repo/releases."
  [[ "$resolved" == "$repo/releases/tag/"* ]] || die "Could not identify a stable CoFlow release."
  version="${resolved##*/}"
fi
version="${version#v}"
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || die "Use a stable version such as v0.7.0."

name="coflow-v$version-$platform"
url="$repo/releases/download/v$version/$name.tar.gz"
work="$(mktemp -d)"
staged=''
cleanup() {
  if [[ -n "$staged" ]]; then rm -f -- "$staged"; fi
  rm -rf -- "$work"
}
trap cleanup EXIT

fetch --output "$work/archive.tar.gz" "$url" &&
  fetch --output "$work/archive.sha256" "$url.sha256" ||
  die "Release v$version has no downloadable $platform package or checksum. See $repo/releases/tag/v$version, or install from source."

sum="$(checksum "$work/archive.tar.gz")"
read -r expected _ < "$work/archive.sha256" || die "The release checksum is missing."
[[ "$expected" =~ ^[0-9a-fA-F]{64}$ && "$expected" == "${sum%% *}" ]] ||
  die "Checksum mismatch. The existing installation was left untouched."
tar -xOzf "$work/archive.tar.gz" "$name/coflow" > "$work/coflow" ||
  die "Could not read the coflow executable in the archive."
chmod 755 "$work/coflow"
[[ "$("$work/coflow" --version)" == "$version" ]] || die "The binary version did not match v$version."

mkdir -p -- "$bin_dir"
bin_dir="$(cd -- "$bin_dir" && pwd)"
[[ ! -d "$bin_dir/coflow" ]] || die "$bin_dir/coflow is a directory."
staged="$(mktemp "$bin_dir/.coflow.XXXXXX")"
install -m 755 "$work/coflow" "$staged"
mv -f -- "$staged" "$bin_dir/coflow"
printf 'Installed CoFlow %s at %s/coflow\n' "$version" "$bin_dir"
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) printf 'To use it in this shell: export PATH=%q:"$PATH"\n' "$bin_dir" ;;
esac
