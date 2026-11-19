const POLICY_INPUT = "construction/00_policy_input";
const OPTIMIZATION = "construction/03_aspm_structure_optimization";
const REVIEW = `${OPTIMIZATION}/expert_review`;
const CLUSTERING = "construction/04_action_based_aspm_clustering";
const LEARNING = "construction/05_aspm_weight_learning";
const DATASET = `${LEARNING}/simulated_pseudo_learning`;

// "record" names the stage of run.json that a construction component belongs to.
// "prompts" names the saved prompts that the component sends to a model.
export const STAGES = [
  {
    id: "policy_input",
    name: "Policy input",
    record: "sources",
    description:
      "Read each declared source, keep its raw bytes and SHA-256, and normalize it to text. GPT-4o receives that text as plain text. policy_documents.json only stores the same text with its source details. An official text stands in for the corpus that the authors did not publish.",
    prefixes: [`${POLICY_INPUT}/`, "construction/policy_documents."],
    inputs: [`${POLICY_INPUT}/sources.json`],
    outputs: ["construction/policy_documents.json"],
  },
  {
    id: "policy_extraction",
    name: "Policy extraction",
    record: "policy_extraction",
    prompts: ["policy_extraction"],
    description:
      "Read policy documents as text and return structured policies as JSON with the Appendix H prompt. A policy description that is not a span of the document text is rejected.",
    prefixes: ["construction/01_policy_extraction/", "construction/policies."],
    inputs: ["construction/policy_documents.json"],
    outputs: ["construction/policies.json"],
  },
  {
    id: "ltl_rule_extraction",
    name: "LTL rule extraction",
    record: "ltl_rule_extraction",
    prompts: ["ltl_rule_extraction", "predicate_types"],
    description:
      "Extract logical rules and annotate action and state predicates.",
    prefixes: ["construction/02_ltl_rule_extraction/"],
    inputs: ["construction/policies.json"],
    outputs: [
      "construction/02_ltl_rule_extraction/aspm.json",
      "construction/02_ltl_rule_extraction/parsed_rules.json",
      "construction/02_ltl_rule_extraction/typed_predicates.json",
      "construction/02_ltl_rule_extraction/validation.json",
    ],
  },
  {
    id: "refinement",
    name: "Verifiability refinement",
    record: "aspm_structure_optimization",
    prompts: ["verifiability_refinement", "predicate_types"],
    description:
      "Refine rules into verifiable, atomic predicates. Each recorded decision and iteration remains inspectable.",
    prefixes: [`${OPTIMIZATION}/`],
    inputs: ["construction/02_ltl_rule_extraction/aspm.json"],
    outputs: [
      `${OPTIMIZATION}/aspm.json`,
      `${OPTIMIZATION}/summary.json`,
      `${OPTIMIZATION}/verifiability_refinement/decisions.jsonl`,
    ],
  },
  {
    id: "pruning",
    name: "Redundancy pruning",
    record: "aspm_structure_optimization",
    prompts: ["redundancy_pruning"],
    description:
      "Inspect similar predicates and remove or merge redundancy. A completed pass can accept zero merges.",
    prefixes: [`${OPTIMIZATION}/`],
    inputs: [],
    outputs: [
      `${OPTIMIZATION}/aspm.json`,
      `${OPTIMIZATION}/summary.json`,
      `${OPTIMIZATION}/redundancy_pruning/decisions.jsonl`,
    ],
  },
  {
    id: "embeddings",
    name: "Embedding model",
    description:
      "The recorded text inputs and returned vectors used by optimization and clustering. Embeddings do not contain reasoning text.",
    prefixes: [
      `${OPTIMIZATION}/embedding_texts.jsonl`,
      `${CLUSTERING}/similarity_matrix.json`,
    ],
    inputs: [`${OPTIMIZATION}/embedding_texts.jsonl`],
    outputs: [`${CLUSTERING}/similarity_matrix.json`],
  },
  {
    id: "expert_review",
    name: "Expert review",
    record: "expert_review",
    description:
      "Import corrections that a named expert supplied. Without a supplied review, the optimized structure continues unchanged. The paper does not publish its review.",
    prefixes: [`${REVIEW}/`],
    inputs: [`${OPTIMIZATION}/aspm.json`],
    outputs: [`${REVIEW}/aspm.json`],
  },
  {
    id: "clustering",
    name: "Action-based clustering",
    record: "action_based_aspm_clustering",
    description:
      "Build the state graph and organize rules into action-based circuits.",
    prefixes: [`${CLUSTERING}/`],
    inputs: [`${OPTIMIZATION}/aspm.json`],
    outputs: [
      `${CLUSTERING}/aspm.json`,
      `${CLUSTERING}/action_rule_circuits.json`,
      `${CLUSTERING}/clustering.json`,
      `${CLUSTERING}/coverage.json`,
    ],
  },
  {
    id: "training_dataset",
    name: "Training dataset",
    record: "aspm_weight_learning",
    prompts: [
      "pseudo_learning_scenarios",
      "pseudo_learning_grounding",
      "pseudo_learning_label_check",
    ],
    description:
      "Labeled trajectories for each circuit. In simulated pseudo-learning, GPT-4o writes scenarios from the source policies, a second call grounds them, and a third call checks each label. The trajectories and labels are fabricated content.",
    prefixes: [`${DATASET}/`, `${LEARNING}/training_data.`],
    inputs: [`${CLUSTERING}/aspm.json`, "construction/policies.json"],
    outputs: [`${LEARNING}/training_data.json`, `${DATASET}/manifest.json`],
  },
  {
    id: "weight_learning",
    name: "Weight learning",
    record: "aspm_weight_learning",
    description:
      "Learn the rule weights of each circuit with the hinge loss of Eq. 6 on the training split. A circuit without an eligible example stays untrained. This is separate from verifier fine-tuning.",
    prefixes: [
      `${LEARNING}/circuits/`,
      `${LEARNING}/report.json`,
      "construction/aspm.",
      "construction/stages.json",
    ],
    inputs: [`${LEARNING}/training_data.json`, `${CLUSTERING}/aspm.json`],
    outputs: [
      "construction/aspm.json",
      `${LEARNING}/report.json`,
      "construction/stages.json",
    ],
  },
  {
    id: "action_extraction",
    name: "Action extraction",
    prompts: ["action_extraction"],
    description:
      "Match the proposed action and history to the action catalogue.",
    prefixes: ["inputs/action_tree.json", "inputs/verification_input.json"],
    inputs: ["inputs/verification_input.json", "inputs/action_tree.json"],
    outputs: [],
  },
  {
    id: "shielding_plan",
    name: "Shielding plan",
    prompts: ["shielding_plan"],
    description:
      "Build verification plans for the relevant rules. Plans and retries are model outputs, not completed verification.",
    prefixes: [],
    inputs: ["inputs/aspm.json", "inputs/verification_input.json"],
    outputs: [],
  },
  {
    id: "tools",
    name: "Tools and verifiers",
    prompts: ["search_training", "binary_check_api", "factual_check"],
    description:
      "Inspect actual tool requests and results, including memory lookup, fact checks, Search, and Binary-Check.",
    prefixes: ["tool_library/"],
    inputs: ["tool_library/factual_check/sources.json"],
    outputs: [],
  },
  {
    id: "formal_verify",
    name: "Formal verification",
    prompts: ["shielding_code"],
    description:
      "Inspect generated shielding code and solver results in the executed and non-executed worlds. A tool response can report an unresolved obligation.",
    prefixes: ["formal_verify/", "shielding_code_generation/"],
    inputs: [],
    outputs: ["formal_verify/results.jsonl"],
  },
  {
    id: "guardrail_output",
    name: "Guardrail output",
    prompts: ["guardrail_output"],
    description:
      "A verdict exists only when verification and certification complete. A failed run is not a safe result.",
    prefixes: [],
    inputs: [],
    outputs: [],
  },
];

export function title(value) {
  return String(value ?? "Unknown")
    .replaceAll("_", " ")
    .replace(/\baspm\b/gi, "ASPM")
    .replace(/\bltl\b/gi, "LTL")
    .replace(/^./, (c) => c.toUpperCase());
}

export function duration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "--";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function bytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function callKind(step) {
  if (step.operation === "model_call") return "model";
  if (step.operation === "embedding_call") return "embedding";
  if (step.module === "tool_library") return "tool";
  return "pipeline";
}

export function normalizeRun(raw) {
  const byStep = new Map();
  for (const event of raw.events) {
    if (typeof event.step !== "string") continue;
    const current = byStep.get(event.step) ?? {
      id: event.step,
      start_seq: event.seq,
    };
    Object.assign(current, event);
    if (event.event_type === "step_started") current.start_seq = event.seq;
    else current.end_seq = event.seq;
    byStep.set(event.step, current);
  }
  const steps = [...byStep.values()].sort((a, b) => a.start_seq - b.start_seq);
  const optimization = steps.filter(
    (step) => step.module === "aspm_structure_optimization",
  );
  for (const step of steps) {
    step.kind = callKind(step);
    step.status =
      !step.status || step.status === "started" ? "unfinished" : step.status;
    step.stage = stageFor(step, optimization);
    step.label =
      step.kind === "tool"
        ? String(step.operation ?? "Unknown tool").replace(/^invoke:/, "")
        : title(step.module);
  }
  const terminal = raw.events.findLast(
    (event) =>
      event.event_type === "run_failed" || event.event_type === "run_succeeded",
  );
  const status = raw.report.status ?? terminal?.status ?? "unfinished";
  return {
    ...raw,
    steps,
    status,
    duration: terminal?.duration_ms,
    stopStage: status === "error" ? stopStage(raw.record, steps) : null,
    fileMap: new Map(raw.artifacts.map((file) => [file.path, file])),
  };
}

// The component where a failed run stopped. A run whose construction stages all
// completed stopped after construction, not in the component of its last call.
function stopStage(record, steps) {
  const lastCall = steps.findLast((step) => step.kind !== "pipeline");
  const stages = Object.entries(record?.stages ?? {});
  const failed = stages.find(([, item]) => item.status === "failed")?.[0];
  if (failed)
    return STAGES.some(
      (stage) => stage.record === failed && stage.id === lastCall?.stage,
    )
      ? lastCall.stage
      : STAGES.find((stage) => stage.record === failed).id;
  const construction = STAGES.some(
    (stage) => stage.record && stage.id === lastCall?.stage,
  );
  return stages.length && construction ? null : lastCall?.stage;
}

function stageFor(step, optimization) {
  if (step.module === "embedding_model") return "embeddings";
  if (step.module === "predicate_type_annotation") {
    return optimization.some(
      (parent) =>
        parent.start_seq < step.start_seq &&
        (parent.end_seq ?? Infinity) > step.start_seq,
    )
      ? "refinement"
      : "ltl_rule_extraction";
  }
  if (step.module === "verifiability_refinement") return "refinement";
  if (step.module === "redundancy_pruning") return "pruning";
  if (step.module === "aspm_training_pipeline") return "weight_learning";
  if (step.module === "simulated_pseudo_learning") return "training_dataset";
  if (
    step.module === "shielding_code" ||
    step.operation?.includes("verification_tool.verify_rule")
  )
    return "formal_verify";
  if (
    step.module === "tool_library" ||
    ["binary_check", "search", "factual_check"].includes(step.module)
  )
    return "tools";
  return step.module;
}

export function stageSteps(run, id) {
  if (id === "all") return run.steps;
  return run.steps.filter((step) => step.stage === id);
}

export function stageFiles(run, id) {
  if (id === "all") return run.artifacts;
  const stage = STAGES.find((item) => item.id === id);
  if (!stage) return [];
  const stepPrefixes = stageSteps(run, id).map((step) => `steps/${step.id}/`);
  return run.artifacts.filter((file) => {
    if (stepPrefixes.some((prefix) => file.path.startsWith(prefix)))
      return true;
    if (
      id === "pruning" &&
      file.path.includes("03_aspm_structure_optimization/")
    )
      return (
        file.path.includes("redundancy_pruning") ||
        file.path.endsWith("/summary.json") ||
        file.path === "construction/03_aspm_structure_optimization/aspm.json"
      );
    if (
      id === "refinement" &&
      file.path.includes("03_aspm_structure_optimization/")
    )
      return (
        !file.path.includes("redundancy_pruning") &&
        !file.path.startsWith(`${REVIEW}/`)
      );
    // A saved prompt template is not a record of a component that ran.
    const record = !file.path.startsWith("prompts/");
    if (
      id === "action_extraction" &&
      record &&
      file.path.includes("action_extraction")
    )
      return true;
    if (
      id === "shielding_plan" &&
      record &&
      file.path.includes("shielding_plan")
    )
      return true;
    if (
      id === "guardrail_output" &&
      file.path.endsWith("guardrail_output.json")
    )
      return true;
    return stage.prefixes.some((prefix) => file.path.startsWith(prefix));
  });
}

export function recordedStage(run, id) {
  const stage = STAGES.find((item) => item.id === id);
  return stage?.record ? run.record?.stages?.[stage.record] : undefined;
}

export function stageStatus(run, id) {
  const stage = STAGES.find((item) => item.id === id);
  const calls = stageSteps(run, id);
  const files = stageFiles(run, id);
  const recorded = recordedStage(run, id);
  if (run.stopStage === id)
    return { state: "error", label: "Run stopped here" };
  if (calls.some((call) => call.status === "error"))
    return { state: "error", label: "Failed call" };
  if (recorded?.status === "failed")
    return { state: "error", label: "Stage failed" };
  if (recorded?.status === "skipped")
    return { state: "absent", label: `Skipped · ${recorded.detail}` };
  if (calls.some((call) => call.status === "unfinished"))
    return { state: "pending", label: "Unfinished step" };
  if (recorded?.status === "started")
    return { state: "pending", label: "Running" };
  const count = calls.filter((call) => call.kind !== "pipeline").length;
  const prefix = count ? `${count} call${count === 1 ? "" : "s"} · ` : "";
  // The run status names the weight status of the trained model.
  if (id === "weight_learning" && recorded?.status === "completed")
    return {
      state: ["trained", "trained_with_recorded_fabricated_inputs"].includes(
        run.record.status,
      )
        ? "complete"
        : "pending",
      label: title(run.record.status ?? "completed"),
    };
  if (recorded?.status === "completed")
    return {
      state: "complete",
      label: prefix ? `${prefix}completed` : "Completed",
    };
  if (id === "policy_input" && files.length)
    return { state: "complete", label: "Input saved" };
  if (id === "guardrail_output")
    return {
      state: files.some((file) => file.path.endsWith("guardrail_output.json"))
        ? "complete"
        : "absent",
      label: files.some((file) => file.path.endsWith("guardrail_output.json"))
        ? "Verdict saved"
        : "No verdict recorded",
    };
  if (stage.outputs.some((path) => run.fileMap.has(path)))
    return {
      state: "complete",
      label: calls.length
        ? `${calls.length} calls · output saved`
        : "Output saved",
    };
  if (calls.length)
    return { state: "complete", label: `${calls.length} calls recorded` };
  if (files.length && files.every((file) => stage.inputs.includes(file.path)))
    return { state: "absent", label: "Inputs saved · not run" };
  if (files.length) return { state: "pending", label: "Partial artifacts" };
  return { state: "absent", label: "Not recorded" };
}

export function visibleReasoning(output) {
  const found = [];
  const seen = new Set();
  function collect(value, path = "response") {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (
        /^(reasoning|thinking|analysis|rationale|explanation|justification)$/i.test(
          key,
        ) &&
        typeof item === "string" &&
        item.trim()
      ) {
        if (!seen.has(item))
          found.push({ label: `${path}.${key}`, text: item });
        seen.add(item);
      } else if (typeof item === "object") collect(item, `${path}.${key}`);
    }
  }
  collect(output);
  if (typeof output?.text === "string") {
    for (const match of output.text.matchAll(/<think>([\s\S]*?)<\/think>/gi))
      found.push({ label: "Returned <think> text", text: match[1].trim() });
    try {
      collect(JSON.parse(output.text), "response.text");
    } catch {
      /* Plain response text is not a JSON rationale object. */
    }
  }
  return found;
}
