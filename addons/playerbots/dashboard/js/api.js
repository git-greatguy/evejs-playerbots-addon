// Same-origin JSON helpers for the dashboard's /api routes.

export async function getJSON(path) {
  const response = await fetch(path, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try { message = (await response.json()).error || message; } catch { /* keep generic */ }
    throw new Error(message);
  }
  return response.json();
}

// Returns the parsed body; throws with the server's message on 4xx/5xx.
export async function postJSON(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || `Request failed (${response.status}).`);
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

export const corpCommand = (corporationID, action, args = {}) =>
  postJSON("/api/corp-command", { corporationID, action, args });

// Sends pilot orders in batches of 50, the server's per-request limit.
export async function botCommand(characterIDs, action, args = {}) {
  const ids = [...characterIDs];
  const results = [];
  let message = "";
  while (ids.length) {
    const chunk = ids.splice(0, 50);
    try {
      const data = await postJSON("/api/bot-command", { characterIDs: chunk, action, args });
      results.push(...(data.results || []));
      message = data.message;
    } catch (error) {
      results.push(...((error.data && error.data.results) || chunk.map((characterID) => ({ characterID, success: false, message: error.message }))));
      message = error.message;
    }
  }
  const ok = results.filter((row) => row.success).length;
  return { ok, total: results.length, results, message: results.length === 1 ? (results[0].message || message) : `${ok} of ${results.length} pilot(s) accepted.` };
}
