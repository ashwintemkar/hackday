export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Vantage Broadband, NOC console</title>
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
  .mono { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<header>
  <span class="dot"></span>
  <h1>Vantage Broadband, NOC console</h1>
  <span class="tag">network-api, live</span>
</header>
<main>
  <div class="card">
    <h2>Devices</h2>
    <p class="muted">This NOC watches more than one device. Click a row to inspect it below.</p>
    <table><thead><tr><th>Device</th><th>Model / firmware</th><th>Status</th><th>Max CRC errors / 24h</th></tr></thead><tbody id="deviceList"></tbody></table>
  </div>

  <div class="row">
    <div class="card">
      <h2>Interface status, <span id="selectedDevice">edge-rtr-04</span></h2>
      <div id="ifaces"></div>
    </div>
    <div class="card">
      <h2>CRC counter trend</h2>
      <div id="counters"></div>
    </div>
  </div>

  <div class="row">
    <div class="card">
      <h2>MAC address table</h2>
      <div id="mac"></div>
    </div>
    <div class="card">
      <h2>Recent syslog</h2>
      <div id="logs"></div>
    </div>
  </div>

  <div class="card">
    <h2>Flap history, last 9 days</h2>
    <table><thead><tr><th>When</th><th>Interface</th><th>Event</th></tr></thead><tbody id="flaps"></tbody></table>
  </div>

  <div class="card">
    <h2>Take action</h2>
    <p class="muted">This mirrors the demo's amber tier gate. Without a valid token the action is refused, exactly like the mini app would refuse an unapproved agent call.</p>
    <div class="actions">
      <input id="token" type="text" placeholder="Action token" />
      <button onclick="softClear()">Soft-clear interface on <span id="actionDeviceLabel">edge-rtr-04</span></button>
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

let currentDevice = "edge-rtr-04";

function statusBadge(status) {
  return status === "up" ? '<span class="badge b-green">up</span>' : '<span class="badge b-red">' + status + '</span>';
}

async function loadDeviceList() {
  const res = await fetch("/api/devices");
  const data = await res.json();
  const tbody = document.getElementById("deviceList");
  tbody.innerHTML = data.devices.map(d =>
    '<tr style="cursor:pointer" data-device="' + d.name + '"><td>' + d.name +
      (d.name === currentDevice ? ' <span class="muted">(selected)</span>' : '') + '</td><td class="mono">' + d.model + ' / ' + d.firmwareVersion + '</td><td>' +
      statusBadge(d.status) + '</td><td>' + d.maxCrcErrors24h + '</td></tr>'
  ).join("");
  tbody.querySelectorAll("tr").forEach(row => {
    row.addEventListener("click", () => selectDevice(row.getAttribute("data-device")));
  });
}

function selectDevice(name) {
  currentDevice = name;
  document.getElementById("selectedDevice").textContent = name;
  document.getElementById("actionDeviceLabel").textContent = name;
  load();
}

async function load() {
  const res = await fetch("/api/overview?device=" + encodeURIComponent(currentDevice));
  const data = await res.json();
  const d = data.device;
  await loadDeviceList();

  document.getElementById("ifaces").innerHTML = d.interfaces.map(i =>
    '<div class="kv"><span>' + i.name + '</span><span>' + statusBadge(i.status) + ' ' + i.crcErrors24h + ' CRC / ' + i.resets24h + ' resets</span></div>'
  ).join("") || '<p class="muted">No interfaces.</p>';

  document.getElementById("counters").innerHTML = (d.interfaces[0]?.counterSamples || []).map(s =>
    '<div class="kv"><span>' + fmtTime(s.sampledAt) + '</span><span class="mono">' + s.crcErrors + ' CRC</span></div>'
  ).join("") || '<p class="muted">No samples.</p>';

  document.getElementById("mac").innerHTML = (d.macEntries || []).map(m =>
    '<div class="kv"><span class="mono">' + m.macAddress + '</span><span>VLAN ' + m.vlan + ', ' + m.interfaceName + '</span></div>'
  ).join("") || '<p class="muted">No entries.</p>';

  document.getElementById("logs").innerHTML = '<div class="mono" style="font-size:11.5px; line-height:1.6;">' + (d.logLines || []).map(l =>
    fmtTime(l.loggedAt) + ' ' + l.text
  ).join("<br/>") + '</div>' || '<p class="muted">No log lines.</p>';

  document.getElementById("flaps").innerHTML = d.flapEvents.map(f =>
    '<tr><td>' + fmtTime(f.occurredAt) + '</td><td>' + f.interfaceName + '</td><td>' + f.note + '</td></tr>'
  ).join("");

  document.getElementById("audit").innerHTML = data.auditLog.map(a =>
    '<tr><td>' + fmtTime(a.createdAt) + '</td><td>' + a.actor + '</td><td>' + a.action + '</td><td>' + a.target + '</td><td>' + outcomeBadge(a.outcome) + '</td><td class="muted">' + (a.detail || "") + '</td></tr>'
  ).join("");
}

async function softClear() {
  const token = document.getElementById("token").value;
  const msgEl = document.getElementById("actionMsg");
  const res = await fetch("/devices/" + encodeURIComponent(currentDevice) + "/soft-clear-interface", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "x-actor": "demo-presenter" },
  });
  const body = await res.json();
  if (res.ok) {
    msgEl.innerHTML = '<div class="msg ok">Success: ' + body.result + '</div>';
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
