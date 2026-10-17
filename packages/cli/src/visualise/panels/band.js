/* The masthead and the band under it: what was read and joined, said as a
   standfirst, a build line and a tile per figure; the run-time tile when a
   trace was imported; and the service rail, which doubles as the filter every
   tab reads. */
export function createBand(page) {
  const { data, entryIx, hueOf, repos, seen, store } = page;
  const shown = store.get('shown');

  /* ── the reconciliation band ─────────────────────────────────────── */

  const r = data.report;
  const band = document.getElementById('band');
  const stat = (label, value, note, tone) => {
    const el = document.createElement('div');
    el.className = 'stat' + (tone ? ' is-' + tone : '');
    el.innerHTML = `<dt>${label}</dt><dd>${value}</dd><small>${note}</small>`;
    band.append(el);
  };

  stat('Graph', r.totals.nodes.toLocaleString() + ' nodes',
    r.totals.edges.toLocaleString() + ' edges, ' + r.types.total.toLocaleString() + ' types');
  stat('Service calls', r.httpOut.linked + ' / ' + r.httpOut.total + ' joined',
    r.httpOut.external + ' third party, ' + r.httpOut.dynamic + ' built at run time',
    r.httpOut.linked > 0 ? 'good' : null);
  if (r.ui) {
    stat('Browser calls', r.ui.resolved + ' / ' + r.ui.total + ' joined',
      r.ui.unresolved + ' still unmatched', r.ui.resolved > 0 ? 'warn' : null);
  }
  stat('Routes reached', r.routes.called + ' / ' + r.routes.total,
    (r.routes.total - r.routes.called) + ' nothing calls');
  stat('Channels', r.channels.linked + ' / ' + r.channels.total + ' joined',
    r.channels.noConsumers.length + ' with no handler',
    r.channels.linked === 0 ? 'warn' : 'good');
  /* The build line's three figures (P81). `missed` is absent from a report
     packed before 0.6.0, where `unresolved` meant the same thing. */
  const missedCount = r.totals.missed ?? r.totals.unresolved;
  stat('Missed', missedCount.toLocaleString(),
    'joined from files: ' + (r.totals.notes ?? 0).toLocaleString() +
    ' &middot; findings: ' + (r.totals.findings ?? 0).toLocaleString());

  const read = r.services.filter((s) => s.skipped === null).length;
  document.getElementById('standfirst').textContent =
    `${read} of ${r.services.length} repositories read and joined into one graph. Pick a way in ` +
    'on the left and follow it; a rule across the walk marks every point where it leaves one ' +
    'service for another.';

  document.getElementById('built').innerHTML =
    'built ' + new Date(data.builtAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC<br>' +
    r.services.map((s) => s.durationMs + 'ms ' + s.name).join(' &middot; ');

  /* ── service rail, doubling as the filter ────────────────────────── */

  const fleet = document.getElementById('fleet');
  repos.forEach((name, i) => {
    const summary = r.services.find((s) => s.name === name);
    const b = document.createElement('button');
    b.className = 'ship';
    b.dataset.repo = name;
    b.style.setProperty('--hue', hueOf(i));
    b.setAttribute('aria-pressed', 'true');
    b.innerHTML = `<b>${name}</b><em>${summary ? summary.type : ''}</em>` +
      `<span>${summary ? summary.nodes.toLocaleString() : '0'} nodes</span>`;
    b.addEventListener('click', () => {
      if (shown.has(name)) shown.delete(name); else shown.add(name);
      store.set('shown', shown);
      b.setAttribute('aria-pressed', String(shown.has(name)));
      page.drawEntries();
      if (store.get('view') === 'graph') page.graph.refresh();
    });
    fleet.append(b);
  });

  /* What a trace saw, as the band's last tile; when some of it was not found
     in code, or fits several places, the tile opens Not joined on that list. */
  if (seen.any) {
    const total = [...entryIx].reduce((sum, i) => sum + seen.entry(i), 0);
    stat('Seen at run time', total.toLocaleString() + ' hits',
      seen.unmatched.length.toLocaleString() + ' not found in code' +
        (seen.ambiguous.length ? ', ' + seen.ambiguous.length.toLocaleString() + ' could be several places' : ''),
      seen.unmatched.length ? 'warn' : 'good');
    if (seen.unmatched.length > 0 || seen.ambiguous.length > 0) {
      const card = band.lastElementChild;
      card.classList.add('is-link');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.title = 'Show what was seen at run time and not found in code, or could be several places';
      const open = () => { page.showView('missing'); document.getElementById('unmatched')?.scrollIntoView({ block: 'nearest' }); };
      card.addEventListener('click', open);
      card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    }
  }

  return { fleet };
}
