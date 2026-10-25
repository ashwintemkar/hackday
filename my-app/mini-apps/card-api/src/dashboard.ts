export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Meridian Card Services, account console</title>
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
  button.danger { background: #dc2626; }
  button.danger:hover { background: #b91c1c; }
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
  <h1>Meridian Card Services, account console</h1>
  <span class="tag">card-api, live</span>
</header>
<main>
  <div class="card">
    <h2>Cards on this account book</h2>
    <p class="muted">This isn't the only card Meridian services. Click a row to inspect it below.</p>
    <table><thead><tr><th>Card</th><th>Cardholder</th><th>Status</th><th>Transactions</th></tr></thead><tbody id="cardList"></tbody></table>
  </div>

  <div class="row">
    <div class="card">
      <h2>Card status, ending <span id="selectedCard">7734</span></h2>
      <div id="cardInfo"></div>
    </div>
    <div class="card">
      <h2>Known devices on this account</h2>
      <div id="devices"></div>
    </div>
  </div>

  <div class="card">
    <h2>Recent transactions</h2>
    <table><thead><tr><th>When</th><th>Merchant</th><th>Location</th><th>Amount</th><th>Device</th></tr></thead><tbody id="txns"></tbody></table>
  </div>

  <div class="card">
    <h2>Merchant risk</h2>
    <div id="merchants"></div>
  </div>

  <div class="card">
    <h2>Take action</h2>
    <p class="muted">Blocking is the red tier action in the demo, it mutates real account state and requires a token, exactly like a human approved fraud case would.</p>
    <div class="actions">
      <input id="token" type="text" placeholder="Action token" />
      <button class="danger" onclick="doAction('block')">Block card ending <span id="actionCardLabel">7734</span></button>
      <button onclick="doAction('unblock')">Unblock</button>
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

let knownFingerprints = [];
let currentCard = "7734";

async function loadCardList() {
  const res = await fetch("/api/cards");
  const data = await res.json();
  const tbody = document.getElementById("cardList");
  tbody.innerHTML = data.cards.map(c =>
    '<tr style="cursor:pointer" data-card="' + c.last4 + '"><td>' + c.last4 +
      (c.last4 === currentCard ? ' <span class="muted">(selected)</span>' : '') + '</td><td>' + c.cardholderName + '</td><td>' +
      (c.status === "active" ? '<span class="badge b-green">Active</span>' : '<span class="badge b-red">Blocked</span>') +
      '</td><td>' + c.transactionCount + '</td></tr>'
  ).join("");
  tbody.querySelectorAll("tr").forEach(row => {
    row.addEventListener("click", () => selectCard(row.getAttribute("data-card")));
  });
}

function selectCard(last4) {
  currentCard = last4;
  document.getElementById("selectedCard").textContent = last4;
  document.getElementById("actionCardLabel").textContent = last4;
  load();
}

async function load() {
  const res = await fetch("/api/overview?last4=" + encodeURIComponent(currentCard));
  const data = await res.json();
  const c = data.card;
  await loadCardList();
  knownFingerprints = c.knownDevices.map(d => d.fingerprint);

  document.getElementById("cardInfo").innerHTML =
    '<div class="kv"><span>Cardholder</span><span>' + c.cardholderName + '</span></div>' +
    '<div class="kv"><span>Card</span><span>ending ' + c.last4 + '</span></div>' +
    '<div class="kv"><span>Status</span><span>' + (c.status === "active"
      ? '<span class="badge b-green">Active</span>'
      : '<span class="badge b-red">Blocked</span>') + '</span></div>';

  document.getElementById("devices").innerHTML = c.knownDevices.map(d =>
    '<div class="kv"><span>' + d.fingerprint + '</span><span class="muted">since ' + fmtTime(d.firstSeenAt) + '</span></div>'
  ).join("") || '<p class="muted">No known devices.</p>';

  document.getElementById("txns").innerHTML = c.transactions.map(t => {
    const known = knownFingerprints.includes(t.deviceFingerprint);
    return '<tr><td>' + fmtTime(t.occurredAt) + '</td><td>' + t.merchantName + '</td><td>' + t.merchantLocation + '</td><td>$' + t.amount.toFixed(2) + '</td><td>' +
      (known ? '<span class="badge b-green">known</span>' : '<span class="badge b-red">unrecognized</span>') + '</td></tr>';
  }).join("");

  document.getElementById("merchants").innerHTML = data.merchants.map(m =>
    '<div class="kv"><span>' + m.name + '</span><span>' + (m.riskLevel === "elevated"
      ? '<span class="badge b-amber">elevated, ' + m.chargebackRatePct + '% chargebacks</span>'
      : '<span class="badge b-green">normal</span>') + '</span></div>'
  ).join("") || '<p class="muted">No merchant data yet.</p>';

  document.getElementById("audit").innerHTML = data.auditLog.map(a =>
    '<tr><td>' + fmtTime(a.createdAt) + '</td><td>' + a.actor + '</td><td>' + a.action + '</td><td>' + a.target + '</td><td>' + outcomeBadge(a.outcome) + '</td><td class="muted">' + (a.detail || "") + '</td></tr>'
  ).join("");
}

async function doAction(kind) {
  const token = document.getElementById("token").value;
  const msgEl = document.getElementById("actionMsg");
  const res = await fetch("/cards/" + encodeURIComponent(currentCard) + "/" + kind, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "x-actor": "demo-presenter" },
  });
  const body = await res.json();
  if (res.ok) {
    msgEl.innerHTML = '<div class="msg ok">Success: card is now ' + body.status + '</div>';
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
