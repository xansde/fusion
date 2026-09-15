#!/usr/bin/env bash
# Prepares one worktree per task of the round (sequentially: parallel pnpm install corrupts node_modules).
set -euo pipefail
ROOT="$1"
RODADA="$2"

mapfile -t LINES < <(node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
for (const t of r.tarefas) console.log([t.id, t.branch, t.worktree].join("\t"));
' "$RODADA")

INT="$ROOT/.claude/worktrees/alq-integracao"
git -C "$INT" pull -q --ff-only
git -C "$INT/external/fusion-systems-2e" pull -q --ff-only

prep() {
  local dir="$1"
  git -C "$dir" submodule update --init >/dev/null
  (cd "$dir" && pnpm install --frozen-lockfile >/dev/null && pnpm build >/dev/null)
}

# Integration worktree needs deps too (gate runs there).
if [ ! -d "$INT/node_modules" ]; then
  echo "preparando integração…"
  (cd "$INT" && pnpm install --frozen-lockfile >/dev/null && pnpm build >/dev/null)
fi

for line in "${LINES[@]}"; do
  IFS=$'\t' read -r ID BRANCH DIR <<<"$line"
  if [ -d "$DIR" ]; then
    echo "$ID: reaproveitando $DIR"
    git -C "$DIR" fetch -q origin
    git -C "$DIR/external/fusion-systems-2e" fetch -q origin
    continue
  fi
  echo "$ID: criando $DIR"
  if git -C "$ROOT" ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
    git -C "$ROOT" worktree add -q -B "$BRANCH" "$DIR" "origin/$BRANCH"
  else
    git -C "$ROOT" worktree add -q -B "$BRANCH" "$DIR" origin/feat/alquimista
  fi
  git -C "$DIR" submodule update --init >/dev/null
  SAT="$DIR/external/fusion-systems-2e"
  git -C "$SAT" fetch -q origin
  if git -C "$SAT" ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
    git -C "$SAT" checkout -q -B "$BRANCH" "origin/$BRANCH"
  else
    git -C "$SAT" checkout -q -B "$BRANCH" origin/feat/alquimista
  fi
  (cd "$DIR" && pnpm install --frozen-lockfile >/dev/null && pnpm build >/dev/null)
done
echo "ok: ${#LINES[@]} worktree(s) prontas"
