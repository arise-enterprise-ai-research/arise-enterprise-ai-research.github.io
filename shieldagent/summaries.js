import { node, renderText } from "./rendering.js";
import { bytes, title } from "./provenance.js";

const POLICY_INPUT = "construction/00_policy_input";
const EXTRACTION = "construction/01_policy_extraction";
const OPTIMIZATION = "construction/03_aspm_structure_optimization";
const CLUSTERING = "construction/04_action_based_aspm_clustering";
const LEARNING = "construction/05_aspm_weight_learning";
const DATASET = `${LEARNING}/simulated_pseudo_learning`;
const LARGE = 2 * 1024 * 1024;

function number(value, digits = 4) {
  return typeof value === "number" ? value.toFixed(digits) : "n/a";
}

function table(columns, rows) {
  const element = node("table", "summary-table");
  const head = node("tr");
  for (const column of columns) head.append(node("th", "", column));
  const thead = node("thead");
  thead.append(head);
  const body = node("tbody");
  for (const cells of rows) {
    const row = node("tr");
    for (const cell of cells) {
      const value = cell ?? "n/a";
      const numeric =
        typeof value === "number" || /^(-?\d[\d.]*|n\/a)$/.test(value);
      const data = node("td", numeric ? "number" : "");
      data.append(value);
      row.append(data);
    }
    body.append(row);
  }
  element.append(thead, body);
  const scroll = node("div", "table-scroll");
  scroll.append(element);
  return scroll;
}

function hash(value) {
  const code = node("code", "", value.slice(0, 12));
  code.title = value;
  return code;
}

// Return the summary of one construction stage from its saved records, or null.
export async function stageSummary(run, id, read, onFile) {
  const json = async (path) =>
    run.fileMap.has(path) ? (await read(path)).value : undefined;
  const open = (path, label = path.split("/").at(-1)) => {
    if (!run.fileMap.has(path)) return "";
    const button = node("button", "text-button", label);
    button.type = "button";
    button.title = path;
    button.addEventListener("click", () => onFile(path));
    return button;
  };
  const section = node("section", "stage-summary");
  section.append(node("h3", "", "Recorded results"));
  if (id === "policy_input") {
    const sources = await json(`${POLICY_INPUT}/sources.json`);
    if (!sources) return null;
    const rows = sources.documents.map((item) => {
      const files = node("span", "summary-links");
      files.append(
        open(`${POLICY_INPUT}/${item.raw_artifact}`, "Raw"),
        open(`${POLICY_INPUT}/${item.normalized_artifact}`, "Text"),
      );
      return [
        `${item.document_id} · ${item.organization}`,
        item.source_id ?? item.retrieval.path,
        `${title(item.retrieval.mode)}${item.retrieval.retrieved ? ` · ${item.retrieval.retrieved}` : ""}`,
        hash(item.raw_sha256),
        item.normalized_characters,
        files,
      ];
    });
    section.append(
      table(
        [
          "Document",
          "Source",
          "Retrieval",
          "Raw SHA-256",
          "Characters",
          "Files",
        ],
        rows,
      ),
    );
    for (const item of sources.documents)
      if (item.substitution)
        section.append(
          node(
            "p",
            "",
            `${item.document_id}: ${item.substitution.fabrication_id}. ${item.substitution.reason}`,
          ),
        );
    for (const item of sources.missing)
      section.append(
        node(
          "p",
          "",
          `Missing optional source ${item.source_id}: ${item.reason}`,
        ),
      );
    // Each document as GPT-4o received it: plain text, not JSON.
    for (const item of sources.documents) {
      const path = `${POLICY_INPUT}/${item.normalized_artifact}`;
      if (!run.fileMap.has(path)) continue;
      const text = (await read(path)).raw;
      const document = node("details", "policy-source");
      document.open = true;
      const links = node("span", "summary-links");
      if (item.url) {
        const link = node("a", "", "Original page");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        links.append(link);
      }
      links.append(
        open(
          `${POLICY_INPUT}/${item.raw_artifact}`,
          `Raw source (${bytes(item.raw_bytes)})`,
        ),
        open(path, "Text file"),
      );
      document.append(
        node(
          "summary",
          "",
          `${item.organization} · ${item.source_id ?? item.document_id} · ${item.normalized_characters} characters sent to GPT-4o`,
        ),
        links,
        node("p", "", item.evidence ?? ""),
        renderText(text, path),
      );
      section.append(document);
    }
    return section;
  }
  if (id === "policy_extraction") {
    const documents = await json("construction/policy_documents.json");
    if (!Array.isArray(documents)) return null;
    const rows = [];
    const warnings = [];
    for (const document of documents) {
      const directory = `${EXTRACTION}/${document.id}`;
      const validation = await json(`${directory}/validation.json`);
      if (!validation) continue;
      const files = node("span", "summary-links");
      files.append(
        validation.rejected_unsupported
          ? open(`${directory}/rejected.json`, "Rejected")
          : "",
        open(`${directory}/source_spans.json`, "Spans"),
      );
      rows.push([
        `${document.id} · ${document.organization}`,
        validation.parsed,
        validation.accepted,
        validation.rejected_unsupported,
        validation.failures.length,
        files,
      ]);
      if (validation.rejected_unsupported)
        warnings.push(
          node(
            "p",
            "detail-warning",
            `${validation.rejected_unsupported} of ${validation.parsed} policies of ${document.id} were rejected. Their descriptions are not spans of the document text under white-space normalization. They did not enter the ASPM.`,
          ),
        );
    }
    section.append(
      table(
        ["Document", "Parsed", "Accepted", "Unsupported", "Failures", "Files"],
        rows,
      ),
      ...warnings,
    );
    return section;
  }
  if (id === "ltl_rule_extraction") {
    const validation = await json(
      "construction/02_ltl_rule_extraction/validation.json",
    );
    if (!validation) return null;
    section.append(
      node(
        "p",
        "",
        `${validation.rules} rules were accepted. ${validation.failures.length} validation failures are recorded.`,
      ),
    );
    return section;
  }
  if (id === "refinement" || id === "pruning") {
    const summary = await json(`${OPTIMIZATION}/summary.json`);
    if (!summary) return null;
    section.append(
      table(
        [
          "Stop reason",
          "Iterations",
          "Accepted refinements",
          "Accepted merges",
        ],
        [
          [
            title(summary.stop_reason),
            `${summary.iterations_run} of ${summary.max_iterations}`,
            `${summary.accepted_refinements} of ${summary.refinement_budget}`,
            summary.accepted_merges,
          ],
        ],
      ),
    );
    return section;
  }
  if (id === "clustering") {
    const [clustering, coverage, circuits] = await Promise.all([
      json(`${CLUSTERING}/clustering.json`),
      json(`${CLUSTERING}/coverage.json`),
      json(`${CLUSTERING}/action_rule_circuits.json`),
    ]);
    if (!clustering || !coverage) return null;
    section.append(
      table(
        ["State predicates", "k", "After merge", "Components", "Circuits"],
        [
          [
            clustering.state_predicate_ids.length,
            clustering.number_of_clusters,
            clustering.number_of_clusters_after_merge,
            clustering.connected_components,
            Array.isArray(circuits) ? circuits.length : "n/a",
          ],
        ],
      ),
      node(
        "p",
        "",
        `${coverage.rules_in_no_circuit.length} rules are in no circuit. ${coverage.rules_attached_directly.length} rules without a state predicate are attached directly to their actions.`,
      ),
    );
    return section;
  }
  if (id === "training_dataset") {
    const manifest = await json(`${DATASET}/manifest.json`);
    const file = run.fileMap.get(`${LEARNING}/training_data.json`);
    const dataset =
      file && file.size <= LARGE
        ? await json(`${LEARNING}/training_data.json`)
        : undefined;
    if (!manifest && !dataset) return null;
    if (dataset) {
      const splits = {};
      for (const trajectory of dataset.trajectories)
        splits[trajectory.split] = (splits[trajectory.split] ?? 0) + 1;
      section.append(
        node(
          "p",
          "",
          `Origin: ${title(dataset.origin)}. ${dataset.trajectories.length} trajectories: ${Object.entries(
            splits,
          )
            .map(([split, count]) => `${count} ${split}`)
            .join(", ")}.`,
        ),
      );
    }
    if (!manifest) return section;
    const reasons = new Map();
    await Promise.all(
      manifest.circuits.map(async (circuit) => {
        const records = await json(
          `${DATASET}/circuits/${circuit.action_predicate_id}/rejected.jsonl`,
        );
        for (const record of records ?? []) {
          const reason = record.reason.split(/[:\n]/)[0];
          reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        }
      }),
    );
    section.append(
      node(
        "p",
        "",
        `${manifest.underrepresented_circuits.length} of ${manifest.circuits.length} circuits have fewer accepted groups than the ${manifest.budget.scenario_groups_per_circuit} requested for each circuit. The scenarios and labels are fabricated content.`,
      ),
      table(
        ["Rejection reason", "Variants"],
        [...reasons].sort((a, b) => b[1] - a[1]),
      ),
      table(
        [
          "Circuit",
          "Requested groups",
          "Accepted groups",
          "Accepted",
          "Rejected",
        ],
        manifest.circuits.map((circuit) => {
          const directory = `${DATASET}/circuits/${circuit.action_predicate_id}`;
          return [
            open(
              run.fileMap.has(`${directory}/rejected.jsonl`)
                ? `${directory}/rejected.jsonl`
                : `${directory}/accepted.jsonl`,
              circuit.action_predicate_id,
            ) || circuit.action_predicate_id,
            circuit.requested_groups,
            circuit.accepted_groups,
            circuit.accepted,
            circuit.rejected,
          ];
        }),
      ),
    );
    return section;
  }
  if (id === "weight_learning") {
    const report = await json(`${LEARNING}/report.json`);
    if (!report) return null;
    const trained = report.circuits.filter(
      (circuit) => circuit.status === "trained",
    ).length;
    section.append(
      node(
        "p",
        "",
        `Weight status: ${title(report.weight_status)}. ${trained} of ${report.circuits.length} circuits were trained. ${report.note}`,
      ),
      table(
        [
          "Circuit",
          "Status",
          "Train examples",
          "Final train loss",
          "Loss at zero weights",
          "Weight change",
          "Train P(execute)",
        ],
        report.circuits.map((circuit) => [
          open(
            `${LEARNING}/circuits/${circuit.action_predicate_id}/status.json`,
            circuit.action_predicate_id,
          ) || circuit.action_predicate_id,
          title(circuit.status),
          circuit.eligible_examples.train,
          number(circuit.final_train_loss),
          number(circuit.loss_at_zero_weights),
          number(circuit.weight_change_norm),
          number(circuit.after_training?.train?.mean_probability_execute, 3),
        ]),
      ),
    );
    return section;
  }
  return null;
}
