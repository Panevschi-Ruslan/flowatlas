import { middle } from '../graph.js';
import { pictureName, pictureScale, pinch, pressed, wheelIntent, wordFor } from '../frame.js';
import { MAP_BOX, MAP_BOX_KINDS, MAP_COLUMNS, MAP_LINK_KINDS, boxId, clusterId, createMap, formatMapHash,
  isOpen, mapCallOrder, mapCycles, mapLayout, mapMarks, mapSeenCount, mapTopTargets, mapView,
  openByDefault, serviceInside } from '../map.js';

/* The Map tab: the whole project at the size of its services, its details
   panel (which reads what was drawn, so it lives here), and what a person does
   on it. What is drawn comes from map.js; this draws it. */
export function createMapUi(page) {
  const { FL, KD, LB, LN, PICTURE_PAD, PICTURE_STYLES, SVG_NS, confidences, copyText, data, esc, files,
    flash, hueOf, keys, kinds, nodes, plural, repos, root, save, seen, store, svgEl, titleEl, typing, wheelHint, wordHtml } = page;

  /* ── the map ─────────────────────────────────────────────────────── */

  /* The whole project at the size of its services: what is drawn comes from
     map.js (mapView, mapLayout), this part draws it and answers clicks. A
     box opens its details; a closed cluster opens; a link lists the edges
     it stands for; double-click draws only a box and what it touches. */
  const mapModel = createMap(data.map);
  const mapWrap = document.getElementById('m-canvas');
  const mapSvg = document.getElementById('m-svg');
  const mapWorld = document.getElementById('m-world');
  const mapDetails = document.getElementById('m-details');
  const mapStatus = document.getElementById('m-status');
  const mapNotice = document.getElementById('m-notice');
  const mapState = {
    toggled: new Set(), hidden: new Set(), packages: false, dev: false,
    focus: null, selected: null, link: null, mark: null, layout: 'calls',
  };
  let mapDrawn = null;
  let mapFit = true;

  const COLUMN_SAYS = {
    front: 'front ends', api: 'APIs and ways in', channel: 'channels', worker: 'workers and workflows',
    library: 'libraries', data: 'data', external: 'outside', package: 'packages',
  };
  const KIND_SAYS = {
    http: 'requests', message: 'messages', workflow: 'workflow starts', invoke: 'function invokes',
    db: 'queries', external: 'outside calls', calls: 'calls', package: 'depends on',
  };
  const MARK_SAYS = {
    problems: 'problems to fix', dead: 'channels with one end', uncalled: 'routes nothing calls',
    cycles: 'in a cycle', unread: 'not read',
  };

  const boxOfUnit = (unit) => mapModel.boxes[unit.members[0]];
  const boxKind = (i) => MAP_BOX_KINDS[mapModel.boxes[i].k];
  /* A family as its members are named: `pay-api-*` for services sharing a
     prefix, `@scope/*` for packages, a channel family by what carries it. */
  const clusterLabel = (id) => {
    const cluster = mapModel.clusters.get(id);
    const kind = MAP_BOX_KINDS[cluster.kind];
    return kind === 'channel' ? cluster.key : kind === 'package' ? cluster.key + '/*' : cluster.key + '*';
  };
  const unitName = (unit) => {
    if (unit.closed) return clusterLabel(unit.cluster);
    const box = boxOfUnit(unit);
    return MAP_BOX_KINDS[box.k] === 'data' ? box.n + ' data' : box.n;
  };
  const repoIndex = new Map(repos.map((name, i) => [name, i]));
  const unitHue = (unit) => {
    const box = boxOfUnit(unit);
    const kind = MAP_BOX_KINDS[box.k];
    if (kind === 'service' || kind === 'data') return repoIndex.has(box.n) ? hueOf(repoIndex.get(box.n)) : 'var(--faint)';
    if (kind === 'channel') return 'var(--s-3)';
    if (kind === 'external') return 'var(--s-1)';
    return 'var(--accent)';
  };
  /* A front end with no actions read still has screens (P101): it says those
     rather than "0 ways in". */
  const waysSaid = (s) => (!s.ways && s.screens ? plural(s.screens, 'screen', 'screens') : plural(s.ways || 0, 'way in', 'ways in'));
  const summed = (unit, key) => unit.members.reduce((sum, i) => sum + (mapModel.boxes[i].s[key] || 0), 0);
  const unitSub = (unit) => {
    if (unit.closed) {
      const kind = boxKind(unit.members[0]);
      const what = { service: 'services', channel: 'channels', package: 'packages' }[kind] || 'boxes';
      return plural(unit.members.length, what.slice(0, -1), what) + ' · click to open';
    }
    const box = boxOfUnit(unit);
    const s = box.s;
    switch (MAP_BOX_KINDS[box.k]) {
      case 'service': return s.unread ? 'not read' : waysSaid(s) + ' · ' + plural(s.nodes || 0, 'node', 'nodes');
      case 'channel': return `${s.producers} in → ${s.consumers} out`;
      case 'data': return plural(s.tables || 0, 'table', 'tables');
      case 'external': return 'outside the project';
      default: return 'used by ' + plural(s.users || 0, 'service', 'services');
    }
  };

  const mapHashNow = () => formatMapHash({
    selected: mapState.link === null ? mapState.selected : null,
    link: mapState.link,
    focus: mapState.focus, toggled: mapState.toggled, hidden: mapState.hidden,
    mark: mapState.mark, packages: mapState.packages, dev: mapState.dev, layout: mapState.layout,
  });
  const writeMapHash = () => {
    if (store.get('view') !== 'map') return;
    const next = mapHashNow();
    if (location.hash !== next) history.replaceState(null, '', location.pathname + location.search + next);
  };

  /* The camera: one transform on the world, like the Graph tab's. */
  const mapCamera = (() => {
    let x = 0, y = 0, k = 1;
    const apply = () => mapWorld.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
    const bound = (value) => Math.min(2.4, Math.max(0.08, value));
    const size = () => ({ w: mapWrap.clientWidth || 900, h: mapWrap.clientHeight || 600 });
    const zoomAt = (px, py, factor) => {
      const next = bound(k * factor);
      x = px - ((px - x) * next) / k;
      y = py - ((py - y) * next) / k;
      k = next;
      apply();
    };
    return {
      zoomAt,
      zoom(factor) { const { w, h } = size(); zoomAt(w / 2, h / 2, factor); },
      pan(dx, dy) { x += dx; y += dy; apply(); },
      /* The whole map, as large as fits but never larger than life. */
      fit(laid) {
        const screen = size();
        const pad = 40;
        const w = laid.width + pad * 2;
        const h = laid.height + pad * 2 + 40;
        k = bound(Math.min(1, screen.w / w, screen.h / h));
        x = (screen.w - laid.width * k) / 2;
        // Centred when it fills the frame; a short one sits at the top,
        // since a frame taller than the window would push it out of sight.
        y = Math.min((screen.h - (laid.height + 40) * k) / 2, pad) + 40 * k;
        apply();
      },
    };
  })();

  const mapPath = (a, b) => {
    // Left to right between columns; back the other way from the left side;
    // within a column, out and back on the right.
    const ay = a.y + a.h / 2, by = b.y + b.h / 2;
    if (b.x > a.x) {
      const x1 = a.x + a.w, x2 = b.x, dx = (x2 - x1) / 2;
      return `M${x1} ${ay} C${x1 + dx} ${ay} ${x2 - dx} ${by} ${x2} ${by}`;
    }
    if (b.x < a.x) {
      const x1 = a.x, x2 = b.x + b.w, dx = Math.max(60, (x1 - x2) / 2);
      return `M${x1} ${ay} C${x1 - dx} ${ay} ${x2 + dx} ${by} ${x2} ${by}`;
    }
    const x1 = a.x + a.w, bend = 40 + Math.min(80, Math.abs(by - ay) / 4);
    return `M${x1} ${ay} C${x1 + bend} ${ay} ${x1 + bend} ${by} ${x1} ${by}`;
  };

  function drawMap(refit) {
    const shown = mapView(mapModel, mapState, confidences);
    const laid = mapState.layout === 'role' ? mapLayout(mapModel, shown) : mapCallOrder(mapModel, shown);
    const notDrawn = laid.hidden || new Set();
    const cycles = mapCycles(shown);
    const marks = mapState.mark ? mapMarks(mapModel, shown, mapState.mark, cycles) : new Map();
    mapDrawn = { view: shown, laid, cycles };
    if (mapState.selected !== null && !shown.units.has(mapState.selected)) mapState.selected = null;
    if (mapState.link !== null && !shown.links.some((link) => link.id === mapState.link)) mapState.link = null;

    const out = [];
    for (const column of laid.columns) {
      out.push(svgEl('text', { class: 'm-col', x: column.x, y: -22 }, column.label || COLUMN_SAYS[column.name]));
    }
    for (const frame of laid.frames) {
      const cluster = mapModel.clusters.get(frame.cluster);
      const group = svgEl('g', { class: 'm-frame-group' });
      group.append(svgEl('rect', { class: 'm-frame', x: frame.x, y: frame.y, width: frame.w, height: frame.h, rx: 4 }));
      const head = svgEl('g', {
        class: 'm-frame-head', 'data-cluster': frame.cluster, tabindex: 0, role: 'button',
        'aria-label': `Close ${clusterLabel(frame.cluster)}, ${cluster.members.length} boxes`,
      });
      head.append(svgEl('text', { x: frame.x + 8, y: frame.y + 16 },
        `${clusterLabel(frame.cluster)} · ${cluster.members.length}  ▾ close`));
      group.append(head);
      out.push(group);
    }
    const linkLayer = svgEl('g', { class: 'm-links' });
    for (const link of shown.links) {
      const a = laid.placed.get(link.from), b = laid.placed.get(link.to);
      if (!a || !b) continue;
      const d = mapPath(a, b);
      const conf = link.worst >= 0 ? confidences[link.worst] : '';
      const seenTimes = seen.any ? mapSeenCount(mapModel, link, seen.join) : 0;
      const width = Math.min(6, 1.2 + Math.log2(link.count)) + (seenTimes > 0 ? Math.min(4, 1.5 + Math.log10(seenTimes)) : 0);
      const guessed = conf !== '' && conf !== 'static' && conf !== 'marker';
      const cls = ['m-link', 'm-k-' + link.kind,
        guessed ? 'is-guess' : '', conf === 'heuristic' ? 'is-heuristic' : '', seenTimes > 0 ? 'is-seen' : '',
        link.kind === 'package' && link.dev ? 'is-dev' : '',
        mapState.mark === 'cycles' && cycles.links.has(link.id) ? 'is-cycle' : '',
        mapState.link === link.id ? 'is-open' : ''].filter(Boolean).join(' ');
      const say = `${unitName(shown.units.get(link.from))} → ${unitName(shown.units.get(link.to))}: ` +
        `${plural(link.count, KIND_SAYS[link.kind] === 'depends on' ? 'package' : 'edge', KIND_SAYS[link.kind] === 'depends on' ? 'packages' : 'edges')}, ${KIND_SAYS[link.kind]}` +
        (conf && conf !== 'static' ? `, ${wordFor('trust', conf)} at worst` : '') + (seenTimes > 0 ? `, seen ${seenTimes.toLocaleString()} times at run time` : '');
      const hit = svgEl('path', { class: 'm-hit', d, 'data-link': link.id });
      hit.append(svgEl('title', {}, say));
      linkLayer.append(hit,
        svgEl('path', { class: cls, d, 'stroke-width': width, 'marker-end': 'url(#m-arrow)', 'data-for': link.id }));
    }
    out.push(linkLayer);
    for (const more of laid.more || []) {
      const group = svgEl('g', { class: 'm-more', 'data-more': more.owner, tabindex: 0, role: 'button',
        'aria-label': `${more.n} more under ${unitName(shown.units.get(more.owner))}`, transform: `translate(${more.x} ${more.y})` });
      group.append(svgEl('text', { x: 4, y: 13 }, `+${more.n} more`));
      group.append(svgEl('title', {}, 'Stores and outside hosts not drawn here; click for the whole list'));
      out.push(group);
    }
    for (const [id, unit] of shown.units) {
      if (notDrawn.has(id)) continue;
      const at = laid.placed.get(id);
      if (at.under) {
        const top = laid.placed.get(at.under);
        out.push(svgEl('path', { class: 'm-hang', d: `M${top.x + 8} ${top.y + top.h} V${at.y + at.h / 2} H${at.x}` }));
      }
      const name = unitName(unit);
      const group = svgEl('g', {
        class: ['m-unit', unit.closed ? 'is-cluster' : '', mapState.selected === id ? 'is-open' : '',
          shown.focus === id ? 'is-focus' : '', mapState.mark === 'cycles' && cycles.units.has(id) ? 'is-cycle' : '']
          .filter(Boolean).join(' '),
        'data-unit': id, tabindex: 0, role: 'button',
        'aria-label': `${name}, ${unitSub(unit)}`,
        style: `--hue: ${unitHue(unit)}`,
        transform: `translate(${at.x} ${at.y})`,
      });
      if (unit.closed) {
        group.append(svgEl('rect', { class: 'm-sheet', x: 6, y: -6, width: at.w, height: at.h, rx: 3 }));
        group.append(svgEl('rect', { class: 'm-sheet', x: 3, y: -3, width: at.w, height: at.h, rx: 3 }));
      }
      group.append(svgEl('rect', { class: 'm-box', width: at.w, height: at.h, rx: 3 }));
      group.append(svgEl('rect', { class: 'm-rule', width: 4, height: at.h, rx: 1 }));
      group.append(svgEl('text', { class: 'm-name', x: 13, y: 19 }, middle(name, 27)));
      group.append(svgEl('text', { class: 'm-sub', x: 13, y: 35 }, middle(unitSub(unit), 36)));
      const marked = marks.get(id);
      if (marked) {
        const badge = svgEl('g', { class: 'm-badge' + (mapState.mark === 'problems' || mapState.mark === 'cycles' ? '' : ' is-warn'),
          transform: `translate(${at.w - 4} 4)` });
        const text = mapState.mark === 'cycles' ? '↻' : String(marked);
        badge.append(svgEl('circle', { r: 9 + Math.max(0, text.length - 2) * 3 }),
          svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, text));
        badge.append(svgEl('title', {}, `${marked} ${MARK_SAYS[mapState.mark]}`));
        group.append(badge);
      }
      group.append(svgEl('title', {}, name));
      out.push(group);
    }
    mapWorld.replaceChildren(...out);
    if (refit || mapFit) { mapCamera.fit(laid); mapFit = false; }

    document.getElementById('m-whole').hidden = shown.focus === null;
    document.getElementById('m-dev-pick').hidden = !mapState.packages;
    const services = mapModel.boxes.filter((box) => MAP_BOX_KINDS[box.k] === 'service').length;
    const markCount = [...marks.values()].reduce((sum, n) => sum + n, 0);
    mapStatus.textContent = `${plural(services, 'service', 'services')} · ${plural(shown.units.size, 'box', 'boxes')} drawn · ` +
      `${plural(shown.links.length, 'link', 'links')}` +
      (shown.focus ? ` · only ${unitName(shown.units.get(shown.focus))} and what it touches` : '') +
      (mapState.mark ? ` · ${plural(markCount, 'mark', 'marks')}: ${MARK_SAYS[mapState.mark]}` : '');
    drawMapDetails();
    placeAsList(shown);
    writeMapHash();
  }

  /* ── the map on a phone: a list of its boxes (P102) ── */

  /* Below 640px a drawing of the whole project is either unreadable or not
     whole, so the Map tab lists its boxes instead: one card each, under the
     call-order column it would be drawn in (step 1, queues and topics, step
     2…), with what it reaches and what reaches it as buttons. A card opens
     the same details the drawing's box does, under the card; the drawing is
     one button away. Same state, same addresses. */
  const mapStage = document.getElementById('m-stage');
  const cardsEl = document.getElementById('m-cards');
  const asListBtn = document.getElementById('m-as-list');
  const phone = window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;
  let drawingAsked = false;
  const LIST_LINKS = 6;
  const asList = () => phone !== null && phone.matches && !drawingAsked && !mapFull;

  const reportedType = (box) => {
    if (MAP_BOX_KINDS[box.k] !== 'service') return '';
    const reported = (data.report.services || []).find((service) => service.name === box.n);
    return reported ? reported.type : '';
  };
  const cardLinks = (say, others) => others.length === 0 ? ''
    : `<p class="m-card-links"><span class="m-card-say">${say}</span> ` +
      others.slice(0, LIST_LINKS).map(({ id, text }) => unitButton(id, text)).join(', ') +
      (others.length > LIST_LINKS ? ` <span class="hint">and ${(others.length - LIST_LINKS).toLocaleString()} more</span>` : '') + '</p>';
  const mapListHtml = (map, view) => {
    if (view.units.size === 0) {
      return '<p class="m-note m-cards-none">No service was read, so the map has nothing to list. ' +
        '<code>flowatlas doctor</code> says why.</p>';
    }
    const laid = mapCallOrder(map, view);
    const step = MAP_BOX.w + MAP_BOX.column;
    const columns = laid.columns.map((column) => ({ label: column.label, cards: [] }));
    for (const [id, at] of laid.placed) columns[Math.floor(at.x / step)]?.cards.push({ id, at });
    const moreOf = new Map((laid.more || []).map((more) => [more.owner, more.n]));
    const marks = mapState.mark ? mapMarks(map, view, mapState.mark, mapCycles(view)) : new Map();
    const others = (id, way) => {
      const seenIds = new Set();
      const out = [];
      for (const link of view.links) {
        const other = way === 'out' ? (link.from === id ? link.to : null) : (link.to === id ? link.from : null);
        if (other === null || seenIds.has(other)) continue;
        seenIds.add(other);
        out.push({ id: other, text: unitName(view.units.get(other)) });
      }
      return out;
    };
    const card = ({ id, at }) => {
      const unit = view.units.get(id);
      const box = boxOfUnit(unit);
      const open = mapState.selected === id;
      const problems = unit.closed ? summed(unit, 'problems') : box.s.problems || 0;
      const facts = [unit.closed ? '' : reportedType(box), unitSub(unit),
        MAP_BOX_KINDS[box.k] === 'service' && problems > 0 ? plural(problems, 'problem to fix', 'problems to fix') : '',
        marks.has(id) ? `${marks.get(id)} ${MARK_SAYS[mapState.mark]}` : ''].filter(Boolean);
      return `<li class="m-card${open ? ' is-open' : ''}${at.under ? ' is-under' : ''}" data-card="${esc(id)}" style="--hue: ${unitHue(unit)}">` +
        `<button class="m-card-name" data-card-open="${esc(id)}" aria-expanded="${open}">${esc(unitName(unit))}</button>` +
        `<p class="m-card-sub">${facts.map(esc).join(' &middot; ')}</p>` +
        cardLinks('reaches', others(id, 'out')) + cardLinks('reached by', others(id, 'in')) +
        (moreOf.has(id) ? `<p class="m-card-links hint">${plural(moreOf.get(id), 'more store or host', 'more stores and hosts')} in its details</p>` : '') +
        '</li>';
    };
    return '<div class="m-cards-head"><p class="m-note">The boxes of the map, a column at a time.</p>' +
      '<button class="tool" data-show-drawing>Show the drawing</button></div>' +
      columns.filter((column) => column.cards.length > 0).map((column) =>
        `<section class="m-step"><h3 class="m-step-head">${esc(column.label)} <span class="hint">${column.cards.length}</span></h3>` +
        `<ul class="m-card-list">${column.cards.sort((a, b) => a.at.y - b.at.y).map(card).join('')}</ul></section>`).join('');
  };

  /* The list or the drawing, whichever fits; the details go under the card
     that is open, and back beside the drawing when it is drawn. */
  const placeAsList = (shown) => {
    const listed = asList();
    cardsEl.hidden = !listed;
    mapWrap.hidden = listed;
    asListBtn.hidden = listed || phone === null || !phone.matches;
    if (!listed) {
      if (mapDetails.parentNode !== mapStage) mapStage.append(mapDetails);
      mapDetails.hidden = false;
      return;
    }
    // The drawing is fitted again when it is next shown, at its own size.
    mapFit = true;
    cardsEl.innerHTML = mapListHtml(mapModel, shown);
    const open = mapState.selected === null ? null : cardsEl.querySelector(`[data-card="${CSS.escape(mapState.selected)}"]`);
    mapDetails.hidden = open === null && mapState.link === null;
    if (open !== null) open.append(mapDetails);
    else if (mapDetails.parentNode !== mapStage) mapStage.append(mapDetails);
  };

  cardsEl.addEventListener('click', (event) => {
    if (event.target.closest('.g-details')) return;
    const el = event.target.closest('[data-card-open], [data-go-unit], [data-show-drawing]');
    if (!el) return;
    if (el.dataset.showDrawing !== undefined) { drawingAsked = true; drawMap(true); return; }
    const id = el.dataset.cardOpen ?? el.dataset.goUnit;
    const unit = mapDrawn.view.units.get(id);
    if (unit && unit.closed) toggleCluster(unit.cluster);
    else if (el.dataset.cardOpen !== undefined && mapState.selected === id) { mapState.selected = null; drawMap(false); }
    else selectUnit(id);
    cardsEl.querySelector(`[data-card-open="${CSS.escape(mapState.selected ?? id)}"]`)?.focus({ preventScroll: true });
  });
  asListBtn.addEventListener('click', () => { drawingAsked = false; drawMap(false); });
  if (phone !== null && phone.addEventListener) {
    phone.addEventListener('change', () => { if (store.get('view') === 'map' && mapDrawn) drawMap(true); });
  }

  /* ── the map's details ── */

  const toGraph = (v, text) => v >= 0
    ? `<a href="#graph/${keys.keyOf(v)}" title="Open in the Graph tab">${esc(text)}</a>`
    : esc(text);
  const unitButton = (id, text) => `<button data-go-unit="${esc(id)}">${esc(text)}</button>`;
  const linkButton = (id, text) => `<button data-go-link="${esc(id)}">${esc(text)}</button>`;
  const linksOf = (id) => {
    const shown = mapDrawn.view;
    const outward = shown.links.filter((link) => link.from === id).sort((a, b) => b.count - a.count);
    const inward = shown.links.filter((link) => link.to === id).sort((a, b) => b.count - a.count);
    const row = (link, other) => `<li><span class="m-swatch m-k-${link.kind}"></span>` +
      `<span class="m-what">${linkButton(link.id, unitName(shown.units.get(other)))}</span>` +
      `<span class="m-n">${link.count} ${esc(KIND_SAYS[link.kind])}</span></li>`;
    return (outward.length ? `<section><h4>Reaches · ${outward.length}</h4><ul class="m-list">` +
        outward.map((link) => row(link, link.to)).join('') + '</ul></section>' : '') +
      (inward.length ? `<section><h4>Reached by · ${inward.length}</h4><ul class="m-list">` +
        inward.map((link) => row(link, link.from)).join('') + '</ul></section>' : '');
  };
  const LIST_CAP = 40;
  const capped = (items, render, cap = LIST_CAP) =>
    items.slice(0, cap).map(render).join('') +
    (items.length > cap ? `<li><span class="m-n">${(items.length - cap).toLocaleString()} more</span></li>` : '');

  const mapHead = (title, sub, actions) =>
    `<header><div class="g-head"><h3>${esc(title)}</h3>` +
    '<button class="g-close" data-map-close aria-label="Close" title="Close (Escape)">&times;</button></div>' +
    `<div class="g-place">${sub}</div>` + (actions ? `<div class="g-actions">${actions}</div>` : '') + '</header>';

  const TOP_SAYS = { tables: 'Busiest tables', channels: 'Busiest channels' };
  const topTargetsHtml = (repo) => {
    const top = mapTopTargets(data, repo);
    return Object.entries(TOP_SAYS).filter(([key]) => top[key].length > 0).map(([key, title]) =>
      `<section><h4>${title}</h4><ul class="m-list">` +
      top[key].map(({ node, n }) => `<li><span class="m-what">${toGraph(node, nodes[node][LB])}</span>` +
        `<span class="m-n">${plural(n, 'edge', 'edges')}</span></li>`).join('') + '</ul></section>').join('');
  };

  const serviceDetails = (unit) => {
    const i = unit.members[0];
    const box = mapModel.boxes[i];
    const s = box.s;
    const reported = (data.report.services || []).find((service) => service.name === box.n);
    const counts = [...Object.keys(s).filter((key) => key.startsWith('e:')).map((key) => `${s[key]} ${key.slice(2)}`),
      s.actions ? plural(s.actions, 'screen action', 'screen actions') : ''].filter(Boolean).join(' · ');
    const manifest = data.map.manifests[i];
    const pkgName = (p) => data.map.packages[p];
    const published = new Map();
    for (const [at, other] of Object.entries(data.map.manifests)) {
      if (other.name) published.set(other.name, mapModel.boxes[Number(at)]);
    }
    const pkgRow = (p) => {
      const name = pkgName(p);
      const by = published.get(name);
      return `<li><span class="m-what">${esc(name)}</span>` +
        (by ? `<span class="m-n">${unitButton(boxId(by), 'from ' + by.n)}</span>` : '') + '</li>';
    };
    const inside = serviceInside(data, box.n);
    const focusing = mapState.focus === unit.id;
    const actions =
      (box.a >= 0 ? `<a class="tool" href="#graph/${keys.keyOf(box.a)}">Open in Graph</a>` : '') +
      `<button class="tool" data-map-focus="${esc(unit.id)}">${focusing ? 'Whole map' : 'Only this and what it touches'}</button>` +
      // The service whole, as describe_for_prompt({scope: "service"}) writes it (P134).
      `<button class="tool" data-prompt="service:${esc(box.n)}" title="Copy this service as Markdown for an assistant">Copy as prompt</button>` +
      (unit.cluster ? `<button class="tool" data-map-toggle="${esc(unit.cluster)}">Close ${esc(clusterLabel(unit.cluster))}</button>` : '');
    return mapHead(box.n, `${esc(COLUMN_SAYS[MAP_COLUMNS[box.c]])}${reported ? ' · ' + esc(reported.type) : ''}`, actions) +
      '<section><dl class="g-meta">' +
      `<dt>nodes</dt><dd>${(s.nodes || 0).toLocaleString()}</dd>` +
      `<dt>ways in</dt><dd>${(s.ways || 0).toLocaleString()}${counts ? ' · ' + esc(counts) : ''}</dd>` +
      (s.screens ? `<dt>screens</dt><dd>${s.screens.toLocaleString()}</dd>` : '') +
      `<dt>problems to fix</dt><dd>${(s.problems || 0).toLocaleString()}</dd>` +
      (s.uncalled ? `<dt>routes nothing calls</dt><dd>${s.uncalled.toLocaleString()}</dd>` : '') +
      (s.uncalledOutside ? `<dt>routes called from outside</dt><dd>${s.uncalledOutside.toLocaleString()} · probes, webhooks, callbacks, streams and routes declared public</dd>` : '') +
      (s.failing ? `<dt>routes with failures</dt><dd>${s.failing.toLocaleString()}</dd>` : '') +
      (s.statusUnknown ? `<dt>routes answering an unknown status</dt><dd>${s.statusUnknown.toLocaleString()}</dd>` : '') +
      (s.unread ? '<dt>read</dt><dd>no: nothing could read it</dd>' : '') +
      '</dl></section>' +
      linksOf(unit.id) +
      topTargetsHtml(box.n) +
      (inside.ways.length ? `<section><h4>Ways in · ${(inside.ways.length + inside.waysLeft).toLocaleString()}</h4><ul class="m-list">` +
        inside.ways.map((v) => `<li><span class="m-what">${toGraph(v, nodes[v][LB])}</span>` +
          `<span class="m-n">${esc(kinds[nodes[v][KD]] || 'screen action')}</span></li>`).join('') +
        (inside.waysLeft ? `<li><span class="m-n">${inside.waysLeft.toLocaleString()} more</span></li>` : '') + '</ul></section>' : '') +
      (inside.classes.length ? '<section><h4>Busiest classes</h4><ul class="m-list">' +
        inside.classes.map((c) => `<li><span class="m-what">${esc(c.name)}</span><span class="m-n">${c.edges} edges</span></li>`).join('') +
        '</ul></section>' : '') +
      (manifest ? `<section><h4>Built from${manifest.name ? ' · published as ' + esc(manifest.name) : ''}</h4>` +
        `<p class="g-place">${plural(manifest.runtime.length, 'package', 'packages')} at run time, ` +
        `${plural(manifest.dev.length, 'more', 'more')} for development</p>` +
        `<ul class="m-list">${capped(manifest.runtime, pkgRow)}</ul></section>` : '');
  };

  const clusterDetails = (unit) => {
    const cluster = mapModel.clusters.get(unit.cluster);
    const rows = unit.members.map((i) => mapModel.boxes[i])
      .sort((a, b) => (a.n < b.n ? -1 : 1))
      .map((box) => `<li><span class="m-what">${unitButton(boxId(box), box.n)}</span>` +
        `<span class="m-n">${box.s.ways || box.s.screens ? waysSaid(box.s) : ''}</span></li>`).join('');
    return mapHead(clusterLabel(unit.cluster), `${plural(unit.members.length, 'box', 'boxes')} in ${esc(COLUMN_SAYS[MAP_COLUMNS[cluster.column]])}` +
        (unit.inside ? ` · ${unit.inside.toLocaleString()} edges between them` : ''),
      `<button class="tool" data-map-toggle="${esc(unit.cluster)}">Open</button>` +
      `<button class="tool" data-map-focus="${esc(unit.id)}">${mapState.focus === unit.id ? 'Whole map' : 'Only this and what it touches'}</button>`) +
      '<section><dl class="g-meta">' +
      `<dt>ways in</dt><dd>${summed(unit, 'ways').toLocaleString()}</dd>` +
      `<dt>problems to fix</dt><dd>${summed(unit, 'problems').toLocaleString()}</dd>` +
      '</dl></section>' + linksOf(unit.id) +
      `<section><h4>In it</h4><ul class="m-list">${rows}</ul></section>`;
  };

  const otherDetails = (unit) => {
    const box = boxOfUnit(unit);
    const kind = MAP_BOX_KINDS[box.k];
    const s = box.s;
    const facts = {
      channel: `<dt>producers</dt><dd>${s.producers}</dd><dt>consumers</dt><dd>${s.consumers}</dd>` +
        (s.producers === 0 || s.consumers === 0 ? `<dt>check</dt><dd>${s.producers === 0 ? 'nothing publishes to it' : 'nothing consumes it'}</dd>` : ''),
      data: `<dt>tables</dt><dd>${(s.tables || 0).toLocaleString()}</dd>`,
      external: '<dt>where</dt><dd>outside the project</dd>',
      package: `<dt>used by</dt><dd>${plural(s.users || 0, 'service', 'services')}</dd>`,
    }[kind] || '';
    const what = { channel: 'a channel', data: `the tables ${esc(box.n)} reads and writes`, external: 'an outside API', package: 'a package' }[kind];
    const actions = (box.a >= 0 ? `<a class="tool" href="#graph/${keys.keyOf(box.a)}">Open in Graph</a>` : '') +
      (kind === 'channel' && box.a >= 0 ? `<button class="tool" data-prompt="channel:${box.a}" title="Copy as Markdown for an assistant">Copy as prompt</button>` : '') +
      `<button class="tool" data-map-focus="${esc(unit.id)}">${mapState.focus === unit.id ? 'Whole map' : 'Only this and what it touches'}</button>`;
    return mapHead(unitName(unit), what, actions) +
      `<section><dl class="g-meta">${facts}</dl></section>` + linksOf(unit.id);
  };

  const EDGE_CAP = 200;
  const linkDetails = (link) => {
    const shown = mapDrawn.view;
    const from = shown.units.get(link.from), to = shown.units.get(link.to);
    const rows = [];
    const packages = [];
    for (const i of link.links) {
      const raw = mapModel.links[i];
      if (raw.k === MAP_LINK_KINDS.indexOf('package')) {
        packages.push(`${mapModel.boxes[raw.f].n} → ${raw.p || mapModel.boxes[raw.t].n}${raw.d ? ' (development)' : ''}`);
      }
      for (const e of raw.e || []) rows.push(e);
    }
    const edgeRow = (e) => {
      const [a, b, , c] = data.edges[e];
      const where = files[nodes[a][FL]] ? `${files[nodes[a][FL]]}:${nodes[a][LN]}` : '';
      return `<li><span class="m-what" title="${esc(nodes[a][LB] + ' → ' + nodes[b][LB])}">` +
        `${toGraph(a, nodes[a][LB])} → ${toGraph(b, nodes[b][LB])}</span>` +
        `<span class="m-n" title="${esc(where)}">${confidences[c] === 'static' ? '' : wordHtml('trust', confidences[c])}</span></li>`;
    };
    const trustSaid = (c) => wordFor('trust', confidences[c]);
    const conf = link.best >= 0 ? (link.best === link.worst ? trustSaid(link.best) : `${trustSaid(link.best)} to ${trustSaid(link.worst)}`) : '';
    return mapHead(`${unitName(from)} → ${unitName(to)}`,
      `${esc(KIND_SAYS[link.kind])} · ${plural(link.count, 'edge', 'edges')}${conf ? ' · ' + esc(conf) : ''}`,
      `${unitButton(link.from, 'From: ' + unitName(from))} ${unitButton(link.to, 'To: ' + unitName(to))}`.replace(/<button /g, '<button class="tool" ')) +
      (packages.length ? `<section><h4>Packages</h4><ul class="m-list">${capped(packages, (p) => `<li><span class="m-what">${esc(p)}</span></li>`)}</ul></section>` : '') +
      (rows.length ? `<section><h4>Edges · ${rows.length.toLocaleString()}</h4><ul class="m-list">` +
        capped(rows, edgeRow, EDGE_CAP) + '</ul><p class="g-place">Each end opens in the Graph tab.</p></section>' : '');
  };

  const overview = () => {
    const shown = mapDrawn.view;
    const byKind = new Map();
    for (const link of shown.links) byKind.set(link.kind, (byKind.get(link.kind) || 0) + link.count);
    const columns = new Map();
    for (const unit of shown.units.values()) {
      const name = MAP_COLUMNS[unit.column];
      columns.set(name, (columns.get(name) || 0) + unit.members.length);
    }
    return '<header><div class="g-head"><h3>The whole project</h3></div>' +
      '<p class="m-note">Click a box for what it is and what it touches, a link for the edges behind it, ' +
      'a stacked box to open its family. Double-click draws one box and what it touches.</p></header>' +
      '<section><h4>Boxes</h4><dl class="g-meta">' +
      MAP_COLUMNS.filter((name) => columns.has(name))
        .map((name) => `<dt>${esc(COLUMN_SAYS[name])}</dt><dd>${columns.get(name).toLocaleString()}</dd>`).join('') +
      '</dl></section>' +
      (byKind.size ? '<section><h4>Links, by what passes</h4><ul class="m-list">' +
        MAP_LINK_KINDS.filter((kind) => byKind.has(kind)).map((kind) =>
          `<li><span class="m-swatch m-k-${kind}"></span><span class="m-what">${esc(KIND_SAYS[kind])}</span>` +
          `<span class="m-n">${byKind.get(kind).toLocaleString()}</span></li>`).join('') + '</ul></section>' : '');
  };

  function drawMapDetails() {
    const shown = mapDrawn.view;
    let html;
    if (mapState.link !== null) html = linkDetails(shown.links.find((link) => link.id === mapState.link));
    else if (mapState.selected !== null) {
      const unit = shown.units.get(mapState.selected);
      html = unit.closed ? clusterDetails(unit) : boxKind(unit.members[0]) === 'service' ? serviceDetails(unit) : otherDetails(unit);
    } else html = overview();
    mapDetails.innerHTML = html;
  }

  /* ── what a person does on the map ── */

  const mapSay = {
    say(html) {
      mapNotice.innerHTML = `<span>${html}</span><button class="g-close" aria-label="Dismiss" title="Dismiss">&times;</button>`;
      mapNotice.hidden = false;
    },
    clear() { mapNotice.hidden = true; mapNotice.replaceChildren(); },
  };
  mapNotice.addEventListener('click', (event) => { if (event.target.closest('button')) mapSay.clear(); });

  const selectUnit = (id) => {
    // A box inside a closed cluster opens the cluster first.
    const i = mapModel.byId.get(id);
    if (i !== undefined) {
      const box = mapModel.boxes[i];
      if (box.g !== '' && !isOpen(mapModel, clusterId(box), mapState.toggled)) toggleCluster(clusterId(box), false);
      if (MAP_BOX_KINDS[box.k] === 'package' && !mapState.packages) mapState.packages = true;
    }
    mapState.selected = id;
    mapState.link = null;
    drawMap(false);
    const el = mapWorld.querySelector(`[data-unit="${CSS.escape(id)}"]`);
    if (el) el.focus({ preventScroll: true });
  };
  const toggleCluster = (id, redraw = true) => {
    if (mapState.toggled.has(id)) mapState.toggled.delete(id); else mapState.toggled.add(id);
    if (mapState.selected === id) mapState.selected = null;
    if (redraw) drawMap(false);
  };
  const toggleFocus = (id) => {
    mapState.focus = mapState.focus === id ? null : id;
    mapState.selected = id;
    mapState.link = null;
    drawMap(true);
  };

  let mapDragged = false;
  mapSvg.addEventListener('click', (event) => {
    if (mapDragged) { mapDragged = false; return; }
    const head = event.target.closest('.m-frame-head');
    if (head) { toggleCluster(head.dataset.cluster); return; }
    const hit = event.target.closest('.m-hit');
    if (hit) { mapState.link = hit.dataset.link; mapState.selected = null; drawMap(false); return; }
    const moreEl = event.target.closest('.m-more');
    if (moreEl) { mapState.selected = moreEl.dataset.more; mapState.link = null; drawMap(false); return; }
    const unitEl = event.target.closest('.m-unit');
    if (!unitEl) return;
    const unit = mapDrawn.view.units.get(unitEl.dataset.unit);
    if (unit.closed) toggleCluster(unit.cluster);
    else { mapState.selected = unit.id; mapState.link = null; drawMap(false); }
  });
  mapSvg.addEventListener('dblclick', (event) => {
    const unitEl = event.target.closest('.m-unit');
    if (unitEl) toggleFocus(unitEl.dataset.unit);
  });
  mapSvg.addEventListener('keydown', (event) => {
    const unitEl = event.target.closest('.m-unit, .m-frame-head');
    if (!unitEl || !pressed('map.open', event)) return;
    event.preventDefault();
    if (unitEl.classList.contains('m-frame-head')) { toggleCluster(unitEl.dataset.cluster); return; }
    const unit = mapDrawn.view.units.get(unitEl.dataset.unit);
    if (unit.closed) toggleCluster(unit.cluster);
    else selectUnit(unit.id);
  });
  /* Hovering a box lights what it touches. */
  mapSvg.addEventListener('pointerover', (event) => {
    const unitEl = event.target.closest('.m-unit');
    for (const el of mapWorld.querySelectorAll('.is-on')) el.classList.remove('is-on');
    if (!unitEl) { mapWorld.classList.remove('is-tracing'); return; }
    const id = unitEl.dataset.unit;
    mapWorld.classList.add('is-tracing');
    unitEl.classList.add('is-on');
    for (const link of mapDrawn.view.links) {
      if (link.from !== id && link.to !== id) continue;
      const other = link.from === id ? link.to : link.from;
      mapWorld.querySelector(`[data-for="${CSS.escape(link.id)}"]`)?.classList.add('is-on');
      mapWorld.querySelector(`[data-unit="${CSS.escape(other)}"]`)?.classList.add('is-on');
    }
  });
  mapSvg.addEventListener('pointerleave', () => {
    mapWorld.classList.remove('is-tracing');
    for (const el of mapWorld.querySelectorAll('.is-on')) el.classList.remove('is-on');
  });

  mapDetails.addEventListener('click', (event) => {
    const el = event.target.closest('[data-go-unit], [data-go-link], [data-map-focus], [data-map-toggle], [data-map-close]');
    if (!el) return;
    if (el.dataset.goUnit !== undefined) selectUnit(el.dataset.goUnit);
    else if (el.dataset.goLink !== undefined) { mapState.link = el.dataset.goLink; mapState.selected = null; drawMap(false); }
    else if (el.dataset.mapFocus !== undefined) toggleFocus(el.dataset.mapFocus);
    else if (el.dataset.mapToggle !== undefined) toggleCluster(el.dataset.mapToggle);
    else { mapState.selected = null; mapState.link = null; drawMap(false); }
  });

  /* The bar: kinds of link, the packages layer, what is checked, clusters. */
  const mapKinds = document.getElementById('m-kinds');
  const drawKindChips = () => {
    const present = new Set(mapModel.links.map((link) => MAP_LINK_KINDS[link.k]));
    mapKinds.innerHTML = MAP_LINK_KINDS.filter((kind) => present.has(kind) && kind !== 'package').map((kind) =>
      `<button class="chip m-chip m-k-${kind}" data-kind="${kind}" aria-pressed="${!mapState.hidden.has(kind)}" ` +
      `title="Show or hide ${esc(KIND_SAYS[kind])}">${esc(kind)}</button>`).join('');
  };
  mapKinds.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-kind]');
    if (!chip) return;
    const kind = chip.dataset.kind;
    if (mapState.hidden.has(kind)) mapState.hidden.delete(kind); else mapState.hidden.add(kind);
    drawKindChips();
    drawMap(false);
  });
  const packagesBox = document.getElementById('m-packages');
  const devBox = document.getElementById('m-dev');
  const markSel = document.getElementById('m-mark');
  const layoutSel = document.getElementById('m-layout');
  layoutSel.addEventListener('change', () => { mapState.layout = layoutSel.value === 'role' ? 'role' : 'calls'; drawMap(true); });
  packagesBox.addEventListener('change', () => { mapState.packages = packagesBox.checked; drawMap(true); });
  devBox.addEventListener('change', () => { mapState.dev = devBox.checked; drawMap(true); });
  markSel.addEventListener('change', () => { mapState.mark = markSel.value || null; drawMap(false); });
  const setAll = (open) => {
    mapState.toggled.clear();
    for (const id of mapModel.clusters.keys()) if (openByDefault(mapModel, id) !== open) mapState.toggled.add(id);
    drawMap(true);
  };
  document.getElementById('m-open-all').addEventListener('click', () => setAll(true));
  document.getElementById('m-close-all').addEventListener('click', () => setAll(false));
  document.getElementById('m-whole').addEventListener('click', () => { mapState.focus = null; drawMap(true); });
  document.getElementById('m-zoom-in').addEventListener('click', () => mapCamera.zoom(1.25));
  document.getElementById('m-zoom-out').addEventListener('click', () => mapCamera.zoom(0.8));
  document.getElementById('m-fit').addEventListener('click', () => mapCamera.fit(mapDrawn.laid));

  /* Pan and zoom: a drag, a wheel, two fingers - the Graph tab's gestures. */
  let mapFull = false;
  const mapFingers = new Map();
  let mapAnchor = null;
  const mapLocal = (event) => {
    const box = mapWrap.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  mapWrap.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.g-zoom, .g-notice')) return;
    if (event.pointerType !== 'touch') mapFingers.clear();
    mapFingers.set(event.pointerId, mapLocal(event));
    if (mapFingers.size === 1) { mapAnchor = mapLocal(event); mapDragged = false; }
    else { mapDragged = true; mapWrap.classList.add('is-panning'); }
  });
  mapWrap.addEventListener('pointermove', (event) => {
    if (!mapFingers.has(event.pointerId)) return;
    const here = mapLocal(event);
    if (mapFingers.size >= 2) {
      const before = [...mapFingers.values()].slice(0, 2);
      mapFingers.set(event.pointerId, here);
      const move = pinch(before, [...mapFingers.values()].slice(0, 2));
      mapCamera.pan(move.dx, move.dy);
      mapCamera.zoomAt(move.at.x, move.at.y, move.factor);
      return;
    }
    mapFingers.set(event.pointerId, here);
    const dx = here.x - mapAnchor.x, dy = here.y - mapAnchor.y;
    if (!mapDragged && Math.hypot(dx, dy) < 4) return;
    if (!mapDragged) { mapDragged = true; mapWrap.setPointerCapture(event.pointerId); mapWrap.classList.add('is-panning'); }
    mapCamera.pan(dx, dy);
    mapAnchor = here;
  });
  const mapLift = (event) => {
    mapFingers.delete(event.pointerId);
    if (mapFingers.size === 1) mapAnchor = [...mapFingers.values()][0];
    if (mapFingers.size === 0) mapWrap.classList.remove('is-panning');
  };
  mapWrap.addEventListener('pointerup', mapLift);
  mapWrap.addEventListener('pointercancel', mapLift);
  /* A plain wheel scrolls the page past the map (P102); Ctrl or ⌘ - and a
     trackpad pinch, which says the same - zooms; in full screen the wheel
     moves the map. */
  mapWrap.addEventListener('wheel', (event) => {
    const intent = wheelIntent(event, mapFull);
    if (intent === 'page') { wheelHint(mapWrap); return; }
    event.preventDefault();
    if (intent === 'zoom') {
      const box = mapWrap.getBoundingClientRect();
      mapCamera.zoomAt(event.clientX - box.left, event.clientY - box.top, Math.exp(-event.deltaY * 0.004));
    } else mapCamera.pan(-event.deltaX, -event.deltaY);
  }, { passive: false });

  /* Full screen, the page's own, as on the Graph tab. */
  const mapFullBtn = document.getElementById('m-full');
  const setMapFull = (next) => {
    if (next === mapFull) return;
    mapFull = next;
    root.classList.toggle('is-full', mapFull);
    mapFullBtn.setAttribute('aria-pressed', String(mapFull));
    mapFullBtn.querySelector('span').textContent = mapFull ? 'Leave full screen' : 'Full screen';
    mapFullBtn.querySelector('kbd').textContent = mapFull ? 'Esc' : 'F';
    if (!mapDrawn) return;
    // Full screen always draws: on a phone it is the way to the drawing too.
    placeAsList(mapDrawn.view);
    requestAnimationFrame(() => mapCamera.fit(mapDrawn.laid));
  };
  mapFullBtn.addEventListener('click', () => setMapFull(!mapFull));
  document.addEventListener('keydown', (event) => {
    if (store.get('view') !== 'map' || event.defaultPrevented) return;
    if (pressed('map.full', event) && !typing(event.target)) {
      event.preventDefault();
      setMapFull(!mapFull);
    } else if (pressed('map.close', event)) {
      if (!mapNotice.hidden) mapSay.clear();
      else if (mapState.link !== null || mapState.selected !== null) { mapState.link = null; mapState.selected = null; drawMap(false); }
      else if (mapState.focus !== null) { mapState.focus = null; drawMap(true); }
      else if (mapFull) setMapFull(false);
      else return;
      event.preventDefault();
    }
  });

  /* Copy link and pictures. */
  const mapCopyBtn = document.getElementById('m-copy');
  mapCopyBtn.addEventListener('click', async () => {
    const link = location.href.split('#')[0] + mapHashNow();
    if (await copyText(link)) flash(mapCopyBtn, 'Copied');
    else window.prompt('Copy this link', link);
  });
  const mapPicture = () => {
    const box = mapWorld.getBBox();
    const width = Math.ceil(box.width + PICTURE_PAD * 2);
    const height = Math.ceil(box.height + PICTURE_PAD * 2);
    const copy = mapSvg.cloneNode(true);
    const from = [...mapSvg.querySelectorAll('*')];
    const to = [...copy.querySelectorAll('*')];
    const dropped = [];
    from.forEach((el, n) => {
      const out = to[n];
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || el.classList.contains('m-hit')) { dropped.push(out); return; }
      out.setAttribute('style', PICTURE_STYLES.map((name) => `${name}:${style.getPropertyValue(name)}`).join(';'));
      for (const attr of [...out.attributes]) {
        if (/^(class|tabindex|role|aria-|data-)/.test(attr.name)) out.removeAttribute(attr.name);
      }
    });
    for (const el of dropped) el.remove();
    for (const attr of [...copy.attributes]) copy.removeAttribute(attr.name);
    copy.setAttribute('xmlns', SVG_NS);
    copy.setAttribute('width', String(width));
    copy.setAttribute('height', String(height));
    copy.setAttribute('viewBox', `0 0 ${width} ${height}`);
    copy.querySelector('#m-world').setAttribute('transform', `translate(${PICTURE_PAD - box.x} ${PICTURE_PAD - box.y})`);
    copy.prepend(svgEl('title', {}, `${document.title}: map`),
      svgEl('rect', { width, height, fill: getComputedStyle(mapWrap).backgroundColor }));
    return { text: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(copy), width, height };
  };
  const mapSvgOut = document.getElementById('m-svg-out');
  const mapPngOut = document.getElementById('m-png-out');
  mapSvgOut.addEventListener('click', () => {
    save(new Blob([mapPicture().text], { type: 'image/svg+xml' }), pictureName(document.title, 'map', 'svg'));
    flash(mapSvgOut, 'Saved');
  });
  mapPngOut.addEventListener('click', async () => {
    try {
      const shot = mapPicture();
      const scale = pictureScale(shot.width, shot.height, Math.max(2, window.devicePixelRatio || 1));
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(shot.text);
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(shot.width * scale);
      canvas.height = Math.round(shot.height * scale);
      const context = canvas.getContext('2d');
      context.scale(scale, scale);
      context.drawImage(image, 0, 0, shot.width, shot.height);
      const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'));
      if (blob === null) throw new Error('the browser would not encode the picture');
      save(blob, pictureName(document.title, 'map', 'png'));
      flash(mapPngOut, 'Saved');
    } catch (error) {
      mapPngOut.title = 'Could not save the picture: ' + (error && error.message ? error.message : error);
      flash(mapPngOut, 'Failed', false);
    }
  });

  /* A link's view, by name: what it names and this page does not hold is said.
     `reveal` opens a service's box, as the search does for a way in on the
     map (P101), and hands back the box drawn, or null when it is not. */
  const mapController = {
    reveal(repo) {
      const id = 'service:' + repo;
      if (!mapModel.byId.has(id)) return null;
      selectUnit(id);
      return mapWorld.querySelector(`[data-unit="${CSS.escape(mapState.selected || id)}"]`);
    },
    show() { titleEl.textContent = 'The whole project'; drawKindChips(); packagesBox.checked = mapState.packages; devBox.checked = mapState.dev;
      markSel.value = mapState.mark || ''; layoutSel.value = mapState.layout; drawMap(mapFit); },
    apply(asked) {
      mapSay.clear();
      mapState.toggled = new Set(asked.toggled.filter((id) => mapModel.clusters.has(id)));
      mapState.hidden = new Set(asked.hidden);
      mapState.packages = asked.packages;
      mapState.dev = asked.dev;
      mapState.mark = asked.mark;
      mapState.layout = asked.layout;
      mapState.link = asked.link;
      const known = (id) => id !== null && (mapModel.byId.has(id) || mapModel.clusters.has(id));
      const missing = [asked.selected, asked.focus].filter((id) => id !== null && !known(id));
      mapState.selected = known(asked.selected) ? asked.selected : null;
      mapState.focus = known(asked.focus) ? asked.focus : null;
      // A box inside a cluster the link leaves closed opens that cluster, so
      // what the link names is drawn as itself.
      for (const id of [mapState.selected, mapState.focus]) {
        const i = id === null ? undefined : mapModel.byId.get(id);
        if (i === undefined) continue;
        const box = mapModel.boxes[i];
        if (box.g !== '' && !isOpen(mapModel, clusterId(box), mapState.toggled)) mapState.toggled.add(clusterId(box));
      }
      mapFit = true;
      if (missing.length > 0) {
        mapSay.say('This link names ' + missing.map((id) => `<code>${esc(id)}</code>`).join(' and ') +
          ', which this page does not hold: it was removed or renamed after the link was made.');
      }
    },
  };

  return { mapController, mapListHtml, setMapFull };
}
