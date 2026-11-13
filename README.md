# Blackout Secure Endpoint Toolkit

Source: [blackoutsecure/endpoint-toolkit](https://github.com/blackoutsecure/endpoint-toolkit).
The source-repository rename does not change the `bos-endpoint-toolkit` CLI,
crate/package identities, endpoint installed paths or service contracts.

[![Made by BlackoutSecure](https://img.shields.io/badge/made%20by-BlackoutSecure-1f1f1f)](https://github.com/blackoutsecure)

Service-first endpoint automation with shared configuration contracts and native
platform backends. Deployment scripts do not require Node.js, Rust, a resident
toolkit agent, or a particular management platform.
The optional compiled Rust CLI shares configuration and read-only planning;
it does not replace native privilege boundaries or require a Rust runtime.

## Services

| Service | Purpose | Implemented platforms |
| --- | --- | --- |
| [Devbox](services/devbox/README.md) | Disk-image-backed development workspaces, mounting, and backups | [Windows](services/devbox/windows/README.md), [macOS](services/devbox/macos/README.md) |
| [GhostBSD Remote Access](services/ghostbsd-remote-access/README.md) | MATE/XRDP guest setup, SSH onboarding, VM checks, and tunneled desktop access | [GhostBSD guest](services/ghostbsd-remote-access/ghostbsd/README.md), [Windows operator](services/ghostbsd-remote-access/windows/README.md) |
| [Work IQ tenant bootstrap](services/workiq/README.md) | Service principals and tenant-wide VS Code delegated consent for Work IQ | [Bash CLI](services/workiq/bash/README.md) |

Linux is a future backend, not an implemented or certified Devbox platform.
Portable policy tests run on Ubuntu; that does not imply Linux storage support.
Devbox is not the Microsoft Dev Box cloud service or a compliance scanner.

## Organization

```text
framework/
  README.md                  Shared behavior and deployment contracts
  schemas/                   Reusable configuration definitions
  crates/endpoint-core/      Rust service/configuration contracts and pure plans
  crates/endpoint-cli/       Read-only Rust command-line frontend
services/
  devbox/
    README.md                Service purpose and cross-platform contract
    service.json             Native implementation versions
    config/                  Defaults and desired-configuration schema
    windows/                 Native PowerShell sources and tests
    macos/                   Native Bash sources and tests
  ghostbsd-remote-access/
    README.md                Remote-access contract and archive migration
    service.json             Native implementation versions
    config/                  Build-time defaults and schema
    ghostbsd/                Guest Bash backend and portable contracts
    windows/                 PowerShell operator and safe mocks
  workiq/
    README.md                Tenant consent contract and safety
    bash/                    Standalone administrator script and mocked tests
tools/                       Repository-only build, packaging, and validation
output/                      Generated, ignored deployment artifacts
Cargo.toml Cargo.lock        Shared Rust workspace and locked dependencies
rust-toolchain.toml          Pinned build-machine Rust SDK/components
target/                      Ignored Cargo build artifacts
```

A service is an operational capability, not necessarily a background daemon.
Code, tests, and platform usage guidance live with their service. There is no
separate documentation index duplicating these READMEs. Add a platform or shared
runtime library only when it has a real implementation and tests.

## Build deployable scripts

On a development/build machine with Node.js 22.16 or later:

```text
npm ci --ignore-scripts
npm run build
npm test
```

The build validates [shared defaults](services/devbox/config/defaults.json)
against the [service schema](services/devbox/config/schema.json), follows local
schema references, and embeds native validators and required resources. Windows
remediation embeds the one authored worker automatically. No package installation
occurs on endpoints.

The default build also generates [GhostBSD Remote Access](services/ghostbsd-remote-access/README.md)
under `output/ghostbsd-remote-access/`. Its Windows operator embeds the guest
backend; no original setup ZIP or adjacent helper scripts are required.

Deploy the generated scripts under `output/devbox/windows/` or
`output/devbox/macos/`, not the authoring templates under `services/`.
Do not deploy a checkout or depend on adjacent repository files.

The [Work IQ tenant bootstrap](services/workiq/bash/README.md) is already a
standalone script, not a generated backend. Run or copy it directly; tenant
changes require an explicit tenant UUID and `--apply`.

An optional partial deployment profile can set defaults for a new installation:

```text
npm run build -- --config path-to-profile.json
```

Existing persisted desired configuration takes precedence over packaged defaults.
To reconfigure an installed endpoint, explicitly supply a profile using the
platform entry point; rebuilding alone is not a policy override.

## Documentation and deployment

- [Devbox configuration and migration](services/devbox/README.md)
- [Windows detection, remediation, and scheduled worker](services/devbox/windows/README.md)
- [macOS CLI and managed PKG deployment](services/devbox/macos/README.md)
- [Framework standards and extension boundaries](framework/README.md)
- [GhostBSD guest setup and Windows remote-access operator](services/ghostbsd-remote-access/README.md)
- [Work IQ tenant-wide VS Code consent](services/workiq/README.md)
- [Contributing and validation](CONTRIBUTING.md)

For macOS fleets, the build stages a PKG payload with a user-session initialization
LaunchAgent. Packaging supports Developer ID Installer signing, notarization, and
stapling. A `.app` is not required for automation; add a GUI only if there is a
user-facing need.

## Rust CLI

The [Rust framework](framework/README.md#rust-framework) resolves the same
authored defaults/schemas for Devbox and GhostBSD Remote Access and produces read-only native
adapter plans. It does not install packages, elevate, run SSH, or execute the
listed native operations. There is no Rust `apply` command.

With the pinned Rust SDK and a complete native linker toolchain:

```text
cargo run --locked -- services
cargo run --locked -- configuration --service ghostbsd-remote-access
cargo run --locked -- plan --service ghostbsd-remote-access --platform windows --operation apply --user desktop
npm run check:rust
npm run test:rust
npm run build:rust
```

`desktop` is an example explicit existing account, not a default or an account
created by the CLI. `--config` selects an explicit partial JSON profile.
There is no implicit lookup of installed or private configuration.
Release binaries are under `target/release/`; they embed public schemas,
defaults and service metadata and run without Cargo, Node.js or a checkout.
Native script generation remains independently available through `npm run build`.

## Safety

- Inspect configuration and status before applying changes.
- Preserve native privilege boundaries: Windows is elevated; macOS refuses root.
- Keep disk formats, installed paths, and backups stable across source moves.
- Validate on disposable native endpoints before production rollout.
- Do not embed credentials, inventories, tenant IDs, or internal endpoints.
- Never interpret a syntax check, mock suite, unsigned package, or skipped native
  test as evidence of a production-ready deployment.
