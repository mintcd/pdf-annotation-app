var R=self,v="pdf-annotation-db",L=1,U="/api",A="sync-engine-sync",J=50,m=JSON.parse(`{
  "documents": {
    "keyPath": "id",
    "primaryKeyType": "TEXT",
    "indices": [
      {
        "name": "source_key",
        "keyPath": "source_key"
      },
      {
        "name": "source_type",
        "keyPath": "source_type"
      },
      {
        "name": "source_url",
        "keyPath": "source_url"
      },
      {
        "name": "file_name",
        "keyPath": "file_name"
      },
      {
        "name": "title",
        "keyPath": "title"
      },
      {
        "name": "created_at",
        "keyPath": "created_at"
      },
      {
        "name": "updated_at",
        "keyPath": "updated_at"
      },
      {
        "name": "number_of_annotations",
        "keyPath": "number_of_annotations"
      }
    ]
  },
  "annotations": {
    "keyPath": "id",
    "primaryKeyType": "TEXT",
    "indices": [
      {
        "name": "document_id",
        "keyPath": "document_id"
      },
      {
        "name": "page_index",
        "keyPath": "page_index"
      },
      {
        "name": "text",
        "keyPath": "text"
      },
      {
        "name": "created_at",
        "keyPath": "created_at"
      },
      {
        "name": "updated_at",
        "keyPath": "updated_at"
      },
      {
        "name": "color",
        "keyPath": "color"
      },
      {
        "name": "comment",
        "keyPath": "comment"
      }
    ]
  },
  "operations": {
    "keyPath": "id",
    "primaryKeyType": "TEXT",
    "indices": [
      {
        "name": "by_processed",
        "keyPath": "processed"
      },
      {
        "name": "by_client",
        "keyPath": [
          "client_id",
          "client_op_id"
        ]
      },
      {
        "name": "by_entity",
        "keyPath": "entity"
      },
      {
        "name": "by_created_at",
        "keyPath": "created_at"
      }
    ]
  },
  "config": {
    "keyPath": "key",
    "primaryKeyType": "TEXT",
    "indices": []
  }
}`),Ne=JSON.parse(`{
  "documents": {
    "fields": {
      "id": {
        "type": "string",
        "notnull": true
      },
      "source_key": {
        "type": "string",
        "notnull": true
      },
      "source_type": {
        "type": "string",
        "notnull": true
      },
      "source_url": {
        "type": "string",
        "notnull": false
      },
      "file_name": {
        "type": "string",
        "notnull": true
      },
      "title": {
        "type": "string",
        "notnull": true
      },
      "created_at": {
        "type": "string",
        "notnull": true
      },
      "updated_at": {
        "type": "string",
        "notnull": true
      },
      "number_of_annotations": {
        "type": "number",
        "notnull": false
      }
    },
    "primaryKey": "id"
  },
  "annotations": {
    "fields": {
      "id": {
        "type": "string",
        "notnull": true
      },
      "document_id": {
        "type": "string",
        "notnull": true
      },
      "page_index": {
        "type": "number",
        "notnull": true
      },
      "text": {
        "type": "string",
        "notnull": true
      },
      "created_at": {
        "type": "string",
        "notnull": true
      },
      "updated_at": {
        "type": "string",
        "notnull": true
      },
      "color": {
        "type": "string",
        "notnull": true
      },
      "comment": {
        "type": "string",
        "notnull": false
      },
      "position": {
        "type": "object",
        "notnull": true
      }
    },
    "primaryKey": "id"
  },
  "operations": {
    "fields": {
      "id": {
        "type": "string",
        "notnull": true
      },
      "entity": {
        "type": "string",
        "notnull": true
      },
      "op_type": {
        "type": "string",
        "notnull": true
      },
      "payload": {
        "type": "string",
        "notnull": false
      },
      "created_at": {
        "type": "string",
        "notnull": true
      },
      "processed": {
        "type": "number",
        "notnull": true
      },
      "attempts": {
        "type": "number",
        "notnull": true
      },
      "last_error": {
        "type": "string",
        "notnull": false
      },
      "client_id": {
        "type": "string",
        "notnull": false
      },
      "client_op_id": {
        "type": "string",
        "notnull": false
      },
      "sent_at": {
        "type": "string",
        "notnull": false
      },
      "undone": {
        "type": "number",
        "notnull": true
      },
      "instance_id": {
        "type": "string",
        "notnull": false
      }
    },
    "primaryKey": "id"
  }
}`),K='{"declaredSchema":{"documents":{"fields":{"id":{"type":"string","notnull":true},"source_key":{"type":"string","notnull":true},"source_type":{"type":"string","notnull":true},"source_url":{"type":"string","notnull":false},"file_name":{"type":"string","notnull":true},"title":{"type":"string","notnull":true},"created_at":{"type":"string","notnull":true},"updated_at":{"type":"string","notnull":true},"number_of_annotations":{"type":"number","notnull":false}},"primaryKey":"id"},"annotations":{"fields":{"id":{"type":"string","notnull":true},"document_id":{"type":"string","notnull":true},"page_index":{"type":"number","notnull":true},"text":{"type":"string","notnull":true},"created_at":{"type":"string","notnull":true},"updated_at":{"type":"string","notnull":true},"color":{"type":"string","notnull":true},"comment":{"type":"string","notnull":false},"position":{"type":"object","notnull":true}},"primaryKey":"id"},"operations":{"fields":{"id":{"type":"string","notnull":true},"entity":{"type":"string","notnull":true},"op_type":{"type":"string","notnull":true},"payload":{"type":"string","notnull":false},"created_at":{"type":"string","notnull":true},"processed":{"type":"number","notnull":true},"attempts":{"type":"number","notnull":true},"last_error":{"type":"string","notnull":false},"client_id":{"type":"string","notnull":false},"client_op_id":{"type":"string","notnull":false},"sent_at":{"type":"string","notnull":false},"undone":{"type":"number","notnull":true},"instance_id":{"type":"string","notnull":false}},"primaryKey":"id"}},"tableSchemas":{"documents":{"keyPath":"id","primaryKeyType":"TEXT","indices":[{"name":"source_key","keyPath":"source_key"},{"name":"source_type","keyPath":"source_type"},{"name":"source_url","keyPath":"source_url"},{"name":"file_name","keyPath":"file_name"},{"name":"title","keyPath":"title"},{"name":"created_at","keyPath":"created_at"},{"name":"updated_at","keyPath":"updated_at"},{"name":"number_of_annotations","keyPath":"number_of_annotations"}]},"annotations":{"keyPath":"id","primaryKeyType":"TEXT","indices":[{"name":"document_id","keyPath":"document_id"},{"name":"page_index","keyPath":"page_index"},{"name":"text","keyPath":"text"},{"name":"created_at","keyPath":"created_at"},{"name":"updated_at","keyPath":"updated_at"},{"name":"color","keyPath":"color"},{"name":"comment","keyPath":"comment"}]},"operations":{"keyPath":"id","primaryKeyType":"TEXT","indices":[{"name":"by_processed","keyPath":"processed"},{"name":"by_client","keyPath":["client_id","client_op_id"]},{"name":"by_entity","keyPath":"entity"},{"name":"by_created_at","keyPath":"created_at"}]},"config":{"keyPath":"key","primaryKeyType":"TEXT","indices":[]}}}';var l={updateRemote:"SYNC_ENGINE_UPDATE_REMOTE",remoteQuery:"SYNC_ENGINE_REMOTE_QUERY",remoteQueryResult:"SYNC_ENGINE_REMOTE_QUERY_RESULT",remoteQueryError:"SYNC_ENGINE_REMOTE_QUERY_ERROR",syncNow:"SYNC_ENGINE_SYNC_NOW",syncNowResult:"SYNC_ENGINE_SYNC_NOW_RESULT",syncNowError:"SYNC_ENGINE_SYNC_NOW_ERROR",databaseChanged:"SYNC_ENGINE_DATABASE_CHANGED",syncStarted:"SYNC_ENGINE_SYNC_STARTED",syncCompleted:"SYNC_ENGINE_SYNC_COMPLETED",syncFailed:"SYNC_ENGINE_SYNC_FAILED",registerSync:"SYNC_ENGINE_REGISTER_SYNC",backgroundSync:"SYNC_ENGINE_BACKGROUND_SYNC"};var D,Z="sync-engine:schema";function se(e,t){if(t){for(let[n,r]of Object.entries(m)){let o=ce(e,t,n,r);de(o,r)}t.objectStore("config").put({key:Z,value:K})}}function ce(e,t,n,r){if(!e.objectStoreNames.contains(n))return e.createObjectStore(n,{keyPath:r.keyPath});let o=t.objectStore(n);return j(o.keyPath,r.keyPath)?o:(e.deleteObjectStore(n),e.createObjectStore(n,{keyPath:r.keyPath}))}function de(e,t){let n=new Map(t.indices.map(r=>[r.name,r]));for(let r of ue(e.indexNames)){let o=n.get(r);(!o||!ee(e.index(r),o))&&e.deleteIndex(r)}for(let r of t.indices)e.indexNames.contains(r.name)||e.createIndex(r.name,r.keyPath,r.options)}function ee(e,t){return j(e.keyPath,t.keyPath)&&e.unique===(t.options?.unique===!0)&&e.multiEntry===(t.options?.multiEntry===!0)}function ue(e){let t=[];for(let n=0;n<e.length;n++){let r=e.item(n);r&&t.push(r)}return t}function j(e,t){return JSON.stringify(e)===JSON.stringify(t)}function Y(e){return new Promise((t,n)=>{let r=e===void 0?indexedDB.open(v):indexedDB.open(v,e);r.onerror=()=>{D=void 0,n(r.error)},r.onupgradeneeded=()=>se(r.result,r.transaction),r.onsuccess=()=>{let o=r.result;o.onversionchange=()=>{o.close(),D=void 0},t(o)}})}async function le(){let e;try{e=await Y(L)}catch(t){if(!fe(t))throw t;e=await Y()}if(await z(e)){let t=Math.max(e.version+1,L);if(e.close(),e=await Y(t),await z(e))throw e.close(),new Error("IndexedDB schema migration did not apply. Clear the sync-engine database and reload.")}return e}function X(){return D||(D=le()),D}async function z(e){return ye(e)?await pe(e)!==K:!0}function ye(e){let t=Object.keys(m);for(let n of t)if(!e.objectStoreNames.contains(n))return!1;try{let n=e.transaction(t,"readonly");for(let[r,o]of Object.entries(m)){let s=n.objectStore(r);if(!j(s.keyPath,o.keyPath))return!1;for(let a of o.indices)if(!s.indexNames.contains(a.name)||!ee(s.index(a.name),a))return!1}}catch{return!1}return!0}async function pe(e){if(!e.objectStoreNames.contains("config"))return;let t=e.transaction("config","readonly"),n=await E(t.objectStore("config").get(Z));return n?n.value:void 0}function fe(e){return e instanceof DOMException&&e.name==="VersionError"}function ge(e){return e instanceof DOMException&&e.name==="InvalidStateError"}async function g(e,t){let n=await X();try{return n.transaction(e,t)}catch(r){if(!ge(r))throw r;return n.close(),D=void 0,(await X()).transaction(e,t)}}async function _(e,t){C(e,t);let n=await g(e,"readwrite");n.objectStore(e).put(t),await O(n)}function C(e,t){let n=m[e];if(n&&typeof n.keyPath=="string"&&(t[n.keyPath]===void 0||t[n.keyPath]===null)){if(!/(TEXT|CHAR|CLOB|UUID)/i.test(n.primaryKeyType||""))throw new Error(`Cannot generate a client primary key for ${e}.${n.keyPath}: SQLite type ${n.primaryKeyType||"unknown"} is not text-compatible`);t[n.keyPath]=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`}}async function $(e){let t=await g("config","readonly"),n=await E(t.objectStore("config").get(e));return n?n.value:void 0}async function G(e,t){await _("config",{key:e,value:t})}function E(e){return new Promise((t,n)=>{e.onsuccess=()=>t(e.result),e.onerror=()=>n(e.error)})}async function P(e,t){let o=(await g(e,"readonly")).objectStore(e).get(t);return E(o)}async function te(e,t){let n=await g(e,"readwrite");n.objectStore(e).delete(t),await O(n)}async function k(e){let r=(await g(e,"readonly")).objectStore(e).getAll();return E(r)}async function ne(e,t,n){let o=(await g(e,"readonly")).objectStore(e),s=o.index(t);if(n===null||typeof n=="boolean"){let u=n,d=s.keyPath,y=o.getAll();return(await E(y)).filter(b=>b?.[d]===u)}let a=n===void 0?null:n,i=s.openCursor(a),c=[];return new Promise((u,d)=>{i.onsuccess=y=>{let S=y.target.result;if(!S){u(c);return}c.push(S.value),S.continue()},i.onerror=()=>d(i.error)})}function O(e){return new Promise((t,n)=>{e.oncomplete=()=>t(),e.onerror=()=>n(e.error),e.onabort=()=>n(e.error)})}var T,N;async function re(e){if(!e||typeof e!="object")throw new Error("Invalid query payload");let t=e,n=t.table,r=t.where,o=[],s=Date.now();switch(t.action){case"SELECT":{o=await F(t);let a=o.filter(i=>h(i,r));return t.action==="SELECT"&&t.select&&t.select.length?a.map(i=>{let c={};for(let u of t.select)c[u]=i[u];return c}):a}case"INSERT":{let a=t.insert,i=Array.isArray(a)?a:[a];if(!i.length)return V();let c=i.map(d=>({...d}));for(let d of c)C(n,d);let u=c.map(d=>H({entity:n,op_type:"insert",payload:{...d},created_at:s,processed:!1,attempts:0}));return await W(n,c,[],u),{affected:c.length,queued:u.length,opIds:u.map(d=>String(d.id)),rows:c}}case"UPDATE":{let a=t.update||{};o=await F(t);let i=o.filter(y=>h(y,t.where));if(!i.length)return V();let c=i.map(y=>({...y,...a})),u=x(n),d=c.map(y=>H({entity:n,op_type:"update",payload:{[u]:y[u],...a},created_at:s,processed:!1,attempts:0}));return await W(n,c,[],d),{affected:c.length,queued:d.length,opIds:d.map(y=>String(y.id)),rows:c}}case"DELETE":{o=await F(t);let a=o.filter(d=>h(d,t.where));if(!a.length)return V();let i=x(n),c=a.map(d=>d[i]),u=a.map(d=>H({entity:n,op_type:"delete",payload:{[i]:d[i]},created_at:s,processed:!1,attempts:0}));return await W(n,[],c,u),{affected:a.length,queued:u.length,opIds:u.map(d=>String(d.id)),rows:a}}default:throw new Error(`Unsupported query action: ${t.action}`)}}async function B(e="push"){if(T)return T;T=(async()=>{let t=ae(e);await p({type:l.syncStarted,syncId:t,reason:e});let n=[],r=0,o=[],s=new Set;try{n=await _e(J);for(let i of n){let c=String(i.entity||"");c&&s.add(c);try{await Se(i),await Ee(i),r++}catch(u){if(await he(i,u),o.push({opId:i.id||i.client_op_id||"unknown",error:w(u)}),Re(u))throw await I(),u}}r>0&&s.size>0&&await p({type:l.databaseChanged,tables:Array.from(s),source:"sync"});let a={sent:r,pending:Math.max(n.length-r,0),errors:o,tables:Array.from(s)};return await p({type:o.length?l.syncFailed:l.syncCompleted,syncId:t,reason:e,...a,error:o.length?`${o.length} operation(s) failed to sync.`:void 0}),a}catch(a){throw await p({type:l.syncFailed,syncId:t,reason:e,sent:r,pending:Math.max(n.length-r,0),errors:o,tables:Array.from(s),error:w(a)}),a}})();try{return await T}finally{T=void 0}}async function oe(){if(N)return N;N=(async()=>{let e="pull",t=ae(e);await p({type:l.syncStarted,syncId:t,reason:e});try{let n=Number(await $("lastRemoteOpsAt")||0),r=U.replace(/\/$/,""),o=await fetch(`${r}/operations?since=${encodeURIComponent(String(n))}`,{method:"GET",headers:{"Content-Type":"application/json"}});if(!o.ok)throw new Error(`GET operations failed with ${o.status}`);let s=await o.json();if(!Array.isArray(s))throw new Error("Operations endpoint returned a non-array response.");let a=0,i=n,c=[],u=new Set;for(let y of s){let S=f(y);try{let b=await we(S);b&&(u.add(b),a++);let Q=Number(S.created_at)||0;Q>i&&(i=Q)}catch(b){c.push(w(b));break}}i>n&&await G("lastRemoteOpsAt",String(i));let d={applied:a,errors:c,tables:Array.from(u)};return d.tables.length>0&&await p({type:l.databaseChanged,tables:d.tables,source:"sync"}),await p({type:c.length?l.syncFailed:l.syncCompleted,syncId:t,reason:e,...d,error:c.length?c[0]:void 0}),d}catch(n){throw await p({type:l.syncFailed,syncId:t,reason:e,applied:0,error:w(n)}),n}})();try{return await N}finally{N=void 0}}async function we(e){let t=typeof e.entity=="string"?e.entity:"";if(!t)throw new Error("Remote operation is missing its entity.");let n=String(e.op_type||"").toLowerCase(),r=f(ie(e.payload)),o=x(t);if(n==="insert"){let a=r.action==="insert"&&r.data?f(r.data):r;return await _(t,a),t}if(n==="update"){let a=r[o]??r.id??r.ID;if(a!=null){let i=f(await P(t,a)),c=r.action==="update"&&r.changes?f(r.changes):r;return await _(t,{...i,...c}),t}}let s=r[o]??r.id;if(n==="delete"&&s!==void 0&&s!==null)return await te(t,s),t}async function Se(e){let t=String(e.entity||"");if(!t||t==="operations")return;let n=String(e.op_type||"").toLowerCase(),r=f(ie(e.payload)),o=e.client_id||await be(),s=e.client_op_id||e.id||`${Date.now()}-${Math.random().toString(36).slice(2)}`,a=x(t);if(n==="insert"){let i=r.action==="insert"&&r.data?r.data:r,c=await q(t,"POST",{data:i,client_id:o,client_op_id:s});await me(t,a,s,c);return}if(n==="update"){let i=r[a]??r.id,c=r.action==="update"&&r.changes?f(r.changes):r;if(i==null)throw new Error(`Cannot sync update for ${t}: missing id`);await q(t,"PUT",{data:{...c,[a]:i},client_id:o,client_op_id:s});return}if(n==="delete"){let i=r[a]??r.id;if(i==null)throw new Error(`Cannot sync delete for ${t}: missing id`);await q(t,"DELETE",{id:i,client_id:o,client_op_id:s});return}throw new Error(`Unknown operation type: ${e.op_type}`)}async function q(e,t,n){let r=await fetch(`${U}/${encodeURIComponent(e)}`,{method:t,headers:{"Content-Type":"application/json"},body:JSON.stringify(n)});if(!r.ok){let o=await r.text().catch(()=>"");throw new Error(`${t} ${e} failed with ${r.status}: ${o}`)}return r.json().catch(()=>null)}async function me(e,t,n,r){let o=f(r);if(Object.keys(o).length===0)return;if(typeof o.client_op_id=="string"&&o.client_op_id!==n)throw new Error(`POST ${e} returned a mismatched client_op_id`);let s=o.data&&typeof o.data=="object"?f(o.data):o,a=s[t];if(a==null)throw new Error(`POST ${e} response is missing primary key "${t}"`);let i=f(await P(e,a));await _(e,{...i,...s})}async function _e(e){let n=(await g("operations","readonly")).objectStore("operations");return(await E(n.getAll())).filter(o=>o&&o.processed!==!0&&!o.sent_at).sort((o,s)=>Number(o.created_at||0)-Number(s.created_at||0)).slice(0,e)}async function Ee(e){let t={...e,processed:!0,sent_at:Date.now(),last_error:void 0};await _("operations",t)}async function he(e,t){let n={...e,attempts:Number(e.attempts||0)+1,last_error:w(t)};await _("operations",n)}function H(e){return C("operations",e),e.client_op_id||(e.client_op_id=String(e.id)),e}async function W(e,t,n,r){let o=Array.from(new Set([e,"operations"])),s=await g(o,"readwrite"),a=s.objectStore(e),i=s.objectStore("operations");for(let c of t)a.put(c);for(let c of n)a.delete(c);for(let c of r)i.put(c);await O(s)}function x(e){let t=m[e]?.keyPath;if(typeof t!="string"||!t)throw new Error(`Table "${e}" has no configured primary key`);return t}function V(){return{affected:0,queued:0,opIds:[],rows:[]}}async function be(){let e=await $("client_id");if(e)return e;let t=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;return await G("client_id",t),t}function ae(e){return`${e}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`}function ie(e){if(typeof e!="string")return e||{};try{return JSON.parse(e)}catch{return{}}}function Re(e){let t=w(e);return e instanceof TypeError||/failed to fetch|network|offline|timeout|temporar/i.test(t)}async function I(){try{let e=R.registration;e.sync?.register&&await e.sync.register(A)}catch{}}function w(e){return e instanceof Error?e.message:String(e)}async function p(e){let t=await R.clients.matchAll({includeUncontrolled:!0});for(let n of t)n.postMessage(e)}function f(e){return typeof e!="object"||e===null||Array.isArray(e)?{}:e}function h(e,t){return t?t.operator==="AND"&&t.where?t.where.every(n=>h(e,n)):t.operator==="OR"&&t.where?t.where.some(n=>h(e,n)):t.operator==="="&&t.field?e[t.field]===t.value:t.operator===">"&&t.field?e[t.field]>t.value:t.operator==="<"&&t.field?e[t.field]<t.value:!1:!0}async function F(e){let t=e.table,n=e.where;if(!n)return k(t);if(n.operator==="="&&n.field==="id")return P(t,n.value).then(o=>o?[o]:[]);if(n.operator==="="&&n.field)try{return ne(t,n.field,n.value)}catch{return(await k(t)).filter(s=>h(s,n))}return(await k(t)).filter(o=>h(o,n))}self.addEventListener("install",()=>{R.skipWaiting()});self.addEventListener("activate",e=>{e.waitUntil?.(R.clients.claim())});self.addEventListener("message",e=>{let t=e,n=t.data;if(!(!n||typeof n.type!="string")){if(n.type===l.registerSync||n.type==="REGISTER_SYNC"){t.waitUntil?.(I());return}if(n.type===l.updateRemote||n.type===l.backgroundSync||n.type==="UPDATE_REMOTE"||n.type==="BACKGROUND_SYNC"){let r=n.type===l.backgroundSync||n.type==="BACKGROUND_SYNC"?"background":"push";t.waitUntil?.(B(r).catch(async()=>{await I()}));return}if(n.type===l.syncNow){let r=typeof n.requestId=="string"?n.requestId:"",o=t;t.waitUntil?.(Te(r,o));return}if(n.type===l.remoteQuery){let r=typeof n.requestId=="string"?n.requestId:"",o=n.ast,s=t;t.waitUntil?.(De(r,o,s))}}});async function De(e,t,n){try{let r=t,o=r.action!=="SELECT",s=await re(t),a;if(o){let i=typeof r.table=="string"?r.table:void 0;await p({type:l.databaseChanged,table:i,tables:i?[i]:void 0,action:r.action,ast:t,source:"repo"}),a=B("push").then(()=>{}).catch(async()=>{await I()})}await M(n,{type:l.remoteQueryResult,requestId:e,ast:t,result:s}),await a}catch(r){await M(n,{type:l.remoteQueryError,requestId:e,ast:t,error:w(r)})}}async function Te(e,t){try{let n=await oe();await M(t,{type:l.syncNowResult,requestId:e,result:n})}catch(n){await M(t,{type:l.syncNowError,requestId:e,error:w(n)})}}async function M(e,t){let n=e.source;if(n&&typeof n.postMessage=="function")try{n.postMessage(t);return}catch{}if(e.ports?.length&&typeof e.ports[0]?.postMessage=="function"){e.ports[0].postMessage(t);return}await p(t)}self.addEventListener("sync",e=>{let t=e;!t.tag||t.tag!==A||t.waitUntil?.(B("background"))});
