# AGENTS.md

## OpenCode version on every commit

This plugin patches the OpenCode desktop app, so its behaviour is tied to the
version it was built against.

Every commit that changes the plugin must record the OpenCode version used to
develop and test it. Put it in the commit message body, as the last line:

    OpenCode: 2.1.4

If development and testing happened on different versions, say both:

    OpenCode: 2.1.4 (dev), 2.1.3 (tested)

Rules:

- No version line, no commit: an update without the version it was tested on is
  not a releasable change.
- The version is the OpenCode release the plugin was run on (the desktop app's
  own version), not this plugin's `VERSION` file.
- If the README has a `## Compatibility` section, keep it in sync with the same
  version.
