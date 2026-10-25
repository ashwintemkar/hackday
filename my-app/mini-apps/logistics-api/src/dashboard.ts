export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Continental Fuels, operations console</title>
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
  <h1>Continental Fuels, operations console</h1>
  <span class="tag">logistics-api, live</span>
</header>
<main>
  <div class="card">
    <h2>Purchase orders</h2>
    <p class="muted">Continental Fuels runs more than one order at a time. Click a row to inspect it below.</p>
    <table><thead><tr><th>PO</th><th>Description</th><th>Status</th><th>Carrier</th></tr></thead><tbody id="poList"></tbody></table>
  </div>

  <div class="row">
    <div class="card">
      <h2>Purchase order, <span id="selectedPo">PO-55210</span></h2>
      <div id="poInfo"></div>
    </div>
    <div class="card">
      <h2>Carrier status</h2>
      <div id="shipment"></div>
    </div>
  </div>

  <div class="card">
    <h2>Take action</h2>
    <p class="muted">The agent cannot manufacture a release time that doesn't exist. Escalation notifies a named coordinator instead of guessing, this is the red tier action in the demo.</p>
    <div class="actions">
      <input id="token" type="text" placeholder="Action token" />
      <button onclick="escalate()">Escalate <span id="actionPoLabel">PO-55210</span></button>
    </div>
    <div id="actionMsg"></div>
  </div>

  <div class="card">
    <h2>Audit log</h2>
    <table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Outcome</th><th>Detail</th></tr></thead><tbody id="audit"></tbody></table>
  </div>
</main>

<script>
function fmtTime(iso) { return iso ? new Date(iso).toLocaleString() : "unknown"; }
function outcomeBadge(o) {
  const cls = o === "success" ? "b-green" : o === "denied" ? "b-amber" : "b-red";
  return '<span class="badge ' + cls + '">' + o + '</span>';
}
function statusBadge(s) {
  if (s === "escalated") return '<span class="badge b-amber">Escalated</span>';
  if (s === "delivered") return '<span class="badge b-green">Delivered</span>';
  return '<span class="badge b-red">In transit</span>';
}
function carrierBadge(s) {
  if (s === "delivered") return '<span class="badge b-green">delivered</span>';
  if (s === "held_at_customs") return '<span class="badge b-red">held at customs</span>';
  return '<span class="badge b-amber">' + s.replaceAll("_", " ") + '</span>';
}

let currentPo = "PO-55210";

async function loadPoList() {
  const res = await fetch("/api/purchase-orders");
  const data = await res.json();
  const tbody = document.getElementById("poList");
  tbody.innerHTML = data.purchaseOrders.map(p =>
    '<tr style="cursor:pointer" data-po="' + p.poNumber + '"><td>' + p.poNumber +
      (p.poNumber === currentPo ? ' <span class="muted">(selected)</span>' : '') + '</td><td>' + p.description +
      '</td><td>' + statusBadge(p.status) + '</td><td>' + carrierBadge(p.carrierStatus) + '</td></tr>'
  ).join("");
  tbody.querySelectorAll("tr").forEach(row => {
    row.addEventListener("click", () => selectPo(row.getAttribute("data-po")));
  });
}

function selectPo(poNumber) {
  currentPo = poNumber;
  document.getElementById("selectedPo").textContent = poNumber;
  document.getElementById("actionPoLabel").textContent = poNumber;
  load();
}

async function load() {
  const res = await fetch("/api/overview?poNumber=" + encodeURIComponent(currentPo));
  const data = await res.json();
  const po = data.po;
  const s = po.shipment;
  await loadPoList();

  document.getElementById("poInfo").innerHTML =
    '<div class="kv"><span>PO number</span><span>' + po.poNumber + '</span></div>' +
    '<div class="kv"><span>Description</span><span>' + po.description + '</span></div>' +
    '<div class="kv"><span>Quantity</span><span>' + po.quantity + ' ' + po.unit + '</span></div>' +
    '<div class="kv"><span>Expected</span><span>' + fmtTime(po.expectedDate) + '</span></div>' +
    '<div class="kv"><span>Status</span><span>' + statusBadge(po.status) + '</span></div>';

  document.getElementById("shipment").innerHTML = s ? (
    '<div class="kv"><span>Carrier status</span><span>' + carrierBadge(s.carrierStatus) + '</span></div>' +
    '<div class="kv"><span>Held since</span><span>' + fmtTime(s.heldSince) + '</span></div>' +
    '<div class="kv"><span>Release time known</span><span>' + (s.releaseTimeKnown ? "Yes" : "No") + '</span></div>' +
    '<div class="kv"><span>Notes</span><span class="muted">' + (s.notes || "") + '</span></div>'
  ) : '<p class="muted">No shipment linked.</p>';

  document.getElementById("audit").innerHTML = data.auditLog.map(a =>
    '<tr><td>' + fmtTime(a.createdAt) + '</td><td>' + a.actor + '</td><td>' + a.action + '</td><td>' + a.target + '</td><td>' + outcomeBadge(a.outcome) + '</td><td class="muted">' + (a.detail || "") + '</td></tr>'
  ).join("");
}

async function escalate() {
  const token = document.getElementById("token").value;
  const msgEl = document.getElementById("actionMsg");
  const res = await fetch("/purchase-orders/" + encodeURIComponent(currentPo) + "/escalate", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "x-actor": "demo-presenter" },
  });
  const body = await res.json();
  if (res.ok) {
    msgEl.innerHTML = '<div class="msg ok">Success: escalated, ' + body.notified + ' notified</div>';
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
