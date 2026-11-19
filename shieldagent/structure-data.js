const OPTIMIZATION = "construction/03_aspm_structure_optimization";
const CLUSTERING = "construction/04_action_based_aspm_clustering";

export const GRAPH_STAGES = new Set([
  "all",
  "ltl_rule_extraction",
  "refinement",
  "pruning",
  "embeddings",
  "clustering",
  "weight_learning",
  "shielding_plan",
  "formal_verify",
]);

export function structureOptions(run, stage) {
  const options = [];
  const add = (path, label, kind = "aspm", extra = {}) => {
    if (run.fileMap.has(path)) options.push({ path, label, kind, ...extra });
  };
  if (["all", "ltl_rule_extraction"].includes(stage))
    add("construction/02_ltl_rule_extraction/aspm.json", "Extracted ASPM");
  if (["all", "refinement", "pruning"].includes(stage)) {
    let before = `${OPTIMIZATION}/initial/aspm.json`;
    const snapshots = [...run.fileMap.keys()].filter((path) =>
      /iteration_\d+_(verifiability_refinement|redundancy_pruning)\/aspm\.json$/.test(
        path,
      ),
    );
    snapshots.sort(
      (a, b) =>
        Number(a.match(/iteration_(\d+)/)[1]) -
          Number(b.match(/iteration_(\d+)/)[1]) ||
        Number(a.includes("redundancy_pruning")) -
          Number(b.includes("redundancy_pruning")),
    );
    for (const path of snapshots) {
      const [, iteration, component] = path.match(
        /iteration_(\d+)_(.+)\/aspm\.json$/,
      );
      const isPruning = component === "redundancy_pruning";
      if (
        stage === "all" ||
        (isPruning ? stage === "pruning" : stage === "refinement")
      ) {
        add(
          path,
          `Iteration ${Number(iteration) + 1} · ${isPruning ? "Pruning" : "Refinement"}`,
          "optimization",
          {
            before,
            directory: path.slice(0, -10),
            isPruning,
          },
        );
      }
      before = path;
    }
  }
  if (["all", "clustering", "embeddings"].includes(stage)) {
    if (stage !== "embeddings")
      add(
        `${CLUSTERING}/adjacency_matrix.json`,
        "State graph · saved adjacency",
        "matrix",
        { matrix: "adjacency" },
      );
    add(
      `${CLUSTERING}/similarity_matrix.json`,
      "State similarity matrix",
      "matrix",
      { matrix: "similarity" },
    );
    if (stage !== "embeddings")
      add(
        `${CLUSTERING}/action_rule_circuits.json`,
        "Action-based circuits · before training",
        "circuits",
      );
  }
  if (["all", "weight_learning"].includes(stage))
    add("construction/aspm.json", "Trained action circuits", "circuits");
  if (["all", "shielding_plan", "formal_verify"].includes(stage))
    add("inputs/aspm.json", "ASPM supplied to shielding", "aspm");
  return options;
}

export async function loadStructure(option, read, fileMap) {
  const get = async (path) => {
    const artifact = await read(path);
    if (artifact.warning || artifact.value === undefined)
      throw new Error(
        `${path}: ${artifact.warning || "No JSON data was recorded."}`,
      );
    return artifact.value;
  };
  const optional = (path, fallback) =>
    fileMap.has(path) ? get(path) : fallback;
  const data = await get(option.path);
  if (option.kind === "optimization") {
    const eventsPath = `${option.directory}/events.jsonl`;
    const clustersPath = `${option.directory}/clusters.json`;
    const decisionsPath = `${OPTIMIZATION}/${option.isPruning ? "redundancy_pruning" : "verifiability_refinement"}/decisions.jsonl`;
    const [before, events, clusters, decisions] = await Promise.all([
      get(option.before),
      optional(eventsPath, []),
      optional(clustersPath, []),
      optional(decisionsPath, []),
    ]);
    return {
      before: aspm(before, option.before),
      beforePath: option.before,
      after: aspm(data, option.path),
      events,
      eventsPath,
      clusters,
      clustersPath,
      decisions,
      decisionsPath,
    };
  }
  if (option.kind === "matrix") {
    const metadataPath = `${CLUSTERING}/clustering.json`;
    const clustersPath = `${CLUSTERING}/clusters_after_merge.json`;
    const modelPath = `${OPTIMIZATION}/aspm.json`;
    const [metadata, clusters, model] = await Promise.all([
      get(metadataPath),
      optional(clustersPath, null),
      get(modelPath),
    ]);
    const ids = metadata.state_predicate_ids;
    if (
      !Array.isArray(ids) ||
      !Array.isArray(data) ||
      data.length !== ids.length ||
      data.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== ids.length ||
          row.some((value) => !Number.isFinite(value)),
      )
    )
      throw new Error(
        "The matrix dimensions or numeric values do not match the recorded predicate order.",
      );
    return {
      matrix: data,
      ids,
      metadata,
      metadataPath,
      clusters,
      clustersPath,
      model: aspm(model, modelPath),
      modelPath,
    };
  }
  if (option.kind === "circuits") {
    const modelPath = Array.isArray(data)
      ? `${OPTIMIZATION}/aspm.json`
      : option.path;
    const model = aspm(
      Array.isArray(data) ? await get(modelPath) : data,
      modelPath,
    );
    return {
      model,
      modelPath,
      circuits: Array.isArray(data) ? data : model.action_rule_circuits,
    };
  }
  return { model: aspm(data, option.path) };
}

function aspm(value, path) {
  const model = value?.aspm;
  if (!Array.isArray(model?.predicates) || !Array.isArray(model?.rules))
    throw new Error(
      `${path}: expected a saved ASPM with predicates and rules.`,
    );
  const records = [...model.predicates, ...model.rules];
  if (
    records.some((record) => typeof record.id !== "string") ||
    new Set(records.map((record) => record.id)).size !== records.length
  )
    throw new Error(`${path}: graph records need unique IDs.`);
  return model;
}

export function graphNode(record, kind, path, extra = {}) {
  return {
    data: {
      id: record.id,
      label: kind === "rule" ? record.id : (record.name ?? record.id),
      kind,
      record,
      path,
      ...extra,
    },
  };
}

export function modelGraph(model, path, previous = null) {
  const old = new Map(
    [...(previous?.predicates ?? []), ...(previous?.rules ?? [])].map(
      (record) => [record.id, record],
    ),
  );
  const nodes = [
    ...model.predicates.map((p) => graphNode(p, p.type, path)),
    ...model.rules.map((r) => graphNode(r, "rule", path)),
  ];
  const ids = new Set(nodes.map(({ data }) => data.id));
  for (const item of nodes) {
    const prior = old.get(item.data.id);
    item.data.change = !previous
      ? ""
      : !prior
        ? "added"
        : JSON.stringify(prior) !== JSON.stringify(item.data.record)
          ? "modified"
          : "";
  }
  const edges = model.rules.flatMap((rule) =>
    rule.predicate_ids.map((id) => {
      if (!ids.has(id))
        throw new Error(`Rule ${rule.id} references missing predicate ${id}.`);
      return {
        data: {
          id: `use:${rule.id}:${id}`,
          source: rule.id,
          target: id,
          relation: "uses",
          path,
          record: { rule_id: rule.id, predicate_id: id },
        },
      };
    }),
  );
  return [...nodes, ...edges];
}

export function changeSummary(before, after) {
  const count = (name) => {
    const old = new Map(before[name].map((item) => [item.id, item]));
    const next = new Map(after[name].map((item) => [item.id, item]));
    return {
      added: after[name].filter((item) => !old.has(item.id)).length,
      removed: before[name].filter((item) => !next.has(item.id)).length,
      modified: after[name].filter(
        (item) =>
          old.has(item.id) &&
          JSON.stringify(old.get(item.id)) !== JSON.stringify(item),
      ).length,
    };
  };
  return { predicates: count("predicates"), rules: count("rules") };
}

export function decisionGraph(event, data) {
  const update = event.update;
  // Intermediate IDs can exist only in accepted events, not in either pass snapshot.
  const current = { predicates: new Map(), rules: new Map() };
  const paths = new Map();
  for (const type of ["predicates", "rules"]) {
    for (const record of data.before[type]) {
      current[type].set(record.id, record);
      paths.set(record.id, data.beforePath);
    }
  }
  for (const prior of data.events) {
    if (prior === event) break;
    if (prior.outcome !== "accepted") continue;
    for (const [type, singular] of [
      ["predicates", "predicate"],
      ["rules", "rule"],
    ]) {
      for (const id of prior.update[`removed_${singular}_ids`])
        current[type].delete(id);
      for (const record of prior.update[`replacement_${type}`]) {
        current[type].set(record.id, record);
        paths.set(record.id, data.eventsPath);
      }
    }
  }
  const known = current.predicates;
  const before = event.replaced ?? { predicates: [], rules: [] };
  const after = {
    predicates: update?.replacement_predicates ?? [],
    rules: update?.replacement_rules ?? [],
  };
  const changed =
    [...before.predicates, ...before.rules, ...after.predicates, ...after.rules]
      .length > 0;
  if (!changed) {
    const ids = new Set(event.cluster ?? update?.input_predicate_ids ?? []);
    const ruleIds = new Set(update?.input_rule_ids ?? [event.rule_id]);
    const rules = [...current.rules.values()].filter((rule) =>
      ruleIds.has(rule.id),
    );
    rules.forEach((rule) => rule.predicate_ids.forEach((id) => ids.add(id)));
    const graph = modelGraph(
      {
        rules,
        predicates: [...known.values()].filter((p) => ids.has(p.id)),
      },
      data.eventsPath,
    );
    for (const { data: record } of graph)
      record.path = paths.get(record.record.id ?? record.record.rule_id);
    const drawn = new Set(
      graph.filter((item) => !item.data.source).map((item) => item.data.id),
    );
    const candidate = data.clusters.find((cluster) =>
      event.cluster?.every((id) => cluster.predicate_ids.includes(id)),
    );
    if (candidate) {
      candidate.predicate_ids.forEach((from, i) =>
        candidate.predicate_ids.slice(i + 1).forEach((to, offset) => {
          if (!drawn.has(from) || !drawn.has(to)) return;
          graph.push({
            data: {
              id: `candidate:${i}:${offset}`,
              source: from,
              target: to,
              relation: "candidate",
              label: `similarity ${candidate.similarities[i][i + offset + 1].toFixed(3)}`,
              path: data.clustersPath,
              record: candidate,
              field: "similarities",
            },
          });
        }),
      );
    }
    return graph;
  }
  const graph = [];
  for (const [side, model] of [
    ["before", before],
    ["proposed", after],
  ]) {
    const predicates = new Map(model.predicates.map((p) => [p.id, p]));
    for (const rule of model.rules)
      for (const id of rule.predicate_ids) {
        if (!predicates.has(id) && known.has(id))
          predicates.set(id, known.get(id));
      }
    const part = modelGraph(
      { predicates: [...predicates.values()], rules: model.rules },
      data.eventsPath,
    );
    for (const item of part) {
      const d = item.data;
      d.id = `${side}:${d.id}`;
      if (d.source) {
        d.source = `${side}:${d.source}`;
        d.target = `${side}:${d.target}`;
      } else {
        const context =
          !model.predicates.some((record) => record.id === d.record.id) &&
          d.kind !== "rule";
        if (context) d.path = paths.get(d.record.id);
        d.side = side;
        d.label = `${context ? "Unchanged" : side === "before" ? "Before" : event.outcome === "accepted" ? "Accepted" : "Proposed"}\n${d.label}`;
      }
    }
    graph.push(...part);
  }
  const ids = new Set(
    graph.filter((item) => !item.data.source).map((item) => item.data.id),
  );
  for (const [from, replacements] of update?.id_map ?? [])
    for (const to of replacements) {
      if (ids.has(`before:${from}`) && ids.has(`proposed:${to}`))
        graph.push({
          data: {
            id: `replacement:${from}:${to}`,
            source: `before:${from}`,
            target: `proposed:${to}`,
            relation: "replacement",
            label:
              event.outcome === "accepted" ? "replaced by" : "proposal only",
            path: data.eventsPath,
            record: { outcome: event.outcome, from, to },
            field: "update.id_map",
          },
        });
    }
  return graph;
}

export function formulaGraph(rule, model, path) {
  const predicates = new Map(model.predicates.map((p) => [p.id, p]));
  const graph = [];
  const visit = (formula, id, parent) => {
    const predicate = predicates.get(formula.predicate_id);
    graph.push({
      data: {
        id,
        label:
          formula.operator === "ATOM"
            ? (predicate?.name ?? formula.predicate_id)
            : formula.operator,
        kind:
          formula.operator === "ATOM"
            ? (predicate?.type ?? "state")
            : "operator",
        record: formula,
        path,
      },
    });
    if (parent)
      graph.push({
        data: {
          id: `operand:${id}`,
          source: parent,
          target: id,
          relation: "operand",
          label: String(Number(id.split(":").at(-1)) + 1),
          record: formula,
          path,
        },
      });
    formula.operands.forEach((operand, i) => visit(operand, `${id}:${i}`, id));
  };
  visit(rule.formula, "formula", null);
  return graph;
}
