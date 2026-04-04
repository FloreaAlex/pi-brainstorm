#!/usr/bin/env bash
set -e

echo "Bootstrap pi-brainstorm"
echo "======================="

# Verify git
if ! command -v git &> /dev/null; then
    echo "❌ git is not installed. Please install git first."
    exit 1
fi
echo "✓ git is installed"

# Verify node and npm
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "❌ node or npm is not installed."
    echo "  Please install Node.js (e.g. via nvm: https://github.com/nvm-sh/nvm)"
    exit 1
fi
echo "✓ node and npm are installed"

echo ""
echo "Running npm install..."
npm install

echo ""
echo "Starting wizard..."
npm run wizard
