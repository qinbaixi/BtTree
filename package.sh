#!/usr/bin/env bash
# One-click desktop build for macOS and Linux: installs dependencies when needed, then builds the
# app for this platform into release/. Run with: bash package.sh
set -e

cd "$(dirname "$0")"

fail() {
  echo "owl-bt: $1" >&2
  echo "owl-bt: the build failed." >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js was not found. Install Node.js 22.12 or newer and run this script again."
command -v npm >/dev/null 2>&1 || fail "npm was not found. It normally comes with Node.js; reinstall Node.js and run this script again."

if [ ! -d node_modules ]; then
  echo "owl-bt: installing dependencies with npm ci"
  npm ci
fi

echo "owl-bt: building the desktop app for this platform with npm run package:current"
npm run package:current

RELEASE_DIR="$(pwd)/release"
echo "owl-bt: build finished. Release folder: $RELEASE_DIR"

if [ "${OWLBT_NONINTERACTIVE:-0}" != "1" ]; then
  case "$(uname -s)" in
    Darwin) open "$RELEASE_DIR" ;;
    Linux) command -v xdg-open >/dev/null 2>&1 && xdg-open "$RELEASE_DIR" >/dev/null 2>&1 || true ;;
  esac
fi
