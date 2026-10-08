Closes #

## Summary

<!-- 1-3 bullets: what changed and why -->
-

## Type of change

- [ ] Bug fix
- [ ] New feature or new plugin
- [ ] Breaking change (a setting, log field, or command renamed or removed)
- [ ] Documentation / chore

## Checks (each plugin touched)

- [ ] `claude plugin validate plugins/<name>`: no refusals
- [ ] `tsc -p plugins/<name>`: zero errors
- [ ] `claude plugin test plugins/<name>`: all pass, full line and branch coverage, none skipped

## Live verification

<!-- What you ran in a real session (`claude --plugin-dir ...`), what appeared on screen, and the
decision-log records it wrote. -->

**Not verified:**
<!-- List anything you could not check live. "Nothing" is a valid answer. -->

## Checklist

- [ ] Tests added or updated
- [ ] The plugin's README updated (settings, log fields, behavior)
- [ ] New plugin: `.claude-plugin/marketplace.json` entry added
