import { ANSWER_SAYS, CLAIMED_MARK, PARAM_FLAG, ROW, answersOf, describe, faceOf, refParts,
  typeInfo } from '../graph.js';
import { accessOf, accessSay, choiceStatuses, failGroups, failSeenSay, failWindowSay, failsOf,
  optOutSay, scheduleOf } from '../steps.js';

/* The Graph tab's details panel: a node's place, what stands in front of it,
   what it can fail with, its types opened row by row, its edges in and out,
   and the rows that name it. */
export function createDetails(page) {
  const { ALSO_SAYS, DOORS, FILE_LIMIT, FL, GROUP_LIMIT, KD, LB, LN, LOOK_SAYS, RP, SHAPED,
    TYPE_KIND_SAYS, acceptedNote, acceptedRows, acceptedRule, card, confidences,
    contextOf, data, edgeTypes, esc, failChipsHtml, files, glyphOf, graphLink, hueOf, kinds, lookOf,
    metaOf, metaValueHtml, model, nodes, opener, panel, placeOf, plural, reasons, repoName, rowMenu, rowTone,
    scheduleSay, seen, stage, state, typeOf, wordHtml } = page;

  /* ── the details panel ── */

  /* One line per status and exception, the places behind a disclosure (P87). */
  const failSiteHtml = (v, f) => `<span class="hint">${esc(f.src)}${f.at >= 0 ? ' in ' + esc(nodes[f.at][LB]) : f.id ? ' in ' + esc(f.id.split(':').pop()) : ''}` +
    (f.f ? ' &middot; ' + opener(nodes[v][RP], files.indexOf(f.f), f.l || 0, f.f + (f.l ? ':' + f.l : '')) : '') + '</span>' +
    (f.at >= 0 ? graphLink(f.at) : '');
  /* A throw whose exception a helper chooses (P90): what it can give, and from which classes. */
  const failHelperChip = (f) => (f.v === 'helper' && choiceStatuses(f)) || 'no status';
  const failHelperHtml = (f) => f.v !== 'helper' ? ''
    : f.ch && f.ch.length ? `<span class="hint" title="The helper picks one at run time; which a request gets is not known">chosen at run time from ${f.ch.map((c) => esc(c.x)).join(', ')}</span>`
      : `<span class="hint">${f.fam === 'auth' ? 'refuses a check of who is asking; ' : ''}what the helper returns was not read</span>`;
  /* A status traffic answered that no failure declares (P106): how often, and why it may be expected. */
  const undeclaredHtml = (row) => `<li><span class="fail-chip ${row.expected ? 'is-expected' : 'is-undeclared'}">${row.status}</span>` +
    `<span class="hint">&times;${row.count}, ${Math.round(row.share * 1000) / 10}% of requests, not declared` +
    (row.expected ? '; expected: ' + esc(row.expected) : '') +
    (row.maybe ? '; maybe ' + row.maybe.map((x) => `<code>${esc(x)}</code>`).join(', ') + ', which name no status' : '') + '</span></li>';
  const failsHtml = (v) => {
    const groups = failGroups(failsOf(model, v));
    const compared = seen.failures(v);
    const undeclared = compared ? compared.undeclared : [];
    if (groups.length === 0 && undeclared.length === 0) return '';
    const seenSay = (g) => {
      const said = failSeenSay(g, compared);
      return said ? `<span class="hint fail-seen">${said}</span>` : '';
    };
    const heading = groups.length > 0 ? `Can fail with &middot; ${groups.length}` : `Seen failing with &middot; ${undeclared.length}`;
    return `<section><h4>${heading}</h4>${failChipsHtml(v)}<ul class="fail-list">` +
      groups.map((g) => `<li><span class="fail-chip"${g.a ? ' title="Assumed: no code on the path writes this status"' : ''}>` +
        `${g.s === undefined ? esc(failHelperChip(g.sites[0])) : g.s + (g.a ? '?' : '')}</span><code>${esc(g.x)}</code>` + failHelperHtml(g.sites[0]) + seenSay(g) +
        (g.n === 1 ? failSiteHtml(v, g.sites[0])
          : `<details class="fail-sites"><summary class="hint">${esc(g.srcs.join('/'))} &times;${g.n}</summary><ul>` +
            g.sites.map((f) => `<li>${failSiteHtml(v, f)}</li>`).join('') + '</ul></details>') +
        '</li>').join('') + undeclared.map(undeclaredHtml).join('') +
      (compared && compared.tooFewHits ? `<li><span class="hint">${compared.hits} hits are too few to say a declared failure was never seen</span></li>` : '') +
      '</ul>' + (compared ? `<p class="hint">Run time: ${compared.hits} hits, ${esc(failWindowSay(compared.window))}.</p>` : '') + '</section>';
  };
  /* The pages that describe a node (P120): blocks of Markdown files tied to
     it by flowatlas docs, and whether each still says what the graph says. */
  const DOC_STATE_SAYS = { ok: ['good', 'up to date'], changed: ['warn', 'stale: the flow changed'], gone: ['bad', 'names nothing now'], ambiguous: ['bad', 'names more than one node'] };
  const docsHtml = (v) => {
    const list = (data.docs || {})[v];
    if (!list || list.length === 0) return '';
    return `<section><h4>Described in &middot; ${list.length}</h4><ul class="doc-list">` +
      list.map(([file, line, kind, state]) => {
        const [tone, say] = DOC_STATE_SAYS[state] || ['warn', state];
        return `<li><span class="g-place">${esc(file)}:${line}</span> <span class="hint">${esc(kind)}</span> ` +
          `<span class="tag is-${tone}">${esc(say)}</span></li>`;
      }).join('') + '</ul></section>';
  };
  /* What stands in front of a way in, and from where (P76). */
  const accessHtml = (v) => {
    const access = accessOf(model, v);
    if (access === null) return '';
    const checks = access.g.map((check) =>
      `<li${check[3] ? ' class="is-off"' : ''}><code>${esc(check[0])}</code> <span class="hint">${esc(accessSay(check).slice(check[0].length + 3))}</span></li>`);
    const outs = (access.o || []).map((item) => `<li><span class="hint">${esc(optOutSay(item))}</span></li>`);
    return `<section><h4>In front of it &middot; ${access.g.length}</h4><ul class="access-list">${[...checks, ...outs].join('')}</ul></section>`;
  };
  const scheduleHtml = (v) => {
    const schedule = scheduleOf(model, v);
    return schedule ? `<p class="hint">Fires <span class="sched">${esc(scheduleSay(schedule))}</span>` +
      (schedule.zone ? '' : ', in the zone the process runs in') + '.</p>' : '';
  };

  const edgeGroup = (dir, group, far) => {
    const key = dir + group.type;
    const all = group.edges;
    const listed = state.openGroups.has(key) ? all : all.slice(0, GROUP_LIMIT);
    const items = listed.map((k) => {
      const e = data.edges[k];
      const v = e[far];
      return `<li><button class="g-far" data-go="${v}" style="--hue:${hueOf(nodes[v][RP])}" ` +
        `title="Centre on ${esc(nodes[v][LB])}${placeOf(v) ? ', ' + esc(placeOf(v)) : ''}">` +
        `<span class="label">${esc(nodes[v][LB])}</span>` +
        `<small>${esc(repoName(v))}${confidences[e[3]] === 'static' ? '' : ' &middot; ' + wordHtml('trust', confidences[e[3]])}</small></button></li>`;
    }).join('');
    const rest = all.length - listed.length;
    return `<div class="g-group"><div class="g-group-name">${wordHtml('edge', edgeTypes[group.type])} &middot; ${all.length}</div>` +
      `<ul class="g-edges">${items}</ul>` +
      (rest > 0 ? `<button class="g-more-btn" data-group="${key}">Show ${rest.toLocaleString()} more</button>` : '') +
      '</div>';
  };

  const rowHtml = (r) => {
    const row = data.rows[r];
    const reason = reasons[row[ROW.reason]];
    // Its tone from what it is (P100), never from the words of its reason.
    const tone = rowTone(r);
    const file = row[ROW.file] >= 0 ? files[row[ROW.file]] + (row[ROW.line] ? ':' + row[ROW.line] : '') : '';
    const hint = row[ROW.hint] >= 0 ? data.dicts.hints[row[ROW.hint]] : '';
    const isAccepted = acceptedRows.has(r);
    // One menu for what can be copied from the row (P100): as a prompt, and the accept commands.
    return `<div class="g-row${isAccepted ? ' is-accepted' : ''}"><span class="g-row-menu">${rowMenu(r)}</span>` +
      `${wordHtml('reason', reason, 'tag' + (tone ? ' is-' + tone : ''))} ` +
      (isAccepted ? '<span class="tag is-accepted-tag" title="Accepted with flowatlas accept">accepted</span> ' : '') +
      `<span class="hint">${esc(data.dicts.levels[row[ROW.level]])}` +
      (row[ROW.sites] > 1 ? ` &middot; ${row[ROW.sites]} places` : '') +
      (file ? ' &middot; ' + opener(row[ROW.repo], row[ROW.file], row[ROW.line], file) : '') +
      ` &middot; <code class="g-code" title="The reason as doctor, accept and the MCP server name it">${esc(reason)}</code></span>` +
      `<p>${esc(row[ROW.message])}</p>` +
      (isAccepted && acceptedRule(r) ? `<p class="accepted-note">accepted by rule <code>${esc(acceptedRule(r))}</code></p>` : '') +
      (isAccepted && acceptedNote(r) ? `<p class="accepted-note">${esc(acceptedNote(r))}</p>` : '') +
      (hint ? `<p class="hint-text">${esc(hint)}</p>` : '') + '</div>';
  };

  /* What a node takes and gives back, worded by what kind of thing it is. */
  const FACE_SAYS = {
    method: { title: 'Takes and returns', back: 'returns', none: 'Takes no parameters.' },
    bare: {
      title: 'Takes and returns', back: 'returns', none: 'Takes no parameters.',
      note: 'Only the types were recorded, not the parameter names.',
    },
    route: { title: 'Request and response', back: 'responds', none: 'Reads no body, path params, query or headers.' },
    call: { title: 'Sends and expects back', back: 'gets back', none: 'Sends nothing typed.' },
    channel: { title: 'Payload', back: '', none: '', note: 'As its producers send it.' },
    handler: {
      title: 'Hands its handler', back: 'returns', none: 'Its handler takes no parameters.',
      note: 'What the function that answers it takes.',
    },
  };

  /* A reference with each named type a button that opens it underneath.
     `at` names where the row sits, so one type opened in two rows is two
     openings; `inside` holds the types this row is already within, and one
     of those is marked as open above rather than opened again. */
  const refHtml = (r, at, inside) => refParts(model, r).map((part) => {
    if (part.type === undefined) return esc(part.text);
    if (part.type < 0) return `<span class="g-type is-plain" title="Not in the type registry">${esc(part.text)}</span>`;
    if (inside.has(part.type)) {
      return `<span class="g-type is-plain is-cycle" title="Already open above: this type holds itself">` +
        `&#8635; ${esc(part.text)}</span>`;
    }
    const open = state.openTypes.has(at + ':' + part.type);
    return `<button class="g-type" data-type="${part.type}" data-at="${esc(at)}" data-ref="${r}" ` +
      `aria-expanded="${open}">${esc(part.text)}</button>`;
  }).join('');

  /* What an "Expand all" left closed at the bounds, under where it was asked. */
  const moreHtml = (asked) => {
    const more = state.typeMore.get(asked);
    return more
      ? `<button class="g-type-more" data-more="${esc(asked)}">${plural(more.left, 'more type', 'more types')} ` +
        'left closed &mdash; open them</button>'
      : '';
  };

  const shapeRowHtml = (name, r, at, inside, back = false) => {
    const opened = [];
    let openable = false;
    let cycle = false;
    for (const part of refParts(model, r)) {
      if (part.type === undefined || part.type < 0) continue;
      if (inside.has(part.type)) { cycle = true; continue; }
      openable = true;
      if (state.openTypes.has(at + ':' + part.type) && !opened.includes(part.type)) opened.push(part.type);
    }
    return `<div class="g-shape-row${back ? ' g-shape-back' : ''}">` +
      `<span class="g-shape-name">${esc(name)}</span>` +
      `<span class="g-shape-type">${refHtml(r, at, inside)}` +
        (cycle ? ' <span class="g-shape-see">&mdash; see above</span>' : '') +
        (openable
          ? `<button class="g-type-all" data-all="${esc(at)}" data-ref="${r}" ` +
            'title="Open everything under this row">expand all</button>'
          : '') +
      '</span></div>' +
      moreHtml(at) +
      opened.map((t) => typeBodyHtml(t, at + ':' + t, inside)).join('');
  };

  const typeBodyHtml = (t, at, inside) => {
    const info = typeInfo(model, t);
    if (info === null) return '';
    const within = new Set(inside).add(t);
    const head = `${TYPE_KIND_SAYS[info.kind] || info.kind}` +
      (info.typeParams.length ? '&lt;' + esc(info.typeParams.join(', ')) + '&gt;' : '') +
      ` &middot; ${esc(info.declaredIn)}`;
    let body = '';
    if (info.kind === 'external') {
      body = `<p class="g-shape-note">Declared by a dependency; its fields are not read.</p>`;
    } else if (info.kind === 'enum') {
      body = `<div class="g-shape-row"><span class="g-shape-name">one of</span>` +
        `<span class="g-shape-type">${esc(info.members.map((m) => m.text).join(' | '))}</span></div>`;
    } else if (info.members.length > 0) {
      body = info.members.map((m, k) => (m.ref !== undefined
        ? shapeRowHtml('|', m.ref, at + '.' + k, within)
        : `<div class="g-shape-row"><span class="g-shape-name">|</span><span class="g-shape-type">${esc(m.text)}</span></div>`)).join('');
    } else if (info.fields.length > 0) {
      body = info.fields.map((f, k) => shapeRowHtml(f.name + (f.optional ? '?' : ''), f.ref, at + '.' + k, within)).join('');
    } else {
      body = '<p class="g-shape-note">No fields recorded.</p>';
    }
    return `<div class="g-type-body"><div class="g-type-head">${head}</div>${body}</div>`;
  };

  /* The rows of a face, by the names the panel gives them: a parameter or
     request part `p<k>`, what comes back `r`, a route's other answers `a<k>`. */
  const faceRows = (face, v) => [
    ...face.params.map((param, k) => ({ at: 'p' + k, ref: param.ref })),
    ...(face.returns >= 0 ? [{ at: 'r', ref: face.returns }] : []),
    ...answersOf(model, v).map((answer, k) => ({ at: 'a' + k, ref: answer.ref })),
  ];

  /* A route's failures and answers under a worked-out status, a row each,
     and once per kind what that kind means. */
  const answersHtml = (v, none) => {
    const answers = answersOf(model, v);
    if (answers.length === 0) return '';
    const kinds = [...new Set(answers.map((answer) => answer.kind))];
    return answers.map((answer, k) => shapeRowHtml('→ ' + (ANSWER_SAYS[answer.kind]?.name(answer.status) ?? answer.kind),
      answer.ref, 'a' + k, none, true)).join('') +
      kinds.map((kind) => (ANSWER_SAYS[kind] ? `<p class="g-shape-note">${esc(ANSWER_SAYS[kind].note)}</p>` : '')).join('');
  };

  const shapeHtml = (v) => {
    const face = faceOf(model, v);
    if (face === null) {
      return SHAPED.has(typeOf(v))
        ? '<section><h4>Takes and returns</h4><p class="g-none">Types not recorded for this node. They are read ' +
          'for the methods and functions a reader draws, the ways in that reach them, and the calls and ' +
          'payloads whose code is typed.</p></section>'
        : '';
    }
    const says = FACE_SAYS[face.face];
    const none = new Set();
    const label = (param) => param.label === ''
      ? ''
      : (param.flag === PARAM_FLAG.rest ? '...' : '') + param.label + (param.flag === PARAM_FLAG.optional ? '?' : '') +
        (param.flag === PARAM_FLAG.claimed ? CLAIMED_MARK : '');
    const rows = face.params.map((param, k) => shapeRowHtml(label(param) || '#' + (k + 1), param.ref, 'p' + k, none));
    const cast = face.params.some((param) => param.flag === PARAM_FLAG.claimed)
      ? `<p class="g-shape-note">A part marked${CLAIMED_MARK} is what a cast in the handler says it is; nothing checks it.</p>`
      : '';
    const openable = faceRows(face, v).some(({ ref }) => refParts(model, ref).some((part) => part.type >= 0));
    const tools = '<span class="g-shape-tools">' +
      (openable
        ? `<button class="tool" data-types="all" title="Open every type in this section, as deep as the bounds allow">Expand all</button>` +
          `<button class="tool" data-types="none"${state.openTypes.size ? '' : ' disabled'}>Collapse all</button>`
        : '') +
      '<button class="tool" data-types="copy" title="Copy what it takes and gives back as TypeScript, every type ' +
      'opened inline"><span>Copy as TypeScript</span></button></span>';
    return `<section><div class="g-shape-head"><h4>${says.title}</h4>${tools}</div>` +
      moreHtml('all') +
      (rows.length > 0 ? rows.join('') : (says.none ? `<p class="g-none">${says.none}</p>` : '')) +
      (face.returns >= 0 ? shapeRowHtml('→ ' + says.back, face.returns, 'r', none, true) : '') +
      answersHtml(v, none) +
      (says.note ? `<p class="g-shape-note">${says.note}</p>` : '') +
      cast +
      '</section>';
  };

  const drawDetails = () => {
    card.hide();
    const v = state.open;
    stage.classList.toggle('is-closed', v === null);
    panel.hidden = v === null;
    if (v === null) return;
    const d = describe(model, v);
    const t = typeOf(v);
    const kind = kinds[nodes[v][KD]];
    const hue = hueOf(nodes[v][RP]);
    const meta = metaOf(v);
    const canExpand = state.hood.more.has(v) && !state.expanded.includes(v);
    const others = state.hood.others.get(v);
    const context = contextOf(v);
    const total = (groups) => groups.reduce((sum, group) => sum + group.edges.length, 0);
    const fileRows = state.openGroups.has('file') ? d.inFile : d.inFile.slice(0, FILE_LIMIT);

    panel.innerHTML =
      '<header>' +
        `<div class="g-head"><span><span class="glyph" style="--hue:${hue}">${esc(glyphOf(v))}</span> ` +
        `<span class="hint">${esc(t)}${kind ? ' &middot; ' + esc(kind) : ''}</span></span>` +
        '<button class="g-close" data-act="close" aria-label="Close details" title="Close (Escape)">&times;</button></div>' +
        `<h3 id="g-details-title">${esc(nodes[v][LB])}</h3>` +
        `<div><span class="tag" style="color:${hue};border-color:${hue}">${esc(repoName(v))}</span> ` +
        opener(nodes[v][RP], nodes[v][FL], nodes[v][LN], placeOf(v)) + '</div>' +
        page.badgesHtml(v) +
      '</header>' +
      '<div class="g-actions">' +
        `<button class="tool" data-act="centre"${v === state.focus && state.query === null ? ' disabled' : ''}>Centre here</button>` +
        `<button class="tool" data-act="expand"${canExpand ? '' : ' disabled'} title="More of the flow, the way it ` +
        `looks from the focus (+)">${LOOK_SAYS[lookOf(v).flow].expand}</button>` +
        (others
          ? `<button class="tool" data-act="also" aria-pressed="${others.shown}" title="${ALSO_SAYS[others.look].count(others.count)}, ` +
            `not in the flow, drawn faded as context (O)">${ALSO_SAYS[others.look].ask} &middot; ${others.count.toLocaleString()}</button>`
          : '') +
        (DOORS.has(t) ? '<button class="tool" data-act="steps" aria-controls="g-steps" ' +
          'title="This way in\u2019s steps, in call order, above the drawing">Steps</button>' : '') +
        (DOORS.has(t) ? '<button class="tool" data-act="open-steps" title="This way in on the Steps tab">Open in Steps</button>' : '') +
        (DOORS.has(t) || t === 'channel'
          ? `<button class="tool" data-prompt="${t === 'channel' ? 'channel' : 'entry'}:${v}" title="Copy as Markdown for an assistant">Copy as prompt</button>`
          : '') +
      '</div>' +
      (context
        ? `<p class="hint">Not in the flow: drawn as context, it ${esc(ALSO_SAYS[context.look].mark(context.of))}. ` +
          '<i>Centre here</i> to follow it.</p>'
        : '') +
      page.checkActionsHtml(v) +
      scheduleHtml(v) +
      (meta.length > 0
        ? '<dl class="g-meta">' + meta.map(([key, value, refs]) => `<dt>${esc(key)}</dt><dd>${metaValueHtml(value, refs)}</dd>`).join('') + '</dl>'
        : '') +
      accessHtml(v) +
      failsHtml(v) +
      docsHtml(v) +
      shapeHtml(v) +
      `<section><h4>In &middot; ${total(d.into)}</h4>` +
        (d.into.length ? d.into.map((group) => edgeGroup('in', group, 0)).join('') : '<p class="g-none">Nothing reaches it.</p>') +
      '</section>' +
      `<section><h4>Out &middot; ${total(d.out)}</h4>` +
        (d.out.length ? d.out.map((group) => edgeGroup('out', group, 1)).join('') : '<p class="g-none">It reaches nothing.</p>') +
      '</section>' +
      `<section><h4>Problems &middot; ${d.rows.length + d.atLine.length}</h4>` +
        (d.rows.length ? `<div class="g-group-name">Name this node &middot; ${d.rows.length}</div>` + d.rows.map(rowHtml).join('') : '') +
        (d.atLine.length
          ? `<div class="g-group-name" style="margin-top:8px">At its line, naming no node &middot; ${d.atLine.length}</div>` +
            d.atLine.map(rowHtml).join('')
          : '') +
        (d.rows.length + d.atLine.length === 0 ? '<p class="g-none">No row names this node or sits at its line.</p>' : '') +
        (d.inFile.length
          ? `<div class="g-group-name" style="margin-top:8px">Elsewhere in its file &middot; ${d.inFile.length}</div>` +
            fileRows.map(rowHtml).join('') +
            (fileRows.length < d.inFile.length
              ? `<button class="g-more-btn" data-group="file">Show ${(d.inFile.length - fileRows.length).toLocaleString()} more</button>`
              : '')
          : '') +
      '</section>';
    panel.setAttribute('aria-labelledby', 'g-details-title');
  };

  return { drawDetails, faceRows };
}
