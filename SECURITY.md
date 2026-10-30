# Security Policy

mkcertWeb manages certificate authorities and private keys, so security
reports are taken seriously and handled ahead of feature work.

## Maintainer and security contact

**Jeff Caldwell** ([@jeffcaldwellca](https://github.com/jeffcaldwellca)) is the
maintainer of mkcertWeb and its security contact.

## Supported versions

Security fixes go into the latest release. Please reproduce against it before
reporting.

| Version | Supported          |
| ------- | ------------------ |
| 5.x     | :white_check_mark: |
| < 5.0   | :x:                |

## Reporting a vulnerability

**Please don't open a public issue for security problems.**

Report privately through either channel:

- **GitHub:** [Report a vulnerability](https://github.com/jeffcaldwellca/mkcertWeb/security/advisories/new)
  (Security tab → "Report a vulnerability")
- **Email:** jeff@somecorp.dev, with "mkcertWeb security" in the subject

Include:

- the affected version (and whether you're running in Docker)
- steps to reproduce, or a proof of concept
- the impact you think it has (e.g. CA key exposure, path traversal, auth bypass)

## What to expect

- Acknowledgement within 3 business days.
- An initial assessment within 7 days, including whether it's accepted as a
  vulnerability.
- A fix in a patch release, a GitHub security advisory, and a CVE where
  warranted. Reporters are credited unless they'd rather not be.

Please give the fix a chance to ship before disclosing publicly; 90 days is the
default window, and we can agree on a different one if needed.

## Scope

In scope: this repository's code, the published Docker image, and its default
configuration. That includes the web UI and API, authentication and SSO, SCEP
enrollment, and handling of CA and certificate files.

Out of scope: vulnerabilities in [mkcert](https://github.com/FiloSottile/mkcert)
itself (report those upstream), deployments that expose the UI to the internet
with authentication disabled, and findings that need an already-compromised
host.
