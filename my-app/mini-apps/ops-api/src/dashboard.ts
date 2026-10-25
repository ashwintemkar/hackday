export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Bridgeport Retail, ops console</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0a0a0a; color: #e5e5e5; font-family: -apple-system, Segoe UI, sans-serif; }
  header { padding: 16px 24px; border-bottom: 1px solid #262626; display: flex; align-items: center; gap: 10px; }
  header .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }
  header h1 { font-size: 15px; font-weight: 500; margin: 0; }
  header .tag { margin-left: auto; font-size: 11px; color: #a3a3a3; border: 1px solid #262626; border-radius: 6px; padding: 3px 8px; }
  main { max-width: 960px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card { background: #141414; border: 1px solid #262626; border-radius: 12px; padding: 16px; }
  .card h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #a3a3a3; margin: 0 0 12px; }
  .kv { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #1f1f1f; font-size: 13px; }
  .kv:last-child { border-bottom: none; }
  .kv span:first-child { color: #a3a3a3; }
  .badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; padding: 3px 9px; border-radius: 5px; }
  .b-red { background: #3f1d1d; color: #fca5a5; }
  .b-green { background: #14301c; color: #86efac; }
  .b-amber { background: #3a2a10; color: #fcd34d; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 7px 6px; border-bottom: 1px solid #1f1f1f; }
  th { color: #a3a3a3; font-weight: 500; font-size: 11px; text-transform: uppercase; }
  .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  input { background: #0a0a0a; border: 1px solid #262626; border-radius: 6px; color: #e5e5e5; padding: 8px 10px; font-size: 13px; }
  button { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
  button.amber { background: #b45309; }
  button.amber:hover { background: #92400e; }
  button:hover { background: #1d4ed8; }
  .msg { font-size: 12.5px; padding: 8px 10px; border-radius: 6px; margin-top: 8px; }
  .msg.ok { background: #14301c; color: #86efac; }
  .msg.err { background: #3f1d1d; color: #fca5a5; }
  .muted { color: #737373; font-size: 12.5px; }
</style>
</head>
<body>
<header>
  <span class="dot"></span>
  <h1>Bridgeport Retail, ops console</h1>
  <span class="tag">ops-api, live</span>
</header>
<main>
  <div class="card">
    <h2>Pods</h2>
    <p class="muted">This ops console watches more than one pod. Click a row to inspect it below.</p>
    <table><thead><tr><th>Pod</th><th>Service</th><th>Memory</th><th>Status</th></tr></thead><tbody id="podList"></tbody></table>
  </div>

  <div class="row">
    <div class="card">
      <h2>Pod metrics, <span id="selectedPod">checkout-api-7f9c-2</span></h2>
      <div id="podInfo"></div>
    </div>
    <div class="card">
      <h2>Deployment history</h2>
      <table><thead><tr><th>Version</th><th>Deployed</th></tr></thead><tbody id="deploys"></tbody></table>
    </div>
  </div>

  <div class="card">
    <h2>Take action</h2>
    <p class="muted">Two tiers, one token field. The agent's own token restarts the pod, green tier, no human needed. That same token is refused for rollback, amber tier, only the human approval token works there. Paste the approval token to see both succeed.</p>
    <div class="actions">
      <input id="token" type="text" placeholder="Token (agent or approval)" />
      <button onclick="doAction('restart')">Restart <span id="actionPodLabel">checkout-api-7f9c-2</span>, green tier</button>
      <button class="amber" onclick="doAction('rollback')">Rollback <span id="actionServiceLabel">checkout-api</span>, amber tier</button>
    </div>
    <div id="actionMsg"></div>
  </div>

  <div class="card">
    <h2>Audit log</h2>
    <table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Outcome</th><th>Detail</th></tr></thead><tbody id="audit"></tbody></table>
  </div>
</main>

<script>
function fmtTime(iso) { return new Date(iso).toLocaleString(); }
function outcomeBadge(o) {
  const cls = o === "success" ? "b-green" : o === "denied" ? "b-amber" : "b-red";
  return '<span class="badge ' + cls + '">' + o + '</span>';
}

let currentPod = "checkout-api-7f9c-2";
let currentService = "checkout-api";

function podStatusBadge(status, memoryPercent) {
  if (status === "healthy") return '<span class="badge b-green">Healthy</span>';
  return '<span class="badge b-red">Degraded</span>';
}

async function loadPodList() {
  const res = await fetch("/api/pods");
  const data = await res.json();
  const tbody = document.getElementById("podList");
  tbody.innerHTML = data.pods.map(p =>
    '<tr style="cursor:pointer" data-pod="' + p.name + '" data-service="' + p.service + '"><td>' + p.name +
      (p.name === currentPod ? ' <span class="muted">(selected)</span>' : '') + '</td><td>' + p.service +
      '</td><td>' + p.memoryPercent + '%</td><td>' + podStatusBadge(p.status) + '</td></tr>'
  ).join("");
  tbody.querySelectorAll("tr").forEach(row => {
    row.addEventListener("click", () => selectPod(row.getAttribute("data-pod"), row.getAttribute("data-service")));
  });
}

function selectPod(name, service) {
  currentPod = name;
  currentService = service;
  document.getElementById("selectedPod").textContent = name;
  document.getElementById("actionPodLabel").textContent = name;
  document.getElementById("actionServiceLabel").textContent = service;
  load();
}

async function load() {
  const res = await fetch("/api/overview?pod=" + encodeURIComponent(currentPod));
  const data = await res.json();
  const pod = data.pod;
  currentService = pod.service;
  await loadPodList();

  document.getElementById("podInfo").innerHTML =
    '<div class="kv"><span>Pod</span><span>' + pod.name + '</span></div>' +
    '<div class="kv"><span>Service</span><span>' + pod.service + '</span></div>' +
    '<div class="kv"><span>Memory</span><span>' + (pod.memoryPercent >= 80
      ? '<span class="badge b-red">' + pod.memoryPercent + '%</span>'
      : '<span class="badge b-green">' + pod.memoryPercent + '%</span>') + '</span></div>' +
    '<div class="kv"><span>CPU</span><span>' + pod.cpuPercent + '%</span></div>' +
    '<div class="kv"><span>Status</span><span>' + (pod.status === "healthy"
      ? '<span class="badge b-green">Healthy</span>'
      : '<span class="badge b-red">Degraded</span>') + '</span></div>';

  document.getElementById("deploys").innerHTML = data.deployments.map(d =>
    '<tr><td>' + d.version + '</td><td>' + fmtTime(d.deployedAt) + '</td></tr>'
  ).join("");

  document.getElementById("audit").innerHTML = data.auditLog.map(a =>
    '<tr><td>' + fmtTime(a.createdAt) + '</td><td>' + a.actor + '</td><td>' + a.action + '</td><td>' + a.target + '</td><td>' + outcomeBadge(a.outcome) + '</td><td class="muted">' + (a.detail || "") + '</td></tr>'
  ).join("");
}

async function doAction(kind) {
  const token = document.getElementById("token").value;
  const msgEl = document.getElementById("actionMsg");
  const url = kind === "restart"
    ? "/pods/" + encodeURIComponent(currentPod) + "/restart"
    : "/deployments/" + encodeURIComponent(currentService) + "/rollback";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "x-actor": "demo-presenter", "Content-Type": "application/json" },
    body: kind === "rollback" ? JSON.stringify({ toVersion: "4.11.0" }) : undefined,
  });
  const body = await res.json();
  if (res.ok) {
    msgEl.innerHTML = '<div class="msg ok">Success: ' + (body.result || ('rolled back to ' + body.version)) + '</div>';
  } else {
    msgEl.innerHTML = '<div class="msg err">Refused: ' + body.error + '</div>';
  }
  load();
}

load();
setInterval(load, 5000);
</script>
</body>
</html>`;
