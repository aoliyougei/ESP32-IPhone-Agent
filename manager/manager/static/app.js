const $ = id => document.getElementById(id);
let token = '', selected = null, editing = null, cards = new Map(), refreshing = false;
let menuTrigger = null;
const notice = text => { $('notice').textContent = text; };
function setLayout(landscape) {
  document.body.classList.toggle('overview-landscape', landscape);
  $('layout-toggle').textContent = '布局：' + (landscape ? '横向' : '纵向');
  $('layout-toggle').setAttribute('aria-pressed', String(landscape));
}
try { setLayout(localStorage.getItem('manager-layout') === 'landscape'); }
catch { setLayout(false); }
$('layout-toggle').onclick = () => {
  const landscape = !document.body.classList.contains('overview-landscape');
  setLayout(landscape);
  try { localStorage.setItem('manager-layout', landscape ? 'landscape' : 'portrait'); } catch {}
};

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(7000),
    headers: { 'Content-Type': 'application/json', ...(options.method ? { 'X-Admin-Token': token } : {}) } });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401) throw Error('请先填写正确的管理员凭证');
    throw Error(typeof error.detail === 'string' ? error.detail : `请求失败 (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}
function credentials() { $('credentials').showModal(); $('token').focus(); }
$('admin').onclick = credentials;
$('cancel-token').onclick = () => $('credentials').close();
$('token-form').onsubmit = event => {
  event.preventDefault(); token = $('token').value; $('token').value = '';
  $('credentials').close(); notice('已设置当前页面的管理员凭证；保存操作时验证。');
};
function edit(item = null) {
  if (!token) { notice('请先设置管理员凭证，然后重试。'); credentials(); return; }
  editing = item;
  const form = $('server-form');
  form.elements.name.value = item?.name || '';
  form.elements.host.value = item?.host || '';
  form.elements.port.value = item?.port || 8890;
  $('editor-title').textContent = item ? '编辑 Server' : '添加 Server';
  $('form-error').textContent = ''; $('editor').showModal(); form.elements.name.focus();
}
$('cancel-edit').onclick = () => $('editor').close();
$('server-form').onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget;
  $('save').disabled = true;
  try {
    await request('/api/servers' + (editing ? '/' + editing.id : ''), {
      method: editing ? 'PUT' : 'POST', body: JSON.stringify({ name: form.elements.name.value,
        host: form.elements.host.value, port: Number(form.elements.port.value) }) });
    $('editor').close(); notice('共享列表已保存。'); await refresh();
  } catch (error) { $('form-error').textContent = error.message; }
  finally { $('save').disabled = false; }
};
function closeMenu(restore = false) {
  $('menu').hidden = true; if (restore) menuTrigger?.focus();
}
function menu(event, item, trigger) {
  event.preventDefault(); selected = item; menuTrigger = trigger;
  const element = $('menu'); element.hidden = false;
  element.style.left = Math.max(0, Math.min(event.clientX, innerWidth - element.offsetWidth - 8)) + 'px';
  element.style.top = Math.max(0, Math.min(event.clientY, innerHeight - element.offsetHeight - 8)) + 'px';
  element.querySelector('button').focus();
}
$('menu').onclick = async event => {
  const action = event.target.dataset.action, item = selected;
  if (!action || !item) return;
  closeMenu();
  if (action === 'connect') location.hash = 'server/' + item.id;
  if (action === 'edit') edit(item);
  if (action === 'delete') {
    if (!token) { notice('请先设置管理员凭证，然后重试。'); credentials(); return; }
    if (!confirm(`从所有访问者的列表中删除“${item.name}”？不会停止该 Server。`)) return;
    try { await request('/api/servers/' + item.id, { method: 'DELETE' }); notice('已从共享列表删除。'); await refresh(); }
    catch (error) { notice(error.message); }
  }
};
document.addEventListener('pointerdown', event => { if (!$('menu').contains(event.target)) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(true); });
window.addEventListener('resize', () => closeMenu());
window.addEventListener('scroll', () => closeMenu(), true);
function card(item) {
  const element = document.createElement('article'); element.className = 'card';
  // Only static markup; all server-controlled strings are assigned as text, never HTML.
  element.innerHTML = '<a class="phone-link" target="_blank" rel="noopener noreferrer"><div class="phone"><img alt="" hidden><span class="placeholder">正在连接…</span></div><h2></h2><div class="address"></div></a><div class="status"></div><button class="more" aria-label="Server 操作">⋮</button>';
  const link = element.querySelector('a'), more = element.querySelector('.more');
  link.href = '#server/' + item.id; link.removeAttribute('target');
  link.setAttribute('aria-label', `连接 ${item.name}`);
  element.querySelector('h2').textContent = item.name;
  element.querySelector('.address').textContent = `${item.host}:${item.port}`;
  element.oncontextmenu = event => menu(event, item, more);
  more.onclick = event => { const r = more.getBoundingClientRect(); menu({ preventDefault() {}, clientX: r.left, clientY: r.bottom }, item, more); };
  element.querySelector('img').onerror = () => {
    element.querySelector('img').hidden = true;
    element.querySelector('.placeholder').hidden = false;
    element.querySelector('.placeholder').textContent = '暂无投屏画面';
  };
  return { element, item, blob: null };
}
function release(entry) { if (entry.blob) URL.revokeObjectURL(entry.blob); }
async function preview(entry) {
  const { element, item } = entry;
  if (element.getBoundingClientRect().top > innerHeight + 100 || element.getBoundingClientRect().bottom < 0) return;
  const image = element.querySelector('img'), placeholder = element.querySelector('.placeholder');
  try {
    const status = await request(`/api/servers/${item.id}/status`);
    const badges = [['device', 'ESP32'], ['screen', '投屏'], ['calibrated', '校准'], ['running', '任务']];
    element.querySelector('.status').replaceChildren(...badges.map(([key, label]) => {
      const badge = document.createElement('span'); badge.className = 'badge' + (status[key] ? ' on' : '');
      badge.textContent = label + (status[key] ? (key === 'running' ? '运行中' : '就绪') : (key === 'running' ? '空闲' : '未就绪')); return badge;
    }));
    if (!status.screen) { image.hidden = true; placeholder.hidden = false; placeholder.textContent = '等待手机投屏'; return; }
    const response = await fetch(`/api/servers/${item.id}/frame`, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw Error('暂无投屏画面');
    const blob = await response.blob();
    if (!element.isConnected) return;
    release(entry); entry.blob = URL.createObjectURL(blob); image.src = entry.blob;
    image.hidden = false; placeholder.hidden = true;
  } catch {
    image.hidden = true; placeholder.hidden = false; placeholder.textContent = '离线或画面不可用';
    element.querySelector('.status').textContent = '连接异常，下次自动重试';
  }
}
async function refresh() {
  if (refreshing || document.hidden || location.hash.startsWith('#server/')) return;
  refreshing = true;
  try {
    const items = await request('/api/servers');
    const ids = new Set(items.map(item => item.id));
    for (const [id, entry] of cards) if (!ids.has(id)) { release(entry); entry.element.remove(); cards.delete(id); }
    const add = $('add'); if (add) add.remove();
    for (const item of items) {
      let entry = cards.get(item.id);
      if (entry && JSON.stringify(entry.item) !== JSON.stringify(item)) { release(entry); entry.element.remove(); cards.delete(item.id); entry = null; }
      if (!entry) { entry = card(item); cards.set(item.id, entry); $('servers').append(entry.element); }
    }
    const button = document.createElement('button'); button.id = 'add'; button.className = 'phone add';
    button.innerHTML = '<span class="plus" aria-hidden="true">＋</span><span>添加 Server</span>';
    button.onclick = () => edit(); $('servers').append(button);
    // Bound upstream fan-out rather than polling every server simultaneously.
    const queue = [...cards.values()];
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) await preview(queue.shift());
    }));
  } catch (error) { notice('管理服务连接失败：' + error.message); }
  finally { refreshing = false; }
}
async function showRoute() {
  closeMenu();
  const id = location.hash.startsWith('#server/') ? location.hash.slice(8) : '';
  document.body.classList.toggle('console-open', !!id);
  $('console-navigation').hidden = !id;
  $('servers').hidden = !!id; $('console-view').hidden = !id;
  $('overview-controls').hidden = !!id;
  $('console-frame').removeAttribute('src');
  if (!id) { await refresh(); return; }
  try {
    const items = await request('/api/servers');
    if (location.hash !== '#server/' + id) return;
    const item = items.find(item => item.id === id);
    if (!item) throw Error('Server 不存在或已删除');
    $('console-name').textContent = item.name;
    $('console-frame').contentWindow.location.replace('/servers/' + encodeURIComponent(id) + '/');
    notice('');
  } catch (error) { notice(error.message); }
}
$('return-list').onclick = () => { location.hash = ''; };
window.addEventListener('hashchange', showRoute);
async function poll() { await refresh(); setTimeout(poll, 3000); }
showRoute(); poll();
