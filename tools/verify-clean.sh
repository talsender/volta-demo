#!/usr/bin/env bash
# Fails if any known-proprietary token appears in tracked files.
set -e
cd "$(dirname "$0")/.."
PAT='volta-city|AIzaSyAgbJWir2bpJyn3iBGV9VcuF0AZrBnGxkw|יישוב ערבי|הנחיית עבודה פנימית|distilled from the reps|distilled from the technicians|docs\.google\.com|מייטק'
if git grep -nE "$PAT" -- . ; then
  echo "FAIL: proprietary token found above"; exit 1
fi
echo "PASS: no proprietary tokens in tracked files"
