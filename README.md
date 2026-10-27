# GitLab: merge requests assigned to me

One bundle, three surfaces over the same GitLab collector:

| Surface | What it is |
| --- | --- |
| **Sidebar panel** | A `Merge requests` entry in the left navigation. It opens a page in the main column: newest first, grouped by creation day, paging older requests in as you scroll. |
| **Settings page** | `Settings → GitLab MRs`: the GitLab URL and the project list, saved immediately for both the panel and the tool. |
| **Global tool** | `gitlab_assigned_merge_requests`, available to every agent in every workspace. |

All three report the merge requests **assigned** to the user who owns the
configured GitLab token (`scope=assigned_to_me`). The token never reaches the
browser: the pages read loopback JSON routes on the Host
(`/gitlab-mrs/api/list`, `/gitlab-mrs/api/settings`), which are the only things
that talk to GitLab.

The published defaults are **empty** — no GitLab URL, no projects, no token — so
configure the instance first (Settings page, or `cordis.patch.yml`), otherwise the
panel and the tool answer with a "not configured" message.

## Sidebar panel

- The entry sits in the left rail next to `Plugins` and `Automation tasks`; it
  registers into `sidebar.panellist` as id `gitlab-mrs` and into the `main` slot
  with the same key, which is how the shell pairs a sidebar row with a panel.
- The list is **newest first** and grouped by local creation day. Group headings
  default to relative text (`Today`, `Yesterday`, `3 days ago`, `2 weeks ago`);
  clicking one switches every heading to the absolute date (`Fri, 9 Oct 2026`)
  and back, and the choice is remembered.
- Every row starts with a **project tag**: the last path segment
  (`hardware_monitor`). Two projects that share that segment are widened to
  `group/name`, and only a remaining collision shows the full path. The tag
  colour is a stable hash of its text, so a project keeps one colour.
- Each row shows the title, `!iid`, author, `source → target`, note count, how
  long ago it was updated, and its creation time; the row links to the MR on
  GitLab.
- Ten rows load at first. Reaching the bottom loads the next slice, so older
  requests appear a page at a time; a `Load earlier` button covers the case where
  intersection observation is unavailable.
- The `Open / Merged / Closed / All` filter re-queries that state; `Refresh`
  bypasses the Host's 45-second list cache.
- A project that cannot be read is reported inline while the readable projects
  still render. An empty or failing list gets its own message and a `Retry`.

## Settings page

`Settings → GitLab MRs` edits the two values the panel and tool read:

- **GitLab URL** — the instance root, e.g. `https://gitlab.example.com`, with no
  `/api/v4` suffix. Validated as an `http(s)` URL; `Save` stays disabled while it
  is empty or malformed.
- **Projects** — one per line, in any accepted form (see *Project references*
  below).
- `Save` normalises both (`ssh → https` path, `.git`/`/-/tree/...` stripped,
  duplicates dropped) and applies them immediately — no restart.
- `Reset to plugin config` deletes the override and falls back to
  `cordis.patch.yml`.
- The saved values live in
  `$DSH_PROFILE_DIR/gitlab-assigned/settings.json` and survive profile
  restarts and bundle upgrades. (An older `projects.json`, and anything saved
  under the pre-rename `gitlab-assigned-mrs` directory, is still read and is
  rewritten as `settings.json` on the next save.)

The token is **not** edited on this page: it stays in the plugin config or the
`GITLAB_TOKEN` environment variable.

## Project references

Each line/entry may be:

| form | example |
| --- | --- |
| path with namespace | `group/project` |
| numeric project id | `77` |
| https URL | `https://gitlab.example.com/group/project` |
| https URL with extra path | `https://gitlab.example.com/group/project/-/tree/main` |
| ssh remote | `ssh://git@gitlab.example.com:2222/group/project.git` |
| scp-like remote | `git@gitlab.example.com:group/project.git` |

Everything is reduced to the `group/project` path and requested over the
configured GitLab URL (https), so an ssh remote never becomes an ssh request.

## Global tool

`gitlab_assigned_merge_requests` takes two optional arguments:

| argument   | type     | meaning                                                        |
| ---------- | -------- | -------------------------------------------------------------- |
| `projects` | string[] | replace the configured project list for this one call          |
| `state`    | string   | `opened`, `merged`, `closed`, or `all`                          |

The result is one flat list in the configured order (newest first by default),
each entry with project path, MR iid, title, state, draft flag, author,
created/updated timestamps, branches, labels, assignees, votes, notes and URL.

## Configuration

The defaults live in this package's `cordis.patch.yml` and are empty. That file is
**not in git** (it holds the token); `cordis.patch.example.yml` is the committed
template. A fresh clone starts with:

```sh
cp cordis.patch.example.yml cordis.patch.yml   # then fill in baseUrl + token
```

To change the defaults without touching the package (so they survive package
upgrades), add an id-targeted override to the profile patch layer
`$DSH_PROFILE_DIR/cordis.patch.yml`. An override replaces the whole `config`
object, so repeat every key you still need:

```yaml
- id: gitlab-assigned
  name: dsh-gitlab-assigned
  config:
    baseUrl: 'https://gitlab.example.com'
    token: '<your GitLab token>'
    projects:
      - group/project
    defaultState: opened
    order: desc
```

| key            | type            | default                        | meaning                                                        |
| -------------- | --------------- | ------------------------------ | -------------------------------------------------------------- |
| `baseUrl`      | string          | `''` (unset)                   | GitLab instance root, no `/api/v4` suffix                      |
| `token`        | string          | `GITLAB_TOKEN` env, else empty | personal/project access token with `api` or `read_api` scope    |
| `projects`     | string or array | `[]`                           | project references, any form from the table above              |
| `defaultState` | string          | `opened`                       | `opened`, `merged`, `closed`, or `all`                          |
| `order`        | string          | `desc`                         | `desc` = newest first (panel default), `asc` = oldest first      |
| `timeoutMs`    | integer         | `20000`                        | per-request timeout, 1000–120000                                |
| `maxPages`     | integer         | `5`                            | pages of 100 MRs read per project                               |

`projects` also accepts a comma- or newline-separated string. Projects are read
eight at a time so a large config does not burst GitLab's rate limiter.

## Repository

This package is a git checkout of
`git@github.com:kingsimba/dsh-gitlab-assigned.git`, tracking `origin/main`:

```sh
git pull        # update the code; the local cordis.patch.yml is untouched
```

`cordis.patch.yml` is gitignored because it holds the token, so a pull never
conflicts with the credential or this machine's settings.

## Changing the code

The Host module and the Client manifest are read when the Harness boots, and the
page loads its client bundles from that manifest. After editing `index.js`,
`client.js`, or `package.json`, **restart the Harness and reload the page** — a
page refresh alone cannot re-import the Host half. Changing the URL or project
list from the Settings page needs no restart.

## Behaviour notes

- Only merge requests **assigned** to the token owner are returned, so authoring
  an MR without being an assignee does not list it.
- One unreachable project does not hide the others: its error is reported next
  to the successful results, and a call fails only when every project fails.
- Project ids are resolved once per process and cached; saving the settings
  clears that cache.
- The panel's list cache lives 45 seconds; `Refresh` (and the tool) always read
  GitLab again.
- The token lives in the profile configuration as plain text. Prefer the
  `GITLAB_TOKEN` environment variable for long-lived tokens, and revoke test
  tokens when you are done with them.
