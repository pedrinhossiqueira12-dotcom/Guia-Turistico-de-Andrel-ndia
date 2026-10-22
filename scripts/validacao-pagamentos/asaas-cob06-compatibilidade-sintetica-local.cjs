'use strict';
// Somente stack nova e dados sinteticos. Sem pull, backups privados ou remocao.
const {spawnSync}=require('node:child_process');
const {randomBytes,createHmac}=require('node:crypto');
const fs=require('node:fs');
if(process.argv[2]!=='--execute-synthetic')throw Error('Exige --execute-synthetic');
const images={pg:'sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53',auth:'sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b',storage:'sha256:1f6c99d3952d78d57129802aa2ae8a80d75e327492cf24742fd0aeaf90967b96',rest:'sha256:c7cd7e265a85b05248abf53f4473fcec7e327c282d0bd0cf60f1551996d09fcf'};
const tag='cob06-compat-'+new Date().toISOString().replace(/[-:TZ.]/g,'')+'-'+randomBytes(3).toString('hex');
const report={tag,images,resources:[],volumes:[],checks:[],errors:[],limits:[]};
const secret=randomBytes(40).toString('hex'),password=randomBytes(24).toString('hex');
const created=[];
const reportPath='.'+tag+'-report.json';
function docker(args,input,binary=false){
 const p=spawnSync('docker',['--context','desktop-linux',...args],{input,encoding:binary?null:'utf8',timeout:90000,maxBuffer:32*1024*1024});
 if(p.status!==0)throw Error('DOCKER_FAILED:'+args[0]+':'+(p.status??'timeout'));
 return binary?p.stdout:p.stdout.trim();
}
const json=args=>JSON.parse(docker(args));
const inspect=n=>json(['inspect',n])[0];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function save(){fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');}
function check(ok,name){report.checks.push({name,ok:!!ok});save();if(!ok)throw Error('CHECK_FAILED:'+name);}
function volume(kind){const name=tag+'-'+kind;if(docker(['volume','ls','--filter','name=^'+name+'$','--format','{{.Name}}']))throw Error('VOLUME_COLLISION');docker(['volume','create','--label','guia.cob06.compat='+tag,name]);report.volumes.push(name);save();return name;}
function create(kind,network,extra,command){
 const name=tag+'-'+kind;
 const id=docker(['create','--pull=never','--name',name,'--label','guia.cob06.compat='+tag,'--network',network,'--restart=no','--cap-drop=ALL','--security-opt=no-new-privileges:true','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=67108864',...['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'].flatMap(k=>['-e',k+'=']),'-e','NO_PROXY=127.0.0.1,localhost',...extra,...command]);
 created.push(name);
 const x=inspect(name),expected=network.startsWith('container:')?'container:'+inspect(network.slice(10)).Id:network;
 report.resources.push({kind,name,id,network:x.HostConfig.NetworkMode,image:x.Image,mounts:x.Mounts.map(m=>({type:m.Type,name:m.Name,destination:m.Destination,rw:m.RW}))});
 check(x.HostConfig.NetworkMode===expected&&!x.HostConfig.Privileged&&x.HostConfig.RestartPolicy.Name==='no'&&Object.keys(x.HostConfig.PortBindings||{}).length===0&&x.HostConfig.ReadonlyRootfs&&x.HostConfig.CapDrop.includes('ALL')&&x.HostConfig.SecurityOpt.includes('no-new-privileges:true')&&x.Mounts.every(m=>m.Type==='volume'&&report.volumes.includes(m.Name)),'docker_isolation_'+kind);
 docker(['start',name]);return name;
}
const env=o=>Object.entries(o).flatMap(([k,v])=>['-e',k+'='+v]);
function psql(pg,sql,db='postgres'){return docker(['exec','-i',pg,'psql','-X','-h','127.0.0.1','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-At'],sql);}
function probe(helper,source){return JSON.parse(docker(['exec','-i',helper,'node','-'],source));}
async function health(helper,port,path='/health'){
 for(let i=0;i<40;i++){try{if(probe(helper,`fetch('http://127.0.0.1:${port}${path}').then(r=>console.log(JSON.stringify(r.ok))).catch(()=>process.exit(1));`))return true;}catch{}await pause(500);}return false;
}
function jwt(role){const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const data=b({alg:'HS256',typ:'JWT'})+'.'+b({role,aud:'authenticated',iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600});return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');}
async function main(){
 for(const [kind,id]of Object.entries(images))check(json(['image','inspect',id])[0].Id===id,'pinned_image_'+kind);
 const pgvol=volume('pgdata'),files=volume('files');
 const pg=create('pg','none',['--user','postgres','--mount','type=volume,source='+pgvol+',target=/var/lib/postgresql/data','--entrypoint','/bin/sh'],[images.pg,'-ec','initdb -D /var/lib/postgresql/data/pgdata -U postgres --auth-local=trust --auth-host=trust --encoding=UTF8 --locale=C >/tmp/init.log; exec postgres -D /var/lib/postgresql/data/pgdata -c shared_preload_libraries= -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c log_statement=none']);
 let ready=false;for(let i=0;i<40;i++){try{psql(pg,'SELECT 1');ready=true;break;}catch{}await pause(500);}check(ready,'pg_bootstrap');
 psql(pg,`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD '${password}'; GRANT anon,authenticated,service_role TO authenticator;
 CREATE ROLE supabase_auth_admin LOGIN PASSWORD '${password}'; CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin; ALTER ROLE supabase_auth_admin SET search_path=auth,public; GRANT ALL ON DATABASE postgres TO supabase_auth_admin;
 CREATE ROLE supabase_storage_admin LOGIN NOINHERIT PASSWORD '${password}'; CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin; GRANT anon,authenticated,service_role TO supabase_storage_admin;
 CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
 GRANT USAGE ON SCHEMA auth,extensions TO anon,authenticated,service_role,supabase_storage_admin;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;`);
 psql(pg,`
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
 ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin; ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin; ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;
 ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage GRANT ALL ON TABLES TO anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;`);
 const helper=create('probe','container:'+pg,['--user','node','--entrypoint','node'],[images.storage,'-e','process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000)']);
 const net=probe(helper,`const fs=require('fs'),os=require('os');const n=os.networkInterfaces(),v4=fs.readFileSync('/proc/net/route','utf8').trim().split('\\n').slice(1).filter(Boolean),v6=fs.readFileSync('/proc/net/ipv6_route','utf8').trim().split('\\n').filter(Boolean);console.log(JSON.stringify({interfaces:n,ipv4_routes:v4,ipv6_routes:v6,ok:Object.keys(n).every(k=>k==='lo')&&Object.values(n).flat().every(a=>a.internal)&&v4.length===0&&v6.every(l=>l.trim().split(/\\s+/).at(-1)==='lo')}));`);
 report.network=net;check(net.ok,'new_namespace_no_egress_ipv4_ipv6');
 create('auth','container:'+pg,env({GOTRUE_API_HOST:'127.0.0.1',GOTRUE_API_PORT:'9999',API_EXTERNAL_URL:'http://127.0.0.1:9999',GOTRUE_SITE_URL:'http://127.0.0.1:9999',GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:`postgres://supabase_auth_admin:${password}@127.0.0.1:5432/postgres?sslmode=disable`,GOTRUE_DB_NAMESPACE:'auth',GOTRUE_JWT_SECRET:secret,GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_EXP:'3600',GOTRUE_DISABLE_SIGNUP:'false',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_EXTERNAL_PHONE_ENABLED:'false',GOTRUE_MAILER_AUTOCONFIRM:'true',GOTRUE_LOG_LEVEL:'error'}),[images.auth]);
 check(await health(helper,9999),'auth_managed_schema_migrations');
 psql(pg,`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$; CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;`);
 psql(pg,`CREATE SCHEMA api; GRANT USAGE ON SCHEMA api TO anon,authenticated; CREATE TABLE api.private_notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES auth.users(id),note text NOT NULL); ALTER TABLE api.private_notes ENABLE ROW LEVEL SECURITY; CREATE POLICY own_notes ON api.private_notes TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid()); GRANT SELECT,INSERT,UPDATE,DELETE ON api.private_notes TO authenticated; GRANT SELECT ON api.private_notes TO anon; CREATE FUNCTION api.whoami() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$; GRANT EXECUTE ON FUNCTION api.whoami() TO anon,authenticated;`);
 create('rest','container:'+pg,env({PGRST_DB_URI:`postgres://authenticator:${password}@127.0.0.1:5432/postgres`,PGRST_DB_SCHEMAS:'api',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_JWT_AUD:'authenticated',PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3000',PGRST_DB_CONFIG:'false'}),[images.rest]);
 check(await health(helper,3000,'/'),'postgrest_ready');
 const authRest=probe(helper,`(async()=>{
 const fs=require('fs'),pw='Synthetic-Only-COB06!37';const req=async(url,method='GET',body,token)=>{const r=await fetch(url,{method,headers:{'Content-Type':'application/json',Prefer:'return=representation',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)}};
 const users=[];for(const n of ['a','b']){await req('http://127.0.0.1:9999/signup','POST',{email:'compat-'+n+'@example.invalid',password:pw});const r=await req('http://127.0.0.1:9999/token?grant_type=password','POST',{email:'compat-'+n+'@example.invalid',password:pw});if(r.status!==200)throw Error('login');users.push({id:r.body.user.id,token:r.body.access_token})}fs.writeFileSync('/tmp/users.json',JSON.stringify(users));
 const [a,b]=users,base='http://127.0.0.1:3000',r={};for(const [n,u]of [['a',a],['b',b]]){const x=await req(base+'/private_notes','POST',{owner_id:u.id,note:'synthetic-'+n},u.token);r['own_insert_'+n]=x.status===201;r['role_'+n]=(await req(base+'/rpc/whoami','POST',{},u.token)).body==='authenticated'}
 const cross=await req(base+'/private_notes?owner_id=eq.'+b.id,'GET',null,a.token);r.cross_read=cross.status===200&&cross.body.length===0;
 const patch=await req(base+'/private_notes?owner_id=eq.'+b.id,'PATCH',{note:'forbidden'},a.token);r.cross_update=patch.status===200&&patch.body.length===0;
 r.cross_insert=(await req(base+'/private_notes','POST',{owner_id:b.id,note:'forbidden'},a.token)).status===403;
 const own=await req(base+'/private_notes','GET',null,b.token);r.b_unchanged=own.status===200&&own.body.length===1&&own.body[0].note==='synthetic-b';
 const anon=await req(base+'/private_notes');r.anon_read=anon.status===200&&anon.body.length===0;r.anon_write=[401,403].includes((await req(base+'/private_notes','POST',{owner_id:a.id,note:'forbidden'})).status);r.anon_role=(await req(base+'/rpc/whoami','POST',{})).body==='anon';
 const tok=a.token.split('.');tok[2]=(tok[2][0]==='a'?'b':'a')+tok[2].slice(1);r.invalid_signature=(await req(base+'/private_notes','GET',null,tok.join('.'))).status===401;
 console.log(JSON.stringify(r));})().catch(()=>process.exit(1));`);
 report.auth_rest=authRest;for(const [name,ok]of Object.entries(authRest))check(ok,'auth_rest_'+name);
 const storageEnv={SERVER_HOST:'127.0.0.1',SERVER_PORT:'5000',SERVER_ADMIN_PORT:'5001',AUTH_JWT_SECRET:secret,ANON_KEY:jwt('anon'),SERVICE_KEY:jwt('service_role'),DATABASE_URL:`postgres://supabase_storage_admin:${password}@127.0.0.1:5432/postgres?sslmode=disable`,DATABASE_SEARCH_PATH:'storage,extensions,public',DB_INSTALL_ROLES:'false',STORAGE_BACKEND:'file',FILE_STORAGE_BACKEND_PATH:'/var/lib/storage',TENANT_ID:tag,POSTGREST_URL:'http://127.0.0.1:3000',PG_QUEUE_ENABLE:'false',PG_QUEUE_WORKERS_ENABLE:'false',IMAGE_TRANSFORMATION_ENABLED:'false',S3_PROTOCOL_ENABLED:'false',STORAGE_LIFECYCLE_ENABLED:'false',TRACING_ENABLED:'false',OTEL_METRICS_ENABLED:'false',LOGFLARE_ENABLED:'false'};
 create('storage','container:'+pg,['--mount','type=volume,source='+files+',target=/var/lib/storage',...env(storageEnv)],[images.storage]);
 check(await health(helper,5000,'/status'),'storage_managed_schema_migrations');
 psql(pg,`GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role; GRANT SELECT ON storage.buckets TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated; CREATE POLICY synthetic_objects ON storage.objects TO authenticated USING(bucket_id='cob06-private' AND split_part(name,'/',1)=auth.uid()::text) WITH CHECK(bucket_id='cob06-private' AND split_part(name,'/',1)=auth.uid()::text); CREATE POLICY synthetic_bucket ON storage.buckets FOR SELECT TO authenticated USING(id='cob06-private');`);
 const storageTest=probe(helper,`(async()=>{const fs=require('fs'),[a,b]=JSON.parse(fs.readFileSync('/tmp/users.json'));const base='http://127.0.0.1:5000',service=${JSON.stringify(storageEnv.SERVICE_KEY)};const req=async(path,method='GET',token,body,json=false)=>{const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':json?'application/json':'text/plain'},body:body?(json?JSON.stringify(body):body):undefined});return {status:r.status,text:await r.text()}};
 const r={};r.private_bucket=(await req('/bucket','POST',service,{id:'cob06-private',name:'cob06-private',public:false},true)).status===200;
 for(const [n,u]of [['a',a],['b',b]]){r['upload_'+n]=(await req('/object/cob06-private/'+u.id+'/hello.txt','POST',u.token,'synthetic-file-'+n)).status===200;r['read_'+n]=(await req('/object/authenticated/cob06-private/'+u.id+'/hello.txt','GET',u.token)).text==='synthetic-file-'+n}
 r.cross_read=[400,401,403,404].includes((await req('/object/authenticated/cob06-private/'+a.id+'/hello.txt','GET',b.token)).status);r.cross_write=[400,401,403,404].includes((await req('/object/cob06-private/'+a.id+'/intrusion.txt','POST',b.token,'forbidden')).status);r.anon_private=[400,401,403,404].includes((await req('/object/public/cob06-private/'+a.id+'/hello.txt')).status);console.log(JSON.stringify(r));})().catch(()=>process.exit(1));`);
 report.storage=storageTest;for(const [name,ok]of Object.entries(storageTest))check(ok,'storage_'+name);
 check(psql(pg,"SELECT count(*) FROM storage.objects WHERE bucket_id='cob06-private'")==='2','storage_two_metadata_rows');
 // Restore somente do banco que este processo acabou de criar, em outra DB nova.
 const dump=docker(['exec',pg,'pg_dump','-h','127.0.0.1','-U','postgres','-d','postgres','-Fc'],undefined,true);
 psql(pg,'CREATE DATABASE synthetic_recovered');
 docker(['exec','-i',pg,'pg_restore','-h','127.0.0.1','-U','postgres','-d','synthetic_recovered','--exit-on-error'],dump);
 check(psql(pg,"SELECT count(*) FROM storage.objects WHERE bucket_id='cob06-private'",'synthetic_recovered')==='2','synthetic_restore_metadata');
 check(psql(pg,"SELECT count(*) FROM auth.users",'synthetic_recovered')==='2','synthetic_restore_auth');
 check(psql(pg,"SELECT relrowsecurity FROM pg_class WHERE oid='api.private_notes'::regclass",'synthetic_recovered')==='t','synthetic_restore_rls');
 const recovered=volume('files-recovered');
 const copy=create('file-copy','container:'+pg,['--mount','type=volume,source='+files+',target=/source,readonly','--mount','type=volume,source='+recovered+',target=/target','--entrypoint','node'],[images.storage,'-e',"require('fs').cpSync('/source','/target',{recursive:true});"]);
 for(let i=0;i<40&&inspect(copy).State.Running;i++)await pause(100);
 check(inspect(copy).State.ExitCode===0,'synthetic_file_copy');
 create('storage-recovered','container:'+pg,['--mount','type=volume,source='+recovered+',target=/var/lib/storage',...env({...storageEnv,SERVER_PORT:'5002',SERVER_ADMIN_PORT:'5003',DATABASE_URL:storageEnv.DATABASE_URL.replace('/postgres?','/synthetic_recovered?')})],[images.storage]);
 check(await health(helper,5002,'/status'),'recovered_storage_ready');
 const recovery=probe(helper,`(async()=>{const fs=require('fs'),[a,b]=JSON.parse(fs.readFileSync('/tmp/users.json'));const r={};for(const [n,u]of [['a',a],['b',b]]){const x=await fetch('http://127.0.0.1:5002/object/authenticated/cob06-private/'+u.id+'/hello.txt',{headers:{Authorization:'Bearer '+u.token}});r['recovered_read_'+n]=x.ok&&(await x.text())==='synthetic-file-'+n}const x=await fetch('http://127.0.0.1:5002/object/authenticated/cob06-private/'+a.id+'/hello.txt',{headers:{Authorization:'Bearer '+b.token}});r.recovered_cross_denied=[400,401,403,404].includes(x.status);console.log(JSON.stringify(r));})().catch(()=>process.exit(1));`);
 report.recovery=recovery;for(const [name,ok]of Object.entries(recovery))check(ok,name);
 check(psql(pg,"SELECT count(*) FROM pg_extension WHERE extname IN ('pg_cron','pg_net','supabase_vault')")==='0'&&psql(pg,'SHOW shared_preload_libraries')==='','no_cron_net_vault_preload');
 check(psql(pg,"SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname='authenticator') AND r.rolsuper")==='0','authenticator_no_superuser_membership');
 const listeners=probe(helper,`const fs=require('fs');const parse=p=>fs.readFileSync(p,'utf8').trim().split('\\n').slice(1).filter(Boolean).map(l=>l.trim().split(/\\s+/)).filter(x=>x[3]==='0A').map(x=>x[1]);console.log(JSON.stringify({ipv4:parse('/proc/net/tcp'),ipv6:parse('/proc/net/tcp6')}));`);report.listeners=listeners;
 check(listeners.ipv6.length===0&&listeners.ipv4.every(x=>x.startsWith('0100007F:')),'listeners_only_isolated_namespace');
 report.limits.push('Edge nao necessario para Auth/PostgREST/Storage; nao baixado ou iniciado.','Schemas/bootstrap sinteticos nao provam paridade com snapshot real.','Nenhum backup real, SQL remoto, secrets reais ou servico financeiro acessado.');
}
main().catch(e=>{report.errors.push(e.message);process.exitCode=1;}).finally(()=>{
 for(const name of [...created].reverse()){try{const x=inspect(name);if(x.Config.Labels['guia.cob06.compat']!==tag)throw Error('label');if(x.State.Running)docker(['stop','-t','5',name]);}catch{report.errors.push('STOP_FAILED:'+name);process.exitCode=1;}}
 for(const r of report.resources){try{const x=inspect(r.name);r.final_state=x.State.Status;r.exit_code=x.State.ExitCode;if(x.State.Running||x.State.Restarting||x.State.Paused)throw Error('active');}catch{report.errors.push('FINAL_STATE_FAILED:'+r.name);process.exitCode=1;}}
 save();console.log(JSON.stringify({tag,report:reportPath,passed:report.checks.filter(x=>x.ok).length,total:report.checks.length,errors:report.errors}));
});
