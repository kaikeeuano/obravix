const $ = s => document.querySelector(s);
let token = localStorage.getItem('t'), nome = localStorage.getItem('n'), aba = 'painel', obras = [];
let arquivosOrcamentos = [], orcamentoCompra = null;
const R = v => (+v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const Q = v => (+v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const D = d => d ? d.split('-').reverse().join('/') : '';
const hoje = () => new Date().toISOString().slice(0, 10);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FORMAS = ['PIX', 'Dinheiro', 'Débito', 'Cartão de crédito', 'Boleto', 'Crediário', 'Financiamento', 'Empréstimo'];

async function api(url, metodo = 'GET', corpo) {
  const r = await fetch('/api/' + url, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: corpo ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && token) sair();
  if (!r.ok) throw new Error(j.erro || 'Erro inesperado.');
  return j;
}
const tentar = async fn => { try { await fn(); } catch (e) { alert(e.message); } };
function sair() { localStorage.clear(); token = null; telaLogin(); }

function telaLogin(modo = 'login') {
  const reg = modo === 'registro';
  $('#app').innerHTML = `<div class="login"><img class="logo-login" src="logo.svg" alt="Obravix - Gestão Inteligente de Obras"><h2>${reg ? 'Criar conta' : 'Entrar'}</h2>
  <form onsubmit="return enviarLogin(event,${reg})">
  ${reg ? '<label>Nome<input id="ln" required></label>' : ''}
  <label>E-mail<input id="le" type="email" required></label>
  <label>Senha<input id="ls" type="password" minlength="6" required></label>
  <p class="erro" id="le2"></p><button>${reg ? 'Criar conta' : 'Entrar'}</button>
  <button type="button" class="sec" onclick="telaLogin('${reg ? 'login' : 'registro'}')">${reg ? 'Já tenho conta' : 'Criar conta'}</button></form></div>`;
}
async function enviarLogin(e, reg) {
  e.preventDefault();
  try {
    const j = await (await fetch('/api/' + (reg ? 'registro' : 'login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: $('#ln')?.value, email: $('#le').value, senha: $('#ls').value }) })).json();
    if (!j.token) throw new Error(j.erro);
    token = j.token; nome = j.nome; localStorage.setItem('t', token); localStorage.setItem('n', nome);
    iniciar();
  } catch (err) { $('#le2').textContent = err.message; }
  return false;
}

const ABAS = { painel: 'Painel', obras: 'Obras', orcamentos: 'Orçamentos', compras: 'Compras', parcelas: 'Parcelas', estoque: 'Estoque', usuarios: 'Usuários' };
async function iniciar() {
  obras = await api('obras');
  $('#app').innerHTML = `<div class="layout"><nav><img class="logo-menu" src="logo.svg" alt="Obravix">${Object.entries(ABAS).map(([k, v]) => `<button data-a="${k}" onclick="ir('${k}')">${v}</button>`).join('')}<button onclick="sair()">Sair</button></nav><main id="main"></main></div>`;
  ir(aba);
}
async function ir(a) {
  aba = a; obras = await api('obras');
  document.querySelectorAll('nav [data-a]').forEach(b => b.classList.toggle('on', b.dataset.a === a));
  $('#main').innerHTML = '';
  await tentar(() => ({ painel, obras: telaObras, orcamentos, compras, parcelas, estoque, usuarios })[a]());
}
const optObras = sel => obras.map(o => `<option value="${o.id}" ${o.id == sel ? 'selected' : ''}>${esc(o.nome)}</option>`).join('');
const semObra = () => !obras.length && ($('#main').innerHTML = '<div class="box vazio">Cadastre sua primeira obra na aba Obras para começar.</div>', true);

async function painel() {
  const p = await api('painel');
  $('#main').innerHTML = `<h2>Olá, ${esc(nome)}</h2><div class="cards">
  <div class="card az">Orçamento<b>${R(p.orcamento)}</b></div><div class="card">Total gasto<b>${R(p.gasto)}</b></div>
  <div class="card vd">Já pago<b>${R(p.pago)}</b></div><div class="card am">A pagar<b>${R(p.aPagar)}</b></div>
  <div class="card vm">Em atraso<b>${R(p.atrasado)}</b></div><div class="card">Saldo do orçamento<b>${R(p.orcamento - p.gasto)}</b></div></div>
  <h3>Próximas parcelas</h3>${tabelaParcelas(p.proximas, false)}`;
}

async function telaObras() {
  $('#main').innerHTML = `<h2>Obras</h2><div class="box"><div class="grid"><label>Nome da obra<input id="on"></label><label>Orçamento (R$)<input id="oo" type="number" step="0.01"></label></div>
  <button onclick="addObra()">Salvar obra</button></div>
  <div class="tab"><table><tr><th>Obra</th><th class="n">Orçamento</th><th class="n">Gasto</th><th class="n">Saldo</th><th></th></tr>
  ${obras.map(o => `<tr><td>${esc(o.nome)}</td><td class="n">${R(o.orcamento)}</td><td class="n">${R(o.gasto)}</td><td class="n">${R(o.orcamento - o.gasto)}</td><td><button class="perigo" onclick="delObra(${o.id})">Excluir</button></td></tr>`).join('') || '<tr><td class="vazio">Nenhuma obra cadastrada.</td></tr>'}</table></div>`;
}
async function usuarios() {
  const us = await api('usuarios'), minhas = obras.filter(o => o.propria), compartilhados = await Promise.all(minhas.map(async o => [o, await api('obras/' + o.id + '/usuarios')]));
  $('#main').innerHTML = `<h2>Usuários e acessos</h2><div class="box"><h3>Adicionar usuário</h3><div class="grid"><label>Nome<input id="un"></label><label>E-mail<input id="ue" type="email"></label><label>Senha inicial<input id="us" type="password" minlength="6"></label></div><button onclick="adicionarUsuario()">Adicionar usuário</button></div>
  <div class="box"><h3>Compartilhar obra</h3><div class="grid"><label>Obra<select id="uo">${minhas.map(o => `<option value="${o.id}">${esc(o.nome)}</option>`).join('')}</select></label><label>Usuário<select id="uu">${us.map(u => `<option value="${u.id}">${esc(u.nome)} · ${esc(u.email)}</option>`).join('')}</select></label></div><button onclick="compartilharObra()">Conceder acesso</button></div>
  <h3>Acessos por obra</h3><div class="tab"><table><tr><th>Obra</th><th>Usuário</th><th>E-mail</th><th></th></tr>${compartilhados.flatMap(([o, lista]) => lista.map(u => `<tr><td>${esc(o.nome)}</td><td>${esc(u.nome)}</td><td>${esc(u.email)}</td><td><button class="perigo pequeno" onclick="removerAcesso(${o.id},${u.id})">Remover</button></td></tr>`)).join('') || '<tr><td class="vazio">Nenhum acesso compartilhado.</td></tr>'}</table></div>`;
}
const adicionarUsuario = () => tentar(async () => { await api('usuarios', 'POST', { nome: $('#un').value, email: $('#ue').value, senha: $('#us').value }); ir('usuarios'); });
const compartilharObra = () => tentar(async () => { await api('obras/' + $('#uo').value + '/usuarios', 'POST', { usuario_id: $('#uu').value }); ir('usuarios'); });
const removerAcesso = (obraId, usuarioId) => tentar(async () => { await api(`obras/${obraId}/usuarios/${usuarioId}`, 'DELETE'); ir('usuarios'); });
const addObra = () => tentar(async () => { await api('obras', 'POST', { nome: $('#on').value, orcamento: $('#oo').value }); ir('obras'); });
const delObra = id => confirm('Excluir a obra e todas as compras e retiradas dela?') && tentar(async () => { await api('obras/' + id, 'DELETE'); ir('obras'); });

async function orcamentos() {
  arquivosOrcamentos = await api('orcamentos');
  const ativos = arquivosOrcamentos.filter(a => a.status === 'ativo').sort((a, b) => a.valor - b.valor);
  const historico = arquivosOrcamentos.filter(a => a.status !== 'ativo');
  const total = obras.reduce((s, o) => s + (+o.orcamento || 0), 0);
  const gasto = obras.reduce((s, o) => s + (+o.gasto || 0), 0);
  $('#main').innerHTML = `<h2>Orçamentos</h2><div class="cards">
  <div class="card az">Total orçado<b>${R(total)}</b></div><div class="card">Total gasto<b>${R(gasto)}</b></div>
  <div class="card vd">Saldo disponível<b>${R(total - gasto)}</b></div></div>
  <div class="topo secao-titulo"><h3>Orçamentos ativos</h3><button class="sec pequeno" onclick="abrirNovoOrcamento()">+ Novo orçamento</button></div>
  <div class="tab"><table><tr><th>Arquivo</th><th>Obra</th><th class="n">Valor informado</th><th class="n">Saldo após gasto</th><th></th></tr>
  ${ativos.map(a => `<tr class="linha-orcamento" onclick="abrirOrcamento(${a.id})"><td><b>${esc(a.nome)}</b><br><small>${esc(a.loja)} · ${esc(a.nome_arquivo)}</small></td><td>${esc(a.obra)}</td><td class="n">${R(a.valor)}</td><td class="n">${R(a.valor - a.gasto)}</td><td><span class="status ativo">Ativo</span></td></tr>`).join('') || '<tr><td class="vazio">Nenhum orçamento ativo.</td></tr>'}</table></div>
  <h3>Histórico</h3><div class="tab"><table><tr><th>Orçamento</th><th>Obra</th><th class="n">Valor</th><th>Status</th><th></th></tr>
  ${historico.map(a => `<tr class="linha-orcamento" onclick="abrirOrcamento(${a.id})"><td><b>${esc(a.nome)}</b><br><small>${esc(a.loja)}</small></td><td>${esc(a.obra)}</td><td class="n">${R(a.valor)}</td><td><span class="status ${a.status}">${a.status === 'concluido' ? 'Concluído' : 'Cancelado'}</span></td><td></td></tr>`).join('') || '<tr><td class="vazio">Nenhum orçamento concluído ou cancelado.</td></tr>'}</table></div>
  <div class="box novo-orcamento" id="novo-orcamento" hidden><h3>Novo orçamento</h3><div class="grid">
  <label>Nome do orçamento<input id="an" placeholder="Ex.: Orçamento hidráulica" required></label><label>Loja ou fornecedor<input id="al" placeholder="Nome da loja" required></label>
  <label>Obra<select id="ao">${optObras()}</select></label><label>Valor do orçamento (R$)<input id="av" type="number" min="0" step="0.01" required></label>
  <label>Arquivo PDF, PNG ou JPG<input id="af" type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" required></label></div>
  <button onclick="addOrcamento()">Lançar orçamento</button> <button class="sec" onclick="fecharNovoOrcamento()">Fechar</button><p class="vazio">O arquivo pode ter até 12 MB.</p></div>
  <h3>Comparação por obra</h3>
  <div class="tab"><table><tr><th>Obra</th><th class="n">Orçamento</th><th class="n">Gasto</th><th class="n">Saldo</th><th></th></tr>
  ${obras.map(o => `<tr><td>${esc(o.nome)}</td><td class="n"><input class="orcamento-edicao" type="number" min="0" step="0.01" value="${o.orcamento || 0}" onchange="atualizarOrcamento(${o.id}, this.value)"></td><td class="n">${R(o.gasto)}</td><td class="n">${R((+o.orcamento || 0) - (+o.gasto || 0))}</td><td></td></tr>`).join('') || '<tr><td class="vazio">Nenhuma obra cadastrada.</td></tr>'}</table></div>
  `;
}
const atualizarOrcamento = (id, valor) => tentar(async () => { await api('obras/' + id, 'PATCH', { orcamento: valor }); await ir('orcamentos'); });
const abrirNovoOrcamento = () => { $('#novo-orcamento').hidden = false; $('#novo-orcamento').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
const fecharNovoOrcamento = () => { $('#novo-orcamento').hidden = true; };
const addOrcamento = () => tentar(async () => {
  const arquivo = $('#af').files[0];
  if (!arquivo) throw new Error('Selecione um arquivo de orçamento.');
  if (arquivo.size > 12 * 1024 * 1024) throw new Error('O arquivo deve ter no máximo 12 MB.');
  if (!['application/pdf', 'image/png', 'image/jpeg'].includes(arquivo.type)) throw new Error('Envie um arquivo PDF, PNG ou JPG.');
  const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Não foi possível ler o arquivo.')); r.readAsDataURL(arquivo); });
  await api('orcamentos', 'POST', { obra_id: $('#ao').value, nome: $('#an').value, loja: $('#al').value, valor: $('#av').value, nome_arquivo: arquivo.name, tipo: arquivo.type, tamanho: arquivo.size, arquivo: data });
  ir('orcamentos');
});
const abrirOrcamento = id => {
  const a = arquivosOrcamentos.find(x => x.id === id);
  if (!a) return;
  const visualizador = a.tipo === 'application/pdf' ? `<iframe src="${esc(a.arquivo)}" title="Visualização do orçamento"></iframe>` : `<img src="${esc(a.arquivo)}" alt="${esc(a.nome)}">`;
  $('#main').insertAdjacentHTML('beforeend', `<div class="modal-fundo" id="modal-orcamento" onclick="if(event.target===this)fecharOrcamento()"><div class="modal"><div class="topo secao-titulo"><h3>${esc(a.nome)}</h3><button class="sec pequeno" onclick="fecharOrcamento()">Fechar</button></div><p><b>Loja:</b> ${esc(a.loja)} · <b>Obra:</b> ${esc(a.obra)} · <b>Valor:</b> ${R(a.valor)}</p><div class="visualizador">${visualizador}</div><div class="modal-acoes">${a.status === 'ativo' ? `<button class="ok" onclick="concluirOrcamento(${a.id})">Preencher dados da compra</button><button class="perigo" onclick="mudarStatusOrcamento(${a.id},'cancelado')">Cancelar orçamento</button>` : `<span class="status ${a.status}">${a.status === 'concluido' ? 'Orçamento concluído' : 'Orçamento cancelado'}</span>`}</div></div></div>`);
};
const fecharOrcamento = () => $('#modal-orcamento')?.remove();
const concluirOrcamento = id => { orcamentoCompra = arquivosOrcamentos.find(a => a.id === id); fecharOrcamento(); ir('compras'); };
const cancelarCompraOrcamento = () => { orcamentoCompra = null; ir('orcamentos'); };
const mudarStatusOrcamento = (id, status) => tentar(async () => { await api('orcamentos/' + id, 'PATCH', { status }); ir('orcamentos'); });
const delOrcamento = id => confirm('Excluir este arquivo de orçamento?') && tentar(async () => { await api('orcamentos/' + id, 'DELETE'); ir('orcamentos'); });

async function compras() {
  if (semObra()) return;
  const lista = await api('compras');
  const compraOrcamento = orcamentoCompra;
  $('#main').innerHTML = `<h2>${compraOrcamento ? 'Dados da compra do orçamento' : 'Compras e lançamentos'}</h2>${compraOrcamento ? `<div class="box aviso">Preencha os produtos, quantidades, valores e forma de pagamento para concluir o orçamento <b>${esc(compraOrcamento.nome)}</b>. <button class="sec pequeno" onclick="cancelarCompraOrcamento()">Voltar</button></div>` : ''}<div class="box"><div class="grid">
  <label>Obra<select id="co">${optObras(compraOrcamento?.obra_id)}</select></label><label>Data<input id="cd" type="date" value="${hoje()}"></label>
  <label>Loja ou fornecedor<input id="cl" value="${esc(compraOrcamento?.loja || '')}"></label><label>Descrição<input id="cs" value="${esc(compraOrcamento?.nome || '')}"></label>
  <label>Forma de pagamento<select id="cf">${FORMAS.map(f => `<option>${f}</option>`).join('')}</select></label>
  <label>Nº de parcelas<input id="cn" type="number" min="1" value="1"></label>
  <label>Data da 1ª parcela<input id="cp" type="date" value="${hoje()}"></label>
  <label>Valor total (se não houver itens)<input id="cv" type="number" step="0.01" value="${compraOrcamento?.valor || ''}"></label></div>
  <h3>Materiais comprados</h3><div class="itens" id="it"></div>
  <div class="topo"><button class="sec" onclick="linhaItem()">Adicionar item</button><button onclick="addCompra()">Salvar compra</button></div></div>
  <div class="tab"><table><tr><th>Data</th><th>Obra</th><th>Loja</th><th>Descrição</th><th>Forma</th><th class="n">Total</th><th>Pagas</th><th></th></tr>
  ${lista.map(c => `<tr><td>${D(c.data)}</td><td>${esc(c.obra)}</td><td>${esc(c.loja)}</td><td>${esc(c.descricao)}</td><td>${esc(c.forma)}</td><td class="n">${R(c.valor_total)}</td>
  <td>${c.pagas}/${c.qtd_parcelas}<div class="barra"><i style="width:${c.pagas / c.qtd_parcelas * 100}%"></i></div></td>
  <td><button class="perigo" onclick="delCompra(${c.id})">Excluir</button></td></tr>`).join('') || '<tr><td class="vazio">Nenhuma compra registrada.</td></tr>'}</table></div>`;
  linhaItem();
}
function linhaItem() {
  $('#it').insertAdjacentHTML('beforeend', `<div class="linha"><input placeholder="Material" class="im"><input placeholder="Un" class="iu" value="un"><input placeholder="Qtd" type="number" step="0.01" class="iq"><input placeholder="Preço unit." type="number" step="0.01" class="ip"></div>`);
}
const addCompra = () => tentar(async () => {
  const itens = [...document.querySelectorAll('#it .linha')].map(l => ({ material: l.querySelector('.im').value, unidade: l.querySelector('.iu').value, qtd: l.querySelector('.iq').value, preco: l.querySelector('.ip').value }));
  await api('compras', 'POST', { obra_id: $('#co').value, data: $('#cd').value, loja: $('#cl').value, descricao: $('#cs').value, forma: $('#cf').value, qtd_parcelas: $('#cn').value, primeira_parcela: $('#cp').value, valor_total: $('#cv').value, itens });
  if (orcamentoCompra) { await api('orcamentos/' + orcamentoCompra.id, 'PATCH', { status: 'concluido' }); orcamentoCompra = null; }
  ir('compras');
});
const delCompra = id => confirm('Excluir esta compra e suas parcelas?') && tentar(async () => { await api('compras/' + id, 'DELETE'); ir('compras'); });

function tabelaParcelas(l, acoes = true) {
  if (!l.length) return '<div class="box vazio">Nenhuma parcela encontrada.</div>';
  return `<div class="tab"><table><tr><th>Vencimento</th><th>Obra</th><th>Compra</th><th>Parcela</th><th class="n">Valor</th><th>Situação</th><th>Pagamento</th>${acoes ? '<th></th>' : ''}</tr>
  ${l.map(p => `<tr><td>${D(p.vencimento)}</td><td>${esc(p.obra)}</td><td>${esc(p.loja || p.descricao)}</td><td>${p.numero}/${p.qtd_parcelas}</td><td class="n">${R(p.valor)}</td>
  <td><span class="tag ${p.status}">${p.status}</span></td><td>${p.status === 'paga' ? D(p.data_pagamento) + ' · ' + R(p.valor_pago) : ''}</td>
  ${acoes ? `<td>${p.status === 'paga' ? `<button class="sec" onclick="estornar(${p.id})">Estornar</button>` : `<button class="ok" onclick="pagar(${p.id},${p.valor})">Marcar como paga</button>`}</td>` : ''}</tr>`).join('')}</table></div>`;
}
let filtro = '';
async function parcelas() {
  const l = await api('parcelas'), f = l.filter(p => !filtro || p.status === filtro);
  const soma = s => R(l.filter(p => p.status === s).reduce((t, p) => t + (s === 'paga' ? p.valor_pago : p.valor), 0));
  $('#main').innerHTML = `<h2>Parcelas</h2><div class="cards"><div class="card vd">Pagas<b>${soma('paga')}</b></div><div class="card az">Pendentes<b>${soma('pendente')}</b></div><div class="card vm">Atrasadas<b>${soma('atrasada')}</b></div></div>
  <div class="topo"><select id="pf" style="width:auto" onchange="filtro=this.value;parcelas()"><option value="">Todas</option>${['pendente', 'atrasada', 'paga'].map(s => `<option ${filtro === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>${tabelaParcelas(f)}`;
}
const pagar = (id, v) => { const valor = prompt('Valor pago (R$):', v); if (valor === null) return; const data = prompt('Data do pagamento (AAAA-MM-DD):', hoje()); if (data === null) return; tentar(async () => { await api(`parcelas/${id}/pagar`, 'POST', { valor: String(valor).replace(',', '.'), data }); ir('parcelas'); }); };
const estornar = id => confirm('Desfazer o pagamento desta parcela?') && tentar(async () => { await api(`parcelas/${id}/estornar`, 'POST'); ir('parcelas'); });

let obraEst = '';
async function estoque() {
  if (semObra()) return;
  obraEst = obraEst || obras[0].id;
  const [e, r] = await Promise.all([api('estoque?obra_id=' + obraEst), api('retiradas')]);
  $('#main').innerHTML = `<h2>Estoque de materiais</h2><div class="topo"><label>Obra <select id="eo" style="width:auto" onchange="obraEst=this.value;estoque()">${optObras(obraEst)}</select></label></div>
  <div class="tab"><table><tr><th>Material</th><th class="n">Comprado</th><th class="n">Retirado</th><th class="n">Em estoque</th><th class="n">Valor comprado</th></tr>
  ${e.map(m => `<tr><td>${esc(m.material)} (${esc(m.unidade)})</td><td class="n">${Q(m.comprado)}</td><td class="n">${Q(m.retirado)}</td><td class="n"><b>${Q(m.saldo)}</b></td><td class="n">${R(m.valor)}</td></tr>`).join('') || '<tr><td class="vazio">Nenhum material comprado para esta obra.</td></tr>'}</table></div>
  <div class="box" style="margin-top:1.2rem"><h3>Registrar retirada</h3><div class="grid">
  <label>Material<select id="rm">${e.map(m => `<option>${esc(m.material)}</option>`).join('')}</select></label><label>Quantidade<input id="rq" type="number" step="0.01"></label>
  <label>Data<input id="rd" type="date" value="${hoje()}"></label><label>Local ou etapa de uso<input id="rl"></label></div><button onclick="addRet()">Registrar retirada</button></div>
  <h3>Últimas retiradas</h3><div class="tab"><table><tr><th>Data</th><th>Obra</th><th>Material</th><th class="n">Qtd</th><th>Uso</th><th></th></tr>
  ${r.map(x => `<tr><td>${D(x.data)}</td><td>${esc(x.obra)}</td><td>${esc(x.material)}</td><td class="n">${Q(x.qtd)}</td><td>${esc(x.local)}</td><td><button class="perigo" onclick="delRet(${x.id})">Excluir</button></td></tr>`).join('') || '<tr><td class="vazio">Nenhuma retirada registrada.</td></tr>'}</table></div>`;
}
const addRet = () => tentar(async () => { await api('retiradas', 'POST', { obra_id: obraEst, material: $('#rm').value, qtd: $('#rq').value, data: $('#rd').value, local: $('#rl').value }); estoque(); });
const delRet = id => tentar(async () => { await api('retiradas/' + id, 'DELETE'); estoque(); });

token ? iniciar() : telaLogin();
