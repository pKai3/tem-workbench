/* Repeated-field review uses the shared catalogue, previews and API client. */
function repeatReviewPairs(pairs, ids, filter = 'pending', image = null) {
 const scope = new Set(ids);
 return pairs.filter(p => p.images.every(f => scope.has(f.id)) && (!image || p.images.some(f => f.id === image)) &&
  (filter === 'all' || (p.decision || 'pending') === filter));
}
function repeatReviewBadge(pairs, id) {
 const matches = pairs.filter(p => p.images.some(f => f.id === id) && p.decision !== 'different');
 const confirmed = matches.some(p => p.decision === 'same');
 return matches.length ? {confirmed, text: confirmed ? 'Same-region group' : `Review ${matches.length} possible repeat${matches.length === 1 ? '' : 's'}`} : null;
}
if (typeof module !== 'undefined' && module.exports) module.exports = {repeatReviewPairs, repeatReviewBadge};
if (typeof window !== 'undefined') (() => {
 const byId = id => document.getElementById(id);
 const dialog = byId('repeat-review');
 let data = {pairs:[], groups:[], job:{}}, scope = [], filter = 'pending', image = null, searchAll = false;
 let timer = null, serial = 0, listSignature = '', busy = false;
 const decisions = {pending:'Unreviewed', same:'Same region', different:'Different', uncertain:'Unsure'};
 function node(tag, text, className) {
  const n = document.createElement(tag); if (text !== undefined) n.textContent = text;
  if (className) n.className = className; return n;
 }
 function button(text, action, className) {
  const b = node('button', text, className); b.type = 'button'; b.onclick = action; return b;
 }
 function fail(error) {byId('repeat-error').textContent = error.message || String(error)}
 function accepted(response) {
  data = response; render();
  if (byId('image-browser').open) renderImageBrowser();
  clearTimeout(timer);
  if (data.job.state === 'running') timer = setTimeout(refresh, 1500);
 }
 async function refresh() {
  if (!config?.repeat_region_review) return;
  const request = ++serial;
  try {const response = await api('repeat-regions'); if (request === serial) accepted(response)}
  catch (e) {if (request === serial) {fail(e); if (data.job.state === 'running') timer = setTimeout(refresh, 4000)}}
 }
 function configure() {
  for (const id of ['repeat-regions-open','image-browser-duplicates']) {
   byId(id).disabled = !config?.repeat_region_review;
   byId(id).title = config?.repeat_region_review ? 'Find and review repeated or overlapping image fields' : 'Restart Workbench after the batch finishes to enable duplicate review';
  }
  refresh();
 }
 function open(files, selected = null) {
  scope = files.filter(f => f.content_sha256 && f.image_kind !== 'diffraction').map(f => f.id);
  image = selected; filter = selected ? 'all' : 'pending'; listSignature = ''; byId('repeat-error').textContent = '';
  render(); if (!dialog.open) dialog.showModal();
  byId(byId('repeat-start').disabled ? 'repeat-close' : 'repeat-start').focus({preventScroll:true}); refresh();
 }
 async function start() {
  busy = true; byId('repeat-error').textContent = ''; render(); ++serial;
  try {const response = await api('repeat-regions/start', {ids:scope, search_all:searchAll}); ++serial; accepted(response)}
  catch (e) {fail(e)} finally {busy = false; render()}
 }
 async function decide(pair, decision, controls) {
  for (const b of controls.querySelectorAll('button')) b.disabled = true;
  byId('repeat-error').textContent = ''; ++serial;
  try {const response = await api('repeat-regions/decision', {key:pair.key, decision}); ++serial; accepted(response)}
  catch (e) {fail(e)} finally {for (const b of controls.querySelectorAll('button')) b.disabled = false}
 }
 function openImage(file) {
  dialog.close(); if (byId('image-browser').open) byId('image-browser').close();
  byId('file-search').value = '';
  renderFileList(); byId('file').value = file.id; openFile();
 }
 function pairCard(pair) {
  const card = node('article', undefined, 'repeat-pair'); card.dataset.key = pair.key;
  const images = node('div', undefined, 'repeat-images');
  pair.images.forEach((file, i) => {
   const figure = node('figure');
   const caption = node('figcaption');
   const label = node('strong', file.name); label.title = `${file.folder || file.sample} / ${file.name}`;
   caption.append(label, button('Open', () => openImage(file)));
   const frame = node('div', undefined, 'repeat-preview');
   const placeholder = node('span', 'Loading image…', 'hint');
   const img = node('img'); img.alt = file.name; img.loading = 'lazy'; img.decoding = 'async';
   img.src = `/api/${file.has_preview ? 'file-preview' : 'acquisition-preview'}?id=${encodeURIComponent(file.id)}`;
   img.onload = () => placeholder.remove(); img.onerror = () => {placeholder.textContent = 'Image unavailable'; img.remove()};
   frame.append(placeholder, img);
   const field = pair.fields_nm?.[i];
   const metadata = node('small', `${file.folder || file.sample}${field ? ' · '+field.map(n => Number(n).toPrecision(4)).join(' × ')+' nm' : ' · scale unknown'}`, 'muted');
   metadata.title = metadata.textContent;
   figure.append(caption, frame, metadata); images.append(figure);
  });
  const footer = node('div', undefined, 'repeat-pair-footer');
  const evidence = node('div', undefined, 'repeat-evidence');
  const imageScore = node('span', Number.isFinite(pair.image_ncc) ? `Image ${pair.image_ncc.toFixed(3)}` : 'Image scale differs');
  imageScore.title = 'Translation correlation of low-pass image thumbnails, with at least 65% overlap. Not a probability. Different physical fields are not image-matched.';
  const fftScore = node('span', Number.isFinite(pair.fft_cosine) ? `FFT ${pair.fft_cosine.toFixed(3)}` : 'No stored FFT');
  fftScore.title = 'Similarity of saved native FFT peak-density histograms. Similar orientation is supporting evidence, not proof of the same region.';
  evidence.append(imageScore, fftScore);
  if (pair.exact_stage_metadata) {const stage = node('span', 'Stage agrees'); stage.title = 'Recorded X, Y and tilts agree within 0.001 in their stored units; rounding and drift can still conceal different fields.'; evidence.append(stage)}
  const controls = node('div', undefined, 'signal-toggle'); controls.setAttribute('aria-label','Review decision');
  for (const state of ['same','different','uncertain']) {
   const b = button(decisions[state], () => decide(pair, state, controls));
   b.setAttribute('aria-pressed', String(pair.decision === state)); controls.append(b);
  }
  const reset = button('Reset', () => decide(pair,'pending',controls)); reset.hidden = !pair.decision || pair.decision === 'pending'; controls.append(reset);
  footer.append(evidence, controls); card.append(images, footer); return card;
 }
 function render() {
  const running = data.job.state === 'running';
  byId('repeat-start').disabled = busy || running || scope.length < 2;
  byId('repeat-cancel').hidden = !running;
  byId('repeat-scope').textContent = `${scope.length} images in ${image ? 'project' : 'current scope'}`;
  byId('repeat-show-scope').hidden = !image;
  for (const b of byId('repeat-search-mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String((b.dataset.mode === 'all') === searchAll));
  for (const b of byId('repeat-filter').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
  const progress = byId('repeat-progress'); progress.hidden = !running;
  progress.max = Math.max(1, data.job.total || 1); progress.value = data.job.completed || 0;
  const last = data.last_scan;
  byId('repeat-status').textContent = running ? `${data.job.stage} · ${data.job.completed}/${data.job.total}` : data.job.state === 'failed' ? data.job.stage :
   last ? `${last.state === 'cancelled' ? 'Cancelled' : 'Last search'} · ${last.images} images · ${last.candidates} candidates · ${last.fft_images} with stored FFTs` : 'Ready to find repeated or overlapping fields.';
  const errors = byId('repeat-errors'); errors.hidden = !data.job.errors?.length;
  byId('repeat-error-count').textContent = `${data.job.errors?.length || 0} images could not be checked`;
  byId('repeat-error-list').replaceChildren(...(data.job.errors || []).map(e => node('li', `${e.name}: ${e.error}`)));
  byId('repeat-save-note').title = data.path ? `Decisions saved to ${data.path}` : '';
  const pairs = repeatReviewPairs(data.pairs, scope, filter, image);
  byId('repeat-count').textContent = `${pairs.length} pair${pairs.length === 1 ? '' : 's'}`;
  const signature = JSON.stringify(pairs);
  if (signature === listSignature) return;
  listSignature = signature;
  const list = byId('repeat-list'), top = dialog.scrollTop;
  list.replaceChildren(...pairs.map(pairCard));
  if (!pairs.length) list.append(node('p', data.pairs.length ? 'No pairs in this view. Try All or another folder.' : 'No candidates yet. Find repeats to compare these images.', 'hint'));
  dialog.scrollTop = top;
 }
 function card(tile, file) {
  const badge = repeatReviewBadge(data.pairs, file.id); if (!badge) return tile;
  const wrapper = node('div', undefined, 'image-browser-repeat');
  const review = button(badge.text, () => open(projectFiles(), file.id), 'repeat-badge');
  review.classList.toggle('confirmed', badge.confirmed); wrapper.append(tile, review); return wrapper;
 }
 byId('repeat-regions-open').onclick = () => open(projectFiles());
 byId('image-browser-duplicates').onclick = () => open(imageBrowserFiles());
 byId('repeat-close').onclick = () => dialog.close();
 byId('repeat-start').onclick = start;
 byId('repeat-cancel').onclick = async () => {try {const response = await api('repeat-regions/cancel',{}); ++serial; accepted(response)} catch(e) {fail(e)}};
 byId('repeat-show-scope').onclick = () => {image = null; render()};
 byId('repeat-search-mode').onclick = e => {const b=e.target.closest('button[data-mode]'); if(b) {searchAll=b.dataset.mode==='all';render()}};
 byId('repeat-filter').onclick = e => {const b=e.target.closest('button[data-filter]'); if(b) {filter=b.dataset.filter;render()}};
 window.RepeatRegions = {configure, refresh, card, open};
})();
