/**
 * @typedef {import('./data.mjs').Row} Row
 * @typedef {import('./data.mjs').Catalog} Catalog
 * @typedef {import('./data.mjs').Source} Source
 * @typedef {import('./data.mjs').Cohort} Cohort
 * @typedef {import('./data.mjs').Message} Message
 * @typedef {import('./data.mjs').RunView} RunView
 * @typedef {import('./data.mjs').TaskView} TaskView
 * @typedef {import('./data.mjs').Annotation} Annotation
 * @typedef {import('./data.mjs').State} State
 * @typedef {import('./data.mjs').Component} Component
 */
import {
  repositoryUrl, viewUrl, validateCatalog, selectRows, summarize,
  comparisonRows, selectCohortIds, compareCohorts, compareTaskRuns, conversationTurns, argumentPayload, taskMatrix, groupTaskRuns, matrixColumns, summarizeChecks, runDisplayStatus, checkSummary,
} from './data.mjs';
import {automationBenchPaper} from './paper-results.mjs';
import {createRouter, emptyState} from './routes.mjs';

const root = new URL('../', import.meta.url);
const appBase = new URL('./', document.baseURI);
/** @type {HTMLBaseElement} */
const baseElement = /** @type {HTMLBaseElement} */ (document.querySelector('base'));
baseElement.href = appBase.href;
const pageSize = 50;
/** @type {Record<string, HTMLInputElement | HTMLSelectElement>} */
const controls = Object.fromEntries([
  ['domain', 'domain'], ['benchmark', 'benchmark'], ['version', 'version'],
  ['model', 'model'], ['outcome', 'outcome'], ['scope', 'scope'],
  ['q', 'query'], ['analysis', 'analysis-query'], ['sort', 'sort'], ['group', 'group'],
].map(([key, id]) => [key, /** @type {HTMLInputElement | HTMLSelectElement} */ (element(id))]));
const errorRegion = element('error');
const loading = element('loading');
const browse = element('browse');
const inspection = element('inspection');
/** @type {Map<HTMLAnchorElement, {patch: Partial<State>, anchor: string | null}>} */
const navigationLinks = new Map();
let state = emptyState();
/** @type {ReturnType<typeof createRouter>} */
let routes;
/** @type {Catalog} */
let catalog;
/** @type {Map<string, Row>} */
let rowsById = new Map();
/** @type {string | null} */
let detailKey = null;
let detailRequest = 0;
/** @type {AbortController | undefined} */
let detailAbort;
/** @type {string | null} */
let focusSelection = null;
/** @type {string | null} */
let requestedAnchor = null;
/** @type {Record<string, Annotation[]> | undefined} */
let annotationData;
/** @type {Promise<Record<string, Annotation[]>> | undefined} */
let annotationRequest;

/** @param {string} id @returns {HTMLElement} */
function element(id) {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing explorer element: ${id}`);
  return result;
}

/** @template {keyof HTMLElementTagNameMap} T @param {T} tag @param {unknown} [text] @param {string} [className] @returns {HTMLElementTagNameMap[T]} */
function node(tag, text = null, className = '') {
  const result = document.createElement(tag);
  if (text !== null) result.textContent = String(text);
  if (className) result.className = className;
  return result;
}

/** @param {'check' | 'close' | 'partial' | 'agent' | 'user' | 'document' | 'tool' | 'unknown' | 'folder' | 'grid' | 'list' | 'compare' | 'models'} name */
function icon(name) {
  const paths = {
    check: 'M5 12l4 4L19 6', close: 'M6 6l12 12M18 6 6 18', unknown: 'M12 6v7M12 17h.01',
    partial: 'M12 3 2 21h20L12 3ZM12 10v5M12 18h.01',
    agent: 'M6 6h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2ZM12 3v3M8 12h.01M16 12h.01M9 16h6',
    user: 'M8 8a4 4 0 1 0 8 0 4 4 0 0 0-8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
    document: 'M14 3H5v18h14V8L14 3Zm0 0v5h5M8 12h8M8 16h6', tool: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 18',
    folder: 'M3 7V5h7l2 2h9v13H3V7Z', grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    compare: 'M4 4h6v16H4zM14 4h6v16h-6z', models: 'm12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', paths[name]);
  svg.append(path);
  return svg;
}

/** @param {string | null} model */
function modelName(model) { return model?.split('/').at(-1) ?? 'Unrecorded'; }

/** @param {Row} row */
function nativeScoreLabel(row) { return row.benchmark === 'automationbench' ? 'Assertion fraction' : 'Native score'; }

/** @param {Row} row */
function taskTitle(row) {
  const text = row.benchmark === 'automationbench' ? row.task_id.split('.').at(-1) ?? row.task_id : /^\[([^\]]+)\]/.exec(row.task_id)?.[1];
  if (!text) return `${row.domain.charAt(0).toUpperCase()}${row.domain.slice(1)} · Task ${row.task_id}`;
  const words = text.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** @param {Row} row */
function runLabel(row) { return `${modelName(row.evaluated_agent_model)}${row.trial_index !== null ? ` · trial ${row.trial_index}` : ''}`; }

/** @param {string} role */
function sourceRoleLabel(role) { return role === 'primary-result' ? 'Reported result' : role === 'retained-checkpoint' ? 'Retained checkpoint' : role; }

/** @param {Cohort} cohort */
function sourceDates(cohort) { return [...new Set(cohort.source_dates)].join(', '); }

/** @param {string} domain */
function domainName(domain) { return domain === 'hr' ? 'HR' : domain.charAt(0).toUpperCase() + domain.slice(1); }

/** @param {number[]} values */
function countRange(values) {
  const counts = [...new Set(values)].sort((a, b) => a - b);
  return counts.length === 1 ? String(counts[0]) : `${counts[0]}–${counts.at(-1)}`;
}

/** @param {string} id @returns {Row} */
function rowFor(id) {
  const row = rowsById.get(id);
  if (!row) throw new Error('The requested task run is not in the catalog.');
  return row;
}

/** @param {unknown} value */
function display(value) {
  if (value === null || value === undefined) return 'Unrecorded';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** @param {unknown} value */
function raw(value) {
  return node('pre', typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'Unrecorded', 'json');
}

/** @param {string} label @param {...Node} content */
function disclosure(label, ...content) {
  const result = node('details');
  result.append(node('summary', label), ...content);
  return result;
}

/** @param {string} label @param {(event: MouseEvent) => unknown} action */
function button(label, action) {
  const result = node('button', label);
  result.type = 'button';
  result.addEventListener('click', action);
  return result;
}

/** @param {Array<[string, unknown]>} entries */
function fields(entries) {
  const result = node('dl', null, 'metadata');
  for (const [label, value] of entries) {
    const term = node('dt', label);
    const definition = node('dd');
    definition.append(value instanceof Node ? value : document.createTextNode(display(value)));
    result.append(term, definition);
  }
  return result;
}

/** @param {string} path @param {string} [label] */
function repositoryLink(path, label = path) {
  const result = node('a', label);
  const url = repositoryUrl(path, root);
  result.href = path.startsWith('views/explorer/') ? url : `https://github.com/arise-enterprise-ai-research/benchmark-results/blob/main/${path.split('/').map(encodeURIComponent).join('/')}`;
  if (!path.startsWith('views/explorer/')) result.title = 'Private source repository. Access requires repository permission.';
  return result;
}

/** @param {Source | null | undefined} source */
function sourceReference(source) {
  const result = node('div', null, 'source');
  if (!source) {
    result.textContent = 'Source unrecorded';
    return result;
  }
  try {
    result.append(repositoryLink(source.path));
  } catch {
    result.append(node('span', `Invalid repository path. Link disabled: ${display(source.path)}`));
  }
  if (source.pointer !== undefined) result.append(node('div', `JSON Pointer: ${display(source.pointer)}`));
  if (source.sha256 !== undefined) result.append(node('div', `SHA-256: ${display(source.sha256)}`));
  return result;
}

/** @param {Partial<State>} patch @param {string | null} [anchor] */
function linkUrl(patch, anchor) {
  return routes.href({...state, ...patch, ...(anchor ? {anchor} : {})});
}

/** @param {string} label @param {Partial<State>} patch @param {string | null} [anchor] */
function navigationLink(label, patch, anchor = null) {
  if (patch.task_run) patch = {task: '', record: '', ...patch};
  if (patch.task !== undefined && patch.task !== state.task) patch = {record: '', ...patch};
  const result = node('a', label);
  result.href = linkUrl(patch, anchor);
  navigationLinks.set(result, {patch, anchor});
  result.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(patch, {focus: true, anchor});
  });
  return result;
}

function refreshNavigationLinks() {
  for (const [link, target] of navigationLinks) {
    if (!link.isConnected) navigationLinks.delete(link);
    else link.href = linkUrl(target.patch, target.anchor);
  }
}

/** @param {Partial<State>} patch @param {{focus?: boolean, anchor?: string | null, replace?: boolean}} [options] */
function navigate(patch, {focus = false, anchor = null, replace = false} = {}) {
  if (patch.task_run) patch = {task: '', record: '', ...patch};
  if (patch.task !== undefined && patch.task !== state.task) patch = {record: '', ...patch};
  if (patch.task_run !== undefined && patch.task_run !== state.task_run) patch = {m: '', anchor: '', ...patch};
  const next = {...state, ...patch, ...(anchor ? {anchor} : {})};
  const url = linkUrl(patch, anchor);
  if (location.pathname + location.search !== url || location.hash) {
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
  }
  state = next;
  render({focus, anchor});
}

/** @param {string} id */
function revealAnchor(id) {
  const target = document.getElementById(id);
  if (!target || (!inspection.contains(target) && !element('task-detail').contains(target))) return false;
  const run = target.closest('.task-run');
  const comparison = target.closest('.comparison-grid');
  const pane = target.closest('section.rail-pane');
  const row = catalog.rows.find(item => run?.id === anchorId(item, 'section', 'task-run'));
  if (comparison && state.compare && row && pane instanceof HTMLElement && pane.dataset.tab === 'verdict') {
    navigate({task_run: row.task_run_id, compare: '', tab: 'verdict'}, {focus: true, anchor: id, replace: true});
    return true;
  }
  if (comparison && state.compare) activateComparisonDimension(pane instanceof HTMLElement ? 'setup' : state.dimension === 'tools' && target.closest('.turn')?.getAttribute('data-has-tools') === 'true' ? 'tools' : 'conversation');
  if (row && pane instanceof HTMLElement && pane.dataset.tab) activateRail(pane.dataset.tab, row);
  else if (row && target.closest('.trajectory')) activateRail('transcript', row);
  const messageSelection = run?.querySelector('.conversation-navigation select');
  if (target.dataset.sequence !== undefined && messageSelection instanceof HTMLSelectElement) {
    messageSelection.value = target.dataset.sequence; messageSelection.dispatchEvent(new Event('input'));
  }
  if (target instanceof HTMLDetailsElement) target.open = true;
  for (let parent = target.parentElement; parent && parent !== inspection && parent !== element('task-detail'); parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  target.scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  target.focus({preventScroll: true});
  return true;
}

/** @param {Row} row @param {string} kind @param {string | number} value */
function anchorId(row, kind, value) {
  return `run-${encodeURIComponent(row.task_run_id)}-${kind}-${encodeURIComponent(String(value))}`;
}

/** @param {Row} row @param {string} kind @param {string | number} value @param {string} label */
function evidenceLink(row, kind, value, label) {
  return navigationLink(label, state.task ? {task: '', task_run: row.task_run_id, compare: ''} : {}, anchorId(row, kind, value));
}

/** @template {HTMLElement} T @param {Row} row @param {string} name @param {T} element @returns {T} */
function sectionTarget(row, name, element) {
  element.id = anchorId(row, 'section', name);
  element.tabIndex = -1;
  return element;
}

/** @param {string} message @param {(() => unknown)} [retry] */
function showError(message, retry) {
  errorRegion.replaceChildren(node('p', message));
  if (retry) errorRegion.append(button('Retry', retry));
  if (state.task_run || state.compare || state.task) {
    const recovery = node('p');
    recovery.append(navigationLink('Return to tasks', {task: '', task_run: '', compare: '', view: 'tasks'}));
    errorRegion.append(recovery);
  }
  errorRegion.hidden = false;
}

function clearError() {
  errorRegion.hidden = true;
  errorRegion.replaceChildren();
}

/** @param {string} path @param {AbortSignal} [signal] @returns {Promise<unknown>} */
async function fetchJson(path, signal) {
  const response = await fetch(viewUrl(path, root), {mode: 'same-origin', redirect: 'error', signal});
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${path}.`);
  return response.json();
}

/** @param {boolean | null} value @returns {[string, string]} */
function outcome(value) {
  return value === true ? ['Success', 'passed'] : value === false ? ['Failure', 'failed'] : ['Unknown', 'unknown'];
}

/** @param {boolean | null} value */
function nativeBadge(value) {
  const [label, status] = outcome(value);
  const badge = node('span', null, `status ${status}`);
  badge.append(icon(status === 'passed' ? 'check' : status === 'failed' ? 'close' : 'unknown'), document.createTextNode(label));
  return badge;
}

/** @param {Cohort} cohort */
function cohortDetails(cohort) {
  const result = disclosure('Source cohort and participant settings',
    fields([
      ['Cohort ID', cohort.cohort_id], ['Result bundle', cohort.result_bundle_id],
      ['Source role', cohort.source_role], ['Recorded dates', cohort.source_dates],
    ]),
    sourceReference(cohort.source), sourceReference(cohort.config),
    disclosure('Evaluated-agent configuration', raw(cohort.evaluated_agent)),
    disclosure('User-simulator configuration', raw(cohort.user_simulator)),
    disclosure('Experiment and completeness', raw(cohort.experiment), raw(cohort.completeness)),
    disclosure('Recorded condition evidence', raw(cohort.condition_components)));
  if (cohort.selection_note) result.append(node('p', cohort.selection_note, 'selection-note'));
  return result;
}

/** @param {(string | Node)[]} headers @param {unknown[][]} rows @param {string} caption @param {string} [className] */
function table(headers, rows, caption, className = '') {
  const wrapper = node('div', null, 'table-scroll');
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', caption);
  const result = node('table', null, className);
  result.append(node('caption', caption, 'sr-only'));
  const head = node('tr');
  for (const heading of headers) {
    const cell = node('th');
    cell.append(heading instanceof Node ? heading : document.createTextNode(heading));
    cell.scope = 'col';
    head.append(cell);
  }
  const body = node('tbody');
  for (const values of rows) {
    const row = node('tr');
    for (const [index, value] of values.entries()) {
      const cell = node(index === 0 && className === 'matrix' ? 'th' : 'td');
      if (cell.tagName === 'TH') cell.scope = 'row';
      cell.append(value instanceof Node ? value : document.createTextNode(display(value)));
      row.append(cell);
    }
    body.append(row);
  }
  const heading = node('thead');
  heading.append(head);
  result.append(heading, body);
  wrapper.append(result);
  return wrapper;
}

function populateFilters() {
  for (const [key, field, label] of [
    ['domain', 'domain', 'All domains'], ['benchmark', 'benchmark', 'All benchmarks'],
    ['version', 'benchmark_version', 'All releases'], ['model', 'evaluated_agent_model', 'All models'],
  ]) {
    const select = controls[key];
    const values = [...new Set(catalog.rows.filter(row => key === 'benchmark' || !state.benchmark || row.benchmark === state.benchmark).map(row => row[/** @type {'domain' | 'benchmark' | 'benchmark_version' | 'evaluated_agent_model'} */ (field)]))].sort((a, b) => String(a).localeCompare(String(b)));
    select.replaceChildren(new Option(label, ''), ...values.map(value => new Option(key === 'domain' ? domainName(value) : display(value), value)));
  }
}

function restoreControls() {
  for (const [key, control] of Object.entries(controls)) {
    const value = String(state[/** @type {keyof State} */ (key)] ?? '');
    if (control instanceof HTMLSelectElement && ![...control.options].some(option => option.value === value)) {
      control.append(new Option(`${value} (not in catalog)`, value));
    }
    control.value = value;
  }
}

/** @type {Record<string, string>} */
const benchmarkNames = {automationbench: 'AutomationBench', 'tau2-bench': 'τ²-bench'};

/** @param {HTMLElement} strip */
function revealCurrentTab(strip) {
  const current = strip.querySelector('[aria-current="page"], [aria-selected="true"], [aria-pressed="true"]');
  if (!current || !strip.clientWidth) return;
  const bounds = strip.getBoundingClientRect();
  const selected = current.getBoundingClientRect();
  if (selected.left < bounds.left || selected.right > bounds.right) {
    strip.scrollTo({
      left: strip.scrollLeft + selected.left - bounds.left - (strip.clientWidth - selected.width) / 2,
      behavior: 'instant',
    });
  }
}

function renderFrame() {
  if (!state.benchmark && !state.task_run && !state.task) {
    state = {...state, benchmark: catalog.rows[0]?.benchmark ?? ''};
    history.replaceState(null, '', routes.href(state));
  }
  const selectedRow = rowsById.get(state.task_run);
  const selectedTask = catalog.rows.find(row => row.task_key === state.task);
  const selected = selectedRow ?? selectedTask;
  if (selected && !state.benchmark) state = {...state, benchmark: selected.benchmark, domain: selected.domain};
  const activeBenchmark = selected?.benchmark ?? state.benchmark;
  const inspecting = Boolean(state.task_run || state.task);
  const benchmarks = element('benchmark-tabs');
  benchmarks.replaceChildren();
  for (const benchmark of [...new Set(catalog.rows.map(row => row.benchmark))]) {
    const link = navigationLink('', {
      benchmark, domain: '', version: '', model: '', cohorts: '', task: '', task_run: '', compare: '', page: 1, m: '', anchor: '',
    });
    link.append(icon(benchmark === 'automationbench' ? 'grid' : 'agent'), node('span', benchmarkNames[benchmark] ?? benchmark));
    if (benchmark === activeBenchmark) link.setAttribute('aria-current', 'page');
    benchmarks.append(link);
  }
  const pageHeader = element('benchmark-heading').closest('.page-header');
  if (pageHeader instanceof HTMLElement) { pageHeader.hidden = false; pageHeader.classList.toggle('inspection-header', inspecting); }
  element('benchmark-heading').textContent = benchmarkNames[state.benchmark] ?? state.benchmark;
  element('benchmark-description').textContent = state.benchmark === 'automationbench'
    ? 'An agent completes a business workflow through simulated SaaS APIs.'
    : 'An agent serves a simulated customer and acts through domain tools.';
  const domains = element('domain-tabs');
  domains.replaceChildren();
  const scoped = selectRows(catalog.rows, {benchmark: activeBenchmark, scope: state.scope});
  for (const domain of ['', ...new Set(scoped.map(row => row.domain))]) {
    const count = scoped.filter(row => !domain || row.domain === domain).length;
    const link = navigationLink('', {benchmark: activeBenchmark, domain, model: '', cohorts: '', page: 1, task: '', task_run: '', compare: '', m: '', anchor: ''});
    link.append(icon(domain ? 'folder' : 'grid'), node('span', domain ? domainName(domain) : 'All domains'), node('span', count.toLocaleString(), 'nav-count'));
    if (domain === (selected?.domain ?? state.domain)) link.setAttribute('aria-current', 'page');
    domains.append(link);
  }
  const views = element('view-tabs');
  views.replaceChildren();
  for (const [view, label] of [['tasks', 'Tasks'], ['runs', 'Task runs'], ['models', 'Models']]) {
    const link = navigationLink(label, {view, page: 1, task: '', task_run: '', compare: '', m: '', anchor: ''});
    link.prepend(icon(view === 'tasks' ? 'grid' : view === 'runs' ? 'list' : 'models'));
    if (!state.compare && (state.task_run ? view === 'runs' : state.task ? view === 'tasks' : view === state.view)) link.setAttribute('aria-current', 'page');
    views.append(link);
  }
  const comparisonCandidates = comparisonRows(catalog.rows, {...state, benchmark: activeBenchmark});
  const definition = selectedTask && rowsById.get(state.record);
  const left = selectedRow ?? (selectedTask && (state.record ? definition?.task_key === selectedTask.task_key ? definition : undefined : comparisonCandidates.find(row => row.task_key === selectedTask.task_key)));
  const selectedPeer = left && comparisonCandidates.find(row => row.task_key === left.task_key && row.task_run_id !== left.task_run_id);
  const right = rowsById.get(state.compare) ?? selectedPeer ?? (left && comparisonCandidates.find(row => row.task_key === left.task_key && row.task_run_id !== left.task_run_id));
  if (left && right) {
    const compare = navigationLink('Compare', {task_run: left.task_run_id, compare: right.task_run_id, view: 'runs', m: '', anchor: ''});
    compare.prepend(icon('compare'));
    if (state.compare) compare.setAttribute('aria-current', 'page');
    views.insertBefore(compare, views.lastElementChild);
  } else {
    const compare = node('span', 'Compare', 'disabled-tab'); compare.setAttribute('aria-disabled', 'true'); compare.title = selected ? 'No other task run for this task' : 'Open a task or run to choose a comparison';
    views.insertBefore(compare, views.lastElementChild);
  }
  if (!state.task_run) element('record-workspace').hidden = true;
  for (const id of ['filters', 'summary']) element(id).hidden = inspecting;
  const sortField = element('sort').parentElement;
  if (sortField) sortField.hidden = state.view !== 'tasks';
  const groupField = element('group').parentElement;
  if (groupField) groupField.hidden = state.view !== 'runs';
  const advancedCount = Number(Boolean(state.version)) + Number(Boolean(state.analysis)) + Number(state.scope === 'all') + Number(state.view === 'tasks' && Boolean(state.sort));
  element('advanced-filter-count').textContent = advancedCount ? String(advancedCount) : '';
  element('comparison-summary').hidden = inspecting || state.view !== 'models';
  element('tasks').hidden = inspecting || state.view !== 'tasks';
  element('task-detail').hidden = !state.task || Boolean(state.task_run);
  browse.hidden = inspecting || state.view !== 'runs';
  [benchmarks, domains, views].forEach(revealCurrentTab);
}

/** @param {Row} selected */
function renderRunBrowser(selected) {
  const container = element('run-browser');
  container.replaceChildren(); container.classList.remove('expanded');
  const rows = catalog.rows.filter(row => row.benchmark === selected.benchmark && row.domain === selected.domain && (state.scope === 'all' || row.reported || row.task_run_id === selected.task_run_id));
  const perPage = 15;
  let page = Math.floor(Math.max(0, rows.indexOf(selected)) / perPage);
  const heading = node('div', null, 'browser-heading');
  const count = node('small', `${rows.length} in ${selected.domain}`);
  const expand = button('Browse', () => {
    const expanded = container.classList.toggle('expanded'); expand.setAttribute('aria-expanded', String(expanded));
    if (expanded) revealSelected();
  });
  expand.className = 'browser-toggle'; expand.setAttribute('aria-expanded', 'false');
  expand.setAttribute('aria-controls', 'run-browser');
  heading.append(node('h2', 'Task runs'), count);
  const actions = inspection.querySelector('.inspection-actions');
  if (actions && !state.compare) actions.insertBefore(expand, actions.querySelector('.same-task-controls'));
  const body = node('div', null, 'browser-body');
  const searchLabel = node('label', null, 'browser-search');
  const search = node('input'); search.type = 'search'; search.placeholder = 'Search this domain…'; search.setAttribute('aria-label', 'Search task runs in this domain');
  searchLabel.append(node('span', 'Search task runs in this domain', 'sr-only'), search);
  const options = node('div', null, 'browser-options');
  const pagination = node('div', null, 'browser-pagination');
  function renderOptions() {
    const query = search.value.toLocaleLowerCase();
    const matches = rows.filter(row => `${row.task_id} ${row.description} ${row.evaluated_agent_model}`.toLocaleLowerCase().includes(query));
    const pages = Math.max(1, Math.ceil(matches.length / perPage)); page = Math.min(page, pages - 1);
    count.textContent = `${matches.length} in ${selected.domain}`;
    options.replaceChildren();
    for (const row of matches.slice(page * perPage, (page + 1) * perPage)) {
      const link = navigationLink('', {task_run: row.task_run_id, compare: '', m: '', anchor: ''}); link.className = 'browser-option';
      if (row.task_run_id === selected.task_run_id) link.setAttribute('aria-current', 'true');
      link.title = `${row.task_id} · ${row.evaluated_agent_model}`;
      const top = node('span', null, 'browser-option-top'); top.append(node('strong', taskTitle(row)), nativeBadge(row.success));
      const facts = node('span', runLabel(row), 'browser-option-facts');
      if (!row.reported) facts.append(node('small', sourceRoleLabel(row.source_role)));
      if (row.benchmark === 'tau2-bench') facts.append(node('code', row.task_run_id.split('/').at(-1)?.slice(0, 8)));
      link.append(top, facts);
      options.append(link);
    }
    if (!matches.length) options.append(node('p', 'No task runs match this search.', 'browser-empty'));
    const previous = button('Previous', () => { page -= 1; renderOptions(); }); previous.disabled = page === 0;
    const next = button('Next', () => { page += 1; renderOptions(); }); next.disabled = page === pages - 1;
    pagination.replaceChildren(previous, node('span', `${page + 1} / ${pages}`), next);
    queueMicrotask(revealSelected);
  }
  function revealSelected() {
    const selectedOption = options.querySelector('[aria-current]');
    if (selectedOption instanceof HTMLElement && options.clientHeight) options.scrollTop = Math.max(0, selectedOption.offsetTop - options.offsetTop - (options.clientHeight - selectedOption.offsetHeight) / 2);
  }
  search.addEventListener('input', () => { page = 0; renderOptions(); });
  body.append(searchLabel, options, pagination); container.append(heading, body); renderOptions();
}

/** @param {Row} row */
function outcomeSquare(row) {
  const status = runDisplayStatus(row);
  const [nativeLabel] = outcome(row.success);
  const label = status === 'partial' ? `Some checks passed · native ${nativeLabel.toLowerCase()} (diagnostic only)` : nativeLabel;
  const checks = summarizeChecks(row.checks);
  const description = `${runLabel(row)} · ${label} · ${checks.scoring.passed}/${checks.scoring.total} scoring checks passed · ${sourceRoleLabel(row.source_role)} · Shift+Enter to select for comparison`;
  const link = navigationLink('', {task_run: row.task_run_id, compare: '', m: '', anchor: ''});
  link.append(icon(status === 'passed' ? 'check' : status === 'partial' ? 'partial' : status === 'failed' ? 'close' : 'unknown'), compactChecks(row));
  link.className = `outcome-square ${status}`;
  link.title = description;
  link.setAttribute('aria-label', description);
  /** @param {MouseEvent | KeyboardEvent} event */
  function selectForComparison(event) {
    if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (matrixSelection && matrixSelection !== row.task_run_id) navigate({task_run: matrixSelection, compare: row.task_run_id, m: '', anchor: ''}, {focus: true});
    else { matrixSelection = row.task_run_id; link.classList.add('selected'); matrixStatus.textContent = 'First run selected. Shift-click or Shift+Enter another outcome to compare.'; }
  }
  link.addEventListener('click', selectForComparison);
  link.addEventListener('keydown', event => { if (event.key === 'Enter') selectForComparison(event); });
  return link;
}
/** @type {string | null} */
let matrixSelection = null;
const matrixStatus = node('p', '', 'muted');
matrixStatus.classList.add('matrix-selection-status');
matrixStatus.setAttribute('role', 'status');

/** @param {Row[]} rows */
function cohortSummary(rows) {
  const ids = [...new Set(rows.map(row => row.cohort_id))];
  return table(['Model / source', 'Domain', 'User simulator', 'Tasks', 'Task runs', 'Observed outcomes'], ids.map(id => {
    const cohort = catalog.cohorts[id];
    const counts = summarize(rows.filter(row => row.cohort_id === id));
    const identity = node('div');
    identity.append(node('strong', cohort.evaluated_agent.model), node('small', `${sourceDates(cohort)} · ${sourceRoleLabel(cohort.source_role)}`, 'muted'));
    if (cohort.selection_note) identity.append(disclosure('Hand-picked subset · selection context', node('p', cohort.selection_note, 'selection-note')));
    const outcomes = node('div');
    outcomes.append(checkBar([{status: 'passed', count: counts.successes}, {status: 'failed', count: counts.failures}, {status: 'not_evaluated', count: counts.unknown}]),
      node('small', `${counts.successes} passed / ${counts.failures} failed / ${counts.unknown} unknown of selected task runs`, 'muted'));
    return [identity, [...new Set(rows.filter(row => row.cohort_id === id).map(row => row.domain))].join(', '), cohort.user_simulator?.model ?? 'None', counts.tasks, counts.total, outcomes];
  }), 'Selected source cohorts');
}

/** @param {{status: string, count?: number}[]} entries */
function checkBar(entries) {
  const bar = node('div', null, 'check-bar');
  const total = entries.reduce((sum, entry) => sum + (entry.count ?? 1), 0);
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', entries.map(entry => `${entry.count ?? 1} ${entry.status}`).join(', '));
  for (const entry of entries) {
    const segment = node('span', null, entry.status);
    segment.style.flexGrow = String(entry.count ?? 1);
    segment.hidden = !total || entry.count === 0;
    bar.append(segment);
  }
  return bar;
}

/** @param {string} text */
function descriptionPreview(text) {
  const region = node('div', null, 'recorded-description');
  const content = node('p', text, 'description-preview muted');
  const expand = button('More', () => {
    const open = content.classList.toggle('expanded');
    expand.textContent = open ? 'Less' : 'More'; expand.setAttribute('aria-expanded', String(open));
  });
  expand.setAttribute('aria-expanded', 'false');
  region.append(content, expand);
  return region;
}

/** @param {Row[]} selected */
function renderTasks(selected) {
  const region = element('tasks');
  const sources = disclosure(`Local sources · ${new Set(selected.map(row => row.cohort_id)).size}`, cohortSummary(selected));
  sources.className = 'source-details';
  const heading = node('div', null, 'section-heading');
  const help = disclosure('About checks and comparisons', node('p', 'Open a task row for its definition. Open an outcome for its run. Shift-click or Shift+Enter two local outcomes to compare.'),
    node('p', 'An amber triangle marks native failure with some scoring checks passed. Non-scoring checks do not enter the fraction. Column grouping does not establish matched conditions.'));
  if (state.benchmark === 'automationbench') help.append(paperScoringNote());
  help.className = 'check-help';
  heading.append(help, sources);
  region.replaceChildren(heading);
  const groups = taskMatrix(selected, state.sort);
  const columns = matrixColumns(selectRows(catalog.rows, {...state, q: '', analysis: '', outcome: ''}), catalog.cohorts);
  const paper = state.benchmark === 'automationbench' ? automationBenchPaper.entries : [];
  const expanded = state.paper === 'expanded';
  const paperToggle = button(expanded ? 'Collapse Paper models' : 'Expand Paper models', () => navigate({paper: expanded ? '' : 'expanded'}));
  paperToggle.setAttribute('aria-expanded', String(expanded));
  if (paper.length) heading.insertBefore(paperToggle, sources);
  const pages = Math.max(1, Math.ceil(groups.length / pageSize));
  if (state.page > pages) { state.page = pages; history.replaceState(null, '', routes.href(state)); }
  const page = groups.slice((state.page - 1) * pageSize, state.page * pageSize);
  const showDomain = !state.domain;
  const matrix = table(['Task', ...(showDomain ? ['Domain'] : []), 'Checks', ...columns.map(column => {
    const heading = node('div', null, 'matrix-column-heading');
    const subset = column.cohortIds.some(id => catalog.cohorts[id].selection_note);
    const datePrefix = column.dates[0]?.slice(0, 8);
    const dates = column.dates.map((date, index) => index && datePrefix && date.startsWith(datePrefix) ? date.slice(8) : date).join(', ');
    heading.append(node('strong', modelName(column.model)), node('small', `v${column.version} · ${dates}`, 'muted'),
      node('small', subset ? 'Local · Hand-picked subset' : column.sourceRole === 'primary-result' ? 'Local' : 'Local · Checkpoint', subset ? 'selection-flag' : 'muted'));
    heading.title = `${column.model} · v${column.version} · ${column.dates.join(', ')} · ${column.sourceRole} · ${column.cohortIds.length} source cohorts`;
    return heading;
  }), ...(expanded ? paper.map(entry => {
    const heading = node('div', null, 'matrix-column-heading paper-column-heading');
    heading.append(node('strong', entry.model), node('small', `Paper · ${entry.effort}`));
    heading.title = `${automationBenchPaper.source.title} · ${entry.effort} reasoning · Private task set. No task-level results are published.`;
    return heading;
  }) : paper.length ? [node('span', `Paper · ${paper.length}`, 'paper-column-heading')] : [])], page.map((members, index) => {
    const task = node('div', null, 'matrix-task');
    const link = navigationLink(taskTitle(members[0]), {task: members[0].task_key, task_run: '', compare: '', m: '', anchor: ''});
    task.append(link, node('code', members[0].task_id, 'table-task-id'));
    const checks = members.map(row => summarizeChecks(row.checks));
    const counts = node('div', countRange(checks.map(check => check.scoring.total)), 'matrix-check-count');
    counts.title = `${countRange(members.map(row => row.checks.length))} total checks; ${countRange(checks.map(check => check.scoring.total))} scoring; ${countRange(checks.map(check => check.excluded))} non-scoring; ${countRange(checks.map(check => check.unclassified))} participation unrecorded`;
    if (checks.some(check => check.excluded)) counts.append(node('small', `+${countRange(checks.map(check => check.excluded))} non-scoring`, 'muted'));
    if (checks.some(check => check.unclassified)) counts.append(node('small', `+${countRange(checks.map(check => check.unclassified))} participation unrecorded`, 'muted'));
    return [task, ...(showDomain ? [domainName(members[0].domain)] : []), counts, ...columns.map(column => {
      const cell = node('div', null, 'matrix-cell');
      const runs = members.filter(row => column.cohortIds.includes(row.cohort_id)).sort((a, b) => (a.trial_index ?? -1) - (b.trial_index ?? -1) || a.task_run_id.localeCompare(b.task_run_id));
      if (!runs.length) {
        const missing = node('span', '—', 'not-run'); missing.title = 'Not run locally'; missing.setAttribute('aria-label', 'Not run locally'); cell.append(missing);
      }
      for (const row of runs) cell.append(outcomeSquare(row));
      return cell;
    }), ...(paper.length && index === 0 ? [''] : [])];
  }), 'Task outcomes by local source and paper reference', 'matrix');
  const matrixTable = matrix.querySelector('table');
  if (matrixTable) {
    matrixTable.style.setProperty('--matrix-model-count', String(columns.length + (paper.length ? expanded ? paper.length : 1 : 0)));
    matrixTable.dataset.singleDomain = String(!showDomain);
    const headings = matrixTable.querySelectorAll('thead th');
    headings[0].classList.add('matrix-task-col');
    if (showDomain) headings[1].classList.add('matrix-domain-col');
    headings[showDomain ? 2 : 1].classList.add('matrix-checks-col');
  }
  matrix.classList.add('matrix-scroll');
  if (paper.length && page.length) {
    const shared = /** @type {HTMLTableCellElement} */ (matrix.querySelector('tbody tr')?.lastElementChild);
    shared.className = 'paper-group-cell'; shared.rowSpan = page.length; shared.colSpan = expanded ? paper.length : 1;
    shared.append(node('strong', 'Private task set'), node('p', 'Per-task outcomes are not published.'), navigationLink('View paper scores', {view: 'models'}));
  }
  [...matrix.querySelectorAll('tbody tr')].forEach((tr, index) => {
    const task = page[index][0];
    tr.setAttribute('data-task-key', task.task_key);
    tr.addEventListener('click', event => {
      if (!(event instanceof MouseEvent) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
          !(event.target instanceof Element) || event.target.closest('a, button, summary, input, select, .paper-group-cell') || window.getSelection()?.toString()) return;
      navigate({task: task.task_key, task_run: '', compare: '', m: '', anchor: ''}, {focus: true});
    });
  });
  region.append(matrixStatus, matrix);
  if (!groups.length) region.append(node('p', 'No task runs match these filters.'), button('Clear filters', () => navigate({q: '', analysis: '', outcome: '', model: '', page: 1})));
  const pagination = node('nav', null, 'pagination');
  pagination.setAttribute('aria-label', 'Task pages');
  if (state.page > 1) pagination.append(navigationLink('Previous', {page: state.page - 1}));
  pagination.append(node('span', `Page ${state.page} of ${pages} · ${groups.length} tasks`));
  if (state.page < pages) pagination.append(navigationLink('Next', {page: state.page + 1}));
  region.append(pagination);
}

/** @param {Row} row @param {boolean} [label] */
function compactChecks(row, label = false) {
  const checks = summarizeChecks(row.checks);
  const fraction = node('span', checks.scoring.total ? `${checks.scoring.passed}/${checks.scoring.total}${label ? ' checks' : ''}` : 'Checks unrecorded', 'check-fraction');
  fraction.title = `${checks.scoring.passed}/${checks.scoring.total} scoring checks passed; ${checks.scoring.notEvaluated} not evaluated; ${checks.excluded} non-scoring (${checks.excludedPassed} passed); ${checks.unclassified} with scoring participation unrecorded`;
  return fraction;
}

/** @param {Row} row */
function scoringSummary(row) {
  const checks = summarizeChecks(row.checks);
  const result = node('div', null, 'scoring-summary');
  result.append(node('small', checks.scoring.total ? `${checks.scoring.passed}/${checks.scoring.total} scoring checks passed` : 'No recorded scoring checks', 'muted'));
  if (checks.scoring.notEvaluated) result.append(node('small', `${checks.scoring.notEvaluated} not evaluated`, 'muted'));
  if (checks.excluded) result.append(node('small', `${checks.excluded} non-scoring (${checks.excludedPassed} passed)`, 'muted'));
  if (checks.unclassified) result.append(node('small', `${checks.unclassified} with scoring participation unrecorded`, 'muted'));
  return result;
}

/** @param {unknown} value */
function scoringComponents(value) {
  /** @type {Record<string, string>} */
  const labels = {DB: 'Database end state', COMMUNICATE: 'Required information communicated', ACTION: 'Required actions',
    ENV_ASSERTION: 'Environment conditions', NL_ASSERTION: 'Natural-language conditions'};
  return Array.isArray(value) ? value.map(kind => labels[String(kind)] ?? String(kind)).join(', ') : display(value);
}

function paperScoringNote() {
  const note = node('p', null, 'table-footnote muted');
  const link = node('a', 'Paper §4: Scoring'); link.href = automationBenchPaper.source.scoringUrl;
  note.append(document.createTextNode('AutomationBench grades final application state. A failed task earns no partial benchmark credit. Assertion fractions are diagnostic only. '), link);
  return note;
}

function renderPaperResults() {
  const region = node('section', null, 'paper-reference');
  const source = node('a', automationBenchPaper.source.title);
  source.href = automationBenchPaper.source.url;
  region.append(node('h2', 'AutomationBench · paper results'), node('p', 'Paper reference only. These aggregate scores use private tasks, not the public tasks in this explorer.', 'muted'),
    table(['Model', 'Reasoning effort', 'Paper Score', 'Paper cost / task', 'Task-level outcomes'], automationBenchPaper.entries.map(entry =>
      [entry.model, entry.effort, `${entry.scorePercent.toFixed(1)}%`, `$${entry.costPerTaskUsd.toFixed(2)}`, 'Not published']), 'Published AutomationBench leaderboard, arXiv v1, section 6'),
    node('p', 'No paper trajectories or task-level success labels are available here. These rows do not enter local counts or matched-task comparisons.', 'table-footnote muted'), source);
  return region;
}

/** @type {(() => void) | undefined} */
let refreshTaskDefinition;

/** @param {boolean} focus */
async function renderTaskDetails(focus) {
  const request = ++detailRequest;
  detailAbort?.abort();
  detailAbort = new AbortController();
  const signal = detailAbort.signal;
  const region = element('task-detail');
  region.replaceChildren(); refreshTaskDefinition = undefined;
  inspection.hidden = true;
  element('record-workspace').hidden = true;
  clearError();
  const rows = catalog.rows.filter(row => row.task_key === state.task).sort((a, b) => Number(b.reported) - Number(a.reported) || a.task_run_id.localeCompare(b.task_run_id));
  if (!rows.length) {
    loading.hidden = true;
    showError('This task has no records in the catalog. Return to tasks and select a recorded task.');
    return;
  }
  const task = rows[0];
  const checkpoints = rows.filter(row => !row.reported).length;
  const header = node('header', null, 'task-detail-header');
  const models = new Set(rows.map(row => row.evaluated_agent_model)).size;
  header.append(navigationLink('← Back to tasks', {task: '', view: 'tasks'}), node('h1', taskTitle(task)), node('code', task.task_id, 'task-detail-id'),
    node('p', `${benchmarkNames[task.benchmark]} · v${task.benchmark_version} · ${task.domain} · ${rows.length} local run${rows.length === 1 ? '' : 's'} · ${models} local model${models === 1 ? '' : 's'}${checkpoints ? ` · ${checkpoints} retained checkpoints` : ''}`, 'muted'));
  region.append(header);
  loading.textContent = 'Loading task inputs and evaluation criteria…';
  loading.hidden = false;
  try {
    const definitions = /** @type {{view_schema_version: number, task_key: string, definitions: TaskView[]}} */ (await fetchJson(task.task_view_path, signal));
    if (definitions.view_schema_version !== 1 || definitions.task_key !== task.task_key || !Array.isArray(definitions.definitions)) {
      throw new Error('The task definition view does not match this task.');
    }
    const byId = new Map(definitions.definitions.map(record => [record.task_run_id, record]));
    if (byId.size !== rows.length || rows.some(row => !byId.has(row.task_run_id)) ||
        definitions.definitions.some(record => record.view_schema_version !== 1 || !record.metadata ||
          !Array.isArray(record.input_messages) || !Array.isArray(record.evaluation_criteria?.checks))) {
      throw new Error('The task definition view has invalid source coverage or inputs.');
    }
    const records = rows.map(row => /** @type {TaskView} */ (byId.get(row.task_run_id)));
    if (request !== detailRequest || signal.aborted) return;
    const instruction = node('section', null, 'task-instruction');
    instruction.id = 'task-instruction'; instruction.tabIndex = -1;
    const instructionHeading = node('h2', 'Task instruction');
    const instructionText = node('p', null, 'complete-instruction');
    const instructionSource = node('div', null, 'task-instruction-source');
    instruction.append(instructionHeading, instructionText, instructionSource);
    const currentRun = node('div', null, 'task-current-run');
    const runs = disclosure(`All local runs · ${rows.length}`); runs.className = 'task-local-runs';
    if (rows.length > 1) {
      runs.append(node('p', 'Choose a run to inspect its recorded task definition. These rows ignore the table’s model and outcome filters.', 'muted'),
        table(['Use definition', 'Model / source', 'Native outcome', 'Checks', 'Open'], rows.map(row => {
          const select = node('input'); select.type = 'radio'; select.name = 'task-source'; select.value = row.task_run_id; select.className = 'task-source-choice';
          select.setAttribute('aria-label', `Use task definition from ${runLabel(row)} · ${row.task_run_id}`);
          select.addEventListener('change', () => { if (select.checked) navigate({record: row.task_run_id, anchor: ''}); });
          const cohort = catalog.cohorts[row.cohort_id];
          const identity = node('div');
          identity.append(node('strong', runLabel(row)), node('small', `${sourceDates(cohort)} · ${sourceRoleLabel(row.source_role)}`, 'muted'));
          if (row.benchmark === 'tau2-bench') identity.append(node('small', row.task_run_id.split('/').at(-1), 'muted'));
          if (cohort.selection_note) identity.append(node('small', 'Hand-picked subset', 'selection-flag'));
          return [select, identity, nativeBadge(row.success), compactChecks(row), navigationLink('Open run', {task_run: row.task_run_id, compare: '', tab: 'transcript', m: '', anchor: ''})];
        }), 'All local executions and task-definition sources', 'task-runs-table'));
      if (checkpoints) runs.append(node('p', 'Retained checkpoints do not enter reported results or matched-task aggregates.', 'table-footnote muted'));
    }
    const tabs = node('div', null, 'tabs task-detail-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Task information');
    const evidence = node('div', null, 'task-definition');
    refreshTaskDefinition = () => {
      const index = state.record ? rows.findIndex(row => row.task_run_id === state.record) : 0;
      for (const part of [instruction, currentRun, runs, tabs]) part.hidden = index < 0;
      if (index < 0) {
        evidence.replaceChildren();
        showError('The requested definition source does not belong to this task. No other source was substituted.');
        errorRegion.append(button('Use first recorded source', () => navigate({record: ''})));
        return;
      }
      clearError();
      const row = rows[index];
      const record = records[index];
      const active = state.tab === 'prompts' ? 'prompts' : state.tab === 'provenance' ? 'source' : 'criteria';
      runs.querySelectorAll('input').forEach(input => { input.checked = input.value === row.task_run_id; });
      const identity = node('span', null, 'task-current-identity');
      identity.append(node('strong', runLabel(row)), node('small', `${sourceDates(catalog.cohorts[row.cohort_id])} · ${sourceRoleLabel(row.source_role)}`, 'muted'));
      if (row.benchmark === 'tau2-bench') identity.append(node('small', `Record ${row.task_run_id.split('/').at(-1)}`, 'muted'));
      if (catalog.cohorts[row.cohort_id].selection_note) identity.append(node('small', 'Hand-picked subset', 'selection-flag'));
      const open = navigationLink('Open run', {task_run: row.task_run_id, compare: '', tab: 'transcript', m: '', anchor: ''}); open.className = 'open-run';
      currentRun.replaceChildren(identity, nativeBadge(row.success), compactChecks(row, true), open);
      const description = record.metadata.task.description;
      const visibility = record.metadata.task.input_visibility.description;
      instructionHeading.textContent = visibility === 'evaluated_agent' ? 'Task instruction' : 'Benchmark task description';
      instructionText.textContent = description && typeof description === 'object' && !Array.isArray(description)
        ? Object.entries(description).filter(([, value]) => value !== null).map(([name, value]) => `${name.replaceAll('_', ' ')}: ${display(value)}`).join('\n\n') || 'No separate task description was recorded. See the simulator inputs in Inputs.'
        : display(description);
      const message = record.input_messages.find(message => message.role === 'user' && message.content === description);
      instructionSource.replaceChildren(node('span', visibility === 'evaluated_agent' ? 'Shown to the evaluated agent.' : 'Benchmark metadata. Not an agent instruction or simulator prompt.'));
      if (message) instructionSource.append(evidenceLink(row, 'message', message.sequence, `Exact input · message #${message.sequence}`));
      const inputPointer = message ? `${record.source.task_run_pointer}/messages/${message.sequence}/content`
        : row.benchmark === 'automationbench' ? `${record.source.task_run_pointer}/messages` : `${record.source.task_pointer}/description`;
      instructionSource.append(disclosure('Native input source', sourceReference({...record.source.artifact, pointer: inputPointer})));
      const prompts = renderPromptInputs(record, row, signal); prompts.classList.remove('rail-pane');
      const criteria = node('section');
      criteria.append(node('h2', 'Evaluation criteria', 'sr-only'));
      const criteriaSource = row.task_components.find(component => component.name === 'evaluation_criteria')?.source;
      if (criteriaSource) criteria.append(disclosure('Criteria source', sourceReference(criteriaSource)));
      if (row.benchmark === 'tau2-bench') criteria.append(fields([['Required scoring components', scoringComponents(record.evaluation_criteria.intended_reward_basis)]]));
      for (const check of record.evaluation_criteria.checks) {
        const summary = checkSummary(check);
        const requirement = disclosure('', raw(check.specification),
          navigationLink('View run evaluation', {task_run: row.task_run_id, tab: 'verdict', compare: '', m: '', anchor: ''}, anchorId(row, 'check', check.id)));
        requirement.className = 'task-criterion';
        const participation = row.checks.find(item => item.id === check.id)?.scored;
        requirement.firstElementChild?.append(node('strong', summary.label), node('small', check.id, 'check-id'));
        if (participation === false) requirement.firstElementChild?.append(node('small', 'Non-scoring', 'non-scoring-label'));
        if (participation === null) requirement.firstElementChild?.append(node('small', 'Scoring unrecorded', 'unclassified-label'));
        requirement.firstElementChild?.append(node('span', summary.parameters, 'check-parameters'));
        criteria.append(requirement);
      }
      if (record.evaluation_criteria.policy !== null) criteria.append(renderPolicy(record, row, signal));
      if (record.evaluation_criteria.reference_behavior !== null) criteria.append(disclosure('Reference behavior', raw(record.evaluation_criteria.reference_behavior)));
      const source = node('section');
      source.append(node('h2', 'Task source'), fields([
        ['Task ID', row.task_id], ['Benchmark release', row.benchmark_version], ['Domain', row.domain], ['Source task run', row.task_run_id],
        ['Separate policy text', record.evaluation_criteria.policy === null ? 'Not retained in the task record. This does not mean the task has no policy requirements.' : 'Recorded source available'],
      ]), repositoryLink(row.record_path, 'Open projected run JSON'), sourceReference(record.source.artifact), sourceReference(record.source.config),
        node('h3', 'Task component availability'), fields(row.task_components.map(component => [component.name.replaceAll('_', ' '), component.value === null ? 'Unrecorded' : 'Recorded fingerprint. Its source reference appears below.'])),
        cohortDetails(catalog.cohorts[row.cohort_id]), disclosure('Complete task metadata and input visibility', raw(record.metadata.task)),
        disclosure('Experiment and participant metadata', raw(record.metadata)), disclosure('Task component availability and fingerprints', raw(row.task_components)));
      const panes = new Map([['prompts', prompts], ['criteria', criteria], ['source', source]]);
      evidence.replaceChildren(...panes.values());
      tabs.replaceChildren();
      for (const [key, label, stateTab] of [['criteria', `Evaluation criteria · ${record.evaluation_criteria.checks.length}`, 'verdict'], ['prompts', 'Inputs', 'prompts'], ['source', 'Source', 'provenance']]) {
        const pane = /** @type {HTMLElement} */ (panes.get(key));
        pane.id = `task-info-${key}`; pane.hidden = active !== key; pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', `task-info-tab-${key}`);
        const tab = button(label, () => { navigate({tab: stateTab, anchor: ''}); /** @type {HTMLElement | null} */ (tabs.querySelector(`[data-tab="${key}"]`))?.focus(); });
        tab.id = `task-info-tab-${key}`; tab.dataset.tab = key; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', pane.id); tab.setAttribute('aria-selected', String(active === key)); tab.tabIndex = active === key ? 0 : -1;
        tab.addEventListener('keydown', event => {
          const options = [...tabs.querySelectorAll('button')]; const index = options.indexOf(tab);
          const next = event.key === 'ArrowRight' ? (index + 1) % options.length : event.key === 'ArrowLeft' ? (index - 1 + options.length) % options.length : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); options[next].click(); }
        });
        tabs.append(tab);
      }
      refreshNavigationLinks();
    };
    refreshTaskDefinition();
    region.append(instruction, currentRun, ...(rows.length > 1 ? [runs] : []), tabs, evidence);
    if (focus) { region.focus(); region.scrollIntoView({block: 'start'}); }
  } catch (error) {
    if (request !== detailRequest || signal.aborted) return;
    showError(`Task details could not load. ${error instanceof Error ? error.message : String(error)}`, () => render({force: true, focus: true}));
  } finally {
    if (request === detailRequest) loading.hidden = true;
  }
}

function renderBrowse() {
  const selected = groupTaskRuns(selectRows(catalog.rows, state), state.view === 'runs' ? state.group : '').flatMap(group => group.rows);
  const summary = summarize(selected);
  const summaryRegion = element('summary');
  summaryRegion.replaceChildren();
  for (const [count, label, status] of [[summary.total, 'selected task runs', ''], [summary.tasks, 'tasks', ''], [summary.successes, 'successes', 'success-count'], [summary.failures, 'failures', 'failure-count'], [summary.unknown, 'unknown', '']]) {
    const item = node('span', null, `summary-item ${status}`);
    item.append(node('strong', Number(count).toLocaleString()), document.createTextNode(` ${label}`)); summaryRegion.append(item);
  }
  if (state.view === 'tasks') { renderTasks(selected); return; }
  const pages = Math.max(1, Math.ceil(selected.length / pageSize));
  if (state.page > pages) {
    state = {...state, page: pages};
    history.replaceState(null, '', routes.href(state));
  }
  const start = (state.page - 1) * pageSize;
  const body = element('result-rows');
  body.replaceChildren();
  let previousGroup = '';
  const groups = groupTaskRuns(selected, state.group);
  for (const row of selected.slice(start, start + pageSize)) {
    if (state.group) {
      const group = groups.find(group => group.rows.includes(row));
      if (group && group.key !== previousGroup) {
        const heading = node('tr', null, 'group-heading');
        const cell = node('td'); cell.colSpan = 6;
        cell.append(node('strong', group.label), node('span', `${group.rows.length} task runs`, 'muted'));
        heading.append(cell); body.append(heading); previousGroup = group.key;
      }
    }
    const result = node('tr');
    result.dataset.taskRunId = row.task_run_id;
    const task = node('td');
    const taskLink = navigationLink(taskTitle(row), {task_run: row.task_run_id, compare: ''}); taskLink.title = row.task_id;
    task.append(taskLink, node('code', row.task_id, 'table-task-id'),
      node('small', `${row.benchmark} ${row.benchmark_version} · ${row.domain} · trial index ${display(row.trial_index)}`, 'muted'));
    const model = node('td', modelName(row.evaluated_agent_model)); model.title = row.evaluated_agent_model;
    const cohort = catalog.cohorts[row.cohort_id];
    model.append(node('small', `${sourceDates(cohort)} · ${sourceRoleLabel(row.source_role)}`, 'muted'));
    if (cohort.selection_note) model.append(node('small', 'Hand-picked subset', 'selection-flag'));
    const native = node('td');
    native.append(nativeBadge(row.success));
    if (row.score !== null) native.append(node('small', `${nativeScoreLabel(row)}: ${row.score}`, 'muted'));
    if (row.reward !== null) native.append(node('small', `Native reward: ${row.reward}`, 'muted'));
    const analysis = node('td');
    if (row.annotation_count) {
      const labels = node('div');
      for (const label of row.annotation_labels) labels.append(node('span', label, 'analysis-label'));
      analysis.append(disclosure(`${row.annotation_count} historical analysis annotations`, labels));
    } else analysis.textContent = 'No imported analysis';
    const open = node('td');
    open.append(navigationLink('Inspect', {task_run: row.task_run_id, compare: ''}));
    const metrics = node('td');
    metrics.append(checkBar(row.checks), node('small', `${row.evaluated_agent_tool_calls + row.user_simulator_tool_calls} tool calls`, 'muted'));
    const preview = node('div', `${row.message_count} messages · source order`, 'run-preview muted');
    preview.dataset.run = row.task_run_id;
    metrics.append(preview);
    task.append(disclosure('Recorded description', node('p', row.description, 'muted')));
    task.prepend(node('span', 'Task', 'mobile-cell-label'));
    model.prepend(node('span', 'Model', 'mobile-cell-label'));
    native.prepend(node('span', 'Native result', 'mobile-cell-label'));
    metrics.prepend(node('span', 'Conversation / checks', 'mobile-cell-label'));
    analysis.prepend(node('span', 'Analysis', 'mobile-cell-label'));
    open.prepend(node('span', 'Open', 'mobile-cell-label'));
    result.append(task, model, native, metrics, analysis, open);
    body.append(result);
  }
  if (!selected.length) {
    const row = node('tr');
    const cell = node('td', 'No task runs match these filters. Change the filters or reset them.');
    cell.colSpan = 6;
    row.append(cell);
    body.append(row);
  }
  const pagination = element('pagination');
  pagination.replaceChildren();
  if (state.page > 1) pagination.append(navigationLink('Previous', {page: state.page - 1}));
  else pagination.append(node('span', 'Previous', 'muted'));
  pagination.append(node('span', `Page ${state.page} of ${pages}. Showing ${selected.length ? start + 1 : 0}–${Math.min(start + pageSize, selected.length)} of ${selected.length} task runs.`));
  if (state.page < pages) pagination.append(navigationLink('Next', {page: state.page + 1}));
  else pagination.append(node('span', 'Next', 'muted'));
}

function renderComparisonSummary() {
  const container = element('comparison-summary');
  const wasOpen = true;
  const region = node('div');
  const overview = disclosure('Compare models and inspect coverage', region);
  overview.className = 'comparison-overview';
  overview.open = wasOpen;
  container.replaceChildren(overview);
  if (state.benchmark === 'automationbench') container.prepend(renderPaperResults());
  region.append(node('h2', 'Model comparison'), node('p',
    'This comparison uses reported primary results for the selected benchmark, release, and domain. It ignores outcome, model, and text filters.', 'muted'));
  const rows = comparisonRows(catalog.rows, state);
  const groups = new Map(/** @type {[string, Row[]][]} */ ([]));
  for (const row of rows) {
    if (!groups.has(row.cohort_id)) groups.set(row.cohort_id, []);
    groups.get(row.cohort_id)?.push(row);
  }
  const oneSlice = new Set(rows.map(row => JSON.stringify([row.benchmark, row.benchmark_version, row.domain]))).size === 1;
  let selectedCohorts;
  try {
    selectedCohorts = selectCohortIds(state.cohorts, [...groups.keys()]);
  } catch (error) {
    region.append(node('p', (error instanceof Error ? error.message : String(error)), 'notice'), button('Reset comparison sources', () => navigate({cohorts: ''})));
    return;
  }
  const observed = [...groups].map(([id, members]) => {
    const cohort = catalog.cohorts[id];
    const identity = node('div');
    identity.append(node('strong', cohort.evaluated_agent.model), node('div', cohort.result_bundle_id, 'muted'));
    if (cohort.selection_note) identity.append(node('p', cohort.selection_note, 'selection-note'));
    identity.append(cohortDetails(cohort));
    const counts = summarize(members);
    const repetitions = new Map();
    for (const row of members) repetitions.set(row.task_key, (repetitions.get(row.task_key) ?? 0) + 1);
    const values = [...repetitions.values()];
    const choose = node('input');
    choose.type = 'checkbox';
    choose.className = 'cohort-selector';
    choose.checked = selectedCohorts.includes(id);
    choose.setAttribute('aria-label', `Compare ${cohort.evaluated_agent.model} from ${cohort.result_bundle_id}`);
    choose.addEventListener('change', () => {
      const next = choose.checked ? [...selectedCohorts, id] : selectedCohorts.filter(value => value !== id);
      navigate({cohorts: JSON.stringify(next.sort())});
    });
    return [choose, identity, counts.successes, counts.failures, counts.unknown, counts.tasks, counts.total,
      `${Math.min(...values)}–${Math.max(...values)}`];
  });
  const counts = disclosure(`Observed source cohorts (${groups.size})`, table(
    ['Compare', 'Source cohort', 'Successes', 'Failures', 'Unknown', 'Distinct tasks', 'Task runs', 'Repetitions per task'],
    observed, 'Observed outcomes by source cohort'));
  counts.open = oneSlice;
  region.append(counts);
  if (!oneSlice) {
    region.append(node('p', 'Select one benchmark, release, and domain for a descriptive common-task comparison.', 'notice'));
  } else if (groups.size < 2) {
    region.append(node('p', 'This selection has fewer than two source cohorts. No aggregate comparison is available.', 'muted'));
  } else {
    const result = compareCohorts(rows, catalog.cohorts, selectedCohorts);
    region.append(node('h3', 'Descriptive common-task results'));
    if (!result.eligible) region.append(node('p', result.reason, 'notice'));
    else {
      region.append(node('p', `${result.commonTasks} shared tasks have matching recorded inputs and conditions. ${result.excludedTasks} distinct tasks are outside this matching intersection.`),
        node('p', 'Each task has equal weight in the descriptive success fraction. These results do not establish a causal model effect.', 'muted'));
      region.append(table(
        ['Source cohort', 'Matching tasks / available', 'Tasks outside intersection', 'Task runs', 'Success / failure / unknown', 'Repetitions per task', 'Task-balanced success fraction', 'Reward-basis anomalies'],
        result.groups.map(group => [
          catalog.cohorts[group.cohort_id].result_bundle_id,
          `${group.tasks} / ${group.availableTasks}`, group.excludedTasks, group.total,
          `${group.successes} / ${group.failures} / ${group.unknown}`,
          `${group.repetitions.min}–${group.repetitions.max}`,
          group.taskBalancedRate === null ? 'Unavailable: unknown native outcomes' : `${(group.taskBalancedRate * 100).toFixed(2)}%`,
          group.rewardBasisDifferences,
        ]), 'Descriptive task-balanced results on matching common tasks'));
      region.append(node('p', 'Reward-basis anomalies count recorded differences between intended and evaluated reward bases. They do not remove task runs from this comparison.', 'muted'));
    }
    if (result.unrecorded.length) region.append(node('p',
      `Unverified in every compared cohort: ${result.unrecorded.join(', ')}. Shared absence is not verified equality.`, 'notice'));
  }
  const missing = Object.values(catalog.coverage).reduce((total, item) => total + item.unmatched_ids.length, 0);
  const coverage = disclosure('Historical analysis import coverage', raw(catalog.coverage));
  if (missing) region.append(node('p', `${missing} source-missing historical chats remain in retained analyses. They are not canonical task runs and do not enter these counts.`, 'notice'));
  region.append(coverage);
}

/** @param {RunView} record @param {Row} row */
function validateRunView(record, row) {
  if (record.view_schema_version !== 1 || record.task_run_id !== row.task_run_id ||
      !record.metadata || !Array.isArray(record.trajectory?.messages) ||
      !Array.isArray(record.input_messages) || !Array.isArray(record.evaluation_criteria?.checks) || !Array.isArray(record.evaluation_result?.check_results) ||
      record.evaluation_result.success !== row.success || record.evaluation_result.score !== row.score || record.evaluation_result.reward !== row.reward) {
    throw new Error('The task-run record does not match the catalog. Rebuild explorer views before retrying.');
  }
  let previous = -1;
  for (const message of record.trajectory.messages) {
    if (!Number.isSafeInteger(message.sequence) || message.sequence <= previous || !Array.isArray(message.tool_calls)) {
      throw new Error('The task-run record has invalid message ordering or tool calls.');
    }
    previous = message.sequence;
  }
  const checkIds = new Set(record.evaluation_criteria.checks.map(check => check.id));
  if (checkIds.size !== record.evaluation_criteria.checks.length || row.checks.length !== checkIds.size ||
      row.checks.some(check => !checkIds.has(check.id) || !['passed', 'failed', 'not_evaluated'].includes(check.status))) {
    throw new Error('The task-run criteria do not match the catalog check statuses.');
  }
  return record;
}

/** @param {Row} left @param {Row} right */
function renderComparisonEvidence(left, right) {
  const result = compareTaskRuns(left, right, catalog.cohorts);
  const region = node('section');
  region.append(node('h2', 'Recorded comparison evidence'));
  region.append(node('p', result.sameTask
    ? 'These task runs share the same benchmark, release, domain, and task ID. Recorded evidence below determines whether their inputs and conditions match.'
    : 'These task runs do not share the same benchmark, release, domain, and task ID. Side-by-side reading does not establish a same-task comparison.', result.sameTask ? 'muted' : 'notice'));
  /** @type {Record<string, string>} */
  const labels = {equal: 'Equal recorded values', different: 'Different', unrecorded: 'Shared unrecorded', missing: 'One-sided missing'};
  /** @type {Array<[string, ReturnType<typeof compareTaskRuns>['inputs'], Component[], Component[]]>} */
  const evidenceGroups = [
    ['Task inputs and criteria', result.inputs, left.task_components, right.task_components],
    ['Recorded evaluation conditions', result.conditions, catalog.cohorts[left.cohort_id].condition_components, catalog.cohorts[right.cohort_id].condition_components],
  ];
  for (const [title, components, leftSources, rightSources] of evidenceGroups) {
    const content = table(['Component', 'Comparison', left.evaluated_agent_model, right.evaluated_agent_model], components.map(component => {
      const values = component.values.map((value, index) => {
        const cell = node('div');
        cell.append(value === null ? node('p', 'Unrecorded', 'muted') : raw(value));
        const source = (index === 0 ? leftSources : rightSources).find(item => item.name === component.name)?.source;
        cell.append(sourceReference(source));
        return cell;
      });
      return [component.name, labels[component.state], ...values];
    }), title, 'component-table');
    const counts = ['equal', 'different', 'unrecorded', 'missing'].map(state => `${components.filter(item => item.state === state).length} ${labels[state].toLowerCase()}`);
    const details = disclosure(`${title}: ${counts.join(', ')}`, content);
    region.append(details);
  }
  region.append(node('p', 'Shared unrecorded values remain unverified. Evaluated-agent models, decoding settings, and API routes appear separately in each source-cohort disclosure.', 'muted'));
  return region;
}

/** @param {string} dimension @param {boolean} [persist] */
function activateComparisonDimension(dimension, persist = true) {
  const panel = inspection.querySelector('.comparison-panel');
  if (!panel) return;
  panel.querySelectorAll('button[data-dimension]').forEach(button => {
    if (button instanceof HTMLButtonElement) button.setAttribute('aria-pressed', String(button.dataset.dimension === dimension));
  });
  const strip = panel.querySelector('.comparison-dimensions');
  if (strip instanceof HTMLElement) revealCurrentTab(strip);
  panel.querySelectorAll('.comparison-pane').forEach(pane => { if (pane instanceof HTMLElement) pane.hidden = pane.dataset.dimension !== dimension; });
  const grid = inspection.querySelector('.comparison-grid');
  if (grid instanceof HTMLElement) grid.dataset.dimension = dimension;
  const align = inspection.querySelector('.align-control');
  if (align instanceof HTMLElement) align.hidden = dimension !== 'conversation';
  const tab = dimension === 'checks' ? 'verdict' : dimension === 'setup' ? 'provenance' : 'transcript';
  for (const id of [state.task_run, state.compare]) if (rowsById.has(id)) activateRail(tab, rowFor(id), false);
  if (persist) { state = {...state, dimension}; history.replaceState(null, '', routes.href(state)); refreshNavigationLinks(); }
}

/** @param {unknown} value @param {string} key */
function numericField(value, key) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const field = /** @type {Record<string, unknown>} */ (value)[key];
  return typeof field === 'number' ? field : null;
}

/** @param {RunView} record @param {Row} row @param {'evaluated_agent' | 'user_simulator'} participant @param {'input' | 'output'} kind */
function tokenUsage(record, row, participant, kind) {
  if (participant === 'user_simulator' && row.user_simulator_model === null) return 'Not applicable';
  if (participant === 'evaluated_agent' && row.user_simulator_model === null) {
    const aggregate = numericField(record.evaluation_result.usage, `${kind}_tokens`);
    if (aggregate !== null) return `${aggregate.toLocaleString()} · native aggregate`;
  }
  const values = record.trajectory.messages.filter(message => message.participant === participant).map(message =>
    numericField(message.usage, kind === 'input' ? 'prompt_tokens' : 'completion_tokens') ?? numericField(message.usage, `${kind}_tokens`)).filter(value => value !== null);
  return values.length ? `${values.reduce((sum, value) => sum + value, 0).toLocaleString()} · recorded message sum` : 'Unrecorded';
}

/** @param {RunView[]} records @param {Row[]} rows */
function renderRunComparison(records, rows) {
  const panel = node('section', null, 'comparison-panel');
  const heading = node('header', null, 'comparison-heading');
  const context = node('div');
  context.append(node('h1', 'Compare task runs'), node('p', rows[0].task_key === rows[1].task_key
    ? `${taskTitle(rows[0])} · same task and domain. Other recorded conditions may differ.`
    : 'Different tasks. Side-by-side reading does not establish a matched-task comparison.'));
  heading.append(context, button('Swap columns', () => navigate({task_run: rows[1].task_run_id, compare: rows[0].task_run_id})));
  const dimensions = node('nav', null, 'comparison-dimensions'); dimensions.setAttribute('aria-label', 'Comparison dimensions');
  for (const [key, label] of [['overview', 'Overview'], ['checks', 'Checks'], ['conversation', 'Conversation'], ['tools', 'Tools'], ['resources', 'Tokens, cost & time'], ['setup', 'Setup & source']]) {
    const tab = button(label, () => activateComparisonDimension(key)); tab.dataset.dimension = key; tab.setAttribute('aria-pressed', String(state.dimension === key)); dimensions.append(tab);
  }
  panel.append(heading, dimensions);
  /** @param {string} key */
  function pane(key) { const section = node('section', null, 'comparison-pane'); section.dataset.dimension = key; section.hidden = state.dimension !== key; panel.append(section); return section; }
  function identities() {
    return rows.map(row => {
      const heading = node('div', null, 'comparison-identity');
      heading.append(node('strong', runLabel(row)), node('small', `${sourceDates(catalog.cohorts[row.cohort_id])} · ${sourceRoleLabel(row.source_role)}`, 'muted'));
      if (catalog.cohorts[row.cohort_id].selection_note) heading.append(node('small', 'Hand-picked subset', 'selection-flag'));
      heading.title = row.task_run_id;
      return heading;
    });
  }
  /** @param {Array<[string, (record: RunView, row: Row) => unknown]>} metrics @param {string} caption */
  function metricsTable(metrics, caption) {
    const values = metrics.map(([label, value]) => [label, value(records[0], rows[0]), value(records[1], rows[1])]);
    const result = table(['Dimension', ...identities()], values, caption);
    result.querySelectorAll('tbody tr').forEach((tr, index) => {
      const [a, b] = values[index].slice(1).map(value => value instanceof Node ? value.textContent : display(value));
      tr.classList.toggle('difference', a !== b);
    });
    return result;
  }
  const overview = pane('overview');
  overview.append(metricsTable([
    ['Native outcome', (_, row) => nativeBadge(row.success)], ['Native reward', record => record.evaluation_result.reward], [rows.every(row => row.benchmark === 'automationbench') ? 'Assertion fraction (diagnostic)' : 'Native score', record => record.evaluation_result.score],
    ['Agent tool calls', (_, row) => row.evaluated_agent_tool_calls], ['User-simulator tool calls', (_, row) => row.user_simulator_model === null ? 'Not applicable' : row.user_simulator_tool_calls],
    ['Messages', record => record.trajectory.messages.length], ['Termination', record => record.evaluation_result.termination_reason],
  ], 'Native outcomes and recorded activity'), node('p', 'Highlighted rows contain different recorded values. These are two executions, not aggregate model rankings.', 'muted'));
  const checks = pane('checks');
  const ids = [...new Set(rows.flatMap(row => row.checks.map(check => check.id)))];
  /** @type {Record<string, string>} */
  const checkLabels = {passed: 'Passed', failed: 'Failed', not_evaluated: 'Not evaluated'};
  checks.append(node('p', 'Check IDs may match even when specifications differ. Open a status for its exact specification and result.', 'muted'),
    table(['Check / expected values', ...identities()], ids.map(id => {
      const definitions = records.map(record => record.evaluation_criteria.checks.find(check => check.id === id));
      const summaries = definitions.map(check => check && checkSummary(check));
      const statuses = rows.map(row => row.checks.find(check => check.id === id));
      const nonScoring = statuses.every(check => check?.scored === false);
      const shared = definitions.every(check => check !== undefined) && JSON.stringify(definitions[0]?.specification) === JSON.stringify(definitions[1]?.specification);
      const identity = node('div', null, 'comparison-check');
      identity.append(node('strong', summaries[0]?.label ?? summaries[1]?.label ?? id), node('small', id, 'check-id'));
      if (nonScoring) identity.append(node('small', 'Non-scoring', 'non-scoring-label'));
      if (shared) identity.append(node('span', summaries[0]?.parameters, 'check-parameters'));
      else identity.append(node('small', 'Expected values shown per run', 'muted'));
      return [identity, ...rows.map((row, index) => {
        const check = statuses[index];
        const cell = node('div');
        if (!check) { cell.append(node('span', 'Unrecorded', 'muted')); return cell; }
        const link = navigationLink(checkLabels[check.status], {task_run: row.task_run_id, compare: '', tab: 'verdict', m: '', anchor: ''}, anchorId(row, 'check', id));
        link.className = `check-result-link ${check.status}`; cell.append(link);
        if (!nonScoring && check.scored === false) cell.append(node('small', 'Non-scoring', 'non-scoring-label'));
        if (check.scored === null) cell.append(node('small', 'Scoring unrecorded', 'unclassified-label'));
        if (!shared && summaries[index]) cell.append(node('strong', summaries[index].label), node('span', summaries[index].parameters, 'check-parameters'));
        return cell;
      })];
    }), 'Native check differences', 'comparison-checks'));
  pane('conversation').append(node('p', 'Each column follows its own source order. Equal heights or scroll positions do not imply matching events.', 'muted'));
  pane('tools').append(node('p', 'Tool calls remain under the participant that requested them. Expand a call to inspect its arguments and linked results.', 'muted'));
  pane('resources').append(metricsTable([
    ['Agent input tokens', (record, row) => tokenUsage(record, row, 'evaluated_agent', 'input')], ['Agent output tokens', (record, row) => tokenUsage(record, row, 'evaluated_agent', 'output')],
    ['Simulator input tokens', (record, row) => tokenUsage(record, row, 'user_simulator', 'input')], ['Simulator output tokens', (record, row) => tokenUsage(record, row, 'user_simulator', 'output')],
    ['Duration', record => record.evaluation_result.duration_seconds === null ? 'Unrecorded' : `${record.evaluation_result.duration_seconds.toFixed(1)} s`],
    ['Cost (USD)', record => record.evaluation_result.cost_usd === null ? 'Unrecorded' : `$${record.evaluation_result.cost_usd.toFixed(4)}`], ['Cost basis', record => record.evaluation_result.cost_basis],
  ], 'Recorded tokens, cost and duration'), node('p', 'Message sums cover recorded usage only. Missing values are not zero. Configured cost estimates are not billed amounts.', 'muted'));
  const setup = pane('setup');
  setup.append(metricsTable([
    ['Benchmark', (_, row) => row.benchmark], ['Release', (_, row) => row.benchmark_version], ['Domain', (_, row) => row.domain], ['Task ID', (_, row) => row.task_id],
    ['Configured agent', (_, row) => row.evaluated_agent_model], ['User simulator', (_, row) => row.user_simulator_model ?? 'Not applicable'], ['Trial index', (_, row) => row.trial_index],
    ['Task-run seed', (_, row) => row.task_run_seed], ['Source role', (_, row) => row.source_role], ['Native artifact SHA-256', record => record.source.artifact.sha256],
  ], 'Recorded setup and source identity'), disclosure('Compare recorded inputs and conditions', renderComparisonEvidence(rows[0], rows[1])));
  return panel;
}

/** @param {Row} row */
function renderSameTaskControls(row) {
  const region = node('div', null, 'toolbar');
  const choices = catalog.rows.filter(item => item.task_key === row.task_key && item.task_run_id !== row.task_run_id);
  if (choices.length === 1) {
    const other = choices[0];
    region.append(navigationLink(`Open ${runLabel(other)}`, {task_run: other.task_run_id, compare: ''}),
      button('Compare this run', () => navigate({compare: other.task_run_id}, {focus: true})));
    if (state.compare) region.append(navigationLink('Remove comparison', {compare: ''}));
    return region;
  }
  const select = node('select');
  select.id = 'same-task-selection';
  const label = node('label', 'Another task run for this task'); label.htmlFor = select.id;
  for (const item of choices) {
    const cohort = catalog.cohorts[item.cohort_id];
    select.append(new Option(`${item.evaluated_agent_model} · trial ${display(item.trial_index)} · ${sourceDates(cohort)} · ${sourceRoleLabel(item.source_role)} · ${outcome(item.success)[0]}`, item.task_run_id));
  }
  if (choices.some(item => item.task_run_id === state.compare)) select.value = state.compare;
  const inspect = button('Inspect selected task run', () => navigate({task_run: select.value, compare: ''}, {focus: true}));
  const compare = button('Compare selected task run', () => navigate({compare: select.value}, {focus: true}));
  region.append(label, select, inspect, compare);
  if (state.compare) region.append(navigationLink('Remove comparison', {compare: ''}));
  return region;
}

/** @param {string} label @param {unknown} value @param {HTMLElement} status */
function payload(label, value, status) {
  const parsed = argumentPayload(value);
  const region = node('section', null, 'payload');
  const heading = node('div', null, 'payload-heading');
  heading.append(node('strong', `${label}${!parsed.parsed && label === 'Arguments' ? ' (unparsed string)' : ''}`));
  const content = raw(parsed.text);
  const rawToggle = button('Raw', event => {
    const rawMode = /** @type {HTMLButtonElement} */ (event.currentTarget).getAttribute('aria-pressed') !== 'true';
    /** @type {HTMLButtonElement} */ (event.currentTarget).setAttribute('aria-pressed', String(rawMode));
    content.textContent = rawMode ? parsed.raw : parsed.text;
  });
  rawToggle.setAttribute('aria-pressed', 'false');
  heading.append(rawToggle, button('Copy', async () => {
    try { await navigator.clipboard.writeText(parsed.raw); status.textContent = `${label} copied.`; }
    catch { status.textContent = 'Copy unavailable. Select and copy the recorded text.'; }
  }), button('Show full height', event => {
    content.classList.toggle('full-height');
    /** @type {HTMLButtonElement} */ (event.currentTarget).textContent = content.classList.contains('full-height') ? 'Limit height' : 'Show full height';
  }));
  region.append(heading, content);
  return region;
}

/** @param {RunView} record @param {Row} row @param {AbortSignal} signal */
function renderTrajectory(record, row, signal) {
  const messages = record.trajectory.messages;
  const turns = conversationTurns(messages);
  const region = sectionTarget(row, 'trajectory', node('section', null, 'trajectory'));
  region.classList.toggle('no-simulator', row.user_simulator_model === null);
  const status = node('p', '', 'muted transcript-status');
  status.setAttribute('role', 'status');
  const messageNodes = new Map(/** @type {[number, HTMLElement][]} */ ([]));
  /** @type {Record<string, string>} */
  const participantNames = {evaluated_agent: 'Evaluated agent', user_simulator: 'User simulator', benchmark_prompt: 'Benchmark prompt', tool_environment: 'Tool environment'};
  const navigation = node('nav', null, 'conversation-navigation');
  navigation.setAttribute('role', 'toolbar'); navigation.setAttribute('aria-label', 'Conversation navigation'); navigation.tabIndex = 0;
  const choose = node('select'); choose.setAttribute('aria-label', 'Jump to message');
  const position = node('span', '', 'conversation-position'); position.setAttribute('aria-live', 'polite');
  let activeTurn = 0;
  let activeMessage = 0;
  /** @param {number} index */
  function selectMessage(index) {
    activeMessage = Math.max(0, Math.min(messages.length - 1, index));
    const message = messages[activeMessage];
    choose.value = String(message?.sequence ?? '');
    position.textContent = `${messages.length ? activeMessage + 1 : 0} / ${messages.length}`;
    position.setAttribute('aria-label', `Selected message ${messages.length ? activeMessage + 1 : 0} of ${messages.length}`);
    previous.disabled = !messages.length || activeMessage === 0;
    next.disabled = !messages.length || activeMessage === messages.length - 1;
  }
  /** @param {number} sequence @param {boolean} [persist] */
  function jump(sequence, persist = true) {
    const target = messageNodes.get(sequence);
    if (!target) return;
    const tools = target.closest('div.tools');
    if (tools instanceof HTMLElement && tools.hidden) toolsToggle.click();
    if (search.value) {
      if (target.querySelector('.tools[hidden]')) toolsToggle.click();
      const hiddenReasoning = [...target.querySelectorAll('details')].find(details => details.hidden && details.classList.contains('reasoning') && details.textContent.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
      if (hiddenReasoning) reasoningToggle.click();
    }
    if (region.hidden) activateRail('transcript', row);
    if (persist) {
      state = {...state, m: String(sequence), anchor: ''};
      history.replaceState(null, '', routes.href(state));
      refreshNavigationLinks();
    }
    revealAnchor(target.id);
    target.querySelectorAll('details').forEach(details => {
      if (search.value && details.textContent.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())) details.open = true;
    });
    const parentDetails = target.closest('details');
    if (parentDetails) parentDetails.open = true;
    target.classList.add('jump-highlight');
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setTimeout(() => target.classList.remove('jump-highlight'), 1200);
    status.textContent = `Message #${sequence}, ${participantNames[messages.find(message => message.sequence === sequence)?.participant ?? ''] ?? 'participant'}.`;
  }
  const previous = button('Previous', () => { const message = messages[activeMessage - 1]; if (message) jump(message.sequence); });
  previous.setAttribute('aria-label', 'Previous message');
  const next = button('Next', () => { const message = messages[activeMessage + 1]; if (message) jump(message.sequence); });
  next.setAttribute('aria-label', 'Next message');
  for (const message of messages) choose.append(new Option(`#${message.sequence} · ${participantNames[message.participant] ?? message.participant}`, String(message.sequence)));
  choose.disabled = !messages.length;
  choose.addEventListener('input', () => selectMessage(messages.findIndex(message => String(message.sequence) === choose.value)));
  choose.addEventListener('change', () => jump(Number(choose.value)));
  const selectLabel = node('label'); selectLabel.append(node('span', 'Jump to message', 'sr-only'), choose);
  navigation.append(previous, selectLabel, position, next);
  selectMessage(0);
  navigation.addEventListener('keydown', event => {
    if (event.target instanceof HTMLSelectElement || !messages.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    if (['Enter', ' '].includes(event.key) && event.target !== navigation) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft') selectMessage(activeMessage - 1);
    if (event.key === 'ArrowRight') selectMessage(activeMessage + 1);
    if (event.key === 'Home') selectMessage(0);
    if (event.key === 'End') selectMessage(messages.length - 1);
    if (event.key === 'Enter' || event.key === ' ') jump(messages[activeMessage].sequence);
  });
  const participants = node('div', null, 'participant-identities');
  for (const [name, model, seat] of [
    [row.user_simulator_model ? 'User simulator' : 'Benchmark prompt', row.user_simulator_model ?? 'Provided by the benchmark', 'user'],
    ['Evaluated agent', row.evaluated_agent_model, 'agent'],
  ]) {
    const participant = node('div', null, `participant-identity ${seat}`);
    const glyph = node('span', null, 'participant-glyph'); glyph.append(icon(seat === 'agent' ? 'agent' : row.user_simulator_model ? 'user' : 'document'));
    const text = node('div'); text.append(node('strong', name), node('small', model)); participant.append(glyph, text); participants.append(participant);
  }
  const title = node('div', null, 'conversation-title'); title.append(node(state.compare ? 'h3' : 'h2', 'Conversation'));
  region.append(title, participants, navigation);
  const toolbar = node('div', null, 'transcript-toolbar');
  const search = node('input');
  search.type = 'search';
  search.id = anchorId(row, 'control', 'search');
  const searchLabel = node('label', 'Find in transcript');
  searchLabel.htmlFor = search.id;
  const sequence = node('input');
  sequence.type = 'number'; sequence.min = '0'; sequence.step = '1';
  sequence.id = anchorId(row, 'control', 'sequence');
  sequence.value = String(messages[0]?.sequence ?? 0);
  const sequenceLabel = node('label', 'Message sequence'); sequenceLabel.htmlFor = sequence.id;
  /** @type {Message[]} */
  let matches = [];
  let matchPosition = -1;
  function find(direction = 1) {
    if (!matches.length) return;
    matchPosition = (matchPosition + direction + matches.length) % matches.length;
    jump(matches[matchPosition].sequence);
    status.textContent = `${matchPosition + 1} of ${matches.length} matches. Message #${matches[matchPosition].sequence}.`;
  }
  const nextMatch = button('Next match', () => find()); nextMatch.disabled = true;
  search.addEventListener('input', () => {
    matches = search.value ? messages.filter(message => JSON.stringify(message).toLocaleLowerCase().includes(search.value.toLocaleLowerCase())) : [];
    nextMatch.disabled = !matches.length;
    matchPosition = -1;
    status.textContent = search.value ? `${matches.length} matching messages.` : '';
  });
  search.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); find(event.shiftKey ? -1 : 1); } });
  const findControls = node('div', null, 'find-controls');
  findControls.append(searchLabel, search, nextMatch);
  const jumpControls = node('div', null, 'find-controls');
  jumpControls.append(sequenceLabel, sequence, button('Go to sequence', () => {
    if (sequence.value && messageNodes.has(Number(sequence.value))) jump(Number(sequence.value));
    else status.textContent = 'Enter a sequence that exists in this conversation.';
  }));
  const toggles = node('div', null, 'transcript-toggles');
  /** @param {string} label @param {string} selector */
  function toggle(label, selector) {
    const wrapper = node('label');
    const input = node('input'); input.type = 'checkbox'; input.checked = true;
    input.addEventListener('change', () => region.querySelectorAll(/** @type {'div'} */ (selector)).forEach(element => { element.hidden = !input.checked; }));
    wrapper.append(input, document.createTextNode(label)); toggles.append(wrapper);
    return input;
  }
  const reasoningToggle = toggle('Reasoning', '.reasoning');
  const toolsToggle = toggle('Tool calls', '.tools');
  const noteLabel = node('label', 'Analysis notes');
  const notes = node('select');
  notes.setAttribute('aria-label', 'Analysis notes');
  for (const [value, label] of [['hidden', 'Hidden'], ['pins', 'Pins'], ['inline', 'Inline']]) notes.append(new Option(label, value));
  noteLabel.append(notes); toggles.append(noteLabel);
  notes.addEventListener('change', () => {
    if (notes.value !== 'hidden') loadNotes();
    nextNote.disabled = notes.value === 'hidden' || !noteSequences.length;
    region.querySelectorAll('details').forEach(note => { if (!note.classList.contains('message-note')) return; note.hidden = notes.value === 'hidden'; note.open = notes.value === 'inline'; });
  });
  /** @param {boolean} open */
  function allTools(open) { region.querySelectorAll('details').forEach(call => { if (call.classList.contains('tool-call')) call.open = open; }); }
  const errors = messages.filter(message => message.tool_error === true).map(message => message.sequence);
  let errorPosition = -1;
  let notePosition = -1;
  /** @type {number[]} */
  let noteSequences = [];
  const nextError = button(`Next error (${errors.length})`, () => { errorPosition = (errorPosition + 1) % errors.length; jump(errors[errorPosition]); });
  nextError.disabled = !errors.length;
  const nextNote = button('Next note', () => { notePosition = (notePosition + 1) % noteSequences.length; jump(noteSequences[notePosition]); });
  nextNote.disabled = true;
  toolbar.append(findControls, jumpControls, toggles, button('Open all tool calls', () => allTools(true)), button('Close all tool calls', () => allTools(false)), nextError, nextNote);
  const options = disclosure('Find and display options', toolbar); options.className = 'transcript-options';
  title.append(options);
  region.append(status);
  const stream = node('div', null, 'message-stream');
  stream.tabIndex = 0; stream.setAttribute('role', 'region'); stream.setAttribute('aria-label', `Conversation messages · ${runLabel(row)}`);
  region.append(stream);
  /** @param {Message} message @param {string} [className] */
  function messageNode(message, className = '') {
    const article = node('article', null, `message ${className}`);
    article.id = anchorId(row, 'message', message.sequence); article.tabIndex = -1;
    article.dataset.participant = message.participant;
    article.setAttribute('aria-label', `Message ${message.sequence}, ${participantNames[message.participant] ?? message.participant}`);
    article.dataset.sequence = String(message.sequence);
    messageNodes.set(message.sequence, article);
    return article;
  }
  for (const turn of turns) {
    const message = turn.message;
    const article = messageNode(message, 'turn');
    article.dataset.hasTools = String(turn.calls.length > 0 || message.role === 'tool');
    const header = node('header', null, 'message-header');
    const glyph = node('span', null, 'participant-glyph');
    glyph.append(icon(message.participant === 'evaluated_agent' ? 'agent' : message.participant === 'user_simulator' ? 'user' : message.participant === 'benchmark_prompt' ? 'document' : 'tool'));
    glyph.setAttribute('aria-hidden', 'true');
    header.append(evidenceLink(row, 'message', message.sequence, `#${message.sequence}`), glyph, node('strong', participantNames[message.participant] ?? message.participant));
    article.append(header);
    for (const [label, value] of [['Reasoning', message.reasoning], ['Thinking', message.thinking_blocks]]) {
      if (value === null) continue;
      const words = display(value).trim().split(/\s+/).length;
      const reasoning = disclosure(`${label}, ${words} words`, raw(value)); reasoning.className = 'reasoning'; article.append(reasoning);
    }
    if (message.content !== null && message.content !== '') {
      const content = node('div', display(message.content), 'message-content');
      if (message.role === 'system') article.append(disclosure(`System prompt, ${display(message.content).trim().split(/\s+/).length} words`, content));
      else if (message.role === 'tool') {
        const orphan = disclosure('Unpaired tool result · association unrecorded or ambiguous', payload('Result', message.content, status));
        orphan.open = message.tool_error === true; article.append(orphan);
      } else article.append(content);
    }
    if (turn.calls.length) {
      const tools = node('div', null, 'tools');
      if (turn.calls.length > 1) tools.append(node('p', `${turn.calls.length} calls in parallel`, 'muted'));
      for (const entry of turn.calls) {
        const {call, results} = entry;
        const hasError = results.some(result => result.tool_error === true);
        const args = argumentPayload(call.arguments);
        const summary = node('span', null, 'call-summary');
        summary.append(node('span', hasError ? '✕' : results.length ? '✓' : '–', 'call-status'), node('strong', call.name), node('span', args.raw, 'argument-summary'),
          node('span', hasError ? 'Error' : results.length ? `${new TextEncoder().encode(results.map(result => display(result.content)).join('')).length.toLocaleString()} B` : 'No result recorded', 'result-size'));
        const details = disclosure('');
        // Native details keeps disclosure semantics, with the compact row as its summary.
        details.firstElementChild?.append(summary);
        details.className = `tool-call${hasError ? ' tool-error' : ''}`; details.open = hasError;
        details.append(payload('Arguments', call.arguments, status));
        for (const result of results) {
          const resultNode = messageNode(result, 'paired-result');
          resultNode.append(node('small', `Result message #${result.sequence}`, 'muted'), payload('Result', result.content, status), disclosure('Result metadata', raw({...result, content: undefined})));
          details.append(resultNode);
        }
        details.append(node('p', `Call ID: ${display(call.id)} · ${call.requestor === 'user_simulator' ? 'Called by the user simulator' : `Requested by ${display(call.requestor)}`}`, 'call-identity'));
        tools.append(details);
      }
      article.append(tools);
    }
    article.append(disclosure('Message metadata', raw({...message, content: undefined, reasoning: undefined, thinking_blocks: undefined, tool_calls: undefined})));
    stream.append(article);
  }
  stream.append(node('p', `Run ended: ${display(record.evaluation_result.termination_reason)}`, 'endcap'));
  region.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!['j', 'k', 'e', 'n', '/', '?'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'j' || event.key === 'k') {
      const sequence = target instanceof Element ? Number(target.closest('.message')?.getAttribute('data-sequence')) : NaN;
      const current = turns.findIndex(turn => turn.message.sequence === sequence);
      activeTurn = Math.max(0, Math.min(turns.length - 1, (current >= 0 ? current : activeTurn) + (event.key === 'j' ? 1 : -1)));
      if (turns[activeTurn]) jump(turns[activeTurn].message.sequence);
    } else if (event.key === 'e') nextError.click();
    else if (event.key === 'n') nextNote.click();
    else if (event.key === '/') { activateRail('transcript', row); options.open = true; search.focus(); }
    else status.textContent = 'Shortcuts: j / k next / previous turn; e next error; n next note; / find; message navigation Left / Right, Home / End, Enter to jump.';
  }, {signal});
  let notesLoaded = false;
  let notesPending = false;
  async function loadNotes() {
    if (notesLoaded || notesPending || !row.annotation_count) return;
    notesPending = true;
    try {
      const data = await getAnnotations();
      if (signal.aborted) return;
      const annotations = validateAnnotations(data[row.task_run_id] ?? [], record, row);
      if (annotations.length !== row.annotation_count) throw new Error('Annotation count differs from catalog.');
      noteSequences = [...new Set(annotations.flatMap(annotation => annotation.message_sequences))].sort((a, b) => a - b);
      nextNote.textContent = `Next note (${noteSequences.length})`; nextNote.disabled = notes.value === 'hidden' || !noteSequences.length;
      for (const sequence of noteSequences) {
        const items = annotations.filter(annotation => annotation.message_sequences.includes(sequence));
        const pin = disclosure(`${items.length} historical analysis ${items.length === 1 ? 'note' : 'notes'}`, node('p', 'Historical analysis. Author, model, and time unrecorded.', 'muted'));
        pin.className = 'message-note'; pin.open = notes.value === 'inline'; pin.hidden = notes.value === 'hidden';
        for (const item of items) pin.append(node('p', item.summary), sourceReference(item.source));
        messageNodes.get(sequence)?.append(pin);
      }
      notesLoaded = true;
    } catch (error) {
      if (!signal.aborted) {
        annotationData = undefined;
        notes.value = 'hidden';
        status.textContent = `Historical note pins unavailable. ${(error instanceof Error ? error.message : String(error))} Select Pins or Inline to retry.`;
      }
    } finally { notesPending = false; }
  }
  return region;
}

/** @param {TaskView} record @param {Row} row @param {AbortSignal} signal */
function renderPolicy(record, row, signal) {
  const region = node('section');
  region.append(node('h3', 'Native policy'));
  if (record.evaluation_criteria.policy === null) {
    region.append(node('p', 'No native policy was recorded.', 'muted'));
    return region;
  }
  region.append(disclosure('Native policy reference', raw(record.evaluation_criteria.policy)));
  if (row.policy_path === null) {
    region.append(node('p', 'No policy-text projection is available. The native source reference remains above.', 'muted'));
    return region;
  }
  const content = node('div');
  const load = button('Load native policy text', async () => {
    load.disabled = true;
    content.replaceChildren(node('p', 'Loading native policy…', 'muted'));
    try {
      const policy = /** @type {{text: string, sources: Source[]}} */ (await fetchJson(row.policy_path ?? '', signal));
      if (typeof policy.text !== 'string' || !Array.isArray(policy.sources)) throw new Error('Invalid policy-text projection.');
      for (const source of policy.sources) repositoryUrl(source.path, root);
      content.replaceChildren(raw(policy.text), disclosure('Policy source evidence', ...policy.sources.map(sourceReference)));
      const find = node('input'); find.type = 'search'; find.setAttribute('aria-label', 'Find in native policy');
      const result = node('p', '', 'muted'); result.setAttribute('role', 'status');
      find.addEventListener('input', () => {
        const text = policy.text.toLocaleLowerCase(); const query = find.value.toLocaleLowerCase();
        const matches = [];
        if (query) {
          let position = text.indexOf(query);
          while (position !== -1) { matches.push(position); position = text.indexOf(query, position + query.length); }
        }
        result.replaceChildren(document.createTextNode(query ? `${matches.length} matches in native policy` : ''));
        const pre = content.querySelector('pre');
        if (pre) {
          pre.replaceChildren(); let previous = 0;
          for (const position of matches) {
            pre.append(document.createTextNode(policy.text.slice(previous, position)), node('mark', policy.text.slice(position, position + query.length)));
            previous = position + query.length;
          }
          pre.append(document.createTextNode(policy.text.slice(previous)));
          const next = button('Next policy match', () => {
            const marks = pre.querySelectorAll('mark');
            const index = Number(next.dataset.index ?? '0');
            marks[index % marks.length]?.scrollIntoView({block: 'center'});
            next.dataset.index = String(index + 1);
          });
          if (matches.length) result.append(document.createTextNode(' '), next);
        }
      });
      content.prepend(find, result);
      load.hidden = true;
    } catch (error) {
      if (signal.aborted) return;
      content.replaceChildren(node('p', `Native policy could not load. ${(error instanceof Error ? error.message : String(error))}`, 'error'));
      load.textContent = 'Retry native policy';
      load.disabled = false;
    }
  });
  region.append(load, content);
  return region;
}

/** @returns {Promise<Record<string, Annotation[]>>} */
async function getAnnotations() {
  if (annotationData) return annotationData;
  if (!annotationRequest) {
    annotationRequest = fetchJson('views/explorer/annotations.json').then(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid analysis annotation projection.');
      annotationData = /** @type {Record<string, Annotation[]>} */ (value);
      return annotationData;
    }).finally(() => { annotationRequest = undefined; });
  }
  return annotationRequest;
}

/** @param {Annotation[]} annotations @param {RunView} record @param {Row} row */
function validateAnnotations(annotations, record, row) {
  if (!Array.isArray(annotations)) throw new Error('Invalid annotation array for this task run.');
  const sequences = new Set(record.trajectory.messages.map(message => message.sequence));
  const checkIds = new Set(record.evaluation_criteria.checks.map(check => check.id));
  const ids = new Set();
  for (const annotation of annotations) {
    if (annotation.task_run_id !== row.task_run_id || typeof annotation.annotation_id !== 'string' || ids.has(annotation.annotation_id) ||
        !Array.isArray(annotation.labels) || !Array.isArray(annotation.message_sequences) || !Array.isArray(annotation.check_ids) ||
        annotation.message_sequences.some(sequence => !sequences.has(sequence)) || annotation.check_ids.some(id => !checkIds.has(id))) {
      throw new Error('An annotation has an invalid identity or evidence anchor.');
    }
    repositoryUrl(annotation.source.path, root);
    ids.add(annotation.annotation_id);
  }
  return annotations;
}

/** @param {RunView} record @param {Row} row */
function renderAnnotations(record, row) {
  const region = sectionTarget(row, 'analysis', node('section'));
  region.append(node(state.compare ? 'h3' : 'h2', 'Historical analysis'), node('p',
    'Historical analysis. It is not part of the native evaluation. Its author, model, and time were not recorded.', 'muted'));
  if (!row.annotation_count) {
    region.append(node('p', 'No historical analysis is attached to this task run.', 'muted'));
    return region;
  }
  const content = node('div');
  const details = disclosure(`Historical analysis (${row.annotation_count} annotations)`, content);
  let loaded = false;
  let pending = false;
  const load = async () => {
    if (loaded || pending) return;
    pending = true;
    content.replaceChildren(node('p', 'Loading historical analysis…', 'muted'));
    try {
      const data = await getAnnotations();
      const annotations = validateAnnotations(Object.hasOwn(data, row.task_run_id) ? data[row.task_run_id] : [], record, row);
      if (annotations.length !== row.annotation_count) throw new Error('The annotation count does not match the catalog.');
      content.replaceChildren();
      for (const annotation of annotations) {
        const article = node('article', null, 'annotation');
        article.append(node('p', annotation.kind, 'analysis-label'), node('p', annotation.summary));
        const labels = node('div');
        for (const label of annotation.labels) labels.append(node('span', label, 'analysis-label'));
        article.append(labels, node('p', `Documented method: ${display(annotation.producer?.method)}`, 'muted'), sourceReference(annotation.source));
        for (const sequence of annotation.message_sequences) article.append(evidenceLink(row, 'message', sequence, `Message ${sequence}`), document.createTextNode(' '));
        for (const id of annotation.check_ids) article.append(evidenceLink(row, 'check', id, `Criterion ${id}`), document.createTextNode(' '));
        article.append(disclosure('Analysis details and provenance',
          fields([
            ['Annotation ID', annotation.annotation_id], ['Author', annotation.producer?.author],
            ['Annotator model', annotation.producer?.model], ['Created at', annotation.producer?.created_at],
            ['Documented method', annotation.producer?.method], ['Join evidence', annotation.join_method],
          ]), raw(annotation.details), sourceReference(annotation.source)));
        content.append(article);
      }
      loaded = true;
      refreshNavigationLinks();
    } catch (error) {
      annotationData = undefined;
      content.replaceChildren(node('p', `Historical analysis is unavailable. Native results remain available. ${(error instanceof Error ? error.message : String(error))}`, 'error'), button('Retry historical analysis', load));
    } finally {
      pending = false;
    }
  };
  details.addEventListener('toggle', () => { if (details.open) load(); });
  region.append(details);
  return region;
}

/** @param {TaskView} record @param {Row} row @param {AbortSignal} signal */
function renderPromptInputs(record, row, signal) {
  const region = sectionTarget(row, 'prompts', node('section', null, 'rail-pane prompt-inputs'));
  region.append(node('h3', 'Inputs'));
  const task = record.metadata.task;
  /** @param {string} label */
  function inputGroup(label) {
    const group = node('section', null, 'input-group'); group.append(node('h4', label)); return group;
  }
  const agentInputs = inputGroup('Evaluated agent');
  const simulator = inputGroup('User simulator');
  const metadata = inputGroup('Benchmark metadata');
  const unknown = inputGroup('Visibility not recorded');
  /** @param {unknown} value */
  const inputText = value => {
    if (value && typeof value === 'object') {
      const content = node('div', null, 'prompt-fields');
      for (const [name, text] of Object.entries(value)) {
        const field = node('div'); field.append(node('strong', name.replaceAll('_', ' ')), node('pre', display(text), 'prompt-text')); content.append(field);
      }
      content.append(disclosure('Exact structured input', raw(value)));
      return content;
    }
    return node('pre', display(value), 'prompt-text');
  };
  const systems = record.input_messages.filter(message => message.role === 'system');
  if (!systems.length) agentInputs.append(node('p', 'System prompt: unrecorded.', 'missing-input'));
  for (const message of systems) agentInputs.append(disclosure(`System prompt · message #${message.sequence}`, node('pre', display(message.content), 'prompt-text'), evidenceLink(row, 'message', message.sequence, 'View in conversation')));
  agentInputs.append(node('p', 'Persona: not recorded separately. Any persona in a system prompt remains in that prompt.', 'missing-input'));
  const descriptionGroup = task.input_visibility.description === 'evaluated_agent' ? agentInputs : task.input_visibility.description === 'benchmark_metadata' ? metadata : task.input_visibility.description === 'user_simulator' ? simulator : unknown;
  const inputLabel = task.input_visibility.description === 'evaluated_agent' ? 'Task instruction' : 'Task description';
  const instructionMessage = record.input_messages.find(message => message.role === 'user' && message.content === task.description);
  if (state.task) descriptionGroup.append(node('h5', inputLabel), navigationLink('Read the instruction above', {}, 'task-instruction'));
  else if (instructionMessage && task.description != null) {
    const instruction = disclosure(`${inputLabel} · message #${instructionMessage.sequence}`, inputText(task.description), evidenceLink(row, 'message', instructionMessage.sequence, 'View in conversation'));
    instruction.className = 'task-input-instruction'; descriptionGroup.append(instruction);
  } else descriptionGroup.append(node('h5', inputLabel), task.description == null ? node('p', 'Unrecorded.', 'missing-input') : inputText(task.description));
  const inputs = record.input_messages.filter(message => message.role === 'user');
  const messages = disclosure(`Agent input messages · ${inputs.length}`);
  const inputLinks = node('ul', null, 'input-message-links');
  for (const message of inputs) {
    const item = node('li');
    item.append(evidenceLink(row, 'message', message.sequence, `Message #${message.sequence}${message.content === task.description ? ' · task instruction' : message.participant === 'user_simulator' ? ' · user simulator' : ' · benchmark input'}`));
    inputLinks.append(item);
  }
  messages.append(inputLinks); agentInputs.append(messages);
  if (row.user_simulator_model !== null) {
    const scenario = task.user_scenario && typeof task.user_scenario === 'object' ? /** @type {Record<string, unknown>} */ (task.user_scenario) : null;
    simulator.append(node('h5', 'Persona'), scenario?.persona == null ? node('p', 'Unrecorded.', 'missing-input') : inputText(scenario.persona), node('h5', 'Instructions'));
    simulator.append(scenario?.instructions == null ? node('p', 'Unrecorded.', 'missing-input') : inputText(scenario.instructions));
  }
  if (task.ticket != null) {
    const ticketGroup = task.input_visibility.ticket === 'evaluated_agent' ? agentInputs : task.input_visibility.ticket === 'user_simulator' ? simulator : task.input_visibility.ticket === 'benchmark_metadata' ? metadata : unknown;
    ticketGroup.append(disclosure('Ticket', inputText(task.ticket)));
  }
  region.append(agentInputs);
  if (row.user_simulator_model !== null || simulator.children.length > 1) region.append(simulator);
  if (metadata.children.length > 1) region.append(metadata);
  if (unknown.children.length > 1) region.append(unknown);
  const guidelines = record.metadata.experiment.simulator_guidelines;
  if (guidelines) {
    const body = node('div');
    const status = node('p', 'Show the exact text retained in this generated view.', 'muted'); status.setAttribute('role', 'status');
    const load = button('Load recorded guidelines', async () => {
      load.disabled = true; status.textContent = 'Verifying recorded guidelines…';
      try {
        const value = record.simulator_guidelines;
        if (typeof value !== 'string') throw new Error('The recorded guidelines are not text.');
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (digest !== guidelines.sha256) throw new Error('The recorded guideline digest does not match.');
        if (!signal.aborted) body.replaceChildren(node('pre', value, 'prompt-text'));
      } catch (error) {
        if (!signal.aborted) { status.textContent = `Guidelines could not load. ${error instanceof Error ? error.message : String(error)}`; load.disabled = false; load.textContent = 'Retry recorded guidelines'; }
      }
    });
    body.append(status, load);
    simulator.append(disclosure('Recorded guidelines', sourceReference({...record.source.artifact, pointer: guidelines.source_pointer}), body));
  }
  return region;
}

/** @param {string} tab @param {Row} row @param {boolean} [persist] */
function activateRail(tab, row, persist = true) {
  const article = document.getElementById(anchorId(row, 'section', 'task-run'));
  if (!article) return;
  article.dataset.activeTab = tab;
  const desktopTab = tab === 'transcript' ? 'verdict' : tab;
  article.querySelectorAll('.rail-tab').forEach(button => {
    if (!(button instanceof HTMLButtonElement)) return;
    const selected = button.dataset.tab === tab || (button.dataset.tab === desktopTab && !matchMedia('(max-width: 1023px)').matches);
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
  });
  article.querySelectorAll('section').forEach(pane => { if (pane.classList.contains('rail-pane')) pane.hidden = pane.dataset.tab !== desktopTab; });
  if (tab === 'analysis') {
    const details = article.querySelector('.rail-pane[data-tab="analysis"] > details');
    if (details instanceof HTMLDetailsElement) details.open = true;
  }
  const strip = article.querySelector('.rail-tabs'); if (strip instanceof HTMLElement) revealCurrentTab(strip);
  if (persist) { state = {...state, tab}; history.replaceState(null, '', routes.href(state)); refreshNavigationLinks(); }
}

/** @param {RunView} record @param {Row} row @param {AbortSignal} signal */
function renderEvidence(record, row, signal) {
  const result = record.evaluation_result;
  const criteria = record.evaluation_criteria;
  const rail = node('aside', null, 'evidence');
  rail.setAttribute('aria-label', 'Run inspector');
  const tabs = node('div', null, 'tabs rail-tabs');
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Run evidence');
  const panes = node('div', null, 'rail-panes');
  const verdict = sectionTarget(row, 'evaluation', node('section', null, 'rail-pane'));
  const prompts = renderPromptInputs(record, row, signal);
  const analysis = renderAnnotations(record, row); analysis.classList.add('rail-pane');
  const provenance = sectionTarget(row, 'provenance', node('section', null, 'rail-pane'));
  /** @type {Array<[string, string, HTMLElement | null]>} */
  const railPanels = [['transcript', 'Conversation', null], ['verdict', 'Evaluation', verdict], ['prompts', 'Inputs', prompts], ['analysis', `Analysis · ${row.annotation_count}`, analysis], ['provenance', 'Source', provenance]];
  for (const [key, label, pane] of railPanels) {
    const tab = button(label, () => activateRail(key, row));
    tab.id = anchorId(row, 'tab', key); tab.className = `rail-tab${key === 'transcript' ? ' transcript-tab' : ''}`;
    tab.dataset.tab = key; tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', pane?.id ?? anchorId(row, 'section', 'trajectory'));
    tab.setAttribute('aria-selected', String(key === 'verdict')); tab.tabIndex = key === 'verdict' ? 0 : -1;
    tab.addEventListener('keydown', event => {
      const options = [...tabs.querySelectorAll('button')].filter(button => getComputedStyle(button).display !== 'none');
      const index = options.indexOf(tab);
      const next = event.key === 'ArrowRight' ? (index + 1) % options.length : event.key === 'ArrowLeft' ? (index - 1 + options.length) % options.length : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); options[next].click(); options[next].focus(); }
    });
    tabs.append(tab);
    if (pane) {
      pane.dataset.tab = key; pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', tab.id);
      pane.hidden = key !== 'verdict'; panes.append(pane);
    }
  }
  const resultsById = new Map(result.check_results.map(check => [check.id, check.result]));
  const statuses = new Map(row.checks.map(check => [check.id, check]));
  const counted = row.checks.filter(check => check.scored === true);
  const countedIds = new Set(counted.map(check => check.id));
  if (!state.compare) {
    verdict.append(node('h2', 'Evaluation', 'sr-only'));
    provenance.append(node('h2', 'Source', 'sr-only'));
  }
  if (row.benchmark === 'tau2-bench') {
    verdict.append(fields([['Required scoring components', scoringComponents(criteria.intended_reward_basis)],
      ['Components used in this run', scoringComponents(result.evaluated_reward_basis)]]));
    if (row.reward_basis_differs) verdict.append(node('p', 'The task configuration and this run use different scoring components. Inspect the native evaluation below.', 'notice'));
  }
  /** @param {RunView['evaluation_criteria']['checks'][number]} check */
  const checkLine = check => {
    const status = /** @type {NonNullable<ReturnType<typeof statuses.get>>} */ (statuses.get(check.id));
    const summary = checkSummary(check);
    const labels = {passed: 'Passed', failed: 'Failed', not_evaluated: 'Not evaluated'};
    const details = disclosure('', node('h4', 'Exact native specification'), raw(check.specification), node('h4', 'Native result'),
      resultsById.get(check.id) == null ? node('p', 'No native check result was recorded.', 'muted') : raw(resultsById.get(check.id)));
    const heading = node('span', null, 'check-heading');
    heading.append(icon(status.status === 'passed' ? 'check' : status.status === 'failed' ? 'close' : 'unknown'), node('strong', `${labels[status.status]} · ${summary.label}`), node('small', check.id, 'check-id'));
    details.firstElementChild?.append(heading, node('span', summary.parameters, 'check-parameters'));
    details.className = `criterion ${status.status}`; details.id = anchorId(row, 'check', check.id); details.tabIndex = -1;
    return details;
  };
  const group = (/** @type {typeof counted} */ checks) => criteria.checks.filter(check => checks.some(item => item.id === check.id)).map(checkLine);
  verdict.append(sectionTarget(row, 'criteria', node('h3', 'Scoring checks')));
  for (const [status, label] of [['failed', 'Failed'], ['not_evaluated', 'Not evaluated']]) {
    const attention = counted.filter(check => check.status === status);
    if (!attention.length) continue;
    const links = node('p', null, `check-attention ${status}`); links.append(node('strong', `${label}: `));
    attention.forEach((check, index) => {
      if (index) links.append(document.createTextNode(' · '));
      links.append(evidenceLink(row, 'check', check.id, check.id));
    });
    verdict.append(links);
  }
  verdict.append(...group(counted));
  if (!counted.length) verdict.append(node('p', 'No scoring checks were recorded.', 'muted'));
  const others = row.checks.filter(check => !countedIds.has(check.id));
  if (others.length) {
    const checks = summarizeChecks(others);
    const other = disclosure(`Other checks · ${checks.excluded} non-scoring${checks.unclassified ? ` · ${checks.unclassified} participation unrecorded` : ''}`, ...group(others));
    other.className = 'other-checks'; verdict.append(other);
  }
  verdict.append(disclosure('Native evaluation result', result.evaluation_note === null ? node('p', 'No evaluator explanation was recorded.', 'muted') : raw(result.evaluation_note), raw(result)));
  if (criteria.policy !== null) verdict.append(renderPolicy(record, row, signal));
  if (criteria.reference_behavior !== null) {
    const reference = criteria.reference_behavior;
    const actions = Array.isArray(reference) ? reference : typeof reference === 'object' && 'actions' in reference && Array.isArray(reference.actions) ? reference.actions : null;
    const content = node('div');
    if (actions) {
      const list = node('ol');
      actions.forEach((action, index) => {
        const item = node('li'); item.append(raw(action));
        if (statuses.has(`ACTION/${index}`)) item.append(evidenceLink(row, 'check', `ACTION/${index}`, 'Go to ACTION check'));
        list.append(item);
      }); content.append(list);
    } else content.append(raw(reference));
    verdict.append(disclosure('Reference behavior', content));
  }
  provenance.append(node('h3', 'Identity and provenance'), repositoryLink(row.record_path, 'Open projected run JSON'), fields([
    ['Task run', row.task_run_id], ['Source role', row.source_role], ['Reported', row.reported], ['Trial index', row.trial_index],
    ['Cost (USD)', result.cost_usd], ['Cost basis', result.cost_basis], ['Duration (seconds)', result.duration_seconds], ['Started at', record.metadata.started_at], ['Ended at', record.metadata.ended_at],
    ['Separate policy text', criteria.policy === null ? 'Not retained in this record. Policy requirements may still apply.' : 'Recorded in Evaluation'],
    ['Reference behavior', criteria.reference_behavior === null ? 'Unrecorded' : 'Recorded in Evaluation'],
  ]), cohortDetails(catalog.cohorts[row.cohort_id]), sourceReference(record.source.artifact), sourceReference(record.source.config), disclosure('Native source pointers', raw(record.source)), disclosure('Complete task-run metadata', raw(record.metadata)), disclosure('Recorded usage', raw(result.usage)), disclosure('Catalog evidence and signatures', raw(row)));
  rail.append(tabs, panes);
  return rail;
}

/** @param {RunView} record @param {Row} row @param {AbortSignal} signal */
function renderTaskRun(record, row, signal) {
  const article = sectionTarget(row, 'task-run', node('article', null, 'task-run'));
  article.dataset.taskRunId = row.task_run_id;
  const header = node('header', null, 'run-header');
  const identity = node('div', null, 'run-identity');
  const cohort = catalog.cohorts[row.cohort_id];
  const title = node(state.compare ? 'h2' : 'h1', state.compare ? runLabel(row) : null, 'run-title');
  if (!state.compare) {
    const taskLink = navigationLink(taskTitle(row), {task: row.task_key, task_run: '', compare: '', record: row.task_run_id, tab: 'verdict', anchor: ''});
    taskLink.title = 'Open task definition'; title.append(taskLink);
  }
  identity.append(title);
  const context = node('p', null, 'run-context muted');
  if (!state.compare) context.append(node('strong', modelName(row.evaluated_agent_model)), document.createTextNode(' · '));
  context.append(document.createTextNode(`v${row.benchmark_version} · ${row.domain} · ${sourceDates(cohort)} · ${sourceRoleLabel(row.source_role)}${row.trial_index !== null && !state.compare ? ` · trial ${row.trial_index}` : ''}`));
  identity.append(context);
  if (!state.compare || row.task_key !== rowFor(state.task_run).task_key) {
    const taskId = navigationLink(row.task_id, {task: row.task_key, task_run: '', compare: '', record: row.task_run_id, tab: 'verdict', anchor: ''});
    taskId.className = 'run-task-id'; identity.append(taskId);
  }
  if (cohort.selection_note) identity.append(disclosure('Hand-picked subset · selection context', node('p', cohort.selection_note, 'selection-note')));
  header.append(identity);
  if (!state.compare) {
    const native = node('div', null, 'headline-verdict');
    native.append(node('span', 'Native', 'muted'), nativeBadge(record.evaluation_result.success), compactChecks(row, true));
    if (record.evaluation_result.reward !== null) native.append(node('small', `Native reward ${record.evaluation_result.reward}`));
    if (row.benchmark === 'automationbench') {
      const note = node('a', 'Diagnostic · Paper §4'); note.href = automationBenchPaper.source.scoringUrl;
      note.title = 'Assertion fractions are diagnostic only. A failed task earns no partial benchmark credit.';
      native.append(note);
    }
    header.append(native);
  }
  const layout = node('div', null, 'run-layout run-workspace');
  const trajectory = renderTrajectory(record, row, signal);
  trajectory.setAttribute('role', 'tabpanel');
  trajectory.setAttribute('aria-labelledby', anchorId(row, 'tab', 'transcript'));
  layout.append(renderEvidence(record, row, signal), trajectory);
  const initialTab = state.compare ? state.dimension === 'checks' ? 'verdict' : state.dimension === 'setup' ? 'provenance' : 'transcript' : state.tab ? state.tab : matchMedia('(max-width: 1023px)').matches ? 'transcript' : 'verdict';
  article.dataset.activeTab = initialTab;
  article.append(header, layout);
  queueMicrotask(() => activateRail(initialTab, row, false));
  return article;
}

async function renderInspection() {
  const request = ++detailRequest;
  detailAbort?.abort();
  detailAbort = new AbortController();
  const signal = detailAbort.signal;
  inspection.replaceChildren();
  inspection.hidden = true;
  element('record-workspace').hidden = true;
  browse.hidden = state.view !== 'runs';
  loading.hidden = true;
  clearError();
  if (!state.task_run) {
    if (state.compare) showError('Select a task run before choosing a comparison.');
    return;
  }
  const ids = [state.task_run, ...(state.compare ? [state.compare] : [])];
  if (ids.some(id => !rowsById.has(id))) {
    showError('The requested task-run ID is not in this catalog. Return to the task-run list or reset the filters.');
    return;
  }
  if (ids.length === 2 && ids[0] === ids[1]) {
    showError('Choose two different task runs for a comparison.');
    return;
  }
  const rows = ids.map(rowFor);
  browse.hidden = true;
  loading.textContent = 'Loading task-run evidence…';
  loading.hidden = false;
  try {
    const records = await Promise.all(rows.map(async row => validateRunView(/** @type {RunView} */ (await fetchJson(row.record_path, signal)), row)));
    if (request !== detailRequest) return;
    const toolbar = node('div', null, 'toolbar');
    const back = navigationLink('← All task runs', {task_run: '', compare: '', view: 'runs', m: '', anchor: ''}); back.classList.add('back-link');
    toolbar.append(back);
    if (catalog.rows.some(row => row.task_key === rows[0].task_key && row.task_run_id !== rows[0].task_run_id)) {
      const sameTask = disclosure('Compare runs', renderSameTaskControls(rows[0])); sameTask.className = 'same-task-controls'; toolbar.append(sameTask);
    }
    toolbar.classList.add('inspection-actions'); inspection.append(toolbar);
    if (rows.length === 2) inspection.append(renderRunComparison(records, rows));
    const runs = rows.length === 2 ? node('div', null, 'comparison-grid') : node('div');
    records.forEach((record, index) => runs.append(renderTaskRun(record, rows[index], signal)));
    if (rows.length === 2) {
      runs.dataset.dimension = state.dimension;
      const alignLabel = node('label', null, 'align-control');
      const align = node('input'); align.type = 'checkbox';
      alignLabel.append(align, document.createTextNode('Sync scroll by turn position (not matching events)'));
      inspection.append(alignLabel);
      const transcripts = [...runs.querySelectorAll('.message-stream')].filter(element => element instanceof HTMLElement);
      let syncing = false;
      transcripts.forEach((transcript, index) => transcript.addEventListener('scroll', () => {
        if (!align.checked || syncing || matchMedia('(max-width: 1023px)').matches) return;
        const sourceTurns = [...transcript.querySelectorAll('article.turn')];
        const first = sourceTurns.findIndex(turn => turn.getBoundingClientRect().bottom > transcript.getBoundingClientRect().top);
        const other = transcripts[1 - index];
        const target = other?.querySelectorAll('article.turn')[Math.max(0, first)];
        if (!other || !(target instanceof HTMLElement)) return;
        syncing = true;
        other.scrollTop += target.getBoundingClientRect().top - other.getBoundingClientRect().top;
        requestAnimationFrame(() => { syncing = false; });
      }));
    }
    inspection.append(runs);
    inspection.hidden = false;
    element('record-workspace').hidden = false;
    element('record-workspace').classList.toggle('comparing', rows.length === 2);
    renderRunBrowser(rows[0]);
    if (rows.length === 2) activateComparisonDimension(state.dimension, false);
    refreshNavigationLinks();
    if (requestedAnchor) {
      if (!revealAnchor(requestedAnchor)) showError('The requested evidence anchor is not present in these task runs.');
    } else if (focusSelection === detailKey) inspection.focus();
  } catch (error) {
    if (request !== detailRequest || signal.aborted) return;
    inspection.replaceChildren();
    inspection.hidden = true;
    browse.hidden = state.view !== 'runs';
    showError(`Task-run evidence could not load. ${(error instanceof Error ? error.message : String(error))}`, () => render({force: true, focus: true}));
  } finally {
    if (request === detailRequest) loading.hidden = true;
  }
}

/** @param {{focus?: boolean, force?: boolean, anchor?: string | null}} [options] */
function render({focus = false, force = false, anchor = null} = {}) {
  if (!catalog) return;
  requestedAnchor = anchor;
  focusSelection = focus ? `${state.task_run}\0${state.compare}\0${state.scope}` : null;
  renderFrame();
  populateFilters();
  restoreControls();
  if (!state.task_run && !state.task) {
    renderBrowse();
    if (state.view === 'models') renderComparisonSummary();
  }
  const key = state.task_run || state.compare ? `${state.task_run}\0${state.compare}\0${state.scope}` : state.task ? `task:${state.task}\0${state.scope}` : '';
  if (force || key !== detailKey) {
    detailKey = key;
    if (state.task && !state.task_run) renderTaskDetails(focus);
    else renderInspection();
  } else if (anchor) revealAnchor(anchor);
  else if (state.task && !state.task_run) refreshTaskDefinition?.();
  else if (state.compare) activateComparisonDimension(state.dimension, false);
  else if (state.task_run && rowsById.has(state.task_run)) activateRail(state.tab, rowFor(state.task_run), false);
  if (focus && !state.task_run && !state.task) element('main-content').focus();
  refreshNavigationLinks();
}

async function loadCatalog() {
  loading.textContent = 'Loading the task-run catalog…';
  loading.hidden = false;
  clearError();
  for (const control of Object.values(controls)) control.disabled = true;
  try {
    if (location.protocol === 'file:') throw new Error('Serve the generated website over HTTP, then open its root URL.');
    catalog = validateCatalog(/** @type {Catalog} */ (await fetchJson('views/explorer/catalog.json')), root);
    routes = createRouter(catalog.rows, appBase);
    state = routes.read(location.href);
    rowsById = new Map(catalog.rows.map(row => [row.task_run_id, row]));
    populateFilters();
    loading.hidden = true;
    for (const control of Object.values(controls)) control.disabled = false;
    history.replaceState(null, '', routes.href(state));
    render({anchor: state.anchor || (state.m !== '' && rowsById.has(state.task_run) ? anchorId(rowFor(state.task_run), 'message', state.m) : null)});
  } catch (error) {
    loading.hidden = true;
    showError(`The task-run catalog could not load. ${(error instanceof Error ? error.message : String(error))} Use an HTTP server and confirm that views/explorer/catalog.json exists.`, loadCatalog);
  }
}

document.querySelector('.skip-link')?.addEventListener('click', event => {
  event.preventDefault();
  const content = element('main-content');
  content.focus();
  content.scrollIntoView({block: 'start'});
});
element('filters').addEventListener('submit', event => event.preventDefault());
for (const [key, control] of Object.entries(controls)) {
  control.addEventListener(control instanceof HTMLSelectElement ? 'change' : 'input', () => {
    const patch = {[key]: control.value, page: 1};
    if (['domain', 'benchmark', 'version'].includes(key)) patch.cohorts = '';
    navigate({...patch, ...(key === 'domain' ? {task: '', task_run: '', compare: '', m: '', anchor: ''} : {})}, {replace: control instanceof HTMLInputElement});
  });
}
element('reset').addEventListener('click', () => {
  const clean = emptyState();
  navigate({...clean, benchmark: state.benchmark, domain: state.domain, view: state.view});
});
function restoreLocation() {
  const next = routes.read(location.href);
  const url = routes.href(next);
  if (location.pathname + location.search !== url || location.hash) history.replaceState(null, '', url);
  const anchor = next.anchor || (next.m !== '' && rowsById.has(next.task_run) ? anchorId(rowFor(next.task_run), 'message', next.m) : null);
  if (url === routes.href(state)) {
    if (anchor) revealAnchor(anchor);
    return;
  }
  const focus = next.task !== state.task || next.task_run !== state.task_run || next.compare !== state.compare;
  state = next;
  render({focus, anchor});
}
const navigationObserver = new ResizeObserver(() => {
  document.documentElement.style.setProperty('--navigation-height', `${element('view-tabs').offsetHeight}px`);
});
navigationObserver.observe(element('view-tabs'));
window.addEventListener('popstate', restoreLocation);
loadCatalog();
