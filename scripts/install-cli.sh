#!/usr/bin/env bash
set -euo pipefail

repo=https://github.com/Vic020/CoFlow
version=''
bin_dir="${COFLOW_INSTALL_DIR:-$HOME/.coflow/bin}"
update_path=true
usage() {
  printf '%s\n' 'Usage: bash install-cli.sh [--version vX.Y.Z] [--bin-dir DIRECTORY] [--no-path]' \
    'Installs CoFlow from GitHub Releases and configures PATH for Bash, Zsh, or Fish.'
}
die() { printf 'coflow install: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --no-path) update_path=false; shift ;;
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

add_startup_line() {
  local file="$1" line="$2"
  if [[ -f "$file" ]] && grep -Fqx -- "$line" "$file"; then return; fi
  if printf '\n%s\n' "$line" >> "$file"; then
    printf 'Configured PATH in %s\n' "$file"
  else
    printf 'Could not configure PATH in %s. Use %s/coflow directly.\n' "$file" "$bin_dir" >&2
  fi
}

if $update_path; then
  printf -v quoted_bin '%q' "$bin_dir"
  path_line="case \":\$PATH:\" in *:$quoted_bin:*) ;; *) export PATH=$quoted_bin:\"\$PATH\" ;; esac"
  shell="${SHELL:-}"
  case "${shell##*/}" in
    zsh) add_startup_line "${ZDOTDIR:-$HOME}/.zshrc" "$path_line" ;;
    bash)
      bash_login="$HOME/.bash_profile"
      for profile in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
        if [[ -r "$profile" ]]; then bash_login="$profile"; break; fi
      done
      add_startup_line "$bash_login" "$path_line"
      add_startup_line "$HOME/.bashrc" "$path_line"
      ;;
    fish)
      fish_config="${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d"
      fish_bin="${bin_dir//\\/\\\\}"
      fish_bin="${fish_bin//\'/\\\'}"
      if mkdir -p -- "$fish_config"; then
        add_startup_line "$fish_config/coflow-path.fish" "fish_add_path --path '$fish_bin'"
      else
        printf 'Could not configure Fish PATH. Use %s/coflow directly.\n' "$bin_dir" >&2
      fi
      ;;
    *) printf 'Add %s to PATH in your shell configuration.\n' "$bin_dir" ;;
  esac
fi
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) printf 'Open a new terminal or run %s/coflow directly.\n' "$bin_dir" ;;
esac
