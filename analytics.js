// ============================================================================
// analytics.js — Flowaify Analytics Page (v1)
// Replaces the renderAnalyticsStats() and renderCharts() implementations in
// crm.js via window.* overrides (this file loads after crm.js).
//
// Adapted from the product handoff with four codebase-specific fixes:
//   1. renderCharts here KEEPS the Overview page's charts (src-list donut and
//      ch-resp) — the shared function owns both pages, not just Analytics.
//   2. Chart grid/tick colors are theme-aware (the handoff hardcoded white
//      grid lines, which vanish in light mode).
//   3. Await pills use the existing .state-pill markup via anSetPill() — the
//      crm.js setAwaitPill() is built for a different element shape.
//   4. Status Breakdown bars are click-through to the Leads page tabs.
//
// DO NOT call renderFunnel() or renderStageList() here — rerender() in crm.js
// already calls them after renderCharts() returns.
// ============================================================================

'use strict';

// ── BRAND COLOR PALETTE ─────────────────────────────────────────────────────
const AN_COLORS = {
  blue:        '#0057FF',
  blueFill:    'rgba(0,87,255,0.08)',
  amber:       '#f59e0b',
  amberFill:   'rgba(245,158,11,0.08)',
  green:       '#059669',
  purple:      '#8b5cf6',
  purpleMuted: 'rgba(139,92,246,0.45)',
  status: {
    'HOT':     '#dc2626',
    'WARM':    '#d97706',
    'COLD':    '#0057FF',
    'BOOKED':  '#059669',
    'ENGAGED': '#6366f1',
  },
};

// ── SHARED CHART DEFAULTS (theme-aware) ─────────────────────────────────────
function anChartDefaults() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400, easing: 'easeOutQuart' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(10,15,26,0.96)',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        titleColor: '#f8fafc',
        bodyColor: '#94a3b8',
        padding: 10,
        cornerRadius: 8,
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: dark ? 'rgba(232,235,242,0.55)' : '#64748b', font: { size: 11 }, maxRotation: 0, maxTicksLimit: 10 },
        border: { display: false },
      },
      y: {
        beginAtZero: true,
        grid: { color: dark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.06)' },
        ticks: { color: dark ? 'rgba(232,235,242,0.55)' : '#64748b', font: { size: 11 }, stepSize: 1, precision: 0 },
        border: { display: false },
      }
    }
  };
}

// ── SOURCE NAME NORMALIZER ──────────────────────────────────────────────────
function sanitizeSource(raw) {
  if (!raw || String(raw).trim() === '') return 'Unknown';
  const map = {
    'website':       'Website Form',
    'web':           'Website Form',
    'web form':      'Website Form',
    'website form':  'Website Form',
    'facebook':      'Facebook',
    'facebook ads':  'Facebook Ads',
    'fb ads':        'Facebook Ads',
    'instagram':     'Instagram',
    'ig':            'Instagram',
    'google':        'Google',
    'google ads':    'Google Ads',
    'email':         'Email Inbox',
    'email inbox':   'Email Inbox',
    'referral':      'Referral',
    'manual':        'Manual Entry',
    'unknown':       'Unknown',
  };
  return map[String(raw).trim().toLowerCase()] || String(raw).trim();
}
window.sanitizeSource = sanitizeSource;

// ── FORMAT HELPERS ──────────────────────────────────────────────────────────
function fmtDuration(secs) {
  if (secs === null || secs === undefined) return '—';
  if (secs < 60)    return '< 1m';
  if (secs < 3600)  return Math.round(secs / 60) + 'm';
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    const m = Math.round((secs % 3600) / 60);
    return m > 0 ? h + 'h ' + m + 'm' : h + 'h';
  }
  return Math.round(secs / 86400) + 'd';
}

function fmtPipeline(val) {
  if (!val) return '$0';
  if (val >= 1000000) return '$' + (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000)    return '$' + (val / 1000).toFixed(1) + 'k';
  return '$' + Math.round(val);
}

function fmtPct(num, denom) {
  if (!denom) return '0%';
  return Math.round((num / denom) * 100) + '%';
}

// state-pill compatible live/await pill (pill-resp-an, pill-booked)
function anSetPill(id, live, liveText, awaitText) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'state-pill ' + (live ? 'live' : 'awaiting');
  el.innerHTML = '<span class="sp-dot"></span>' + (live ? liveText : awaitText);
  el.style.display = '';
}

function anIsBooked(c) {
  const s = (c.status || '').toUpperCase();
  return s.indexOf('BOOK') !== -1 || s.indexOf('ENGAGED') !== -1;
}

// ── STAT CARDS ──────────────────────────────────────────────────────────────
window.renderAnalyticsStats = function renderAnalyticsStats(data, ranged, days) {
  if (!data) return;

  const contacts = data.contacts || [];
  const deals    = data.deals    || [];
  const overview = data.overview || {};
  const total    = ranged.length;

  // prior same-length window for deltas
  const now = Date.now();
  const winMs = days * 86400000;
  const prevRanged = contacts.filter(function(c) {
    if (!c.createdAt) return false;
    const t = new Date(c.createdAt).getTime();
    return t >= now - 2 * winMs && t < now - winMs;
  });

  // 1. Leads This Period
  if (typeof setKpi === 'function') setKpi('val-an-total', total);
  if (typeof setDelta === 'function') {
    setDelta('delta-an-total', total, prevRanged.length, 'vs prior ' + days + 'd');
  }

  // 2. Conversion Rate — range-aware (booked in range / leads in range)
  const bookedInRange = ranged.filter(anIsBooked).length;
  const prevBooked = prevRanged.filter(anIsBooked).length;
  if (typeof setKpi === 'function') setKpi('val-an-conv', fmtPct(bookedInRange, total));
  if (typeof setDelta === 'function') {
    const curPct = total ? Math.round((bookedInRange / total) * 100) : 0;
    const prevPct = prevRanged.length ? Math.round((prevBooked / prevRanged.length) * 100) : 0;
    setDelta('delta-an-conv', curPct, prevPct, 'vs prior ' + days + 'd');
  }

  // 3. Avg Response — human-readable
  let respSecs = overview.avgResponseTimeSecs || null;
  if (!respSecs) {
    const times = ranged
      .filter(function(c) { return c.createdAt && c.lastTouchAt; })
      .map(function(c) { return (new Date(c.lastTouchAt) - new Date(c.createdAt)) / 1000; })
      .filter(function(t) { return t > 0 && t < 7 * 86400; });
    respSecs = times.length
      ? Math.round(times.reduce(function(a, b) { return a + b; }, 0) / times.length)
      : null;
  }
  if (typeof setKpi === 'function') setKpi('val-an-response', fmtDuration(respSecs));

  // 4. Booked Calls (in range) + delta
  if (typeof setKpi === 'function') setKpi('val-an-booked', bookedInRange);
  if (typeof setDelta === 'function') {
    setDelta('delta-an-booked', bookedInRange, prevBooked, 'vs prior ' + days + 'd');
  }
  anSetPill('pill-booked', bookedInRange > 0, 'Active', 'None yet');

  // 5. Pipeline Value — all-time, never range-filtered
  const pipeline = overview.pipelineValue || deals.reduce(function(s, d) {
    return s + (Number(d.amount) || 0);
  }, 0);
  if (typeof setKpi === 'function') setKpi('val-an-pipeline', fmtPipeline(pipeline));

  // 6. Lead Sources — distinct normalized channels in range
  const sourceSet = new Set(
    ranged.map(function(c) { return sanitizeSource(c.source); })
      .filter(function(s) { return s !== 'Unknown'; })
  );
  if (typeof setKpi === 'function') setKpi('val-an-sources', sourceSet.size || 0);

  // Quick stats inside the Leads Over Time card
  const setEl = function(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setEl('bp-leads',  total);
  setEl('bp-booked', bookedInRange);
  setEl('bp-conv',   fmtPct(bookedInRange, total));
};

// ── CHARTS ──────────────────────────────────────────────────────────────────
window.renderCharts = function renderCharts(data, ranged, days) {
  if (!data || typeof Chart === 'undefined') return;

  const contacts = data.contacts || [];
  const chartSet = ranged.length > 0 ? ranged : [];

  // ── OVERVIEW: Lead Sources donut (raw names — the Leads filter matches
  //    raw source values, so the Overview donut must stay unnormalized) ────
  if (typeof renderSourceList === 'function' && typeof groupCount === 'function') {
    const rawCounts = groupCount(chartSet, function(c) { return c.source; });
    renderSourceList('src-list', rawCounts, 'No leads in this period', 'Widen the date range, or check back when new leads come in.');
  }

  // ── OVERVIEW: Response Time chart (ch-resp) — per-lead seconds trend ────
  (function() {
    const respPoints = contacts.filter(function(c) { return c.createdAt && c.lastTouchAt; })
      .map(function(c) {
        return { ts: new Date(c.createdAt).getTime(), secs: (new Date(c.lastTouchAt).getTime() - new Date(c.createdAt).getTime()) / 1000 };
      })
      .filter(function(p) { return p.secs >= 0 && p.secs < 7 * 86400; })
      .sort(function(a, b) { return a.ts - b.ts; });
    const hasResp = respPoints.length >= 2;
    if (hasResp && typeof mkChart === 'function') {
      const cfg = anChartDefaults();
      cfg.type = 'line';
      cfg.data = {
        labels: respPoints.map(function(p) { return new Date(p.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }),
        datasets: [{ data: respPoints.map(function(p) { return Math.round(p.secs); }), borderColor: AN_COLORS.green, backgroundColor: 'rgba(5,150,105,0.05)', fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2 }]
      };
      cfg.plugins.tooltip.callbacks = { label: function(ctx) { return ' ' + ctx.raw + 's'; } };
      cfg.scales.y.ticks.callback = function(v) { return v + 's'; };
      mkChart('ch-resp', cfg);
    }
    if (typeof chartOverlay === 'function') chartOverlay('ch-resp', !hasResp);
    const pOv = document.getElementById('pill-resp-ov');
    if (pOv) pOv.style.display = hasResp ? 'none' : '';
  }());

  // ── 1. LEADS OVER TIME (an-leads) — brand blue, area fill ───────────────
  (function() {
    const hasData = chartSet.length > 0;
    if (typeof chartOverlay === 'function') chartOverlay('an-leads', !hasData);
    if (!hasData || typeof mkChart !== 'function') return;

    const buckets = timeBuckets(chartSet, days);
    const cfg = anChartDefaults();
    cfg.type = 'line';
    cfg.data = {
      labels: buckets.labels,
      datasets: [{
        label: 'Leads',
        data: buckets.data,
        borderColor: AN_COLORS.blue,
        backgroundColor: AN_COLORS.blueFill,
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: AN_COLORS.blue,
        pointHoverRadius: 5,
        borderWidth: 2,
      }]
    };
    mkChart('an-leads', cfg);
  }());

  // ── 2. RESPONSE TIME TREND (an-resp) — bucketed avg minutes, amber ──────
  (function() {
    const labelList = timeBuckets(chartSet, days).labels;
    const bucketed = {};
    labelList.forEach(function(lbl) { bucketed[lbl] = { sum: 0, count: 0 }; });

    chartSet.forEach(function(c) {
      if (!c.createdAt || !c.lastTouchAt) return;
      const secs = (new Date(c.lastTouchAt) - new Date(c.createdAt)) / 1000;
      if (secs <= 0 || secs > 7 * 86400) return;
      const created = new Date(c.createdAt);
      let lbl;
      if (days <= 30) {
        lbl = created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      } else {
        const mon = new Date(created);
        mon.setDate(created.getDate() - ((created.getDay() + 6) % 7));
        lbl = 'Wk of ' + mon.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }
      if (bucketed[lbl]) { bucketed[lbl].sum += secs; bucketed[lbl].count += 1; }
    });

    // null (not 0) for empty buckets — Chart.js renders a gap
    const respData = labelList.map(function(lbl) {
      return bucketed[lbl] && bucketed[lbl].count > 0
        ? Math.round(bucketed[lbl].sum / bucketed[lbl].count / 60)
        : null;
    });

    const pointCount = respData.filter(function(v) { return v !== null; }).length;
    anSetPill('pill-resp-an', pointCount >= 2, 'Live', 'No data yet');
    if (typeof chartOverlay === 'function') chartOverlay('an-resp', pointCount < 2);
    if (pointCount < 2 || typeof mkChart !== 'function') return;

    const cfg = anChartDefaults();
    cfg.type = 'line';
    cfg.data = {
      labels: labelList,
      datasets: [{
        label: 'Avg Response (min)',
        data: respData,
        borderColor: AN_COLORS.amber,
        backgroundColor: AN_COLORS.amberFill,
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: AN_COLORS.amber,
        pointHoverRadius: 5,
        borderWidth: 2,
        spanGaps: false,
      }]
    };
    cfg.plugins.tooltip.callbacks = { label: function(ctx) { return ' ' + ctx.parsed.y + ' min avg'; } };
    mkChart('an-resp', cfg);
  }());

  // ── 3. STATUS BREAKDOWN (an-status) — click-through to Leads tabs ───────
  (function() {
    const statusOrder = ['HOT', 'WARM', 'COLD', 'BOOKED', 'ENGAGED'];
    const counts = {};
    statusOrder.forEach(function(s) { counts[s] = 0; });
    chartSet.forEach(function(c) {
      const s = (c.status || '').toUpperCase().trim();
      if (s.indexOf('HOT') !== -1) counts.HOT++;
      else if (s.indexOf('WARM') !== -1) counts.WARM++;
      else if (s.indexOf('COLD') !== -1) counts.COLD++;
      else if (s.indexOf('BOOK') !== -1) counts.BOOKED++;
      else if (s.indexOf('ENGAGED') !== -1) counts.ENGAGED++;
    });

    const active = statusOrder.filter(function(s) { return counts[s] > 0; });
    const hasData = active.length > 0;
    if (typeof chartOverlay === 'function') chartOverlay('an-status', !hasData);
    if (!hasData || typeof mkChart !== 'function') return;

    const tabMap = { HOT: 'hot', WARM: 'warm', COLD: 'cold', BOOKED: 'booked', ENGAGED: 'booked' };
    const cfg = anChartDefaults();
    cfg.type = 'bar';
    cfg.data = {
      labels: active,
      datasets: [{
        data: active.map(function(s) { return counts[s]; }),
        backgroundColor: active.map(function(s) { return AN_COLORS.status[s] || '#64748b'; }),
        borderRadius: 2,
        borderSkipped: false,
        maxBarThickness: 60,
      }]
    };
    cfg.plugins.tooltip.callbacks = { label: function(ctx) { return ' ' + ctx.parsed.y + ' leads — click to view'; } };
    cfg.onClick = function(evt, els) {
      if (!els || !els.length) return;
      const label = active[els[0].index];
      const tab = tabMap[label] || 'all';
      if (typeof showPage === 'function') showPage('leads');
      setTimeout(function() { if (window.leadsSetTab) leadsSetTab(tab); }, 120);
    };
    cfg.onHover = function(evt, els) {
      evt.native.target.style.cursor = els.length ? 'pointer' : 'default';
    };
    mkChart('an-status', cfg);
  }());

  // ── 4. BOOKED CALLS OVER TIME (an-booked-chart) — from contact status ───
  (function() {
    const booked = chartSet.filter(anIsBooked);
    const hasData = booked.length > 0;
    if (typeof chartOverlay === 'function') chartOverlay('an-booked-chart', !hasData);
    if (!hasData || typeof mkChart !== 'function') return;

    const buckets = timeBuckets(booked, days);
    const cfg = anChartDefaults();
    cfg.type = 'bar';
    cfg.data = {
      labels: buckets.labels,
      datasets: [{
        label: 'Booked',
        data: buckets.data,
        backgroundColor: AN_COLORS.green,
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 32,
      }]
    };
    cfg.plugins.tooltip.callbacks = { label: function(ctx) { return ' ' + ctx.parsed.y + ' booked'; } };
    mkChart('an-booked-chart', cfg);
  }());

  // ── 5. NEW LEADS BY DAY OF WEEK (an-dow) — all-time, peak highlighted ───
  (function() {
    const hasData = contacts.length > 0;
    if (typeof chartOverlay === 'function') chartOverlay('an-dow', !hasData);
    if (!hasData || typeof mkChart !== 'function') return;

    const dowLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dowCounts = [0, 0, 0, 0, 0, 0, 0];
    contacts.forEach(function(c) {
      if (!c.createdAt) return;
      const js = new Date(c.createdAt).getDay();
      dowCounts[js === 0 ? 6 : js - 1]++;
    });

    const peak = Math.max.apply(null, dowCounts);
    const bgColors = dowCounts.map(function(v) {
      return v === peak && peak > 0 ? AN_COLORS.purple : AN_COLORS.purpleMuted;
    });

    const cfg = anChartDefaults();
    cfg.type = 'bar';
    cfg.data = {
      labels: dowLabels,
      datasets: [{
        label: 'Leads',
        data: dowCounts,
        backgroundColor: bgColors,
        borderRadius: 5,
        borderSkipped: false,
        maxBarThickness: 44,
      }]
    };
    cfg.plugins.tooltip.callbacks = { label: function(ctx) { return ' ' + ctx.parsed.y + ' leads on ' + ctx.label + 's'; } };
    mkChart('an-dow', cfg);
  }());

  // ── 6. SOURCE PERFORMANCE (an-srclist) — normalized names ───────────────
  (function() {
    if (typeof renderSourceList !== 'function' || typeof groupCount !== 'function') return;
    const normalized = groupCount(chartSet, function(c) { return sanitizeSource(c.source); });
    renderSourceList('an-srclist', normalized, 'No sources yet', 'Lead sources appear once contacts sync.');
  }());
};

// ── ANALYTICS INIT — called by showPage('analytics') ────────────────────────
// Chart.js canvases inside display:none pages don't draw correctly; force a
// rerender into the now-visible page, then refresh data in the background.
window.analyticsInit = function analyticsInit() {
  if (window.__crmData && typeof rerender === 'function') {
    rerender();
  }
  if (typeof refreshData === 'function') {
    refreshData(true);
  }
};
