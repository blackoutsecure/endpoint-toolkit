# Work IQ tenant bootstrap

The [standalone Bash script](bash/bootstrap-tenant.sh) prepares Microsoft Entra
tenant-wide delegated consent for Visual Studio Code to access Work IQ.
It is a one-shot administrator tool, not a resident endpoint service.

It ensures these public applications have service principals in the selected
tenant:

| Application | Application ID |
| --- | --- |
| Work IQ | `fdcc1f02-fc51-4226-8753-f668596af7f7` |
| Visual Studio Code | `aebc6443-996d-45c2-90f0-388ff96faa56` |

It creates or extends only the `AllPrincipals` delegated consent grant from the
VS Code service principal to the Work IQ service principal, adding:

```text
WorkIQ.Read
WorkIQ.Act
WorkIQSettings.Read.All
WorkIQSettings.ReadWrite.All
WorkIQAgent.Ask.Selected
WorkIQAgent.Ask
```

Existing scopes are preserved and duplicate scope names are normalized when
merging. User-specific grants are not changed. Repeated application makes no
changes when both service principals and all required scopes already exist.
These permissions include actions and settings writes for all tenant users;
review the complete scope list before approving consent.

## Usage and safety

See the [Bash usage guide](bash/README.md) for prerequisites, preview and apply
commands, and authentication behavior. A tenant UUID is always explicit; no
organization's tenant is embedded. Preview is the default, and changes require
`--apply`. Preview never logs in or changes directory objects.

This script is already standalone. It needs no generation, adjacent files,
Node.js, Rust, daemon, or scheduled task at runtime. It is not part of the
generated Devbox/remote-access packages or the Rust service catalogue.

## Validation

The [mocked tests](bash/tests/bootstrap.test.mjs) run through `npm test` and do
not invoke Azure CLI, Microsoft Graph, or an actual tenant. `npm run check`
includes Bash syntax, ShellCheck, and documentation checks.

Before administrative rollout, use a disposable test tenant with approved
permissions: preview, apply, inspect the enterprise applications and tenant-wide
grant, then apply again to confirm convergence. Mocks do not certify live tenant
permissions, application availability, or Work IQ authentication.
