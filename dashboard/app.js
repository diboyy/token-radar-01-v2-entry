// Token Radar v2 dashboard: board, filters, detail, pins, compare, palette, CSV,
// model sandbox and hash state. Static page, no network: all data comes from
// window.RADAR in ../data.js, written by main.ts from the same board.
(function () {
  'use strict';
  var D = window.RADAR;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var fmt$ = function (n) {
    if (n == null) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  };
  var fmtPct = function (n) { return n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; };
  var fmtAge = function (a) {
    if (a == null) return '—';
    if (a >= 365) return (a / 365).toFixed(1) + 'y';
    return a + 'd';
  };
  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var bySlug = {};
  D.rows.forEach(function (r) { bySlug[r.s] = r; });
  D.live.forEach(function (r) { bySlug[r.s] = r; });

  // ---- state ---------------------------------------------------------------
  var state = { tab: 'board', q: '', chain: '', cat: '', wl: false, min: 0, sort: 'v', dir: -1, row: null, dtab: 'overview' };
  var pinned = [];
  var sb = { base: D.model.base_multiple, gw: D.model.growth_weight, mf: D.model.maturity_floor, rd: D.model.readiness_discount };
  var sbDefault = { base: D.model.base_multiple, gw: D.model.growth_weight, mf: D.model.maturity_floor, rd: D.model.readiness_discount };
  var sbActive = function () {
    return sb.base !== sbDefault.base || sb.gw !== sbDefault.gw || sb.mf !== sbDefault.mf || sb.rd !== sbDefault.rd;
  };

  // ---- model recompute (sandbox) -------------------------------------------
  function impliedOf(r) {
    if (!sbActive()) return r.v;
    var g = clamp(r.g == null ? 0 : r.g, D.model.growth_floor, D.model.growth_cap);
    var growth = 1 + (g / 100) * sb.gw;
    var age = r.a == null ? D.model.unknown_age_days : r.a;
    var d = (age - D.model.maturity_peak_days) / D.model.maturity_width_days;
    var mat = sb.mf + D.model.maturity_range * Math.exp(-(d * d));
    var cat = D.category_mult[r.c || ''] || 1;
    var ch = 1 + 0.02 * Math.min(Math.max(r.ch.length - 1, 0), 5);
    var ready = r.f && r.f[4] < 1 ? sb.rd : 1;
    return Math.max(1, Math.round(r.t * sb.base * growth * mat * cat * ch * ready));
  }
  function traded(r) { return r.f ? r.f[4] < 1 : false; }

  // ---- header facts, signals, category table -------------------------------
  // The facts panel in the header: the board's claim in numbers, read from the
  // same data.js as the table, so the header and the board can never disagree.
  // Watchlist coverage is shown as 40/40: every watched slug is on the board.
  function renderStats() {
    $('facts').innerHTML = [
      ['Watchlist covered', '<b>' + D.watchlist_size + '/' + D.watchlist_size + '</b>'],
      ['Ranked protocols', '<b>' + D.board_size + '</b>'],
      ['At/above the $50M floor', '<b>' + D.floor_size + '</b>'],
      ['Early rows below the floor', '<b>' + D.early_size + '</b>'],
      ['Live tokens set aside', '<b>' + D.live_size + '</b>'],
      ['Top 5 share of implied value', '<b>' + D.concentration.top5_share_pct.toFixed(1) + '%</b>'],
      ['Snapshot', '<b>' + esc(D.as_of) + '</b>']
    ].map(function (p) { return '<div class="fact"><span>' + p[0] + '</span>' + p[1] + '</div>'; }).join('');
    $('foot').textContent = 'Snapshot ' + D.as_of + ' · Source: DefiLlama protocols · Floor $' +
      D.floor_usd.toLocaleString('en-US') + ' · Model ' + D.model_version +
      ' · Implied values are this entry\u2019s own claim from the snapshot\u2019s figures, not a prediction that a token launches.';
  }
  function ladderItem(r, valHtml) {
    return '<li data-slug="' + esc(r.s) + '">' + esc(r.n) + ' <span class="val">' + valHtml + '</span></li>';
  }
  function renderSignals() {
    var byVal = D.rows.slice().sort(function (a, b) { return impliedOf(b) - impliedOf(a) || (a.s < b.s ? -1 : 1); }).slice(0, 5);
    var byGro = D.rows.slice().sort(function (a, b) { return (b.g == null ? -1e9 : b.g) - (a.g == null ? -1e9 : a.g) || (a.s < b.s ? -1 : 1); }).slice(0, 5);
    $('signals').innerHTML =
      '<div class="ladder"><h3>Top signals — implied value</h3><ol>' +
      byVal.map(function (r) { return ladderItem(r, fmt$(impliedOf(r))); }).join('') + '</ol></div>' +
      '<div class="ladder"><h3>Top signals — 7-day growth</h3><ol>' +
      byGro.map(function (r) { return ladderItem(r, '<span class="g">' + fmtPct(r.g) + '</span>'); }).join('') + '</ol></div>';
  }
  function renderCatTable() {
    var cats = Object.keys(D.category_mult).sort(function (a, b) {
      return D.category_mult[b] - D.category_mult[a] || (a < b ? -1 : 1);
    });
    $('catTable').innerHTML = '<div class="cat-grid">' + cats.map(function (c) {
      return '<span>' + esc(c) + ' <b>&times;' + D.category_mult[c].toFixed(2) + '</b></span>';
    }).join('') + '<span>Unlisted / none <b>&times;1.00</b></span></div>';
  }

  // ---- attribution ------------------------------------------------------------
  // The watchlist's share of value, read from dashboard/attribution.json, the
  // sibling file main.ts writes into the output dashboard. It renders into the
  // section index.html reserves for it and leaves the board untouched when the
  // file is absent (file:// fetches refuse, the shipped page is served).
  function attributionPanel(report) {
    var host = $('attribution-body');
    if (!host) return;
    var top = report.entries.slice(0, 10);
    var head = '<p class="attribution-head">' + report.entries.length + ' watched protocols hold ' + fmt$(report.watchlistTvlUsd) +
      ' of locked value and ' + fmt$(report.watchlistImpliedUsd) + ' of implied value, ' +
      (report.watchlistImpliedShare * 100).toFixed(1) + '% of the board. The leader holds ' +
      (report.concentration.topOne * 100).toFixed(1) + '% of the watched total.</p>';
    var rows = '<div class="attribution-rows">' + top.map(function (e) {
      return '<div class="attribution-row"><span class="attribution-rank">#' + e.rank + '</span>' +
        '<span class="attribution-name">' + esc(e.name) + '</span>' +
        '<span class="attribution-category">' + esc(e.category || 'uncategorised') + '</span>' +
        '<span class="attribution-value">' + fmt$(e.impliedUsd) + '</span>' +
        '<span class="attribution-share">' + (e.impliedShare * 100).toFixed(1) + '%</span>' +
        '<span class="attribution-tvl">TVL ' + (e.tvlShare * 100).toFixed(1) + '%</span></div>';
    }).join('') + '</div>';
    var foot = '<p class="attribution-foot">Top five hold ' + (report.concentration.topFive * 100).toFixed(1) +
      '%; top ten hold ' + (report.concentration.topTen * 100).toFixed(1) +
      '%. The middle watched name holds ' + (report.concentration.medianImplied * 100).toFixed(2) +
      '%, and the watchlist behaves like ' + report.concentration.effectiveCount.toFixed(1) + ' equal names.</p>';
    host.innerHTML = head + rows + foot;
  }
  function loadAttribution() {
    if (typeof fetch !== 'function') return;
    fetch('attribution.json').then(function (res) {
      if (!res.ok) throw new Error('attribution missing');
      return res.json();
    }).then(function (report) {
      if (report && report.entries && report.entries.length > 0) attributionPanel(report);
    }).catch(function () {
      var host = $('attribution-body');
      if (host) host.textContent = 'Attribution is not available in this copy.';
    });
  }

  // ---- sandbox --------------------------------------------------------------
  var SB_DEFS = [
    ['base', 'Base multiple (TVL ×)', 0.1, 0.5, 0.01],
    ['gw', 'Growth weight', 0, 1, 0.05],
    ['mf', 'Maturity floor', 0.4, 0.9, 0.05],
    ['rd', 'Already-traded discount', 0.05, 0.5, 0.05]
  ];
  function renderSandbox() {
    $('sandbox').innerHTML = SB_DEFS.map(function (d) {
      return '<div><label>' + d[0] + ' — ' + d[1] + ' <output id="sb-' + d[0] + '">' + sb[d[0]].toFixed(2) + '</output></label>' +
        '<input type="range" data-k="' + d[0] + '" min="' + d[2] + '" max="' + d[3] + '" step="' + d[4] + '" value="' + sb[d[0]] + '" aria-label="' + d[1] + '"></div>';
    }).join('');
    $('sandbox').querySelectorAll('input[type="range"]').forEach(function (el) {
      el.addEventListener('input', function () {
        sb[el.getAttribute('data-k')] = parseFloat(el.value);
        $('sb-' + el.getAttribute('data-k')).textContent = sb[el.getAttribute('data-k')].toFixed(2);
        $('sandboxNote').textContent = sbActive()
          ? 'Sandbox active: the board below re-ranks on these values. The shipped board.json is unchanged.'
          : '';
        renderSignals();
        renderTable();
        if (state.row) renderDetail();
      });
    });
    $('sandboxReset').onclick = function () {
      sb = { base: sbDefault.base, gw: sbDefault.gw, mf: sbDefault.mf, rd: sbDefault.rd };
      $('sandboxNote').textContent = '';
      renderSandbox();
      renderSignals();
      renderTable();
      if (state.row) renderDetail();
    };
  }

  // ---- filters ---------------------------------------------------------------
  function chainOptions() {
    var counts = {};
    D.rows.forEach(function (r) { r.ch.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
  }
  function catOptions() {
    var set = {};
    D.rows.forEach(function (r) { if (r.c) set[r.c] = 1; });
    return Object.keys(set).sort();
  }
  function fillSelect(el, opts, allLabel) {
    el.innerHTML = '<option value="">' + allLabel + '</option>' + opts.map(function (o) {
      return '<option value="' + esc(o) + '">' + esc(o) + '</option>';
    }).join('');
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.wl && !r.w) return false;
      if (state.chain && r.ch.indexOf(state.chain) < 0) return false;
      if (state.cat && r.c !== state.cat) return false;
      if (state.min > 0 && r.t < state.min) return false;
      if (q && r.n.toLowerCase().indexOf(q) < 0 && r.s.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function filteredLive() {
    var q = state.q.trim().toLowerCase();
    return D.live.filter(function (r) {
      if (state.chain && r.ch.indexOf(state.chain) < 0) return false;
      if (state.cat && r.c !== state.cat) return false;
      if (state.min > 0 && r.t < state.min) return false;
      if (q && r.n.toLowerCase().indexOf(q) < 0 && r.s.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  var SORTS = {
    r: function (a, b) { return a.r - b.r; },
    n: function (a, b) { return a.n < b.n ? -1 : a.n > b.n ? 1 : 0; },
    c: function (a, b) { return (a.c || '') < (b.c || '') ? -1 : (a.c || '') > (b.c || '') ? 1 : 0; },
    ch: function (a, b) { return a.ch.length - b.ch.length || ((a.ch[0] || '') < (b.ch[0] || '') ? -1 : 1); },
    t: function (a, b) { return a.t - b.t; },
    g: function (a, b) { return (a.g == null ? -1e9 : a.g) - (b.g == null ? -1e9 : b.g); },
    a: function (a, b) { return (a.a == null ? -1 : a.a) - (b.a == null ? -1 : b.a); },
    v: function (a, b) { return impliedOf(a) - impliedOf(b); },
    m: function (a, b) { return (a.m || 0) - (b.m || 0); }
  };
  function sortedRows(rows) {
    var isLive = state.tab === 'live';
    var key = state.sort;
    if (isLive && (key === 'v' || key === 'r' || key === 'a')) key = 'm';
    if (!isLive && key === 'm') key = 'v';
    var fn = SORTS[key] || SORTS.v;
    var dir = state.dir;
    return rows.slice().sort(function (a, b) { return fn(a, b) * dir || (a.s < b.s ? -1 : 1); });
  }

  // ---- table -----------------------------------------------------------------
  var sortKey = 'v';
  function th(key, label, num) {
    var arrow = sortKey === key ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th data-sort="' + key + '" class="' + (num ? 'num' : '') + '" scope="col">' + label + '<span class="dir">' + arrow + '</span></th>';
  }
  function badges(r) {
    var b = '';
    if (r.w) b += '<span class="badge wl">watchlist</span>';
    if (r.f && traded(r)) b += '<span class="badge traded">Already-traded product</span>';
    return b;
  }
  function renderTable() {
    var wrap = $('tableWrap');
    var isLive = state.tab === 'live';
    sortKey = isLive && (state.sort === 'v' || state.sort === 'r' || state.sort === 'a') ? 'm' : state.sort;
    var rows = sortedRows(isLive ? filteredLive() : filteredRows());
    var head, body;
    if (isLive) {
      head = '<tr>' + th('n', 'Protocol') + th('c', 'Category') + th('ch', 'Chains') + th('t', 'TVL', 1) + th('g', '7d', 1) + th('m', 'Market cap', 1) + '</tr>';
      body = rows.map(function (r) {
        return '<tr data-slug="' + esc(r.s) + '"><td class="name">' + esc(r.n) + '<span class="badge live">live token</span></td><td class="cat">' +
          esc(r.c || '—') + '</td><td>' + esc(r.ch.slice(0, 2).join(', ')) + (r.ch.length > 2 ? ' +' + (r.ch.length - 2) : '') + '</td><td class="num">' +
          fmt$(r.t) + '</td><td class="num">' + fmtPct(r.g) + '</td><td class="num">' + fmt$(r.m) + '</td></tr>';
      }).join('');
    } else {
      head = '<tr>' + th('r', '#', 1) + th('n', 'Protocol') + th('c', 'Category') + th('ch', 'Chains') + th('t', 'TVL', 1) + th('g', '7d', 1) + th('a', 'Age', 1) + th('v', 'Implied value', 1) + '</tr>';
      body = rows.map(function (r) {
        var pin = pinned.indexOf(r.s) >= 0;
        // The pin is a quiet text button, shown only on hover or when pinned
        // (see .pinbtn in app.css): the v2 shot's red pin on every row was
        // visual noise, and the button still works the same way.
        return '<tr data-slug="' + esc(r.s) + '"' + (pin ? ' class="pinned-row"' : '') + '><td class="num">' + r.r + '</td><td class="name">' +
          '<button class="pinbtn' + (pin ? ' on' : '') + '" data-pin="' + esc(r.s) + '" title="Pin to compare" aria-label="Pin ' + esc(r.n) + ' to compare">' + (pin ? 'Pinned' : 'Pin') + '</button> ' +
          esc(r.n) + badges(r) + '</td><td class="cat">' + esc(r.c || '—') + '</td><td>' + esc(r.ch.slice(0, 2).join(', ')) +
          (r.ch.length > 2 ? ' +' + (r.ch.length - 2) : '') + '</td><td class="num">' + fmt$(r.t) + '</td><td class="num">' +
          fmtPct(r.g) + '</td><td class="num">' + fmtAge(r.a) + '</td><td class="num"><b>' + fmt$(impliedOf(r)) + '</b></td></tr>';
      }).join('');
    }
    wrap.innerHTML = '<div class="count">' + rows.length + ' of ' + (isLive ? D.live_size : D.board_size) +
      (isLive ? ' live tokens' : ' ranked protocols') + (sbActive() && !isLive ? ' · sandbox values shown' : '') + '</div>' +
      '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
    wrap.querySelectorAll('th[data-sort]').forEach(function (el) {
      el.addEventListener('click', function () {
        var k = el.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir;
        else { state.sort = k; state.dir = k === 'n' || k === 'c' || k === 'ch' ? 1 : -1; }
        writeHash();
        renderTable();
      });
    });
    wrap.querySelectorAll('tr[data-slug]').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        if (ev.target.getAttribute('data-pin')) return;
        openDetail(el.getAttribute('data-slug'));
      });
    });
    wrap.querySelectorAll('[data-pin]').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        togglePin(el.getAttribute('data-pin'));
      });
    });
  }

  // ---- detail ------------------------------------------------------------------
  function openDetail(slug) {
    state.row = slug;
    state.dtab = 'overview';
    writeHash();
    renderDetail();
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function factorRows(r) {
    var g = clamp(r.g == null ? 0 : r.g, D.model.growth_floor, D.model.growth_cap);
    var base = Math.round(r.t * sb.base);
    return [
      ['TVL × base multiple', fmt$(r.t) + ' × ' + sb.base.toFixed(2), fmt$(base)],
      ['Growth', fmtPct(g) + ' → ×' + r.f[0].toFixed(2), '×' + (sbActive() ? (1 + (g / 100) * sb.gw).toFixed(2) : r.f[0].toFixed(2))],
      ['Maturity', (r.a == null ? 'unknown age (365d)' : r.a + ' days') + ' → ×' + r.f[1].toFixed(2), '×' + r.f[1].toFixed(2)],
      ['Category', esc(r.c || 'none') + ' → ×' + r.f[2].toFixed(2), '×' + r.f[2].toFixed(2)],
      ['Chains', r.ch.length + ' chain' + (r.ch.length === 1 ? '' : 's') + ' → ×' + r.f[3].toFixed(2), '×' + r.f[3].toFixed(2)],
      ['Readiness', traded(r) ? 'already-traded product → ×' + sb.rd.toFixed(2) : 'pre-token launch → ×1.00', '×' + (traded(r) ? sb.rd.toFixed(2) : '1.00')],
      ['Implied value', 'product of the factors above', fmt$(impliedOf(r))]
    ];
  }
  function renderDetail() {
    var box = $('detail');
    var r = bySlug[state.row];
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var isLive = r.m !== undefined && r.v === undefined;
    var tabs = isLive
      ? [['overview', 'Overview']]
      : [['overview', 'Overview'], ['model', 'Model breakdown'], ['farm', 'Farm plan']];
    var html = '<h2>' + esc(r.n) + badges(r) + (isLive ? '<span class="badge live">live token</span>' : '') + '</h2>' +
      '<div class="detail-tabs">' + tabs.map(function (t) {
        return '<button type="button" data-dtab="' + t[0] + '" aria-selected="' + (state.dtab === t[0]) + '">' + t[1] + '</button>';
      }).join('') + '</div>';
    if (state.dtab === 'overview' || isLive) {
      html += '<p><b>Category:</b> ' + esc(r.c || '—') + ' · <b>Chains:</b> ' + esc(r.ch.join(', ') || '—') +
        ' · <b>TVL:</b> ' + fmt$(r.t) + ' · <b>7-day change:</b> ' + fmtPct(r.g) + ' · <b>Age:</b> ' + fmtAge(r.a) + '</p>';
      if (isLive) {
        html += '<p><b>Market cap:</b> ' + fmt$(r.m) + '. This token already trades, so the board shows the market\u2019s own value for it and never mixes it into the ranking.</p>';
      } else {
        html += '<p><b>Rank:</b> #' + r.r + ' of ' + D.board_size + ' · <b>Implied value:</b> ' + fmt$(impliedOf(r)) +
          (traded(r) ? ' · Already-traded product: the readiness discount ×' + sb.rd.toFixed(2) + ' holds it at the bottom of the board.' : '') +
          ' · Records no token (no market cap, no CoinGecko id, no symbol).</p>';
      }
    } else if (state.dtab === 'model') {
      html += '<table class="factors"><thead><tr><th>Factor</th><th>Input</th><th class="num">Value</th></tr></thead><tbody>' +
        factorRows(r).map(function (f) {
          return '<tr><td>' + f[0] + '</td><td>' + f[1] + '</td><td class="num">' + f[2] + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="muted small">Every factor comes from the snapshot\u2019s own figures for this protocol; no name is ever special-cased.</p>';
    } else {
      html += '<ol class="farm">' + r.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    }
    box.innerHTML = html;
    box.hidden = false;
    box.querySelectorAll('[data-dtab]').forEach(function (el) {
      el.addEventListener('click', function () {
        state.dtab = el.getAttribute('data-dtab');
        renderDetail();
      });
    });
  }

  // ---- pins + compare -----------------------------------------------------------
  function togglePin(slug) {
    var i = pinned.indexOf(slug);
    if (i >= 0) pinned.splice(i, 1);
    else {
      if (pinned.length >= 3) { pinned.shift(); }
      pinned.push(slug);
    }
    renderCompare();
    renderTable();
  }
  function renderCompare() {
    var bar = $('compareBar');
    if (pinned.length === 0) { bar.hidden = true; bar.innerHTML = ''; return; }
    var rows = pinned.map(function (s) { return bySlug[s]; }).filter(Boolean);
    var attrs = [
      ['Implied value', function (r) { return fmt$(impliedOf(r)); }],
      ['Rank', function (r) { return '#' + r.r; }],
      ['TVL', function (r) { return fmt$(r.t); }],
      ['7-day change', function (r) { return fmtPct(r.g); }],
      ['Age', function (r) { return fmtAge(r.a); }],
      ['Category', function (r) { return esc(r.c || '—'); }],
      ['Chains', function (r) { return esc(r.ch.join(', ')); }],
      ['Readiness', function (r) { return traded(r) ? '×' + sb.rd.toFixed(2) + ' already-traded' : '×1.00 pre-token'; }]
    ];
    bar.innerHTML = '<b>Compare (' + rows.length + '/3):</b> ' +
      rows.map(function (r) { return esc(r.n) + ' <button type="button" data-unpin="' + esc(r.s) + '" aria-label="Remove ' + esc(r.n) + '">✕</button>'; }).join(' · ') +
      '<table><thead><tr><th></th>' + rows.map(function (r) { return '<th>' + esc(r.n) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      attrs.map(function (a) {
        return '<tr><td>' + a[0] + '</td>' + rows.map(function (r) { return '<td>' + a[1](r) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
    bar.hidden = false;
    bar.querySelectorAll('[data-unpin]').forEach(function (el) {
      el.addEventListener('click', function () { togglePin(el.getAttribute('data-unpin')); });
    });
  }

  // ---- CSV -----------------------------------------------------------------------
  function exportCSV() {
    var isLive = state.tab === 'live';
    var rows = sortedRows(isLive ? filteredLive() : filteredRows());
    var head = isLive
      ? ['Slug', 'Name', 'Category', 'Chains', 'TVL', 'Change7d', 'MarketCap']
      : ['Rank', 'Slug', 'Name', 'Category', 'Chains', 'TVL', 'Change7d', 'AgeDays', 'ImpliedValue'];
    var q = function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var lines = [head.join(',')].concat(rows.map(function (r) {
      return isLive
        ? [r.s, r.n, r.c || '', r.ch.join(';'), r.t, r.g == null ? '' : r.g, r.m == null ? '' : r.m].map(q).join(',')
        : [r.r, r.s, r.n, r.c || '', r.ch.join(';'), r.t, r.g == null ? '' : r.g, r.a == null ? '' : r.a, impliedOf(r)].map(q).join(',');
    }));
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-radar-' + (isLive ? 'live' : 'board') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---- command palette ------------------------------------------------------------
  var palSel = 0;
  var palItems = [];
  function paletteActions() {
    return [
      { k: 'action', label: 'Export current view as CSV', run: exportCSV },
      { k: 'action', label: (state.wl ? 'Show all protocols' : 'Show watchlist only'), run: function () { state.wl = !state.wl; $('wlF').checked = state.wl; writeHash(); renderTable(); } },
      { k: 'action', label: 'Clear all filters', run: function () { state.q = ''; state.chain = ''; state.cat = ''; state.wl = false; state.min = 0; $('q').value = ''; $('chainF').value = ''; $('catF').value = ''; $('wlF').checked = false; $('minTvl').value = ''; writeHash(); renderTable(); } },
      { k: 'action', label: 'Go to the Live tokens tab', run: function () { setTab('live'); } },
      { k: 'action', label: 'Go to the Pre-token board tab', run: function () { setTab('board'); } },
      { k: 'action', label: 'Reset the model sandbox', run: function () { $('sandboxReset').click(); } }
    ];
  }
  function openPalette() {
    $('palette').hidden = false;
    $('palInput').value = '';
    palSel = 0;
    renderPalette('');
    setTimeout(function () { $('palInput').focus(); }, 0);
  }
  function closePalette() { $('palette').hidden = true; }
  function renderPalette(q) {
    var query = q.trim().toLowerCase();
    var matches = query
      ? D.rows.filter(function (r) { return r.n.toLowerCase().indexOf(query) >= 0 || r.s.toLowerCase().indexOf(query) >= 0; }).slice(0, 8)
      : D.rows.slice(0, 5);
    palItems = matches.map(function (r) {
      return { k: 'row', label: r.n + ' — #' + r.r + ' · ' + fmt$(impliedOf(r)), slug: r.s };
    }).concat(paletteActions().filter(function (a) {
      return !query || a.label.toLowerCase().indexOf(query) >= 0;
    }));
    if (palSel >= palItems.length) palSel = 0;
    $('palList').innerHTML = palItems.map(function (it, i) {
      return '<div class="pal-item' + (i === palSel ? ' sel' : '') + '" data-i="' + i + '">' + esc(it.label) +
        ' <span class="k">' + (it.k === 'row' ? 'protocol' : 'action') + '</span></div>';
    }).join('') || '<div class="pal-item">No matches</div>';
    $('palList').querySelectorAll('.pal-item[data-i]').forEach(function (el) {
      el.addEventListener('click', function () { runPalette(parseInt(el.getAttribute('data-i'), 10)); });
    });
  }
  function runPalette(i) {
    var it = palItems[i];
    if (!it) return;
    closePalette();
    if (it.k === 'row') { setTab('board'); openDetail(it.slug); }
    else it.run();
  }

  // ---- hash state -------------------------------------------------------------------
  function writeHash() {
    var p = [];
    if (state.tab !== 'board') p.push('tab=' + state.tab);
    if (state.q) p.push('q=' + encodeURIComponent(state.q));
    if (state.chain) p.push('chain=' + encodeURIComponent(state.chain));
    if (state.cat) p.push('cat=' + encodeURIComponent(state.cat));
    if (state.wl) p.push('wl=1');
    if (state.min > 0) p.push('min=' + state.min);
    if (state.sort !== 'v' || state.dir !== -1) p.push('sort=' + state.sort + '&dir=' + (state.dir === 1 ? 'asc' : 'desc'));
    if (state.row) p.push('row=' + encodeURIComponent(state.row));
    try { history.replaceState(null, '', p.length ? '#' + p.join('&') : location.pathname + location.search); } catch (e) { /* file:// URLs may refuse history writes */ }
  }
  function readHash() {
    var h = location.hash.slice(1);
    if (!h) return;
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      var k = kv[0], v = kv[1] ? decodeURIComponent(kv[1]) : '';
      if (k === 'tab' && (v === 'board' || v === 'live')) state.tab = v;
      else if (k === 'q') state.q = v;
      else if (k === 'chain') state.chain = v;
      else if (k === 'cat') state.cat = v;
      else if (k === 'wl') state.wl = v === '1';
      else if (k === 'min') state.min = parseInt(v, 10) || 0;
      else if (k === 'sort' && SORTS[v]) state.sort = v;
      else if (k === 'dir') state.dir = v === 'asc' ? 1 : -1;
      else if (k === 'row' && bySlug[v]) state.row = v;
    });
  }

  // ---- tabs + controls wiring ---------------------------------------------------------
  function setTab(tab) {
    state.tab = tab;
    $('tabBoard').setAttribute('aria-selected', String(tab === 'board'));
    $('tabLive').setAttribute('aria-selected', String(tab === 'live'));
    writeHash();
    renderTable();
  }
  function syncControls() {
    $('q').value = state.q;
    $('chainF').value = state.chain;
    $('catF').value = state.cat;
    $('wlF').checked = state.wl;
    $('minTvl').value = state.min > 0 ? String(state.min) : '';
    $('tabBoard').setAttribute('aria-selected', String(state.tab === 'board'));
    $('tabLive').setAttribute('aria-selected', String(state.tab === 'live'));
  }
  function init() {
    readHash();
    fillSelect($('chainF'), chainOptions(), 'All chains');
    fillSelect($('catF'), catOptions(), 'All categories');
    syncControls();
    renderStats();
    renderSignals();
    renderCatTable();
    renderSandbox();
    renderTable();
    loadAttribution();
    if (state.row) renderDetail();
    $('tabBoard').addEventListener('click', function () { setTab('board'); });
    $('tabLive').addEventListener('click', function () { setTab('live'); });
    $('q').addEventListener('input', function () { state.q = $('q').value; writeHash(); renderTable(); });
    $('chainF').addEventListener('change', function () { state.chain = $('chainF').value; writeHash(); renderTable(); });
    $('catF').addEventListener('change', function () { state.cat = $('catF').value; writeHash(); renderTable(); });
    $('wlF').addEventListener('change', function () { state.wl = $('wlF').checked; writeHash(); renderTable(); });
    $('minTvl').addEventListener('input', function () { state.min = parseInt($('minTvl').value, 10) || 0; writeHash(); renderTable(); });
    $('csvBtn').addEventListener('click', exportCSV);
    $('palBtn').addEventListener('click', openPalette);
    $('palette').addEventListener('click', function (ev) { if (ev.target === $('palette')) closePalette(); });
    $('palInput').addEventListener('input', function () { palSel = 0; renderPalette($('palInput').value); });
    $('palInput').addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); palSel = Math.min(palSel + 1, palItems.length - 1); renderPalette($('palInput').value); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); palSel = Math.max(palSel - 1, 0); renderPalette($('palInput').value); }
      else if (ev.key === 'Enter') { ev.preventDefault(); runPalette(palSel); }
      else if (ev.key === 'Escape') { closePalette(); }
    });
    document.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); openPalette(); }
      else if (ev.key === 'Escape' && !$('palette').hidden) { closePalette(); }
    });
    $('signals').addEventListener('click', function (ev) {
      var li = ev.target.closest ? ev.target.closest('li[data-slug]') : null;
      if (li) openDetail(li.getAttribute('data-slug'));
    });
  }
  init();
})();
