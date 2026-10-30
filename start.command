#!/bin/zsh
cd -- "${0:A:h}" || exit 1
FOLIO_NODE="$(command -v node 2>/dev/null)"
if [[ -z "$FOLIO_NODE" && -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  FOLIO_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ -z "$FOLIO_NODE" ]]; then
  print 'Folio needs Node.js 20 or newer. Install it from https://nodejs.org, then run this launcher again.'
  read '?Press Return to close.'
  exit 1
fi
print 'Your Folio workspace: http://localhost:5173'
print 'Keep this terminal open. Press Control-C to stop the server.'
exec "$FOLIO_NODE" server.mjs
