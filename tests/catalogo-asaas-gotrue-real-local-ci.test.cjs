"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const app=fs.readFileSync("scripts/validacao-pagamentos/test-gotrue-mfa-real-local.ts","utf8");
const vec=fs.readFileSync("scripts/validacao-pagamentos/test-gotrue-mfa-real-local.unit.test.ts","utf8");
const ci=fs.readFileSync(".github/workflows/database-tests.yml","utf8");
const build=fs.readFileSync("scripts/validacao-pagamentos/build-native-supabase-ci.py","utf8");

test("E2E GoTrue usa apenas loopback e credencial ANON publica da stack temporaria",()=>{
  assert.match(app,/const BASE = "http:\/\/127\.0\.0\.1:54321\/auth\/v1"/);
  assert.match(app,/const EXPECTED_ORIGIN = "http:\/\/127\.0\.0\.1:54321"/);
  assert.match(app,/Deno\.args\[0\]!=="--native-ci-local-only"/);
  assert.match(app,/LOCAL_SUPABASE_ANON_KEY/);
  assert.match(ci,/deno run\s+\\\n\s+--allow-net=127\.0\.0\.1:54321/);
  assert.match(ci,/supabase status -o env > "\$status_file"/);
  assert.match(ci,/test "\$\{#local_anon\}" -gt 50/);
  assert.doesNotMatch(app,/https:\/\/[a-z0-9-]+\.supabase\.co/);
  assert.doesNotMatch(app,/\/rest\/v1\/rpc|\/functions\/v1|\/transfers|\/payments/i);
  assert.doesNotMatch(app,/console\.log\((?:password|secret|code|next|before)/);
});

test("MFA real local faz signup e challenge+verify e exige AAL2 da mesma sessao",()=>{
  assert.match(app,/"POST", "\/signup"/);
  assert.match(app,/"POST", "\/factors"/);
  assert.match(app,/\/challenge"/);
  assert.match(app,/\/verify"/);
  assert.match(app,/initial\.aal === "aal1"/);
  assert.match(app,/after\.aal === "aal2" && after\.sub === initial\.sub/);
  assert.match(app,/after\.session_id === initial\.session_id/);
  assert.match(app,/moneyAuthorized:false/);
  assert.match(vec,/RFC 6238/);
  assert.match(vec,/94287082/);
  assert.match(vec,/07081804/);
});

test("MFA habilitado exclusivamente em config.toml temporario, sem copiar config prod",()=>{
  assert.match(build,/project_id = \\"guia-andrelandia-native-ci-isolado\\"/);
  assert.match(build,/'\[auth\.mfa\.totp\]\\n'/);
  assert.match(build,/'enroll_enabled = true\\n'/);
  assert.match(build,/'verify_enabled = true\\n'/);
  assert.match(build,/Never run the migrations from this script against a remote database/);
  assert.match(ci,/deno test --no-check scripts\/validacao-pagamentos\/test-gotrue-mfa-real-local\.unit\.test\.ts/);
  assert.match(ci,/--native-ci-local-only/);
});
