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

function renderDashboard({ overview, contacts, deals, needsAttention }) {
  // ── Overview stat cards ──────────────────────────────────────────────────────
  setText('val-new-leads',     overview.newLeadsToday);
  setText('val-response-time', overview.avgResponseTimeSecs != null ? overview.avgResponseTimeSecs + 's' : '—');
  setText('val-ai-replies',    overview.aiRepliesSent);
  setText('val-follow-ups',    overview.activeSequences);
  setText('val-pipeline',      overview.pipelineValue != null ? '$' + Number(overview.pipelineValue).toLocaleString() : '—');
  setText('val-booked-calls',  overview.bookedCalls);

  // ── Overview recent leads table ──────────────────────────────────────────────
  const tbody = document.getElementById('leads-table-body');
  const emptyState = document.getElementById('leads-empty-state');
  if (tbody && contacts.length > 0) {
    tbody.innerHTML = contacts.slice(0, 10).map(function(c) {
      return '<tr>' +
        '<td><div style="font-weight:600;font-size:12.5px;">' + escDash(c.name) + '</div>' +
        (c.email ? '<div style="font-size:10.5px;color:var(--text-m);">' + escDash(c.email) + '</div>' : '') +
        (c.phone ? '<div style="font-size:10.5px;color:var(--text-m);">' + escDash(c.phone) + '</div>' : '') +
        '</td>' +
        '<td>' + escDash(c.source) + '</td>' +
        '<td><span class="badge b-muted">' + escDash(c.status) + '</span></td>' +
        '<td>' + escDash(c.lastTouch) + '</td>' +
        '<td>' + (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—') + '</td>' +
        '</tr>';
    }).join('');
    if (emptyState) emptyState.style.display = 'none';
  }

  // ── Leads page full table ────────────────────────────────────────────────────
  setText('val-total-leads', contacts.length);
  const countEl = document.getElementById('leads-page-count');
  if (countEl) countEl.textContent = contacts.length + ' contacts';

  const fullTbody = document.getElementById('full-leads-tbody');
  const fullEmpty = document.getElementById('full-leads-empty');
  if (fullTbody && contacts.length > 0) {
    fullTbody.innerHTML = contacts.map(function(c) {
      return '<tr>' +
        '<td><div style="font-weight:600;font-size:12.5px;">' + escDash(c.name) + '</div></td>' +
        '<td>' +
        (c.email ? '<div style="font-size:11.5px;">' + escDash(c.email) + '</div>' : '') +
        (c.phone ? '<div style="font-size:10.5px;color:var(--text-m);">' + escDash(c.phone) + '</div>' : '') +
        '</td>' +
        '<td>' + escDash(c.source) + '</td>' +
        '<td><span class="badge b-muted">' + escDash(c.status) + '</span></td>' +
        '<td>—</td>' +
        '<td>' + (c.lastTouchAt ? new Date(c.lastTouchAt).toLocaleDateString() : '—') + '</td>' +
        '<td>—</td>' +
        '<td>—</td>' +
        '</tr>';
    }).join('');
    if (fullEmpty) fullEmpty.style.display = 'none';
  }

  // ── Needs Attention ──────────────────────────────────────────────────────────
  const attnList = document.getElementById('attn-list');
  const attnEmpty = document.getElementById('attn-empty');
  if (attnList && needsAttention && needsAttention.length > 0) {
    attnList.innerHTML = needsAttention.map(function(c) {
      return '<div class="attn-item">' +
        '<div class="attn-dot" style="background:var(--amber);"></div>' +
        '<div>' +
        '<div class="attn-title">' + escDash(c.name) + '</div>' +
        '<div class="attn-sub">' + escDash(c.status) + ' · No touch in 24h+</div>' +
        '</div></div>';
    }).join('');
    if (attnEmpty) attnEmpty.style.display = 'none';
  }

  // ── Lead Sources donut chart ─────────────────────────────────────────────────
  if (contacts.length > 0 && typeof Chart !== 'undefined') {
    var srcCounts = {};
    contacts.forEach(function(c) {
      var src = c.source || 'Unknown';
      srcCounts[src] = (srcCounts[src] || 0) + 1;
    });
    var srcLabels = Object.keys(srcCounts);
    var srcData   = srcLabels.map(function(k) { return srcCounts[k]; });
    var palette   = ['#0057FF','#8b5cf6','#059669','#d97706','#dc2626','#2979FF','#4d94ff','#64748b'];

    var srcCanvas = document.getElementById('ch-src');
    if (srcCanvas) {
      var existing = Chart.getChart(srcCanvas);
      if (existing) existing.destroy();
      new Chart(srcCanvas, {
        type: 'doughnut',
        data: {
          labels: srcLabels,
          datasets: [{ data: srcData, backgroundColor: palette.slice(0, srcLabels.length), borderWidth: 0 }]
        },
        options: {
          cutout: '68%',
          plugins: {
            legend: { display: true, position: 'bottom', labels: { font: { size: 10 }, padding: 8, boxWidth: 10 } }
          },
          animation: { duration: 400 }
        }
      });
      var srcWrap = srcCanvas.closest('.chart-wrap');
      if (srcWrap) { var ce = srcWrap.querySelector('.chart-empty'); if (ce) ce.style.display = 'none'; }
    }
  }

  // ── Pipeline by stage bar chart ──────────────────────────────────────────────
  if (deals && deals.length > 0 && typeof Chart !== 'undefined') {
    var stageTotals = {};
    deals.forEach(function(d) {
      var stage = d.stage || 'Unknown';
      stageTotals[stage] = (stageTotals[stage] || 0) + (d.amount || 0);
    });
    var stageLabels = Object.keys(stageTotals);
    var stageData   = stageLabels.map(function(k) { return stageTotals[k]; });

    var pipeCanvas = document.getElementById('an-pipestage');
    if (pipeCanvas) {
      var existingPipe = Chart.getChart(pipeCanvas);
      if (existingPipe) existingPipe.destroy();
      new Chart(pipeCanvas, {
        type: 'bar',
        data: {
          labels: stageLabels,
          datasets: [{ data: stageData, backgroundColor: '#0057FF', borderRadius: 4 }]
        },
        options: {
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: function(ctx) { return '$' + Number(ctx.raw).toLocaleString(); } } }
          },
          scales: {
            x: { ticks: { font: { size: 10 } } },
            y: { ticks: { callback: function(v) { return '$' + Number(v).toLocaleString(); }, font: { size: 10 } } }
          },
          animation: { duration: 400 }
        }
      });
      var pipeWrap = pipeCanvas.closest('.chart-wrap');
      if (pipeWrap) { var pce = pipeWrap.querySelector('.chart-empty'); if (pce) pce.style.display = 'none'; }
    }
  }
}

function escDash(val) {
  if (val == null || val === '') return '—';
  return String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
