// The viewer reads plain data files. The local server and a static website
// provide the same files, so one viewer serves both.
const DATA = new URL("data/", import.meta.url);

const segments = (path) => path.split("/").map(encodeURIComponent).join("/");

export const runsURL = () => new URL("runs.json", DATA).href;

export const runURL = (id) =>
  new URL(`runs/${encodeURIComponent(id)}.json`, DATA).href;

// Each saved file carries a .txt suffix, so a saved HTML page never renders as a page.
export const fileURL = (id, path) =>
  new URL(`runs/${encodeURIComponent(id)}/files/${segments(path)}.txt`, DATA)
    .href;

// A simple local file server can reset a connection under a burst of requests.
// A failed request is sent once more. An HTTP error status is not retried.
export const get = (url) => fetch(url).catch(() => fetch(url));

export async function errorMessage(response) {
  const value = await response.json().catch(() => ({}));
  return value.error ?? `Request failed (${response.status})`;
}

export async function requestJSON(url) {
  const response = await get(url);
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}
