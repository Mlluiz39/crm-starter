import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function render(name,data){
 const nodes=new Map();
 const context=vm.createContext({sessionStorage:{getItem:()=>''},document:{querySelector:s=>{if(!nodes.has(s))nodes.set(s,{showModal(){},querySelector(){return {};}});return nodes.get(s);}},console});
 vm.runInContext(readFileSync('public/app.js','utf8'),context);
 context.fixture=data;
 const result=vm.runInContext(`data=fixture;${name}()`,context);
 return result??nodes.get('#modal')?.innerHTML;
}
test('histórico distingue envio incerto, em processamento e falha',()=>{
 const html=render('approvals',{campaigns:[],leads:[],emailSettings:{},outbox:[{email:'a@example.com',status:'incerto',version:1},{email:'b@example.com',status:'processando',version:1},{email:'c@example.com',status:'falhou',version:1}]});
 assert.match(html,/resultado incerto/);assert.match(html,/em processamento/);assert.match(html,/falhou/);
});
test('prospecção mostra reservas pendentes e motivos de etapas puladas',()=>{
 const html=render('prospecting',{integrations:{},prospecting:{cost:0.05},jobs:[{id:'j',niche:'Lojas',city:'SP',status:'concluida',limit:1,results:[],actualCost:0.05,budget:1,reservedCost:0.1,costUncertain:true,warnings:['AISA: saldo insuficiente']}]});
 assert.match(html,/US\$ 0.10.*a confirmar/);assert.match(html,/AISA: saldo insuficiente/);
});

test('falha da AISA oferece ativação manual com motivo e saldo disponível',()=>{
 const html=render('prospecting',{integrations:{},prospecting:{cost:0.05},jobs:[{id:'j',searchProvider:'aisa',niche:'Lojas',city:'SP',status:'aguardando_backup',limit:1,results:[],actualCost:0.05,budget:1,reservedCost:0,costUncertain:false,error:'AISA: indisponível'}]});
 assert.match(html,/AISA falhou. Deseja ativar a Apify\?/);assert.match(html,/Ativar Apify/);
 assert.match(html,/US\$ 0.95/);assert.match(html,/AISA: indisponível/);
});
test('painel vendas mostra autonomia, propostas e custos pendentes',()=>{
 const html=render('sales',{leads:[],sales:{settings:{enabled:false},conversations:[],messages:[],decisions:[],costs:[{actualUsd:.02,reservedUsd:.05}],worker:null,connection:null}});
 assert.match(html,/Propostas e fechamento/);assert.match(html,/Pausado/);assert.match(html,/0.05/);assert.match(html,/Verificar conexões/);
});

test('seleção comercial mostra leads manuais e prospectados, ocultando bloqueados',()=>{
 const html=render('salesEnroll',{leads:[{id:'m',name:'Manual visível',origin:'manual',email:'m@example.com'},{id:'h',name:'Prospectado visível',origin:'hermes'},{id:'b',name:'Bloqueado oculto',origin:'manual',blocked:true}]});
 assert.match(html,/Manual visível/);assert.match(html,/Prospectado visível/);assert.doesNotMatch(html,/Bloqueado oculto/);
});
test('painel permite excluir conversas e restaurar histórico excluído',()=>{
 const html=render('sales',{leads:[{id:'l',name:'Teste'}],sales:{settings:{},conversations:[{id:'c',leadId:'l',status:'pausada',channel:'email'}],deletedConversations:[{id:'d',leadId:'l',status:'pausada',channel:'whatsapp',deletedAt:'2026-10-03'}],messages:[],decisions:[],costs:[]}});
 assert.match(html,/Excluir conversa/);assert.match(html,/Conversas excluídas \(1\)/);assert.match(html,/Restaurar/);assert.match(html,/Abrir histórico/);assert.match(html,/atendimento pausado/);
});
test('configurações permitem orçamento mensal e Hermes incluído',()=>{
 const html=render('salesSettings',{sales:{settings:{budgetPeriod:'month',monthlyBudgetUsd:3,hermesIncluded:true}}});assert.match(html,/Orçamento mensal/);assert.match(html,/Hermes incluído/);assert.match(html,/value="month" selected/);assert.match(html,/0 = sem teto local/);
});
test('painel de conversas mostra controle humano, histórico e envio manual',()=>{
 const html=render('conversations',{leads:[{id:'l',name:'Contato teste'}],sales:{settings:{enabled:true},conversations:[{id:'c',leadId:'l',channel:'whatsapp',recipient:'+5511999999999',status:'pausada',control:'human',version:2}],messages:[{id:'m',conversationId:'c',direction:'inbound',body:'Olá <script>',status:'recebida'}],decisions:[],worker:{status:'ativo'}}});
 assert.match(html,/Você no controle/);assert.match(html,/Devolver à IA/);assert.match(html,/Enviar resposta/);assert.match(html,/Olá &lt;script&gt;/);assert.match(html,/Buscar conversa/);
});
test('painel permite assumir IA e mostra decisões Jev sem liberar fechamento',()=>{
 const html=render('conversations',{leads:[{id:'l',name:'Contato'}],sales:{settings:{enabled:true},conversations:[{id:'c',leadId:'l',channel:'email',status:'ativa',version:1}],messages:[],decisions:[{conversationId:'c',decision:{action:'qualificar',confidence:.8,intent:'interesse'}}]}});
 assert.match(html,/Pausar IA e assumir/);assert.match(html,/qualificar/);assert.match(html,/80%/);assert.doesNotMatch(html,/id="inbox-compose"/);
});

test('card do Hermes na aba integrações reflete status e ação no terminal',()=>{
 const htmlDesc=render('integrations',{integrations:{hermes:{connected:false}}});
 assert.match(htmlDesc,/Hermes Agent/);
 assert.match(htmlDesc,/Aguardando conexão/);
 assert.match(htmlDesc,/Clique para conectar automaticamente no terminal/);

 const htmlAtivo=render('integrations',{integrations:{hermes:{connected:true,lastRunAt:'2026-10-04T00:00:00.000Z'}}});
 assert.match(htmlAtivo,/Hermes Agent/);
 assert.match(htmlAtivo,/Ativo/);
 assert.match(htmlAtivo,/Clique para verificar ou reconectar no terminal/);
});

