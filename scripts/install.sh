#!/usr/bin/env bash
set -euo pipefail

mode="latest"
archive=""
if [[ $# -eq 0 || ( $# -eq 1 && "$1" == "--latest" ) ]]; then
  mode="latest"
elif [[ $# -eq 1 && "$1" == "--uninstall" ]]; then
  mode="uninstall"
elif [[ $# -eq 2 && "$1" == "--archive" ]]; then
  mode="archive"; archive="$2"
else
  echo "Usage: install.sh [--latest | --uninstall | --archive <forge614-engines-<version>-<platform>-<arch>.tar.gz>]" >&2; exit 64
fi

case "$(uname -s)" in
  Darwin) platform="darwin" ;;
  Linux) platform="linux" ;;
  *) echo "Forge614 Engines supports macOS and Linux only." >&2; exit 69 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *) echo "Forge614 Engines does not support this CPU architecture ($(uname -m))." >&2; exit 69 ;;
esac

for command in tar; do command -v "$command" >/dev/null 2>&1 || { echo "Forge614 Engines requires $command." >&2; exit 69; }; done
[[ "$mode" != "latest" ]] || command -v curl >/dev/null 2>&1 || { echo "Forge614 Engines requires curl to download the latest release." >&2; exit 69; }
command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1 || { echo "Forge614 Engines requires shasum or sha256sum to verify downloads." >&2; exit 69; }

forge_home="${FORGE614_HOME:-$HOME/.forge614}"
temporary="$(mktemp -d)"
cleanup() { rm -rf "$temporary"; }
trap cleanup EXIT

if [[ "$mode" == "uninstall" ]]; then
  engines_root="$forge_home/engines"
  echo "This removes Forge614 Engines from $engines_root."
  echo "Shell, Engram, Atlas, and other Forge614 tools are unchanged."
  printf "Continue? [y/N] "
  if ! read -r answer || [[ "$answer" != "y" && "$answer" != "Y" ]]; then echo "Uninstall cancelled."; exit 0; fi
  rm -rf "$engines_root"
  echo "Forge614 Engines was uninstalled. Other Forge614 tools are unchanged."
  exit 0
fi

asset_name_for() { echo "forge614-engines-$1-$platform-$arch.tar.gz"; }

if [[ "$mode" == "latest" ]]; then
  api_url="${FORGE614_RELEASE_API_URL:-https://api.github.com/repos/jotredev/forge614-engines/releases/latest}"
  if ! release_json="$(curl --fail --silent --show-error --location "$api_url")"; then echo "Could not download Forge614 Engines release metadata." >&2; exit 65; fi
  if ! release_info="$(printf '%s' "$release_json" | node -e '
let r; try { r=JSON.parse(require("fs").readFileSync(0,"utf8")); } catch { process.exit(1); }
const v=typeof r.tag_name==="string"?r.tag_name.replace(/^v/,""):"";
if(!/^\d+\.\d+\.\d+$/.test(v)||!Array.isArray(r.assets))process.exit(1);
const platform=process.argv[1], arch=process.argv[2];
const n=`forge614-engines-${v}-${platform}-${arch}.tar.gz`, pick=x=>r.assets.filter(a=>a&&a.name===x);
const a=pick(n), c=pick(`${n}.sha256`); if(a.length!==1||c.length!==1)process.exit(1);
const ok=u=>{try{const p=new URL(u);return p.protocol==="https:"||(process.env.FORGE614_RELEASE_API_URL&&p.protocol==="http:");}catch{return false;}};
if(!ok(a[0].browser_download_url)||!ok(c[0].browser_download_url))process.exit(1);
process.stdout.write(`${v}\t${a[0].browser_download_url}\t${c[0].browser_download_url}`);
  ' "$platform" "$arch" 2>/dev/null || printf '%s' "$release_json" | python3 -c '
import json,re,sys
r=json.load(sys.stdin)
v=re.sub(r"^v","",r.get("tag_name") or "")
platform, arch = sys.argv[1], sys.argv[2]
if not re.match(r"^\d+\.\d+\.\d+$", v) or not isinstance(r.get("assets"), list):
    sys.exit(1)
name=f"forge614-engines-{v}-{platform}-{arch}.tar.gz"
assets=[a for a in r["assets"] if a and a.get("name")==name]
checks=[a for a in r["assets"] if a and a.get("name")==f"{name}.sha256"]
if len(assets)!=1 or len(checks)!=1:
    sys.exit(1)
print(f"{v}\t{assets[0][\"browser_download_url\"]}\t{checks[0][\"browser_download_url\"]}")
' "$platform" "$arch")"; then echo "Latest release is missing a Forge614 Engines asset for $platform-$arch." >&2; exit 65; fi
  IFS=$'\t' read -r version archive_url checksum_url <<< "$release_info"
  [[ -n "$version" && -n "$archive_url" && -n "$checksum_url" ]] || { echo "Latest release is missing a Forge614 Engines asset for $platform-$arch." >&2; exit 65; }
  archive="$temporary/$(asset_name_for "$version")"; checksum="$archive.sha256"
  curl --fail --silent --show-error --location --output "$archive" "$archive_url" || { echo "Could not download Forge614 Engines v$version." >&2; exit 65; }
  curl --fail --silent --show-error --location --output "$checksum" "$checksum_url" || { echo "Could not download the Forge614 Engines checksum." >&2; exit 65; }
  if command -v shasum >/dev/null 2>&1; then (cd "$temporary" && shasum -a 256 -c "$(basename "$checksum")") || { echo "Forge614 Engines download checksum failed." >&2; exit 65; }; else (cd "$temporary" && sha256sum -c "$(basename "$checksum")") || { echo "Forge614 Engines download checksum failed." >&2; exit 65; }; fi
elif [[ ! -f "$archive" ]]; then
  echo "Release archive not found: $archive" >&2; exit 66
fi

extracted="$temporary/extracted"; mkdir -p "$extracted"
tar -xzf "$archive" -C "$extracted" || { echo "Invalid Forge614 Engines release archive." >&2; exit 65; }
release_root="$(find "$extracted" -mindepth 1 -maxdepth 1 -type d -name 'forge614-engines-*' -print -quit)"
[[ -n "$release_root" && -f "$release_root/package.json" && -x "$release_root/forge614-engines" ]] || { echo "Invalid Forge614 Engines release archive." >&2; exit 65; }

version_ok=1
if command -v node >/dev/null 2>&1; then
  version="$(node -e 'console.log(require(process.argv[1]).version)' "$release_root/package.json")" || version_ok=0
else
  version="$(grep -m1 '"version"' "$release_root/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')" || version_ok=0
fi
[[ "$version_ok" == "1" && "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid Forge614 Engines release version." >&2; exit 65; }

engines_root="$forge_home/engines"; target="$engines_root/$version"; active_link="$engines_root/bin/forge614-engines"
if [[ -L "$active_link" && "$(readlink "$active_link")" == "$target/forge614-engines" ]]; then echo "Forge614 Engines v$version is already active."; exit 0; fi
staged="$engines_root/.${version}.installing"; mkdir -p "$engines_root" "$engines_root/bin"; rm -rf "$staged"; mv "$release_root" "$staged"; rm -rf "$target"; mv "$staged" "$target"; ln -sfn "$target/forge614-engines" "$active_link"

echo "Installed Forge614 Engines v$version at $active_link"
echo "Forge614 Engines is an internal dependency — it is not added to PATH."
echo "Other Forge614 products call it directly by this path."
