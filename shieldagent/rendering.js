import hljs from "./vendor/highlight-11.12.0.min.js";
import { Marked } from "./vendor/marked-18.2.1.js";
import DOMPurify from "./vendor/purify-3.4.18.js";

export function node(tag, className = "", text = "") {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== "") result.textContent = String(text);
  return result;
}

const markdown = new Marked({
  gfm: true,
  renderer: {
    // Keep embedded HTML visible as evidence, not executable page markup.
    html: ({ text }) => node("span", "markdown-literal", text).outerHTML,
    image: ({ text }) =>
      node("span", "markdown-image", `Image: ${text}`).outerHTML,
  },
});

function languageFor(path) {
  const extension = path.split(".").at(-1).toLowerCase();
  const language = ["jsonl", "ndjson"].includes(extension) ? "json" : extension;
  return hljs.getLanguage(language) ? language : "plaintext";
}

function highlight(code, source, language) {
  code.classList.add("hljs");
  code.dataset.language = language;
  code.replaceChildren(
    DOMPurify.sanitize(
      hljs.highlight(source, { language, ignoreIllegals: true }).value,
      {
        ALLOWED_TAGS: ["span"],
        ALLOWED_ATTR: ["class"],
        RETURN_DOM_FRAGMENT: true,
      },
    ),
  );
}

export function renderSource(source, path = "plaintext") {
  const pre = node("pre", "code-view");
  const code = node("code");
  highlight(code, source, languageFor(path));
  pre.append(code);
  return pre;
}

function formatJSONSnippet(source) {
  try {
    return JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    // Incomplete model snippets remain unchanged. Formatting must not repair evidence.
    return source;
  }
}

function renderMarkdown(source) {
  const content = node("div", "markdown-body");
  const fragment = DOMPurify.sanitize(markdown.parse(source), {
    ALLOWED_TAGS: [
      "p",
      "br",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "strong",
      "em",
      "del",
      "blockquote",
      "ul",
      "ol",
      "li",
      "pre",
      "code",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "hr",
      "span",
      "input",
    ],
    ALLOWED_ATTR: [
      "href",
      "title",
      "class",
      "start",
      "align",
      "type",
      "checked",
      "disabled",
    ],
    RETURN_DOM_FRAGMENT: true,
  });
  for (const link of fragment.querySelectorAll("a[href]")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  for (const checkbox of fragment.querySelectorAll("input")) {
    checkbox.type = "checkbox";
    checkbox.disabled = true;
  }
  for (const code of fragment.querySelectorAll("pre > code")) {
    const language =
      [...code.classList]
        .find((name) => name.startsWith("language-"))
        ?.slice(9) ?? "plaintext";
    const syntax = languageFor(language);
    const text =
      syntax === "json"
        ? formatJSONSnippet(code.textContent)
        : code.textContent;
    highlight(code, text, syntax);
    code.parentElement.classList.add("code-view");
  }
  for (const table of fragment.querySelectorAll("table")) {
    const scroll = node("div", "markdown-table");
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "Markdown table");
    table.replaceWith(scroll);
    scroll.append(table);
  }
  content.append(fragment);
  return content;
}

function presentation(label, views, selected = 0) {
  const section = node("section", "content-view");
  const toolbar = node("div", "format-toolbar");
  const controls = node("div", "format-switch");
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", `${label} display`);
  const content = node("div", "format-content");
  const buttons = views.map(([name, render], index) => {
    const button = node("button", "", name);
    button.type = "button";
    button.setAttribute("aria-pressed", String(index === selected));
    button.addEventListener("click", () => {
      for (const item of buttons)
        item.setAttribute("aria-pressed", String(item === button));
      content.replaceChildren(render());
    });
    return button;
  });
  controls.append(...buttons);
  toolbar.append(node("span", "format-label", label), controls);
  content.append(views[selected][1]());
  section.append(toolbar, content);
  return section;
}

export function renderText(source, path = "markdown") {
  if (languageFor(path) !== "markdown" && !/\.(md|mdown|markdown)$/i.test(path))
    return renderSource(source, path);
  return presentation("Markdown", [
    ["Rendered", () => renderMarkdown(source)],
    ["Source", () => renderSource(source, "markdown")],
  ]);
}

export function renderJSON(value, name) {
  const formatted = JSON.stringify(value, null, 2);
  return presentation(
    `${name} · JSON`,
    [
      ["Formatted", () => renderSource(formatted, "json")],
      ["Tree", () => jsonTree(value, name)],
    ],
    formatted.length > 100000 ? 1 : 0,
  );
}

function jsonTree(value, name, depth = 0) {
  if (value === null || typeof value !== "object") {
    const row = node("div", "json-primitive");
    row.append(
      node("span", "json-key", `${name}: `),
      node(
        "span",
        "json-value",
        typeof value === "string" ? value : JSON.stringify(value),
      ),
    );
    return row;
  }
  const entries = Object.entries(value);
  const tree = node("details", "json-tree");
  tree.open = depth === 0;
  const summary = node("summary");
  summary.append(
    node("span", "json-key", name),
    node(
      "span",
      "json-type",
      Array.isArray(value)
        ? `[${entries.length} items]`
        : `{${entries.length} fields}`,
    ),
  );
  const preview = !Array.isArray(value)
    ? (value.policy_description ??
      value.description ??
      value.name ??
      value.type)
    : null;
  if (typeof preview === "string")
    summary.append(
      node(
        "span",
        "json-preview",
        preview.length > 95 ? `${preview.slice(0, 95)}…` : preview,
      ),
    );
  const body = node("div", "json-body");
  let shown = 0;
  function addBatch() {
    body.querySelector(":scope > .more-button")?.remove();
    for (const [key, child] of entries.slice(shown, shown + 100))
      body.append(jsonTree(child, key, depth + 1));
    shown += Math.min(100, entries.length - shown);
    if (shown < entries.length) {
      const more = node(
        "button",
        "more-button",
        `Show next ${Math.min(100, entries.length - shown)} of ${entries.length - shown} remaining items`,
      );
      more.addEventListener("click", addBatch);
      body.append(more);
    }
  }
  tree.append(summary, body);
  if (tree.open) addBatch();
  tree.addEventListener("toggle", () => {
    if (tree.open && !body.childNodes.length) addBatch();
  });
  return tree;
}
