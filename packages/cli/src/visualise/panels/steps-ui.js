import { answersOf } from '../graph.js';
import { PROMPT_LIMITS, PROMPT_WALK, renderPrompt } from '../../../../core/src/prompt-text.js';
import { STEP_BOUNDS, STEP_KINDS, failSay, promptFor, stepsOf } from '../steps.js';
import { wordFor } from '../frame.js';

/* The Steps tab and the steps above the drawing: a way in as a waterfall, in
   call order, and the one Copy as prompt handler every tab's buttons use. */
export function createStepsUi(page) {
  const { FL, LB, LN, RP, copyText, data, entryHeadHtml, esc, files, flash, graphLink, hueOf, model,
    nodes, opener, plural, repoName, seen, store, titleEl, world } = page;

  /* ── steps: a way in as a waterfall, and Copy as prompt ──────────── */

  /* steps.js says what the steps are; this draws them. A row opens its
     place in the editor when the page has editor links, its node in the
     Graph tab, and lights that node in the drawing while hovered. */
  const stepsView = document.getElementById('steps-view');
  const stepsList = document.getElementById('s-list');
  const stepsDepth = document.getElementById('s-depth');
  const stepsNote = document.getElementById('s-note');
  const stepsHead = document.getElementById('s-head');
  /* An edge a stand-in typed (P78): how, and whose types; null for any other. */
  const standInOf = (k) => {
    const marked = data.standIns && data.standIns.edges[String(k)];
    return marked ? [data.standIns.via[marked[0]], data.standIns.packages[marked[1]]] : null;
  };
  /* A step read from code says nothing about how it was joined (P101): only
     an annotation and a guess are marked, so the one guess on a way in stands
     out. Each says its trust in words, the code in the tooltip. */
  const STEP_MARKS = [
    [(row) => row.kind !== 'answer' && row.edge >= 0 && row.certain && row.confidence !== 'static',
      (row) => ['is-marked', wordFor('trust', row.confidence), `joined ${row.confidence}: an annotation says so`]],
    [(row) => row.edge >= 0 && !row.certain && row.confidence !== 'runtime',
      (row) => ['is-guess', wordFor('trust', row.confidence), `joined ${row.confidence}: inferred, may be wrong`]],
    [(row) => row.failure && row.kind !== 'break', () => ['is-failure', 'on failure', 'Runs only when what comes before it fails']],
    [(row) => row.kind === 'break' && row.reason, (row) => ['is-failure', wordFor('reason', row.reason), `The check row that says why: ${row.reason}`]],
    [(row) => row.together, () => ['is-together', 'side by side', 'Runs beside its siblings, not after them']],
    [(row) => row.perItem !== '', (row) => ['is-loop', 'per item (' + row.perItem + ')', 'Runs once per item of a ' + row.perItem + ' loop']],
    [(row) => row.nPlusOne, () => ['is-n1', 'likely N+1', 'A query reached once per item of a loop: a list of n items costs n round trips']],
    [(row) => row.throws.length > 0, (row) => ['is-throws', 'throws ' + row.throws.map(failSay).join(' · '),
      row.throws.map((f) => failSay(f) + ' (' + f.src + (f.f ? ', ' + f.f + (f.l ? ':' + f.l : '') : '') + ')').join('; ')]],
    [(row) => row.edge >= 0 && standInOf(row.edge) !== null, (row) => {
      const [via, pkg] = standInOf(row.edge);
      return via === 'shape-file'
        ? ['is-standin', 'shape · ' + pkg, 'Typed by a shape file of the project\'s own, since ' + pkg + ' is not installed: it says what the project wrote, which may not be what runs']
        : ['is-standin', 'source · ' + pkg, 'Typed by the source of ' + pkg + ' in a repository read here, since it is not installed: the source may not be the version that runs']; }],
    [(row) => row.seen > 0, (row) => ['is-seen', 'seen ×' + row.seen.toLocaleString(), 'Seen this many times at run time']],
    [(row) => row.crosses, (row) => ['', 'into ' + repoName(row.node), 'Leaves one service for another']],
    [(row) => row.again, () => ['', 'listed above', 'Reached again; its steps are listed where it first appears']],
    [(row) => row.loop, () => ['', 'loops back', 'Already on this path']],
  ];
  /* What a step logs: the level and the template, folded until asked. */
  const logsHtml = (logs) => logs.length === 0 ? '' :
    `<details class="s-logs"><summary>logs · ${logs.length}</summary><ul>` +
    logs.map((log) => `<li><span class="lv is-${esc(log.level)}">${esc(log.level)}</span>` +
      `<span>${log.text ? esc(log.text) : '<i class="s-log-at">no template</i>'}</span>` +
      (log.line ? `<span class="s-log-at">:${log.line}</span>` : '') + '</li>').join('') +
    '</ul></details>';
  const stepRowHtml = (row, at) => {
    const v = row.node;
    const broken = row.kind === 'break';
    const label = row.kind === 'answer' ? 'answers ' + row.inline : broken ? 'chain breaks: ' + row.inline : nodes[v][LB];
    const inline = broken ? (row.message ? `<span class="s-inline">${esc(row.message)}</span>` : '')
      : row.kind !== 'answer' && row.inline && row.inline !== label ? `<span class="s-inline">${esc(row.inline)}</span>` : '';
    const marks = STEP_MARKS.filter(([when]) => when(row)).map(([, say]) => {
      const [tone, text, title] = say(row);
      return `<span class="s-mark ${tone}" title="${esc(title)}">${esc(text)}</span>`;
    }).join('');
    const where = files[nodes[v][FL]] ? files[nodes[v][FL]] + (nodes[v][LN] ? ':' + nodes[v][LN] : '') : repoName(v);
    const cls = ['s-row', row.failure ? 'is-failure' : '', broken ? 'is-break' : '', row.edge >= 0 && !row.certain ? 'is-guess' : '',
      row.together ? 'is-together' : ''].filter(Boolean).join(' ');
    return `<li class="${cls}" data-node="${v}" data-depth="${row.depth}" data-at="${at}" ` +
      `style="--depth:${row.depth};--hue:${hueOf(nodes[v][RP])}">` +
      `<span class="s-what"><span class="s-glyph" title="${esc(STEP_KINDS[row.kind].say)}">${esc(STEP_KINDS[row.kind].glyph)}</span>` +
      `<span class="s-label">${esc(label)}</span>${inline}</span>` +
      (marks ? `<span class="s-marks">${marks}</span>` : '') +
      (row.kind === 'answer' || broken ? '' : `<span class="s-where">${opener(nodes[v][RP], nodes[v][FL], nodes[v][LN], where)}${graphLink(v)}</span>`) +
      logsHtml(row.logs) +
      '</li>';
  };
  const stepsHtml = (entry, depth) => {
    const found = stepsOf(model, entry, { depth, answersOf, seen });
    return {
      found,
      html: found.rows.map(stepRowHtml).join('') +
        (found.more > 0 ? `<li class="cut s-cut">${plural(found.more, 'more step', 'more steps')} not listed: raise the depth, or open it in the graph.</li>` : ''),
    };
  };
  const stepsSaid = (found) => {
    const guesses = found.rows.filter((row) => row.edge >= 0 && !row.certain).length;
    const failing = found.rows.filter((row) => row.failure && row.kind !== 'break').length;
    const breaks = found.rows.filter((row) => row.kind === 'break').length;
    return [plural(found.rows.length - breaks, 'step', 'steps'), guesses ? plural(guesses, 'best guess', 'best guesses') : '',
      failing ? failing + ' on failure' : '', breaks ? plural(breaks, 'break', 'breaks') : '', seen.entry(found.rows[0].node) ? 'seen ×' + seen.entry(found.rows[0].node).toLocaleString() : '']
      .filter(Boolean).join(' · ');
  };
  function drawSteps() {
    if (store.get('current') === null) return;
    titleEl.textContent = nodes[store.get('current')][LB];
    const { found, html } = stepsHtml(store.get('current'), Number(stepsDepth.value));
    stepsList.innerHTML = html;
    stepsHead.innerHTML = entryHeadHtml(store.get('current'));
    stepsNote.textContent = stepsSaid(found) + ' · in call order, as the source reads; not timed.';
  }
  stepsDepth.addEventListener('change', drawSteps);

  /* Hovering a step lights its node wherever the drawing has it. */
  const lightNode = (v) => {
    for (const el of world.querySelectorAll('.g-node.is-hover')) el.classList.remove('is-hover');
    if (v === null) return;
    world.querySelector(`.g-node[data-node="${v}"]`)?.classList.add('is-hover');
  };
  const lightSteps = (list) => {
    list.addEventListener('pointerover', (event) => {
      const row = event.target.closest('.s-row');
      lightNode(row ? Number(row.dataset.node) : null);
    });
    list.addEventListener('pointerleave', () => lightNode(null));
    list.addEventListener('focusin', (event) => {
      const row = event.target.closest('.s-row');
      if (row) lightNode(Number(row.dataset.node));
    });
  };
  lightSteps(stepsList);

  /* On the Graph tab, a way in's steps open above the drawing, so a row
     lights the box it names. */
  const stepsInGraph = (() => {
    const el = document.getElementById('g-steps');
    let of = null;
    lightSteps(el);
    el.addEventListener('click', (event) => {
      if (event.target.closest('[data-steps-close]')) { of = null; el.hidden = true; lightNode(null); }
    });
    return {
      toggle(v) {
        if (of === v) { of = null; el.hidden = true; lightNode(null); return; }
        of = v;
        const { found, html } = stepsHtml(v, STEP_BOUNDS.depth);
        el.innerHTML = `<div class="g-head"><p><b>Steps of ${esc(nodes[v][LB])}</b> · ${esc(stepsSaid(found))}</p>` +
          `<span><button class="tool" data-prompt="entry:${v}">Copy as prompt</button> ` +
          '<button class="g-close" data-steps-close aria-label="Close steps" title="Close">&times;</button></span></div>' +
          `<div class="s-head">${entryHeadHtml(v)}</div>` +
          `<ol class="s-list">${html}</ol>`;
        el.hidden = false;
      },
    };
  })();

  /* Copy as prompt: one handler for every button that asks, on any tab, in
     the words describe_for_prompt answers with (P97). */
  const promptKit = { seen, walk: PROMPT_WALK, render: renderPrompt, limits: PROMPT_LIMITS };
  const promptOf = (asked) => {
    const [kind, at] = asked.split(':');
    return promptFor(model, { [kind]: Number(at) }, promptKit);
  };
  const copyPrompt = async (button, asked) => {
    const text = promptOf(asked);
    if (text === '') return;
    if (await copyText(text)) flash(button, 'Copied');
    else window.prompt('Copy this prompt', text);
  };
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]');
    if (!button) return;
    event.preventDefault();
    copyPrompt(button, button.dataset.prompt);
  });
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-accept-cmd]');
    if (!button) return;
    event.preventDefault();
    const command = button.dataset.acceptCmd;
    const copied = await copyText(command);
    flash(button, copied ? 'Copied' : 'Could not copy', copied);
    if (!button.nextElementSibling || !button.nextElementSibling.classList.contains('accept-cmd')) {
      button.insertAdjacentHTML('afterend', `<code class="accept-cmd">${esc(command)}</code>`);
    }
  });
  document.getElementById('s-copy').addEventListener('click', (event) => {
    if (store.get('current') !== null) copyPrompt(event.currentTarget, 'entry:' + store.get('current'));
  });

  return { drawSteps, stepsInGraph, stepsView };
}
