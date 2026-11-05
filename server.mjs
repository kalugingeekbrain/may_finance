import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function createApp(databasePath = ':memory:') {
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, login TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL, pair_id TEXT);
    CREATE TABLE IF NOT EXISTS pairs(id TEXT PRIMARY KEY, code_hash TEXT UNIQUE, expires INTEGER);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), expires INTEGER);
    `);
  const entriesSchema = 'CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, author TEXT REFERENCES users(id), pair_id TEXT, owner TEXT, kind TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0 OR (amount=0 AND kind=\'expense\')), category TEXT NOT NULL, date TEXT NOT NULL, note TEXT NOT NULL, request_id TEXT NOT NULL, UNIQUE(author,request_id))';
  db.exec(entriesSchema);
  if (db.prepare("SELECT sql FROM sqlite_master WHERE name='entries'").get().sql.includes('CHECK(amount>0)')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('ALTER TABLE entries RENAME TO entries_before_zero');
      db.exec(entriesSchema);
      db.exec('INSERT INTO entries SELECT * FROM entries_before_zero ORDER BY rowid; DROP TABLE entries_before_zero; COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  db.exec('CREATE TABLE IF NOT EXISTS category_names(scope TEXT, kind TEXT, name TEXT, hidden INTEGER NOT NULL, PRIMARY KEY(scope,kind,name))');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
  const attempts = new Map();
  function limit(key) {
    const now = Date.now();
    for (const [id, item] of attempts) if (item.until < now) attempts.delete(id);
    const item = attempts.get(key) || { count: 0, until: now + 900000 };
    item.count++;
    attempts.set(key, item);
    if (item.count > 30) fail(429, 'Слишком много попыток. Попробуйте через 15 минут.');
  }
  const visibleEntries = user => db.prepare('SELECT id,author,kind,amount,category,date,note, CASE WHEN owner IS NULL THEN \'shared\' ELSE \'personal\' END AS wallet FROM entries WHERE owner=? OR (owner IS NULL AND pair_id=?) ORDER BY date DESC,rowid DESC').all(user.id, user.pair_id);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = req.headers.origin;
    if (origin === 'https://appassets.androidplatform.net') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && ['/downloads/together-1.1.apk','/downloads/together-1.1.1.apk','/downloads/together-1.1.2.apk'].includes(path)) {
        const filename = path.slice('/downloads/'.length);
        let apk;
        try { apk = readFileSync(new URL('./dist/' + filename, import.meta.url)); }
        catch (error) { if (error.code === 'ENOENT') fail(404,'Сборка недоступна'); throw error; }
        res.writeHead(200, {'Content-Type':'application/vnd.android.package-archive','Content-Disposition':'attachment; filename="' + filename + '"'});
        res.end(apk);
        return;
      }
      if (req.method === 'GET' && ['/', '/index.html', '/app.js', '/icons.js', '/style.css'].includes(path)) {
        const file = path === '/' ? 'index.html' : path.slice(1);
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
        res.end(readFileSync(new URL(`./web/${file}`, import.meta.url))); return;
      }
      let body = {};
      if (req.method === 'POST') {
        let data = '';
        for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 16384) fail(413, 'Запись слишком большая'); }
        try { body = JSON.parse(data || '{}'); } catch { fail(400, 'Некорректный запрос'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Некорректный запрос');
      }
      let result;
      if (req.method === 'POST' && ['/api/register', '/api/login'].includes(path)) {
        limit(req.socket.remoteAddress);
        if (!text(body.login, 100) || !text(body.password, 128) || body.password.length < 8) fail(400, 'Укажите логин и пароль от 8 символов');
        const login = body.login.trim().toLowerCase();
        let user = db.prepare('SELECT * FROM users WHERE login=?').get(login);
        if (path === '/api/register') {
          if (!text(body.name, 50)) fail(400, 'Укажите имя');
          if (user) fail(409, 'Логин уже занят');
          const salt = randomBytes(16).toString('hex');
          const id = randomUUID();
          db.prepare('INSERT INTO users VALUES (?,?,?,?,?,NULL)').run(id, body.name.trim(), login, salt, scryptSync(body.password, salt, 64).toString('hex'));
          user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
        } else {
          const candidate = scryptSync(body.password, user?.salt || 'invalid-user', 64);
          if (!user || !timingSafeEqual(candidate, Buffer.from(user.password, 'hex'))) fail(401, 'Неверный логин или пароль');
        }
        const token = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token), user.id, Date.now() + 30 * 86400000);
        result = { token };
      } else {
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        const user = db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires>?').get(hash(token), Date.now());
        if (!user) fail(401, 'Войдите в аккаунт');
        if (path === '/api/state' && req.method === 'GET') {
          const members = user.pair_id ? db.prepare('SELECT id,name FROM users WHERE pair_id=?').all(user.pair_id) : [];
          const categories = db.prepare("SELECT kind,name,hidden,CASE WHEN scope=? THEN 'personal' ELSE 'shared' END AS wallet FROM category_names WHERE scope IN (?,?)").all(user.id,user.id,user.pair_id);
          result = { user: { id: user.id, name: user.name }, paired: !!user.pair_id, members, entries: visibleEntries(user), categories };
        } else if (path === '/api/invite' && req.method === 'POST') {
          if (user.pair_id && db.prepare('SELECT COUNT(*) AS n FROM users WHERE pair_id=?').get(user.pair_id).n >= 2) fail(409, 'В паре уже два человека');
          const code = randomBytes(8).toString('hex').toUpperCase();
          const pairId = user.pair_id || randomUUID();
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare('INSERT INTO pairs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET code_hash=excluded.code_hash, expires=excluded.expires').run(pairId, hash(code), Date.now() + 86400000);
            db.prepare('UPDATE users SET pair_id=? WHERE id=?').run(pairId, user.id);
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          result = { code };
        } else if (path === '/api/join' && req.method === 'POST') {
          limit(user.id);
          if (user.pair_id) fail(409, 'Вы уже состоите в паре');
          const pair = db.prepare('SELECT * FROM pairs WHERE code_hash=? AND expires>?').get(hash(String(body.code || '').trim().toUpperCase()), Date.now());
          if (!pair) fail(400, 'Код недействителен или истёк');
          db.exec('BEGIN IMMEDIATE');
          try {
            if (db.prepare('SELECT COUNT(*) AS n FROM users WHERE pair_id=?').get(pair.id).n >= 2) fail(409, 'В паре уже два человека');
            db.prepare('UPDATE users SET pair_id=? WHERE id=?').run(pair.id, user.id);
            db.prepare('UPDATE pairs SET code_hash=NULL,expires=NULL WHERE id=?').run(pair.id);
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          result = { ok: true };
        } else if (path === '/api/add-category' && req.method === 'POST') {
          const {wallet,kind,name} = body;
          if (!['personal','shared'].includes(wallet) || !['expense','income'].includes(kind) || !text(name,50)) fail(400,'Введите название категории');
          const scope = wallet === 'personal' ? user.id : user.pair_id;
          if (!scope) fail(400,'Для общего кошелька сначала создайте пару');
          db.prepare('INSERT OR REPLACE INTO category_names VALUES (?,?,?,0)').run(scope,kind,name.trim());
          result = {ok:true};
        } else if (path === '/api/category' && req.method === 'POST') {
          const {wallet, kind, name, replacement} = body;
          if (!['shared','personal'].includes(wallet) || !['expense','income'].includes(kind) || !text(name,50) || (replacement !== null && !text(replacement,50))) fail(400,'Проверьте название категории');
          const scope = wallet === 'personal' ? user.id : user.pair_id;
          if (!scope || name === 'Без категории') fail(400,'Категория недоступна');
          const next = replacement?.trim() || 'Без категории';
          if (next === name) fail(400,'Введите новое название');
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare('UPDATE entries SET category=? WHERE kind=? AND category=? AND ((owner=? AND owner IS NOT NULL) OR (owner IS NULL AND pair_id=?))').run(next,kind,name,wallet === 'personal' ? scope : null,wallet === 'shared' ? scope : null);
            const saveName = db.prepare('INSERT OR REPLACE INTO category_names VALUES (?,?,?,?)');
            saveName.run(scope,kind,name,1);
            saveName.run(scope,kind,next,0);
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          result = {ok:true};
        } else if (path === '/api/delete-entry' && req.method === 'POST') {
          if (!text(body.id,100) || !db.prepare('DELETE FROM entries WHERE id=? AND author=?').run(body.id,user.id).changes) fail(404,'Операция недоступна');
          result = {ok:true};
        } else if (['/api/entries','/api/edit-entry'].includes(path) && req.method === 'POST') {
          if (!['shared', 'personal'].includes(body.wallet) || !['income', 'expense'].includes(body.kind)) fail(400, 'Выберите кошелёк и тип операции');
          if (body.wallet === 'shared' && !user.pair_id) fail(400, 'Сначала создайте пару или присоединитесь по коду');
          if (!Number.isSafeInteger(body.amount) || body.amount < (body.kind === 'expense' ? 0 : 1) || body.amount > 100000000000) fail(400, 'Некорректная сумма');
          if (!text(body.category, 50) || !text(body.requestId, 100) || typeof body.note !== 'string' || body.note.length > 300) fail(400, 'Проверьте категорию и комментарий');
          if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !Number.isFinite(Date.parse(body.date)) || new Date(body.date).toISOString().slice(0, 10) !== body.date) fail(400, 'Некорректная дата');
          const shared = body.wallet === 'shared';
          const category = body.category.trim();
          if (db.prepare('SELECT hidden FROM category_names WHERE scope=? AND kind=? AND name=?').get(shared ? user.pair_id : user.id,body.kind,category)?.hidden) fail(409,'Категория удалена или переименована');
          const values = [shared ? user.pair_id : null, shared ? null : user.id, body.kind, body.amount, category, body.date, body.note.trim()];
          if (path === '/api/edit-entry') {
            if (!text(body.id,100) || !db.prepare('UPDATE entries SET pair_id=?,owner=?,kind=?,amount=?,category=?,date=?,note=? WHERE id=? AND author=?').run(...values,body.id,user.id).changes) fail(404,'Операция недоступна');
          } else {
            db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(author,request_id) DO NOTHING').run(randomUUID(),user.id,...values,body.requestId);
          }
          result = { ok: true };
        } else if (path === '/api/logout' && req.method === 'POST') {
          db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token)); result = { ok: true };
        } else fail(404, 'Не найдено');
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(error.status || 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.status ? error.message : 'Ошибка сервера' }));
      if (!error.status) console.error(error);
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(new URL('./data/', import.meta.url), { recursive: true });
  createApp(process.env.DATABASE_PATH || fileURLToPath(new URL('./data/budget.sqlite', import.meta.url))).listen(Number(process.env.PORT || 8080), process.env.HOST || '127.0.0.1', () => console.log('Pair Budget listening on port ' + (process.env.PORT || 8080)));
}
