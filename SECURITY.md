# Security Policy

## Scope

This repository is an experimental local sandbox, not a production system. Its
defaults prioritize local iteration and observability over hardening.

Do not treat the sandbox, its sample configuration, or its default deployment
paths as production-ready security guidance.

## Supported Versions

Security fixes, when they are made, are expected to land on the `development`
branch first.

- `development`: best-effort support
- older branches and historical tags: no guaranteed security support

There is no formal SLA, support contract, or bug bounty for this repository.

## Reporting A Vulnerability

If you believe you found a security issue:

1. Use GitHub private vulnerability reporting for this repository if it is
   enabled.
2. If private reporting is not available, do not post exploit details, secrets,
   or proof-of-compromise data in a public issue. Instead, open a minimal issue
   asking maintainers to establish a private reporting channel.
3. Include the affected component, the commit SHA or branch, reproduction
   steps, expected impact, and any mitigating conditions you observed.

Please keep testing limited to systems and environments you own or are
explicitly authorized to assess.

## What To Expect

- Reports are handled on a best-effort basis.
- Maintainers may ask for clarification, logs, or a reduced reproduction case.
- Because this is a sandbox repository, some findings may be documented as
  accepted non-goals rather than fixed immediately.

## What Not To Send

Do not include:

- private keys, passwords, tokens, or session cookies;
- personal data;
- large database dumps or full environment backups;
- public exploit details before maintainers have had time to review the issue.
