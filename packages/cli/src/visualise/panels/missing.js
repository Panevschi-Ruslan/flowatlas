import { ROW } from '../graph.js';
import { PAGE_WORDS } from '../frame.js';

/* The Not joined tab, split by what a row is (P100): what the reader
   Couldn't join (gaps, with what it could not follow by cause and package
   folded under them, P75), the Risks a finding names (auth, then
   performance, then wiring), and what was Accepted, by note and by rule
   (P72, P76). The split is the pack's (P81's row kinds and core's `riskOf`),
   never a guess from the words in a reason. Notes - how a join was made, with
   nothing missed - stay out of the tab; one line says how many and where they
   are. Each reason is a row that opens to every place it stands for, and each
   place has one `⋯` menu for what can be copied from it. */
export function createMissing(page) {
  const { accepted, acceptedNote, acceptedRows, acceptedRule, appendUnmatched, data, esc, files, graphLink,
    opener, plural, reasons, rowKind, rowMenu, rowRisk, rowService, rowTone, sheetEl, titleEl, wordHtml } = page;

  /* How many places a reason lists when opened; `doctor` lists the rest. */
  const PLACES_LISTED = 50;
  /* The accepted rows are listed open up to this many, folded past it. */
  const ACCEPTED_OPEN = 10;
  /* The risks, in the order the Risks section groups them: core's `RISK_NAMES`. */
  const RISK_ORDER = Object.keys(PAGE_WORDS.risk);

  /* ── the rows, by section ─────────────────────────────────────────── */

  /* Every row not accepted, by reason and kind, the most rows first. A row of
     any kind but a note or a finding is a gap, as the core reads it: nothing
     is dropped by the split (I3). */
  const sectionsOf = () => {
    const byKey = new Map();
    const notes = [];
    data.rows.forEach((row, r) => {
      if (acceptedRows.has(r)) return;
      const kind = rowKind(r);
      if (kind === 'note') { notes.push(r); return; }
      const reason = reasons[row[ROW.reason]];
      const key = reason + '\u0000' + (kind === 'finding' ? 'finding' : 'gap');
      let group = byKey.get(key);
      if (group === undefined) {
        group = { reason, kind: kind === 'finding' ? 'finding' : 'gap', risk: rowRisk(r), rows: [] };
        byKey.set(key, group);
      }
      group.rows.push(r);
    });
    const groups = [...byKey.values()].sort((a, b) => b.rows.length - a.rows.length || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
    return { gaps: groups.filter((g) => g.kind === 'gap'), risks: groups.filter((g) => g.kind === 'finding'), notes };
  };
  const rowsIn = (groups) => groups.reduce((n, group) => n + group.rows.length, 0);

  /* ── one reason, and the places it stands for ─────────────────────── */

  const placeText = (r) => {
    const row = data.rows[r];
    return row[ROW.file] >= 0 && files[row[ROW.file]] ? files[row[ROW.file]] + (row[ROW.line] ? ':' + row[ROW.line] : '') : '';
  };
  const serviceHtml = (r) => (rowService(data.rows[r]) ? `<span class="nj-svc">${esc(rowService(data.rows[r]))}</span> ` : '');
  const placeHtml = (r) => {
    const row = data.rows[r];
    const text = placeText(r);
    return text ? opener(row[ROW.repo], row[ROW.file], row[ROW.line], text) : '<span class="hint">no single place</span>';
  };

  /* The row a reason is drawn as: the summary is the reason in words, its
     count, and its first place; opening it lists every place. The graph link
     and the menu sit beside the summary, not in it, so neither opens it. */
  const reasonRowHtml = (group, at) => {
    const first = group.rows[0];
    const row = data.rows[first];
    const tone = group.kind === 'finding' ? rowTone(first) : '';
    const sites = group.rows.reduce((n, r) => n + (data.rows[r][ROW.sites] || 1), 0);
    return `<div class="nj-row" data-reason="${esc(group.reason)}" data-kind="${group.kind}">` +
      `<details class="nj-details" data-group="${at}"><summary>` +
      `<span class="nj-what">${wordHtml('reason', group.reason, 'tag' + (tone ? ' is-' + tone : ''))}</span>` +
      `<span class="nj-count" title="${esc(plural(group.rows.length, 'row', 'rows') + (sites > group.rows.length ? ' over ' + plural(sites, 'place', 'places') : ''))}">` +
      `${group.rows.length.toLocaleString()}</span>` +
      `<span class="nj-first">${serviceHtml(first)}<span class="mono">${esc(placeText(first) || 'no single place')}</span>` +
      ` <span class="hint">${esc(row[ROW.message])}</span></span></summary>` +
      '<div class="nj-places"></div></details>' +
      `<span class="nj-tools">${row[ROW.node] >= 0 ? graphLink(row[ROW.node]) : ''}` +
      `${rowMenu(first, 'the first place of this reason')}</span></div>`;
  };

  /* Every place of a reason, drawn when it is first opened: up to
     PLACES_LISTED, each with its own menu, then how to see the rest. */
  const placesHtml = (group) => {
    const listed = group.rows.slice(0, PLACES_LISTED);
    const rest = group.rows.length - listed.length;
    const sites = group.rows.reduce((n, r) => n + (data.rows[r][ROW.sites] || 1), 0);
    return `<p class="hint nj-code"><code title="The reason as doctor, accept and the MCP server name it">${esc(group.reason)}</code>` +
      ` &middot; ${plural(group.rows.length, 'row', 'rows')}${sites > group.rows.length ? ' over ' + plural(sites, 'place', 'places') : ''}</p>` +
      '<ol class="nj-place-list">' + listed.map((r) => {
        const row = data.rows[r];
        return `<li class="nj-place"><span class="nj-where">${serviceHtml(r)}${placeHtml(r)}` +
          (row[ROW.sites] > 1 ? ` <span class="hint">&times;${row[ROW.sites].toLocaleString()}</span>` : '') + '</span>' +
          `<span class="nj-msg">${esc(row[ROW.message])}</span>` +
          `<span class="nj-tools">${row[ROW.node] >= 0 ? graphLink(row[ROW.node]) : ''}${rowMenu(r, 'this place')}</span></li>`;
      }).join('') + '</ol>' +
      (rest > 0 ? `<p class="hint">${plural(rest, 'more place', 'more places')}; ` +
        `<code>flowatlas doctor --max-nodes ${group.rows.length}</code> lists every one under its reason.</p>` : '');
  };

  /* ── what was accepted (P72, P76) ─────────────────────────────────── */

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
  /* Every accepted row, muted, each with the note it was accepted with. */
  const acceptedListHtml = () => {
    const items = accepted.rows.map((r) => {
      const row = data.rows[r];
      const rule = acceptedRule(r);
      const note = acceptedNote(r);
      return `<tr class="is-accepted"><td>${wordHtml('reason', reasons[row[ROW.reason]], 'tag')}` +
        (rule ? `<div class="accepted-note">accepted by rule <code>${esc(rule)}</code></div>` : '') + '</td>' +
        `<td class="mono">${rowService(row) ? esc(rowService(row)) + ' &middot; ' : ''}${esc(placeText(r))}` +
        `${row[ROW.node] >= 0 ? ' ' + graphLink(row[ROW.node]) : ''}<div>${esc(row[ROW.message])}</div></td>` +
        `<td class="accepted-note">${note ? esc(note) : 'no note'}</td></tr>`;
    });
    return `<details class="nj-fold nj-accepted"${items.length <= ACCEPTED_OPEN ? ' open' : ''}>` +
      `<summary>Every accepted row &middot; ${items.length.toLocaleString()}</summary>` +
      '<table class="accepted-table"><thead><tr><th>Reason</th><th>Where</th><th>Why it was accepted</th></tr></thead>' +
      `<tbody>${items.join('')}</tbody></table></details>`;
  };

  /* ── what the reader could not follow, by cause (P75) ─────────────── */

  /* Every row that says a step was not read, by why - a package nobody
     installed, an import that points nowhere, a value typed any - then by the
     package it points into, a few places each: the breakdown `flowatlas
     doctor --unresolved` prints. Only gaps are in it (core's
     `groupCantFollow`), so no risk is listed a second time here. */
  const cantFollow = data.cantFollow || null;
  const cfPlace = ([service, file, line, symbol, node]) =>
    `<li>${service ? esc(service) + ' &middot; ' : ''}${esc(file)}${line ? ':' + line : ''}` +
    (symbol ? ` <span class="hint">${esc(symbol.length > 110 ? symbol.slice(0, 109) + '…' : symbol)}</span>` : '') +
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
      const said = cause.r.filter((reason) => reason !== cause.c);
      return `<details class="cf-cause"${index === 0 ? ' open' : ''}><summary>` +
        `<span class="tag is-warn">${esc(cause.l)}</span>` +
        `<span class="cf-count"><b>${cause.s.toLocaleString()}</b> ${cause.s === 1 ? 'place' : 'places'}</span>` +
        `<span class="cf-bar" aria-hidden="true"><span style="width:${Math.max(2, Math.round((cause.s / top) * 100))}%"></span></span>` +
        `<span class="hint">${cause.v.length === 1 ? esc(cause.v[0]) : plural(cause.v.length, 'service', 'services')}</span></summary>` +
        `<div class="cf-body"><p class="hint">${esc(cause.h)}${said.length ? ' Rows: ' + said.map((reason) => wordHtml('reason', reason)).join(', ') + '.' : ''}</p>` +
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
    return '<details class="nj-fold" id="cant-follow"><summary>By cause and package &middot; ' +
      `${plural(cantFollow.total.sites, 'place', 'places')} the reader could not follow</summary>` +
      `<p class="cf-total"><b>${cantFollow.total.sites.toLocaleString()}</b> ${cantFollow.total.sites === 1 ? 'place' : 'places'} ` +
      `over ${plural(cantFollow.total.rows, 'row', 'rows')}, by cause and then by package</p>` +
      causes + byPackage + more + '</details>';
  };

  /* ── the tab ──────────────────────────────────────────────────────── */

  /* A section: its heading with its count, what it holds, and what would
     appear in it when it is empty. */
  const sectionHtml = ({ id, title, says, count, body, empty }) =>
    `<section class="sheet is-padded nj-section" id="${id}" aria-labelledby="${id}-title">` +
    `<h4 id="${id}-title">${title} <span class="nj-n">${count.toLocaleString()}</span></h4>` +
    `<p class="hint">${says}</p>` +
    (count === 0 ? `<p class="nj-empty"><b>Nothing here.</b> ${empty}</p>` : body) + '</section>';

  let drawn = [];
  const listHtml = (groups) => '<div class="nj-list">' + groups.map((group) => {
    drawn.push(group);
    return reasonRowHtml(group, drawn.length - 1);
  }).join('') + '</div>';

  function drawMissing() {
    titleEl.textContent = 'What did not join';
    drawn = [];
    const { gaps, risks, notes } = sectionsOf();
    const byRisk = RISK_ORDER.map((risk) => [risk, risks.filter((group) => group.risk === risk)]);
    // A finding of a risk the page has no word for is still listed, last.
    const otherRisks = risks.filter((group) => !RISK_ORDER.includes(group.risk));
    const risksBody = [...byRisk, ['', otherRisks]].filter(([, groups]) => groups.length > 0).map(([risk, groups]) =>
      `<h5 class="nj-risk">${risk ? wordHtml('risk', risk) : 'other findings'} <span class="nj-n">${rowsIn(groups).toLocaleString()}</span></h5>` +
      listHtml(groups)).join('');
    const parts = [
      // An accepted.json that could not be read accepts nothing, and says so (P80).
      accepted.problem ? `<p class="hint accepted-problem">${esc(accepted.problem)}</p>` : '',
      sectionHtml({
        id: 'nj-gaps', title: 'Couldn’t join', count: rowsIn(gaps),
        says: 'Calls, imports and addresses the reader could not join to what answers them. Each one is missing from the graph.',
        body: listHtml(gaps) + cantFollowHtml(),
        empty: 'A call the reader could not join to what answers it would be listed here, by reason.',
      }),
      sectionHtml({
        id: 'nj-risks', title: 'Risks', count: rowsIn(risks),
        says: 'Auth, N+1 and wiring: about the code itself, whatever the reader managed. Auth first.',
        body: risksBody,
        empty: 'A route with nothing in front of it, a query once per item of a loop, or two declarations of one route would be listed here.',
      }),
      sectionHtml({
        id: 'nj-accepted', title: 'Accepted', count: accepted.rows.length,
        says: 'Rows accepted with <code>flowatlas accept</code>, left out of the counts above, each with the note it was accepted with.',
        body: acceptedRulesHtml() + acceptedListHtml(),
        empty: 'A row accepted with <code>flowatlas accept</code> would be listed here, with its note and the rule that took it.',
      }),
      notes.length === 0 ? '' : `<p class="hint nj-notes">${plural(notes.length, 'note says', 'notes say')} how a join or a ` +
        'reading was made, with nothing missed; they are not listed here. <code>flowatlas doctor</code> lists them.</p>',
    ];
    sheetEl.innerHTML = parts.join('');
    for (const details of sheetEl.querySelectorAll('.nj-details')) details.addEventListener('toggle', fill);
    appendUnmatched();
  }

  /* A reason's places, drawn the first time it is opened. */
  function fill(event) {
    const details = event.currentTarget;
    const box = details.querySelector('.nj-places');
    if (!details.open || box === null || box.childNodes.length > 0) return;
    box.innerHTML = placesHtml(drawn[Number(details.dataset.group)]);
  }

  /* The row a reason is drawn as on the tab, or null when it has none
     (fixed, accepted, or a note): what a link or a search opens on. */
  const reasonRowOf = (reason) => sheetEl.querySelector(`.nj-row[data-reason="${CSS.escape(reason)}"]`);

  return { drawMissing, reasonRowOf };
}
