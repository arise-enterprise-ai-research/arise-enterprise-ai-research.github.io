import cytoscape from "./vendor/cytoscape-3.35.0.mjs";
import { node } from "./rendering.js";
import {
  structureOptions,
  loadStructure,
  modelGraph,
  graphNode,
  changeSummary,
  decisionGraph,
  formulaGraph,
} from "./structure-data.js";

const COLORS = [
  "#ddd6f3",
  "#f3d9dd",
  "#d2e8ec",
  "#e6e2cd",
  "#e4d7ce",
  "#d7e1e6",
];
const countLabel = (count, singular, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;
const button = (text, action) => {
  const element = node("button", "structure-button", text);
  element.type = "button";
  element.addEventListener("click", action);
  return element;
};

function select(label, entries, action) {
  const field = node("label", "structure-field");
  field.append(node("span", "", label));
  const input = node("select");
  input.setAttribute("aria-label", label);
  entries.forEach(([value, text]) => {
    const item = node("option", "", text);
    item.value = value;
    input.append(item);
  });
  input.addEventListener("change", () => action(input.value));
  field.append(input);
  return { field, input };
}

export function mountStructures(
  container,
  { run, stage, readArtifact, onInspect, onFile },
) {
  const options = structureOptions(run, stage);
  let disposed = false;
  let revision = 0;
  let cy;
  let observer;
  let clearSelection = () => {};
  const stopGraph = () => {
    observer?.disconnect();
    cy?.destroy();
    cy = null;
    clearSelection = () => {};
  };
  const controls = node("div", "structure-controls");
  const content = node("div", "structure-content");
  container.replaceChildren(controls, content);
  if (!options.length) {
    content.append(
      node("h3", "", "No saved structure for this component"),
      node(
        "p",
        "muted",
        "This run has no matching graph artifact. Timeline and Artifacts still show its recorded activity.",
      ),
    );
    return {
      dispose: () => {
        disposed = true;
      },
      clearSelection: () => {},
    };
  }
  const picker = select(
    "Saved structure",
    options.map((option, i) => [String(i), option.label]),
    (value) => {
      onInspect(null);
      load(options[Number(value)]);
    },
  );
  controls.append(picker.field);

  function showError(error) {
    stopGraph();
    onInspect(null);
    content.replaceChildren(
      node("h3", "", "Cannot visualize this saved structure"),
      node("p", "", error.message),
      button("Open original artifact", () =>
        onFile(options[Number(picker.input.value)].path),
      ),
    );
  }

  function safely(render) {
    try {
      render();
    } catch (error) {
      showError(error);
    }
  }

  function inspect(data, reveal = false) {
    onInspect({
      title:
        data.record?.name ?? data.record?.id ?? data.label ?? data.relation,
      value: data.record,
      path: data.path,
      reveal,
      derived: Boolean(data.relation),
      description: data.relation
        ? `Derived from ${data.field ?? { uses: "predicate_ids", member: "rule_ids and rule_weights", adjacency: "matrix entries", operand: "formula.operands" }[data.relation]} in ${data.path}`
        : `Graph node · ${data.kind}`,
    });
  }

  function sources(paths) {
    const row = node("div", "structure-sources");
    row.append(node("span", "", "Source records"));
    [...new Set(paths)]
      .filter((path) => run.fileMap.has(path))
      .forEach((path) => {
        const link = button(path, () => {
          clearSelection();
          onFile(path);
        });
        link.title = path;
        row.append(link);
      });
    content.append(row);
  }

  function draw(elements, { formula = false, onNode = inspect } = {}) {
    stopGraph();
    const shell = node("div", "graph-shell");
    const toolbar = node("div", "graph-toolbar");
    const canvas = node("div", "structure-canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute(
      "aria-label",
      "Interactive data graph. Use the Inspect node selector for keyboard access to each record.",
    );
    const nodes = elements.filter((item) => !item.data.source);
    const edges = elements.filter((item) => item.data.source);
    const names = new Map();
    for (const { data } of nodes)
      if (data.record?.name) {
        if (!names.has(data.record.name))
          names.set(data.record.name, new Set());
        names.get(data.record.name).add(data.record.id);
      }
    for (const { data } of nodes)
      if (names.get(data.record?.name)?.size > 1)
        data.label += `\nID ${data.record.id.split(".").at(-1)}`;
    const transformation = nodes.some((item) => item.data.side);
    const circuitAction = edges.find((item) => item.data.relation === "member")
      ?.data.source;
    const ordered = [];
    const seen = new Set();
    const byId = new Map(nodes.map((item) => [item.data.id, item]));
    const append = (item) => {
      if (!seen.has(item.data.id)) {
        seen.add(item.data.id);
        ordered.push(item);
      }
    };
    for (const rule of nodes.filter((item) => item.data.kind === "rule")) {
      const predicates = edges
        .filter(
          (item) =>
            item.data.source === rule.data.id && item.data.relation === "uses",
        )
        .map((item) => byId.get(item.data.target))
        .filter((item) => !seen.has(item.data.id));
      const middle = Math.ceil(predicates.length / 2);
      predicates.slice(0, middle).forEach(append);
      append(rule);
      predicates.slice(middle).forEach(append);
    }
    for (const node of nodes) {
      if (seen.has(node.data.id)) continue;
      const pending = [node];
      while (pending.length) {
        const next = pending.shift();
        if (seen.has(next.data.id)) continue;
        append(next);
        for (const { data } of edges) {
          if (data.source === next.data.id) pending.push(byId.get(data.target));
          else if (data.target === next.data.id)
            pending.push(byId.get(data.source));
        }
      }
    }
    const sides = { before: 0, proposed: 0 };
    const radius =
      nodes.length > 1 ? 240 / (2 * Math.sin(Math.PI / nodes.length)) : 0;
    (transformation ? nodes : ordered).forEach((item, index) => {
      item.position = transformation
        ? {
            x: item.data.side === "before" ? 0 : 440,
            y: sides[item.data.side]++ * 130,
          }
        : {
            x: radius * Math.cos((2 * Math.PI * index) / nodes.length),
            y: radius * Math.sin((2 * Math.PI * index) / nodes.length),
          };
    });
    if (circuitAction) {
      const rules = nodes.filter((item) => item.data.kind === "rule");
      const predicates = ordered.filter(
        (item) => item.data.kind !== "rule" && item.data.id !== circuitAction,
      );
      const columns = [[byId.get(circuitAction)], rules, predicates];
      columns.forEach((column, x) =>
        column.forEach((item, y) => {
          item.position = { x: x * 330, y: (y - (column.length - 1) / 2) * 96 };
        }),
      );
      for (const { data } of edges) {
        data.route = data.target === circuitAction ? "left" : "right";
      }
    }
    const positions = new Map(
      nodes.map((item) => [item.data.id, item.position]),
    );
    if (transformation)
      for (const { data } of edges)
        if (data.relation === "uses") {
          const distance = Math.abs(
            positions.get(data.source).y - positions.get(data.target).y,
          );
          data.bend =
            (data.source.startsWith("before:") ? -1 : 1) *
            Math.min(450, Math.max(360, distance * 1.2));
        }
    if (!transformation && !circuitAction && !formula)
      for (const { data } of edges) {
        const source = positions.get(data.source);
        const target = positions.get(data.target);
        const midpoint = {
          x: (source.x + target.x) / 2,
          y: (source.y + target.y) / 2,
        };
        const outward = Math.sign(
          midpoint.x * (source.y - target.y) +
            midpoint.y * (target.x - source.x),
        );
        data.bend =
          -outward * Math.min(280, 2 * Math.hypot(midpoint.x, midpoint.y));
      }
    const selector = select(
      "Inspect node",
      [
        ["", "Select a node…"],
        ...nodes.map(({ data }) => [
          data.id,
          `${data.kind} · ${data.label.replaceAll("\n", " ")} · ${data.record?.id ?? data.id}`,
        ]),
      ],
      (id) => {
        if (!id) return;
        const element = cy.getElementById(id);
        cy.elements().unselect();
        edgeSelector.input.value = "";
        element.select();
        cy.zoom(Math.max(cy.zoom(), 0.9));
        cy.center(element);
        onNode(element.data());
      },
    );
    const edgeSelector = select(
      "Inspect edge",
      [
        ["", "Select an edge…"],
        ...edges.map(({ data }) => [
          data.id,
          `${data.label ?? data.relation} · ${data.source} / ${data.target}`,
        ]),
      ],
      (id) => {
        if (!id) return;
        selector.input.value = "";
        cy.elements().unselect();
        const edge = cy.getElementById(id);
        edge.select();
        inspect(edge.data());
      },
    );
    edgeSelector.field.hidden = !edges.length;
    const focus = button("Focus selection", () => {
      const selected = cy.$(":selected");
      cy.fit(selected.closedNeighborhood(), 36);
    });
    const showRecord = button("Show selected record", () => {
      const selected = cy.$(":selected").first();
      if (selected.isNode()) onNode(selected.data(), true);
      else inspect(selected.data(), true);
    });
    focus.disabled = showRecord.disabled = true;
    toolbar.append(
      selector.field,
      edgeSelector.field,
      button("Zoom in", () =>
        cy.zoom({
          level: Math.min(cy.zoom() * 1.4, cy.maxZoom()),
          renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
        }),
      ),
      button("Zoom out", () =>
        cy.zoom({
          level: Math.max(cy.zoom() / 1.4, cy.minZoom()),
          renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
        }),
      ),
      button("Fit graph", () => cy.fit(undefined, 36)),
      focus,
      showRecord,
    );
    const legend = node("div", "graph-legend");
    const clusters = new Map(
      nodes
        .filter((item) => item.data.clusterColor)
        .map(({ data }) => [data.cluster, data.clusterColor]),
    );
    if (clusters.size)
      for (const [cluster, color] of clusters) {
        const entry = node(
          "span",
          "legend-cluster",
          `State · cluster ${cluster}`,
        );
        entry.style.setProperty("--legend-fill", color);
        legend.append(entry);
      }
    else
      for (const kind of new Set(nodes.map((item) => item.data.kind)))
        legend.append(
          node("span", `legend-${kind}`, kind[0].toUpperCase() + kind.slice(1)),
        );
    for (const change of new Set(
      nodes.map((item) => item.data.change).filter(Boolean),
    ))
      legend.append(
        node(
          "span",
          `legend-${change}`,
          change[0].toUpperCase() + change.slice(1),
        ),
      );
    for (const relation of new Set(edges.map((item) => item.data.relation)))
      legend.append(
        node(
          "span",
          `legend-edge legend-${relation}`,
          {
            uses: "Rule reference",
            candidate: "Candidate similarity",
            replacement: "ID replacement / proposal",
            member: "Circuit membership",
            adjacency: "Saved adjacency",
            operand: "Ordered operand",
          }[relation],
        ),
      );
    shell.append(
      toolbar,
      canvas,
      legend,
      node(
        "p",
        "graph-help",
        `${countLabel(nodes.length, "node")} · ${countLabel(edges.length, "edge")}. Drag to pan. Fit graph shows the full overview. Select a node or edge to inspect its record. Lines marked “uses” do not imply logical direction.`,
      ),
    );
    content.append(shell);
    cy = cytoscape({
      container: canvas,
      elements,
      minZoom: 0.01,
      maxZoom: 3,
      pixelRatio: Math.min(devicePixelRatio, 2),
      boxSelectionEnabled: false,
      autoungrabify: true,
      layout: formula
        ? {
            name: "breadthfirst",
            directed: true,
            spacingFactor: 1.4,
            padding: 36,
            animate: false,
          }
        : {
            name: "preset",
            padding: 36,
            fit: true,
            animate: false,
          },
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "background-color": "#e0eee8",
            "border-color": "#60786c",
            "border-width": 1.5,
            color: "#18382a",
            width: 190,
            height: 64,
            shape: "round-rectangle",
            "font-family": "system-ui, sans-serif",
            "font-size": 16,
            "text-wrap": "wrap",
            "text-max-width": 180,
            "text-valign": "center",
            "text-halign": "center",
            "text-overflow-wrap": "anywhere",
            padding: 8,
          },
        },
        {
          selector: 'node[kind = "action"]',
          style: {
            shape: "rectangle",
            "background-color": "#e3eaf7",
            "border-color": "#486b9b",
            color: "#203f6a",
          },
        },
        {
          selector: 'node[kind = "rule"]',
          style: {
            shape: "round-rectangle",
            "background-color": "#f8ecd4",
            "border-color": "#996315",
            color: "#65410b",
            width: 190,
            height: 56,
          },
        },
        {
          selector: 'node[kind = "operator"]',
          style: {
            shape: "ellipse",
            width: 74,
            height: 38,
            "background-color": "#eee9e0",
          },
        },
        {
          selector: "node[clusterColor]",
          style: { "background-color": "data(clusterColor)" },
        },
        {
          selector: 'node[change = "added"]',
          style: { "border-width": 4, "border-color": "#167847" },
        },
        {
          selector: 'node[change = "modified"]',
          style: {
            "border-width": 4,
            "border-color": "#a15b08",
            "border-style": "dashed",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#8c9e95",
            "curve-style": "bezier",
            label: "data(relation)",
            "font-size": 14,
            color: "#43584c",
            "text-background-color": "#fff",
            "text-background-opacity": 0.9,
            "text-background-padding": 3,
          },
        },
        { selector: "edge[label]", style: { label: "data(label)" } },
        {
          selector: "edge[bend]",
          style: {
            "curve-style": "unbundled-bezier",
            "control-point-distances": "data(bend)",
            "control-point-weights": 0.5,
          },
        },
        {
          selector: 'edge[relation = "candidate"]',
          style: {
            "line-style": "dashed",
            "line-color": "#a15b08",
            color: "#754308",
            width: 2.5,
          },
        },
        {
          selector:
            'edge[relation = "replacement"], edge[relation = "operand"]',
          style: {
            "target-arrow-shape": "triangle",
            "target-arrow-color": "#617b6c",
            "line-style": "dashed",
          },
        },
        {
          selector: 'edge[relation = "member"]',
          style: { "line-style": "dashed", "line-color": "#486b9b" },
        },
        {
          selector: "edge[route]",
          style: {
            "curve-style": "taxi",
            "taxi-direction": "rightward",
            "taxi-turn": "50%",
          },
        },
        {
          selector: 'edge[route = "left"]',
          style: { "taxi-direction": "leftward" },
        },
        {
          selector: ":selected",
          style: {
            "border-width": 4,
            "border-color": "#143eae",
            "line-color": "#143eae",
            "target-arrow-color": "#143eae",
          },
        },
      ],
    });
    if (cy.zoom() < 0.6 && !transformation && !circuitAction && !formula) {
      const neighborhood = cy
        .nodes()
        .max((element) => element.degree())
        .ele.closedNeighborhood();
      cy.fit(neighborhood, 36);
      shell
        .querySelector(".graph-help")
        .append(
          ` Starts with one complete neighborhood (${neighborhood.nodes().length} nodes). Use Fit graph for the full overview.`,
        );
    }
    clearSelection = () => {
      cy.elements().unselect();
      selector.input.value = edgeSelector.input.value = "";
    };
    cy.on("select unselect", () => {
      focus.disabled = showRecord.disabled = !cy.$(":selected").length;
    });
    cy.on("tap", "node", (event) => {
      edgeSelector.input.value = "";
      selector.input.value = event.target.id();
      onNode(event.target.data());
    });
    cy.on("tap", "edge", (event) => {
      selector.input.value = "";
      edgeSelector.input.value = event.target.id();
      inspect(event.target.data());
    });
    cy.on("tap", (event) => {
      if (event.target === cy) {
        clearSelection();
        onInspect(null);
      }
    });
    observer = new ResizeObserver(() => cy?.resize());
    observer.observe(canvas);
  }

  function modelView(
    model,
    path,
    previous = null,
    graph = null,
    restore = () => load(options[Number(picker.input.value)]),
  ) {
    const elements = graph ?? modelGraph(model, path, previous);
    draw(elements, {
      onNode: (data, reveal = false) => {
        inspect(data, reveal);
        if (data.kind === "rule" && data.record.formula)
          onInspect({
            title: data.record.id,
            value: data.record,
            path: data.path,
            description: data.record.logic,
            reveal,
            action: {
              label: "View formula tree",
              run: () =>
                safely(() => {
                  content.replaceChildren();
                  content.append(
                    button("Back to structure", () => {
                      onInspect(null);
                      safely(restore);
                    }),
                    node("h3", "", "Logical formula tree"),
                    node("p", "", data.record.logic),
                  );
                  draw(formulaGraph(data.record, model, data.path), {
                    formula: true,
                  });
                  sources([data.path]);
                }),
            },
          });
      },
    });
  }

  function optimization(option, data) {
    const changes = changeSummary(data.before, data.after);
    const accepted = data.events.filter(
      (event) => event.outcome === "accepted",
    ).length;
    const summary = node(
      "p",
      "structure-summary",
      `${countLabel(accepted, option.isPruning ? "accepted merge" : "accepted refinement")} in this pass. ${Object.entries(
        changes,
      )
        .map(
          ([name, count]) =>
            `${name}: ${count.added} added, ${count.removed} removed, ${count.modified} modified`,
        )
        .join(". ")}.`,
    );
    const chooser = select(
      "Inspect pass or decision",
      [
        ["after", "Whole pass · output snapshot"],
        ["before", "Whole pass · input snapshot"],
        ...data.events.map((event, i) => [
          String(i),
          `Decision ${i + 1} · ${event.outcome.replaceAll("_", " ")} · ${event.rule_id ?? event.cluster?.join(", ") ?? "Exact duplicates"}`,
        ]),
      ],
      (value) => {
        onInspect(null);
        safely(() => show(value));
      },
    );
    content.append(summary, chooser.field);
    const body = node("div");
    content.append(body);
    // Keep controls mounted while the selected saved structure changes.
    function show(value) {
      stopGraph();
      for (const child of [...content.children])
        if (![summary, chooser.field, body].includes(child)) child.remove();
      body.replaceChildren();
      if (value === "after" || value === "before") {
        const after = value === "after";
        body.append(
          node(
            "p",
            "muted",
            after
              ? "Output snapshot. Added and modified records are marked against this pass’s input. Removed records remain in the input snapshot."
              : "Input snapshot. This is the complete saved ASPM before this pass.",
          ),
        );
        modelView(
          after ? data.after : data.before,
          after ? option.path : option.before,
          after ? data.before : null,
          null,
          () => {
            content.replaceChildren(summary, chooser.field, body);
            show(value);
          },
        );
      } else {
        const index = Number(value);
        const event = data.events[index];
        const rawId = event.update?.raw_response_id
          ?.split("/")
          .slice(0, 2)
          .join("/");
        const decisions = data.decisions.filter(
          (decision) =>
            rawId &&
            (decision.call === rawId || decision.call?.startsWith(`${rawId}/`)),
        );
        const unchanged = event.outcome !== "accepted";
        body.append(
          node(
            "h3",
            "",
            `Decision ${index + 1} · ${event.outcome.replaceAll("_", " ")}`,
          ),
          node(
            "p",
            "",
            event.reason ||
              (unchanged
                ? `This decision did not change the ASPM.${option.isPruning ? " Dashed candidate links show similarity, not a completed merge." : " Inspect the decision log for predicate checks and rejected proposals."}`
                : "The graph shows affected records and recorded ID replacements. Unchanged context predicates are included where the rule uses them."),
          ),
        );
        if (decisions.length) {
          const log = node("ul", "decision-log");
          for (const record of decisions)
            log.append(
              node(
                "li",
                "",
                `${record.predicate_id ?? record.predicate_ids?.join(", ") ?? record.call} · ${record.outcome}${record.reason ? ` · ${record.reason}` : ""}`,
              ),
            );
          body.append(log);
        }
        body.append(
          button("Inspect decision record", () =>
            onInspect({
              title: `Decision ${index + 1}`,
              value: event,
              path: data.eventsPath,
              description: `Record ${index + 1} in the saved pass event log`,
              reveal: true,
            }),
          ),
        );
        if (decisions.length)
          body.append(
            button("Inspect decision log", () =>
              onInspect({
                title: "Decision log",
                value: decisions,
                path: data.decisionsPath,
                description: "Matched by the recorded call identifier",
                reveal: true,
              }),
            ),
          );
        const graph = decisionGraph(event, data);
        if (graph.length) draw(graph);
        else
          content.append(
            node(
              "p",
              "muted",
              "This decision has no affected records to draw. Inspect its saved event above.",
            ),
          );
      }
      sources([
        option.before,
        option.path,
        data.eventsPath,
        ...(option.isPruning ? [data.clustersPath] : []),
      ]);
    }
    // Start with the concrete candidate/change, not an unreadable whole-model overview.
    chooser.input.value = data.events.length ? "0" : "after";
    show(chooser.input.value);
  }

  function matrixView(option, data) {
    content.append(
      node(
        "p",
        "structure-summary",
        `${data.ids.length} state predicates. Row and column order comes from clustering.json. Cluster colors show recorded membership, not spatial similarity.`,
      ),
    );
    const predicates = new Map(data.model.predicates.map((p) => [p.id, p]));
    const cellRecord = (i, j) => ({
      title: `${i + 1} × ${j + 1}`,
      path: option.path,
      description: `Derived from matrix[${i}][${j}] in ${option.path}. Order: ${data.metadataPath}.`,
      derived: true,
      value: {
        row: i,
        column: j,
        row_predicate_id: data.ids[i],
        column_predicate_id: data.ids[j],
        value: data.matrix[i][j],
        matrix_order_source: data.metadataPath,
      },
    });
    if (option.matrix === "adjacency") {
      const elements = data.ids.map((id) => {
        if (!predicates.has(id))
          throw new Error(`Matrix references missing predicate ${id}.`);
        const cluster = data.clusters?.labels?.[id];
        return graphNode(predicates.get(id), "state", data.modelPath, {
          label: `${predicates.get(id).name}${cluster === undefined ? "" : `\nCluster ${cluster}`}`,
          ...(cluster === undefined
            ? {}
            : {
                clusterColor: COLORS[Number(cluster) % COLORS.length],
                cluster,
              }),
        });
      });
      data.matrix.forEach((row, i) =>
        row.forEach((value, j) => {
          if (j > i && value !== 0)
            elements.push({
              data: {
                id: `adjacency:${i}:${j}`,
                source: data.ids[i],
                target: data.ids[j],
                relation: "adjacency",
                label: value.toFixed(3),
                path: option.path,
                record: cellRecord(i, j).value,
              },
            });
        }),
      );
      content.append(
        node(
          "p",
          "muted",
          "Edges are non-zero saved adjacency entries. Self-links are omitted from the graph and remain in the matrix. Layout positions are for readability only.",
        ),
      );
      draw(elements);
    }
    const wrapper = node("div", "matrix-scroll");
    wrapper.tabIndex = 0;
    wrapper.setAttribute(
      "aria-label",
      "Saved matrix. Scroll horizontally to inspect all columns.",
    );
    const table = node("table", "structure-matrix");
    const caption = node(
      "caption",
      "",
      `${option.matrix === "adjacency" ? "Adjacency" : "Similarity"} matrix · select a cell for its exact value`,
    );
    table.append(caption);
    const head = node("tr");
    head.append(node("th", "", "#"));
    data.ids.forEach((id, i) => {
      const cell = node("th", "", String(i + 1));
      cell.scope = "col";
      cell.title = id;
      head.append(cell);
    });
    const thead = node("thead");
    thead.append(head);
    table.append(thead);
    const tbody = node("tbody");
    data.ids.forEach((id, i) => {
      const row = node("tr");
      const label = node("th", "", String(i + 1));
      label.scope = "row";
      label.title = id;
      row.append(label);
      data.matrix[i].forEach((value, j) => {
        const cell = node("td");
        const item = button(value.toFixed(2), () =>
          onInspect(cellRecord(i, j)),
        );
        item.title = `${id} / ${data.ids[j]}: ${value}`;
        item.setAttribute("aria-label", item.title);
        item.style.backgroundColor = `rgba(53, 119, 85, ${Math.min(Math.abs(value), 1) * 0.24})`;
        cell.append(item);
        row.append(cell);
      });
      tbody.append(row);
    });
    table.append(tbody);
    wrapper.append(table);
    content.append(wrapper);
    const key = node("ol", "matrix-key");
    data.ids.forEach((id) => key.append(node("li", "", id)));
    content.append(key);
    sources([option.path, data.metadataPath, data.clustersPath]);
  }

  function circuits(option, data) {
    if (!Array.isArray(data.circuits) || !data.circuits.length) {
      content.append(
        node(
          "p",
          "muted",
          "No action circuits were recorded in this artifact.",
        ),
      );
      return;
    }
    const selector = select(
      "Action circuit",
      data.circuits.map((circuit, i) => [
        String(i),
        circuit.action_predicate_id,
      ]),
      (value) => {
        onInspect(null);
        safely(() => show(Number(value)));
      },
    );
    content.append(selector.field);
    function show(index) {
      stopGraph();
      for (const child of [...content.children])
        if (child !== selector.field) child.remove();
      const circuit = data.circuits[index];
      const ids = new Set([
        circuit.action_predicate_id,
        ...circuit.predicate_ids,
      ]);
      const rules = data.model.rules.filter((rule) =>
        circuit.rule_ids.includes(rule.id),
      );
      rules.forEach((rule) => rule.predicate_ids.forEach((id) => ids.add(id)));
      const model = {
        predicates: data.model.predicates.filter((p) => ids.has(p.id)),
        rules,
      };
      const elements = modelGraph(model, data.modelPath);
      const weights = new Map(circuit.rule_weights);
      const hasWeights = weights.size > 0;
      for (const id of circuit.rule_ids)
        elements.push({
          data: {
            id: `membership:${id}`,
            source: circuit.action_predicate_id,
            target: id,
            relation: "member",
            label: weights.has(id)
              ? `weight ${weights.get(id).toFixed(3)}`
              : "member · untrained",
            path: option.path,
            record: {
              action_predicate_id: circuit.action_predicate_id,
              rule_id: id,
              weight: weights.get(id) ?? null,
            },
          },
        });
      content.append(
        node(
          "p",
          "structure-summary",
          `${countLabel(circuit.rule_ids.length, "rule")} · ${countLabel(circuit.predicate_ids.length, "circuit predicate")}. ${hasWeights ? "Signed weights are learned parameters, not probabilities." : "This is a pre-training circuit. No learned weights are recorded."}`,
        ),
        node(
          "p",
          "muted",
          "Dashed lines show circuit membership. Solid lines show a rule’s predicate references. Cluster-expanded rules need not directly mention the selected action.",
        ),
        button("Inspect circuit record", () =>
          onInspect({
            title: circuit.action_predicate_id,
            path: option.path,
            value: circuit,
            description: "Exact saved action circuit",
            reveal: true,
          }),
        ),
      );
      modelView(model, data.modelPath, null, elements, () => {
        content.replaceChildren(selector.field);
        show(index);
      });
      sources([option.path, data.modelPath]);
    }
    show(0);
  }

  async function load(option) {
    const version = ++revision;
    stopGraph();
    content.replaceChildren(
      node("p", "loading", "Reading saved graph records…"),
    );
    try {
      const data = await loadStructure(option, readArtifact, run.fileMap);
      if (disposed || version !== revision) return;
      content.replaceChildren();
      if (option.kind === "optimization") optimization(option, data);
      else if (option.kind === "matrix") matrixView(option, data);
      else if (option.kind === "circuits") circuits(option, data);
      else {
        content.append(
          node(
            "p",
            "structure-summary",
            `${data.model.rules.length} rules · ${data.model.predicates.length} predicates. Select a rule to inspect its logical formula tree.`,
          ),
        );
        modelView(data.model, option.path);
        sources([option.path]);
      }
    } catch (error) {
      if (disposed || version !== revision) return;
      showError(error);
    }
  }
  load(options[0]);
  return {
    clearSelection: () => clearSelection(),
    dispose: () => {
      disposed = true;
      revision++;
      stopGraph();
    },
  };
}
