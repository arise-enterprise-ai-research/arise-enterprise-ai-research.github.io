import { node, renderJSON } from "./rendering.js";
import { STAGES, title } from "./provenance.js";

// The stages of run.json, in the order that the construction runs them.
const RECORD_STAGES = [
  "sources",
  "policy_extraction",
  "ltl_rule_extraction",
  "aspm_structure_optimization",
  "expert_review",
  "action_based_aspm_clustering",
  "aspm_weight_learning",
];
const RECORDS = [
  ["construction_report.md", "Construction report"],
  ["run.json", "Run record"],
  ["fabrications.jsonl", "Fabrications"],
  ["missing_information.json", "Missing information"],
  ["prompt_manifest.json", "Prompt manifest"],
  ["construction/model_usage.json", "Model usage"],
  ["construction/stage_status.jsonl", "Stage log"],
];
const CONTENT = {
  source_document: "Source document text, normalized by recorded rules",
  model_output: "Validated model output of this run",
  computed_run_output: "Deterministic computation of this run",
  expert_review: "Corrections that a named expert supplied",
  simulated_pseudo_learning: "Simulated pseudo-learning data",
  supplied_dataset: "Trajectories that the caller supplied",
};
const SIDECAR = /\.metadata\.json$/;

function shortID(id) {
  const value = node("code", "artifact-id", String(id).slice(0, 19));
  value.title = id;
  return value;
}

function fileButton(path, onFile, label = path) {
  const button = node("button", "text-button", label);
  button.type = "button";
  button.title = path;
  button.addEventListener("click", () => onFile(path));
  return button;
}

function facts(entries) {
  const list = node("dl", "lineage-facts");
  for (const [term, value] of entries) {
    const detail = node("dd");
    detail.append(value);
    list.append(node("dt", "", term), detail);
  }
  return list;
}

// Read the sidecars, fabrications, and missing information of one run.
export async function readLineage(run, readArtifact) {
  const value = async (path, fallback) =>
    run.fileMap.has(path)
      ? ((await readArtifact(path)).value ?? fallback)
      : fallback;
  const sidecars = run.artifacts
    .map((file) => file.path)
    .filter((path) => SIDECAR.test(path));
  const records = await Promise.all(
    sidecars.map(async (sidecar) => ({
      ...(await value(sidecar, {})),
      sidecar,
      path: sidecar.replace(SIDECAR, ".json"),
    })),
  );
  const byID = new Map(records.map((record) => [record.artifact_id, record]));
  const fabrications = new Map(
    (await value("fabrications.jsonl", [])).map((item) => [item.id, item]),
  );
  return {
    records,
    byID,
    fabrications,
    missing: await value("missing_information.json", []),
  };
}

// The length of the longest parent path of each stage output. A saved record
// that names itself as an ancestor counts as a first output.
function depths(lineage) {
  const memo = new Map();
  const depth = (record) => {
    if (!memo.has(record.artifact_id)) {
      memo.set(record.artifact_id, 0);
      const parents = (record.parents ?? [])
        .map((id) => lineage.byID.get(id))
        .filter(Boolean);
      if (parents.length)
        memo.set(record.artifact_id, 1 + Math.max(...parents.map(depth)));
    }
    return memo.get(record.artifact_id);
  };
  return depth;
}

function fabrication(record) {
  const box = node("details", "fabrication");
  const summary = node("summary");
  summary.append(
    node("code", "", record.id),
    node("span", "", `${record.component} · ${record.field}`),
  );
  if (!record.fabricated)
    summary.append(node("span", "fabrication-tag", "Stated by a source"));
  box.append(
    summary,
    facts([
      ["Choice", record.reason],
      ...(record.replaces_missing
        ? [["Replaces", record.replaces_missing]]
        : []),
      ["Evidence checked", record.evidence_checked.join(" ")],
    ]),
    renderJSON(record.value, "Chosen value"),
  );
  return box;
}

function fabricationList(lineage, ids, heading) {
  const section = node("div", "lineage-group");
  section.append(node("h4", "", `${heading} (${ids.length})`));
  for (const id of ids) {
    const record = lineage.fabrications.get(id);
    section.append(
      record ? fabrication(record) : node("p", "", `${id} is not recorded.`),
    );
  }
  return section;
}

// The lineage of one stage output: its sidecar, parents, users, and fabrications.
export function lineagePanel(lineage, path, onFile) {
  const record = lineage.records.find(
    (item) => item.path === path || item.sidecar === path,
  );
  if (!record?.artifact_id) return null;
  // Closed by default, so that the artifact itself stays in view.
  const panel = node("details", "lineage-panel");
  panel.append(
    node(
      "summary",
      "",
      `Lineage · ${record.artifact_type} · ${(record.fabrication_ids ?? []).length} recorded choices`,
    ),
  );
  const parents = (record.parents ?? []).map((id) => ({
    id,
    record: lineage.byID.get(id),
  }));
  const parentList = node("div", "lineage-links");
  for (const parent of parents)
    parentList.append(
      parent.record
        ? fileButton(parent.record.path, onFile)
        : node("span", "", `${parent.id.slice(0, 19)} · an earlier run`),
    );
  const users = node("div", "lineage-links");
  for (const item of lineage.records)
    if (item.parents?.includes(record.artifact_id))
      users.append(fileButton(item.path, onFile));
  const correspondence = record.paper_correspondence ?? {};
  panel.append(
    facts([
      ["Artifact ID", shortID(record.artifact_id)],
      [
        "Content",
        `${CONTENT[record.content_origin] ?? record.content_origin}.${record.fabricated_content ? " Fabricated content." : ""}`,
      ],
      [
        "Paper",
        `${correspondence.location}. ${correspondence.exact_experiment_reproduction ? "Exact reproduction." : "Not an exact reproduction of the experiment."}`,
      ],
      [
        "Semantic check",
        record.semantic_verification === "not_established"
          ? "Not established. Validation checks syntax, references, and source spans. It does not show that a formula means what the policy text means."
          : record.semantic_verification,
      ],
      [
        "Parents",
        parents.length ? parentList : "None. This is a first stage output.",
      ],
      ["Used by", users.childNodes.length ? users : "No later stage output."],
      ["Sidecar", fileButton(record.sidecar, onFile)],
    ]),
  );
  // A fabrication of a parent applies here too. The rest enter at this stage.
  const inherited = new Set(
    parents.flatMap((parent) => parent.record?.fabrication_ids ?? []),
  );
  const ids = record.fabrication_ids ?? [];
  const resolved = parents.every((parent) => parent.record);
  if (resolved) {
    panel.append(
      fabricationList(
        lineage,
        ids.filter((id) => !inherited.has(id)),
        "Choices that enter at this stage",
      ),
      fabricationList(
        lineage,
        ids.filter((id) => inherited.has(id)),
        "Choices inherited from the parents",
      ),
    );
  } else
    panel.append(
      fabricationList(lineage, ids, "Recorded reproduction choices"),
    );
  const missing = lineage.missing.filter((item) =>
    item.replaced_by.some((id) => ids.includes(id)),
  );
  if (missing.length) {
    const group = node("div", "lineage-group");
    group.append(
      node(
        "h4",
        "",
        `Missing information behind these choices (${missing.length})`,
      ),
    );
    for (const item of missing) {
      const row = node("p");
      row.append(node("code", "", item.id), ` ${item.description}`);
      group.append(row);
    }
    panel.append(group);
  }
  return panel;
}

// Every stage output of the run, parents before the outputs that use them.
export function lineageChain(lineage, onFile) {
  const depth = depths(lineage);
  const records = lineage.records
    .filter((record) => record.artifact_id)
    .map((record) => ({ record, depth: depth(record) }))
    .sort(
      (a, b) => a.depth - b.depth || a.record.path.localeCompare(b.record.path),
    );
  const list = node("ol", "lineage-chain");
  for (const { record } of records) {
    const item = node("li");
    item.append(
      fileButton(record.path, onFile),
      node(
        "span",
        "muted",
        ` ${record.artifact_type} · ${record.fabrication_ids.length} recorded choices${record.fabricated_content ? " · fabricated content" : ""}`,
      ),
    );
    list.append(item);
  }
  return records.length ? list : null;
}

// The run.json stages with their outputs, and links to the run records.
export function recordPanel(run, onStage, onFile) {
  const record = run.record ?? {};
  if (!record.stages) return node("div");
  const section = node("section", "record-panel");
  section.append(node("h2", "", "Construction record"));
  const line = node("p");
  line.append(
    record.status
      ? `Run status: ${title(record.status)}.`
      : "The construction is running. Its run record is not written yet.",
  );
  if (record.parent_run_id)
    line.append(` It continues run ${record.parent_run_id}.`);
  section.append(line);
  const table = node("table", "record-stages");
  const head = node("tr");
  for (const label of ["Stage", "Status", "Output or reason"])
    head.append(node("th", "", label));
  const rows = node("tbody");
  for (const key of RECORD_STAGES) {
    const item = record.stages[key];
    if (!item) continue;
    const viewerStage = STAGES.find((stage) => stage.record === key);
    const name = node("button", "text-button", title(key));
    name.type = "button";
    name.addEventListener("click", () => onStage(viewerStage.id));
    const detail = node("td");
    if (typeof item.detail === "string" && item.detail.startsWith("sha256:"))
      detail.append(shortID(item.detail));
    else detail.append(item.detail ?? "");
    const row = node("tr", `record-${item.status}`);
    const cell = node("td");
    cell.append(name);
    row.append(cell, node("td", "", title(item.status)), detail);
    rows.append(row);
  }
  const thead = node("thead");
  thead.append(head);
  table.append(thead, rows);
  const links = node("div", "record-links");
  for (const [path, label] of RECORDS)
    if (run.fileMap.has(path)) links.append(fileButton(path, onFile, label));
  section.append(table, links);
  if (record.inputs) {
    const hashes = node("details");
    hashes.append(
      node("summary", "", "Input hashes"),
      renderJSON(record.inputs, "Inputs"),
    );
    section.append(hashes);
  }
  return section;
}
