#!/bin/bash
#
# Rebuilds bin/nodejs/deploy.zip with the API server (backend-api), the player (backend-player: since Soloist) and the
# parents' app (mupi-app) of this checkout. The display UI (frontend-box) in the zip stays as it is.
#   bash kidsnext/tools/build-deploy.sh      (needs Node.js and: npm ci --workspace=mupibox-backend-api
#                                             --workspace=mupibox-backend-player)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API="${ROOT}/src/backend-api"
PLAYER="${ROOT}/src/backend-player"
ZIP="${ROOT}/bin/nodejs/deploy.zip"
TMP=$(mktemp -d)
trap 'rm -rf "${TMP}"' EXIT

cd "${API}"
npx esbuild src/server.ts --bundle --minify --platform=node --target=node22 --log-override:empty-import-meta=silent --outfile="${TMP}/server.js"
(cd "${PLAYER}" && npx esbuild src/spotify-control.js --bundle --minify --platform=node --target=node22 --log-level=warning --outfile="${TMP}/spotify-control.js")

python3 - "${ZIP}" "${TMP}" "${API}/src/mupi-app" <<'EOF'
import os, re, shutil, sys, zipfile
zip_path, tmp, app = sys.argv[1:4]
out = os.path.join(tmp, 'deploy.zip')
with zipfile.ZipFile(zip_path) as old, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as new:
    for i in old.infolist():
        if i.filename in ('server.js', 'spotify-control.js') or i.filename.startswith('mupi-app/'):
            continue
        new.writestr(i, old.read(i.filename))
    new.write(os.path.join(tmp, 'server.js'), 'server.js')
    new.write(os.path.join(tmp, 'spotify-control.js'), 'spotify-control.js')
    for root, _, files in os.walk(app):
        for f in sorted(files):
            full = os.path.join(root, f)
            rel = 'mupi-app/' + os.path.relpath(full, app)
            if not re.search(r'_parts|_source', rel):
                new.write(full, rel)
shutil.copy(out, zip_path)
EOF
echo "deploy.zip neu gebaut: $(unzip -l "${ZIP}" | tail -n 1 | awk '{print $2}') Dateien"
