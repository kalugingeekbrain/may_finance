const $ = id => document.getElementById(id);
function revealFocusedField() {
  const field = document.activeElement;
  if (!field?.matches('input, textarea')) return;
  requestAnimationFrame(() => {
    if (document.activeElement !== field) return;
    const bounds = field.getBoundingClientRect();
    const top = window.visualViewport?.offsetTop || 0;
    const height = window.visualViewport?.height || window.innerHeight;
    if (bounds.top < top + 12 || bounds.bottom > top + height - 12) {
      field.scrollIntoView({block:'center', behavior:'instant'});
    }
  });
}
document.addEventListener('focusin', revealFocusedField);
window.addEventListener('resize', revealFocusedField);
window.visualViewport?.addEventListener('resize', revealFocusedField);
let token = localStorage.getItem('token') || '';
let base = localStorage.getItem('server') || (location.hostname === 'appassets.androidplatform.net' ? 'https://budget.158-160-250-19.sslip.io' : '');
let state;
let privateVisible = false;
let activeTab = "expense";
let editingId = null;
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
function signOut() { privateVisible = false; clearForm(); activeTab = 'expense'; token = ''; state = null; localStorage.removeItem('token'); $('dashboard').hidden = true; $('auth').hidden = false; $('logout').hidden = true; $('entries').replaceChildren(); $('code').textContent = ''; }
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
  $('shared-balance').textContent = money(walletBalance('shared'));
  $('sync').textContent = 'Обновлено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  renderTab();
}
function control(label, callback) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.onclick = () => action(button,callback);
  return button;
}
function clearForm() {
  closeCategoryForm();
  $('item-rows').replaceChildren();
  $('receipt').open = false;
  editingId = null;
  $('entry-form').reset();
  $('date').value = today();
  $('cancel-edit').hidden = true;
  $('save').textContent = 'Добавить';
  requestId = crypto.randomUUID();
}
function switchTab(tab) {
  if (activeTab !== tab) clearForm();
  activeTab = tab;
  renderTab();
}
function editEntry(entry) {
  switchTab(entry.kind);
  editingId = entry.id;
  for (const field of ['wallet','category','note','date']) $(field).value = entry[field];
  $('item-rows').replaceChildren();
  for (const item of entry.items || []) addItem(item);
  $('receipt').open = Boolean(entry.items?.length);
  $('amount').value = (entry.amount / 100).toFixed(2);
  renderTab();
  $('operation').scrollIntoView({block:'start'});
}
function walletBalance(wallet) {
  return state.entries.filter(entry => entry.wallet === wallet)
    .reduce((sum, entry) => sum + (entry.kind === 'income' ? entry.amount : -entry.amount), 0);
}
function renderTab() {
  if (!state) return;
  const formTab = ['expense','income'].includes(activeTab);
  $('operation').hidden = !formTab;
  const personalTab = activeTab === 'personal';
  $('report').hidden = $('history').hidden = !(activeTab === 'report' || (personalTab && privateVisible));
  $('report-wallet').hidden = personalTab;
  $('plans').hidden = activeTab !== 'plans';
  $('receipt').hidden = activeTab !== 'expense';
  $('personal-balance').textContent = privateVisible ? money(walletBalance('personal')) : '••••';
  for (const option of $('report-wallet').options) option.disabled = !privateVisible && option.value !== 'shared';
  if (!privateVisible) $('report-wallet').value = 'shared';
  $('eye').setAttribute('aria-label',privateVisible ? 'Скрыть личные данные' : 'Показать личные данные');
  $('eye').setAttribute('aria-pressed',String(privateVisible));
  renderGoals();
  $('pair-panel').hidden = activeTab !== 'pair';
  $('invite').hidden = state.members.length === 2;
  $('pair-panel').querySelector('h2').textContent = state.members.length === 2 ? 'Ваша пара' : 'Пригласите партнёра';
  $('pair-panel').querySelector('p').hidden = state.members.length === 2;
  if (state.members.length === 2) $('code').textContent = state.members.map(member => member.name).join(' и ');
  for (const button of $('tabs').children) button.setAttribute('aria-pressed',String(button.dataset.tab === activeTab));
  if (formTab) {
    $('kind').value = activeTab;
    $('open-category').textContent = activeTab === 'expense' ? '＋ Добавить категорию расходов' : '＋ Добавить категорию поступлений';
    $('form-title').textContent = editingId ? 'Изменить операцию' : activeTab === 'income' ? 'Новое поступление' : 'Новая трата';
    $('save').textContent = editingId ? 'Сохранить' : 'Добавить';
    $('cancel-edit').hidden = !editingId;
    renderCategories();
  }
  renderReport();
}
function renderCategories() {
  const wallet = $('wallet').value;
  const kind = $('kind').value;
  const names = new Set(kind === 'income' ? ['Зарплата','Подарок'] : ['Продукты','Жильё','Здоровье','Семья','Проезд','Такси','Отдых']);
  for (const entry of state.entries) if (entry.wallet === wallet && entry.kind === kind) names.add(entry.category);
  for (const item of state.categories || []) {
    if (item.wallet === wallet && item.kind === kind) {
      if (item.hidden) names.delete(item.name); else names.add(item.name);
    }
  }
  const categoryKey = JSON.stringify([wallet,kind,[...names]]);
  if ($('choices').dataset.key === categoryKey) return;
  $('choices').dataset.key = categoryKey;
  $('choices').replaceChildren();
  $('manage').replaceChildren();
  for (const name of names) {
    const pick = control(name, () => { $('category').value = name; requestId = crypto.randomUUID(); });
    pick.prepend(categoryIcon(name));
    $('choices').append(pick);
    if (name === 'Без категории') continue;
    const row = document.createElement('div');
    const input = document.createElement('input');
    input.value = name;
    input.maxLength = 50;
    input.setAttribute('aria-label','Название категории ' + name);
    const change = async replacement => {
      await api('category',{wallet,kind,name,replacement});
      if ($('category').value === name) $('category').value = replacement || '';
      await refresh();
    };
    row.append(input,control('Переименовать',() => change(input.value.trim())),control('Удалить',async () => {
      if (confirm('Удалить категорию «' + name + '»? Её операции сохранятся в «Без категории».')) await change(null);
    }));
    $('manage').append(row);
  }
}
for (const button of $('tabs').children) button.onclick = () => switchTab(button.dataset.tab);
$('cancel-edit').onclick = () => { clearForm(); renderTab(); };
function closeCategoryForm() {
  $('category-form').hidden = true;
  $('new-category').value = '';
}
$('wallet').onchange = () => { closeCategoryForm(); renderCategories(); };
$('open-category').onclick = () => { $('category-form').hidden = false; $('new-category').focus(); };
$('cancel-category').onclick = closeCategoryForm;
$('category-form').onsubmit = event => {
  event.preventDefault();
  const name = $('new-category').value.trim();
  const wallet = $('wallet').value;
  const kind = $('kind').value;
  action(event.submitter, async () => {
    await api('add-category',{wallet,kind,name});
    if (wallet === $('wallet').value && kind === activeTab) {
      $('category').value = name;
      requestId = crypto.randomUUID();
      closeCategoryForm();
    }
    await refresh();
    message('Категория сохранена');
  });
};
function cents(value) {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error('Введите стоимость в рублях и копейках');
  const [whole, fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2,'0'));
}
function setMonthRange() {
  const month = $('month').value || today().slice(0,7);
  const [year, number] = month.split('-').map(Number);
  $('from').value = month + '-01';
  $('to').value = month + '-' + new Date(year,number,0).getDate();
  renderReport();
}
function addItem(item) {
  const row = document.createElement('div');
  row.className = 'form-grid';
  const name = document.createElement('input');
  name.name = 'itemName'; name.placeholder = 'Наименование'; name.required = true; name.maxLength = 80;
  const price = document.createElement('input');
  price.name = 'itemPrice'; price.placeholder = 'Цена, ₽'; price.inputMode = 'decimal'; price.required = true;
  name.setAttribute('aria-label','Наименование покупки');
  price.setAttribute('aria-label','Стоимость покупки');
  if (item) { name.value = item.name; price.value = (item.price / 100).toFixed(2); }
  row.append(name,price,control('Убрать',() => { row.remove(); requestId = crypto.randomUUID(); }));
  $('item-rows').append(row);
}
$('add-item').onclick = () => addItem();
$('eye').onclick = () => {
  privateVisible = !privateVisible;
  if (!privateVisible) {
    if ($('wallet').value === 'personal') clearForm();
    $('report-wallet').value = 'shared';
  }
  renderTab();
};
function renderGoals() {
  const goals = (state.goals || []).filter(goal => goal.wallet === 'shared' || privateVisible);
  const key = JSON.stringify([today(),goals]);
  if ($('goal-list').dataset.key === key) return;
  $('goal-list').dataset.key = key;
  $('goal-list').replaceChildren();
  for (const goal of goals) {
    const card = document.createElement('article');
    const title = document.createElement('h3');
    title.textContent = goal.title;
    const progress = document.createElement('p');
    progress.textContent = (goal.wallet === 'shared' ? 'Общий' : 'Личный') + ' · накоплено ' + money(goal.saved) + ' из ' + money(goal.target);
    const remaining = Math.max(0,goal.target - goal.saved);
    const schedule = document.createElement('p');
    schedule.textContent = remaining ? 'Осталось ' + money(remaining) : 'Цель достигнута';
    if (goal.deadline && remaining) {
      const days = 1 + Math.round((Date.parse(goal.deadline) - Date.parse(today())) / 86400000);
      schedule.textContent += days > 0 ? ' · до ' + goal.deadline + ' включительно по ' + money(Math.ceil(remaining / days)) + ' в день' : ' · дата покупки прошла (' + goal.deadline + ')';
    }
    card.append(title,progress,schedule);
    if (remaining) {
      const form = document.createElement('form');
      const amount = document.createElement('input');
      amount.placeholder = 'Отложено, ₽'; amount.required = true; amount.inputMode = 'decimal';
      amount.setAttribute('aria-label','Сумма взноса');
      const button = document.createElement('button');
      button.textContent = 'Записать взнос';
      let id = crypto.randomUUID();
      amount.oninput = () => { id = crypto.randomUUID(); };
      form.onsubmit = event => { event.preventDefault(); action(button,async () => {
        await api('deposit',{id, goal:goal.id, amount:cents(amount.value)});
        amount.value = ''; id = crypto.randomUUID(); await refresh();
      }); };
      form.append(amount,button); card.append(form);
    }
    $('goal-list').append(card);
  }
}
$('goal-kind').onchange = () => {
  const purchase = $('goal-kind').value === 'purchase';
  $('deadline-label').hidden = !purchase;
  $('goal-date').required = purchase;
};
let goalId = crypto.randomUUID();
$('goal-form').oninput = () => { goalId = crypto.randomUUID(); };
$('goal-form').onsubmit = event => {
  event.preventDefault();
  action(event.submitter,async () => {
    await api('goal',{id:goalId,wallet:$('goal-wallet').value,title:$('goal-name').value,target:cents($('goal-target').value),deadline:$('goal-kind').value === 'purchase' ? $('goal-date').value : null});
    goalId = crypto.randomUUID(); $('goal-form').reset(); $('goal-kind').onchange();
    await refresh(); message('Цель сохранена');
  });
};
function renderReport() {
  if (!state) return;
  const wallet = activeTab === 'personal' ? 'personal' : $('report-wallet').value;
  const entries = state.entries.filter(entry => entry.date >= $('from').value && entry.date <= $('to').value && (privateVisible || entry.wallet === 'shared') && (wallet === 'all' || entry.wallet === wallet));
  const income = entries.filter(entry => entry.kind === 'income').reduce((sum, entry) => sum + entry.amount, 0);
  const expense = entries.filter(entry => entry.kind === 'expense').reduce((sum, entry) => sum + entry.amount, 0);
  $('income').textContent = money(income); $('expense').textContent = money(expense); $('net').textContent = money(income - expense); $('chart-total').textContent = money(expense);
  const chartKind = $('chart-kind').value;
  const total = chartKind === 'income' ? income : expense;
  $('chart-label').textContent = chartKind === 'income' ? 'Поступления' : 'Расходы';
  $('chart-total').textContent = money(total);
  const categories = new Map();
  for (const entry of entries.filter(entry => entry.kind === chartKind && entry.amount > 0)) categories.set(entry.category, (categories.get(entry.category) || 0) + entry.amount);
  $('legend').replaceChildren();
  let offset = 0;
  const stops = [];
  [...categories].sort((a, b) => b[1] - a[1]).forEach(([category, amount], index) => {
    const percent = amount / total * 100;
    const color = colors[index % colors.length];
    stops.push(`${color} ${offset}% ${offset + percent}%`); offset += percent;
    const item = document.createElement('li'); const dot = document.createElement('i'); dot.style.background = color;
    const label = document.createElement('span'); label.append(categoryIcon(category), ' ' + category + ' · ' + money(amount));
    if (chartKind === 'expense') {
      const goods = entries.filter(e => e.kind === 'expense' && e.category === category).flatMap(e => e.items || []);
      if (goods.length) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Покупки (' + goods.length + ')';
        details.append(summary);
        for (const good of goods) {
          const line = document.createElement('div');
          line.textContent = good.name + ' · ' + money(good.price);
          details.append(line);
        }
        label.append(details);
      }
    }
    const share = document.createElement('b'); share.textContent = percent.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%';
    item.append(dot, label, share); $('legend').append(item);
  });
  $('chart').style.background = stops.length ? `conic-gradient(${stops.join(',')})` : '#edf0e8';
  if (!stops.length) $('legend').textContent = 'За выбранный период данных нет.';
  $('entries').replaceChildren();
  for (const entry of entries) {
    const item = document.createElement('li'); const detail = document.createElement('div'); const title = document.createElement('span');
    title.append(categoryIcon(entry.category), ' ' + entry.category);
    const meta = document.createElement('small');
    const author = state.members.find(member => member.id === entry.author)?.name || state.user.name;
    meta.textContent = `${entry.date.split('-').reverse().join('.')} · ${entry.wallet === 'shared' ? 'Общий · ' + author : 'Личный'}${entry.note ? ' · ' + entry.note : ''}`;
    detail.append(title, meta); const amount = document.createElement('strong'); amount.textContent = (entry.kind === 'income' ? '+' : '−') + money(entry.amount); amount.className = entry.kind;
    item.append(detail, amount);
    if (entry.author === state.user.id) {
      const controls = document.createElement('div');
      controls.append(control('Изменить', () => editEntry(entry)), control('Удалить', async () => {
        if (confirm('Удалить эту операцию?')) { await api('delete-entry', {id:entry.id}); await refresh(); }
      }));
      detail.append(controls);
    }
    $('entries').append(item);
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
    window.TogetherAutofill?.commit();
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
    const items = $('kind').value === 'expense' ? Array.from($('item-rows').children, row => ({
      name: row.querySelector('[name=itemName]').value.trim(), price: cents(row.querySelector('[name=itemPrice]').value)
    })) : [];
    await api(editingId ? 'edit-entry' : 'entries', { items, id:editingId, wallet: $('wallet').value, kind: $('kind').value, amount, category: $('category').value, date: $('date').value, note: $('note').value, requestId });
    clearForm();
    await refresh(); message('Операция сохранена');
  });
};
$('entry-form').addEventListener('input', () => { requestId = crypto.randomUUID(); });
$('logout').onclick = () => action($('logout'), async () => { await api('logout', {}); signOut(); });
$('month').onchange = setMonthRange;
setMonthRange();
for (const id of ['chart-kind','from','to','report-wallet']) $(id).onchange = () => {
  if ($('from').value > $('to').value) message('Начало периода должно быть раньше окончания');
  else message('');
  renderReport();
};
refresh().catch(error => message(error.message));
setInterval(() => { if (token && !document.hidden) refresh().catch(() => { $('sync').textContent = 'Нет связи · данные могут устареть'; }); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh().catch(error => message(error.message)); });
