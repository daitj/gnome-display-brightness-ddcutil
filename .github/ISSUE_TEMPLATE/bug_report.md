---
name: Bug report
about: Create a report to help us improve
title: ''
labels: ''
assignees: ''

---

**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:

**Delete cache file if it exists and try again**
Delete `$XDG_CACHE_HOME/ddcutil_detect` which generally is `~/.cache/ddcutil_detect` and try to run extension again.

**Journal logs**
You need to enable `Verbose debugging` from this extension's settings and then reload this extension first.
```
journalctl --no-pager -b /usr/bin/gnome-shell
Run above command and paste the log here 
```
**Screenshots**
If applicable, add screenshots to help explain your problem.

**Desktop (please complete the following information):**
 - OS: [e.g. Debian]
 - Version [e.g. 11]
 - GNOME version [e.g. 40.1]
 - Extension version [eg: 10]

**Additional context**
Add any other context about the problem here.
