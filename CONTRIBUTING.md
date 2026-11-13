# Contributing

## Ownership and organization

- Use `services/<service>/<platform>/`, with service and platform READMEs.
- Keep service defaults in [one source](services/devbox/config/defaults.json);
  reusable definitions belong in [framework schemas](framework/schemas/configuration.schema.json).
- Update the [service schema](services/devbox/config/schema.json), defaults,
  runtime validation, and tests together. Native validation descriptors are
  generated from the schema, not maintained in parallel tables.
- Edit native authoring sources, not `output/`. The build embeds configuration
  helpers and the Windows worker; generated files are never committed.
- Add no placeholder OS folders, unimplemented GUI, or speculative shared engine.
- Keep documentation with its owner. Cross-service standards live in
  [the framework](framework/README.md), not duplicate configuration tables.

## Local checks

Use Node.js 22.16+, Bash, ShellCheck, and PowerShell. Node and npm packages are
build/test dependencies only.

```text
npm ci --ignore-scripts
npm test
npm run check
```

`npm run check` builds the standalone scripts, runs Markdownlint, validates JSON
and local Markdown links, enforces LF, parses PowerShell/Bash, and runs ShellCheck
against sources and the generated macOS payload. Markdownlint uses its API and
the explicit source inventory rather than CLI glob dependencies; the patched
KaTeX override is covered by a parser compatibility test. On Windows it uses Git for
Windows Bash, not WSL; set `BOS_BASH` if Git is installed elsewhere.
Windows CI installs the official ShellCheck 0.10.0 ZIP after verifying its pinned
SHA-256, without an elevated package-manager installation.
Package unit tests mock Apple command boundaries and exercise release-gate
failure propagation and same-directory publication staging without invoking
Apple tools or installing a package.
They do not prove native signing, notarization, or PKG behavior.
Portable shell tests also inject restore-publication failures with automatic
error exit disabled, matching automatic recovery. Failed publication must not
report success or mark recovery complete; validated staging remains available.

GhostBSD Remote Access build/schema, guest contracts and Windows-only operator
mocks run through `npm test`. They use private temporary fixtures and never
install guest packages, call a real SSH endpoint, change a VM or open an RDP
session. Source and generated backends are covered by `npm run check`.
Follow the service's [disposable native gate](services/ghostbsd-remote-access/README.md#validation-and-native-integration-gate)
before deployment; shell mocks on Linux/macOS/Windows do not certify GhostBSD
or a hypervisor.

Work IQ bootstrap tests also run through `npm test`, or independently with
`node --test tools/tests/workiq.test.mjs`. They mock every Azure CLI call and
never authenticate, create enterprise applications, or grant actual consent.
Follow the [disposable tenant gate](services/workiq/README.md#validation) before
administrative rollout; do not test apply against a configured production tenant.

Windows, in separate noninteractive PowerShell processes:

```powershell
powershell.exe -NoProfile -NonInteractive -File .\services\devbox\windows\tests\configuration.ps1
powershell.exe -NoProfile -NonInteractive -File .\services\devbox\windows\tests\resize-devbox.ps1
powershell.exe -NoProfile -NonInteractive -File .\services\devbox\windows\tests\scheduled-task.ps1
```

The configuration/storage suites use private temporary files and mocked APIs.
The Windows-only scheduled-task suite creates native CIM objects in memory;
it never registers or enumerates tasks. No elevation or live Devbox installation
is needed. Parse every changed PowerShell file with
`System.Management.Automation.Language.Parser` and use `Invoke-ScriptAnalyzer`
when available. Parser errors must be checked, not discarded.

## Rust checks

The [shared Rust framework](framework/README.md#rust-framework) uses the pinned
SDK/components in [rust-toolchain.toml](rust-toolchain.toml). Keep
[Cargo.lock](Cargo.lock) committed for reproducible CLI builds; do not commit
`target/` or copy private profiles into compile-time resources.

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --release --locked
```

The aliases `npm run check:rust`, `npm run test:rust`, and `npm run build:rust`
run these same checks/builds. Rust is optional for native script generation,
but required when changing Rust code or embedded contracts. Tests cover both
service defaults, schema/merge parity, numeric spelling, supported backends,
read-only previews, CLI errors and independent execution outside a checkout.
They do not run native endpoint operations.

Use a complete native SDK: on Windows the MSVC Rust toolchain with C++ Build
Tools is recommended; GNU needs matching MinGW/LLVM binutils on PATH.
The linker-only GCC shipped inside Rust is not a complete GNU SDK. Local GNU
validation used the official LLVM utilities and `rust-lld` with the stable
`ld.lld` flavor and `link-self-contained=yes`; no nightly/bootstrap flags or
workstation-specific linker paths are added to the repository.

Update schemas/defaults and Rust types/tests together. Reuse the embedded
catalogue instead of adding handwritten default/validation tables. Keep core
APIs free of endpoint I/O, privilege changes and subprocess execution.
New runtime mutations need separate native safety, preview and migration
evidence; a conceptual plan is not authorization to execute them.

## Additional native checks

Linux or macOS, portable hashing and validation-dispatch contracts:

```bash
bash services/devbox/macos/tests/contracts.sh
```

macOS, native configuration, scheduler serialization, and PKG construction:

```bash
bash services/devbox/macos/tests/configuration.sh
bash tools/package-macos.sh --unsigned
```

The configuration suite covers typed scalar/array overrides, rejects trailing
line feeds in profiles, legacy settings and environment values, and checks
legacy-state migration without calling launchctl. Unsigned PKGs are validation
artifacts only. Never install one on a configured workstation as a shortcut.

When changing workflows, also run:

```text
yamllint -c .yamllint.yml .github/workflows/validate.yml .yamllint.yml
actionlint .github/workflows/validate.yml
```

## Native integration gate

Before a fleet rollout, use disposable native endpoints:

1. Inspect configuration and status/detection.
2. Preview where supported: Windows `-WhatIf`; macOS `--dry-run resize` only.
3. Apply, then apply again and confirm convergence.
4. Back up, validate, and restore a canary workspace.
5. Exercise busy-volume, interruption, and partial-growth recovery.
6. Verify safe uninstall and the platform-specific deployment rollback.

Run the [macOS capacity suite](services/devbox/macos/README.md#capacity-regression-tests)
on a supported Mac, and validate real Windows 11 ReFS/VHDX operations in a VM.
Mocks do not prove native disk behavior. CI deliberately does not install the
service, register actual tasks/agents, or mutate a runner's existing disks.

## Change boundaries

- Use LF; preserve executable Git modes when moving Bash entry points.
- Keep mutating PowerShell operations behind `SupportsShouldProcess`.
- New mutating shell modes need `--dry-run`; existing macOS install/repair,
  backup, uninstall, and purge do not have complete previews.
- Never test image creation, deletion, retention, or scheduler registration on
  a production endpoint or the developer's configured workstation.
- Preserve concurrency guards, strict error handling, atomic staging, and the
  user/elevation boundary. Report cleanup failures explicitly.
- Defaults, schemas, privilege scope, and installed paths are deployed contracts:
  describe migrations and obtain approval before changing them.
- Never commit generated packages, private profiles, endpoint state, logs,
  certificates, signing keys, tokens, or real endpoint identifiers.
