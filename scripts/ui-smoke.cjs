const { chromium } = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright') : require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const dir=fs.mkdtempSync('/tmp/crm-ui-');
const root=require('node:path').resolve(__dirname,'..');
const admin='ui-test-admin-1234567890123456789';
(async()=>{
 let server,browser;
 try {
 server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'3089',CRM_DATA_DIR:dir,CRM_ADMIN_TOKEN:admin,CRM_AGENT_TOKEN:'ui-test-agent-1234567890123456789'},stdio:['ignore','pipe','pipe']});
 await new Promise((res,rej)=>{server.stdout.once('data',res);server.once('error',rej);server.once('exit',c=>rej(Error('Server exit '+c)));});
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3089');await page.getByLabel('Token de administrador').fill(admin);await page.getByRole('button',{name:'Entrar no CRM'}).click();await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
 await page.locator('[data-page="leads"]').click();await page.getByRole('button',{name:'Novo lead',exact:true}).click();await page.getByLabel('Empresa',{exact:true}).fill('Empresa de teste UI');await page.getByLabel('E-mail profissional').fill('teste@example.com');await page.getByRole('button',{name:'Salvar lead'}).click();await page.getByText('Empresa de teste UI',{exact:true}).waitFor();
 await page.locator('[data-page="campaigns"]').click();await page.getByRole('button',{name:'Nova campanha'}).click();await page.getByLabel('Nome da campanha').fill('Teste de revisão');await page.getByLabel('Assunto',{exact:true}).fill('Uma ideia para sua empresa');await page.getByLabel('Mensagem',{exact:true}).fill('Mensagem de teste local.');await page.locator('input[name="leadIds"]').check();await page.getByRole('button',{name:'Salvar rascunho'}).click();await page.getByRole('button',{name:'Abrir',exact:true}).click();await page.getByRole('button',{name:'Submeter versão salva'}).click();await page.locator('[data-page="approvals"]').click();await page.getByRole('button',{name:'Aprovar esta versão'}).click();await page.getByRole('heading',{name:'Nenhuma aprovação pendente'}).waitFor();
 await page.locator('[data-page="prospecting"]').click();await page.getByRole('button',{name:'Academias',exact:true}).click();await page.getByRole('button',{name:'Criar pesquisa'}).click();await page.getByText('Aguardando Hermes',{exact:true}).waitFor();
 await page.screenshot({path:root+'/docs/preview-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:root+'/docs/preview-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);if(overflow)throw Error('Overflow mobile');if(errors.length)throw Error(errors.join('\n'));
 console.log('UI OK: login, lead, campanha, aprovação, pesquisa e mobile sem overflow.');
 }finally{if(browser)await browser.close();if(server){server.kill('SIGTERM');}fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
