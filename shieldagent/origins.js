import { node } from "./rendering.js";

// The local server serves the paper PDF. A static export links the paper's page instead.
let paper = null;

export function setPaper(url) {
  paper = url;
}
const ORGANIZATION = "{organization (e.g. GitLab)}";
const LABELS = {
  paper: "Paper · verbatim",
  adapted: "Paper · adapted",
  reconstructed: "Reconstruction · not paper text",
  external: "External policy document",
  authored: "Repository-authored",
  synthetic: "Synthetic data",
  model: "AI/model output · this run",
  generated: "Run output · AI + code",
  computed: "Computed in this run",
  derived: "Viewer projection",
  mixed: "Mixed origins",
  runtime: "Runtime record",
  unknown: "Origin not established",
};

export function originBadge(kind) {
  return node("span", `origin-badge origin-${kind}`, LABELS[kind]);
}

export function promptOrigins(run) {
  const entries = [];
  const published = run.manifest.prompts?.appendix_h;
  for (const prompt of Array.isArray(published) ? published : []) {
    if (prompt?.origin !== "Appendix H") continue;
    for (const role of ["system", "user"])
      if (typeof prompt[role] === "string") {
        const words = prompt[role].trim().split(/\s+/);
        const verified = run.publishedPrompts?.some(
          (source) =>
            source.name === prompt.name &&
            source.source_page === prompt.source_page &&
            source[role] === prompt[role],
        );
        entries.push({
          kind: verified ? "paper" : "unknown",
          name: prompt.name,
          role,
          text: prompt[role],
          page: verified ? prompt.source_page : null,
          highlight: [words.slice(0, 10).join(" "), words.slice(-10).join(" ")],
          path: `prompts/published/${prompt.name}/${role}.txt`,
          description: verified
            ? "Exact match to the preserved Appendix H transcription and the template frozen in this run’s manifest. Wording and punctuation are preserved. PDF formatting and the authors’ original API request bytes are not available."
            : "The run declares an Appendix H source, but its text does not match the preserved paper transcription. It is not labeled verbatim.",
        });
      }
  }
  const implementation = run.manifest.prompts?.implementation;
  for (const prompt of Array.isArray(implementation) ? implementation : []) {
    if (prompt?.origin === "implementation" && typeof prompt.text === "string")
      entries.push({
        kind: "authored",
        name: prompt.name,
        text: prompt.text,
        path: `prompts/implementation/${prompt.name}.txt`,
        description: `This repository wrote this prompt. The paper does not publish its wording. Design reference: ${prompt.design_source ?? "not recorded"}.`,
      });
  }
  return entries;
}

function matchPrompt(run, text) {
  const prompts = promptOrigins(run);
  const exact = prompts.find((prompt) => prompt.text === text);
  if (exact) return exact;
  for (const prompt of prompts) {
    if (prompt.kind !== "paper" || !prompt.text.includes(ORGANIZATION))
      continue;
    const [prefix, suffix] = prompt.text.split(ORGANIZATION);
    if (!text.startsWith(prefix) || !text.endsWith(suffix)) continue;
    const replacement = text.slice(prefix.length, text.length - suffix.length);
    if (!replacement || replacement.includes("\n")) continue;
    return {
      ...prompt,
      kind: "adapted",
      description: `The published template is unchanged except for its organization placeholder, filled with “${replacement}”. The complete sent message is not verbatim. Open the saved template to compare.`,
      replacement,
    };
  }
  return null;
}

function declaredOrigin(value) {
  const source =
    typeof value?.source === "string" ? value.source : value?.provenance;
  const sourceURL =
    typeof source === "string" && source.match(/^https?:\/\/\S+/)?.[0];
  if (sourceURL)
    return {
      kind: "external",
      url: sourceURL,
      description: `Recorded policy source: ${source}. This is an external source document, not text published in the ShieldAgent paper. The source declaration does not establish the authors’ exact corpus.`,
    };
  if (typeof source === "string" && /^Reconstruct(?:ed|ion)/i.test(source))
    return {
      kind: "reconstructed",
      page: source.includes("Figure 15") ? 24 : null,
      highlight: source.includes("Figure 15")
        ? [
            "Rule 1: data_is_private",
            "Rule 9: NOT (user_consent AND user_account_owner IMPLIES NOT delete_account)",
          ]
        : null,
      description: `Repository reconstruction, not the authors’ original document. Recorded source: ${source}`,
    };
  if (
    value?.fabricated_content === true ||
    (typeof source === "string" && /PseudoLearning|synthetic/i.test(source))
  )
    return {
      kind: "synthetic",
      description: `Generated example data, not published measurements or an original database. Recorded source: ${source}`,
    };
  if (value?.source?.normalized_from && Array.isArray(value.source.figures))
    return {
      kind: "adapted",
      description:
        "Adapted from the paper’s example. This combines printed content with repository normalization, structure, and placeholders. It is not a wholly verbatim artifact. The source.limits field contains the example’s recorded caveats, not claims about newly generated outputs.",
    };
  return null;
}

export function messageOrigin(run, message, documents = []) {
  if (typeof message.content === "string") {
    const prompt = matchPrompt(run, message.content);
    if (prompt) return prompt;
    const document =
      message.role === "user" &&
      message.content.trim() &&
      documents.find(
        (document) =>
          typeof document.text === "string" &&
          document.text.includes(message.content),
      );
    if (document) {
      const origin = declaredOrigin(document);
      if (origin)
        return {
          ...origin,
          description: `This text matches the saved policy document or one of its chunks. ${origin.description}`,
        };
    }
    let value;
    try {
      value = JSON.parse(message.content);
    } catch {
      value = null;
    }
    const declared = declaredOrigin(value);
    if (declared) return declared;
    if (value && typeof value === "object")
      return {
        kind: "runtime",
        description:
          "Data assembled for this call. It can contain earlier model outputs, source excerpts, or repository metadata. It is not a published prompt. A citation inside the JSON does not establish verbatim wording.",
      };
  }
  return {
    kind: "runtime",
    description:
      "Message supplied to this recorded call. No published prompt match or source declaration establishes its original authorship. It is not labeled as paper text.",
  };
}

export function artifactOrigin(run, path, value, step = null) {
  if (path === "error.json" || path.endsWith("/error.json"))
    return {
      kind: "runtime",
      description:
        "Failure recorded by the runner, not a successful model response.",
    };
  const recordedStep =
    step ?? run.steps.find((item) => path.startsWith(`steps/${item.id}/`));
  const responseFile =
    /\/(output\.json|response\.json|response\.txt|raw_response\.txt)$/.test(
      path,
    );
  const messagesFile = `${path.slice(0, path.lastIndexOf("/"))}/messages.json`;
  if (
    responseFile &&
    (recordedStep?.kind === "model" || run.fileMap.has(messagesFile))
  )
    return {
      kind: "model",
      description:
        "Response recorded from this run’s model call, not an answer copied from the paper. The call metadata identifies its runner and model.",
    };
  if (path.startsWith("prompts/"))
    return (
      (typeof value === "string" && matchPrompt(run, value)) || {
        kind: "unknown",
        description:
          "This file does not match any prompt text saved in this run’s manifest. Its filename is not proof of paper origin.",
      }
    );
  if (
    Array.isArray(value?.messages) ||
    (Array.isArray(value) &&
      value.length &&
      value.every((item) => item?.role && "content" in item))
  )
    return {
      kind: "mixed",
      description:
        "Each message below has its own source label. A prompt’s source does not establish the source of its inputs or the model’s answer.",
    };
  if (path === "construction/policy_documents.json") {
    const docs = Array.isArray(value) ? value : [];
    const origins = docs.map(declaredOrigin);
    if (
      origins.length &&
      origins.every((origin) => origin?.kind === "reconstructed")
    )
      return {
        ...origins[0],
        description: origins.every((origin) => origin.page === 24)
          ? "All policy prose in this input is reconstructed. Figure 15 publishes logical rules, not these natural-language policy paragraphs or the authors’ source policy documents."
          : "All policy prose in this input is declared as reconstructed, not as the authors’ original source documents.",
      };
    if (
      origins.length &&
      origins.every((origin) => origin?.kind === "external")
    )
      return {
        kind: "external",
        description:
          "These are source policy documents, not extracted JSON policies. Each document records its URL and version or retrieval date. They are not claimed to be the authors’ exact policy corpus.",
      };
    return {
      kind: "unknown",
      description:
        "Input policy documents. Inspect each recorded source declaration. This filename does not establish that the documents came from the paper.",
    };
  }
  if (path.startsWith("construction/00_policy_input/raw/"))
    return {
      kind: "external",
      description:
        "Raw bytes of a declared policy source, downloaded or read from a preserved copy. sources.json records the URL, the retrieval mode, and the SHA-256. This is not text published in the ShieldAgent paper.",
    };
  if (path.startsWith("construction/00_policy_input/normalized/"))
    return {
      kind: "external",
      description:
        "Text of a declared policy source after the recorded normalization. Repository code converted the markup to text by the transformations that sources.json lists. This is not text published in the ShieldAgent paper.",
    };
  if (path === "construction/00_policy_input/sources.json")
    return {
      kind: "runtime",
      description:
        "Retrieval record of this run: source, retrieval mode and date, raw and normalized SHA-256, transformations, and the substitution that each source records.",
    };
  if (
    [
      "construction/model_usage.json",
      "construction/stage_status.jsonl",
      "construction/stages.json",
    ].includes(path)
  )
    return {
      kind: "runtime",
      description:
        "Recorded execution data of the construction. This is evidence of this run, not a quotation from the paper.",
    };
  if (path.endsWith(".metadata.json"))
    return {
      kind: "runtime",
      description:
        "Sidecar of a stage output, written by repository code. It names the content origin, the parent outputs, and the reproduction choices that the output depends on.",
    };
  if (["fabrications.jsonl", "missing_information.json"].includes(path))
    return {
      kind: "authored",
      description:
        "Reproduction records of this repository. They name each detail that the paper leaves unstated, the value this run uses, the reason, and the evidence checked.",
    };
  if (
    path.startsWith(
      "construction/05_aspm_weight_learning/simulated_pseudo_learning/",
    )
  )
    return {
      kind: "synthetic",
      description:
        "Simulated pseudo-learning record of this run. GPT-4o wrote these scenarios and labels from the policy text. They are fabricated content, not observed agent behavior or the authors’ data.",
    };
  const declared = declaredOrigin(value);
  if (declared) return declared;
  if (path === "construction/policies.json")
    return {
      kind: "generated",
      description:
        "Policy-extraction output from this run. The model returned policy_description, definition, scope, and references. The repository added identifiers and source metadata. References are not proof that every field appears in the paper.",
    };
  if (path.startsWith("construction/05_aspm_weight_learning/"))
    return {
      kind: "computed",
      description:
        "Training output or metadata produced in this run. Learned weights are not weights published by the authors. Training-data origin is recorded separately.",
    };
  if (
    [
      "construction/",
      "samples/",
      "shielding_code_generation/",
      "tool_library/",
      "formal_verify/",
    ].some((prefix) => path.startsWith(prefix))
  )
    return {
      kind: "generated",
      description:
        "Produced by this run’s pipeline using model responses and repository code. These records are not the paper’s printed graph or the authors’ released model.",
    };
  if (path === "manifest.json")
    return {
      kind: "mixed",
      description:
        "The manifest contains frozen published prompt transcriptions, repository-authored prompts, and runtime metadata. Prompt entries have separate origin declarations.",
    };
  if (
    path.startsWith("steps/") ||
    [
      "report.json",
      "configuration.json",
      "source_discrepancies.json",
      "events.jsonl",
      "run.json",
      "prompt_manifest.json",
      "construction_report.md",
    ].includes(path)
  )
    return {
      kind: "runtime",
      description:
        "Recorded execution data. This is evidence of this run, not a quotation from the paper.",
    };
  return {
    kind: "unknown",
    description:
      "This artifact has no verified paper-text match or recognized source declaration. No paper origin is inferred from its name or citations.",
  };
}

export async function readOrigin(run, path, readArtifact, step = null) {
  const payload = await readArtifact(path);
  if (
    path === "inputs/aspm.json" &&
    run.fileMap.has("construction/aspm.json")
  ) {
    const construction = await readArtifact("construction/aspm.json");
    if (payload.raw === construction.raw) {
      const origin = artifactOrigin(
        run,
        "construction/aspm.json",
        construction.value,
      );
      return {
        ...origin,
        description: `Exact saved copy of construction/aspm.json. ${origin.description}`,
      };
    }
  }
  return artifactOrigin(run, path, payload.value ?? payload.raw, step);
}

export function originPanel(info, run, onFile) {
  const panel = node("aside", `origin-panel origin-${info.kind}`);
  panel.setAttribute("aria-label", `Content origin: ${LABELS[info.kind]}`);
  panel.append(originBadge(info.kind), node("p", "", info.description));
  const links = node("div", "origin-links");
  if (info.url) {
    const link = node("a", "", "Original policy source");
    link.href = info.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    links.append(link);
  }
  if (
    paper &&
    Number.isInteger(info.page) &&
    info.page >= 1 &&
    info.page <= 32
  ) {
    const link = node("a", "", `Paper · page ${info.page}`);
    const highlight = info.highlight
      ?.map((text) => encodeURIComponent(text).replaceAll("-", "%2D"))
      .join(",");
    // Only a PDF opens at a page. A paper web page opens at its top.
    const pdf = paper.endsWith(".pdf");
    link.href = pdf
      ? `${paper}#page=${info.page}${highlight ? `:~:text=${highlight}` : ""}`
      : paper;
    link.title = pdf
      ? "Open the local paper. Supported browsers highlight the cited text."
      : `Open the paper's publication page. The cited text is on page ${info.page} of the PDF.`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    links.append(link);
  }
  if (info.path && run.fileMap.has(info.path)) {
    const link = node("button", "text-button", "Open saved template");
    link.type = "button";
    link.addEventListener("click", () => onFile(info.path));
    links.append(link);
  }
  if (links.childNodes.length) panel.append(links);
  return panel;
}

export function originFields(path, info) {
  let fields = [];
  if (path === "construction/policy_documents.json")
    fields = [
      [
        "text",
        info.kind,
        "The policy prose is an input, not an AI extraction result.",
      ],
      [
        "source, organization, identifiers",
        "authored",
        "Repository metadata. The source label is not a quotation.",
      ],
    ];
  else if (path === "construction/policies.json")
    fields = [
      [
        "policy_description, definition, scope, reference",
        "model",
        "Fields returned by policy extraction. They may copy input text or add model interpretations.",
      ],
      [
        "id, source document identifier",
        "authored",
        "Added by repository code. They do not appear in the paper.",
      ],
    ];
  if (!fields.length) return null;
  const table = node("table", "origin-fields");
  const caption = node("caption", "", "Origin by field");
  table.append(caption);
  const tbody = node("tbody");
  for (const [field, kind, description] of fields) {
    const row = node("tr");
    const heading = node("th", "", field);
    heading.scope = "row";
    const detail = node("td");
    detail.append(originBadge(kind), node("p", "", description));
    row.append(heading, detail);
    tbody.append(row);
  }
  table.append(tbody);
  return table;
}

export function originInventory(run, onFile) {
  const section = node("section", "origin-inventory");
  section.append(node("h2", "", "Content origins"));
  const legend = node("div", "origin-key");
  for (const kind of [
    "paper",
    "adapted",
    "reconstructed",
    "external",
    "authored",
    "model",
    "synthetic",
    "unknown",
  ])
    legend.append(originBadge(kind));
  section.append(
    legend,
    node(
      "p",
      "",
      "Labels distinguish published wording, reconstructed inputs, and outputs generated during this run. Citations alone do not make content verbatim.",
    ),
  );
  if (run.fileMap.has("construction/policy_documents.json")) {
    const link = node(
      "button",
      "text-button",
      "Inspect policy document origins",
    );
    link.type = "button";
    link.addEventListener("click", () =>
      onFile("construction/policy_documents.json"),
    );
    section.append(link);
  }
  const details = node("details");
  const prompts = promptOrigins(run);
  details.append(
    node(
      "summary",
      "",
      `${prompts.filter((p) => p.kind === "paper").length} saved paper prompt texts · ${prompts.filter((p) => p.kind === "authored").length} repository prompt texts`,
    ),
  );
  for (const prompt of prompts) {
    const row = node("div", "origin-catalog-row");
    row.append(originBadge(prompt.kind));
    const link = node(
      "button",
      "text-button",
      `${prompt.name} ${prompt.role ?? ""}${prompt.page ? ` · p. ${prompt.page}` : ""}`,
    );
    link.type = "button";
    link.disabled = !run.fileMap.has(prompt.path);
    link.addEventListener("click", () => onFile(prompt.path));
    row.append(link);
    details.append(row);
  }
  if (!prompts.length)
    details.append(
      node("p", "", "This run has no saved prompt-origin inventory."),
    );
  section.append(details);
  return section;
}
