const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'troque-este-segredo';
const db = new Database('obra.db');
db.pragma('foreign_keys = ON');
db.exec(`
create table if not exists usuarios(id integer primary key, nome text, email text unique, senha text);
create table if not exists obras(id integer primary key, usuario_id int, nome text, orcamento real default 0);
create table if not exists compras(id integer primary key, usuario_id int, obra_id int, data text, loja text, descricao text, forma text, valor_total real, qtd_parcelas int, primeira_parcela text);
create table if not exists itens(id integer primary key, compra_id int references compras(id) on delete cascade, material text, unidade text, qtd real, preco real);
create table if not exists retiradas(id integer primary key, usuario_id int, obra_id int, material text, qtd real, data text, local text);
create table if not exists parcelas(id integer primary key, compra_id int references compras(id) on delete cascade, usuario_id int, numero int, vencimento text, valor real, status text default 'pendente', data_pagamento text, valor_pago real);
create table if not exists orcamentos(id integer primary key, usuario_id int, obra_id int, nome_arquivo text, tipo text, tamanho int, valor real, arquivo text, criado_em text default current_timestamp,
  foreign key(obra_id) references obras(id) on delete cascade);
create table if not exists obra_usuarios(obra_id int, usuario_id int, primary key(obra_id, usuario_id), foreign key(obra_id) references obras(id) on delete cascade, foreign key(usuario_id) references usuarios(id) on delete cascade);
`);
db.exec('insert or ignore into obra_usuarios(obra_id, usuario_id) select id, usuario_id from obras');
const colunasOrcamentos = db.prepare('pragma table_info(orcamentos)').all().map(c => c.name);
if (!colunasOrcamentos.includes('nome')) db.exec('alter table orcamentos add column nome text default \'Orçamento\'');
if (!colunasOrcamentos.includes('loja')) db.exec('alter table orcamentos add column loja text default \'\'');
if (!colunasOrcamentos.includes('status')) db.exec("alter table orcamentos add column status text default 'ativo'");

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));
app.use('/api', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const hoje = () => new Date().toISOString().slice(0, 10);
const r2 = n => Math.round(n * 100) / 100;
const fail = (res, msg, code = 400) => res.status(code).json({ erro: msg });

function addMes(d, n) {
  const [y, m, dia] = d.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(dia, ultimo));
  return base.toISOString().slice(0, 10);
}

app.post('/api/registro', (req, res) => {
  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha || senha.length < 6) return fail(res, 'Informe nome, e-mail e senha com 6 ou mais caracteres.');
  try {
    const id = db.prepare('insert into usuarios(nome,email,senha) values(?,?,?)').run(nome, email.toLowerCase(), bcrypt.hashSync(senha, 10)).lastInsertRowid;
    res.json({ token: jwt.sign({ id }, SECRET, { expiresIn: '7d' }), nome });
  } catch { fail(res, 'Este e-mail já está cadastrado.'); }
});

app.post('/api/login', (req, res) => {
  const u = db.prepare('select * from usuarios where email=?').get((req.body.email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.senha || '', u.senha)) return fail(res, 'E-mail ou senha incorretos.', 401);
  res.json({ token: jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' }), nome: u.nome });
});

app.use('/api', (req, res, next) => {
  try { req.uid = jwt.verify((req.headers.authorization || '').slice(7), SECRET).id; next(); }
  catch { fail(res, 'Sessão expirada. Entre novamente.', 401); }
});

// API versionada para sincronização com aplicativos externos.
app.get('/api/v1/sync', (req, res) => {
  const u = req.uid;
  const obrasSync = db.prepare(`select o.id,o.usuario_id,o.nome,o.orcamento,(o.usuario_id=?) propria,
    coalesce((select sum(valor_total) from compras where obra_id=o.id),0) gasto
    from obras o where o.usuario_id=? or exists (select 1 from obra_usuarios x where x.obra_id=o.id and x.usuario_id=?) order by o.id`).all(u, u, u);
  const ids = obrasSync.map(o => o.id);
  const inObras = ids.length ? `and c.obra_id in (${ids.map(() => '?').join(',')})` : 'and 1=0';
  const inObrasR = ids.length ? `and r.obra_id in (${ids.map(() => '?').join(',')})` : 'and 1=0';
  const comprasSync = ids.length ? db.prepare(`select c.*,o.nome obra from compras c join obras o on o.id=c.obra_id where c.obra_id in (${ids.map(() => '?').join(',')}) order by c.id`).all(...ids) : [];
  const parcelasSync = ids.length ? db.prepare(`select p.*,c.loja,c.descricao,c.forma,c.qtd_parcelas,o.nome obra from parcelas p join compras c on c.id=p.compra_id join obras o on o.id=c.obra_id where c.obra_id in (${ids.map(() => '?').join(',')}) order by p.id`).all(...ids) : [];
  const orcamentosSync = ids.length ? db.prepare(`select o.id,o.obra_id,o.nome,o.loja,o.nome_arquivo,o.tipo,o.tamanho,o.valor,o.status,o.criado_em,b.nome obra from orcamentos o join obras b on b.id=o.obra_id where o.obra_id in (${ids.map(() => '?').join(',')}) order by o.id`).all(...ids) : [];
  const retiradasSync = ids.length ? db.prepare(`select r.*,o.nome obra from retiradas r join obras o on o.id=r.obra_id where 1=1 ${inObrasR} order by r.id`).all(...ids) : [];
  const itensSync = ids.length ? db.prepare(`select i.*,c.obra_id from itens i join compras c on c.id=i.compra_id where 1=1 ${inObras}`).all(...ids) : [];
  res.json({ versao: 1, sincronizado_em: new Date().toISOString(), obras: obrasSync, compras: comprasSync, itens: itensSync, parcelas: parcelasSync, orcamentos: orcamentosSync, retiradas: retiradasSync, estoque: obrasSync.map(o => ({ obra_id: o.id, itens: estoque(u, o.id) })) });
});

app.get('/api/usuarios', (req, res) => res.json(db.prepare('select id, nome, email from usuarios where id<>? order by nome').all(req.uid)));
app.post('/api/usuarios', (req, res) => {
  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha || senha.length < 6) return fail(res, 'Informe nome, e-mail e senha com 6 ou mais caracteres.');
  try {
    const id = db.prepare('insert into usuarios(nome,email,senha) values(?,?,?)').run(nome.trim(), email.toLowerCase().trim(), bcrypt.hashSync(senha, 10)).lastInsertRowid;
    res.json({ id, ok: 1 });
  } catch { fail(res, 'Este e-mail já está cadastrado.'); }
});

app.get('/api/obras', (req, res) => res.json(db.prepare(
  'select o.*, (o.usuario_id=?) propria, coalesce((select sum(valor_total) from compras where obra_id=o.id),0) gasto from obras o where usuario_id=? or exists (select 1 from obra_usuarios x where x.obra_id=o.id and x.usuario_id=?) order by id desc').all(req.uid, req.uid, req.uid)));
app.post('/api/obras', (req, res) => {
  if (!req.body.nome) return fail(res, 'Informe o nome da obra.');
  const id = db.prepare('insert into obras(usuario_id,nome,orcamento) values(?,?,?)').run(req.uid, req.body.nome, +req.body.orcamento || 0).lastInsertRowid;
  db.prepare('insert or ignore into obra_usuarios(obra_id,usuario_id) values(?,?)').run(id, req.uid);
  res.json({ ok: 1 });
});
app.get('/api/obras/:id/usuarios', (req, res) => {
  const obra = db.prepare('select id from obras where id=? and usuario_id=?').get(req.params.id, req.uid);
  if (!obra) return fail(res, 'Obra não encontrada.', 404);
  res.json(db.prepare('select u.id,u.nome,u.email from obra_usuarios x join usuarios u on u.id=x.usuario_id where x.obra_id=? and u.id<>? order by u.nome').all(req.params.id, req.uid));
});
app.post('/api/obras/:id/usuarios', (req, res) => {
  const obra = db.prepare('select id from obras where id=? and usuario_id=?').get(req.params.id, req.uid);
  const usuario = db.prepare('select id from usuarios where id=?').get(req.body.usuario_id);
  if (!obra || !usuario) return fail(res, 'Obra ou usuário não encontrado.');
  db.prepare('insert or ignore into obra_usuarios(obra_id,usuario_id) values(?,?)').run(req.params.id, req.body.usuario_id);
  res.json({ ok: 1 });
});
app.delete('/api/obras/:id/usuarios/:usuarioId', (req, res) => {
  const obra = db.prepare('select id from obras where id=? and usuario_id=?').get(req.params.id, req.uid);
  if (!obra) return fail(res, 'Obra não encontrada.', 404);
  db.prepare('delete from obra_usuarios where obra_id=? and usuario_id=?').run(req.params.id, req.params.usuarioId);
  res.json({ ok: 1 });
});
app.patch('/api/obras/:id', (req, res) => {
  const orcamento = +req.body.orcamento;
  if (!Number.isFinite(orcamento) || orcamento < 0) return fail(res, 'Informe um orçamento válido.');
  const r = db.prepare('update obras set orcamento=? where id=? and usuario_id=?').run(orcamento, req.params.id, req.uid);
  if (!r.changes) return fail(res, 'Obra não encontrada.', 404);
  res.json({ ok: 1 });
});
app.delete('/api/obras/:id', (req, res) => {
  db.prepare('delete from compras where obra_id=? and usuario_id=?').run(req.params.id, req.uid);
  db.prepare('delete from retiradas where obra_id=? and usuario_id=?').run(req.params.id, req.uid);
  db.prepare('delete from obras where id=? and usuario_id=?').run(req.params.id, req.uid);
  res.json({ ok: 1 });
});

app.get('/api/orcamentos', (req, res) => res.json(db.prepare(
  `select o.*, b.nome obra, b.orcamento orcamento_cadastrado,
   coalesce((select sum(valor_total) from compras where obra_id=b.id),0) gasto
   from orcamentos o join obras b on b.id=o.obra_id where o.usuario_id=? order by case when o.status='ativo' then 0 else 1 end, o.valor asc, o.id desc`
).all(req.uid)));
app.post('/api/orcamentos', (req, res) => {
  const b = req.body, valor = +b.valor;
  const permitidos = ['application/pdf', 'image/png', 'image/jpeg'];
  if (!b.obra_id || !b.nome || !b.loja || !b.nome_arquivo || !permitidos.includes(b.tipo) || !Number.isFinite(valor) || valor < 0 || typeof b.arquivo !== 'string') {
    return fail(res, 'Informe nome, loja, obra, valor e um arquivo PDF, PNG ou JPG válido.');
  }
  if (+b.tamanho > 12 * 1024 * 1024 || b.arquivo.length > 17 * 1024 * 1024 || !b.arquivo.startsWith(`data:${b.tipo};base64,`)) return fail(res, 'O arquivo deve ter no máximo 12 MB.');
  const obra = db.prepare('select id from obras where id=? and usuario_id=?').get(b.obra_id, req.uid);
  if (!obra) return fail(res, 'Obra não encontrada.');
  db.prepare('insert into orcamentos(usuario_id,obra_id,nome,loja,nome_arquivo,tipo,tamanho,valor,arquivo) values(?,?,?,?,?,?,?,?,?)')
    .run(req.uid, b.obra_id, b.nome.trim(), b.loja.trim(), b.nome_arquivo, b.tipo, +b.tamanho || 0, valor, b.arquivo);
  res.json({ ok: 1 });
});
app.patch('/api/orcamentos/:id', (req, res) => {
  if (!['ativo', 'concluido', 'cancelado'].includes(req.body.status)) return fail(res, 'Status inválido.');
  const r = db.prepare('update orcamentos set status=? where id=? and usuario_id=?').run(req.body.status, req.params.id, req.uid);
  if (!r.changes) return fail(res, 'Orçamento não encontrado.', 404);
  res.json({ ok: 1 });
});
app.delete('/api/orcamentos/:id', (req, res) => {
  db.prepare('delete from orcamentos where id=? and usuario_id=?').run(req.params.id, req.uid);
  res.json({ ok: 1 });
});

app.get('/api/compras', (req, res) => res.json(db.prepare(
  `select c.*, o.nome obra,
   (select count(*) from parcelas where compra_id=c.id and status='paga') pagas
   from compras c join obras o on o.id=c.obra_id where (o.usuario_id=? or exists (select 1 from obra_usuarios x where x.obra_id=o.id and x.usuario_id=?)) order by c.data desc, c.id desc`).all(req.uid, req.uid)));

app.post('/api/compras', (req, res) => {
  const b = req.body;
  const itens = (b.itens || []).filter(i => i.material && +i.qtd > 0);
  const total = itens.length ? r2(itens.reduce((s, i) => s + i.qtd * i.preco, 0)) : r2(+b.valor_total);
  const n = Math.max(1, parseInt(b.qtd_parcelas) || 1);
  if (!b.obra_id || !b.data || !(total > 0)) return fail(res, 'Informe obra, data e valor (ou itens).');
  const obra = db.prepare('select id from obras where id=? and (usuario_id=? or exists (select 1 from obra_usuarios x where x.obra_id=obras.id and x.usuario_id=?))').get(b.obra_id, req.uid, req.uid);
  if (!obra) return fail(res, 'Obra não encontrada.');
  const primeira = b.primeira_parcela || b.data;
  db.transaction(() => {
    const cid = db.prepare('insert into compras(usuario_id,obra_id,data,loja,descricao,forma,valor_total,qtd_parcelas,primeira_parcela) values(?,?,?,?,?,?,?,?,?)')
      .run(req.uid, b.obra_id, b.data, b.loja || '', b.descricao || '', b.forma || 'PIX', total, n, primeira).lastInsertRowid;
    itens.forEach(i => db.prepare('insert into itens(compra_id,material,unidade,qtd,preco) values(?,?,?,?,?)').run(cid, i.material.trim(), i.unidade || 'un', +i.qtd, +i.preco || 0));
    const base = Math.floor(total / n * 100) / 100;
    for (let k = 1; k <= n; k++) {
      const valor = k === n ? r2(total - base * (n - 1)) : base;
      db.prepare('insert into parcelas(compra_id,usuario_id,numero,vencimento,valor) values(?,?,?,?,?)').run(cid, req.uid, k, addMes(primeira, k - 1), valor);
    }
  })();
  res.json({ ok: 1 });
});
app.delete('/api/compras/:id', (req, res) => {
  db.prepare('delete from compras where id=? and usuario_id=?').run(req.params.id, req.uid);
  res.json({ ok: 1 });
});

app.get('/api/parcelas', (req, res) => {
  const rows = db.prepare(
   `select p.*, c.loja, c.descricao, c.forma, c.qtd_parcelas, o.nome obra from parcelas p
     join compras c on c.id=p.compra_id join obras o on o.id=c.obra_id where (o.usuario_id=? or exists (select 1 from obra_usuarios x where x.obra_id=o.id and x.usuario_id=?)) order by p.vencimento, p.id`).all(req.uid, req.uid);
  const h = hoje();
  res.json(rows.map(p => ({ ...p, status: p.status === 'pendente' && p.vencimento < h ? 'atrasada' : p.status })));
});
app.post('/api/parcelas/:id/pagar', (req, res) => {
  const p = db.prepare('select * from parcelas where id=? and usuario_id=?').get(req.params.id, req.uid);
  if (!p) return fail(res, 'Parcela não encontrada.', 404);
  db.prepare("update parcelas set status='paga', data_pagamento=?, valor_pago=? where id=?")
    .run(req.body.data || hoje(), r2(+req.body.valor || p.valor), p.id);
  res.json({ ok: 1 });
});
app.post('/api/parcelas/:id/estornar', (req, res) => {
  db.prepare("update parcelas set status='pendente', data_pagamento=null, valor_pago=null where id=? and usuario_id=?").run(req.params.id, req.uid);
  res.json({ ok: 1 });
});

function estoque(uid, obraId) {
  const cond = obraId ? 'and c.obra_id=?' : '';
  const args = obraId ? [uid, uid, obraId] : [uid, uid];
  const comp = db.prepare(`select i.material, i.unidade, sum(i.qtd) q, sum(i.qtd*i.preco) valor from itens i join compras c on c.id=i.compra_id where (c.usuario_id=? or exists (select 1 from obra_usuarios x where x.obra_id=c.obra_id and x.usuario_id=?)) ${cond} group by lower(i.material)`).all(...args);
  const ret = db.prepare(`select material, sum(qtd) q from retiradas c where (c.usuario_id=? or exists (select 1 from obra_usuarios x where x.obra_id=c.obra_id and x.usuario_id=?)) ${cond} group by lower(material)`).all(...args);
  const mapa = Object.fromEntries(ret.map(r => [r.material.toLowerCase(), r.q]));
  return comp.map(c => ({ material: c.material, unidade: c.unidade, comprado: c.q, valor: r2(c.valor), retirado: mapa[c.material.toLowerCase()] || 0, saldo: c.q - (mapa[c.material.toLowerCase()] || 0) }));
}
app.get('/api/estoque', (req, res) => res.json(estoque(req.uid, req.query.obra_id)));
app.get('/api/retiradas', (req, res) => res.json(db.prepare(
  'select r.*, o.nome obra from retiradas r join obras o on o.id=r.obra_id where (o.usuario_id=? or exists (select 1 from obra_usuarios x where x.obra_id=o.id and x.usuario_id=?)) order by r.data desc, r.id desc limit 100').all(req.uid, req.uid)));
app.post('/api/retiradas', (req, res) => {
  const b = req.body, q = +b.qtd;
  if (!b.obra_id || !b.material || !(q > 0)) return fail(res, 'Informe obra, material e quantidade.');
  const item = estoque(req.uid, b.obra_id).find(e => e.material.toLowerCase() === b.material.toLowerCase());
  if (!item || q > item.saldo) return fail(res, `Saldo insuficiente. Em estoque: ${item ? item.saldo : 0}.`);
  db.prepare('insert into retiradas(usuario_id,obra_id,material,qtd,data,local) values(?,?,?,?,?,?)').run(req.uid, b.obra_id, item.material, q, b.data || hoje(), b.local || '');
  res.json({ ok: 1 });
});
app.delete('/api/retiradas/:id', (req, res) => {
  db.prepare('delete from retiradas where id=? and usuario_id=?').run(req.params.id, req.uid);
  res.json({ ok: 1 });
});

app.get('/api/painel', (req, res) => {
  const u = req.uid, h = hoje();
  const one = (sql, ...a) => db.prepare(sql).get(...a).v || 0;
  res.json({
    orcamento: one('select sum(orcamento) v from obras where usuario_id=?', u),
    gasto: one('select sum(valor_total) v from compras where usuario_id=?', u),
    pago: one("select sum(valor_pago) v from parcelas where usuario_id=? and status='paga'", u),
    aPagar: one("select sum(valor) v from parcelas where usuario_id=? and status='pendente'", u),
    atrasado: one("select sum(valor) v from parcelas where usuario_id=? and status='pendente' and vencimento<?", u, h),
    proximas: db.prepare(`select p.*, c.loja, c.descricao, c.qtd_parcelas, o.nome obra from parcelas p join compras c on c.id=p.compra_id join obras o on o.id=c.obra_id
      where p.usuario_id=? and p.status='pendente' order by p.vencimento limit 6`).all(u).map(p => ({ ...p, status: p.vencimento < h ? 'atrasada' : 'pendente' }))
  });
});

const PORTA = 3000;
app.listen(PORTA, () => console.log('Rodando em http://localhost:' + PORTA));
