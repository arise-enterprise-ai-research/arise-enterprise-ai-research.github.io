/** @typedef {{cohort_id: string, total: number, successes: number, failures: number, unknown: number, tasks: number, availableTasks: number, excludedTasks: number, repetitions: {min: number, max: number}, taskBalancedRate: number | null, rewardBasisDifferences: number}} ComparisonGroup */
/**
 * @typedef {unknown} Json
 * @typedef {{path: string, pointer?: string, sha256?: string, scope?: string}} Source
 * @typedef {{name: string, value: Json, source?: Source | null}} Component
 * @typedef {'passed' | 'failed' | 'not_evaluated'} CheckStatus
 * @typedef {{id: string, status: CheckStatus, scored: boolean | null, excluded: boolean | null}} Check
 * @typedef {{model: string | null, [key: string]: Json | undefined}} Participant
 * @typedef {{cohort_id: string, condition_components: Component[], result_bundle_id: string, source_role: string,
 * source_dates: string[], source: Source, config: Source, evaluated_agent: Participant, user_simulator: Participant | null,
 * selection_note: string | null, experiment: Json, completeness: Json}} Cohort
 * @typedef {{task_run_id: string, task_id: string, task_key: string, record_path: string, task_view_path: string, message_count: number, benchmark: string,
 * benchmark_version: string, domain: string, evaluated_agent_model: string, user_simulator_model: string | null,
 * cohort_id: string, task_components: Component[], reported: boolean, source_role: string, description: string,
 * analysis_text: string, checks: Check[], success: boolean | null, score: number | null, reward: number | null,
 * reward_basis_differs: boolean, policy_path: string | null, annotation_count: number, annotation_labels: string[],
 * trial_index: number | null, task_run_seed: number | null, result_bundle_id: string, cost_usd: number | null,
 * evaluated_agent_tool_calls: number, user_simulator_tool_calls: number, termination_reason: string | null}} Row
 * @typedef {{schema_version: number, rows: Row[], cohorts: Record<string, Cohort>, coverage: Record<string, {unmatched_ids: unknown[]}>}} Catalog
 * @typedef {{id: string | null, name: string, arguments: Json, requestor: string | null}} ToolCall
 * @typedef {{sequence: number, role: string, participant: string, content: Json, reasoning: Json, thinking_blocks: Json,
 * tool_calls: ToolCall[], tool_call_id: string | null, requestor: string | null, tool_error: boolean | null,
 * timestamp: string | null, usage: Json, turn_index: number | null, native_cost: Json}} Message
 * @typedef {{message: Message, call: ToolCall, results: Message[]}} PairedCall
 * @typedef {{message: Message, calls: PairedCall[]}} Turn
 * @typedef {{view_schema_version: number, task_run_id: string, source: {artifact: Source, config: Source, task_pointer: string, task_run_pointer: string},
 * metadata: {task: Record<string, Json> & {input_visibility: Record<string, Json>}, started_at: string | null, ended_at: string | null,
 * experiment: {simulator_guidelines: {source_pointer: string, sha256: string} | null}},
 * input_messages: Message[], simulator_guidelines: string | null,
 * evaluation_criteria: {policy: Json, reference_behavior: Json,
 * intended_reward_basis: Json, checks: {id: string, kind: string, specification: Record<string, Json> | string}[]}}} TaskView
 * @typedef {TaskView & {trajectory: {messages: Message[]},
 * evaluation_result: {success: boolean | null, score: number | null, reward: number | null, termination_reason: string | null,
 * check_results: {id: string, result: Json}[], cost_usd: number | null, cost_basis: Json, duration_seconds: number | null,
 * evaluation_note: Json, evaluated_reward_basis: Json, reward_breakdown: Json, usage: Json}}} RunView
 * @typedef {{annotation_id: string, task_run_id: string, kind: string, summary: string, labels: string[], details: Json,
 * message_sequences: number[], check_ids: string[], producer: {author?: string | null, model?: string | null,
 * created_at?: string | null, method?: Json}, source: Source, join_method: Json}} Annotation
 * @typedef {{domain: string, benchmark: string, version: string, model: string, outcome: string, scope: string, q: string,
 * analysis: string, cohorts: string, task: string, task_run: string, compare: string, page: number, view: string, tab: string,
 * m: string, sort: string, group: string, anchor: string, dimension: string, paper: string, record: string}} State
 */

/** @param {string} path @param {string | URL} root */
export function repositoryUrl(path, root) {
  if (typeof path !== 'string' || !path || /[\\%:?#]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid repository path: ${path}`);
  }
  const base = new URL(root);
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('Path leaves the repository');
  return url.href;
}

/** @param {string} path @param {string | URL} root */
export function viewUrl(path, root) {
  if (!path.startsWith('views/explorer/') || !path.endsWith('.json')) {
    throw new Error('Browser data must come from a generated explorer view.');
  }
  return repositoryUrl(path, root);
}

/** @param {Catalog} catalog @param {string | URL} root */
export function validateCatalog(catalog, root) {
  if (catalog.schema_version !== 1 || !Array.isArray(catalog.rows) || !catalog.cohorts || !catalog.coverage) {
    throw new Error('Unsupported explorer catalog. Rebuild it with tools/build_explorer.py.');
  }
  const ids = new Set();
  for (const row of catalog.rows) {
    if (typeof row.task_run_id !== 'string' || ids.has(row.task_run_id) || !Object.hasOwn(catalog.cohorts, row.cohort_id) || typeof row.reported !== 'boolean' || !Array.isArray(row.checks)) {
      throw new Error('Invalid or duplicate task run in explorer catalog.');
    }
    viewUrl(row.record_path, root);
    viewUrl(row.task_view_path, root);
    if (!Number.isSafeInteger(row.message_count) || row.message_count < 0) throw new Error('Invalid message count in explorer catalog.');
    if (row.policy_path !== null) viewUrl(row.policy_path, root);
    ids.add(row.task_run_id);
  }
  return catalog;
}

/** @param {Row[]} rows @param {Partial<State>} state */
export function selectRows(rows, state) {
  const query = (state.q ?? '').toLocaleLowerCase();
  const analysis = (state.analysis ?? '').toLocaleLowerCase();
  return rows.filter(row =>
    (state.scope === 'all' || row.reported) &&
    (!state.domain || row.domain === state.domain) &&
    (!state.benchmark || row.benchmark === state.benchmark) &&
    (!state.version || row.benchmark_version === state.version) &&
    (!state.model || row.evaluated_agent_model === state.model) &&
    (!state.outcome || (state.outcome === 'success' ? row.success === true : state.outcome === 'failure' ? row.success === false : row.success === null)) &&
    (!query || `${row.task_id} ${row.description}`.toLocaleLowerCase().includes(query)) &&
    (!analysis || row.analysis_text.toLocaleLowerCase().includes(analysis))
  );
}

/** @param {Row[]} rows */
export function summarize(rows) {
  return {total: rows.length, successes: rows.filter(row => row.success === true).length,
    failures: rows.filter(row => row.success === false).length, unknown: rows.filter(row => row.success === null).length,
    tasks: new Set(rows.map(row => row.task_key)).size};
}

/** @param {Check[]} checks */
export function summarizeChecks(checks) {
  const scoring = checks.filter(check => check.scored === true);
  return {
    scoring: {passed: scoring.filter(check => check.status === 'passed').length, failed: scoring.filter(check => check.status === 'failed').length,
      notEvaluated: scoring.filter(check => check.status === 'not_evaluated').length, total: scoring.length},
    excluded: checks.filter(check => check.scored === false).length,
    excludedPassed: checks.filter(check => check.scored === false && check.status === 'passed').length,
    unclassified: checks.filter(check => check.scored === null).length,
  };
}

/** Return plain text without changing or truncating expected values.
 * @param {TaskView['evaluation_criteria']['checks'][number]} check
 * @returns {{label: string, parameters: string}} */
export function checkSummary(check) {
  /** @type {Record<string, string>} */
  const kinds = {ASSERTION: 'Assertion', ACTION: 'Required action', DB: 'Database end state',
    COMMUNICATE: 'Required communication', ENV_ASSERTION: 'Environment condition', NL_ASSERTION: 'Natural-language condition'};
  const spec = check.specification;
  const kind = kinds[check.kind] ?? check.kind.replaceAll('_', ' ');
  if (typeof spec === 'string') return {label: kind, parameters: spec};
  const nameKey = ['type', 'func_name', 'name'].find(key => typeof spec[key] === 'string' && spec[key] !== '');
  const name = nameKey ? spec[nameKey] : kind;
  const text = String(name).replaceAll('_', ' ');
  const containers = ['params', 'arguments'].filter(key => Object.hasOwn(spec, key));
  return {
    label: text.charAt(0).toUpperCase() + text.slice(1),
    parameters: Object.entries(spec).filter(([key]) => key !== nameKey && key !== 'excluded')
      .flatMap(([key, value]) => {
        if (containers.length === 1 && key === containers[0] && value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
          return Object.entries(value).map(([name, parameter]) => `${name}: ${JSON.stringify(parameter)}`);
        }
        return [`${key.replaceAll('_', ' ')}: ${JSON.stringify(value)}`];
      }).join(' · '),
  };
}

/** Display diagnostic check progress without awarding partial benchmark credit.
 * @param {Pick<Row, 'success' | 'checks'>} row */
export function runDisplayStatus(row) {
  if (row.success === true) return 'passed';
  if (row.success === null) return 'unknown';
  const {passed, total} = summarizeChecks(row.checks).scoring;
  return passed > 0 && passed < total ? 'partial' : 'failed';
}

/** @param {Row[]} rows @param {string} by */
export function groupTaskRuns(rows, by) {
  if (!by) return [{key: '', label: '', rows}];
  const groups = new Map(/** @type {[string, {key: string, label: string, rows: Row[]}][]} */ ([]));
  for (const row of rows) {
    const label = by === 'model' ? row.evaluated_agent_model : by === 'domain' ? row.domain : by === 'task' ? `${row.domain} / ${row.task_id}` : row.success === true ? 'Success' : row.success === false ? 'Failure' : 'Unknown';
    const key = by === 'task' ? row.task_key : label;
    if (!groups.has(key)) groups.set(key, {key, label, rows: []});
    groups.get(key)?.rows.push(row);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, {numeric: true}));
}

/** Group display columns, not experimental conditions. Every cohort and task run stays distinct.
 * @param {Row[]} rows @param {Record<string, Cohort>} cohorts */
export function matrixColumns(rows, cohorts) {
  const columns = new Map(/** @type {[string, {model: string, version: string, sourceRole: string, dates: string[], cohortIds: string[]} ][]} */ ([]));
  for (const row of rows) {
    const dates = [...new Set(cohorts[row.cohort_id].source_dates)].sort();
    const key = JSON.stringify([row.evaluated_agent_model, row.benchmark_version, row.source_role, dates]);
    if (!columns.has(key)) columns.set(key, {model: row.evaluated_agent_model, version: row.benchmark_version, sourceRole: row.source_role, dates, cohortIds: []});
    const column = columns.get(key);
    if (column && !column.cohortIds.includes(row.cohort_id)) column.cohortIds.push(row.cohort_id);
  }
  return [...columns.values()];
}

/** @param {Row[]} rows @param {Partial<State>} state */
export function comparisonRows(rows, state) {
  // Outcome and commentary filters describe browsing, not comparison membership.
  return rows.filter(row => row.reported && row.source_role === 'primary-result' &&
    (!state.domain || row.domain === state.domain) && (!state.benchmark || row.benchmark === state.benchmark) &&
    (!state.version || row.benchmark_version === state.version));
}

/** @param {string} encoded @param {string[]} available @returns {string[]} */
export function selectCohortIds(encoded, available) {
  if (!encoded) return available;
  const selected = JSON.parse(encoded);
  if (!Array.isArray(selected) || selected.some(id => typeof id !== 'string' || !available.includes(id))) {
    throw new Error('The selected source cohorts are not available in this benchmark, release, and domain.');
  }
  return [...new Set(selected)];
}

/** @param {unknown} value @returns {string} */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(/** @type {Record<string, unknown>} */ (value)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** @param {Component[][]} lists */
export function compareComponents(lists) {
  const names = [...new Set(lists.flatMap(list => list.map(item => item.name)))].sort();
  return names.map(name => {
    const values = lists.map(list => list.find(item => item.name === name)?.value ?? null);
    const state = values.every(value => value === null) ? 'unrecorded' : values.some(value => value === null) ? 'missing'
      : new Set(values.map(canonical)).size === 1 ? 'equal' : 'different';
    return {name, state, values};
  });
}

/** @param {Row} left @param {Row} right @param {Record<string, Cohort>} cohorts */
export function compareTaskRuns(left, right, cohorts) {
  return {sameTask: left.task_key === right.task_key, inputs: compareComponents([left.task_components, right.task_components]),
    conditions: compareComponents([cohorts[left.cohort_id].condition_components, cohorts[right.cohort_id].condition_components])};
}

/** @param {Row[]} rows @param {Record<string, Cohort>} cohorts @param {string[]} cohortIds */
export function compareCohorts(rows, cohorts, cohortIds) {
  const ids = [...new Set(cohortIds)];
  const selected = rows.filter(row => row.reported && row.source_role === 'primary-result' && ids.includes(row.cohort_id));
  const groups = ids.map(id => ({cohort_id: id, rows: selected.filter(row => row.cohort_id === id)}));
  const result = {eligible: false, reason: '', commonTasks: 0, unrecorded: /** @type {string[]} */ ([]), excludedTasks: 0, groups: /** @type {ComparisonGroup[]} */ ([])};
  if (ids.length < 2 || groups.some(group => !group.rows.length)) return {...result, reason: 'Select at least two source cohorts with reported results.'};
  if (new Set(selected.map(row => canonical([row.benchmark, row.benchmark_version, row.domain]))).size !== 1) {
    return {...result, reason: 'Select one benchmark, release, and domain for a common-task comparison.'};
  }
  const conditions = compareComponents(ids.map(id => cohorts[id].condition_components));
  result.unrecorded = conditions.filter(item => item.state === 'unrecorded').map(item => item.name);
  const conflicts = conditions.filter(item => item.state === 'different' || item.state === 'missing');
  if (conflicts.length) return {...result, reason: `Recorded conditions differ or are missing on one side: ${conflicts.map(item => item.name).join(', ')}.`};
  const byTask = groups.map(group => {
    const tasks = new Map(/** @type {[string, Row[]][]} */ ([]));
    for (const row of group.rows) {
      if (!tasks.has(row.task_key)) tasks.set(row.task_key, []);
      tasks.get(row.task_key)?.push(row);
    }
    return tasks;
  });
  const union = new Set(byTask.flatMap(tasks => [...tasks.keys()]));
  const common = [...byTask[0].keys()].filter(key => byTask.every(tasks => tasks.has(key))).filter(key => {
    const components = compareComponents(byTask.flatMap(tasks => (tasks.get(key) ?? [])).map(row => row.task_components));
    result.unrecorded.push(...components.filter(item => item.state === 'unrecorded').map(item => item.name));
    return !components.some(item => item.state === 'different' || item.state === 'missing');
  });
  result.unrecorded = [...new Set(result.unrecorded)].sort();
  result.commonTasks = common.length;
  result.excludedTasks = union.size - common.length;
  if (!common.length) return {...result, reason: 'No shared tasks have matching recorded inputs.'};
  result.groups = groups.map((group, index) => {
    const taskRows = common.map(key => byTask[index].get(key) ?? []);
    const matched = taskRows.flat();
    const summary = summarize(matched);
    return {cohort_id: group.cohort_id, ...summary, availableTasks: byTask[index].size, excludedTasks: byTask[index].size - common.length,
      repetitions: {min: Math.min(...taskRows.map(items => items.length)), max: Math.max(...taskRows.map(items => items.length))},
      taskBalancedRate: summary.unknown ? null : taskRows.reduce((sum, items) => sum + items.filter(row => row.success === true).length / items.length, 0) / common.length,
      rewardBasisDifferences: matched.filter(row => row.reward_basis_differs).length};
  });
  result.eligible = true;
  return result;
}

// Pair only unique, preceding calls with the same recorded requestor. An ambiguous
// or orphaned result stays visible; its parent is never guessed from proximity.
/** @param {Message[]} messages @returns {Turn[]} */
export function conversationTurns(messages) {
  /** @type {Turn[]} */
  const turns = [];
  const calls = messages.flatMap(message => message.tool_calls.map(call => ({message, call, results: /** @type {Message[]} */ ([])})));
  const paired = new Set();
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    const candidates = calls.filter(entry => entry.call.id != null && entry.call.id === message.tool_call_id &&
      entry.message.sequence < message.sequence && (message.requestor == null || entry.call.requestor === message.requestor));
    if (candidates.length === 1) {
      candidates[0].results.push(message);
      paired.add(message);
    }
  }
  for (const message of messages) {
    if (paired.has(message)) continue;
    turns.push({message, calls: calls.filter(entry => entry.message === message)});
  }
  return turns;
}

/** @param {unknown} value */
export function argumentPayload(value) {
  if (typeof value !== 'string') return {text: JSON.stringify(value, null, 2) ?? 'Unrecorded', raw: JSON.stringify(value) ?? 'Unrecorded', parsed: true};
  try { return {text: JSON.stringify(JSON.parse(value), null, 2), raw: value, parsed: true}; }
  catch { return {text: value, raw: value, parsed: false}; }
}

/** @param {Row[]} rows @param {string} sort */
export function taskMatrix(rows, sort = '') {
  const groups = new Map(/** @type {[string, Row[]][]} */ ([]));
  for (const row of rows) {
    if (!groups.has(row.task_key)) groups.set(row.task_key, []);
    groups.get(row.task_key)?.push(row);
  }
  /** @param {Row[]} members */
  const disagreement = members => {
    const ids = [...new Set(members.map(row => row.cohort_id))];
    const rates = ids.map(id => {
      const known = members.filter(row => row.cohort_id === id && row.success !== null);
      return known.length ? known.filter(row => row.success).length / known.length : null;
    }).filter(rate => rate !== null);
    return rates.length > 1 ? Math.max(...rates) - Math.min(...rates) : 0;
  };
  return [...groups.values()].sort((a, b) => {
    const difference = sort === 'failed' ? b.filter(row => row.success === false).length - a.filter(row => row.success === false).length
      : sort === 'disagree' ? disagreement(b) - disagreement(a) : 0;
    return difference || a[0].task_id.localeCompare(b[0].task_id);
  });
}
