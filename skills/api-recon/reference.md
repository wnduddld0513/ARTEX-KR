# api-recon — Reference Manual

Grep recipes, the `config.json` template, and troubleshooting. All greps run against the `js/` directory. If the bundle is a single line, run `js-beautify` or `sed 's/}/}\n/g'` first; usually a raw grep with a context window is enough.

## About the scripts

Every file in `scripts/` is a **reference template** and must be adapted to the target site before running. Typical edits:

| Script | Commonly needs adjusting |
|---|---|
| `harvest_static.py` | endpoint regex, webpack/Vite manifest parsing, micro-frontend publicPath, retry/concurrency |
| `runtime_harvest.js` | neutralize field names and success values, stub match rules and body structure, route source, WS recording, `waitUntil`/`routeTimeout`/`proxy` |
| `preload.js` | `loginPathRe`, L1 stubs, `neutralize.fields`, `apiPattern`, whether L3 is enabled, `recordDetail`, `observe.*`, `neutralizeVueRouter` |
| `spider_mpa.py` | `--exclude` destructive links, cookie, depth/max, same-domain filtering |
| `extract_route_map.py` | `routeMap` / `routeLink` regex, KEY naming pattern |
| `build_perm_tree.py` | `userRouteAuth` parsing, `ROOTS`/`PREFIX_PARENT` hierarchy heuristics, stub outer field names |
| `config.json` | the single entry point for all of the above site-specific parameters |

Keep adjusted files in the task working directory (e.g. `recon/`) and note the concrete changes relative to the reference scripts in the report.

---

## A. Reversing the three gates

### A1. Render gate — "How is logged-in determined?"

```bash
grep -rhoaE '.{0,40}(isLogin|isAuthenticated|loggedIn|hasLogin|requireAuth)\b.{0,80}' js | head
grep -rhoaE 'function (getUser|getToken|getAuth)[0-9]?\([^)]*\)\{.{0,200}' js | head
grep -rhoaE '(localStorage|sessionStorage)\.getItem\("[^"]+"\)' js | sort -u
grep -rhoaE '(Cookies?|cookie)\.(get|load)\("[^"]+"\)' js | sort -u
grep -rhoaE '\batob\(|JSON\.parse\(|jwt|decode' js | head
```

Find the chain `isLogin = f(getUser())` → `getUser = decode(storage.read(KEY))` and determine the **storage key**, the **container** (Cookie vs localStorage) and the **encoding**:

| Encoding | How to forge it in config |
|---|---|
| Plain string / `"1"` / token | `"value": "anything-truthy"` |
| `JSON.parse(x)` | `"value": "json:{\"id\":1,\"username\":\"admin\"}"` |
| `JSON.parse(atob(x))` | `"value": "b64json:{\"id\":1,\"username\":\"admin\"}"` |
| JWT | unsigned / `alg:none` JWT, or sign with a key found in the bundle |
| Encrypted (SM2/AES/RSA) | look for a hardcoded key; forge only if the render gate needs a decodable blob; otherwise fall back to static |

→ write into `cookies` / `localStorage`.

### A2. Interceptor gate — "What triggers a jump to /login?"

```bash
grep -rhoaE '.{0,60}(interceptors\.response|axios|request\.use).{0,120}' js | head
grep -rhoaE '.{0,40}(response_code|errcode|errno|\bcode\b|\bret\b|\bstatus\b)\s*[=!]==?\s*[\-0-9]{1,4}.{0,60}' js | head -20
grep -rhoaE '.{0,40}(未登录|请重新登录|登录已过期|unauthorized|登录失效|授权|token.{0,10}invalid).{0,40}' js | head
grep -rhoaE '.{0,30}(location\.href|router\.(push|replace)|navigate)\([^)]*login[^)]*\)' js | head
```

Determine the **field name**, the **success value** (usually `0` or `200`) and the **failure value that triggers the redirect**. Verify with a junk session:

```bash
curl -sk -X POST -H 'Cookie: <fakekey>=junk' https://target/api/<protected> -d '{}' -H 'Content-Type: application/json'
```

→ write into `neutralize.fields` + `neutralize.success`.

### A3. Content gate — "Where do menus/permissions come from?"

```bash
grep -rhoaE '"/api[^"]*(permission|perm|role|menu|acl|resource|nav)[^"]*"' js | sort -u
grep -rhoaE '.{0,30}(menus|permissions|menuList|routeList|authList|role_permissions)\b.{0,120}' js | head
grep -rhoaE 'userRouteAuth|getResultTree|routeMap|routeLink|hasPermission|checkAuth' js | head
grep -rhoaE '([A-Z_][A-Z0-9_]*):\{name:"[^"]*",link:"/[^"]+"\}' js | head
```

**Two layers of data** (common in enterprise admin backends):

| API | Typical payload | Consumer |
|---|---|---|
| `.../role_permissions` | `{ permissions: string[], role_type }` | route guards, button-level ACL |
| `.../permissions/all` | `tree[{ code, position, children }]` | sidebar menu rendering |
| `userRouteAuth` in the bundle | `{ CODE: { url, name? } }` | code → frontend path |
| `routeMap` in the bundle | `{ KEY: { name, link } }` | alias resolution (webpack `o.DASHBOARD`) |

Read the consumer code to confirm how `getResultTree(tree, permissions)` filters and which field `v-if` / `hasAuth(code)` checks.

**Manual forge** (small sites): build a permissive payload → `stubs`.

**Full permission tree recovery** (large sites where the sidebar/submodules are still blank): see **section I**.

---

## B. config.json template

```json
{
  "baseUrl": "https://target/",
  "runtimeMode": "both",
  "chromium": "/usr/bin/chromium",

  "cookies": [
    { "name": "auth", "value": "b64json:{\"id\":1,\"username\":\"admin\",\"role\":\"admin\",\"func\":{},\"permissions\":[\"*\"]}" }
  ],
  "localStorage": { "token": "faketoken", "isLogin": "1" },

  "neutralize": {
    "fields": ["response_code", "code", "errno", "ret", "status"],
    "success": 0,
    "flags": { "success": true, "message": "ok" }
  },
  "forward": true,
  "loginUrlPattern": "/login",
  "apiPattern": "/api/|/rest/|/graphql",

  "mockTier": "L1+L2",
  "recordDetail": true,
  "observe": {
    "storageReads": false,
    "cookieReads": false,
    "xhrHeaders": true
  },
  "neutralizeVueRouter": true,
  "stubs": [
    {
      "match": "permissions/all|/menu|role_permissions",
      "body": {
        "response_code": 0, "code": 0,
        "data": {
          "permissions": ["*"],
          "menus": [
            { "name": "dashboard", "path": "/dashboard", "show": true, "children": [] },
            { "name": "alert", "path": "/alert", "show": true, "children": [] }
          ]
        }
      }
    }
  ],

  "explore": {
    "clickTabs": true,
    "clickTables": true,
    "pushStateFallback": true,
    "maxMenuItems": 50
  },

  "routes": ["/dashboard", "/alert", "/asset", "/device", "/report", "/config", "/system"],
  "waitMs": 1500, "perRouteMs": 900, "headless": true,
  "waitUntil": "domcontentloaded",
  "routeTimeout": 12000,
  "proxy": "",

  "captureResponses": true, "recordWs": true, "respMax": 600
}
```

Field notes:
- `runtimeMode`: `depth` (Puppeteer), `coverage` (browser MCP), `both`
- `cookies[].value` prefixes: `b64json:` → base64(JSON); `json:` → raw JSON; no prefix → literal
- `forward: true` forwards real requests and rewrites the code fields; `false` is fully offline stub
- `mockTier`: the tier the coverage-mode preload enables, e.g. `L1+L2`, `L1+L2+L3`
- `routes` comes from `routes.txt`; after forging menus the harness automatically appends `<a href>` entries
- `captureResponses` / `recordWs` only take effect in depth mode
- `waitUntil`: use `domcontentloaded` for large SPAs to avoid `networkidle2` hanging
- `routeTimeout`: `page.goto` timeout per route (milliseconds)
- `proxy`: Puppeteer `--proxy-server`; you can also set `HTTP_PROXY` / `HTTPS_PROXY`

### B1. Double-stub template (role_permissions + permissions/all)

```json
"stubs": [
  {
    "match": "role_permissions",
    "body": {
      "response_code": 0,
      "data": {
        "permissions": ["MONITOR", "MONITOR_ALERT", "THREAT", "ASSETS_RISK"],
        "role_type": "SUPER_ADMIN"
      }
    }
  },
  {
    "match": "permissions/all",
    "body": {
      "response_code": 0,
      "data": [
        {
          "code": "MONITOR",
          "position": 1,
          "children": [
            { "code": "MONITOR_ALERT", "position": 1, "children": [] }
          ]
        }
      ]
    }
  }
]
```

The outer field names (`response_code` / `code` / `data`) must match the A2 interceptor gate, and `permissions` must cover every leaf code in the tree.

---

## C. coverage mode: preload configuration

Edit the `CONFIG` object at the top of `scripts/preload.js`, or replace it before injecting through CDP:

```javascript
const CONFIG = {
  loginPathRe: /\/(login|signin)(\/|$|\?)/i,
  mockTier: 'L1+L2',
  forward: true,
  recordDetail: true,
  extractUrlsFromResponse: true,
  neutralizeVueRouter: true,
  observe: { storageReads: false, cookieReads: false, xhrHeaders: true },
  neutralize: { fields: ['response_code', 'code'], success: 0 },
  stubs: [ /* same stubs as config.json */ ],
  apiPattern: /\/(api|apis|v\d+|dev|internal|graphql)\//i,
};
```

Verify: `window.__API_RECON_PRELOAD__ === true` and the pathname stays stable.

Export the recorded results:

```javascript
JSON.stringify({
  apis: [...window.__API_RECON_LOG__],
  detail: window.__API_RECON_DETAIL__,
  routes: [...(window.__API_RECON_ROUTES__ || [])],
  observe: window.__API_RECON_OBSERVE__,
}, null, 2)
```

---

## D. preload / runtime Hook capabilities

Browser Hook capabilities built into preload (coverage) and runtime_harvest (depth), and what they cover:

| Hook capability | Value for API discovery | Coverage |
|---|---|---|
| Hook fetch / XHR.open | record request URL/method | ✅ `recordDetail` + `__API_RECON_LOG__` |
| Hook XHR.setRequestHeader | discover headers such as Authorization | ✅ `observe.xhrHeaders` |
| Hook localStorage/cookie reads | confirm session key names | ⚠️ optional `observe.storageReads/cookieReads` |
| Vue route access | complete frontendRoutes | ✅ `__API_RECON_ROUTES__` (already-loaded routes) |
| Neutralize Vue route guards / block login redirects | hold modules open to trigger APIs | ✅ `neutralizeVueRouter` + native navigation neutralization |
| React route access | complete routes | ⚠️ static + clicks; no dedicated Hook |
| Block page navigation (login paths) | stay on the page to analyze | ⚠️ blocks only login paths so business navigation is not blocked |
| Hook crypto libraries (CryptoJS/SM etc.) | encrypted params → plaintext API body | ❌ must hand-hook the encryption function's arguments; write the conclusion into config |
| Anti-debug bypass | otherwise runtime records no APIs | ❌ must be handled manually; static still works |

---

## E. Endpoint extraction regex (when static results are too few)

Relax `extract_endpoints` in `harvest_static.py`, or do it manually:

```bash
grep -rhoaE '"/[a-z][A-Za-z0-9_/\-]{3,}"' js | sort -u
grep -rhoaE '/api/[a-zA-Z0-9_./-]+' js | sort -u
```

---

## F. Troubleshooting

| Symptom | Cause → handling |
|---|---|
| Very few static APIs | endpoint dialect mismatch → relax the regex (section E) |
| chunk count ≪ manifest | CSS-only or undeployed chunks; 404s already retried |
| runtime still shows the login page | render gate is wrong → re-check A1: key name, container, encoding, domain |
| Shell entered but modules are blank | content gate → forge menus (A3); `routes` paths may be wrong |
| Every route only returns bootstrap/locale | permission codes incomplete → section I permission tree recovery; check the `role_permissions` + `permissions/all` double stub |
| Sidebar has entries but subpages are blank | the tree is missing intermediate nodes, or codes do not match `userRouteAuth` |
| Every API redirects to login | interceptor gate → confirm `neutralize`; nested fields need the walk logic extended |
| WS frames are 0 | subscription only happens after user interaction; increase `perRouteMs` |
| Response bodies are empty | real responses only exist with `forward: true` |
| Chromium missing | install chromium or set `config.chromium` / `CHROMIUM` |
| Lots of mocks but still back at login | Hook too late or missing the `location.href` setter → document-start + preload |
| Lists are all empty | empty L3 arrays are normal; keep clicking tabs/settings/details |
| Mistaking Redux actions for routes | filter internal paths containing get/set/change/clear/toggle/upload |
| Vue still redirects to login | preload is not document-start → change the injection timing; or clear guards manually when `neutralizeVueRouter: false` |
| Response contains URLs that never reach the log | enable `extractUrlsFromResponse`; or extract manually from `__API_RECON_DETAIL__` |
| Unknown Authorization header name | enable `observe.xhrHeaders` or inspect request headers in DevTools |
| runtime is very slow / times out | set `waitUntil: domcontentloaded`; lower `routeTimeout`; do not use `networkidle2` |
| Proxy connection fails | check `proxy` / environment variables; keep the Puppeteer and curl proxy ports consistent |

---

## G. hardened targets

When the server validates the session step by step (signed cookies that cannot be forged, server-rendered menus that cannot be stubbed), runtime stalls at the shell. Expected behavior:

- **Static is enough for endpoint enumeration** — module paths live in the code
- If authorization allows, run the same harness with a **real session**: `forward: true`, no neutralize needed, capturing real methods/params/responses

---

## H. Single-task checklist

1. Confirm the authorization scope
2. **Read** `scripts/harvest_static.py` → adapt it for the target → run it → review `api_static.txt`, `routes.txt`
3. **Phase 1b**: path anchor window expansion + binding layer → `param_candidates.json` (section J)
4. Reverse A1/A2/A3 → write a site-specific `config.json`
5. **Read and adapt** `runtime_harvest.js` / `preload.js` before running them
6. `runtimeMode=depth`: `npm install` → run the adapted harvest script
7. `runtimeMode=coverage/both`: inject the adapted preload at document-start → browser MCP dynamic enumeration + **parameter trigger matrix**
8. Modules do not render → **section I permission tree recovery** → patch stubs → re-run
9. Multi-sample parameter diff + error reverse-inference → `params_merged.json`
10. Merge → `site_map.json` + `api_merged.txt`, and honestly note coverage, gaps and script change points

---

## I. Permission tree recovery (Phase 4 in depth)

Use this when forging a simple `menus: [{ path, show: true }]` does not work and submodules still do not mount.

### I1. Locate the auth module

```bash
grep -l 'userRouteAuth' js/*.js
grep -l 'routeMap\|routeLink' js/*.js
grep -rhoaE 'getResultTree|role_permissions|permissions/all' js | head
```

Record: the **permission API path**, the **response field names**, and the **consuming chunk file names**.

### I2. Extract routeMap

```bash
python3 scripts/extract_route_map.py recon/js recon/
# output: recon/route_map.json
```

If you get `[!] no routeMap pattern found`, relax the regex in `extract_route_map.py` or grep manually:

```bash
grep -rhoaE '([A-Z_][A-Z0-9_]*):\{name:"[^"]*",link:"/[^"]+"\}' js | head -20
```

### I3. Build the permission tree + stub

```bash
python3 scripts/build_perm_tree.py recon/js recon/ --config recon/config.json
```

Script logic:
1. Parse `userRouteAuth={MONITOR:{url:...},...}` (including webpack aliases like `He=o.DASHBOARD`)
2. Resolve aliases to real paths using `route_map.json`
3. Infer parents from code prefixes (`MONITOR_ALERT` → `MONITOR`)
4. Output `permissions_tree.json`, `permissions_all_stub.json`, `role_permissions_stub.json`
5. With `--config`, automatically write into `config.json`'s `stubs` and extend `routes`

**Adapt for the target** (at the top of the script):
- `DEFAULT_ROOTS`: list of top-level module codes
- `DEFAULT_PREFIX_PARENT`: `PREFIX_` → parent mapping
- `DEFAULT_EXTRA_PARENT`: orphan nodes that do not follow the prefix relationship

### I4. Validate stub consistency

```bash
# the number of permissions should be ≈ the number of userRouteAuth entries
wc -l recon/perm_codes_all.txt
# routes should cover every link in route_map
python3 -c "import json; m=json.load(open('recon/route_map.json')); r=set(json.load(open('recon/config.json'))['routes']); print('missing', [v['link'] for v in m.values() if v['link'] not in r])"
```

### I5. Re-run runtime and compare

```bash
node recon/runtime_harvest.js recon/config.json
# compare runtime_api.json counts before and after forging; check whether module APIs appear under /attack, /asset, etc.
```

| Before forging | After forging (success) |
|---|---|
| the same 3–5 bootstrap entries per route | different routes trigger different module APIs |
| only `/api/locale/language` | module endpoints such as `/api/web/...` appear |
| `routes.txt` has single-digit routes | `routes` of 80–110+ come from route_map |

### I6. When it still fails

- **coverage mode**: click the sidebar + tabs; permission gating may request only after interaction
- **stub fields**: compare a real API (curl + real session) with the stub's nesting
- **extra guards**: grep button-level checks such as `hasPermission|checkRole|func.` and extend `role_permissions.permissions`
- **static fallback**: module API paths are still in `api_static.txt`; runtime only fills in METHOD/body. Keep parameters from `param_candidates.json` + recorded samples

---

## J. Parameter reversing (Phase 1b / 5b / 5c)

**A methodology, not a general-purpose script.** Find paths with regex; find parameters with anchor window expansion + UI binding chain + multi-sample diff + error reverse-inference.

### J1. Anchor window expansion — find the packet-assembly object from a path

```bash
# use a path known from Phase 1 as the anchor
grep -n '"/api/user/list"' js/*.js
grep -rhoaE '.{0,120}("/api[^"]+").{0,200}' js | head
grep -rhoaE '(params|data|body|payload)\s*:\s*\{' js | head
grep -rhoaE '(get|post|put|delete|patch)\([^,]+,\s*\{' js | head
```

### J2. Wrapper layers and transport shapes

```bash
# axios / unified request
grep -rhoaE '(axios|request)\.(get|post|put|delete|patch)\(' js | head
grep -rhoaE 'interceptors\.(request|response)' js | head

# GraphQL
grep -rhoaE '(query|mutation)\s+\w+|gql`|graphql\(' js | head
grep -rhoaE '\$[a-zA-Z_]+\s*:\s*(Int|String|Boolean|\[)' js | head

# FormData / multipart
grep -rhoaE 'FormData|\.append\(' js | head

# path parameters
grep -rhoaE 'path:\s*"/[^"]*:[^"]+"' js | head
grep -rhoaE 'useParams|route\.params|\$route\.params' js | head
```

### J3. Validation gate — required / format / enum

```bash
grep -rhoaE '(required|message|pattern|enum|validator)\s*:' js | head
grep -rhoaE 'yup\.|zod\.|async-validator|Form\.Item|a-form-item|el-form-item' js | head
grep -rhoaE 'rules\s*:\s*\[|name:\s*["\'][a-zA-Z_]+["\']' js | head
grep -rhoaE 'label.*value|options\s*:\s*\[' js | head
```

### J4. Binding layer — form → API

```bash
grep -rhoaE 'onFinish|handleSubmit|getFieldsValue|validateFields' js | head
grep -rhoaE '(pick|omit|transform|dayjs|moment)\(' js | head
```

runtime complements this: in DevTools → Network → request → **Initiator** (call stack), walk up from `fetch`/`send` to the packet-assembly function.

### J5. Encrypted parameters

```bash
grep -rhoaE 'encrypt|decrypt|sign|CryptoJS|sm2|sm3|sm4|RSA|AES' js | head
```

**Do not guess fields from ciphertext** — Hook the encryption function's **arguments** and record the plaintext payload before encryption; write conclusions into `config.json` / `param_candidates.json`.

### J6. Parameter trigger matrix (required in Phase 3)

Record each module once per action and diff the request body/query:

| Action | What to watch |
|---|---|
| First list screen | paging defaults |
| Search | keyword, filters |
| Advanced filter | optional fields |
| Create/edit | full entity |
| Bulk/export | `ids[]`, `exportType` |
| Sort/paging | `sortField`, `order` |

Output `param_samples.json`: `[{ "path", "method", "action": "search", "body", "query", "headers" }]`

### J7. Confidence rules

| Confidence | Condition |
|---|---|
| **High** | static callsite + at least 2 consistent runtime samples |
| **Medium** | static only, or a single runtime observation |
| **Low** | reverse-inferred from responses/errors, not re-verified |
| **Pending trigger** | the field is known statically but UI/permissions never reached it |

### J8. Scenario quick recipes

| Scenario | Order |
|---|---|
| REST list page | J1 packet-assembly object → J6 four diffs → J3 rules |
| Create/edit form | J3 Form name → J4 submit chain → submit at runtime + deliberately leave it empty to see the 400 |
| GraphQL | J2 variables declarations → record variables per operation at runtime |
| Encrypted body | J5 Hook the arguments → the fields before encryption are the real params |

### J9. Mapping to the api-recon phases

| api-recon | Parameter recon |
|---|---|
| Phase 1 static | J1 anchor window expansion |
| Phase 2 A2 interceptor | globally injected fields (tenantId, sign) |
| Phase 3 runtime | J6 trigger matrix + `param_samples.json` |
| Phase 4 permission tree | different modules have different forms → all fields trigger only with sufficient permissions |
| Phase 5 merge | `params_merged.json` + confidence; never decide required/optional from one sample |

### J10. Troubleshooting

| Symptom | Handling |
|---|---|
| A static field name never appears at runtime | mark it "pending trigger"; complete the permission tree / click advanced filters / each option of a coupled select |
| Same path, different body shapes | normal — record them under separate `action` entries; do not force-merge the schemas |
| Stub responses are fake but you want the params | **look at the outbound request** body/headers; never reverse-infer from the stub response |
| 400 reports a nested field | mind the outer wrappers `data`/`bizData`/`variables` |
| GraphQL only shows operation names | expand the `variables` JSON; find `$var: Type` statically |

---
