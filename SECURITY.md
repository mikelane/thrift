# Security Policy

## Supported versions

thrift is pre-1.0. Only the latest version of each plugin on `main` receives fixes.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security vulnerability.**

Report it privately through GitHub's private vulnerability reporting: click "Report a
vulnerability" on the [Security tab](https://github.com/mikelane/thrift/security/advisories/new).

These plugins run inside Claude Code sessions. They read session context, run commands such as
`git`, and write a decision log. Reports about any of the following are especially welcome:

- prompt text, file contents, or secrets reaching the decision log;
- the decision log being created readable by anyone other than its owner;
- a command the plugin runs being shaped by prompt or repository content;
- a prompt, draft, or session being lost.

### What to include

- What the vulnerability is and what it could lead to
- Steps to reproduce, with your Claude Code version (`claude --version`)
- Which plugin and version are affected
- A suggested fix, if you have one

### Response timeline

| Milestone | Target |
|---|---|
| Acknowledgement | 48 hours |
| Initial assessment | 5 business days |
| Fix or mitigation | Depends on severity |
| Public disclosure | After the fix is released |

Disclosure is coordinated with you once a fix is available.
