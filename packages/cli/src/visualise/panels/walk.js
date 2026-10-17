/* The Walk tab: a way in followed outward, a row per step, a rule across it
   wherever it leaves one service for another. Its title and sheet are the
   ones the other table tabs draw into. */
export function createWalk(page) {
  const { CROSSES, FL, GLYPH, LB, LN, MT, RP, confidences, edgeTypes, esc, files, graphLink, guards,
    hueOf, nodes, out, repoName, store, typeName } = page;

  /* ── the walk ────────────────────────────────────────────────────── */

  const walkEl = document.getElementById('walk');
  const titleEl = document.getElementById('walk-title');
  const depthSel = document.getElementById('depth');
  const capSel = document.getElementById('cap');


  function drawWalk() {
    if (store.get('current') === null) return;
    const depth = Number(depthSel.value);
    const cap = Number(capSel.value);
    walkEl.replaceChildren();
    titleEl.textContent = nodes[store.get('current')][LB];

    const frag = document.createDocumentFragment();
    let used = 0, over = 0;

    const emit = (i, level, edge, path) => {
      const row = document.createElement('div');
      row.className = 'step';
      row.style.setProperty('--hue', hueOf(nodes[i][RP]));
      row.style.setProperty('--level', String(level));
      row.dataset.level = String(level);
      const t = typeName(i);
      const meta = nodes[i][MT] || {};
      const label = meta.m ? `${meta.m} ${meta.p || ''}` : nodes[i][LB];
      const conf = edge ? confidences[edge[3]] : '';
      row.innerHTML =
        `<span class="what">` +
          `<span class="glyph">${GLYPH[t] || t.slice(0, 4)}</span>` +
          `<span class="label">${esc(label)}</span>` +
          graphLink(i) +
        `</span>` +
        `<span class="where">` +
          (edge ? `<span class="via is-${conf}">${edgeTypes[edge[2]]}${conf === 'static' ? '' : ' &middot; ' + conf}</span>  ` : '') +
          (files[nodes[i][FL]] ? esc(files[nodes[i][FL]].split('/').pop()) + (nodes[i][LN] ? ':' + nodes[i][LN] : '') : '') +
        `</span>`;
      frag.append(row);

      const guarded = guards[i];
      if (guarded.length > 0) {
        const g = document.createElement('div');
        g.className = 'crossing';
        g.style.setProperty('--hue', hueOf(nodes[i][RP]));
        g.style.marginLeft = (level * 15 + 28) + 'px';
        g.innerHTML = '<b>runs first</b>' + guarded
          .slice()
          .sort((a, b) => a[0] - b[0])
          .map((e) => esc(nodes[e[1]][LB].replace(/\(.*/, '')))
          .join(', ');
        frag.append(g);
      }
    };

    const queue = [{ i: store.get('current'), level: 0, path: new Set([store.get('current')]), edge: null }];
    emit(store.get('current'), 0, null);
    used = 1;

    while (queue.length > 0) {
      const item = queue.shift();
      if (item.level >= depth) continue;
      const edges = out[item.i].slice().sort((a, b) => a[1] - b[1]);
      for (const e of edges) {
        const to = e[1];
        if (item.path.has(to)) {
          if (used < cap) {
            used += 1;
            const row = document.createElement('div');
            row.className = 'step';
            row.style.setProperty('--hue', hueOf(nodes[to][RP]));
            row.style.setProperty('--level', String(item.level + 1));
            row.dataset.level = String(item.level + 1);
            row.innerHTML =
              `<span class="what"><span class="repeat">already on this path: ${esc(nodes[to][LB])}</span></span><span></span>`;
            frag.append(row);
          } else over += 1;
          continue;
        }
        if (used >= cap) { over += 1; continue; }

        if (CROSSES.has(edgeTypes[e[2]])) {
          const cross = document.createElement('div');
          cross.className = 'crossing';
          cross.style.setProperty('--hue', hueOf(nodes[to][RP]));
          cross.style.marginLeft = (item.level * 15 + 28) + 'px';
          cross.innerHTML = `<b>${esc(repoName(item.i))} &rarr; ${esc(repoName(to))}</b>` +
            `over ${edgeTypes[e[2]]}, ${confidences[e[3]]}`;
          frag.append(cross);
        }

        used += 1;
        emit(to, item.level + 1, e);
        queue.push({ i: to, level: item.level + 1, path: new Set([...item.path, to]) });
      }
    }

    if (over > 0) {
      const cut = document.createElement('div');
      cut.className = 'cut';
      cut.textContent = over + ' more nodes. Raise the cap, or narrow the depth.';
      frag.append(cut);
    }
    walkEl.append(frag);
  }

  return { capSel, depthSel, drawWalk, titleEl, walkEl };
}
