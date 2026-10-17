import { ROW } from '../graph.js';
import { acceptCommandFor } from '../steps.js';

/* The Not joined tab: the rows by kind and reason, what was accepted and by
   which rule, and what the reader could not follow, by cause (P75). */
export function createMissing(page) {
  const { acceptLikeHtml, accepted, acceptedNote, acceptedRule, appendUnmatched, data, esc, files,
    graphLink, plural, reasons, rowService, titleEl, walkEl, wordHtml } = page;

  /* ── what did not join, and why ──────────────────────────────────── */

  /* Rows somebody accepted (P72) stay out of the counts unless asked for,
     and are listed muted, each with the note it was accepted with. */
  let showAccepted = false;
  const acceptedByReason = () => {
    const out = new Map();
    for (const r of accepted.rows) {
      const reason = reasons[data.rows[r][ROW.reason]];
      out.set(reason, (out.get(reason) || 0) + 1);
    }
    return out;
  };
  const acceptedListHtml = () => {
    const items = accepted.rows.map((r) => {
      const row = data.rows[r];
      const file = row[ROW.file] >= 0 ? files[row[ROW.file]] + (row[ROW.line] ? ':' + row[ROW.line] : '') : '';
      const note = acceptedNote(r);
      const rule = acceptedRule(r);
      return `<tr class="is-accepted"><td>${wordHtml('reason', reasons[row[ROW.reason]], 'tag')}` +
        (rule ? `<div class="accepted-note">accepted by rule <code>${esc(rule)}</code></div>` : '') + '</td>' +
        `<td class="mono">${rowService(row) ? esc(rowService(row)) + ' &middot; ' : ''}${esc(file)}` +
        `${row[ROW.node] >= 0 ? ' ' + graphLink(row[ROW.node]) : ''}<div>${esc(row[ROW.message])}</div></td>` +
        `<td class="accepted-note">${note ? esc(note) : 'no note'}</td></tr>`;
    });
    return '<table class="accepted-table"><thead><tr><th>Accepted &middot; ' + items.length.toLocaleString() +
      '</th><th>Where</th><th>Why it was accepted</th></tr></thead>' + `<tbody>${items.join('')}</tbody></table>`;
  };
  /* Each rule once, with how many rows it took: a rule goes on taking rows nobody looked at. */
  const acceptedRulesHtml = () => {
    const taken = new Map();
    for (const r of accepted.rows) {
      const rule = acceptedRule(r);
      if (rule) taken.set(rule, (taken.get(rule) || 0) + 1);
    }
    if (taken.size === 0) return '';
    return '<ul class="accepted-rules">' + [...taken].map(([rule, count]) =>
      `<li>accepted by rule <code>${esc(rule)}</code> &middot; ${count.toLocaleString()}</li>`).join('') + '</ul>';
  };
  /* What the reader could not follow (P75): every row that says a step was not
     read, by why - a package nobody installed, an import that points nowhere,
     a value typed any - then by the package it points into, a few places each.
     The same breakdown flowatlas doctor --unresolved prints. */
  const cantFollow = data.cantFollow || null;
  const cfPlace = ([service, file, line, symbol, node]) =>
    `<li>${service ? esc(service) + ' &middot; ' : ''}${esc(file)}${line ? ':' + line : ''}` +
    (symbol ? ` <span class="hint">${esc(symbol.length > 110 ? symbol.slice(0, 109) + '\u2026' : symbol)}</span>` : '') +
    (node >= 0 ? ' ' + graphLink(node) : '') + '</li>';
  const cantFollowHtml = () => {
    if (cantFollow === null) return '';
    const top = cantFollow.causes[0] ? cantFollow.causes[0].s : 1;
    const causes = cantFollow.causes.map((cause, index) => {
      const named = cause.p.length > 1 || cause.l === cause.c;
      const packages = cause.p.map((pkg) =>
        `<li><div class="cf-pkg">${pkg.n === null ? (named ? '<span class="hint">no package</span>' : '') : esc(pkg.n)}` +
        (named || pkg.n !== null ? ` <span class="hint">${plural(pkg.s, 'place', 'places')}</span>` : '') + '</div>' +
        `<ul class="s-unmatched">${pkg.x.map(cfPlace).join('')}</ul></li>`).join('');
      const reasons = cause.r.filter((reason) => reason !== cause.c);
      return `<details class="cf-cause"${index === 0 ? ' open' : ''}><summary>` +
        `<span class="tag is-warn">${esc(cause.l)}</span>` +
        `<span class="cf-count"><b>${cause.s.toLocaleString()}</b> ${cause.s === 1 ? 'place' : 'places'}</span>` +
        `<span class="cf-bar" aria-hidden="true"><span style="width:${Math.max(2, Math.round((cause.s / top) * 100))}%"></span></span>` +
        `<span class="hint">${cause.v.length === 1 ? esc(cause.v[0]) : plural(cause.v.length, 'service', 'services')}</span></summary>` +
        `<div class="cf-body"><p class="hint">${esc(cause.h)}${reasons.length ? ' Rows: ' + reasons.map((reason) => wordHtml('reason', reason)).join(', ') + '.' : ''}</p>` +
        `<ul class="cf-pkgs">${packages}</ul>` +
        (cause.more ? `<p class="hint">${plural(cause.more, 'more package', 'more packages')}</p>` : '') + '</div></details>';
    }).join('');
    const byPackage = cantFollow.packages.length === 0 ? '' :
      '<table class="cf-by-pkg"><thead><tr><th>Package</th><th class="num">Places</th><th>Because</th></tr></thead><tbody>' +
      cantFollow.packages.map((pkg) => `<tr><td>${esc(pkg.n)}</td><td class="num">${pkg.s.toLocaleString()}</td>` +
        `<td>${pkg.c.map(([cause, n]) => esc(cause) + ' ' + n.toLocaleString()).join(', ')}</td></tr>`).join('') + '</tbody></table>';
    const more = cantFollow.more
      ? `<p class="hint">${[cantFollow.more.causes ? plural(cantFollow.more.causes, 'more cause', 'more causes') : '',
          cantFollow.more.packages ? plural(cantFollow.more.packages, 'more package', 'more packages') : '']
          .filter(Boolean).join(' and ')}; <code>flowatlas doctor --unresolved --top 50</code> lists them.</p>` : '';
    return '<div class="sheet is-padded" id="cant-follow"><h4>Can\'t follow</h4>' +
      `<p class="cf-total"><b>${cantFollow.total.sites.toLocaleString()}</b> ${cantFollow.total.sites === 1 ? 'place' : 'places'} the reader could not follow, ` +
      `over ${plural(cantFollow.total.rows, 'row', 'rows')}, by cause and then by package</p>` +
      causes + byPackage + more + '</div>';
  };
  /* The kinds a row of Not joined can be (P81, core row-kind.ts), in the
     order they are listed, each with the heading it is listed under. */
  const MISSING_KINDS = [
    ['gap', 'Missed <span class="hint">&middot; the reader could not follow these</span>'],
    ['note', 'Notes <span class="hint">&middot; how a join or a reading was made; nothing was missed</span>'],
    ['finding', 'Findings <span class="hint">&middot; about the code itself, whatever the reader managed</span>'],
  ];
  function drawMissing() {
    titleEl.textContent = 'What did not join';
    const byReason = acceptedByReason();
    const bar = document.createElement('div');
    bar.className = 's-bar';
    if (accepted.rows.length > 0) {
      bar.innerHTML = `<label class="hint g-pick"><input type="checkbox" id="missing-accepted"${showAccepted ? ' checked' : ''}> ` +
        `show accepted &middot; ${accepted.rows.length.toLocaleString()}</label>` +
        '<span class="hint">Rows accepted with <code>flowatlas accept</code> are left out of the counts unless shown.</span>' +
        acceptedRulesHtml();
      bar.querySelector('input').addEventListener('change', (event) => { showAccepted = event.target.checked; drawMissing(); });
    }
    /* An accepted.json that could not be read accepts nothing, and says so (P80). */
    if (accepted.problem) bar.insertAdjacentHTML('beforeend', `<span class="hint accepted-problem">${esc(accepted.problem)}</span>`);
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Reason</th><th class="num">Count</th><th>One of them</th></tr></thead>';
    /* One body per kind (P81), each under its own heading: what the reader
       missed, how a join or a reading was made, and what the code does. A row
       packed before kinds existed is a gap. */
    const bodies = new Map(MISSING_KINDS.map(([kind]) => [kind, document.createElement('tbody')]));
    for (const u of data.unresolved) {
      const taken = byReason.get(u.reason) || 0;
      if (!showAccepted && taken >= u.count) continue;
      const body = bodies.get(u.kind) || bodies.get('gap');
      const tr = document.createElement('tr');
      // A link names a reason to open on (`#missing/reason=…`, P98).
      tr.dataset.reason = u.reason;
      const tone = u.reason.includes('not-found') ? 'bad' : u.reason.includes('dynamic') ? 'warn' : '';
      // The example is the first row of its reason, in the order both lists
      // are written; when that row names a node, the node is one click away.
      const example = data.rows.find((row) => reasons[row[ROW.reason]] === u.reason);
      const anchor = example === undefined ? -1 : example[ROW.node];
      const at = example === undefined ? -1 : data.rows.indexOf(example);
      tr.innerHTML =
        `<td>${wordHtml('reason', u.reason, 'tag' + (tone ? ' is-' + tone : ''))}</td>` +
        `<td class="num">${(showAccepted ? u.count : u.count - taken).toLocaleString()}` +
        (taken ? `<div class="accepted-note">${taken.toLocaleString()} accepted</div>` : '') + '</td>' +
        `<td class="mono">${u.service ? esc(u.service) + ' &middot; ' : ''}${esc(u.example)}` +
        `${anchor >= 0 ? ' ' + graphLink(anchor) : ''}` +
        (at >= 0 ? ` <button class="tool" data-prompt="row:${at}" title="Copy this row as Markdown for an assistant">Copy as prompt</button>` : '') +
        ' ' + acceptLikeHtml(acceptCommandFor({ reason: u.reason, service: u.service })) +
        '</td>';
      body.append(tr);
    }
    for (const [kind, heading] of MISSING_KINDS) {
      const body = bodies.get(kind);
      if (body.children.length === 0) continue;
      body.insertAdjacentHTML('afterbegin', `<tr class="kind-head"><th colspan="3">${heading}</th></tr>`);
      table.append(body);
    }
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.append(table);
    if (showAccepted && accepted.rows.length > 0) sheet.insertAdjacentHTML('beforeend', acceptedListHtml());
    walkEl.replaceChildren(...(accepted.rows.length > 0 || accepted.problem ? [bar] : []), sheet);
    if (cantFollow !== null) walkEl.insertAdjacentHTML('beforeend', cantFollowHtml());
    appendUnmatched();
  }

  return { drawMissing };
}
