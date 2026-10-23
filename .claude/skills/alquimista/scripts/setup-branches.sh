#!/usr/bin/env bash
# Creates the integration branches feat/alquimista in core and satellite (idempotent).
set -euo pipefail
ROOT="$1"
SAT="$ROOT/external/fusion-systems-2e"
WT="$ROOT/.claude/worktrees"
mkdir -p "$WT"

git -C "$ROOT" fetch -q origin
git -C "$SAT" fetch -q origin

# Satellite: born from PR #57 head.
if ! git -C "$SAT" ls-remote --exit-code --heads origin feat/alquimista >/dev/null 2>&1; then
  git -C "$SAT" push origin "origin/feat/classes-druid-gunslinger-psychic:refs/heads/feat/alquimista"
  git -C "$SAT" fetch -q origin
fi

# Core: born from the plan branch (alfa/app + docs/design/alquimista).
if ! git -C "$ROOT" ls-remote --exit-code --heads origin feat/alquimista >/dev/null 2>&1; then
  git -C "$ROOT" push origin "origin/docs/alquimista-tasks:refs/heads/feat/alquimista"
  git -C "$ROOT" fetch -q origin
fi

# Integration worktree tracking both feat/alquimista branches.
INT="$WT/alq-integracao"
if [ ! -d "$INT" ]; then
  git -C "$ROOT" worktree add -B feat/alquimista "$INT" origin/feat/alquimista
  git -C "$INT" branch --set-upstream-to=origin/feat/alquimista feat/alquimista
  git -C "$INT" submodule update --init
fi
git -C "$INT" pull -q --ff-only
git -C "$INT/external/fusion-systems-2e" fetch -q origin
git -C "$INT/external/fusion-systems-2e" checkout -q -B feat/alquimista origin/feat/alquimista
git -C "$INT/external/fusion-systems-2e" branch -q --set-upstream-to=origin/feat/alquimista feat/alquimista

# Pin the submodule to the satellite integration head when it differs.
SAT_HEAD=$(git -C "$INT/external/fusion-systems-2e" rev-parse HEAD)
PINNED=$(git -C "$INT" ls-tree HEAD external/fusion-systems-2e | awk '{print $3}')
if [ "$SAT_HEAD" != "$PINNED" ]; then
  git -C "$INT" add external/fusion-systems-2e
  git -C "$INT" commit -q -m "chore(alquimista): aponta o submodule para feat/alquimista do satélite ($SAT_HEAD)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  git -C "$INT" push -q origin feat/alquimista
fi

# Initial state file.
EST="$INT/docs/design/alquimista/estado.json"
if [ ! -f "$EST" ]; then
  printf '{\n  "versao": 1,\n  "tarefas": {},\n  "rodadas": [],\n  "lotes": {}\n}\n' > "$EST"
  git -C "$INT" add docs/design/alquimista/estado.json
  git -C "$INT" commit -q -m "chore(alquimista): estado inicial da execução do plano

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  git -C "$INT" push -q origin feat/alquimista
fi
echo "ok: feat/alquimista pronto (core $(git -C "$INT" rev-parse --short HEAD), satélite ${SAT_HEAD:0:8})"
