const WORKER = 'https://flowaify-crm-proxy.black-glitter-c4cd.workers.dev';

async function loadDashboardData(token) {
  try {
    const authHeader = 'Bearer ' + token;
    const res = await fetch(WORKER + '/data', {
      headers: { Authorization: authHeader },
    });
    if (!res.ok) {
      console.warn('Worker responded', res.status, await res.text());
      return;
    }
    renderDashboard(await res.json());
  } catch (err) {
    console.warn('CRM load failed:', err.message);
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val != null ? val : '—';
}

function renderDashboard({ overview, contacts }) {
  setText('val-new-leads',     overview.newLeadsToday);
  setText('val-response-time', overview.avgResponseTimeSecs != null ? overview.avgResponseTimeSecs + 's' : '—');
  setText('val-ai-replies',    overview.aiRepliesSent);
  setText('val-follow-ups',    overview.activeSequences);
  setText('val-pipeline',      overview.pipelineValue != null ? '$' + Number(overview.pipelineValue).toLocaleString() : '—');
  setText('val-booked-calls',  overview.bookedCalls);

  const tbody = document.getElementById('leads-table-body');
  const emptyState = document.getElementById('leads-empty-state');
  if (tbody && contacts.length > 0) {
    tbody.innerHTML = contacts.slice(0, 10).map(function(c) {
      return '<tr><td>' + escDash(c.name) + '</td><td>' + escDash(c.source) + '</td>' +
        '<td><span class="badge b-muted">' + escDash(c.status) + '</span></td>' +
        '<td>' + escDash(c.lastTouch) + '</td>' +
        '<td>' + (c.lastTouchAt ? new Date(c.lastTouchAt).toLocaleDateString() : '—') + '</td></tr>';
    }).join('');
    if (emptyState) emptyState.style.display = 'none';
  }
}

function escDash(val) {
  if (val == null || val === '') return '—';
  return String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
