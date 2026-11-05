const $ = id => document.getElementById(id);
let token = localStorage.getItem('token') || '';
let base = localStorage.getItem('server') || (location.hostname === 'appassets.androidplatform.net' ? 'https://budget.158-160-250-19.sslip.io' : '');
let state;
let requestId = crypto.randomUUID();
const money = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(value / 100);
const today = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const colors = ['#235c48', '#95ad68', '#e4ba70', '#769fbd', '#bd8b9d', '#a49bc4', '#79918b'];
$('server').value = base;
$('date').value = today();
$('month').value = today().slice(0, 7);
function message(value) { $('message').textContent = value; }
async function api(path, body) {
  const response = await fetch(base + '/api/' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== 'login') signOut();
    throw new Error(result.error || 'Не удалось выполнить запрос');
  }
  return result;
}
function signOut() { token = ''; state = null; localStorage.removeItem('token'); $('dashboard').hidden = true; $('auth').hidden = false; $('logout').hidden = true; $('entries').replaceChildren(); $('code').textContent = ''; }
async function refresh() {
  if (!token) return;
  const currentToken = token;
  const result = await api('state');
  if (token !== currentToken) return;
  state = result;
  $('auth').hidden = true; $('dashboard').hidden = false; $('logout').hidden = false;
  $('greeting').textContent = 'Привет, ' + state.user.name;
  $('members').textContent = state.members.map(member => member.name).join(' и ') || 'Создайте пару для общего бюджета';
  $('pair-panel').hidden = state.members.length === 2;
  $('join-form').hidden = state.paired;
  for (const wallet of ['shared', 'personal']) {
    const total = state.entries.filter(entry => entry.wallet === wallet).reduce((sum, entry) => sum + (entry.kind === 'income' ? entry.amount : -entry.amount), 0);
    $(wallet + '-balance').textContent = money(total);
  }
  $('sync').textContent = 'Обновлено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  renderReport();
}
function renderReport() {
  if (!state) return;
  const wallet = $('report-wallet').value;
  const entries = state.entries.filter(entry => entry.date.startsWith($('month').value) && (wallet === 'all' || entry.wallet === wallet));
  const income = entries.filter(entry => entry.kind === 'income').reduce((sum, entry) => sum + entry.amount, 0);
  const expense = entries.filter(entry => entry.kind === 'expense').reduce((sum, entry) => sum + entry.amount, 0);
  $('income').textContent = money(income); $('expense').textContent = money(expense); $('net').textContent = money(income - expense); $('chart-total').textContent = money(expense);
  const categories = new Map();
  for (const entry of entries.filter(entry => entry.kind === 'expense')) categories.set(entry.category, (categories.get(entry.category) || 0) + entry.amount);
  $('legend').replaceChildren();
  let offset = 0;
  const stops = [];
  [...categories].sort((a, b) => b[1] - a[1]).forEach(([category, amount], index) => {
    const percent = amount / expense * 100;
    const color = colors[index % colors.length];
    stops.push(`${color} ${offset}% ${offset + percent}%`); offset += percent;
    const item = document.createElement('li'); const dot = document.createElement('i'); dot.style.background = color;
    const label = document.createElement('span'); label.textContent = category + ' · ' + money(amount);
    const share = document.createElement('b'); share.textContent = percent.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%';
    item.append(dot, label, share); $('legend').append(item);
  });
  $('chart').style.background = stops.length ? `conic-gradient(${stops.join(',')})` : '#edf0e8';
  if (!stops.length) $('legend').textContent = 'В этом месяце расходов пока нет.';
  $('entries').replaceChildren();
  for (const entry of entries) {
    const item = document.createElement('li'); const detail = document.createElement('div'); const title = document.createElement('span');
    title.textContent = entry.category;
    const meta = document.createElement('small');
    const author = state.members.find(member => member.id === entry.author)?.name || state.user.name;
    meta.textContent = `${entry.date.split('-').reverse().join('.')} · ${entry.wallet === 'shared' ? 'Общий · ' + author : 'Личный'}${entry.note ? ' · ' + entry.note : ''}`;
    detail.append(title, meta); const amount = document.createElement('strong'); amount.textContent = (entry.kind === 'income' ? '+' : '−') + money(entry.amount); amount.className = entry.kind;
    item.append(detail, amount); $('entries').append(item);
  }
  if (!entries.length) $('entries').textContent = 'Здесь появятся ваши операции.';
}
async function action(button, task) { button.disabled = true; message(''); try { await task(); } catch (error) { message(error.message === 'Failed to fetch' ? 'Нет связи с сервером. Проверьте адрес и подключение.' : error.message); } finally { button.disabled = false; } }
$('auth-form').addEventListener('submit', event => {
  event.preventDefault(); const button = event.submitter;
  action(button, async () => {
    const address = $('server').value.trim().replace(/\/$/, '');
    if (address && new URL(address).protocol !== 'https:') throw new Error('Для подключения к серверу укажите HTTPS-адрес');
    if (!address && location.hostname === 'appassets.androidplatform.net') throw new Error('Укажите адрес сервера');
    base = address; localStorage.setItem('server', base);
    const result = await api(button.value, { login: $('login').value, password: $('password').value, name: $('name').value });
    token = result.token; localStorage.setItem('token', token); $('password').value = ''; await refresh();
  });
});
$('invite').onclick = () => action($('invite'), async () => { const result = await api('invite', {}); $('code').textContent = result.code; await refresh(); });
$('join-form').onsubmit = event => { event.preventDefault(); action(event.submitter, async () => { await api('join', { code: $('join-code').value }); await refresh(); }); };
$('entry-form').onsubmit = event => {
  event.preventDefault();
  action($('save'), async () => {
    const raw = $('amount').value.trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error('Введите сумму с точностью до копеек');
    const [whole, fraction = ''] = raw.split('.');
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    await api('entries', { wallet: $('wallet').value, kind: $('kind').value, amount, category: $('category').value, date: $('date').value, note: $('note').value, requestId });
    requestId = crypto.randomUUID(); $('amount').value = ''; $('note').value = ''; $('wallet').value = 'shared';
    await refresh(); message('Операция добавлена');
  });
};
$('entry-form').addEventListener('input', () => { requestId = crypto.randomUUID(); });
$('logout').onclick = () => action($('logout'), async () => { await api('logout', {}); signOut(); });
$('month').onchange = renderReport; $('report-wallet').onchange = renderReport;
refresh().catch(error => message(error.message));
setInterval(() => { if (token && !document.hidden) refresh().catch(() => { $('sync').textContent = 'Нет связи · данные могут устареть'; }); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh().catch(error => message(error.message)); });
