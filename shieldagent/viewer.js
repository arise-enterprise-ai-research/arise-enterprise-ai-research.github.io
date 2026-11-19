import {
  errorMessage,
  fileURL,
  get,
  requestJSON,
  runURL,
  runsURL,
} from "./api.js";
import { node, renderJSON, renderSource, renderText } from "./rendering.js";
import {
  lineageChain,
  lineagePanel,
  readLineage,
  recordPanel,
} from "./lineage.js";
import { stageSummary } from "./summaries.js";
import { GRAPH_STAGES } from "./structure-data.js";
import { mountStructures } from "./structures.js";
import {
  readOrigin,
  artifactOrigin,
  messageOrigin,
  originBadge,
  originFields,
  originInventory,
  originPanel,
  promptOrigins,
  setPaper,
} from "./origins.js";
import {
  STAGES,
  bytes,
  duration,
  normalizeRun,
  recordedStage,
  stageFiles,
  stageStatus,
  stageSteps,
  title,
  visibleReasoning,
} from "./provenance.js";

const $ = (selector) => document.querySelector(selector);
const state = {
  run: null,
  runs: [],
  stage: "all",
  step: null,
  file: null,
  view: "timeline",
  detail: "output",
  cache: new Map(),
  runVersion: 0,
  detailVersion: 0,
  copy: "",
  structureRecord: null,
  publishedPrompts: [],
  lineage: null,
};
const params = new URLSearchParams(location.search);
const imageTypes = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
const kindLabels = {
  model: "AI call",
  tool: "Tool call",
  embedding: "Embedding",
  pipeline: "Pipeline",
};
let toastTimer;
let structureView;

function icon(kind = "file", className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  const shapes = {
    file: ["M5 2.5h6l4 4v11H5Z", "M11 2.5v4h4M8 10h4M8 13h4"],
    ok: ["m5 10 3.3 3.3L15 6.5"],
    error: ["M10 3 2.5 16h15ZM10 7v4M10 13.5v.2"],
    pending: ["M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14", "M10 6v4l3 2"],
  };
  for (const d of shapes[kind] ?? shapes.file) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function note(heading, text, error = false) {
  const box = node("div", `detail-note${error ? " error" : ""}`);
  box.append(node("strong", "", heading), node("p", "", text));
  return box;
}

function empty(heading, text) {
  const box = node("div", "empty-state");
  box.append(node("strong", "", heading), node("p", "", text));
  return box;
}

function notify(message) {
  const toast = $("#toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3500);
}

function artifactURL(path) {
  return fileURL(state.run.id, path);
}

function clearCache() {
  state.lineage = null;
  for (const item of state.cache.values())
    item.then(
      (value) => {
        if (value.imageURL) URL.revokeObjectURL(value.imageURL);
      },
      () => {},
    );
  state.cache.clear();
}

// The sidecars of the run are read once and shared by every lineage view.
function lineage() {
  state.lineage ??= readLineage(state.run, readArtifact);
  return state.lineage;
}

function hasLineage(path) {
  return (
    path.endsWith(".json") &&
    state.run.fileMap.has(
      path.replace(/(\.metadata)?\.json$/, ".metadata.json"),
    )
  );
}

// An unreadable sidecar must not hide the artifact or the component itself.
async function lineageView(render) {
  try {
    return render(await lineage());
  } catch (error) {
    state.lineage = null;
    return note(
      "Cannot read the lineage records",
      `${error.message} Refresh the run to read them again.`,
      true,
    );
  }
}

async function readArtifact(path) {
  if (!state.cache.has(path)) {
    const task = (async () => {
      const response = await get(artifactURL(path));
      if (!response.ok) throw new Error(await errorMessage(response));
      const buffer = await response.arrayBuffer();
      const extension = path.split(".").at(-1).toLowerCase();
      if (imageTypes[extension])
        return {
          imageURL: URL.createObjectURL(
            new Blob([buffer], { type: imageTypes[extension] }),
          ),
          raw: "",
          value: undefined,
        };
      let raw;
      try {
        raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        return { binary: true, raw: "", value: undefined };
      }
      if (raw.includes("\0"))
        return { binary: true, raw: "", value: undefined };
      let value;
      let warning = "";
      if (extension === "json" || extension === "jsonl") {
        try {
          value =
            extension === "jsonl"
              ? raw
                  .split("\n")
                  .filter((line) => line.trim())
                  .map((line) => JSON.parse(line))
              : JSON.parse(raw);
        } catch (error) {
          warning = `This artifact is not complete valid ${extension.toUpperCase()}. Its original text is shown. ${error.message}`;
        }
      }
      return { raw, value, warning };
    })();
    state.cache.set(path, task);
  }
  return state.cache.get(path);
}

function updateURL() {
  if (!state.run) return;
  const query = new URLSearchParams({ run: state.run.id });
  if (state.stage !== "all") query.set("stage", state.stage);
  if (state.step) query.set("step", state.step.id);
  if (state.file) query.set("file", state.file);
  query.set("view", state.view);
  query.set("tab", state.detail);
  history.replaceState(null, "", `?${query}`);
}

async function loadRuns(initial = false) {
  $("#refresh").disabled = true;
  try {
    const site = await requestJSON(runsURL());
    const runs = site.runs;
    state.publishedPrompts = site.published_prompts;
    setPaper(site.paper);
    const home = $("#home-link");
    home.hidden = !site.home;
    if (site.home) home.href = site.home;
    state.runs = runs;
    const select = $("#run-select");
    select.replaceChildren();
    for (const run of runs) {
      const date = run.started_at
        ? new Date(run.started_at).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : run.id;
      const option = node(
        "option",
        "",
        `${date} · ${title(run.command).replaceAll("-", " ")} · ${run.status === "error" ? "Incomplete" : run.status === "ok" ? "Complete" : "Unfinished"}`,
      );
      option.value = run.id;
      select.append(option);
    }
    select.disabled = !runs.length;
    if (!runs.length) {
      $("#workspace").hidden = true;
      const message = $("#app-message");
      message.hidden = false;
      message.replaceChildren(
        node("h1", "", "No saved runs yet"),
        node(
          "p",
          "",
          "Run an experiment, then refresh this viewer. Existing run folders are read without modification.",
        ),
        node("code", "", "uv run shieldagent paper-experiment"),
      );
      select.append(node("option", "", "No saved runs"));
      return;
    }
    const preferred = initial ? params.get("run") : state.run?.id;
    const selected = runs.find((run) => run.id === preferred)?.id ?? runs[0].id;
    select.value = selected;
    await loadRun(selected, initial);
  } catch (error) {
    if (state.run) notify(`Could not refresh: ${error.message}`);
    else {
      $("#app-message").replaceChildren(
        node("h1", "", "Cannot load saved runs"),
        node(
          "p",
          "",
          `${error.message} Check the local viewer process, then select Refresh.`,
        ),
      );
    }
  } finally {
    $("#refresh").disabled = false;
  }
}

async function loadRun(id, initial = false) {
  const version = ++state.runVersion;
  ++state.detailVersion;
  const previousStep = state.run?.id === id ? state.step?.id : null;
  const previousFile = state.run?.id === id ? state.file : null;
  const sameRun = state.run?.id === id;
  $("#detail-body").replaceChildren(
    node("p", "loading", "Reading run records…"),
  );
  try {
    const raw = await requestJSON(runURL(id));
    if (version !== state.runVersion) return;
    clearCache();
    state.run = {
      ...normalizeRun(raw),
      publishedPrompts: state.publishedPrompts,
    };
    if (initial) {
      state.stage = STAGES.some((stage) => stage.id === params.get("stage"))
        ? params.get("stage")
        : "all";
      state.detail = [
        "input",
        "output",
        "reasoning",
        "details",
        "raw",
      ].includes(params.get("tab"))
        ? params.get("tab")
        : "output";
    } else if (!sameRun) state.stage = "all";
    state.step =
      state.run.steps.find(
        (step) => step.id === (initial ? params.get("step") : previousStep),
      ) ?? null;
    state.file = state.run.fileMap.has(
      initial ? params.get("file") : previousFile,
    )
      ? initial
        ? params.get("file")
        : previousFile
      : null;
    if (state.file) state.step = null;
    if (
      initial &&
      !params.has("tab") &&
      state.file === "construction/policy_documents.json"
    )
      state.detail = "input";
    state.structureRecord = null;
    if (initial || !sameRun)
      state.view =
        initial &&
        ["timeline", "artifacts", "structure"].includes(params.get("view"))
          ? params.get("view")
          : GRAPH_STAGES.has(state.stage) && !state.step && !state.file
            ? "structure"
            : "timeline";
    $("#workspace").hidden = false;
    $("#app-message").hidden = true;
    $("#search").value = "";
    $("#kind-filter").value = "all";
    renderRun();
    renderActivity();
    await renderInspector();
    updateURL();
  } catch (error) {
    if (version !== state.runVersion) return;
    $("#workspace").hidden = true;
    $("#app-message").hidden = false;
    $("#app-message").replaceChildren(
      node("h1", "", "Cannot read this run"),
      node("p", "", `${error.message} Select another run or refresh.`),
    );
  }
}

function renderRun() {
  const run = state.run;
  $("#run-title").textContent = title(run.manifest.command).replaceAll(
    "-",
    " ",
  );
  $("#run-subtitle").textContent =
    `${run.manifest.started_at_utc ? new Date(run.manifest.started_at_utc).toLocaleString() : "Start time not recorded"} · ${run.id}`;
  const counts = { model: 0, embedding: 0, tool: 0 };
  for (const step of run.steps) if (step.kind in counts) counts[step.kind] += 1;
  const stats = $("#run-stats");
  stats.replaceChildren();
  for (const [value, label] of [
    [duration(run.duration), "elapsed"],
    [counts.model, "AI calls"],
    [counts.embedding, "embedding calls"],
    [counts.tool, "tool calls"],
    [run.artifacts.length, "artifacts"],
  ]) {
    const item = node("span");
    item.append(node("strong", "", value), document.createTextNode(label));
    stats.append(item);
  }
  const constructionDone = run.steps.some(
    (step) =>
      step.module === "safety_policy_model_construction" &&
      step.status === "ok",
  );
  const shieldingStarted = run.steps.some((step) => step.phase === "shielding");
  // The run record names the weight status that the construction reached.
  const construction = run.record?.status;
  const outcome = $("#run-outcome");
  outcome.className = `outcome ${run.status === "ok" ? "ok" : run.status === "error" ? "error" : "pending"}`;
  const headline =
    run.status === "ok"
      ? "Run completed"
      : run.status === "error"
        ? construction && construction !== "failed"
          ? `Construction ended ${title(construction).toLowerCase()}. Shielding ${shieldingStarted ? "is incomplete" : "did not start"}.`
          : constructionDone
            ? "Construction complete. Shielding incomplete."
            : "Run incomplete"
        : "Run has no terminal report";
  outcome.replaceChildren(
    icon(
      run.status === "ok" ? "ok" : run.status === "error" ? "error" : "pending",
    ),
    node("strong", "", headline),
    node(
      "span",
      "outcome-link",
      run.error.message ? "Inspect failure" : "Inspect run",
    ),
  );
  const warnings = $("#warnings");
  warnings.hidden = !run.warnings.length;
  warnings.replaceChildren(...run.warnings.map((text) => node("p", "", text)));
  $("#construction-record").replaceChildren(
    recordPanel(run, selectStage, selectFile),
  );
  $("#content-origins").replaceChildren(originInventory(run, selectFile));
  renderStageSelection();
}

function renderStageSelection() {
  for (const button of document.querySelectorAll("[data-stage]")) {
    const status = stageStatus(state.run, button.dataset.stage);
    button.classList.remove(
      "complete",
      "error",
      "pending",
      "absent",
      "selected",
    );
    button.classList.add(status.state);
    button.classList.toggle("selected", button.dataset.stage === state.stage);
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.stage === state.stage),
    );
    button.querySelector(".node-status").textContent = status.label;
    const pages = [
      ...new Set(stagePrompts(button.dataset.stage).map((p) => p.page)),
    ].filter(Boolean);
    let tag = button.querySelector(".node-prompt");
    if (!tag) {
      tag = node("span", "node-prompt");
      button.querySelector(".node-status").before(tag);
    }
    tag.hidden = !pages.length;
    tag.textContent = `Paper prompt · App. H p. ${pages.join(", ")}`;
  }
  $("#all-stages").setAttribute("aria-pressed", String(state.stage === "all"));
}

// The saved prompts of a component, verified paper prompts first.
function stagePrompts(id, kinds = ["paper"]) {
  const names = STAGES.find((stage) => stage.id === id)?.prompts ?? [];
  return promptOrigins(state.run)
    .filter(
      (prompt) => names.includes(prompt.name) && kinds.includes(prompt.kind),
    )
    .sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name));
}

function promptSection(stage, open) {
  const prompts = stagePrompts(stage.id, ["paper", "unknown", "authored"]).sort(
    (a, b) => Number(a.kind === "authored") - Number(b.kind === "authored"),
  );
  if (!prompts.length) return null;
  const section = node("section", "stage-prompts");
  section.append(
    node("h3", "", "Prompts"),
    node(
      "p",
      "",
      "The templates this component sends. Paper · verbatim means an exact match with the Appendix H transcription. A sent user prompt fills the organization placeholder.",
    ),
  );
  for (const prompt of prompts) {
    const block = node("details", "prompt-block");
    block.open = open;
    const summary = node("summary");
    summary.append(
      originBadge(prompt.kind),
      node(
        "span",
        "",
        `${title(prompt.name)}${prompt.role ? ` · ${prompt.role} prompt` : ""}${prompt.page ? ` · Appendix H p. ${prompt.page}` : ""}`,
      ),
    );
    block.append(
      summary,
      originPanel(prompt, state.run, selectFile),
      renderSource(prompt.text, "prompt.txt"),
    );
    section.append(block);
  }
  const call = stageSteps(state.run, stage.id).find(
    (step) => step.kind === "model",
  );
  if (call) {
    const button = node(
      "button",
      "text-button",
      `Open call ${call.id} to see the prompts as sent`,
    );
    button.type = "button";
    button.addEventListener("click", () => {
      state.detail = "input";
      selectStep(call);
    });
    section.append(button);
  }
  return section;
}

function selectStage(id) {
  state.stage = id;
  state.step = null;
  state.file = null;
  state.structureRecord = null;
  state.view = GRAPH_STAGES.has(id) ? "structure" : "timeline";
  state.detail = "output";
  $("#search").value = "";
  $("#kind-filter").value = "all";
  renderStageSelection();
  renderActivity();
  renderInspector();
  updateURL();
  if (state.view === "structure") {
    $("#activity").scrollIntoView({ behavior: "instant", block: "start" });
    $("#structure-tab").focus({ preventScroll: true });
  }
}

function selectStep(step) {
  state.structureRecord = null;
  state.step = step;
  state.file = null;
  renderActivity();
  renderInspector();
  updateURL();
  revealInspector();
}

function selectFile(path) {
  structureView?.clearSelection();
  state.structureRecord = null;
  state.file = path;
  state.step = null;
  state.detail =
    path === "construction/policy_documents.json" ? "input" : "output";
  if (state.view !== "structure") renderActivity();
  renderInspector();
  updateURL();
  revealInspector();
}

function revealInspector() {
  if (innerWidth <= 1120)
    $("#inspector").scrollIntoView({ behavior: "instant", block: "start" });
}

function renderActivity() {
  if (!state.run) return;
  structureView?.dispose();
  structureView = null;
  const body = $("#activity-body");
  const scroll = body.scrollTop;
  const focusStep = document.activeElement?.dataset.step;
  const query = $("#search").value.trim().toLowerCase();
  const kind = $("#kind-filter").value;
  const stage = STAGES.find((item) => item.id === state.stage);
  $("#activity-title").textContent = stage?.name ?? "All stages";
  $("#kind-filter").hidden = state.view !== "timeline";
  setTabs("[data-view]", "view", state.view);
  $(".activity-filters").hidden = state.view === "structure";
  body.classList.toggle("structure-view", state.view === "structure");
  body.setAttribute("aria-labelledby", `${state.view}-tab`);
  if (state.view === "structure") {
    $("#activity-count").textContent = "Graphs from saved records";
    structureView = mountStructures(body, {
      run: state.run,
      stage: state.stage,
      readArtifact,
      onFile: selectFile,
      onInspect: (record) => {
        state.structureRecord = record;
        state.step = null;
        state.file = null;
        state.detail = "output";
        renderInspector();
        updateURL();
        if (record?.reveal) revealInspector();
      },
    });
    return;
  }
  if (state.view === "artifacts") {
    const files = stageFiles(state.run, state.stage).filter((file) =>
      file.path.toLowerCase().includes(query),
    );
    $("#activity-count").textContent = `${files.length} artifacts`;
    body.replaceChildren(...files.map((file) => fileButton(file)));
    if (!files.length)
      body.append(
        empty(
          "No matching artifacts",
          "Clear the search or select All stages to inspect other files.",
        ),
      );
  } else {
    const steps = stageSteps(state.run, state.stage).filter(
      (step) =>
        (kind === "all" ||
          (kind === "error" ? step.status === "error" : step.kind === kind)) &&
        `${step.id} ${step.label} ${step.module} ${step.operation} ${step.phase} ${step.status}`
          .toLowerCase()
          .includes(query),
    );
    $("#activity-count").textContent = `${steps.length} recorded steps`;
    const table = node("table", "timeline-table");
    const head = node("thead");
    const headings = node("tr");
    for (const label of ["Step", "Component / operation", "Type", "Duration"])
      headings.append(node("th", "", label));
    head.append(headings);
    const rows = node("tbody");
    for (const step of steps) {
      const row = node("tr", state.step?.id === step.id ? "selected" : "");
      const detail = node("td");
      const button = node("button", "call-button");
      button.type = "button";
      button.dataset.step = step.id;
      button.setAttribute("aria-pressed", String(state.step?.id === step.id));
      button.setAttribute(
        "aria-label",
        `Step ${step.id}: ${step.label}, ${step.status}`,
      );
      const labels = node("span");
      labels.append(
        node("span", "call-name", step.label),
        node(
          "span",
          "call-subtitle",
          step.metadata?.reported_model ?? title(step.phase),
        ),
      );
      button.append(
        icon(
          step.status === "ok"
            ? "ok"
            : step.status === "error"
              ? "error"
              : "pending",
          `status-symbol ${step.status === "error" ? "error" : step.status === "ok" ? "" : "pending"}`,
        ),
        labels,
      );
      button.addEventListener("click", () => selectStep(step));
      detail.append(button);
      row.append(
        node("td", "", step.id),
        detail,
        node("td", "call-type", kindLabels[step.kind]),
        node("td", "", duration(step.duration_ms)),
      );
      rows.append(row);
    }
    table.append(head, rows);
    body.replaceChildren(
      steps.length
        ? table
        : empty(
            "No calls in this view",
            stage
              ? "Some stages run without AI calls. Select Artifacts to inspect their saved inputs and results, or clear the call filter."
              : "Clear the search or call filter. Artifacts remain available even without normalized step records.",
          ),
    );
  }
  body.scrollTop = scroll;
  if (focusStep)
    body
      .querySelector(`[data-step="${CSS.escape(focusStep)}"]`)
      ?.focus({ preventScroll: true });
}

function fileButton(file) {
  const button = node(
    "button",
    `file-row${state.file === file.path ? " selected" : ""}`,
  );
  button.type = "button";
  button.append(
    icon("file"),
    node("span", "file-name", file.path),
    node("span", "file-size", bytes(file.size)),
  );
  button.title = file.path;
  button.addEventListener("click", () => selectFile(file.path));
  return button;
}

function fileList(paths) {
  const files = paths
    .map((path) => state.run.fileMap.get(path))
    .filter(Boolean);
  const list = node("div", "detail-files");
  list.append(...files.map((file) => fileButton(file)));
  return files.length
    ? list
    : empty(
        "No artifact recorded here",
        "Select a call in the timeline for its exact request and response, or use Artifacts to browse the complete run.",
      );
}

function setTabs(selector, key, value) {
  for (const button of document.querySelectorAll(selector)) {
    const selected = button.dataset[key] === value;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
}

function setLocation(path) {
  $("#artifact-location").textContent =
    path ?? "Saved files only. No new AI calls.";
  const link = $("#download");
  link.hidden = !path;
  if (path) {
    link.href = artifactURL(path);
    link.download = path.split("/").at(-1);
  }
}

async function renderInspector(forceLarge = false) {
  if (!state.run) return;
  const version = ++state.detailVersion;
  state.copy = "";
  $("#copy").disabled = true;
  setTabs("[data-detail]", "detail", state.detail);
  $("#detail-body").setAttribute("aria-labelledby", `${state.detail}-tab`);
  const stage = STAGES.find((item) => item.id === state.stage);
  const step = state.step;
  const body = $("#detail-body");
  body.replaceChildren();
  $("#inspector-meta").replaceChildren();
  setLocation(null);
  if (state.structureRecord) {
    const record = state.structureRecord;
    $("#inspector-context").textContent = record.derived
      ? "Derived from saved data"
      : "Saved structure record";
    $("#inspector-title").textContent = record.title;
    setLocation(record.path);
    let origin;
    try {
      origin = await readOrigin(state.run, record.path, readArtifact);
    } catch (error) {
      origin = {
        kind: "unknown",
        description: `Cannot read the source artifact’s origin: ${error.message}`,
      };
    }
    if (version !== state.detailVersion) return;
    body.append(
      originPanel(
        record.derived
          ? {
              kind: "derived",
              description: `This viewer assembles the displayed projection from saved values. Source artifact: ${origin.description}`,
            }
          : origin,
        state.run,
        selectFile,
      ),
    );
    if (state.detail === "input") {
      body.append(
        note(
          "A graph record is not an AI request",
          "Use Timeline to inspect the model messages or tool inputs. Output shows the selected saved record.",
        ),
      );
      return;
    }
    if (state.detail === "reasoning") {
      body.append(
        note(
          "A graph is not a thinking log",
          "Select the component’s Timeline to inspect its model inputs, returned reasoning, and tool calls. Graphs show saved data only.",
        ),
      );
      return;
    }
    body.append(node("p", "", record.description));
    if (state.detail === "raw")
      body.append(
        note(
          "Extracted record",
          "This JSON is the selected record, not the complete source file. Download original preserves the source bytes.",
        ),
      );
    if (record.action) {
      const action = node("button", "structure-button", record.action.label);
      action.type = "button";
      action.addEventListener("click", record.action.run);
      body.append(action);
    }
    body.append(renderJSON(record.value, "Selected record"));
    state.copy = JSON.stringify(record.value, null, 2);
    $("#copy").disabled = false;
    return;
  }
  if (!step && !state.file) {
    await renderOverview(body, stage, version);
    if (version !== state.detailVersion) return;
    state.copy = body.textContent;
    $("#copy").disabled = false;
    return;
  }
  $("#inspector-context").textContent = state.file
    ? "Saved artifact"
    : `${title(step.phase)} · step ${step.id}`;
  $("#inspector-title").textContent = state.file
    ? state.file.split("/").at(-1)
    : step.label;
  if (step) {
    const status = node(
      "span",
      `pill ${step.status === "error" ? "error" : step.status === "ok" ? "" : "pending"}`,
      step.status === "ok" ? "Call completed" : title(step.status),
    );
    $("#inspector-meta").append(
      status,
      node("span", "", duration(step.duration_ms)),
      node("span", "", step.metadata?.reported_model ?? kindLabels[step.kind]),
    );
  } else
    $("#inspector-meta").append(
      node("span", "", bytes(state.run.fileMap.get(state.file).size)),
    );
  if (state.detail === "details") {
    body.append(
      originPanel(
        {
          kind: "runtime",
          description:
            "Metadata recorded by repository code. This is not published paper text.",
        },
        state.run,
        selectFile,
      ),
    );
    body.append(
      renderJSON(
        step ?? {
          path: state.file,
          size: state.run.fileMap.get(state.file).size,
          run: state.run.id,
        },
        "Recorded metadata",
      ),
    );
    state.copy = JSON.stringify(
      step ?? {
        path: state.file,
        size: state.run.fileMap.get(state.file).size,
      },
      null,
      2,
    );
    $("#copy").disabled = false;
    return;
  }
  if (state.file && state.detail === "reasoning") {
    body.append(
      note(
        "Artifacts are source records",
        "This tab does not infer thoughts from a file. Select an AI call in the timeline to inspect any reasoning or rationale that the model returned.",
      ),
    );
    return;
  }
  if (step && state.detail === "reasoning" && step.kind !== "model") {
    body.append(
      note(
        "This is not an AI call",
        "Tool results, embeddings, and pipeline records have inputs and outputs, but no model thinking log. Select an AI call to inspect returned reasoning.",
      ),
    );
    return;
  }
  let path = state.file;
  if (step) {
    const prefix = `steps/${step.id}/`;
    path =
      state.detail === "input"
        ? `${prefix}input.json`
        : ["output.json", "error.json", "response.txt"]
            .map((name) => prefix + name)
            .find((name) => state.run.fileMap.has(name));
    if (!path || !state.run.fileMap.has(path)) {
      body.append(
        note(
          "No saved response",
          state.detail === "input"
            ? "This step has no input artifact."
            : "This step has not written a response. It may have failed before the model returned. Inspect Details or refresh an active run.",
        ),
      );
      return;
    }
  }
  setLocation(path);
  const file = state.run.fileMap.get(path);
  if (file.size > 2 * 1024 * 1024 && !forceLarge) {
    body.append(
      originPanel(
        {
          kind: "unknown",
          description:
            "The origin is read from the file content. Load the full artifact to inspect its source declaration.",
        },
        state.run,
        selectFile,
      ),
    );
    body.append(
      note(
        "Large artifact",
        `This file is ${bytes(file.size)}. Load it here or download the complete original.`,
      ),
    );
    const load = node("button", "button", "Load full artifact");
    load.addEventListener("click", () => renderInspector(true));
    body.append(load);
    return;
  }
  body.append(node("p", "loading", "Reading saved artifact…"));
  try {
    const payload = await readArtifact(path);
    if (version !== state.detailVersion) return;
    body.replaceChildren();
    state.copy = payload.raw;
    $("#copy").disabled = !payload.raw;
    const origin = await readOrigin(state.run, path, readArtifact, step);
    if (version !== state.detailVersion) return;
    body.append(originPanel(origin, state.run, selectFile));
    const fields = originFields(path, origin);
    if (fields && path !== "construction/policy_documents.json")
      body.append(fields);
    if (state.detail !== "raw" && hasLineage(path)) {
      const panel = await lineageView((records) =>
        lineagePanel(records, path, selectFile),
      );
      if (version !== state.detailVersion) return;
      if (panel) body.append(panel);
    }
    if (payload.imageURL) {
      const image = node("img", "artifact-image");
      image.src = payload.imageURL;
      image.alt = `Saved artifact ${path}`;
      body.append(image);
      return;
    }
    if (payload.binary) {
      body.append(
        note(
          "Binary artifact",
          "Download the original file to inspect it with the appropriate tool. The viewer does not execute saved files.",
        ),
      );
      return;
    }
    if (payload.warning)
      body.append(note("Artifact format warning", payload.warning, true));
    if (state.detail === "raw") {
      body.append(renderSource(payload.raw, path));
      return;
    }
    if (path === "construction/policy_documents.json") {
      $("#inspector-context").textContent = "Natural-language input";
      $("#inspector-title").textContent = "Policy source documents";
      const documents = payload.value;
      if (
        !Array.isArray(documents) ||
        documents.some((document) => typeof document.text !== "string")
      )
        throw new Error("Each saved policy document must contain text.");
      state.copy = documents.map((document) => document.text).join("\n\n");
      for (const document of documents) {
        const section = node("section", "policy-document");
        const source = artifactOrigin(state.run, "policy-document", document);
        section.append(
          node("h3", "", document.organization),
          originPanel(source, state.run, selectFile),
          renderText(
            document.text,
            /^\s*</.test(document.text) ? "html" : "markdown",
          ),
        );
        body.append(section);
      }
      const metadata = node("details", "policy-metadata");
      metadata.append(node("summary", "", "Source and metadata"));
      if (fields) metadata.append(fields);
      metadata.append(
        renderJSON(
          documents.map(({ text, ...record }) => record),
          "Document metadata",
        ),
      );
      body.append(metadata);
      return;
    }
    if (state.detail === "reasoning") {
      const reasoning = visibleReasoning(payload.value);
      state.copy = reasoning
        .map((item) => `${item.label}\n${item.text}`)
        .join("\n\n");
      $("#copy").disabled = !state.copy;
      body.append(
        note(
          "Returned reasoning only",
          "These are explicit reasoning, analysis, or explanation fields in the saved model response. They are not access to hidden internal reasoning.",
        ),
      );
      if (!reasoning.length)
        body.append(
          empty(
            "No separate reasoning was returned",
            "The provider did not expose a thinking log for this call. Output shows the actual response. Nothing is reconstructed or invented here.",
          ),
        );
      for (const item of reasoning) {
        const section = node("section", "reason-block");
        section.append(node("h3", "", item.label), renderText(item.text));
        body.append(section);
      }
      return;
    }
    if (path.endsWith("/error.json") || path === "error.json")
      body.append(
        note(
          "Recorded failure",
          "This is an error record, not a successful model or tool output.",
          true,
        ),
      );
    const messages = Array.isArray(payload.value?.messages)
      ? payload.value.messages
      : Array.isArray(payload.value) &&
          payload.value.length &&
          payload.value.every((item) => item?.role && "content" in item)
        ? payload.value
        : null;
    if (messages) {
      let documents = [];
      if (
        (step?.module === "policy_extraction" ||
          path.startsWith("construction/01_policy_extraction/")) &&
        state.run.fileMap.has("construction/policy_documents.json")
      ) {
        documents = (await readArtifact("construction/policy_documents.json"))
          .value;
        if (version !== state.detailVersion) return;
      }
      for (const message of messages) {
        const section = node("details", "message-block");
        section.open = true;
        section.append(node("summary", "", `${title(message.role)} message`));
        section.append(
          originPanel(
            messageOrigin(state.run, message, documents),
            state.run,
            selectFile,
          ),
        );
        section.append(
          typeof message.content === "string"
            ? renderText(message.content)
            : renderJSON(message.content, "Message content"),
        );
        if (message.images?.length)
          section.append(
            renderJSON(message.images, "Images supplied to the model"),
          );
        body.append(section);
      }
    } else if (
      step?.kind === "model" &&
      typeof payload.value?.text === "string"
    ) {
      body.append(node("h3", "", "Model response"));
      let content;
      try {
        content = JSON.parse(payload.value.text);
      } catch {
        content = undefined;
      }
      body.append(
        content !== undefined
          ? renderJSON(content, "Response")
          : renderText(payload.value.text),
      );
      if (payload.value.tool_calls?.length) {
        body.append(
          node("h3", "", "Model-requested tools"),
          node(
            "p",
            "",
            "These are requests returned by the model. Executed tool calls appear separately in the timeline.",
          ),
          renderJSON(payload.value.tool_calls, "Tool requests"),
        );
      }
      if (payload.value.usage)
        body.append(
          node("h3", "", "Token usage"),
          renderJSON(payload.value.usage, "Usage"),
        );
    } else
      body.append(
        payload.value !== undefined
          ? renderJSON(payload.value, "Artifact")
          : renderText(payload.raw, path),
      );
  } catch (error) {
    if (version === state.detailVersion)
      body.replaceChildren(
        note(
          "Cannot load artifact",
          `${error.message} Refresh the run to check whether this file is still available.`,
          true,
        ),
      );
  }
}

async function renderOverview(body, stage, version) {
  const run = state.run;
  $("#inspector-context").textContent = stage
    ? "Pipeline component"
    : "Run overview";
  $("#inspector-title").textContent = stage?.name ?? "Saved experiment";
  const status = stage
    ? stageStatus(run, stage.id)
    : {
        state: run.status === "error" ? "error" : "complete",
        label:
          run.status === "error"
            ? "Incomplete run"
            : run.status === "ok"
              ? "Completed run"
              : "Unfinished run",
      };
  $("#inspector-meta").append(
    node("span", `pill ${status.state}`, status.label),
  );
  if (state.detail === "details" || state.detail === "raw") {
    const data = stage
      ? {
          component: stage.name,
          status: status.label,
          description: stage.description,
          artifacts: stageFiles(run, stage.id),
        }
      : { manifest: run.manifest, report: run.report, error: run.error };
    body.append(
      state.detail === "raw"
        ? renderSource(JSON.stringify(data, null, 2), "json")
        : renderJSON(data, "Recorded information"),
    );
    return;
  }
  if (state.detail === "reasoning") {
    body.append(
      note(
        "Inspect a specific AI response",
        "Select an AI call below. Reasoning is shown only when the saved response contains explicit reasoning or rationale. Historical thoughts in input trajectories are not new model output.",
      ),
    );
    const calls = stageSteps(run, state.stage).filter(
      (step) => step.kind === "model",
    );
    for (const step of calls) {
      const button = node(
        "button",
        "file-row",
        `Step ${step.id} · ${step.label}`,
      );
      button.addEventListener("click", () => selectStep(step));
      body.append(button);
    }
    if (!calls.length)
      body.append(
        empty(
          "No AI calls in this component",
          "This stage may be deterministic. Its artifacts show the recorded inputs and outputs.",
        ),
      );
    return;
  }
  if (stage) {
    body.append(note(stage.name, stage.description));
    const recorded = recordedStage(run, stage.id);
    if (recorded) {
      const line = node("p", "", `Run record: ${title(recorded.status)}`);
      if (recorded.status === "skipped") line.append(` (${recorded.detail})`);
      body.append(line);
    }
    const prompts = promptSection(stage, state.detail === "input");
    if (prompts) body.append(prompts);
    if (run.stopStage === stage.id)
      body.append(
        note(
          "Run stopped after this component",
          run.error.message ?? "Inspect error.json for the recorded failure.",
          true,
        ),
      );
    let paths = state.detail === "input" ? stage.inputs : stage.outputs;
    // The raw sources are the inputs. The normalized texts are the outputs.
    if (stage.id === "policy_input")
      paths = run.artifacts
        .map((file) => file.path)
        .filter((path) =>
          path.startsWith(
            `construction/00_policy_input/${state.detail === "input" ? "raw" : "normalized"}/`,
          ),
        )
        .concat(paths);
    if (stage.id === "pruning" && state.detail === "input") {
      paths = run.artifacts
        .filter((file) =>
          /\/iteration_\d+_verifiability_refinement\/aspm\.json$/.test(
            file.path,
          ),
        )
        .map((file) => file.path);
    }
    if (state.detail === "output") {
      let summary;
      try {
        summary = await stageSummary(run, stage.id, readArtifact, selectFile);
      } catch (error) {
        summary = note(
          "Cannot summarize this component",
          `${error.message} Its saved artifacts remain available.`,
          true,
        );
      }
      if (version !== state.detailVersion) return;
      if (summary) body.append(summary);
    }
    body.append(
      node(
        "h3",
        "",
        state.detail === "input" ? "Stage inputs" : "Stage outputs",
      ),
      fileList(paths),
    );
    const output = stage.outputs.find((path) => run.fileMap.has(path));
    if (state.detail === "output" && output && hasLineage(output)) {
      const panel = await lineageView((records) =>
        lineagePanel(records, output, selectFile),
      );
      if (version !== state.detailVersion) return;
      if (panel) body.append(panel);
    }
    body.append(
      node("h3", "", "Calls and intermediate artifacts"),
      node(
        "p",
        "",
        "Select a timeline row for exact call-level input and output. The Artifacts view includes all intermediate files, not only the stage boundary.",
      ),
    );
    return;
  }
  if (state.detail === "input") {
    body.append(
      node("h3", "", "Run inputs"),
      fileList([
        "construction/00_policy_input/sources.json",
        "construction/policy_documents.json",
        "inputs/verification_input.json",
        "configuration.json",
        "manifest.json",
        "prompt_manifest.json",
      ]),
    );
    return;
  }
  if (run.error.message)
    body.append(note("Why the run stopped", run.error.message, true));
  const chain = run.artifacts.some((file) => hasLineage(file.path))
    ? await lineageView((records) => lineageChain(records, selectFile))
    : null;
  if (version !== state.detailVersion) return;
  if (chain)
    body.append(
      node("h3", "", "Stage-output lineage"),
      node(
        "p",
        "",
        "Each stage output has a sidecar. Select an output to see its parents and the reproduction choices that it depends on.",
      ),
      chain,
    );
  body.append(
    node("h3", "", "Construction outputs"),
    fileList([
      "construction/policy_documents.json",
      "construction/policies.json",
      "construction/02_ltl_rule_extraction/aspm.json",
      "construction/03_aspm_structure_optimization/aspm.json",
      "construction/04_action_based_aspm_clustering/aspm.json",
      "construction/05_aspm_weight_learning/training_data.json",
      "construction/05_aspm_weight_learning/report.json",
      "construction/aspm.json",
    ]),
    node("h3", "", "Run records"),
    fileList([
      "construction_report.md",
      "run.json",
      "fabrications.jsonl",
      "missing_information.json",
      "prompt_manifest.json",
      "construction/model_usage.json",
      "construction/stage_status.jsonl",
      "report.json",
      "error.json",
      "events.jsonl",
    ]),
  );
}

for (const button of document.querySelectorAll("[data-stage]"))
  button.addEventListener("click", () => selectStage(button.dataset.stage));
$("#all-stages").addEventListener("click", () => selectStage("all"));
$("#run-select").addEventListener("change", (event) =>
  loadRun(event.target.value),
);
$("#refresh").addEventListener("click", () => loadRuns());
$("#search").addEventListener("input", renderActivity);
$("#kind-filter").addEventListener("change", renderActivity);
$("#run-outcome").addEventListener("click", () => {
  if (state.run.fileMap.has("error.json")) selectFile("error.json");
  else selectStage("all");
});
for (const button of document.querySelectorAll("[data-view]"))
  button.addEventListener("click", () => {
    if (state.structureRecord) {
      state.structureRecord = null;
      renderInspector();
    }
    state.view = button.dataset.view;
    renderActivity();
    updateURL();
  });
for (const button of document.querySelectorAll("[data-detail]"))
  button.addEventListener("click", () => {
    state.detail = button.dataset.detail;
    renderInspector();
    updateURL();
  });
for (const tabs of document.querySelectorAll('[role="tablist"]'))
  tabs.addEventListener("keydown", (event) => {
    const buttons = [...tabs.querySelectorAll('[role="tab"]')];
    const current = buttons.indexOf(document.activeElement);
    if (
      current < 0 ||
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    )
      return;
    event.preventDefault();
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[index].focus();
    buttons[index].click();
  });
$("#copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.copy);
    notify("Copied displayed data");
  } catch {
    notify("Clipboard access was denied. Use Raw to select and copy the text.");
  }
});
loadRuns(true);
