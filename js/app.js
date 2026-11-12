/* Somatic Odyssey research proforma: interview engine. */
(function () {
  'use strict';

  const SO = window.SO;
  const { ENDPOINT, SECTIONS, QUESTIONS, SCALES, RECORD_FIELDS, num, fmt, has } = SO;
  const SCALE_IDS = ['phq15', 'phq9', 'gad7'];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const wide = window.matchMedia('(min-width: 640px)');

  /* ---------- DOM helpers ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'value') el.value = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, kids);
    return el;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, v);
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    for (const c of kids.flat(Infinity)) {
      if (c === null || c === undefined || c === false || c === '') continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }

  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const newId = () => (window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : `so-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const niceDate = SO.niceDate;

  /* ---------- state ---------- */
  const state = {
    view: 'intro', qid: null, answers: { evalDate: today() }, errors: {},
    fromReview: false, dir: 0, flash: null, advTimer: null,
    submissionId: null, payload: null, result: null, sending: false, errorMsg: '',
  };

  const qById = (id) => QUESTIONS.find((q) => q.id === id);
  const visible = () => QUESTIONS.filter((q) => !q.when || q.when(state.answers));
  const current = () => qById(state.qid);
  const sectionOf = (q) => SECTIONS.find((x) => x.id === q.section);

  function optionsFor(q) {
    if (q.type !== 'scale') return q.options.map((o, i) => ({ ...o, key: String(i + 1) }));
    const opts = SCALES[q.scale].options.map((o) => ({ ...o, key: String(o.value) }));
    if (q.allowNA) opts.push({ value: 'NA', label: 'Not applicable', key: 'n' });
    return opts;
  }
  const selectedOption = (q) => optionsFor(q).find((o) => o.value === state.answers[q.id]);
  const sumOf = (q) => q.fields.reduce((t, f) => t + num(state.answers[f.key]), 0);

  function scoreOf(id) {
    const sc = SCALES[id];
    let total = 0;
    let missing = 0;
    visible().filter((q) => q.scale === id).forEach((q) => {
      const v = state.answers[q.id];
      if (typeof v === 'number') total += v;
      else if (v !== 'NA') missing += 1;
    });
    const band = sc.bands.find((b) => total >= b.min && total <= b.max) || sc.bands[sc.bands.length - 1];
    return { total, missing, band };
  }
  const riskPositive = () => typeof state.answers.phq9_i === 'number' && state.answers.phq9_i > 0;

  /* ---------- validation ---------- */
  function checkField(f, out) {
    const a = state.answers;
    const str = has(a[f.key]) ? String(a[f.key]).trim() : '';
    if (!str) {
      if (f.zero) { a[f.key] = '0'; return; }
      if (f.required) out[f.key] = f.input === 'chips' ? `Choose ${f.label.toLowerCase()}.` : `${f.label} is required.`;
      return;
    }
    if (f.input === 'number') {
      const n = Number(str.replace(/,/g, ''));
      if (!Number.isFinite(n)) out[f.key] = 'Enter a number, using digits only.';
      else if (f.integer && !Number.isInteger(n)) out[f.key] = 'Enter a whole number.';
      else if (f.min !== undefined && n < f.min) out[f.key] = `Enter ${f.min} or more.`;
      else if (f.max !== undefined && n > f.max) out[f.key] = `Enter ${f.max} or less.`;
      else a[f.key] = String(n);
    } else if (f.input === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      out[f.key] = 'Enter a full date.';
    } else {
      a[f.key] = str;
    }
  }

  function validate(q) {
    const out = {};
    const a = state.answers;
    if (q.type === 'fields') q.fields.forEach((f) => checkField(f, out));
    else if (q.type === 'choice' || q.type === 'scale') {
      const o = selectedOption(q);
      if (!o) out[q.id] = 'Choose an answer.';
      else if (o.followUp) checkField(o.followUp, out);
    } else if (q.type === 'multi') {
      const picked = a[q.id] || [];
      if (q.required && !picked.length) out[q.id] = 'Choose at least one.';
      q.options.forEach((o) => { if (o.followUp && picked.includes(o.value)) checkField(o.followUp, out); });
    }
    return out;
  }

  function firstInvalid() {
    const rec = {};
    RECORD_FIELDS.forEach((f) => checkField(f, rec));
    if (Object.keys(rec).length) return { record: true, errors: rec };
    for (const q of visible()) {
      const e = validate(q);
      if (Object.keys(e).length) return { q, errors: e };
    }
    return null;
  }

  function applyDefaults(fields) {
    fields.forEach((f) => {
      if (!has(state.answers[f.key]) && f.default !== undefined) {
        state.answers[f.key] = f.default === 'today' ? today() : f.default;
      }
    });
  }

  /* ---------- navigation ---------- */
  function enter(id, dir, flash) {
    clearTimeout(state.advTimer);
    state.qid = id;
    state.view = 'question';
    state.dir = dir;
    state.flash = flash || null;
    const q = current();
    if (q.type === 'fields') applyDefaults(q.fields);
    if (q.onEnter) q.onEnter(state.answers);
    render({ nav: true });
  }

  function go(view) {
    clearTimeout(state.advTimer);
    state.view = view;
    state.flash = null;
    render({ nav: true });
  }

  function begin(e) {
    if (e) e.preventDefault();
    const out = {};
    RECORD_FIELDS.forEach((f) => checkField(f, out));
    state.errors = out;
    if (Object.keys(out).length) { render({ focusError: true }); return; }
    if (!state.submissionId) state.submissionId = newId();
    if (state.fromReview) { state.fromReview = false; go('review'); return; }
    enter(visible()[0].id, 1);
  }

  function next() {
    clearTimeout(state.advTimer);
    const q = current();
    const errs = validate(q);
    state.errors = errs;
    if (Object.keys(errs).length) { render({ focusError: true }); return; }
    if (state.fromReview) { state.fromReview = false; go('review'); return; }
    const vis = visible();
    const i = vis.indexOf(q);
    if (i === vis.length - 1) go('review');
    else enter(vis[i + 1].id, 1);
  }

  function back() {
    clearTimeout(state.advTimer);
    state.errors = {};
    if (state.fromReview) { state.fromReview = false; go('review'); return; }
    const vis = visible();
    const i = vis.indexOf(current());
    if (i <= 0) go('intro');
    else enter(vis[i - 1].id, -1);
  }

  function edit(id) {
    state.errors = {};
    state.fromReview = true;
    enter(id, 1);
  }

  function editRecord() {
    state.errors = {};
    state.fromReview = true;
    go('intro');
  }

  function choose(q, opt, index) {
    clearTimeout(state.advTimer);
    state.answers[q.id] = opt.value;
    delete state.errors[q.id];
    render({ keep: opt.followUp ? `#f_${opt.followUp.key}, [data-chip="${opt.followUp.key}"]` : `[data-opt="${index}"]` });
    const stay = opt.followUp || (q.risk && typeof opt.value === 'number' && opt.value > 0);
    if (!stay) {
      state.advTimer = setTimeout(() => {
        if (state.view === 'question' && state.qid === q.id) next();
      }, reduceMotion.matches ? 150 : 320);
    }
  }

  function toggle(q, opt, index) {
    const picked = state.answers[q.id] || [];
    state.answers[q.id] = picked.includes(opt.value) ? picked.filter((v) => v !== opt.value) : [...picked, opt.value];
    delete state.errors[q.id];
    const opened = opt.followUp && state.answers[q.id].includes(opt.value);
    render({ keep: opened ? `#f_${opt.followUp.key}` : `[data-opt="${index}"]` });
  }

  /* ---------- rendering ---------- */
  function render(opts = {}) {
    renderMasthead();
    renderRoute();
    const views = { intro: viewIntro, question: viewQuestion, review: viewReview, sending: viewSending, done: viewDone, error: viewError };
    document.getElementById('stage').replaceChildren(views[state.view]());
    state.dir = 0;
    if (opts.nav) { window.scrollTo(0, 0); focusView(); }
    else if (opts.focusError) focusError();
    else if (opts.keep) {
      const el = document.querySelector(`#stage ${opts.keep.split(', ').join(', #stage ')}`);
      if (el) el.focus({ preventScroll: true });
    }
  }

  function focusError() {
    const el = document.querySelector('#stage [aria-invalid="true"], #stage .has-error .chip, #stage .answer.has-error .option');
    if (el) { el.focus(); return true; }
    return false;
  }

  function focusView() {
    if (Object.keys(state.errors).length && focusError()) return;
    if (state.view === 'question' && current().type === 'fields') {
      const input = document.querySelector('#stage .answer input, #stage .answer textarea');
      if (input) { input.focus({ preventScroll: true }); return; }
    }
    if (state.view === 'intro' && !has(state.answers.studyId)) {
      const id = document.getElementById('f_studyId');
      if (id) { id.focus({ preventScroll: true }); return; }
    }
    const title = document.querySelector('#stage h1');
    if (title) title.focus({ preventScroll: true });
  }

  function renderMasthead() {
    const chip = document.getElementById('studyChip');
    const id = state.answers.studyId;
    if (state.view !== 'intro' && has(id)) {
      chip.hidden = false;
      chip.replaceChildren('Study ID ', h('strong', null, id));
    } else {
      chip.hidden = true;
    }
  }

  function renderRoute() {
    const nav = document.getElementById('route');
    if (state.view === 'intro') { nav.hidden = true; return; }
    nav.hidden = false;
    const vis = visible();
    const at = state.view === 'question' ? vis.indexOf(current()) : vis.length;
    const list = h('ol', { class: 'route-list' });
    SECTIONS.forEach((sec) => {
      const qs = vis.filter((q) => q.section === sec.id);
      const start = vis.indexOf(qs[0]);
      const done = Math.max(0, Math.min(qs.length, at - start));
      const here = state.view === 'question' && vis[at] && vis[at].section === sec.id;
      list.append(h('li', {
        class: `route-seg${here ? ' is-current' : ''}${done === qs.length ? ' is-done' : ''}`,
        style: `flex-grow:${qs.length}`,
        'aria-current': here ? 'step' : null,
      },
      h('span', { class: 'route-label' }, h('span', { class: 'route-letter', 'aria-hidden': 'true' }, sec.letter), h('span', { class: 'route-name' }, sec.name)),
      h('span', { class: 'route-track', 'aria-hidden': 'true' }, h('span', { class: 'route-fill', style: `width:${(done / qs.length) * 100}%` })),
      h('span', { class: 'sr-only' }, `Section ${sec.letter}, ${done} of ${qs.length} answered`)));
    });
    nav.replaceChildren(list);
  }

  function renderField(f) {
    const a = state.answers;
    const id = `f_${f.key}`;
    const err = state.errors[f.key];
    const wrap = h('div', { class: `field size-${f.size || 'm'}${err ? ' has-error' : ''}` });

    if (f.input === 'chips') {
      wrap.append(h('span', { class: 'field-label', id: `${id}_l` }, f.label));
      const row = h('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': `${id}_l`, 'aria-describedby': err ? `${id}_e` : null });
      f.options.forEach((o, i) => {
        const on = a[f.key] === o;
        row.append(h('button', {
          type: 'button', class: `chip${on ? ' is-selected' : ''}`, role: 'radio', 'aria-checked': on ? 'true' : 'false',
          'data-chip': i === 0 ? f.key : null,
          onclick: () => {
            a[f.key] = o;
            delete state.errors[f.key];
            render({ keep: `[data-chipval="${f.key}-${i}"]` });
          },
          'data-chipval': `${f.key}-${i}`,
        }, o));
      });
      wrap.append(row);
    } else {
      wrap.append(h('label', { class: 'field-label', for: id }, f.label, !f.required && !f.zero ? h('span', { class: 'field-opt' }, ' (optional)') : null));
      const common = {
        id, name: f.key, autocomplete: 'off',
        'aria-invalid': err ? 'true' : null,
        'aria-describedby': err ? `${id}_e` : null,
      };
      const input = f.input === 'textarea'
        ? h('textarea', { ...common, rows: '3' })
        : h('input', {
          ...common,
          type: f.input === 'number' ? 'text' : f.input,
          inputmode: f.input === 'number' ? (f.integer ? 'numeric' : 'decimal') : null,
          placeholder: f.placeholder || null,
        });
      input.value = has(a[f.key]) ? a[f.key] : '';
      input.addEventListener('input', () => {
        a[f.key] = input.value;
        if (state.errors[f.key]) {
          delete state.errors[f.key];
          wrap.classList.remove('has-error');
          input.removeAttribute('aria-invalid');
          const e = wrap.querySelector('.field-error');
          if (e) e.remove();
        }
        const out = document.getElementById('sumValue');
        if (out && current()) out.textContent = fmt(sumOf(current()));
      });
      wrap.append(input);
    }
    if (err) wrap.append(h('p', { class: 'field-error', id: `${id}_e` }, err));
    return wrap;
  }

  function optionList(q) {
    const a = state.answers;
    const multi = q.type === 'multi';
    const opts = optionsFor(q);
    const err = state.errors[q.id];
    const wrap = h('div', { class: `answer${err ? ' has-error' : ''}` });
    const group = h('div', {
      class: `options${q.type === 'scale' ? ' options-scale' : ''}`,
      role: multi ? 'group' : 'radiogroup',
      'aria-labelledby': 'qprompt',
      'aria-describedby': err ? `err_${q.id}` : null,
      style: `--cols:${opts.length}`,
    });
    opts.forEach((o, i) => {
      const on = multi ? (a[q.id] || []).includes(o.value) : a[q.id] === o.value;
      group.append(h('button', {
        type: 'button', class: `option${on ? ' is-selected' : ''}`,
        role: multi ? 'checkbox' : 'radio', 'aria-checked': on ? 'true' : 'false',
        'data-opt': String(i), 'data-key': o.key,
        onclick: () => (multi ? toggle(q, o, i) : choose(q, o, i)),
      },
      h('span', { class: 'option-key', 'aria-hidden': 'true' }, o.key.toUpperCase()),
      h('span', { class: 'option-label' }, o.label)));
      if (on && o.followUp) group.append(h('div', { class: 'followup' }, renderField(o.followUp)));
    });
    wrap.append(group);
    if (err) wrap.append(h('p', { class: 'field-error', id: `err_${q.id}` }, err));
    const keys = opts.map((o) => o.key.toUpperCase());
    const numeric = keys.filter((k) => /\d/.test(k));
    const extra = keys.filter((k) => !/\d/.test(k));
    wrap.append(h('p', { class: 'kbd-hint' },
      `Press ${numeric[0]}–${numeric[numeric.length - 1]}${extra.length ? ` or ${extra.join(', ')}` : ''} to ${multi ? 'tick an option' : 'answer'}, and Enter to continue.`));
    return wrap;
  }

  function fieldsBody(q) {
    const wrap = h('div', { class: `answer fields${q.fields.length === 1 ? ' fields-single' : ''}` });
    q.fields.forEach((f) => wrap.append(renderField(f)));
    if (q.sum) {
      wrap.append(h('div', { class: 'sum' },
        h('span', { class: 'sum-label' }, q.sum.label),
        h('output', { class: 'sum-value', id: 'sumValue', 'aria-live': 'polite' }, fmt(sumOf(q)))));
    }
    return wrap;
  }

  function riskAlert() {
    return h('div', { class: 'alert', role: 'alert' },
      h('strong', null, 'PHQ-9 item 9 is positive.'),
      ' The patient reported thoughts of being better off dead or of self-harm. Complete a suicide risk assessment before the patient leaves the clinic, following your unit’s protocol.');
  }

  function viewQuestion() {
    const q = current();
    const sec = sectionOf(q);
    const vis = visible();
    const idx = vis.indexOf(q);
    const firstInSection = vis.find((x) => x.section === q.section) === q;
    const sc = q.type === 'scale' ? SCALES[q.scale] : null;
    const last = idx === vis.length - 1;

    const card = h('article', {
      class: `qcard${state.dir > 0 ? ' enter-fwd' : state.dir < 0 ? ' enter-back' : ''}`,
      'aria-labelledby': 'qprompt',
    });
    card.append(h('p', { class: 'qctx' },
      h('span', { class: 'qref' }, q.ref),
      h('span', null, sc ? `${sc.title}, item ${q.n} of ${sc.items.length}` : `Section ${sec.letter}: ${sec.title}`)));
    if (state.flash) card.append(h('p', { class: 'notice', role: 'status' }, state.flash));
    if (sc) card.append(h('p', { class: 'qstem' }, sc.stem));
    card.append(h('h1', { class: 'qprompt', id: 'qprompt', tabindex: '-1' }, q.prompt));
    if (q.note) card.append(h('p', { class: 'qnote' }, q.note));
    if (firstInSection && sec.hint) card.append(h('p', { class: 'qhint' }, sec.hint));
    card.append(q.type === 'fields' ? fieldsBody(q) : optionList(q));
    if (q.risk && riskPositive()) card.append(riskAlert());
    if (q.aside === 'scores') {
      card.append(h('section', { class: 'aside', 'aria-labelledby': 'asideTitle' },
        h('h2', { class: 'aside-title', id: 'asideTitle' }, 'Scores from section C'),
        scoreBlock(true),
        riskPositive() ? riskAlert() : null));
    }
    card.append(h('div', { class: `qnav${state.fromReview ? ' is-editing' : ''}` },
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: back }, state.fromReview ? 'Back to review' : 'Back'),
      h('span', { class: 'qcount' }, `${idx + 1} of ${vis.length}`),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: next }, state.fromReview ? 'Save and review' : last ? 'Review answers' : 'Next')));
    return card;
  }

  function viewIntro() {
    const vis = visible();
    const wrap = h('section', { class: 'intro', 'aria-labelledby': 'vtitle' });
    wrap.append(
      h('h1', { class: 'intro-title', id: 'vtitle', tabindex: '-1' },
        'Healthcare odyssey and utilization patterns in patients with somatic complaints and underlying depression or anxiety'),
      h('p', { class: 'intro-lede' },
        'A structured interview for the psychiatry outpatient department. Questions appear one at a time, the PHQ-15, PHQ-9 and GAD-7 are scored as you go, and the finished record is sent to the study inbox.'),
      h('ol', { class: 'intro-route', 'aria-label': 'The care pathway this study traces' },
        ['First symptoms', 'Family doctor', 'Specialists', 'Tests and scans', 'Emergency', 'Psychiatry OPD']
          .map((t) => h('li', null, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'stop' }, t)))),
    );

    const form = h('form', { class: 'panel record', novalidate: true, onsubmit: begin, 'aria-labelledby': 'recTitle' },
      h('h2', { class: 'panel-title', id: 'recTitle' }, 'Record details'),
      state.flash ? h('p', { class: 'notice', role: 'status' }, state.flash) : null,
      h('div', { class: 'fields' }, RECORD_FIELDS.map(renderField)),
      h('div', { class: 'panel-actions' },
        h('button', { class: 'btn btn-primary', type: 'submit' }, state.fromReview ? 'Save and review' : 'Begin interview')));

    const plan = h('section', { class: 'plan', 'aria-labelledby': 'planTitle' },
      h('h2', { class: 'panel-title', id: 'planTitle' }, 'What the interview covers'),
      h('ol', { class: 'plan-list' }, SECTIONS.map((sec) => {
        const c = vis.filter((q) => q.section === sec.id).length;
        return h('li', null,
          h('span', { class: 'sec-letter', 'aria-hidden': 'true' }, sec.letter),
          h('span', { class: 'plan-text' },
            h('strong', null, sec.title),
            h('span', { class: 'plan-meta' }, sec.id === 'scales' ? `PHQ-15, PHQ-9 and GAD-7, ${c} items` : `${c} questions`)));
      })),
      h('p', { class: 'plan-note' }, 'Takes about 10 to 15 minutes. On a keyboard, number keys pick answers and Enter moves on.'));

    wrap.append(h('div', { class: 'intro-grid' }, form, plan));
    return wrap;
  }

  function answerText(q) {
    const a = state.answers;
    if (q.type === 'scale') {
      const v = a[q.id];
      if (v === undefined) return '';
      if (v === 'NA') return 'Not applicable';
      const o = SCALES[q.scale].options.find((x) => x.value === v);
      return `${v}, ${o.label.toLowerCase()}`;
    }
    if (q.type === 'choice') {
      const o = selectedOption(q);
      if (!o) return '';
      const extra = o.followUp && a[o.followUp.key];
      if (!extra) return o.label;
      return o.followUp.input === 'chips' ? `${o.label} (${extra.toLowerCase()})` : `${o.label}: ${extra}`;
    }
    if (q.type === 'multi') {
      const picked = a[q.id] || [];
      return q.options.filter((o) => picked.includes(o.value))
        .map((o) => (o.followUp && a[o.followUp.key] ? `${o.label} (${niceDate(a[o.followUp.key])})` : o.label))
        .join('; ');
    }
    if (q.format) return q.format(a, q.sum ? sumOf(q) : null);
    return q.fields.map((f) => a[f.key]).filter(has).join(' ');
  }

  function row(ref, label, value, onEdit) {
    return h('div', { class: 'rrow' },
      h('dt', null, ref ? h('span', { class: 'qref' }, ref) : null, h('span', { class: 'rlabel' }, label)),
      h('dd', { class: 'rvalue' }, has(value) ? value : h('span', { class: 'missing' }, 'Not answered')),
      h('dd', { class: 'redit' }, h('button', { type: 'button', class: 'link', onclick: onEdit, 'aria-label': `Edit ${label}` }, 'Edit')));
  }

  function viewReview() {
    const a = state.answers;
    const vis = visible();
    const wrap = h('section', { class: 'sheet review', 'aria-labelledby': 'vtitle' });
    wrap.append(
      h('h1', { class: 'view-title', id: 'vtitle', tabindex: '-1' }, 'Review the record'),
      h('p', { class: 'view-lede' }, `Check the answers for study ID ${a.studyId}, then send the record. Choose Edit next to any answer to change it.`));
    if (riskPositive()) wrap.append(riskAlert());
    wrap.append(h('h2', { class: 'block-title' }, 'Scores'), scoreBlock(false));

    wrap.append(h('h2', { class: 'block-title' }, 'Record details'),
      h('dl', { class: 'rlist' }, RECORD_FIELDS.map((f) => row(null, f.label, f.input === 'date' ? niceDate(a[f.key]) : a[f.key], editRecord))));

    SECTIONS.forEach((sec) => {
      const qs = vis.filter((q) => q.section === sec.id);
      wrap.append(h('h2', { class: 'block-title' }, h('span', { class: 'sec-letter', 'aria-hidden': 'true' }, sec.letter), sec.title));
      if (sec.id !== 'scales') {
        wrap.append(h('dl', { class: 'rlist' }, qs.map((q) => row(q.ref, q.short, answerText(q), () => edit(q.id)))));
        return;
      }
      SCALE_IDS.forEach((id) => {
        const sc = SCALES[id];
        const r = scoreOf(id);
        const items = qs.filter((q) => q.scale === id);
        wrap.append(h('details', { class: 'scale-group', open: r.missing ? true : null },
          h('summary', null,
            h('span', { class: 'sg-name' }, sc.name),
            h('span', { class: 'sg-score' }, `${r.total} of ${sc.max}, ${r.band.label.toLowerCase()}`),
            r.missing ? h('span', { class: 'sg-missing' }, `${r.missing} not answered`) : null),
          h('dl', { class: 'rlist' }, items.map((q) => row(q.ref, q.short, answerText(q), () => edit(q.id))))));
      });
    });

    wrap.append(h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => enter(vis[vis.length - 1].id, -1) }, 'Back to questions'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: send }, 'Send record')));
    return wrap;
  }

  function scoreBlock(compact) {
    const box = h('div', { class: `scores${compact ? ' scores-compact' : ''}` });
    SCALE_IDS.forEach((id) => {
      const sc = SCALES[id];
      const r = scoreOf(id);
      const meter = h('div', { class: 'meter', role: 'img', 'aria-label': `${sc.name} ${r.total} of ${sc.max}, ${r.band.label}` });
      sc.bands.forEach((b) => meter.append(h('span', {
        class: `meter-band tone-${b.tone}`, style: `flex-grow:${b.max - b.min + 1}`, title: `${b.label}: ${b.min} to ${b.max}`,
      })));
      meter.append(h('span', { class: 'meter-mark', style: `left:${((r.total + 0.5) / (sc.max + 1)) * 100}%` }));
      box.append(h('div', { class: 'score' },
        h('div', { class: 'score-head' },
          h('span', { class: 'score-name' }, sc.name),
          h('span', { class: 'score-num' }, h('strong', null, String(r.total)), h('span', { class: 'score-max' }, ` / ${sc.max}`)),
          h('span', { class: `score-band tone-${r.band.tone}` }, r.band.label)),
        meter,
        compact ? null : h('p', { class: 'score-sub' }, sc.title, r.missing ? `. ${r.missing} ${r.missing === 1 ? 'item' : 'items'} not answered` : '')));
    });
    return box;
  }

  /* ---------- results: the odyssey route ---------- */
  function odysseyRoute() {
    const a = state.answers;
    const specialists = num(a.drMed) + num(a.drNeuro) + num(a.drOther);
    const tests = num(a.txLabs) + num(a.txXray) + num(a.txCtMri) + num(a.txEeg);
    const dur = SO.durationText(a);
    const stops = [
      { kind: 'start', label: 'Symptoms began', sub: dur ? `${dur} ago` : '' },
      { label: 'Family doctors', count: num(a.drGP) },
      { label: 'Specialists', count: specialists },
      { label: 'Investigations', count: tests },
      { label: 'Emergency visits', count: num(a.erVisits) },
      { kind: 'end', label: 'Psychiatry', sub: has(a.delayMonths) ? `after ${fmt(a.delayMonths)} months` : 'today' },
    ];
    const horiz = wide.matches;
    const n = stops.length;
    const W = horiz ? 680 : 320;
    const H = horiz ? 208 : 56 + (n - 1) * 88 + 40;
    const pts = stops.map((st, i) => (horiz
      ? { x: 54 + i * ((W - 108) / (n - 1)), y: i % 2 ? 138 : 72 }
      : { x: i % 2 ? 76 : 48, y: 40 + i * 88 }));

    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < n; i += 1) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      if (horiz) {
        const mx = (p1.x - p0.x) / 2;
        d += ` C ${p0.x + mx} ${p0.y}, ${p1.x - mx} ${p1.y}, ${p1.x} ${p1.y}`;
      } else {
        const my = (p1.y - p0.y) / 2;
        d += ` C ${p0.x} ${p0.y + my}, ${p1.x} ${p1.y - my}, ${p1.x} ${p1.y}`;
      }
    }

    const desc = `Symptoms began${dur ? ` ${dur} ago` : ''}; ${stops[1].count} family doctors; ${specialists} specialists; ${tests} investigations; ${stops[4].count} emergency visits; psychiatric diagnosis ${stops[5].sub}.`;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: `route-svg${horiz ? '' : ' is-vertical'}`, role: 'img', 'aria-labelledby': 'routeTitle' },
      s('title', { id: 'routeTitle' }, desc),
      s('path', { d, class: 'route-path', pathLength: '1' }));

    stops.forEach((st, i) => {
      const p = pts[i];
      const g = s('g', { class: `route-stop${st.count === 0 ? ' is-zero' : ''}`, style: `--i:${i}` });
      let r = 9;
      if (st.kind) {
        g.append(s('circle', { cx: p.x, cy: p.y, r, class: st.kind === 'end' ? 'stop-end' : 'stop-start' }));
      } else {
        r = (horiz ? 15 : 14) + Math.min(st.count, 12) * (horiz ? 1.25 : 0.85);
        g.append(s('circle', { cx: p.x, cy: p.y, r: r.toFixed(1), class: 'stop-circle' }),
          s('text', { x: p.x, y: p.y, class: 'stop-count' }, String(st.count)));
      }
      if (horiz) {
        const up = i % 2 === 0;
        const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
        const x = i === 0 ? p.x - 12 : i === n - 1 ? p.x + 12 : p.x;
        if (up) {
          g.append(s('text', { x, y: p.y - r - (st.sub ? 26 : 12), class: 'stop-label', 'text-anchor': anchor }, st.label));
          if (st.sub) g.append(s('text', { x, y: p.y - r - 10, class: 'stop-sub', 'text-anchor': anchor }, st.sub));
        } else {
          g.append(s('text', { x, y: p.y + r + 20, class: 'stop-label', 'text-anchor': anchor }, st.label));
          if (st.sub) g.append(s('text', { x, y: p.y + r + 36, class: 'stop-sub', 'text-anchor': anchor }, st.sub));
        }
      } else {
        g.append(s('text', { x: 124, y: p.y + (st.sub ? -3 : 5), class: 'stop-label' }, st.label));
        if (st.sub) g.append(s('text', { x: 124, y: p.y + 15, class: 'stop-sub' }, st.sub));
      }
      svg.append(g);
    });
    return svg;
  }

  function facts() {
    const a = state.answers;
    const doctors = sumOf(qById('doctors'));
    const tests = sumOf(qById('tests'));
    const items = [
      ['Doctors consulted', fmt(doctors)],
      ['Investigations done', fmt(tests)],
      ['Emergency visits', fmt(a.erVisits)],
      ['Out-of-pocket cost', `${fmt(a.costAmount)} ${a.costCurrency || ''}`.trim()],
      ['Days missed or impaired, past 6 months', fmt(a.daysImpaired)],
      ['Diagnostic delay', `${fmt(a.delayMonths)} months`],
    ];
    return h('dl', { class: 'facts' }, items.map(([k, v]) => h('div', { class: 'fact' }, h('dt', null, k), h('dd', null, v))));
  }

  function viewSending() {
    return h('section', { class: 'sheet sending', 'aria-labelledby': 'vtitle', 'aria-busy': 'true' },
      h('h1', { class: 'view-title', id: 'vtitle', tabindex: '-1' }, 'Sending the record'),
      h('p', { class: 'view-lede' }, `Study ID ${state.answers.studyId} is being sent to the study inbox. Keep this page open.`),
      h('div', { class: 'sending-bar', 'aria-hidden': 'true' }));
  }

  function viewDone() {
    const a = state.answers;
    const r = state.result;
    const when = new Date(r.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const wrap = h('section', { class: 'sheet done', 'aria-labelledby': 'vtitle' });
    wrap.append(
      h('h1', { class: 'view-title', id: 'vtitle', tabindex: '-1' }, 'Record sent'),
      h('p', { class: 'view-lede' },
        `Study ID ${a.studyId} was sent to the study inbox on ${when}.`,
        r.ref ? ` Inbox reference ${r.ref}.` : ''));
    if (!r.confirmed) {
      wrap.append(h('p', { class: 'notice' },
        'The record was posted, but the inbox didn’t send a confirmation back to this page. Check the Formboost dashboard to confirm it arrived.'));
    }
    if (riskPositive()) wrap.append(riskAlert());
    wrap.append(
      h('h2', { class: 'block-title' }, 'This patient’s route to psychiatry'),
      h('figure', { class: 'route-figure' }, odysseyRoute()),
      facts(),
      h('h2', { class: 'block-title' }, 'Scores'),
      scoreBlock(false),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: download }, 'Download a copy'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: newPatient }, 'Start next patient')));
    return wrap;
  }

  function viewError() {
    return h('section', { class: 'sheet error', 'aria-labelledby': 'vtitle' },
      h('h1', { class: 'view-title', id: 'vtitle', tabindex: '-1' }, 'The record wasn’t sent'),
      h('p', { class: 'alert' }, state.errorMsg),
      h('p', { class: 'view-lede' }, 'All answers are still on this page. Send again when the connection is back, or download a copy so the data is safe.'),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => go('review') }, 'Back to review'),
        h('span', { class: 'actions-group' },
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: download }, 'Download a copy'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: send }, 'Send again'))));
  }

  /* ---------- submission ---------- */
  function buildPayload() {
    const a = state.answers;
    const shown = new Set(visible());
    const asNum = (v) => (has(v) ? num(v) : '');
    const p = {
      _subject: `Somatic Odyssey proforma: study ID ${a.studyId || 'not set'}`,
      'Submission ID': state.submissionId,
      'Submitted at': new Date().toISOString(),
      'Study ID': a.studyId || '',
      'Hospital CR No.': a.crNo || '',
      'Date of evaluation': a.evalDate || '',
      Interviewer: a.interviewer || '',
      'Clinical setting': 'Psychiatric outpatient department (OPD)',
    };
    QUESTIONS.forEach((q) => {
      if (q.type === 'scale') {
        const sc = SCALES[q.scale];
        const v = a[q.id];
        p[`${q.ref} ${sc.name}: ${q.short}`] = !shown.has(q) || v === 'NA' ? 'N/A' : (v === undefined ? '' : v);
        if (q.n === sc.items.length) {
          const r = scoreOf(q.scale);
          p[`${sc.name} total (0–${sc.max})`] = r.total;
          p[`${sc.name} severity`] = r.band.label;
          if (q.scale === 'phq9') {
            p['PHQ-9 item 9 risk flag'] = riskPositive() ? 'POSITIVE: suicide risk assessment required' : 'Negative';
          }
        }
      } else if (q.type === 'fields') {
        q.fields.forEach((f) => {
          const label = q.fields.length === 1 ? q.short : `${q.short}: ${f.label}`;
          p[`${q.ref} ${label}`] = f.input === 'number' ? asNum(a[f.key]) : (a[f.key] || '');
        });
        if (q.sum) p[`${q.ref} ${q.sum.label}`] = sumOf(q);
      } else if (q.type === 'choice') {
        const o = selectedOption(q);
        p[`${q.ref} ${q.short}`] = o ? o.value : '';
        q.options.forEach((opt) => {
          if (opt.followUp) p[`${q.ref} ${opt.followUp.label}`] = o && o.value === opt.value ? (a[opt.followUp.key] || '') : '';
        });
      } else if (q.type === 'multi') {
        const picked = a[q.id] || [];
        p[`${q.ref} ${q.short}`] = q.options.filter((o) => picked.includes(o.value)).map((o) => o.value).join('; ');
        q.options.forEach((opt) => {
          if (opt.followUp) p[`${q.ref} ${opt.followUp.label}`] = picked.includes(opt.value) ? (a[opt.followUp.key] || '') : '';
        });
      }
    });
    return p;
  }

  async function send() {
    if (state.sending) return;
    const bad = firstInvalid();
    if (bad) {
      state.errors = bad.errors;
      state.fromReview = true;
      if (bad.record) {
        state.view = 'intro';
        state.flash = 'Complete the record details before sending.';
        render({ focusError: true });
      } else {
        enter(bad.q.id, 1, 'Answer this question before sending the record.');
      }
      return;
    }

    state.sending = true;
    state.payload = buildPayload();
    state.view = 'sending';
    render({ nav: true });

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(state.payload),
      });
      let body = null;
      try { body = await res.json(); } catch (_) { /* empty or non-JSON body */ }
      if (!res.ok) {
        const why = body && (body.detail || body.title || body.message || body.error);
        const err = new Error(`The inbox turned the record down (HTTP ${res.status}${why ? `: ${why}` : ''}).`);
        err.http = true;
        throw err;
      }
      finish({ confirmed: true, ref: body && (body.requestId || body.id) });
    } catch (err) {
      if (err.http) { fail(err.message); return; }
      if (navigator.onLine === false) { fail('This device is offline. Reconnect to the internet, then send again.'); return; }
      /* The browser blocked the JSON request (usually a cross-origin rule, for example when
         the page is opened straight from disk). Fall back to a classic form post into a
         hidden frame so the patient record still reaches the inbox. */
      try {
        await postViaFrame(state.payload);
        finish({ confirmed: false });
      } catch (_) {
        fail('The browser couldn’t reach the inbox. Check the internet connection, then send again.');
      }
    }
  }

  function postViaFrame(payload) {
    return new Promise((resolve, reject) => {
      const name = `so_sink_${Date.now()}`;
      const frame = h('iframe', { name, title: 'Submission channel', hidden: true, src: 'about:blank' });
      document.body.append(frame);
      setTimeout(() => {
        const form = h('form', { method: 'POST', action: ENDPOINT, target: name, hidden: true, 'accept-charset': 'UTF-8' });
        Object.entries(payload).forEach(([k, v]) => form.append(h('input', { type: 'hidden', name: k, value: v === null || v === undefined ? '' : String(v) })));
        document.body.append(form);
        const cleanup = () => { form.remove(); frame.remove(); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 15000);
        frame.addEventListener('load', () => { clearTimeout(timer); setTimeout(cleanup, 1500); resolve(); }, { once: true });
        try { form.submit(); } catch (e) { clearTimeout(timer); cleanup(); reject(e); }
      }, 80);
    });
  }

  function finish(r) {
    state.sending = false;
    state.result = { ...r, at: Date.now() };
    state.view = 'done';
    render({ nav: true });
  }

  function fail(msg) {
    state.sending = false;
    state.errorMsg = msg;
    state.view = 'error';
    render({ nav: true });
  }

  function download() {
    const p = state.payload || buildPayload();
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const slug = String(state.answers.studyId || 'record').replace(/[^\w-]+/g, '_');
    const link = h('a', { href: url, download: `somatic-odyssey_${slug}_${state.answers.evalDate || today()}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function newPatient() {
    const keep = state.answers.interviewer;
    Object.assign(state, {
      answers: { evalDate: today(), interviewer: keep }, errors: {}, qid: null,
      fromReview: false, flash: null, submissionId: null, payload: null, result: null, errorMsg: '',
    });
    go('intro');
  }

  /* ---------- global listeners ---------- */
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'question' || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    const tag = t && t.tagName;
    if (e.key === 'Enter') {
      if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return;
      e.preventDefault();
      next();
      return;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : '';
    if (!key) return;
    const btn = document.querySelector(`#stage .options .option[data-key="${CSS.escape(key)}"]`);
    if (btn) { e.preventDefault(); btn.click(); }
  });

  window.addEventListener('beforeunload', (e) => {
    const busy = ['question', 'review', 'sending', 'error'].includes(state.view);
    if (busy && Object.keys(state.answers).length > 2) { e.preventDefault(); e.returnValue = ''; }
  });

  wide.addEventListener('change', () => { if (state.view === 'done') render(); });

  render();
})();
