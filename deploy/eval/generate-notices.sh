#!/usr/bin/env bash
# Regenerate deploy/eval/THIRD-PARTY-NOTICES.txt from the current lockfile.
#
# Lists the PRODUCTION dependencies that ship in the Procela backend + frontend
# images, with each package's license and bundled license text. Re-run after a
# dependency change and before cutting an evaluation release.
#
#   npm install            # ensure node_modules is present
#   bash deploy/eval/generate-notices.sh
#
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
OUT="deploy/eval/THIRD-PARTY-NOTICES.txt"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# 1. The production dependency names that ship (backend + frontend).
npm ls -w packages/backend -w packages/frontend --omit=dev --all --parseable 2>/dev/null \
  | sed 's|.*/node_modules/||' | grep -v '^/' | sort -u > "$TMP/shipped.txt"

# 2. License metadata for the installed tree.
npx --yes license-checker --json > "$TMP/lic.json" 2>/dev/null

# 3. Assemble the notices.
python3 - "$TMP/shipped.txt" "$TMP/lic.json" "$OUT" <<'PY'
import json, os, sys
shipped_file, lic_file, out_file = sys.argv[1], sys.argv[2], sys.argv[3]
lic = json.load(open(lic_file))
names = {l.strip() for l in open(shipped_file) if l.strip()}
# first-party workspace packages are not third-party notices
FIRST_PARTY = ('@procela/', 'procela@')
from collections import defaultdict, Counter
byname = defaultdict(list)
for k in lic:
    byname[k.rsplit('@', 1)[0]].append(k)
keys = sorted({k for nm in names for k in byname.get(nm, [])
               if not k.startswith(FIRST_PARTY)})
def spdx(v):
    L = v.get('licenses'); return '+'.join(L) if isinstance(L, list) else (L or 'UNKNOWN')
dist = Counter(spdx(lic[k]) for k in keys)
o = []; w = o.append
w("PROCELA — THIRD-PARTY SOFTWARE NOTICES")
w("=" * 72); w("")
w("Procela is distributed with the open-source components listed below. Each")
w("remains the property of its respective authors and is used under the license")
w("shown with it. This file covers the PRODUCTION dependencies that ship in the")
w("Procela backend and frontend images; regenerate it with")
w("deploy/eval/generate-notices.sh after any dependency change."); w("")
w(f"Packages: {len(keys)}"); w(""); w("LICENSE SUMMARY"); w("-" * 72)
for l, n in dist.most_common(): w(f"  {n:4d}  {l}")
w(""); w("=" * 72); w("COMPONENTS"); w("=" * 72)
for k in keys:
    v = lic[k]; name, ver = k.rsplit('@', 1); repo = v.get('repository', '')
    w(""); w("-" * 72); w(f"{name}  {ver}"); w(f"License: {spdx(v)}")
    if repo: w(f"Repository: {repo}")
    lf = v.get('licenseFile'); text = None
    if lf and os.path.isfile(lf) and os.path.basename(lf).lower().startswith(('license', 'licence', 'copying')):
        try: text = open(lf, encoding='utf-8', errors='replace').read().strip()
        except Exception: text = None
    w("")
    w(text if text else f"(No bundled license file; see {repo or 'the package repository'} for the full text.)")
open(out_file, "w").write("\n".join(o) + "\n")
print(f"wrote {out_file}: {len(keys)} packages, {len(dist)} license families")
PY
