# Changelog

- 2026-10-28 dsh-gitlab-assigned: Find the settings directory without the profile variables — fall back to the loader's profile directory and then the harness home, so saving works in the desktop app, whose Host process never sees `DSH_PROFILE_DIR`
- 2026-10-28 dsh-gitlab-assigned: Edit the GitLab token on the Settings page — stored beside the profile, never sent back to the browser, with a clear action and a hint saying which source (settings, plugin config or `GITLAB_TOKEN`) is in force
- 2026-10-28 dsh-gitlab-assigned: Rename the plugin from gitlab-assigned-mrs to dsh-gitlab-assigned — repository, package name, Host/plugin id, locale namespace and settings directory; settings stored under the old directory are still read.
- 2026-10-27 gitlab-assigned-mrs: Support configuring the GitLab URL on the settings page
- 2026-10-27 gitlab-assigned-mrs: Leave the published defaults empty
- 2026-10-27 gitlab-assigned-mrs: Add global tool listing merge requests assigned to you
- 2026-10-27 gitlab-assigned-mrs: Add sidebar panel grouped by day with incremental loading
- 2026-10-27 gitlab-assigned-mrs: Add settings page for the project list
- 2026-10-27 gitlab-assigned-mrs: Add hash-coloured project tags with group disambiguation
- 2026-10-27 gitlab-assigned-mrs: Support toggling day headings between relative and absolute dates
