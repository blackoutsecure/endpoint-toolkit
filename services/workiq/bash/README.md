# Work IQ bootstrap with Bash

## Prerequisites

- Bash 3.2 or newer and standard `awk`, `tr`, and `paste` utilities, as provided
  by macOS, Linux, or Git Bash on Windows.
- Azure CLI (`az`) on `PATH`, using the public Microsoft Graph cloud.
- An approved tenant administrator authorized to create service principals and
  grant the [documented Work IQ scopes](../README.md) for all users.
- An Azure CLI token with the Microsoft Graph access needed to read/create
  service principals and read/write delegated permission grants. Grant writes
  require `DelegatedPermissionGrant.ReadWrite.All` or a documented higher
  permission. An administrator role alone does not supply token permissions.

The script does not elevate operating-system privileges, create credentials,
assign administrator roles, or grant additional Graph permissions to Azure CLI.
See Microsoft's [delegated grant API](https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-post?view=graph-rest-1.0)
for permission and administrator-role requirements.

## Preview and apply

From the repository root, set `TENANT_ID` locally to the intended tenant UUID;
do not save real tenant IDs or credentials in the repository.

```bash
az login --tenant "$TENANT_ID" --allow-no-subscriptions
bash services/workiq/bash/bootstrap-tenant.sh --dry-run "$TENANT_ID"
bash services/workiq/bash/bootstrap-tenant.sh --apply "$TENANT_ID"
```

Omitting the mode flag also selects preview. Use `--help` for usage.
The [script](bootstrap-tenant.sh) can be copied and run independently of the
checkout; the examples use its repository-relative location only for convenience.

Preview requires an existing Azure CLI login to the selected tenant and never
calls `az login`, creates service principals, or sends Graph `POST`/`PATCH`
requests. It reports planned changes. When a service principal is absent, grant
lookup must wait until its object ID exists; preview reports that limitation
instead of inventing an ID.

Apply signs in with `--allow-no-subscriptions` if no active account can be read
or the active tenant differs. It verifies the active tenant again before any
directory changes. Login, lookup, and mutation errors remain visible and stop
the operation; a failed lookup is not treated as an absent object.

Progress is written to stderr; the final tenant/object-ID summary is on stdout.
Exit zero means a completed preview or successful apply, not proof that Work IQ
authentication works. A nonzero exit indicates failure. On a partial apply,
inspect the reported error and rerun after resolving it; successfully created
objects and existing consent are retained. The script never deletes service
principals or revokes scopes. After successful apply, retry Work IQ auth in
VS Code.

## Portable tests

```text
node --test tools/tests/workiq.test.mjs
bash -n services/workiq/bash/bootstrap-tenant.sh
shellcheck services/workiq/bash/bootstrap-tenant.sh
```

The [tests](tests/bootstrap.test.mjs) intercept every Azure CLI call with a Bash
function and use private temporary fixtures. They cover creation, repeat-run
convergence, tenant-wide versus user consent, scope preservation, previews,
tenant mismatches, CRLF Azure CLI output, ambiguous IDs, and failure propagation.
They do not authenticate or make network requests, and are not a live tenant
integration gate.
