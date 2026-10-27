/**
 * dsh-gitlab-assigned — Client half.
 *
 * Three registrations, all on shell-owned slots:
 *  - `sidebar.panellist` with id `gitlab-mrs`: the sidebar row (icon + label). The
 *    shell owns the button and dispatches the main panel with the same id.
 *  - `main` with key `gitlab-mrs`: the panel body, a full-height page with its own
 *    header, state filter, day groups, and paging through the Host JSON route
 *    `/gitlab-mrs/api/list`.
 *  - `settings.section` with id `gitlab-mrs`: the GitLab URL and project list the
 *    Host reads, saved through `/gitlab-mrs/api/settings`.
 *
 * The list is newest-first and grouped by local creation day; reaching the bottom
 * loads the next slice, so older requests arrive a page at a time.
 */

window.__ModuleLoader__.load({
  id: 'dsh-gitlab-assigned',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'gitlab-assigned';
    const PANEL_ID = 'gitlab-mrs';
    const API_BASE = 'gitlab-mrs/api';
    const PAGE_SIZE = 10;
    const CSS_MARKER = 'data-gitlab-mrs-css';
    const FILTERS = ['opened', 'merged', 'closed', 'all'];

    /**
     * The namespace-bound translator published by `apply`, used when the slot host
     * passes no `t` prop (the registration asks for one, but the panel must still
     * localize if a future host stops projecting it).
     */
    let boundTranslator = null;

    // ------------------------------------------------------------- dictionaries

    const en = {
      'nav.label': 'Merge requests',
      'panel.title': 'Merge requests',
      'panel.subtitle': '{total} merge requests assigned to {user} across {projects} projects',
      'panel.subtitleLoading': 'Reading merge requests…',
      'panel.you': 'you',
      'sort.newest': 'Newest first',
      'filter.opened': 'Open',
      'filter.merged': 'Merged',
      'filter.closed': 'Closed',
      'filter.all': 'All',
      'filter.aria': 'Filter by state',
      refresh: 'Refresh',
      loading: 'Reading merge requests…',
      loadingMore: 'Loading earlier merge requests…',
      loadEarlier: 'Load earlier',
      end: 'That is every merge request.',
      empty: 'No {state} merge requests are assigned to you.',
      'error.title': 'Could not read merge requests',
      'error.retry': 'Retry',
      'error.partial': 'Some projects could not be read:',
      'group.today': 'Today',
      'group.yesterday': 'Yesterday',
      'group.unknown': 'Unknown date',
      'group.hint': 'Click to switch between relative and absolute dates',
      'day.daysAgo': '{count} days ago',
      'day.weekAgo': 'a week ago',
      'day.weeksAgo': '{count} weeks ago',
      'day.monthAgo': 'a month ago',
      'day.monthsAgo': '{count} months ago',
      'day.yearAgo': 'a year ago',
      'day.yearsAgo': '{count} years ago',
      'row.draft': 'Draft',
      'row.note': '{count} note',
      'row.notes': '{count} notes',
      'row.updated': 'updated {when}',
      'row.untitled': '(untitled)',
      'state.opened': 'Open',
      'state.merged': 'Merged',
      'state.closed': 'Closed',
      'state.locked': 'Locked',
      'when.now': 'just now',
      'when.minutes': '{count}m ago',
      'when.hours': '{count}h ago',
      'when.days': '{count}d ago',
      'when.months': '{count}mo ago',
      'when.years': '{count}y ago',
      'projects.prefix': 'Projects:',
      'projects.hint': 'Change the list in the plugin config (projects).',
      'footer.manage': '{count} projects · manage in Settings → GitLab MRs',
      'open.hint': 'Open on GitLab',
      'settings.nav': 'GitLab MRs',
      'settings.title': 'GitLab merge requests',
      'settings.description': 'The GitLab instance and projects the sidebar panel and the agent tool read. Saving applies to both immediately.',
      'settings.urlLabel': 'GitLab URL',
      'settings.urlPlaceholder': 'https://gitlab.example.com',
      'settings.urlHint': 'The instance root — no /api/v4 suffix.',
      'settings.urlInvalid': 'Enter a full http:// or https:// URL.',
      'settings.projectsLabel': 'Projects',
      'settings.hint': 'One per line: a project path (group/project), a numeric id, or any GitLab URL. ssh:// remotes are converted to https paths.',
      'settings.save': 'Save',
      'settings.saving': 'Saving…',
      'settings.reset': 'Reset to plugin config',
      'settings.saved': 'Saved.',
      'settings.loading': 'Reading settings…',
      'settings.count': '{count} projects',
      'settings.storeHint': 'Stored at {path}',
      'settings.error': 'Could not save the project list.',
    };

    const zh = {
      'nav.label': '合并请求',
      'panel.title': '合并请求',
      'panel.subtitle': '指派给 {user} 的 {total} 个合并请求，来自 {projects} 个项目',
      'panel.subtitleLoading': '正在读取合并请求…',
      'panel.you': '你',
      'sort.newest': '最新在前',
      'filter.opened': '开放',
      'filter.merged': '已合并',
      'filter.closed': '已关闭',
      'filter.all': '全部',
      'filter.aria': '按状态筛选',
      refresh: '刷新',
      loading: '正在读取合并请求…',
      loadingMore: '正在加载更早的合并请求…',
      loadEarlier: '加载更早',
      end: '已加载全部合并请求。',
      empty: '没有指派给你的{state}合并请求。',
      'error.title': '无法读取合并请求',
      'error.retry': '重试',
      'error.partial': '以下项目读取失败：',
      'group.today': '今天',
      'group.yesterday': '昨天',
      'group.unknown': '日期未知',
      'group.hint': '点击在相对时间与绝对时间之间切换',
      'day.daysAgo': '{count} 天前',
      'day.weekAgo': '一周前',
      'day.weeksAgo': '{count} 周前',
      'day.monthAgo': '一个月前',
      'day.monthsAgo': '{count} 个月前',
      'day.yearAgo': '一年前',
      'day.yearsAgo': '{count} 年前',
      'row.draft': '草稿',
      'row.note': '{count} 条评论',
      'row.notes': '{count} 条评论',
      'row.updated': '更新于 {when}',
      'row.untitled': '（无标题）',
      'state.opened': '开放',
      'state.merged': '已合并',
      'state.closed': '已关闭',
      'state.locked': '已锁定',
      'when.now': '刚刚',
      'when.minutes': '{count} 分钟前',
      'when.hours': '{count} 小时前',
      'when.days': '{count} 天前',
      'when.months': '{count} 个月前',
      'when.years': '{count} 年前',
      'projects.prefix': '项目：',
      'projects.hint': '可在插件配置中修改项目列表。',
      'footer.manage': '{count} 个项目 · 在「设置 → GitLab 合并请求」中管理',
      'open.hint': '在 GitLab 中打开',
      'settings.nav': 'GitLab 合并请求',
      'settings.title': 'GitLab 合并请求',
      'settings.description': '侧边栏面板与 Agent 工具读取的 GitLab 地址与项目列表，保存后立即生效。',
      'settings.urlLabel': 'GitLab 地址',
      'settings.urlPlaceholder': 'https://gitlab.example.com',
      'settings.urlHint': '实例根地址，不要带 /api/v4。',
      'settings.urlInvalid': '请输入完整的 http:// 或 https:// 地址。',
      'settings.projectsLabel': '项目',
      'settings.hint': '每行一个：项目路径（如 group/project）、数字 ID，或任意 GitLab 链接。ssh:// 地址会转换为 https 路径。',
      'settings.save': '保存',
      'settings.saving': '保存中…',
      'settings.reset': '恢复为插件配置',
      'settings.saved': '已保存。',
      'settings.loading': '正在读取设置…',
      'settings.count': '{count} 个项目',
      'settings.storeHint': '存储位置：{path}',
      'settings.error': '无法保存项目列表。',
    };

    // -------------------------------------------------------------------- style

    const CSS = `
.gmrs_root{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit}
.gmrs_scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden}
.gmrs_page{box-sizing:border-box;max-width:900px;margin:0 auto;padding:0 32px 72px}
.gmrs_toolbar{position:sticky;top:0;z-index:3;background:var(--dsw-alias-bg-base);padding:28px 0 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.gmrs_titleRow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.gmrs_title{margin:0;font-size:22px;line-height:30px;font-weight:600;letter-spacing:-.01em}
.gmrs_subtitle{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.gmrs_controls{display:flex;align-items:center;gap:10px;margin-top:16px;flex-wrap:wrap}
.gmrs_seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.gmrs_segBtn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;padding:4px 12px;border-radius:8px;cursor:pointer}
.gmrs_segBtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gmrs_segBtn[aria-pressed="true"]{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
.gmrs_spacer{flex:1}
.gmrs_sort{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.gmrs_btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:5px 10px;border-radius:8px;cursor:pointer}
.gmrs_btn:hover{background:var(--dsw-alias-bg-layer-2)}
.gmrs_btn:disabled{opacity:.55;cursor:default}
.gmrs_group{margin-top:22px}
.gmrs_groupHead{display:inline-flex;align-items:center;gap:6px;margin:0 0 6px;padding:2px 7px 2px 4px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;font-weight:600;cursor:pointer}
.gmrs_groupHead:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gmrs_groupHead:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.gmrs_groupIcon{flex:none;opacity:.5}
.gmrs_groupHead:hover .gmrs_groupIcon{opacity:1}
.gmrs_list{display:flex;flex-direction:column;gap:2px}
.gmrs_row{display:flex;gap:16px;align-items:flex-start;padding:10px 12px;border-radius:10px;text-decoration:none;color:inherit}
.gmrs_row:hover{background:var(--dsw-alias-bg-layer-2)}
.gmrs_row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.gmrs_rowMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.gmrs_rowTitle{display:flex;align-items:center;gap:8px;min-width:0;font-size:14px;line-height:20px;font-weight:500}
.gmrs_rowTitleText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gmrs_rowMeta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gmrs_rowSide{flex:none;display:flex;align-items:center;gap:8px;padding-top:1px}
.gmrs_rowTime{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.gmrs_pill{flex:none;font-size:11px;line-height:16px;font-weight:500;padding:1px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;color:var(--dsw-alias-label-secondary)}
.gmrs_pillDraft{color:var(--dsw-alias-state-warn-primary);border-color:currentColor}
.gmrs_pillMerged{color:var(--dsw-alias-brand-primary);border-color:currentColor}
.gmrs_pillClosed{color:var(--dsw-alias-state-error-primary);border-color:currentColor}
.gmrs_note{margin-top:24px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.gmrs_noteError{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}
.gmrs_warn{margin-top:20px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.gmrs_warnTitle{color:var(--dsw-alias-label-primary);font-weight:600}
.gmrs_empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:72px 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);text-align:center}
.gmrs_end{padding:24px 0 0;display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.gmrs_footer{margin-top:32px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.gmrs_footerLine+.gmrs_footerLine{margin-top:2px}
.gmrs_spinner{width:13px;height:13px;flex:none;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:gmrs_spin .8s linear infinite}
.gmrs_tag{flex:none;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;font-weight:600;letter-spacing:.01em;padding:1px 7px;border-radius:6px;background:hsl(var(--gmrs-tag-h) 70% 52% / .16);border:1px solid hsl(var(--gmrs-tag-h) 70% 52% / .34);color:var(--dsw-alias-label-primary);color:color-mix(in srgb,hsl(var(--gmrs-tag-h) 66% 46%) 58%,var(--dsw-alias-label-primary))}
.gmrs_settings{display:flex;flex-direction:column;gap:10px;max-width:720px;box-sizing:border-box}
.gmrs_settingsTitle{margin:0;font-size:18px;line-height:26px;font-weight:600}
.gmrs_settingsDesc{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.gmrs_field{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.gmrs_label{font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary)}
.gmrs_input{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}
.gmrs_input:focus{border-color:var(--dsw-alias-brand-primary)}
.gmrs_input:disabled{opacity:.6}
.gmrs_textarea{box-sizing:border-box;width:100%;min-height:280px;resize:vertical;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:20px;outline:none}
.gmrs_textarea:focus{border-color:var(--dsw-alias-brand-primary)}
.gmrs_textarea:disabled{opacity:.6}
.gmrs_actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gmrs_btnPrimary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:600}
.gmrs_btnPrimary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);filter:brightness(1.06)}
.gmrs_status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.gmrs_statusOk{color:var(--dsw-alias-state-success-primary)}
.gmrs_statusError{color:var(--dsw-alias-state-error-primary)}
.gmrs_hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
@keyframes gmrs_spin{to{transform:rotate(360deg)}}
@media (max-width:720px){.gmrs_page{padding:0 16px 56px}.gmrs_titleRow{flex-wrap:wrap}}
`;

    function installStyles() {
      if (typeof document === 'undefined' || document.head === null) return () => {};
      if (document.querySelector('style[' + CSS_MARKER + ']') !== null) return () => {};
      const tag = document.createElement('style');
      tag.setAttribute(CSS_MARKER, '');
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => {
        if (tag.parentNode !== null) tag.parentNode.removeChild(tag);
      };
    }

    // ------------------------------------------------------------------ helpers

    function interpolate(text, params) {
      if (params === undefined || params === null) return text;
      return text.replace(/\{(\w+)\}/g, (match, key) =>
        params[key] === undefined ? match : String(params[key]),
      );
    }

    /**
     * Wrap a namespace-bound translator with an English fallback: a key the active
     * dictionary lacks must never reach the page as its own name.
     */
    function translator(bound) {
      return (key, params) => {
        let text;
        try {
          text = typeof bound === 'function' ? bound(key) : undefined;
        } catch (error) {
          text = undefined;
        }
        if (typeof text !== 'string' || text === '' || text === key) {
          text = typeof en[key] === 'string' ? en[key] : key;
        }
        return interpolate(text, params);
      };
    }

    function pageBase() {
      try {
        const url = new URL(document.baseURI);
        url.search = '';
        url.hash = '';
        if (!url.pathname.endsWith('/')) {
          url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
        }
        return url;
      } catch (error) {
        return new URL('/', window.location.origin);
      }
    }

    function apiUrl(resource, query) {
      const url = new URL(`${API_BASE}/${resource}`, pageBase());
      if (query !== undefined && query !== null) {
        for (const key of Object.keys(query)) {
          if (query[key] === undefined || query[key] === null) continue;
          url.searchParams.set(key, String(query[key]));
        }
      }
      return url.href;
    }

    function localeTag() {
      try {
        const lang = document.documentElement.getAttribute('lang');
        if (typeof lang === 'string' && lang.length > 0) return lang;
      } catch (error) {
        /* the document is unavailable outside the page */
      }
      return undefined;
    }

    function parseDate(value) {
      if (typeof value !== 'string' || value === '') return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function pad(value) {
      return value < 10 ? `0${value}` : String(value);
    }

    function dayKey(value) {
      const date = value instanceof Date ? value : parseDate(value);
      if (date === null) return 'unknown';
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function timeOfDay(value, locale) {
      const date = parseDate(value);
      if (date === null) return '';
      try {
        return new Intl.DateTimeFormat(locale, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(date);
      } catch (error) {
        return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
      }
    }

    function relativeTime(value, t) {
      const date = parseDate(value);
      if (date === null) return '';
      const elapsed = Date.now() - date.getTime();
      if (elapsed < 60 * 1000) return t('when.now');
      const minutes = Math.floor(elapsed / (60 * 1000));
      if (minutes < 60) return t('when.minutes', { count: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t('when.hours', { count: hours });
      const days = Math.floor(hours / 24);
      if (days < 30) return t('when.days', { count: days });
      const months = Math.floor(days / 30);
      if (months < 12) return t('when.months', { count: months });
      return t('when.years', { count: Math.floor(months / 12) });
    }

    /** Remembered group-heading mode, so the reader's choice survives a reload. */
    const GROUP_MODE_KEY = 'gitlab-mrs.group-time';

    function readGroupMode() {
      try {
        return window.localStorage.getItem(GROUP_MODE_KEY) === 'absolute' ? 'absolute' : 'relative';
      } catch (error) {
        return 'relative';
      }
    }

    function writeGroupMode(mode) {
      try {
        window.localStorage.setItem(GROUP_MODE_KEY, mode);
      } catch (error) {
        /* storage may be unavailable in a sandboxed document */
      }
    }

    /** Whole days between a `YYYY-MM-DD` key and today, in the page's local time. */
    function daysSince(key) {
      const parts = key.split('-').map((part) => Number.parseInt(part, 10));
      if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return null;
      const then = new Date(parts[0], parts[1] - 1, parts[2]);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const days = Math.round((today.getTime() - then.getTime()) / 86400000);
      return Number.isInteger(days) ? days : null;
    }

    function absoluteDayLabel(key, locale) {
      if (key === 'unknown') return null;
      const parts = key.split('-').map((part) => Number.parseInt(part, 10));
      if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return key;
      try {
        return new Intl.DateTimeFormat(locale, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }).format(new Date(parts[0], parts[1] - 1, parts[2]));
      } catch (error) {
        return key;
      }
    }

    function relativeDayLabel(key, t) {
      if (key === 'unknown') return t('group.unknown');
      const days = daysSince(key);
      if (days === null) return key;
      if (days <= 0) return t('group.today');
      if (days === 1) return t('group.yesterday');
      if (days < 7) return t('day.daysAgo', { count: days });
      if (days < 30) {
        const weeks = Math.floor(days / 7);
        return weeks <= 1 ? t('day.weekAgo') : t('day.weeksAgo', { count: weeks });
      }
      if (days < 365) {
        const months = Math.floor(days / 30);
        return months <= 1 ? t('day.monthAgo') : t('day.monthsAgo', { count: months });
      }
      const years = Math.floor(days / 365);
      return years <= 1 ? t('day.yearAgo') : t('day.yearsAgo', { count: years });
    }

    /** Group-heading text: relative by default, absolute when the reader switched. */
    function dayLabel(key, t, locale, mode) {
      return mode === 'absolute' ? absoluteDayLabel(key, locale) : relativeDayLabel(key, t);
    }

    /** Stable hue for a project name, so one project keeps one colour everywhere. */
    function hueOf(text) {
      let hash = 0x811c9dc5;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash % 360;
    }

    function projectParts(path) {
      const parts = String(path).split('/').filter((part) => part !== '');
      const name = parts.length > 0 ? parts[parts.length - 1] : String(path);
      return { name, group: parts.slice(0, -1).join('/') };
    }

    /**
     * Tag text per project: the last path segment, widened to `group/name` only when
     * two listed projects share that segment, and to the full path when even that
     * collides. Unambiguous projects therefore keep the short name.
     */
    function buildProjectLabels(paths) {
      const nameCounts = new Map();
      const groupNameCounts = new Map();
      for (const path of paths) {
        const { name, group } = projectParts(path);
        const qualified = group === '' ? name : `${group}/${name}`;
        nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
        groupNameCounts.set(qualified, (groupNameCounts.get(qualified) ?? 0) + 1);
      }
      const labels = new Map();
      for (const path of paths) {
        const { name, group } = projectParts(path);
        const qualified = group === '' ? name : `${group}/${name}`;
        if ((nameCounts.get(name) ?? 0) <= 1) labels.set(path, name);
        else if ((groupNameCounts.get(qualified) ?? 0) <= 1) labels.set(path, qualified);
        else labels.set(path, path);
      }
      return labels;
    }

    function statePill(item, t) {
      if (item.state === '' || item.state === 'opened') {
        return item.draft
          ? h('span', { className: 'gmrs_pill gmrs_pillDraft', key: 'draft' }, t('row.draft'))
          : null;
      }
      const name = item.state === 'merged' ? 'gmrs_pill gmrs_pillMerged'
        : item.state === 'closed' ? 'gmrs_pill gmrs_pillClosed'
          : 'gmrs_pill';
      return h('span', { className: name, key: 'state' }, t(`state.${item.state}`));
    }

    // --------------------------------------------------------------- components

    /** The sidebar row's icon; the shell owns the button and its label. */
    function PanelIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 20;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('circle', { cx: 6.5, cy: 5, r: 2.6, key: 'a' }),
        h('circle', { cx: 6.5, cy: 19, r: 2.6, key: 'b' }),
        h('circle', { cx: 17.5, cy: 12, r: 2.6, key: 'c' }),
        h('path', { d: 'M6.5 7.6v8.8', key: 'd' }),
        h('path', { d: 'M9.1 5.6c3.7 0 3.3 5.2 5.7 6', key: 'e' }),
      );
    }

    function MergeRequestRow(props) {
      const { item, t, locale, tag } = props;
      const meta = [`!${item.iid}`];
      if (item.author !== '') meta.push(`@${item.author}`);
      if (item.sourceBranch !== '') meta.push(`${item.sourceBranch} → ${item.targetBranch || '?'}`);
      if (item.userNotesCount > 0) {
        meta.push(t(item.userNotesCount === 1 ? 'row.note' : 'row.notes', { count: item.userNotesCount }));
      }
      if (item.updatedAt !== '') meta.push(t('row.updated', { when: relativeTime(item.updatedAt, t) }));

      return h(
        'a',
        {
          className: 'gmrs_row',
          href: item.webUrl === '' ? undefined : item.webUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          title: t('open.hint'),
        },
        h('div', { className: 'gmrs_rowMain', key: 'main' }, [
          h('div', { className: 'gmrs_rowTitle', key: 'title' }, [
            h('span', {
              className: 'gmrs_tag',
              key: 'tag',
              title: item.project,
              style: { '--gmrs-tag-h': String(hueOf(tag)) },
            }, tag),
            statePill(item, t),
            h('span', { className: 'gmrs_rowTitleText', key: 'text' }, item.title || t('row.untitled')),
          ]),
          h('div', { className: 'gmrs_rowMeta', key: 'meta' }, meta.join(' · ')),
        ]),
        h('div', { className: 'gmrs_rowSide', key: 'side' },
          h('span', { className: 'gmrs_rowTime', key: 'time' }, timeOfDay(item.createdAt, locale))),
      );
    }

    function MergeRequestsPanel(props) {
      const t = React.useMemo(() => translator(props.t || boundTranslator), [props.t]);
      const locale = React.useMemo(() => localeTag(), []);

      const [filter, setFilter] = React.useState('');
      const [items, setItems] = React.useState([]);
      const [meta, setMeta] = React.useState(null);
      const [phase, setPhase] = React.useState('loading');
      const [error, setError] = React.useState('');
      const [hasMore, setHasMore] = React.useState(false);
      const [loadingMore, setLoadingMore] = React.useState(false);
      const [spinning, setSpinning] = React.useState(false);
      const [groupMode, setGroupMode] = React.useState(readGroupMode);

      const scrollRef = React.useRef(null);
      const sentinelRef = React.useRef(null);
      const cursor = React.useRef({ state: '', offset: 0, hasMore: true, busy: false, gen: 0 });

      const load = React.useCallback(async (options) => {
        const opts = options === undefined ? {} : options;
        const reset = opts.reset === true;
        const refresh = opts.refresh === true;
        const requestedState = typeof opts.state === 'string' ? opts.state : null;
        const cursorNow = cursor.current;

        if (reset) {
          cursorNow.gen += 1;
          cursorNow.busy = false;
          cursorNow.offset = 0;
          cursorNow.hasMore = true;
          if (requestedState !== null) cursorNow.state = requestedState;
          setItems([]);
          setPhase('loading');
          setError('');
          setHasMore(false);
        } else if (cursorNow.busy || !cursorNow.hasMore) {
          return;
        }

        const generation = cursorNow.gen;
        cursorNow.busy = true;
        if (reset) setSpinning(refresh);
        else setLoadingMore(true);

        try {
          const query = { offset: cursorNow.offset, limit: PAGE_SIZE };
          if (cursorNow.state !== '') query.state = cursorNow.state;
          if (refresh) query.refresh = '1';
          const response = await fetch(apiUrl('list', query), {
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
          });
          let body = null;
          try {
            body = await response.json();
          } catch (parseFailure) {
            body = null;
          }
          if (!response.ok) {
            const reason = body !== null && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
            throw new Error(reason);
          }
          if (generation !== cursorNow.gen) return;

          const pageItems = body !== null && Array.isArray(body.items) ? body.items : [];
          cursorNow.offset += pageItems.length;
          cursorNow.hasMore = body !== null && body.hasMore === true;
          setItems((previous) => (reset ? pageItems : previous.concat(pageItems)));
          setMeta({
            total: body !== null && typeof body.total === 'number' ? body.total : pageItems.length,
            user: body !== null && typeof body.user === 'string' ? body.user : '',
            state: body !== null && typeof body.state === 'string' ? body.state : '',
            projects: body !== null && Array.isArray(body.projects) ? body.projects : [],
            fetchedAt: body !== null && typeof body.fetchedAt === 'string' ? body.fetchedAt : '',
          });
          if (cursorNow.state === '' && body !== null && typeof body.state === 'string') {
            cursorNow.state = body.state;
            setFilter(body.state);
          }
          setPhase('ready');
          setHasMore(cursorNow.hasMore);
          setError('');
        } catch (failure) {
          if (generation !== cursorNow.gen) return;
          cursorNow.hasMore = false;
          setError(failure instanceof Error ? failure.message : String(failure));
          setPhase((previous) => (previous === 'loading' ? 'error' : previous));
          setHasMore(false);
        } finally {
          if (generation === cursorNow.gen) {
            cursorNow.busy = false;
            setLoadingMore(false);
            setSpinning(false);
          }
        }
      }, []);

      React.useEffect(() => {
        load({ reset: true });
      }, [load]);

      React.useEffect(() => {
        if (!hasMore) return undefined;
        const sentinel = sentinelRef.current;
        if (sentinel === null || sentinel === undefined) return undefined;
        if (typeof IntersectionObserver !== 'function') return undefined;
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) load();
            }
          },
          { root: scrollRef.current === null ? null : scrollRef.current, rootMargin: '320px 0px' },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
      }, [hasMore, items.length, load]);

      const activeFilter = filter !== '' ? filter : meta !== null ? meta.state : '';

      const chooseFilter = (next) => {
        if (next === activeFilter) return;
        setFilter(next);
        if (scrollRef.current !== null) scrollRef.current.scrollTop = 0;
        load({ reset: true, state: next });
      };

      const refresh = () => {
        if (scrollRef.current !== null) scrollRef.current.scrollTop = 0;
        load({ reset: true, refresh: true });
      };

      const retryEarlier = () => {
        cursor.current.hasMore = true;
        setHasMore(true);
        load();
      };

      const toggleGroupMode = () => {
        const next = groupMode === 'relative' ? 'absolute' : 'relative';
        setGroupMode(next);
        writeGroupMode(next);
      };

      const groups = React.useMemo(() => {
        const result = [];
        let current = null;
        for (const item of items) {
          const key = dayKey(item.createdAt);
          if (current === null || current.key !== key) {
            current = { key, items: [] };
            result.push(current);
          }
          current.items.push(item);
        }
        return result;
      }, [items]);

      const projectErrors = meta === null ? [] : meta.projects.filter((project) => project.error !== '');
      const labels = React.useMemo(
        () => buildProjectLabels(meta === null ? [] : meta.projects.map((project) => project.path)),
        [meta],
      );
      const subtitle = meta === null
        ? t('panel.subtitleLoading')
        : t('panel.subtitle', {
            total: meta.total,
            user: meta.user === '' ? t('panel.you') : `@${meta.user}`,
            projects: meta.projects.length,
          });

      const toolbar = h('div', { className: 'gmrs_toolbar' }, [
        h('div', { className: 'gmrs_titleRow', key: 'row' }, [
          h('h1', { className: 'gmrs_title', key: 'title' }, t('panel.title')),
          h('button', {
            className: 'gmrs_btn',
            type: 'button',
            key: 'refresh',
            onClick: refresh,
            disabled: phase === 'loading',
          }, [
            spinning ? h('span', { className: 'gmrs_spinner', key: 'spin' }) : null,
            h('span', { key: 'label' }, t('refresh')),
          ].filter((node) => node !== null)),
        ]),
        h('p', { className: 'gmrs_subtitle', key: 'subtitle' }, subtitle),
        h('div', { className: 'gmrs_controls', key: 'controls' }, [
          h('div', {
            className: 'gmrs_seg',
            role: 'group',
            'aria-label': t('filter.aria'),
            key: 'seg',
          }, FILTERS.map((value) => h('button', {
            className: 'gmrs_segBtn',
            type: 'button',
            key: value,
            'aria-pressed': activeFilter === value ? 'true' : 'false',
            onClick: () => chooseFilter(value),
          }, t(`filter.${value}`)))),
          h('span', { className: 'gmrs_spacer', key: 'spacer' }),
          h('span', { className: 'gmrs_sort', key: 'sort' }, t('sort.newest')),
        ]),
      ]);

      let body;
      if (items.length === 0 && phase === 'loading') {
        body = h('div', { className: 'gmrs_empty' }, [
          h('span', { className: 'gmrs_spinner', key: 'spin' }),
          h('span', { key: 'label' }, t('loading')),
        ]);
      } else if (items.length === 0 && phase === 'error') {
        body = h('div', { className: 'gmrs_empty' }, [
          h('div', { className: 'gmrs_note gmrs_noteError', key: 'message' }, error || t('error.title')),
          h('button', {
            className: 'gmrs_btn',
            type: 'button',
            key: 'retry',
            onClick: () => load({ reset: true }),
          }, t('error.retry')),
        ]);
      } else if (items.length === 0) {
        body = h('div', { className: 'gmrs_empty' },
          t('empty', { state: t(`filter.${activeFilter === '' ? 'opened' : activeFilter}`) }));
      } else {
        body = h('div', { key: 'groups' }, groups.map((group) => h('section', {
          className: 'gmrs_group',
          key: group.key,
        }, [
          h('button', {
            className: 'gmrs_groupHead',
            key: 'head',
            type: 'button',
            onClick: toggleGroupMode,
            title: t('group.hint'),
            'aria-label': `${dayLabel(group.key, t, locale, groupMode)} · ${t('group.hint')}`,
          }, [
            h('span', { className: 'gmrs_groupText', key: 'text' },
              dayLabel(group.key, t, locale, groupMode)),
            h('svg', {
              className: 'gmrs_groupIcon',
              key: 'icon',
              viewBox: '0 0 16 16',
              width: 12,
              height: 12,
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.6,
              strokeLinecap: 'round',
              'aria-hidden': true,
            }, [
              h('circle', { cx: 8, cy: 8, r: 6, key: 'c' }),
              h('path', { d: 'M8 4.6V8l2.4 1.4', key: 'h' }),
            ]),
          ]),
          h('div', { className: 'gmrs_list', key: 'list' }, group.items.map((item) => h(MergeRequestRow, {
            key: `${item.project}!${item.iid}`,
            item,
            t,
            locale,
            tag: labels.get(item.project) || projectParts(item.project).name,
          }))),
        ])));
      }

      const tail = [];
      if (error !== '' && items.length > 0) {
        tail.push(h('div', { className: 'gmrs_warn', key: 'error' }, [
          h('div', { className: 'gmrs_warnTitle', key: 'title' }, t('error.title')),
          h('div', { key: 'message' }, error),
          h('button', {
            className: 'gmrs_btn',
            type: 'button',
            key: 'retry',
            onClick: retryEarlier,
          }, t('error.retry')),
        ]));
      }
      if (projectErrors.length > 0) {
        tail.push(h('div', { className: 'gmrs_warn', key: 'projects' }, [
          h('div', { className: 'gmrs_warnTitle', key: 'title' }, t('error.partial')),
          ...projectErrors.map((project) => h('div', { key: project.path }, `${project.path}: ${project.error}`)),
        ]));
      }
      if (items.length > 0 && hasMore) {
        tail.push(h('div', { className: 'gmrs_end', key: 'more' }, [
          loadingMore ? h('span', { className: 'gmrs_spinner', key: 'spin' }) : null,
          h('button', {
            className: 'gmrs_btn',
            type: 'button',
            key: 'button',
            onClick: () => load(),
            disabled: loadingMore,
          }, loadingMore ? t('loadingMore') : t('loadEarlier')),
          h('div', { key: 'sentinel', ref: sentinelRef, style: { height: '1px' } }),
        ].filter((node) => node !== null)));
      } else if (items.length > 0) {
        tail.push(h('div', { className: 'gmrs_end', key: 'end' }, t('end')));
      }

      const projectCount = meta === null || meta.projects.length === 0
        ? 0
        : meta.projects.length;

      return h('div', { className: 'gmrs_root' },
        h('div', { className: 'gmrs_scroll', key: 'scroll', ref: scrollRef },
          h('div', { className: 'gmrs_page', key: 'page' }, [
            toolbar,
            body,
            ...tail,
            h('div', { className: 'gmrs_footer', key: 'footer' },
              h('div', { className: 'gmrs_footerLine', key: 'projects' },
                t('footer.manage', { count: projectCount }))),
          ])));
    }

    /** The Settings → GitLab MRs page: the GitLab URL and the project list. */
    function SettingsSection(props) {
      const t = React.useMemo(() => translator(props.t || boundTranslator), [props.t]);
      const [url, setUrl] = React.useState('');
      const [savedUrl, setSavedUrl] = React.useState('');
      const [draft, setDraft] = React.useState('');
      const [savedText, setSavedText] = React.useState('');
      const [count, setCount] = React.useState(0);
      const [phase, setPhase] = React.useState('loading');
      const [error, setError] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [storePath, setStorePath] = React.useState('');

      const applyServerState = (body) => {
        const list = body !== null && Array.isArray(body.projects) ? body.projects : [];
        const text = list.join('\n');
        const nextUrl = body !== null && typeof body.baseUrl === 'string' ? body.baseUrl : '';
        setUrl(nextUrl);
        setSavedUrl(nextUrl);
        setDraft(text);
        setSavedText(text);
        setCount(list.length);
        setStorePath(body !== null && typeof body.storePath === 'string' ? body.storePath : '');
      };

      const load = React.useCallback(async () => {
        setPhase('loading');
        setError('');
        try {
          const response = await fetch(apiUrl('settings'), {
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
          });
          const body = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(body !== null && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`);
          }
          applyServerState(body);
          setPhase('ready');
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
          setPhase('error');
        }
      }, []);

      React.useEffect(() => {
        load();
      }, [load]);

      const send = async (payload) => {
        setPhase('saving');
        setError('');
        setNotice('');
        try {
          const response = await fetch(apiUrl('settings'), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const body = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(body !== null && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`);
          }
          applyServerState(body);
          setNotice(t('settings.saved'));
          setPhase('ready');
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
          setPhase('error');
        }
      };

      const save = () => send({ baseUrl: url.trim(), projects: draft.split('\n') });
      const reset = () => send({ reset: true });
      const busy = phase === 'saving' || phase === 'loading';
      const urlValid = /^https?:\/\/[^/\s]+/i.test(url.trim());
      const dirty = url.trim() !== savedUrl || draft !== savedText;
      const statusText = phase === 'saving' ? t('settings.saving') : notice;

      return h('section', { className: 'gmrs_settings' }, [
        h('h2', { className: 'gmrs_settingsTitle', key: 'title' }, t('settings.title')),
        h('p', { className: 'gmrs_settingsDesc', key: 'desc' }, t('settings.description')),
        h('div', { className: 'gmrs_field', key: 'url' }, [
          h('label', { className: 'gmrs_label', key: 'label', htmlFor: 'gmrs-url' }, t('settings.urlLabel')),
          h('input', {
            id: 'gmrs-url',
            className: 'gmrs_input',
            key: 'input',
            type: 'url',
            value: url,
            placeholder: t('settings.urlPlaceholder'),
            spellCheck: false,
            disabled: phase === 'loading',
            onChange: (event) => {
              setUrl(event.target.value);
              setNotice('');
            },
          }),
          h('p', { className: 'gmrs_hint', key: 'hint' },
            urlValid || url.trim() === '' ? t('settings.urlHint') : t('settings.urlInvalid')),
        ]),
        h('div', { className: 'gmrs_field', key: 'projects' }, [
          h('label', { className: 'gmrs_label', key: 'label', htmlFor: 'gmrs-projects' },
            t('settings.projectsLabel')),
          h('textarea', {
            id: 'gmrs-projects',
            className: 'gmrs_textarea',
            key: 'input',
            value: draft,
            rows: 16,
            spellCheck: false,
            disabled: phase === 'loading',
            onChange: (event) => {
              setDraft(event.target.value);
              setNotice('');
            },
          }),
          h('p', { className: 'gmrs_hint', key: 'hint' }, t('settings.hint')),
        ]),
        h('div', { className: 'gmrs_actions', key: 'actions' }, [
          h('button', {
            className: 'gmrs_btn gmrs_btnPrimary',
            type: 'button',
            key: 'save',
            onClick: save,
            disabled: busy || !dirty || !urlValid,
          }, t('settings.save')),
          h('button', {
            className: 'gmrs_btn',
            type: 'button',
            key: 'reset',
            onClick: reset,
            disabled: busy,
          }, t('settings.reset')),
          h('span', {
            className: `gmrs_status${error !== '' ? ' gmrs_statusError' : notice !== '' ? ' gmrs_statusOk' : ''}`,
            key: 'status',
          }, error !== '' ? `${t('settings.error')} ${error}` : statusText),
        ]),
        h('p', { className: 'gmrs_hint', key: 'count' }, t('settings.count', { count })),
        storePath === ''
          ? null
          : h('p', { className: 'gmrs_hint', key: 'store' }, t('settings.storeHint', { path: storePath })),
      ].filter((node) => node !== null));
    }

    // -------------------------------------------------------------- registration

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'gitlab-assigned: dictionaries');
        const t = translator(ctx.locale.bind(NS));
        boundTranslator = t;
        ctx.effect(() => installStyles(), 'gitlab-assigned: styles');

        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.panellist',
                  id: PANEL_ID,
                  order: 20,
                  locale: NS,
                  label: () => t('nav.label'),
                },
                PanelIcon,
              ),
            ),
          'gitlab-assigned: sidebar entry',
        );

        ctx.effect(
          () =>
            ctx.slots.inject('main', () =>
              ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, MergeRequestsPanel),
            ),
          'gitlab-assigned: panel',
        );

        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: PANEL_ID,
                  order: 30,
                  locale: NS,
                  label: () => t('settings.nav'),
                },
                SettingsSection,
              ),
            ),
          'gitlab-assigned: settings page',
        );
      },
    };
  },
});
