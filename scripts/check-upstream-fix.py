#!/usr/bin/env python3
"""Check a minimal upstream proposal in a separate copy; never patch node_modules."""
import difflib
import hashlib
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
package = root / 'node_modules/@get-bb/plugin-sdk'
assert json.loads((package / 'package.json').read_text())['version'] == '0.6.132'
source = (package / 'dist/provider-bridge-acp.js').read_text()
original_digest = hashlib.sha256(source.encode()).hexdigest()
patched = source
needle = '  const shouldSetModel = modelOption && modelOption.currentValue !== selection.modelId || !modelOption && sessionModelsIncludeSelection && models?.currentModelId !== selection.modelId;'
assert patched.count(needle) == 1
patched = patched.replace(needle, '''  if (!modelOption && !sessionModelsIncludeSelection && models?.currentModelId !== selection.modelId) {
    throw new Error("Requested ACP model is unavailable in the executing session");
  }
''' + needle)
start = patched.index('async function selectAcpNativeReasoning(')
end = patched.index('async function selectAcpNativeServiceTier(', start)
native = patched[start:end]
assert native.count('  } catch {\n    return;\n  }') == 1
native = native.replace('  } catch {\n    return;\n  }', '  } catch {\n    throw new Error("ACP agent could not apply the requested reasoning level");\n  }')
patched = patched[:start] + native + patched[end:]
needle = 'async function handleRequest2(request) {'
assert patched.count(needle) == 1
patched = patched.replace(needle, 'var pendingTurnStarts = new Set();\n' + needle)
start = patched.index('    case "turn/start": {', patched.index(needle))
end = patched.index('    case "turn/steer": {', start)
block = patched[start:end]
head = '    case "turn/start": {\n      const params = request.params;\n'
assert block.startswith(head)
rest = block[len(head):]
assert rest.endswith('      return;\n    }\n')
rest = rest[:-len('    }\n')]
block = head + '''      if (pendingTurnStarts.has(params.threadId)) {
        sendError(request.id, -32000, "A turn start is already applying execution settings");
        return;
      }
      pendingTurnStarts.add(params.threadId);
      try {
''' + ''.join('  ' + line if line.strip() else line for line in rest.splitlines(keepends=True)) + '''      } finally {
        pendingTurnStarts.delete(params.threadId);
      }
    }
'''
patched = patched[:start] + block + patched[end:]
proposal = root / 'qa/upstream-proposal'
proposal.mkdir(parents=True, exist_ok=True)
(proposal / 'provider-bridge-acp-0.6.132.patch').write_text(''.join(difflib.unified_diff(source.splitlines(True), patched.splitlines(True), fromfile='a/provider-bridge-acp.js', tofile='b/provider-bridge-acp.js', n=3)))
release = root / '.release/upstream-proof'
release.mkdir(parents=True, exist_ok=True)
module = release / 'provider-bridge-acp.mjs'
module.write_text(patched)
# The original SDK module is not touched. Tests load only the isolated copy.
env = {**os.environ, 'REINH_TEST_PATCHED_BRIDGE': str(module), 'REINH_TEST_BUNDLE': '', 'REINH_TEST_EVIDENCE_DIR': str(proposal)}
commands = [
    ['node', '--import', 'tsx', '--test', 'qa/upstream-tests/strict-selection.test.ts', 'qa/upstream-tests/native-selection.test.ts'],
    ['node', '--import', 'tsx', '--test', 'tests/bridge-integration.test.ts'],
]
results = []
for index, command in enumerate(commands):
    result = subprocess.run(command, cwd=root, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log = result.stdout.replace(str(root), '<repo>').replace(str(Path.home()), '<home>')
    (proposal / f'isolated-proof-{index + 1}.log').write_text(log)
    results.append({'command': command, 'exitCode': result.returncode, 'log': f'qa/upstream-proposal/isolated-proof-{index + 1}.log'})
    print(f'isolated upstream proof {index + 1}: exit {result.returncode}', flush=True)
unchanged = hashlib.sha256((package / 'dist/provider-bridge-acp.js').read_bytes()).hexdigest() == original_digest
(proposal / 'proof.json').write_text(json.dumps({'sdkVersion': '0.6.132', 'originalModuleSha256': original_digest, 'originalModuleUnchanged': unchanged, 'note': 'Proposal only. The plugin still uses the unmodified npm SDK. Port this minimal delta to upstream TypeScript, not installed node_modules.', 'results': results}, indent=2) + '\n')
assert unchanged
raise SystemExit(1 if any(r['exitCode'] for r in results) else 0)
