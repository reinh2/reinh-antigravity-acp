#!/usr/bin/env python3
"""Local-only checks; no plugin install, Google connection, or network audit."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import time

root = Path(__file__).resolve().parent.parent
out = root / 'qa' / 'evidence'
out.mkdir(parents=True, exist_ok=True)
checks = [
    ('npm-test', ['npm', 'test'], {}),
    ('typecheck', ['npx', 'tsc', '--noEmit'], {}),
    ('build', ['npm', 'run', 'build'], {}),
    ('bundle-integration', ['node', '--import', 'tsx', '--test', 'tests/bridge-integration.test.ts', 'tests/usage.test.ts', 'tests/permissions.test.ts'], {'REINH_TEST_BUNDLE': '1', 'REINH_TEST_EVIDENCE_DIR': str(out)}),
    ('sdk-pins', ['bb', 'plugin', 'types', '--check'], {}),
    ('diff-check', ['git', 'diff', '--check'], {}),
    ('release-gates', ['node', '--import', 'tsx', '--test', 'qa/upstream-tests/strict-selection.test.ts', 'qa/upstream-tests/native-selection.test.ts', 'qa/runtime-tests/strict-native.test.ts', 'qa/runtime-tests/edge-cases.test.ts'], {'REINH_TEST_BUNDLE': '1', 'REINH_TEST_EVIDENCE_DIR': str(out)}),
    ('audit', ['npm', 'audit', '--omit=dev'], {}),
]
results = []
for name, command, extra in checks:
    start = time.monotonic()
    completed = subprocess.run(command, cwd=root, env={**os.environ, **extra}, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    text = completed.stdout.replace(str(root), '<repo>').replace(str(Path.home()), '<home>')
    (out / f'{name}.log').write_text(text)
    result = {'check': name, 'command': command, 'environment': {key: value.replace(str(root), '<repo>').replace(str(Path.home()), '<home>') for key, value in extra.items()}, 'exitCode': completed.returncode, 'durationSeconds': round(time.monotonic() - start, 3), 'log': f'qa/evidence/{name}.log'}
    results.append(result)
    print(f'{name}: exit {completed.returncode}', flush=True)
(out / 'verification.json').write_text(json.dumps({'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'results': results}, indent=2) + '\n')
raise SystemExit(1 if any(result['exitCode'] for result in results) else 0)
