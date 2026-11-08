/** @typedef {import('./data.mjs').State} State */
/** @typedef {import('./data.mjs').Row} Row */

/** @type {(keyof State)[]} */
const stateKeys = ['domain', 'benchmark', 'version', 'model', 'outcome', 'scope', 'q', 'analysis', 'cohorts', 'task', 'task_run', 'compare', 'page', 'view', 'tab', 'm', 'sort', 'group', 'anchor', 'dimension', 'paper', 'record'];

/** @param {URLSearchParams} params @returns {State} */
function fromParams(params) {
  const state = /** @type {State} */ (/** @type {unknown} */ (Object.fromEntries(stateKeys.map(key => [key, params.get(key) ?? '']))));
  state.scope = state.scope === 'all' ? 'all' : 'reported';
  const page = Number(state.page);
  state.page = Number.isSafeInteger(page) && page > 0 ? page : 1;
  state.view = ['tasks', 'runs', 'models'].includes(state.view) ? state.view : 'tasks';
  if (state.tab === 'task') state.tab = 'prompts';
  state.tab = ['transcript', 'verdict', 'prompts', 'analysis', 'provenance'].includes(state.tab) ? state.tab : '';
  state.group = ['model', 'task', 'domain', 'outcome'].includes(state.group) ? state.group : '';
  state.dimension = ['overview', 'checks', 'conversation', 'tools', 'resources', 'setup'].includes(state.dimension) ? state.dimension : 'overview';
  state.paper = state.paper === 'expanded' ? 'expanded' : '';
  return state;
}

export function emptyState() {
  return fromParams(new URLSearchParams());
}

/** @param {State} state @returns {(keyof State)[]} */
function queryKeys(state) {
  if (state.task_run) return state.compare ? ['scope', 'dimension', 'm', 'anchor'] : ['scope', 'tab', 'm', 'anchor'];
  if (state.task) return ['scope', 'tab', 'record'];
  return ['version', 'model', 'outcome', 'scope', 'q', 'analysis', 'cohorts', 'page', 'sort', 'paper', ...(state.view === 'runs' ? /** @type {const} */ (['group']) : [])];
}

/** @param {string} path */
function viewId(path) {
  return path.slice(path.lastIndexOf('/') + 1, path.lastIndexOf('/') + 17);
}

/** @param {Row[]} rows @param {string | URL} root */
export function createRouter(rows, root) {
  const base = new URL(root);
  const runIds = new Map(rows.map(row => [row.task_run_id, viewId(row.record_path)]));
  const taskIds = new Map(rows.map(row => [row.task_key, viewId(row.task_view_path)]));
  const runs = new Map([...runIds].map(([key, id]) => [id, key]));
  const tasks = new Map([...taskIds].map(([key, id]) => [id, key]));
  const rowsByRun = new Map(rows.map(row => [row.task_run_id, row]));
  const rowsByTask = new Map(rows.map(row => [row.task_key, row]));

  /** @param {string | URL} address @returns {State} */
  function read(address) {
    const url = new URL(address, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('Route is outside the application.');
    let path = url.pathname.slice(base.pathname.length);
    let params = new URLSearchParams(url.search);
    if (url.hash.startsWith('#/') || /^#[a-z_]+=/.test(url.hash)) {
      const [published, query = ''] = url.hash.slice(1).split('?');
      path = published.startsWith('/') ? published.slice(1) : '';
      params = new URLSearchParams(published.startsWith('/') ? query : published);
    }
    const parts = path.split('/').filter(Boolean).map(part => {
      try { return decodeURIComponent(part); } catch { return part; }
    });
    if (parts[0] === 'task') params.set('task', tasks.get(parts[1]) ?? parts[1] ?? '');
    else if (parts[0] === 'run') params.set('task_run', runs.get(parts[1]) ?? parts[1] ?? '');
    else if (parts[0] === 'compare') {
      params.set('task_run', runs.get(params.get('a') ?? '') ?? params.get('a') ?? '');
      params.set('compare', runs.get(params.get('b') ?? '') ?? params.get('b') ?? '');
    } else if (parts.length) {
      const viewOnly = ['tasks', 'runs', 'models'].includes(parts[1]);
      params.set('benchmark', parts[0] === 'tau2' ? 'tau2-bench' : parts[0]);
      params.set('domain', viewOnly || parts[1] === 'all' ? '' : parts[1] ?? '');
      params.set('view', viewOnly ? parts[1] : parts[2] ?? 'tasks');
    }
    const parsed = fromParams(params);
    const state = {...emptyState(), benchmark: parsed.benchmark, domain: parsed.domain, view: parsed.view,
      task: parsed.task_run ? '' : parsed.task, task_run: parsed.task_run, compare: parsed.compare,
      ...Object.fromEntries(queryKeys(parsed).map(key => [key, parsed[key]]))};
    state.record = runs.get(state.record) ?? state.record;
    const row = state.task_run ? rowsByRun.get(state.task_run) : rowsByTask.get(state.task);
    if (state.task_run || state.task) { state.benchmark = row?.benchmark ?? ''; state.domain = row?.domain ?? ''; }
    if (state.task_run) state.view = 'runs';
    else if (state.task) state.view = 'tasks';
    if (state.task && state.tab === 'verdict') state.tab = '';
    return state;
  }

  /** @param {State} state */
  function href(state) {
    const encode = encodeURIComponent;
    let path = state.benchmark ? `${encode(state.benchmark === 'tau2-bench' ? 'tau2' : state.benchmark)}/` : '';
    if (state.domain) path += `${encode(state.domain)}/`;
    if (state.view !== 'tasks') path += `${state.view}/`;
    if (state.task && !state.task_run) path = `task/${encode(taskIds.get(state.task) ?? state.task)}/`;
    const params = new URLSearchParams();
    if (state.task_run) {
      path = state.compare ? 'compare/' : `run/${encode(runIds.get(state.task_run) ?? state.task_run)}/`;
      if (state.compare) {
        params.set('a', runIds.get(state.task_run) ?? state.task_run);
        params.set('b', runIds.get(state.compare) ?? state.compare);
      }
    }
    const defaults = emptyState();
    for (const key of queryKeys(state)) {
      const value = state[key];
      if (value === defaults[key] || value === '' || (state.task && key === 'tab' && value === 'verdict')) continue;
      params.set(key, key === 'record' ? runIds.get(String(value)) ?? String(value) : String(value));
    }
    const url = new URL(path, base);
    if (!url.pathname.startsWith(base.pathname)) throw new Error('Route is outside the application.');
    url.search = params.toString();
    return url.pathname + url.search;
  }

  return {read, href};
}
