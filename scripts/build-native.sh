#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p resources/native
swiftc -O -framework AppKit -framework ApplicationServices -framework CoreGraphics macos/HotkeyCapture.swift -o resources/native/utterflow-hotkey
chmod 755 resources/native/utterflow-hotkey
codesign --force --sign - resources/native/utterflow-hotkey >/dev/null 2>&1 || true
