'use strict';
// Ensaio autorizado SOMENTE sintetico. Sem pull, backup, restore ou remocao.
// Executar uma vez com --execute-synthetic; cada execucao cria nomes novos.
const {spawnSync}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
if(process.argv[2]!=='--execute-synthetic')throw Error('Exige --execute-synthetic; nunca restaura dados.');
const images={
 pg:'sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53',
 auth:'sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b',
 probe:'sha256:1f6c99d3952d78d57129802aa2ae8a80d75e327492cf24742fd0aeaf90967b96',
 mail:'sha256:ed9b00c609e77e99c79b93f1178255ebc271868920f2c69a8d166bd5634ed10d',
};
const tag='cob06-sint-'+new Date().toISOString().replace(/[-:TZ.]/g,'')+'-'+randomBytes(3).toString('hex');
const report={tag,context:'desktop-linux',images,resources:[],checks:[],limits:[],errors:[]};
const secret=randomBytes(40).toString('hex');
const reportPath=path.resolve('.'+tag+'-report.json');
function docker(args,input){
 const p=spawnSync('docker',['--context','desktop-linux',...args],{input,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});
 if(p.status!==0)throw Error('DOCKER_COMMAND_FAILED:'+args[0]+':'+(p.status??'timeout'));
 return p.stdout.trim();
}
const json=(args)=>JSON.parse(docker(args));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const created=[];
function check(ok,name){report.checks.push({name,ok:!!ok});if(!ok)throw Error('CHECK_FAILED:'+name);}
function save(){fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');}
function inspect(name){return json(['inspect',name])[0];}
function create(kind,network,extra,command){
 const name=tag+'-'+kind;
 const args=['create','--pull=never','--name',name,'--label','guia.cob06.synthetic='+tag,
  '--network',network,'--restart=no','--cap-drop=ALL','--security-opt=no-new-privileges:true',
  '--read-only','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=67108864',
  ...['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'].flatMap(k=>['-e',k+'=']),
  '-e','NO_PROXY=127.0.0.1,localhost','-e','no_proxy=127.0.0.1,localhost',...extra,...command];
 const id=docker(args);created.push(name);
 const info=inspect(name);
 const mounts=info.Mounts.map(m=>({type:m.Type,name:m.Name,destination:m.Destination,rw:m.RW}));
 report.resources.push({kind,name,id,network:info.HostConfig.NetworkMode,mounts});save();
 const expectedNetwork=network.startsWith('container:')?'container:'+inspect(network.slice(10)).Id:network;
 check(info.HostConfig.NetworkMode===expectedNetwork,'network_'+kind);
 check(!info.HostConfig.Privileged&&info.HostConfig.RestartPolicy.Name==='no','privilege_restart_'+kind);
 check(Object.keys(info.HostConfig.PortBindings||{}).length===0,'no_host_ports_'+kind);
 check(mounts.every(m=>m.type==='volume'&&m.name===tag+'-pgdata'),'only_new_volume_'+kind);
 check(info.HostConfig.ReadonlyRootfs===true&&info.HostConfig.CapDrop.includes('ALL'),'readonly_dropcaps_'+kind);
 save();
 docker(['start',name]);return name;
}
function psql(pg,sql){return docker(['exec','-i',pg,'psql','-X','-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],sql);}
async function probe(name,source){return JSON.parse(docker(['exec','-i',name,'node','-'],source));}
async function main(){
 for(const [kind,id] of Object.entries(images))check(json(['image','inspect',id])[0].Id===id,'local_image_'+kind);
 // Volume novo; nunca usa recursos anteriores ou bind mounts.
 if(docker(['volume','ls','--filter','name=^'+tag+'-pgdata$','--format','{{.Name}}']))throw Error('VOLUME_NAME_ALREADY_EXISTS');
 const vol=docker(['volume','create','--label','guia.cob06.synthetic='+tag,tag+'-pgdata']);
 report.volume=vol;save();
 const pg=create('pg','none',['--user','postgres','--mount','type=volume,source='+vol+',target=/var/lib/postgresql/data',
  '--entrypoint','/bin/sh'],[images.pg,'-ec',
  'if [ ! -s /var/lib/postgresql/data/pgdata/PG_VERSION ]; then initdb -D /var/lib/postgresql/data/pgdata -U postgres --auth-local=trust --auth-host=trust --encoding=UTF8 --locale=C; fi; exec postgres -D /var/lib/postgresql/data/pgdata -c shared_preload_libraries= -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c log_statement=none']);
 let ready=false;
 for(let i=0;i<40;i++){try{psql(pg,'SELECT 1;');ready=true;break;}catch{await pause(500);}}
 check(ready,'postgres_ready');
 report.postgres=psql(pg,"SELECT version(); SHOW shared_preload_libraries; SELECT count(*) FROM pg_extension WHERE extname IN ('pg_cron','pg_net');");
 check(psql(pg,"SELECT count(*) FROM pg_extension WHERE extname IN ('pg_cron','pg_net');")==='0','no_cron_pgnet_extensions');
 check(psql(pg,"SELECT count(*) FROM pg_stat_activity WHERE backend_type ILIKE '%cron%' OR backend_type ILIKE '%pg_net%';")==='0','no_cron_pgnet_workers');
 check(psql(pg,'SHOW shared_preload_libraries;')==='','no_preload');
 psql(pg,"CREATE TABLE synthetic_probe(id integer PRIMARY KEY, note text NOT NULL); INSERT INTO synthetic_probe VALUES(1,'somente-ficticio');");
 check(psql(pg,'SELECT count(*) FROM synthetic_probe;')==='1','synthetic_sql_roundtrip');
 const helper=create('probe','container:'+pg,['--user','node','--entrypoint','node'],[images.probe,'-e','process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000)']);
 const net=await probe(helper,`const fs=require('fs'),os=require('os');
 const interfaces=os.networkInterfaces();const v4=fs.readFileSync('/proc/net/route','utf8').trim().split('\\n').slice(1).filter(Boolean);
 const v6=fs.readFileSync('/proc/net/ipv6_route','utf8').trim().split('\\n').filter(Boolean);
 const all6loopback=v6.every(l=>l.trim().split(/\\s+/).at(-1)==='lo');
 const conn=()=>new Promise((resolve,reject)=>{const s=require('net').connect({host:'127.0.0.1',port:5432},()=>{s.end();resolve(true)});s.on('error',reject)});
 conn().then(internal=>console.log(JSON.stringify({interfaces,ipv4_routes:v4,ipv6_routes:v6,only_loopback:Object.keys(interfaces).every(n=>n==='lo'),all_addresses_internal:Object.values(interfaces).flat().every(x=>x.internal),no_ipv4_routes:v4.length===0,ipv6_only_loopback:all6loopback,postgres_tcp:internal}))).catch(()=>process.exit(1));`);
 report.network=net;
 check(net.only_loopback&&net.all_addresses_internal&&net.no_ipv4_routes&&net.ipv6_only_loopback,'namespace_has_no_external_interface_or_route');
 check(net.postgres_tcp,'shared_namespace_postgres_tcp');
 const mail=create('mail','container:'+pg,[],[images.mail,'--listen','127.0.0.1:8025','--smtp','127.0.0.1:1025','--disable-version-check']);
 await pause(1000);
 const mailCheck=await probe(helper,`fetch('http://127.0.0.1:8025/api/v1/info').then(async r=>console.log(JSON.stringify({ok:r.ok,status:r.status}))).catch(()=>process.exit(1));`);
 report.mail=mailCheck;check(mailCheck.ok,'mailpit_http_internal');
 // GoTrue faz suas migrations somente neste banco sintético novo.
 psql(pg,"CREATE ROLE supabase_auth_admin LOGIN PASSWORD 'synthetic-only-local'; CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin; ALTER ROLE supabase_auth_admin SET search_path=auth,public; GRANT ALL ON DATABASE postgres TO supabase_auth_admin;");
 const authEnv={GOTRUE_API_HOST:'127.0.0.1',GOTRUE_API_PORT:'9999',API_EXTERNAL_URL:'http://127.0.0.1:9999',
  GOTRUE_SITE_URL:'http://127.0.0.1:9999',GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:'postgres://supabase_auth_admin:synthetic-only-local@127.0.0.1:5432/postgres?sslmode=disable',
  GOTRUE_DB_NAMESPACE:'auth',GOTRUE_JWT_SECRET:secret,GOTRUE_JWT_EXP:'3600',GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',
  GOTRUE_DISABLE_SIGNUP:'false',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_EXTERNAL_PHONE_ENABLED:'false',GOTRUE_MAILER_AUTOCONFIRM:'true',
  GOTRUE_SMTP_HOST:'127.0.0.1',GOTRUE_SMTP_PORT:'1025',GOTRUE_SMTP_ADMIN_EMAIL:'no-reply@synthetic.invalid',GOTRUE_SMTP_SENDER_NAME:'Synthetic COB06',
  GOTRUE_LOG_LEVEL:'error'};
 const auth=create('auth','container:'+pg,Object.entries(authEnv).flatMap(([k,v])=>['-e',k+'='+v]),[images.auth]);
 let authReady=false;
 for(let i=0;i<30;i++){try{const h=await probe(helper,`fetch('http://127.0.0.1:9999/health').then(r=>console.log(JSON.stringify({ok:r.ok,status:r.status}))).catch(()=>process.exit(1));`);if(h.ok){authReady=true;break;}}catch{}await pause(500);}
 if(!authReady){report.limits.push('GoTrue nao ficou saudavel; nenhuma conta criada.');return;}
 check(authReady,'gotrue_health');
 const authTest=await probe(helper,`(async()=>{
 const base='http://127.0.0.1:9999';const password='Synthetic-Only-COB06!37';
 const req=async(p,b,t)=>{const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:JSON.stringify(b)});return {status:r.status,ok:r.ok,body:await r.json().catch(()=>({}))}};
 const a=await req('/signup',{email:'synthetic-a@example.invalid',password});
 const b=await req('/signup',{email:'synthetic-b@example.invalid',password});
 const login=await req('/token?grant_type=password',{email:'synthetic-a@example.invalid',password});
 const refresh=login.ok?await req('/token?grant_type=refresh_token',{refresh_token:login.body.refresh_token}):{ok:false,status:0,body:{}};
 let jwt=false;if(login.body.access_token){const claims=JSON.parse(Buffer.from(login.body.access_token.split('.')[1],'base64url'));jwt=claims.role==='authenticated'&&claims.aud==='authenticated';}
 const logout=refresh.ok?await req('/logout',{},refresh.body.access_token):{ok:false,status:0};
 console.log(JSON.stringify({signup_a:a.status,signup_b:b.status,distinct_users:!!a.body.user?.id&&!!b.body.user?.id&&a.body.user.id!==b.body.user.id,login:login.status,refresh:refresh.status,logout:logout.status,jwt_local_claims:jwt,ok:a.ok&&b.ok&&login.ok&&refresh.ok&&logout.ok&&jwt}));
 })().catch(()=>process.exit(1));`);
 report.auth=authTest;check(authTest.ok&&authTest.distinct_users,'gotrue_two_synthetic_users_login_refresh_logout');
 const listeners=await probe(helper,`const fs=require('fs');const lines=p=>fs.readFileSync(p,'utf8').trim().split('\\n').slice(1).filter(Boolean).map(l=>l.trim().split(/\\s+/)).filter(p=>p[3]==='0A').map(p=>p[1]);const v4=lines('/proc/net/tcp'),v6=lines('/proc/net/tcp6');console.log(JSON.stringify({ipv4:v4,ipv6:v6,ok:v4.every(x=>x.startsWith('0100007F:'))&&v6.length===0}));`);
 report.listeners=listeners;check(listeners.ok,'all_service_listeners_loopback_only');
 report.limits.push('Storage API nao iniciada: imagem PostgREST ausente; sem downloads.');
 report.limits.push('Runtime Edge ausente; nenhum teste Edge ou webhook. Sem restore e sem prova de paridade com PROD.');
}
main().catch(e=>{report.errors.push(e.message);process.exitCode=1;}).finally(()=>{
 // Somente parar os contêineres criados nesta execucao; nao remover nada.
 for(const name of created.reverse()){try{const r=inspect(name);if(r.Config.Labels['guia.cob06.synthetic']!==tag)throw Error('LABEL');if(r.State.Running)docker(['stop','-t','5',name]);}catch{report.errors.push('STOP_FAILED:'+name);process.exitCode=1;}}
 for(const r of report.resources){try{const x=inspect(r.name);r.final_state=x.State.Status;r.final_network=x.HostConfig.NetworkMode;}catch{}}
 save();console.log(JSON.stringify({tag,report:path.basename(reportPath),checks:report.checks,errors:report.errors,limits:report.limits}));
});
