import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = await readFile(new URL('../bootstrap-tenant.sh', import.meta.url), 'utf8');
const bash = process.env.BOS_BASH ?? (process.platform === 'win32'
  ? join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe') : 'bash');
const tenant = '00000000-0000-4000-8000-000000000001';
const workiq = '00000000-0000-4000-8000-000000000002';
const vscode = '00000000-0000-4000-8000-000000000003';
const scopes = 'WorkIQ.Read WorkIQ.Act WorkIQSettings.Read.All WorkIQSettings.ReadWrite.All WorkIQAgent.Ask.Selected WorkIQAgent.Ask';

const mocks = `
az() {
  printf '%s\\n' "$*" >> calls
  case "$*" in
    'account show '*)
      if [[ "\${MOCK_FAIL:-}" == account-read && ! -f logged-in ]]; then
        printf 'fixture account-read failure\\n' >&2
        return 47
      fi
      if [[ -f logged-in ]]; then
        printf '%s\\n' "\${MOCK_LOGIN_TENANT:-$MOCK_TENANT}"
      else
        printf '%s\\n' "\${MOCK_CURRENT_TENANT:-$MOCK_TENANT}"
      fi
      ;;
    'login '*)
      printf 'LOGIN\\n' >> mutations
      if [[ "\${MOCK_FAIL:-}" == login ]]; then
        printf 'fixture login failure\\n' >&2
        return 48
      fi
      touch logged-in
      ;;
    'ad sp list '*|'ad sp create '*)
      local name id step
      if [[ "$*" == *fdcc1f02-fc51-4226-8753-f668596af7f7* ]]; then
        name=workiq; id="$MOCK_WORKIQ"
      elif [[ "$*" == *aebc6443-996d-45c2-90f0-388ff96faa56* ]]; then
        name=vscode; id="$MOCK_VSCODE"
      else
        printf 'Unexpected application: %s\\n' "$*" >&2
        return 41
      fi
      if [[ "$*" == 'ad sp list '* ]]; then
        step=sp-list
        if [[ "\${MOCK_MISSING_SPS:-false}" != true || -f "$name" ]]; then printf '%s\\n' "$id"; fi
      else
        step=sp-create
        printf 'CREATE_SP %s\\n' "$name" >> mutations
        touch "$name"
        printf '%s\\n' "$id"
      fi
      if [[ "\${MOCK_FAIL:-}" == "$step" ]]; then
        printf 'fixture %s failure\\n' "$step" >&2
        return 42
      fi
      ;;
    'rest '*)
      local method='' url='' body='' step
      shift
      while (( $# )); do
        case "$1" in
          --method) method="$2"; shift 2 ;;
          --url) url="$2"; shift 2 ;;
          --body) body="$2"; shift 2 ;;
          --headers|--query|--output) shift 2 ;;
          *) printf 'Unexpected rest argument: %s\\n' "$1" >&2; return 43 ;;
        esac
      done
      if [[ "$method" == GET && "$url" == *'?'* ]]; then
        step=grant-list
        printf '%s\\n' "$url" > grant-url
        if [[ "$url" != *"consentType%20eq%20'AllPrincipals'"* ]]; then
          printf 'user-grant\\n'
        elif [[ "\${MOCK_GRANT:-false}" == true || -f grant-created ]]; then
          printf '%s\\n' "\${MOCK_GRANT_IDS:-tenant-grant}"
        fi
      elif [[ "$method" == GET && "$url" == */tenant-grant ]]; then
        step=grant-read
        if [[ -f grant-created ]]; then printf '%s\\n' "$MOCK_SCOPES"; else printf '%s\\n' "\${MOCK_EXISTING_SCOPES:-}"; fi
      elif [[ "$method" == POST || "$method" == PATCH ]]; then
        step=grant-write
        printf '%s %s\\n' "$method" "$url" >> mutations
        printf '%s\\n' "$body" > request.json
        if [[ "$method" == POST ]]; then touch grant-created; fi
      else
        printf 'Unexpected Graph request: %s %s\\n' "$method" "$url" >&2
        return 44
      fi
      if [[ "\${MOCK_FAIL:-}" == "$step" ]]; then
        printf 'fixture %s failure\\n' "$step" >&2
        return 45
      fi
      ;;
    *) printf 'Unexpected Azure CLI call: %s\\n' "$*" >&2; return 46 ;;
  esac
}
`;

async function fixture(action) {
  const directory = await mkdtemp(join(tmpdir(), 'bos-workiq-'));
  try {
    const run = async (args, environment = {}) => {
      await Promise.all(['calls', 'mutations'].map(name => writeFile(join(directory, name), '')));
      const result = spawnSync(bash, ['--noprofile', '--norc', '-s', '--', ...args], {
        cwd: directory,
        input: mocks + source,
        encoding: 'utf8',
        env: {
          ...process.env, MOCK_TENANT: tenant, MOCK_WORKIQ: workiq, MOCK_VSCODE: vscode,
          MOCK_SCOPES: scopes, ...environment
        },
        timeout: 120000
      });
      if (result.error) throw result.error;
      return {
        ...result,
        calls: await readFile(join(directory, 'calls'), 'utf8'),
        mutations: await readFile(join(directory, 'mutations'), 'utf8')
      };
    };
    await action(run, directory);
  } finally {
    await rm(directory, { recursive: true });
  }
}

test('Work IQ creates service principals and tenant-wide consent, then converges', async () => {
  await fixture(async (run, directory) => {
    const environment = { MOCK_MISSING_SPS: 'true' };
    const first = await run(['--apply', tenant], environment);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.mutations, /CREATE_SP workiq\nCREATE_SP vscode\nPOST /);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'request.json'), 'utf8')), {
      clientId: vscode, consentType: 'AllPrincipals', principalId: null, resourceId: workiq, scope: scopes
    });
    const url = await readFile(join(directory, 'grant-url'), 'utf8');
    assert.ok(url.includes(`clientId%20eq%20'${vscode}'`));
    assert.ok(url.includes(`resourceId%20eq%20'${workiq}'`));
    assert.ok(url.includes("consentType%20eq%20'AllPrincipals'"));
    const second = await run(['--apply', tenant], environment);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.mutations, '');
    assert.match(second.stderr, /already contains all required scopes/);
  });
});

test('Work IQ preserves unrelated scopes and normalizes duplicates and whitespace', async () => {
  await fixture(async (run, directory) => {
    const result = await run(['--apply', tenant], {
      MOCK_GRANT: 'true', MOCK_EXISTING_SCOPES: 'Extra.Scope\\Quoted"Value\tWorkIQ.Read\r\nWorkIQ.Read'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.mutations, /^PATCH https:\/\/graph.microsoft.com\/v1.0\/oauth2PermissionGrants\/tenant-grant\n$/);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'request.json'), 'utf8')), {
      scope: `Extra.Scope\\Quoted"Value ${scopes}`
    });
  });
});

test('Work IQ does not rewrite a complete grant with a different scope order', async () => {
  await fixture(async run => {
    const result = await run(['--apply', tenant], {
      MOCK_GRANT: 'true', MOCK_EXISTING_SCOPES: `Extra.Scope ${scopes.split(' ').reverse().join(' ')}`
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.mutations, '');
  });
});

test('Work IQ previews creation and updates without login or mutations', async () => {
  for (const environment of [
    {},
    { MOCK_MISSING_SPS: 'true' },
    { MOCK_GRANT: 'true', MOCK_EXISTING_SCOPES: 'Extra.Scope' }
  ]) {
    await fixture(async run => {
      const result = await run([tenant], environment);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.mutations, '');
      assert.match(result.stderr, /Would (create|update)/);
      assert.doesNotMatch(result.stdout, /You can now retry/);
      if (environment.MOCK_MISSING_SPS) assert.doesNotMatch(result.calls, /rest /);
    });
  }
});

test('Work IQ refuses another tenant during preview and verifies apply login', async () => {
  const otherTenant = '00000000-0000-4000-8000-000000000099';
  await fixture(async run => {
    const preview = await run(['--dry-run', tenant], { MOCK_CURRENT_TENANT: otherTenant });
    assert.notEqual(preview.status, 0);
    assert.equal(preview.mutations, '');
    assert.doesNotMatch(preview.calls, /ad sp|rest /);
    const apply = await run(['--apply', tenant], { MOCK_CURRENT_TENANT: otherTenant });
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(apply.mutations, /^LOGIN\nPOST /);
  });
  await fixture(async run => {
    const result = await run(['--apply', tenant], {
      MOCK_CURRENT_TENANT: otherTenant, MOCK_LOGIN_TENANT: otherTenant
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.mutations, 'LOGIN\n');
    assert.doesNotMatch(result.calls, /ad sp|rest /);
  });
});

test('Work IQ rejects missing or invalid arguments before calling Azure CLI', async () => {
  await fixture(async run => {
    for (const args of [[], ['not-a-uuid'], ['', tenant], ['--unknown', tenant], ['--apply', '--dry-run', tenant], [tenant, tenant]]) {
      const result = await run(args);
      assert.notEqual(result.status, 0);
      assert.equal(result.calls, '');
      assert.match(result.stderr, /ERROR:/);
    }
  });
});

test('Work IQ reports an unreadable account and only recovers with an explicit apply', async () => {
  await fixture(async run => {
    const preview = await run([tenant], { MOCK_FAIL: 'account-read' });
    assert.notEqual(preview.status, 0);
    assert.match(preview.stderr, /fixture account-read failure/);
    assert.equal(preview.mutations, '');
    const apply = await run(['--apply', tenant], { MOCK_FAIL: 'account-read' });
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(apply.stderr, /fixture account-read failure/);
    assert.match(apply.mutations, /^LOGIN\nPOST /);
  });
});

test('Work IQ rejects ambiguous grant IDs instead of choosing the first', async () => {
  await fixture(async run => {
    const result = await run(['--apply', tenant], {
      MOCK_GRANT: 'true', MOCK_GRANT_IDS: 'tenant-grant\nanother-grant'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ambiguous response/);
    assert.equal(result.mutations, '');
  });
});

test('Work IQ propagates lookup and mutation failures, including captured commands', async () => {
  for (const failure of ['login', 'sp-list', 'sp-create', 'grant-list', 'grant-read', 'grant-write']) {
    await fixture(async run => {
      const result = await run(['--apply', tenant], {
        MOCK_FAIL: failure,
        MOCK_CURRENT_TENANT: failure === 'login' ? '00000000-0000-4000-8000-000000000099' : tenant,
        MOCK_MISSING_SPS: failure === 'sp-create' ? 'true' : 'false',
        MOCK_GRANT: 'true', MOCK_EXISTING_SCOPES: 'WorkIQ.Read'
      });
      assert.notEqual(result.status, 0, failure);
      assert.ok(result.stderr.includes(`fixture ${failure} failure`), result.stderr);
      assert.doesNotMatch(result.stdout, /Done|You can now retry/);
      if (['login', 'sp-list', 'sp-create'].includes(failure)) assert.doesNotMatch(result.calls, /rest /);
    });
  }
});
