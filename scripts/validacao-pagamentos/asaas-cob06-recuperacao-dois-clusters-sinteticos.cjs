'use strict';
// Escopo exclusivo: dois clusters NOVOS, sem rede, dados exclusivamente ficticios.
// Nao aceita arquivos SQL, nomes de recursos existentes nem caminhos de backup.
const {spawnSync}=require('node:child_process');
const {randomBytes,createHmac}=require('node:crypto');
const fs=require('node:fs');
if(process.argv.length!==3||process.argv[2]!=='--execute-synthetic')throw Error('Exige somente --execute-synthetic');
const images={
 pg:'sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53',
 auth:'sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b',
 storage:'sha256:1f6c99d3952d78d57129802aa2ae8a80d75e327492cf24742fd0aeaf90967b96',
 rest:'sha256:c7cd7e265a85b05248abf53f4473fcec7e327c282d0bd0cf60f1551996d09fcf',
};
const tag='cob06-2pg-'+new Date().toISOString().replace(/[-:TZ.]/g,'')+'-'+randomBytes(3).toString('hex');
const label='guia.cob06.two-clusters';
const report={tag,images,resources:[],volumes:[],checks:[],errors:[],limits:[]};
const reportPath='.'+tag+'-report.json';
const created=[];
const secret=randomBytes(40).toString('hex');
const passwords={source:randomBytes(24).toString('hex'),target:randomBytes(24).toString('hex')};
const roles=['anon','authenticated','service_role','authenticator','supabase_auth_admin','supabase_storage_admin','fixture_owner','fixture_reader'];
const roleList=roles.map(r=>"'"+r+"'").join(',');
function docker(args,input,binary=false){
 const p=spawnSync('docker',['--context','desktop-linux',...args],{input,encoding:binary?null:'utf8',timeout:90000,maxBuffer:32*1024*1024});
 // stderr nunca e impresso: pode conter DSNs ou SQL. Erros sao codificados.
 if(p.status!==0)throw Error('DOCKER_FAILED:'+args[0]+':'+(p.status??'timeout'));
 return binary?p.stdout:p.stdout.trim();
}
const json=args=>JSON.parse(docker(args));
const inspect=n=>json(['inspect',n])[0];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const env=o=>Object.entries(o).flatMap(([k,v])=>['-e',k+'='+v]);
const qi=s=>'"'+s.replaceAll('"','""')+'"';
const ql=s=>"'"+s.replaceAll("'","''")+"'";
function save(){fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');}
function check(ok,name){report.checks.push({name,ok:!!ok});save();if(!ok)throw Error('CHECK_FAILED:'+name);}
function snapshot(){
 const ids=docker(['ps','-aq','--no-trunc']).split('\n').filter(Boolean);
 const containers=ids.map(id=>JSON.parse(docker(['inspect','--format','{"id":{{json .Id}},"image":{{json .Image}},"state":{{json .State.Status}},"network":{{json .HostConfig.NetworkMode}},"mounts":{{json .Mounts}}}',id])));
 const volumes=docker(['volume','ls','--format','{{.Name}}']).split('\n').filter(Boolean).sort();
 return {containers,volumes};
}
function volume(kind){
 const name=tag+'-'+kind;
 if(docker(['volume','ls','--filter','name=^'+name+'$','--format','{{.Name}}']))throw Error('VOLUME_COLLISION');
 docker(['volume','create','--label',label+'='+tag,name]);report.volumes.push(name);save();return name;
}
function create(kind,network,extra,command){
 const name=tag+'-'+kind;
 const id=docker(['create','--pull=never','--name',name,'--label',label+'='+tag,'--network',network,'--restart=no','--cap-drop=ALL','--security-opt=no-new-privileges:true','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=67108864',...env({HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',http_proxy:'',https_proxy:'',all_proxy:'',NO_PROXY:'127.0.0.1,localhost'}),...extra,...command]);
 created.push(name);
 const x=inspect(name),expected=network.startsWith('container:')?'container:'+inspect(network.slice(10)).Id:network;
 report.resources.push({kind,name,id,image:x.Image,network:x.HostConfig.NetworkMode,mounts:x.Mounts.map(m=>({type:m.Type,name:m.Name,destination:m.Destination,rw:m.RW}))});
 check(x.HostConfig.NetworkMode===expected&&!x.HostConfig.Privileged&&x.HostConfig.RestartPolicy.Name==='no'&&Object.keys(x.HostConfig.PortBindings||{}).length===0&&x.HostConfig.ReadonlyRootfs&&x.HostConfig.CapDrop.includes('ALL')&&x.HostConfig.SecurityOpt.includes('no-new-privileges:true')&&x.Mounts.every(m=>m.Type==='volume'&&report.volumes.includes(m.Name)),'isolation_'+kind);
 docker(['start',name]);return name;
}
function own(name){if(!created.includes(name)||inspect(name).Config.Labels[label]!==tag)throw Error('NOT_NEW_RESOURCE');}
function stop(name){own(name);if(inspect(name).State.Running)docker(['stop','-t','5',name]);}
function start(name){own(name);docker(['start',name]);}
function sql(pg,source){own(pg);return docker(['exec','-i',pg,'psql','-X','-h','/tmp','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],source);}
function probe(storage,source){own(storage);return JSON.parse(docker(['exec','-i',storage,'node','-'],source));}
async function waitSql(pg,query,expected){for(let i=0;i<40;i++){try{if(sql(pg,query)===expected)return true;}catch{}await pause(500);}return false;}
async function health(storage,port,path){for(let i=0;i<40;i++){try{if(probe(storage,`fetch('http://127.0.0.1:${port}${path}').then(r=>console.log(JSON.stringify(r.ok))).catch(()=>process.exit(1));`))return true;}catch{}await pause(500);}return false;}
function jwt(role){const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const data=b({alg:'HS256',typ:'JWT'})+'.'+b({role,aud:'authenticated',iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600});return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');}
async function postgres(kind){
 const pgdata=volume(kind+'-pgdata');
 const pg=create(kind+'-pg','none',['--user','postgres','--mount','type=volume,source='+pgdata+',target=/var/lib/postgresql/data','--entrypoint','/bin/sh'],[images.pg,'-ec','if [ ! -s /var/lib/postgresql/data/pgdata/PG_VERSION ]; then initdb -D /var/lib/postgresql/data/pgdata -U postgres --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --locale=C >/tmp/init.log; fi; exec postgres -D /var/lib/postgresql/data/pgdata -c shared_preload_libraries= -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c log_statement=none']);
 // Superuser local usa somente socket; TCP de aplicacao exige senha sintetica.
 // psql e pg_dump abaixo usam socket explicito, nunca alvo remoto.
 check(await waitSql(pg,'SELECT 1','1'),'bootstrap_'+kind);
 return {kind,pg,pgdata,password:passwords[kind]};
}
function schemaBootstrap(c){
 sql(c.pg,`CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin; ALTER ROLE supabase_auth_admin SET search_path=auth,public; GRANT ALL ON DATABASE postgres TO supabase_auth_admin;
 CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin; CREATE SCHEMA extensions;
 CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
 GRANT USAGE ON SCHEMA auth,extensions TO anon,authenticated,service_role,supabase_storage_admin;
 SET ROLE supabase_auth_admin;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
 RESET ROLE;
 ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage GRANT ALL ON TABLES TO anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;`);
}
function authConfig(c){return {GOTRUE_API_HOST:'127.0.0.1',GOTRUE_API_PORT:'9999',API_EXTERNAL_URL:'http://127.0.0.1:9999',GOTRUE_SITE_URL:'http://127.0.0.1:9999',GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:`postgres://supabase_auth_admin:${c.password}@127.0.0.1:5432/postgres?sslmode=disable`,GOTRUE_DB_NAMESPACE:'auth',GOTRUE_JWT_SECRET:secret,GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_EXP:'3600',GOTRUE_DISABLE_SIGNUP:'false',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_EXTERNAL_PHONE_ENABLED:'false',GOTRUE_MAILER_AUTOCONFIRM:'true',GOTRUE_LOG_LEVEL:'error'};}
function storageConfig(c){return {SERVER_HOST:'127.0.0.1',SERVER_PORT:'5000',SERVER_ADMIN_PORT:'5001',AUTH_JWT_SECRET:secret,ANON_KEY:jwt('anon'),SERVICE_KEY:jwt('service_role'),DATABASE_URL:`postgres://supabase_storage_admin:${c.password}@127.0.0.1:5432/postgres?sslmode=disable`,DATABASE_SEARCH_PATH:'storage,extensions,public',DB_INSTALL_ROLES:'false',STORAGE_BACKEND:'file',FILE_STORAGE_BACKEND_PATH:'/var/lib/storage',TENANT_ID:tag,PG_QUEUE_ENABLE:'false',PG_QUEUE_WORKERS_ENABLE:'false',IMAGE_TRANSFORMATION_ENABLED:'false',S3_PROTOCOL_ENABLED:'false',STORAGE_LIFECYCLE_ENABLED:'false',TRACING_ENABLED:'false',OTEL_METRICS_ENABLED:'false',LOGFLARE_ENABLED:'false'};}
async function managed(c){
 schemaBootstrap(c);
 c.auth=create(c.kind+'-auth','container:'+c.pg,env(authConfig(c)),[images.auth]);
 check(await waitSql(c.pg,"SELECT count(*)>0 FROM auth.schema_migrations",'t'),'auth_schema_'+c.kind);
 // GoTrue cria helpers legados: adaptar somente o fixture para claims JSON atuais.
 sql(c.pg,`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$; CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;`);
 c.files=volume(c.kind+'-files');
 c.storage=create(c.kind+'-storage','container:'+c.pg,['--mount','type=volume,source='+c.files+',target=/var/lib/storage',...env(storageConfig(c))],[images.storage]);
 check(await health(c.storage,5000,'/status')&&await health(c.storage,9999,'/health'),'managed_services_'+c.kind);
 // O dump seletivo de api nao exporta ACL de objetos externos em auth.
 // Reconstruir esses grants antes da importacao e conferir no catalogo completo.
 sql(c.pg,'GRANT USAGE ON SCHEMA auth TO fixture_owner; GRANT REFERENCES ON auth.users TO fixture_owner;');
}
function roleProfile(c){return sql(c.pg,`SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM (SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolconfig FROM pg_roles WHERE rolname IN (${roleList}))r;`);}
function membershipProfile(c){return sql(c.pg,`SELECT jsonb_agg(to_jsonb(r) ORDER BY role_name,member_name) FROM (SELECT a.rolname role_name,b.rolname member_name,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles a ON a.oid=m.roleid JOIN pg_roles b ON b.oid=m.member WHERE a.rolname IN (${roleList}) AND b.rolname IN (${roleList}))r;`);}
function fixtureStoragePolicy(c){sql(c.pg,`GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role; GRANT SELECT ON storage.buckets TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated; CREATE POLICY restored_objects ON storage.objects TO authenticated USING(bucket_id='two-clusters-private' AND split_part(name,'/',1)=auth.uid()::text) WITH CHECK(bucket_id='two-clusters-private' AND split_part(name,'/',1)=auth.uid()::text); CREATE POLICY restored_bucket ON storage.buckets FOR SELECT TO authenticated USING(id='two-clusters-private');`);}
function catalogProfile(c){
 const queries={
  schemas:"SELECT nspname name,pg_get_userbyid(nspowner) owner,nspacl::text acl FROM pg_namespace WHERE nspname IN ('auth','storage','api') ORDER BY 1",
  relations:"SELECT n.nspname schema,c.relname name,c.relkind kind,pg_get_userbyid(c.relowner) owner,c.relacl::text acl,c.relrowsecurity rls,c.relforcerowsecurity force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('auth','storage','api') ORDER BY 1,2",
  functions:"SELECT n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) args,pg_get_userbyid(p.proowner) owner,CASE WHEN p.proacl IS NULL THEN NULL ELSE ARRAY(SELECT e::text FROM unnest(p.proacl) e ORDER BY e::text) END acl,p.prosecdef definer,p.proconfig config,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('auth','storage','api') AND p.prokind='f' ORDER BY 1,2,3",
  policies:"SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname IN ('auth','storage','api') ORDER BY 1,2,3",
  constraints:"SELECT n.nspname schema,c.relname name,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('auth','storage','api') ORDER BY 1,2,3",
  defaults:"SELECT pg_get_userbyid(d.defaclrole) owner,n.nspname schema,d.defaclobjtype,d.defaclacl::text acl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname IN ('auth','storage','api') OR (d.defaclnamespace=0 AND d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname='fixture_owner')) ORDER BY 1,2,3",
 };
 return Object.fromEntries(Object.entries(queries).map(([k,q])=>[k,sql(c.pg,`SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM (${q})t`)]));
}
function managedCounts(c){return sql(c.pg,`SELECT coalesce(jsonb_object_agg(n||'.'||t,c),'{}') FROM (SELECT schemaname n,tablename t,(xpath('/row/c/text()',query_to_xml(format('SELECT count(*) c FROM %I.%I',schemaname,tablename),false,true,'')))[1]::text::bigint c FROM pg_tables WHERE schemaname IN ('auth','storage') AND NOT(schemaname='auth' AND tablename='schema_migrations') AND NOT(schemaname='storage' AND tablename='migrations') ORDER BY 1,2)x`);}
function network(c){return probe(c.storage,`const fs=require('fs'),os=require('os');const n=os.networkInterfaces(),v4=fs.readFileSync('/proc/net/route','utf8').trim().split('\\n').slice(1).filter(Boolean),v6=fs.readFileSync('/proc/net/ipv6_route','utf8').trim().split('\\n').filter(Boolean);console.log(JSON.stringify({namespace:fs.readlinkSync('/proc/self/ns/net'),interfaces:Object.keys(n),ipv4_routes:v4.length,ipv6_only_lo:v6.every(l=>l.trim().split(/\\s+/).at(-1)==='lo'),ok:Object.keys(n).every(k=>k==='lo')&&Object.values(n).flat().every(a=>a.internal)&&v4.length===0&&v6.every(l=>l.trim().split(/\\s+/).at(-1)==='lo')}));`);}
let previous;
async function main(){
 previous=snapshot();
 for(const [name,id]of Object.entries(images))check(json(['image','inspect',id])[0].Id===id,'cached_pin_'+name);
 const source=await postgres('source');
 sql(source.pg,`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE authenticator LOGIN NOINHERIT; GRANT anon,authenticated,service_role TO authenticator; CREATE ROLE supabase_auth_admin LOGIN; CREATE ROLE supabase_storage_admin LOGIN NOINHERIT; GRANT anon,authenticated,service_role TO supabase_storage_admin; CREATE ROLE fixture_owner NOLOGIN; CREATE ROLE fixture_reader NOLOGIN;`);
 for(const r of ['authenticator','supabase_auth_admin','supabase_storage_admin'])sql(source.pg,`ALTER ROLE ${qi(r)} PASSWORD ${ql(source.password)}`);
 await managed(source);
 const sourceNet=network(source);report.source_network=sourceNet;check(sourceNet.ok,'source_namespace_no_egress');
 const users=probe(source.storage,`(async()=>{const out=[];for(const n of ['a','b']){const r=await fetch('http://127.0.0.1:9999/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'independent-'+n+'@example.invalid',password:'Synthetic-Independent!42'})});const b=await r.json();if(!r.ok||!b.user?.id)throw Error('signup');out.push({id:b.user.id,token:b.access_token})}console.log(JSON.stringify(out));})().catch(()=>process.exit(1));`);
 check(users.length===2&&users[0].id!==users[1].id,'source_synthetic_fixture_users');
 sql(source.pg,`CREATE SCHEMA api AUTHORIZATION fixture_owner; GRANT USAGE ON SCHEMA auth TO fixture_owner; GRANT REFERENCES ON auth.users TO fixture_owner; GRANT USAGE ON SCHEMA api TO authenticated,anon,fixture_reader;
 SET ROLE fixture_owner; ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC; ALTER DEFAULT PRIVILEGES IN SCHEMA api GRANT EXECUTE ON FUNCTIONS TO authenticated;
 CREATE TABLE api.private_notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES auth.users(id),note text NOT NULL);
 ALTER TABLE api.private_notes ENABLE ROW LEVEL SECURITY;
 CREATE POLICY own_rows ON api.private_notes TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
 GRANT SELECT,INSERT,UPDATE,DELETE ON api.private_notes TO authenticated; REVOKE DELETE ON api.private_notes FROM authenticated; GRANT SELECT ON api.private_notes TO fixture_reader;
 CREATE FUNCTION api.current_actor() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER AS $$ SELECT current_user::text $$; REVOKE ALL ON FUNCTION api.current_actor() FROM PUBLIC; GRANT EXECUTE ON FUNCTION api.current_actor() TO authenticated;
 RESET ROLE;
 INSERT INTO api.private_notes(owner_id,note) VALUES(${ql(users[0].id)},'cluster-source-a'),(${ql(users[1].id)},'cluster-source-b');`);
 fixtureStoragePolicy(source);
 const seed=probe(source.storage,`(async()=>{const token=${JSON.stringify(jwt('service_role'))},u=${JSON.stringify(users[0])};const b=await fetch('http://127.0.0.1:5000/bucket',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({id:'two-clusters-private',name:'two-clusters-private',public:false})});const f=await fetch('http://127.0.0.1:5000/object/two-clusters-private/'+u.id+'/recovered.txt',{method:'POST',headers:{Authorization:'Bearer '+u.token,'Content-Type':'text/plain'},body:'synthetic-independent-storage'});console.log(JSON.stringify({ok:b.ok&&f.ok}));})().catch(()=>process.exit(1));`);
 check(seed.ok,'source_single_storage_fixture');
 const target=await postgres('target');
 check(sql(target.pg,`SELECT count(*) FROM pg_roles WHERE rolname IN (${roleList})`)==='0','target_roles_initially_absent');
 report.clusters={source_system_identifier:sql(source.pg,'SELECT system_identifier FROM pg_control_system()'),target_system_identifier:sql(target.pg,'SELECT system_identifier FROM pg_control_system()')};
 check(report.clusters.source_system_identifier!==report.clusters.target_system_identifier&&source.pgdata!==target.pgdata,'independent_system_identifiers_pgdata');
 // Allowlist sintetica; nao extrai passwords/hashes de pg_authid ou pg_dumpall.
 const reconstructed=jsonRoleStatements(source);
 sql(target.pg,reconstructed);
 for(const r of ['authenticator','supabase_auth_admin','supabase_storage_admin'])sql(target.pg,`ALTER ROLE ${qi(r)} PASSWORD ${ql(target.password)}`);
 await managed(target);
 const targetNet=network(target);report.target_network=targetNet;
 check(targetNet.ok&&sourceNet.namespace!==targetNet.namespace,'independent_network_namespaces_no_egress');
 check(source.files!==target.files,'independent_storage_volumes');
 check(sql(target.pg,"SELECT (SELECT count(*) FROM auth.users)+(SELECT count(*) FROM storage.objects)")==='0','target_managed_tables_initially_empty');
 // Os papeis sao objetos GLOBAIS diferentes: comparar por nome/atributo, nao OID.
 check(roleProfile(source)===roleProfile(target),'reconstructed_role_attributes_settings');
 check(membershipProfile(source)===membershipProfile(target),'reconstructed_membership_admin_inherit_set');
 stop(source.auth);stop(target.auth);stop(target.storage);
 const before=catalogProfile(source),counts=managedCounts(source);
 const app=docker(['exec',source.pg,'pg_dump','-h','/tmp','-U','postgres','-d','postgres','-Fc','--schema=api'],undefined,true);
 const data=docker(['exec',source.pg,'pg_dump','-h','/tmp','-U','postgres','-d','postgres','-Fc','--data-only','--schema=auth','--schema=storage','--exclude-table-data=auth.schema_migrations','--exclude-table-data=storage.migrations'],undefined,true);
 const files=probe(source.storage,`const fs=require('fs'),path=require('path'),base='/var/lib/storage',out=[];function walk(p){for(const n of fs.readdirSync(p)){const full=path.join(p,n),s=fs.lstatSync(full);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory())walk(full);else if(s.isFile())out.push({name:path.relative(base,full),data:fs.readFileSync(full).toString('base64')});else throw Error('type')}}walk(base);console.log(JSON.stringify(out));`);
 stop(source.storage);stop(source.pg);
 check([source.pg,source.auth,source.storage].every(n=>!inspect(n).State.Running),'source_fully_stopped_before_restore');
 // Somente archives produzidos em memoria acima, sem arquivo SQL externo.
 docker(['exec','-i',target.pg,'pg_restore','-h','/tmp','-U','postgres','-d','postgres','--data-only','--disable-triggers','--single-transaction','--exit-on-error'],data);
 docker(['exec','-i',target.pg,'pg_restore','-h','/tmp','-U','postgres','-d','postgres','--single-transaction','--exit-on-error'],app);
 fixtureStoragePolicy(target);
 const after=catalogProfile(target);
 for(const key of Object.keys(before))check(before[key]===after[key],'restored_catalog_'+key);
 check(counts===managedCounts(target),'restored_all_managed_table_counts');
 check(sql(target.pg,"SELECT count(*) FROM api.private_notes n LEFT JOIN auth.users u ON u.id=n.owner_id WHERE u.id IS NULL")==='0','no_orphan_app_auth_links');
 check(sql(target.pg,"SELECT (SELECT count(*) FROM auth.identities i LEFT JOIN auth.users u ON u.id=i.user_id WHERE u.id IS NULL)+(SELECT count(*) FROM auth.sessions s LEFT JOIN auth.users u ON u.id=s.user_id WHERE u.id IS NULL)+(SELECT count(*) FROM storage.objects o LEFT JOIN storage.buckets b ON b.id=o.bucket_id WHERE b.id IS NULL)")==='0','managed_auth_storage_foreign_keys_no_orphans');
 check(sql(target.pg,"SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('auth','storage','api') AND t.tgenabled='D'")==='0','restore_triggers_reenabled');
 check(sql(target.pg,"SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('auth','storage','api') AND NOT c.convalidated")==='0','constraints_validated');
 check(sql(target.pg,`DO $$ BEGIN BEGIN INSERT INTO api.private_notes(owner_id,note) VALUES('00000000-0000-0000-0000-000000000001','orphan'); RAISE EXCEPTION 'FK_NOT_ENFORCED'; EXCEPTION WHEN foreign_key_violation THEN NULL; END; END $$; SELECT count(*) FROM api.private_notes;`).endsWith('2'),'foreign_key_rejects_orphan');
 check(sql(target.pg,"SELECT has_table_privilege('authenticated','api.private_notes','SELECT') AND NOT has_table_privilege('authenticated','api.private_notes','DELETE') AND has_function_privilege('authenticated','api.current_actor()','EXECUTE') AND NOT has_function_privilege('anon','api.current_actor()','EXECUTE')")==='t','grant_revoke_effective');
 start(target.auth);start(target.storage);
 check(await health(target.storage,5000,'/status')&&await health(target.storage,9999,'/health'),'target_services_after_import');
 probe(target.storage,`const fs=require('fs'),path=require('path'),base='/var/lib/storage';const files=${JSON.stringify(files)};for(const f of files){const p=path.resolve(base,f.name);if(!p.startsWith(base+'/'))throw Error('path');fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from(f.data,'base64'))}console.log(JSON.stringify({ok:true}));`);
 const destFiles=probe(target.storage,`const fs=require('fs'),path=require('path'),base='/var/lib/storage',out=[];function walk(p){for(const n of fs.readdirSync(p)){const full=path.join(p,n);if(fs.statSync(full).isDirectory())walk(full);else out.push({name:path.relative(base,full),data:fs.readFileSync(full).toString('base64')})}}walk(base);console.log(JSON.stringify(out));`);
 check(JSON.stringify(files)===JSON.stringify(destFiles),'storage_bytes_in_independent_volume');
 create('target-rest','container:'+target.pg,env({PGRST_DB_URI:`postgres://authenticator:${target.password}@127.0.0.1:5432/postgres`,PGRST_DB_SCHEMAS:'api',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_JWT_AUD:'authenticated',PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3000',PGRST_DB_CONFIG:'false'}),[images.rest]);
 check(await health(target.storage,3000,'/'),'target_rest_after_import');
 const functional=probe(target.storage,`(async()=>{
 const users=[];for(const n of ['a','b']){const r=await fetch('http://127.0.0.1:9999/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'independent-'+n+'@example.invalid',password:'Synthetic-Independent!42'})});const b=await r.json();if(!r.ok)throw Error('target_login');users.push({id:b.user.id,token:b.access_token})}
 const [a,b]=users,out={fresh_login_restored_users:users[0].id===${JSON.stringify(users[0].id)}&&users[1].id===${JSON.stringify(users[1].id)}};
 const req=async(path,token,method='GET',body)=>{const r=await fetch('http://127.0.0.1:3000'+path,{method,headers:{'Content-Type':'application/json',Prefer:'return=representation',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)}};
 for(const [n,u]of [['a',a],['b',b]]){const r=await req('/private_notes',u.token);out['restored_own_row_'+n]=r.status===200&&r.body.length===1&&r.body[0].owner_id===u.id&&r.body[0].note==='cluster-source-'+n;const actor=await req('/rpc/current_actor',u.token,'POST',{});out['function_invoker_'+n]=actor.status===200&&actor.body==='authenticated'}
 const cross=await req('/private_notes?owner_id=eq.'+b.id,a.token,'PATCH',{note:'forbidden'});out.restored_cross_update=cross.status===200&&cross.body.length===0;
 const transfer=await req('/private_notes?owner_id=eq.'+a.id,a.token,'PATCH',{owner_id:b.id});out.restored_owner_transfer_denied=transfer.status===403;
 out.restored_delete_revoked=[401,403].includes((await req('/private_notes',a.token,'DELETE')).status);
 out.restored_anon_denied=[401,403].includes((await req('/private_notes')).status);out.restored_function_anon_denied=[401,403,404].includes((await req('/rpc/current_actor',null,'POST',{})).status);
 const url='http://127.0.0.1:5000/object/authenticated/two-clusters-private/'+a.id+'/recovered.txt';const file=await fetch(url,{headers:{Authorization:'Bearer '+a.token}});out.storage_recovered_read=file.ok&&(await file.text())==='synthetic-independent-storage';const denied=await fetch(url,{headers:{Authorization:'Bearer '+b.token}});out.storage_recovered_cross_denied=[400,401,403,404].includes(denied.status);
 console.log(JSON.stringify(out));})().catch(()=>process.exit(1));`);
 report.functional=functional;for(const [name,ok]of Object.entries(functional))check(ok,name);
 check(sql(target.pg,"SELECT string_agg(note,',' ORDER BY note) FROM api.private_notes")==='cluster-source-a,cluster-source-b','restored_content_unchanged_after_denials');
 const defs=sql(target.pg,"BEGIN; SET ROLE fixture_owner; CREATE FUNCTION api.default_acl_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1'; RESET ROLE; SELECT has_function_privilege('authenticated','api.default_acl_probe()','EXECUTE') AND NOT has_function_privilege('anon','api.default_acl_probe()','EXECUTE'); ROLLBACK;");
 check(defs.split('\n').includes('t'),'restored_default_privileges_effective');
 for(const c of [target])check(sql(c.pg,"SELECT count(*) FROM pg_extension WHERE extname IN ('pg_cron','pg_net','supabase_vault')")==='0'&&sql(c.pg,'SHOW shared_preload_libraries')==='','no_external_executors_target');
 const netFinal=network(target);check(netFinal.ok,'target_isolation_after_restore');
 const listeners=probe(target.storage,`const fs=require('fs'),p=x=>fs.readFileSync(x,'utf8').trim().split('\\n').slice(1).filter(Boolean).map(l=>l.trim().split(/\\s+/)).filter(x=>x[3]==='0A').map(x=>x[1]);console.log(JSON.stringify({ipv4:p('/proc/net/tcp'),ipv6:p('/proc/net/tcp6')}));`);report.listeners=listeners;
 check(listeners.ipv6.length===0&&listeners.ipv4.every(x=>x.startsWith('0100007F:')),'target_listeners_loopback_only');
 report.limits.push('Somente roles da allowlist sintetica; sem senhas ou atributos de roles reais.','Migrations gerenciadas das mesmas imagens bootstrapadas antes da importacao; nao prova compatibilidade dos dumps reais.','Somente uma copia de arquivo sintetico Storage; sem Edge, SMTP, MFA ou operacoes financeiras.');
}
function jsonRoleStatements(c){
 const r=JSON.parse(roleProfile(c)),members=JSON.parse(membershipProfile(c));
 let statements='';
 for(const x of r){
  if(!roles.includes(x.rolname)||x.rolsuper||x.rolcreaterole||x.rolcreatedb||x.rolreplication)throw Error('UNSAFE_SYNTHETIC_ROLE');
  statements+=`CREATE ROLE ${qi(x.rolname)} ${x.rolcanlogin?'LOGIN':'NOLOGIN'} ${x.rolinherit?'INHERIT':'NOINHERIT'} ${x.rolbypassrls?'BYPASSRLS':'NOBYPASSRLS'} CONNECTION LIMIT ${Number(x.rolconnlimit)};\n`;
  for(const setting of x.rolconfig||[]){if(setting!=='search_path=auth, public')throw Error('UNEXPECTED_ROLE_SETTING');statements+=`ALTER ROLE ${qi(x.rolname)} SET search_path=auth,public;\n`;}
 }
 for(const m of members||[])statements+=`GRANT ${qi(m.role_name)} TO ${qi(m.member_name)} WITH ADMIN ${m.admin_option?'TRUE':'FALSE'}; GRANT ${qi(m.role_name)} TO ${qi(m.member_name)} WITH INHERIT ${m.inherit_option?'TRUE':'FALSE'}; GRANT ${qi(m.role_name)} TO ${qi(m.member_name)} WITH SET ${m.set_option?'TRUE':'FALSE'};\n`;
 statements+='ALTER DEFAULT PRIVILEGES FOR ROLE fixture_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;\n';
 return statements;
}
main().catch(e=>{report.errors.push(e.message);process.exitCode=1;}).finally(()=>{
 for(const n of [...created].reverse()){try{stop(n);}catch{report.errors.push('STOP_FAILED:'+n);process.exitCode=1;}}
 for(const r of report.resources){try{const x=inspect(r.name);r.final_state=x.State.Status;r.exit_code=x.State.ExitCode;if(x.State.Running||x.State.Restarting||x.State.Paused)throw Error('active');}catch{report.errors.push('FINAL_STATE_FAILED:'+r.name);process.exitCode=1;}}
 if(previous){try{const now=snapshot();const preserved=previous.containers.every(x=>JSON.stringify(x)===JSON.stringify(now.containers.find(y=>y.id===x.id)))&&previous.volumes.every(v=>now.volumes.includes(v));report.historical_resources={containers:previous.containers.length,volumes:previous.volumes.length,preserved};check(preserved,'historical_resources_preserved');}catch{report.errors.push('HISTORICAL_CHECK_FAILED');process.exitCode=1;}}
 save();console.log(JSON.stringify({tag,report:reportPath,passed:report.checks.filter(x=>x.ok).length,total:report.checks.length,errors:report.errors}));
});
