/**
 * gitlab-assigned-mrs — "what is assigned to me on GitLab?".
 *
 * Three surfaces over one collector:
 *  - the global Host tool `gitlab_assigned_merge_requests`, available to every
 *    agent in every workspace;
 *  - a loopback JSON route (`/gitlab-mrs/api/list`) that the Client panel reads;
 *  - a settings route (`/gitlab-mrs/api/settings`) that owns the project list.
 *
 * The token never leaves the Host. The project list starts from the plugin config
 * and may be overridden at runtime from the Settings page; that override is a
 * small JSON file beside the profile, applied immediately to both surfaces.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const name = 'gitlab-assigned-mrs';

/** The tool registry is the only required Host service; `webServer` powers the page. */
export const inject = ['tools'];

/** Model-facing tool name. */
const TOOL_NAME = 'gitlab_assigned_merge_requests';
/** GitLab instance root; empty by default, configured in Settings or the plugin config. */
const DEFAULT_BASE_URL = '';
/** MR state used when neither the config nor the call specifies one. */
const DEFAULT_STATE = 'opened';
/** States GitLab accepts for `GET /projects/:id/merge_requests?state=`. */
const STATES = ['opened', 'merged', 'closed', 'all'];
/** GitLab's maximum page size. */
const PER_PAGE = 100;
/** Upper bound on pages read per project, so one project cannot exceed the budget. */
const DEFAULT_MAX_PAGES = 5;
/** Per-request timeout for ordinary GitLab calls. */
const DEFAULT_TIMEOUT_MS = 20000;
/** URL prefix of the JSON routes the Client half calls. */
const API_PREFIX = '/gitlab-mrs/api';
/** How long the panel may reuse one collected list before asking GitLab again. */
const LIST_CACHE_TTL_MS = 45000;
/** Panel page size when the Client does not ask for one. */
const DEFAULT_PAGE_SIZE = 10;
/** Projects queried at once; keeps a 30-project config off GitLab's rate limiter. */
const PROJECT_CONCURRENCY = 8;
/** Largest settings request body accepted from the page. */
const MAX_SETTINGS_BODY = 256 * 1024;

export function apply(ctx, config) {
  const settings = normalizeSettings(config);
  /** `rawProjectRef` -> `{ id, path }`, filled after a successful lookup. */
  const projectCache = new Map();
  /** In-flight or resolved token-owner lookup, so parallel calls share one request. */
  let currentUserPromise;
  /** Last list the panel read: `{ state, at, value }`. */
  let listCache;
  /** `undefined` = not read yet, otherwise `{ baseUrl, projects }` ('' / [] mean "not set"). */
  let storedSettings;
  /** In-flight read of the stored settings. */
  let storedSettingsRead;

  // --------------------------------------------------------------- transport

  class GitLabError extends Error {
    constructor(message, status) {
      super(message);
      this.name = 'GitLabError';
      this.status = status;
    }
  }

  /** Whether a rejected call was caused by cancellation rather than by GitLab. */
  function isAbort(error) {
    return (
      error?.name === 'AbortError' ||
      error?.name === 'TimeoutError' ||
      error?.cause?.name === 'AbortError'
    );
  }

  function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function apiUrl(baseUrl, pathname, params) {
    const url = new URL(`${baseUrl}/api/v4${pathname}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  function httpHint(status, url) {
    if (status === 401) {
      return `GitLab rejected the token (HTTP 401) for ${url}. Check that the token is valid and has the "api" or "read_api" scope.`;
    }
    if (status === 403) {
      return `GitLab denied access (HTTP 403) to ${url}. The token owner may not be a member of that project.`;
    }
    if (status === 404) {
      return `GitLab has no such resource (HTTP 404) at ${url}. Check the project path and that the token can see it.`;
    }
    return `GitLab returned HTTP ${status} for ${url}.`;
  }

  /**
   * One authenticated GET. Returns `{ json, headers }`; throws a GitLabError with
   * an actionable message for non-2xx answers, and lets cancellation and timeouts
   * propagate untouched so the tool layer can report them as aborted.
   */
  async function requestJson(pathname, params, signal) {
    const baseUrl = await effectiveBaseUrl();
    if (baseUrl === '') {
      throw new Error(
        'GitLab URL is not configured. Open Settings → GitLab MRs and enter your GitLab URL, or set `baseUrl` in the plugin config.',
      );
    }
    const url = apiUrl(baseUrl, pathname, params);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, settings.timeoutMs);
    const relay = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', relay, { once: true });
    }
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'PRIVATE-TOKEN': settings.token,
          accept: 'application/json',
          'user-agent': 'dsh-gitlab-assigned-mrs',
        },
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        throw new GitLabError(httpHint(response.status, url), response.status);
      }
      try {
        return { json: body === '' ? null : JSON.parse(body), headers: response.headers };
      } catch {
        throw new GitLabError(`GitLab returned a non-JSON body for ${url}.`, response.status);
      }
    } catch (error) {
      if (timedOut) {
        throw new Error(`GitLab did not answer within ${settings.timeoutMs} ms (${url.pathname}).`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', relay);
    }
  }

  // ----------------------------------------------------------------- project

  /** Resolve one project reference to its numeric id and canonical path. */
  async function resolveProject(reference, signal) {
    const cached = projectCache.get(reference);
    if (cached) return cached;
    const { json } = await requestJson(`/projects/${encodeURIComponent(reference)}`, {}, signal);
    const project = {
      id: Number.isInteger(json?.id) ? json.id : 0,
      path: typeof json?.path_with_namespace === 'string' ? json.path_with_namespace : reference,
    };
    if (project.id === 0) {
      throw new Error(`GitLab returned no project id for "${reference}".`);
    }
    projectCache.set(reference, project);
    return project;
  }

  /** Read every page of assigned merge requests for one resolved project. */
  async function listAssignedMergeRequests(project, state, signal) {
    const collected = [];
    for (let page = 1; page <= settings.maxPages; page += 1) {
      const { json, headers } = await requestJson(
        `/projects/${project.id}/merge_requests`,
        {
          scope: 'assigned_to_me',
          state,
          order_by: 'created_at',
          sort: 'asc',
          per_page: PER_PAGE,
          page,
        },
        signal,
      );
      const pageItems = Array.isArray(json) ? json : [];
      for (const item of pageItems) collected.push(normalizeMergeRequest(item, project));
      const next = Number.parseInt(headers.get('x-next-page') ?? '', 10);
      if (pageItems.length < PER_PAGE) break;
      if (Number.isInteger(next) && next > page) {
        page = next - 1;
        continue;
      }
      break;
    }
    return collected;
  }

  /** Project one GitLab MR payload into the stable shape both surfaces return. */
  function normalizeMergeRequest(mr, project) {
    const assignees = Array.isArray(mr?.assignees) ? mr.assignees : [];
    return {
      project: project.path,
      projectId: project.id,
      iid: Number.isInteger(mr?.iid) ? mr.iid : 0,
      title: typeof mr?.title === 'string' ? mr.title : '',
      state: typeof mr?.state === 'string' ? mr.state : '',
      draft: mr?.draft === true || mr?.work_in_progress === true,
      author: typeof mr?.author?.username === 'string' ? mr.author.username : '',
      createdAt: typeof mr?.created_at === 'string' ? mr.created_at : '',
      updatedAt: typeof mr?.updated_at === 'string' ? mr.updated_at : '',
      webUrl: typeof mr?.web_url === 'string' ? mr.web_url : '',
      sourceBranch: typeof mr?.source_branch === 'string' ? mr.source_branch : '',
      targetBranch: typeof mr?.target_branch === 'string' ? mr.target_branch : '',
      labels: Array.isArray(mr?.labels) ? mr.labels.filter((label) => typeof label === 'string') : [],
      assignees: assignees
        .map((assignee) => assignee?.username)
        .filter((username) => typeof username === 'string'),
      upvotes: Number.isInteger(mr?.upvotes) ? mr.upvotes : 0,
      downvotes: Number.isInteger(mr?.downvotes) ? mr.downvotes : 0,
      userNotesCount: Number.isInteger(mr?.user_notes_count) ? mr.user_notes_count : 0,
    };
  }

  /** Collect one project without letting its failure hide the others. */
  async function collectProject(reference, state, signal) {
    try {
      const project = await resolveProject(reference, signal);
      const items = await listAssignedMergeRequests(project, state, signal);
      return { path: project.path, id: project.id, error: '', items };
    } catch (error) {
      if (isAbort(error)) throw error;
      return { path: reference, id: 0, error: messageOf(error), items: [] };
    }
  }

  /** Run `worker` over `items` with no more than `limit` calls in flight. */
  async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runners = new Array(Math.max(1, Math.min(limit, items.length))).fill(null).map(async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    });
    await Promise.all(runners);
    return results;
  }

  // ------------------------------------------------------------------- user

  /** Username behind the token, cached; an empty string means "unknown, keep going". */
  async function currentUser(signal) {
    if (currentUserPromise === undefined) {
      currentUserPromise = requestJson('/user', {}, signal)
        .then(({ json }) => (typeof json?.username === 'string' ? json.username : ''))
        .catch((error) => {
          currentUserPromise = undefined;
          if (isAbort(error)) throw error;
          return '';
        });
    }
    return currentUserPromise;
  }

  // -------------------------------------------------------------- settings

  /** Directory holding the local settings override, or null without a profile dir. */
  function storeDirectory() {
    const base =
      typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR !== ''
        ? process.env.DSH_PROFILE_DIR
        : typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
          ? process.env.DSH_HOME
          : '';
    if (base === '') return null;
    return join(base, 'gitlab-assigned-mrs');
  }

  function storeFilePath() {
    const dir = storeDirectory();
    return dir === null ? null : join(dir, 'settings.json');
  }

  /** Pre-`settings.json` layout, which stored projects only. */
  function legacyStoreFilePath() {
    const dir = storeDirectory();
    return dir === null ? null : join(dir, 'projects.json');
  }

  async function readJsonFile(file) {
    if (file === null) return null;
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        ctx.logger?.warn?.(
          `gitlab-assigned-mrs: ignoring unreadable settings file ${file} (${messageOf(error)})`,
        );
      }
      return null;
    }
  }

  /**
   * Read the local override once. An empty `baseUrl` or `projects` list means "not
   * set", so the config defaults still apply; the two are independent.
   */
  async function readStoredSettings() {
    const parsed =
      (await readJsonFile(storeFilePath())) ?? (await readJsonFile(legacyStoreFilePath()));
    storedSettings =
      parsed === null
        ? { baseUrl: '', projects: [] }
        : {
            baseUrl: normalizeBaseUrl(parsed?.baseUrl),
            projects: projectListOf(parsed?.projects),
          };
    return storedSettings;
  }

  async function ensureStoredSettings() {
    if (storedSettings !== undefined) return storedSettings;
    if (storedSettingsRead === undefined) {
      storedSettingsRead = readStoredSettings().finally(() => {
        storedSettingsRead = undefined;
      });
    }
    return storedSettingsRead;
  }

  /** The GitLab root both surfaces use: the Settings value when set, else the config. */
  async function effectiveBaseUrl() {
    const stored = await ensureStoredSettings();
    return stored.baseUrl !== '' ? stored.baseUrl : settings.baseUrl;
  }

  /** The project list both surfaces use: the Settings value when set, else the config. */
  async function effectiveProjects() {
    const stored = await ensureStoredSettings();
    return stored.projects.length > 0 ? stored.projects : settings.projects;
  }

  function forgetCaches() {
    listCache = undefined;
    projectCache.clear();
  }

  async function writeStoredSettings(next) {
    const file = storeFilePath();
    if (file === null) {
      throw new Error('No profile directory is available, so the settings cannot be stored.');
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify({ version: 2, baseUrl: next.baseUrl, projects: next.projects }, null, 2)}\n`,
      'utf8',
    );
    const legacy = legacyStoreFilePath();
    if (legacy !== null) await rm(legacy, { force: true });
    storedSettings = { baseUrl: next.baseUrl, projects: next.projects };
    forgetCaches();
  }

  async function clearStoredSettings() {
    for (const file of [storeFilePath(), legacyStoreFilePath()]) {
      if (file !== null) await rm(file, { force: true });
    }
    storedSettings = { baseUrl: '', projects: [] };
    forgetCaches();
  }

  // -------------------------------------------------------------- arguments

  function pickState(args) {
    const requested = typeof args?.state === 'string' ? args.state.trim().toLowerCase() : '';
    if (requested === '') return settings.defaultState;
    if (!STATES.includes(requested)) {
      throw new Error(`state must be one of ${STATES.join(', ')} (got "${args.state}").`);
    }
    return requested;
  }

  /** An explicit `projects` argument, or null when the call should use the stored list. */
  function pickProjects(args) {
    const provided = args?.projects;
    if (provided === undefined || provided === null) return null;
    if (!Array.isArray(provided)) throw new Error('projects must be an array of project paths.');
    return dedupe(provided.map(normalizeProjectRef).filter((reference) => reference !== ''));
  }

  // ------------------------------------------------------------------- list

  function compareCreatedAsc(left, right) {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    const byTime = Number.isNaN(leftTime) || Number.isNaN(rightTime) ? 0 : leftTime - rightTime;
    if (byTime !== 0) return byTime;
    if (left.project !== right.project) return left.project.localeCompare(right.project);
    return left.iid - right.iid;
  }

  function compareCreatedDesc(left, right) {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    const byTime = Number.isNaN(leftTime) || Number.isNaN(rightTime) ? 0 : rightTime - leftTime;
    if (byTime !== 0) return byTime;
    if (left.project !== right.project) return left.project.localeCompare(right.project);
    return left.iid - right.iid;
  }

  /** Collect the given projects and merge the answers into one ordered list. */
  async function collectAll(state, order, signal, references) {
    const [user, collected] = await Promise.all([
      currentUser(signal),
      mapLimit(references, PROJECT_CONCURRENCY, (reference) =>
        collectProject(reference, state, signal),
      ),
    ]);
    const mergeRequests = collected.flatMap((project) => project.items);
    mergeRequests.sort(order === 'asc' ? compareCreatedAsc : compareCreatedDesc);
    return {
      total: mergeRequests.length,
      state,
      order,
      user,
      projects: collected.map((project) => ({
        path: project.path,
        id: project.id,
        error: project.error,
      })),
      mergeRequests,
    };
  }

  // ------------------------------------------------------------- model view

  function formatCreated(createdAt) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(createdAt);
    if (match === null) return createdAt === '' ? 'unknown date' : createdAt;
    const offset = /([+-]\d{2}:\d{2}|Z)$/.exec(createdAt);
    const zone = offset === null ? '' : ` ${offset[1] === 'Z' ? 'UTC' : offset[1]}`;
    return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}${zone}`;
  }

  function formatMergeRequest(mr, index) {
    const meta = [mr.state === '' ? 'unknown state' : mr.state];
    if (mr.draft) meta.push('draft');
    if (mr.author !== '') meta.push(`by @${mr.author}`);
    if (mr.userNotesCount > 0) meta.push(`${mr.userNotesCount} note${mr.userNotesCount === 1 ? '' : 's'}`);
    if (mr.labels.length > 0) meta.push(mr.labels.map((label) => `"${label}"`).join(', '));
    const reference = `${mr.project}!${mr.iid}`;
    const link = mr.webUrl === '' ? reference : `[${reference}](${mr.webUrl})`;
    return [
      `${index + 1}. ${formatCreated(mr.createdAt)} · ${link} · ${mr.title}`,
      `   ${meta.join(' · ')}${mr.sourceBranch === '' ? '' : ` · ${mr.sourceBranch} → ${mr.targetBranch || '?'}`}`,
    ].join('\n');
  }

  /** The single model-facing text block for one tool call. */
  function renderText(value) {
    const direction = value.order === 'desc' ? 'newest first' : 'oldest first';
    const who = value.user === '' ? 'you' : `@${value.user}`;
    const projectCount = value.projects.length;
    const header =
      value.total === 0
        ? `No merge requests assigned to ${who} in ${projectCount} project${projectCount === 1 ? '' : 's'} (state: ${value.state}).`
        : `${value.total} merge request${value.total === 1 ? '' : 's'} assigned to ${who} across ${projectCount} project${projectCount === 1 ? '' : 's'} — state: ${value.state}, ordered by creation time (${direction}).`;

    const blocks = [header];
    if (value.mergeRequests.length > 0) {
      blocks.push(value.mergeRequests.map((mr, index) => formatMergeRequest(mr, index)).join('\n\n'));
    }

    const failed = value.projects.filter((project) => project.error !== '');
    if (failed.length > 0) {
      blocks.push(
        `Could not read:\n${failed.map((project) => `- ${project.path}: ${project.error}`).join('\n')}`,
      );
    }

    blocks.push(
      `Projects queried (${projectCount}): ${value.projects.map((project) => project.path).join(', ')}. ` +
        'The list comes from the plugin config or the Settings → GitLab MRs page; pass the `projects` argument to override it for one call.',
    );
    return blocks.join('\n\n');
  }

  // ---------------------------------------------------------------- tool row

  const outputSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      total: { type: 'integer' },
      state: { type: 'string' },
      order: { type: 'string', enum: ['asc', 'desc'] },
      user: { type: 'string' },
      projects: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
            id: { type: 'integer' },
            error: { type: 'string' },
          },
          required: ['path', 'id', 'error'],
        },
      },
      mergeRequests: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            project: { type: 'string' },
            projectId: { type: 'integer' },
            iid: { type: 'integer' },
            title: { type: 'string' },
            state: { type: 'string' },
            draft: { type: 'boolean' },
            author: { type: 'string' },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
            webUrl: { type: 'string' },
            sourceBranch: { type: 'string' },
            targetBranch: { type: 'string' },
            labels: { type: 'array', items: { type: 'string' } },
            assignees: { type: 'array', items: { type: 'string' } },
            upvotes: { type: 'integer' },
            downvotes: { type: 'integer' },
            userNotesCount: { type: 'integer' },
          },
          required: [
            'project',
            'projectId',
            'iid',
            'title',
            'state',
            'draft',
            'author',
            'createdAt',
            'updatedAt',
            'webUrl',
            'sourceBranch',
            'targetBranch',
            'labels',
            'assignees',
            'upvotes',
            'downvotes',
            'userNotesCount',
          ],
        },
      },
    },
    required: ['total', 'state', 'order', 'user', 'projects', 'mergeRequests'],
  };

  ctx.tools.register({
    name: TOOL_NAME,
    description:
      'List the GitLab merge requests assigned to you (the user who owns the configured GitLab token) across a configurable set of projects, ordered by creation time with the newest first by default. ' +
      'Use it when the user asks what merge requests are assigned to them, what is pending their action across their projects, or wants a list of their open MRs. ' +
      'The default project list, token and state filter come from the plugin config or the Settings → GitLab MRs page; pass `projects` to query other projects for one call and `state` to include merged or closed MRs. ' +
      'Each entry carries the project path, MR iid, title, author, created/updated timestamps, source and target branch, labels, assignees and web URL.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projects: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Project paths with namespace (for example "group/project") or project ids or GitLab project URLs, replacing the configured list for this call. Omit to use the configured projects.',
        },
        state: {
          type: 'string',
          enum: STATES,
          description:
            'Merge request state filter. Defaults to the configured state ("opened" unless changed). Use "all" to include merged and closed requests.',
        },
      },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: renderText(value) }],
    },
    timeoutMs: settings.timeoutMs + 15000,
    isConcurrencySafe: () => true,
    presentCall: (args) => {
      const state = typeof args?.state === 'string' && args.state !== '' ? ` (${args.state})` : '';
      return {
        card: 'generic',
        title: `GitLab: merge requests assigned to me${state}`,
        kind: 'search',
      };
    },
    async execute(args, exec) {
      if ((await effectiveBaseUrl()) === '') {
        throw new Error(
          'GitLab URL is not configured. Open Settings → GitLab MRs and enter your GitLab URL, or set `baseUrl` in the plugin config.',
        );
      }
      if (settings.token === '') {
        throw new Error(
          'No GitLab token is configured. Set `token` in the gitlab-assigned-mrs plugin config, or set the GITLAB_TOKEN environment variable before starting the Harness.',
        );
      }
      const state = pickState(args);
      const references = pickProjects(args) ?? (await effectiveProjects());
      if (references.length === 0) {
        throw new Error(
          'No GitLab projects are configured. Add project paths on the Settings → GitLab MRs page, or pass them in the `projects` argument.',
        );
      }

      const value = await collectAll(state, settings.order, exec?.signal, references);
      const failures = value.projects.filter((project) => project.error !== '');
      if (failures.length === value.projects.length) {
        throw new Error(
          `Could not read any configured GitLab project:\n${failures
            .map((project) => `- ${project.path}: ${project.error}`)
            .join('\n')}`,
        );
      }
      return value;
    },
  });

  // ------------------------------------------------------------- page routes

  function writeJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(payload);
  }

  function clampInteger(raw, min, max, fallback) {
    const value = Number.parseInt(raw ?? '', 10);
    if (!Number.isInteger(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  function hostnameOf(hostHeader) {
    if (typeof hostHeader !== 'string' || hostHeader === '') return undefined;
    try {
      return new URL(`http://${hostHeader}`).hostname.trim().toLowerCase();
    } catch {
      return undefined;
    }
  }

  function stripBrackets(host) {
    return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  }

  function isLoopback(hostname) {
    const host = stripBrackets(hostname);
    return (
      host === 'localhost' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host === '::' ||
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    );
  }

  /** Accept loopback and the deployment's trusted hosts, as the rest of the page does. */
  function isTrustedRequest(req) {
    const hostname = hostnameOf(req?.headers?.host);
    if (hostname === undefined) return false;
    const trustedHosts = (() => {
      try {
        return ctx.webRuntime?.trustedHosts;
      } catch {
        return undefined;
      }
    })();
    const trusted =
      isLoopback(hostname) ||
      (Array.isArray(trustedHosts) &&
        trustedHosts.some((entry) => {
          if (typeof entry !== 'string') return false;
          const authority = hostnameOf(entry) ?? entry.trim().toLowerCase();
          return stripBrackets(authority) === stripBrackets(hostname);
        }));
    if (!trusted) return false;
    if (String(req?.headers?.['sec-fetch-site'] ?? '').trim().toLowerCase() === 'cross-site') return false;
    const origin = req?.headers?.origin;
    if (typeof origin === 'string' && origin !== '' && origin !== 'dsh-app://app') {
      let originHostname;
      try {
        originHostname = new URL(origin).hostname.trim().toLowerCase();
      } catch {
        return false;
      }
      if (stripBrackets(originHostname) !== stripBrackets(hostname)) return false;
    }
    return true;
  }

  async function readJsonBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_SETTINGS_BODY) throw new Error('request body too large');
      chunks.push(chunk);
    }
    if (size === 0) return {};
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body must be a JSON object');
    }
    return parsed;
  }

  /** `GET /gitlab-mrs/api/list?state=&offset=&limit=&refresh=1` */
  async function handleList(req, res) {
    if (!isTrustedRequest(req)) return writeJson(res, 403, { error: 'forbidden' });
    if (req.method !== 'GET') return writeJson(res, 405, { error: 'method not allowed' });
    if ((await effectiveBaseUrl()) === '') {
      return writeJson(res, 400, {
        error: 'No GitLab URL is configured. Open Settings → GitLab MRs and enter your GitLab URL.',
      });
    }
    if (settings.token === '') {
      return writeJson(res, 503, { error: 'No GitLab token is configured in the plugin settings.' });
    }

    const query = new URL(req.url ?? API_PREFIX, 'http://localhost').searchParams;
    let state;
    try {
      state = pickState({ state: query.get('state') ?? undefined });
    } catch (error) {
      return writeJson(res, 400, { error: messageOf(error) });
    }
    const references = await effectiveProjects();
    if (references.length === 0) {
      return writeJson(res, 400, { error: 'No GitLab projects are configured in the plugin settings.' });
    }
    const offset = clampInteger(query.get('offset'), 0, 100000, 0);
    const limit = clampInteger(query.get('limit'), 1, 50, DEFAULT_PAGE_SIZE);
    const refresh = query.get('refresh') === '1';

    const fresh =
      listCache !== undefined && listCache.state === state && Date.now() - listCache.at < LIST_CACHE_TTL_MS;
    if (refresh || !fresh) {
      const collected = await mapLimit(references, PROJECT_CONCURRENCY, (reference) =>
        collectProject(reference, state, undefined),
      );
      if (collected.every((project) => project.error !== '')) {
        return writeJson(res, 502, {
          error: `Could not read any configured GitLab project:\n${collected
            .map((project) => `- ${project.path}: ${project.error}`)
            .join('\n')}`,
        });
      }
      const mergeRequests = collected.flatMap((project) => project.items).sort(compareCreatedDesc);
      listCache = {
        state,
        at: Date.now(),
        value: {
          total: mergeRequests.length,
          state,
          order: 'desc',
          user: await currentUser(undefined),
          projects: collected.map((project) => ({
            path: project.path,
            id: project.id,
            error: project.error,
          })),
          mergeRequests,
        },
      };
    }

    const value = listCache.value;
    const items = value.mergeRequests.slice(offset, offset + limit);
    return writeJson(res, 200, {
      total: value.total,
      state,
      order: 'desc',
      user: value.user,
      projects: value.projects,
      fetchedAt: new Date(listCache.at).toISOString(),
      offset,
      limit,
      hasMore: offset + items.length < value.total,
      items,
    });
  }

  /** `GET|POST /gitlab-mrs/api/settings` — the GitLab URL and project list the page edits. */
  async function handleSettings(req, res) {
    if (!isTrustedRequest(req)) return writeJson(res, 403, { error: 'forbidden' });

    const snapshot = async () => {
      const [baseUrl, projects, stored] = await Promise.all([
        effectiveBaseUrl(),
        effectiveProjects(),
        ensureStoredSettings(),
      ]);
      return {
        baseUrl,
        projects,
        defaults: { baseUrl: settings.baseUrl, projects: settings.projects },
        source: stored.baseUrl !== '' || stored.projects.length > 0 ? 'settings' : 'config',
        storePath: storeFilePath(),
      };
    };

    if (req.method === 'GET') return writeJson(res, 200, await snapshot());
    if (req.method !== 'POST') return writeJson(res, 405, { error: 'method not allowed' });

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return writeJson(res, 400, { error: messageOf(error) });
    }

    if (body.reset === true) {
      await clearStoredSettings();
      return writeJson(res, 200, await snapshot());
    }

    const rawUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    if (rawUrl === '') {
      return writeJson(res, 400, { error: 'Keep a GitLab URL.' });
    }
    const baseUrl = normalizeBaseUrl(rawUrl);
    if (baseUrl === '') {
      return writeJson(res, 400, { error: 'The GitLab URL must start with http:// or https://.' });
    }
    const projects = projectListOf(body.projects);
    if (projects.length === 0) {
      return writeJson(res, 400, { error: 'Keep at least one project.' });
    }
    try {
      await writeStoredSettings({ baseUrl, projects });
    } catch (error) {
      return writeJson(res, 500, { error: messageOf(error) });
    }
    return writeJson(res, 200, await snapshot());
  }

  ctx.inject(['webServer'], (scope) => {
    const routes = [
      [`${API_PREFIX}/list`, (req, res) => handleList(req, res)],
      [`${API_PREFIX}/settings`, (req, res) => handleSettings(req, res)],
    ];
    for (const [path, handler] of routes) {
      scope.effect(
        () =>
          scope.webServer.register({
            kind: 'exact',
            path,
            handler: (req, res) => {
              Promise.resolve(handler(req, res)).catch((error) => {
                writeJson(res, 500, { error: messageOf(error) });
              });
            },
          }),
        `gitlab-assigned-mrs: route ${path}`,
      );
    }
  });
}

// ---------------------------------------------------------------------- config

/**
 * Trim and validate a GitLab instance root. An empty string means "not
 * configured", which both the Settings page and the config may leave unset.
 */
function normalizeBaseUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  return /^https?:\/\/[^/\s]+/i.test(trimmed) ? trimmed : '';
}

/** Read a list of project references from a YAML array or a comma/newline separated string. */
function projectListOf(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,]/)
      : [];
  return dedupe(raw.map(normalizeProjectRef).filter((reference) => reference !== ''));
}

/**
 * Accept a path with namespace, a numeric id, or a GitLab URL in any form:
 * `https://host/group/name`, `https://host/group/name.git`,
 * `ssh://git@host:9022/group/name.git`, or `git@host:group/name.git`.
 * SSH remotes are converted to the equivalent path, so the transport stays https.
 */
function normalizeProjectRef(value) {
  if (typeof value !== 'string') return '';
  let reference = value.trim();
  if (reference === '') return '';

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(reference)) {
    try {
      reference = new URL(reference).pathname;
    } catch {
      return '';
    }
  } else if (/^[^\s/]+@[^\s/:]+:/.test(reference)) {
    // scp-like remote: git@gitlab.example.com:group/project.git
    reference = reference.slice(reference.indexOf(':') + 1);
  }

  reference = reference.replace(/^\/+/, '').replace(/\/+$/, '');
  reference = reference.replace(/\/-\/.*$/, '');
  reference = reference.replace(/\.git$/i, '');
  return reference.trim();
}

function dedupe(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/** Validate and default the plugin config; bad values fail the plugin load loudly. */
function normalizeSettings(config) {
  const source = config !== null && typeof config === 'object' ? config : {};

  const baseUrl = normalizeBaseUrl(source.baseUrl);
  const declaredBaseUrl = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : '';
  if (declaredBaseUrl !== '' && baseUrl === '') {
    throw new Error(`gitlab-assigned-mrs: baseUrl must be an http(s) URL, got "${source.baseUrl}".`);
  }

  const token =
    typeof source.token === 'string' && source.token.trim() !== ''
      ? source.token.trim()
      : typeof process.env.GITLAB_TOKEN === 'string'
        ? process.env.GITLAB_TOKEN.trim()
        : '';

  const defaultState =
    typeof source.defaultState === 'string' && STATES.includes(source.defaultState.trim().toLowerCase())
      ? source.defaultState.trim().toLowerCase()
      : DEFAULT_STATE;

  const order = source.order === 'asc' ? 'asc' : 'desc';

  const timeoutMs =
    Number.isInteger(source.timeoutMs) && source.timeoutMs >= 1000 && source.timeoutMs <= 120000
      ? source.timeoutMs
      : DEFAULT_TIMEOUT_MS;

  const maxPages =
    Number.isInteger(source.maxPages) && source.maxPages >= 1 && source.maxPages <= 100
      ? source.maxPages
      : DEFAULT_MAX_PAGES;

  return {
    baseUrl,
    token,
    projects: projectListOf(source.projects),
    defaultState,
    order,
    timeoutMs,
    maxPages,
  };
}
