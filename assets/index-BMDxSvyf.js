import k from"https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/+esm";import{initializeApp as T}from"https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";import{getAuth as $,GoogleAuthProvider as C,signOut as L}from"https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";import{getFirestore as O,getDoc as F,doc as v,setDoc as j}from"https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))n(i);new MutationObserver(i=>{for(const a of i)if(a.type==="childList")for(const s of a.addedNodes)s.tagName==="LINK"&&s.rel==="modulepreload"&&n(s)}).observe(document,{childList:!0,subtree:!0});function t(i){const a={};return i.integrity&&(a.integrity=i.integrity),i.referrerPolicy&&(a.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?a.credentials="include":i.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function n(i){if(i.ep)return;i.ep=!0;const a=t(i);fetch(i.href,a)}})();const z="modulepreload",q=function(r){return"/datasharingApp/"+r},S={},H=function(e,t,n){let i=Promise.resolve();if(t&&t.length>0){document.getElementsByTagName("link");const s=document.querySelector("meta[property=csp-nonce]"),c=(s==null?void 0:s.nonce)||(s==null?void 0:s.getAttribute("nonce"));i=Promise.allSettled(t.map(l=>{if(l=q(l),l in S)return;S[l]=!0;const w=l.endsWith(".css"),y=w?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${l}"]${y}`))return;const f=document.createElement("link");if(f.rel=w?"stylesheet":z,w||(f.as="script"),f.crossOrigin="",f.href=l,c&&f.setAttribute("nonce",c),document.head.appendChild(f),w)return new Promise((E,g)=>{f.addEventListener("load",E),f.addEventListener("error",()=>g(new Error(`Unable to preload CSS for ${l}`)))})}))}function a(s){const c=new Event("vite:preloadError",{cancelable:!0});if(c.payload=s,window.dispatchEvent(c),!c.defaultPrevented)throw s}return i.then(s=>{for(const c of s||[])c.status==="rejected"&&a(c.reason);return e().catch(a)})};async function M(){try{return(await H(()=>import("./dcrypt_wasm-Covpn6oq.js"),[])).default}catch(r){throw console.error("Failed to load WASM module:",r),r}}class U{constructor(e){this.peers=new Map,this.channels=new Map,this.knownObjects=new Map,this.chunkToPeerMap=new Map,this.pendingRequests=new Map,this.db=null,this.keypair=e,this.activeNodes=new Set,this.offlineQueue=[],this.peerId=null}async initDB(){return new Promise((e,t)=>{const n=indexedDB.open("dcrypt_db",3);n.onupgradeneeded=()=>{const i=n.result;i.objectStoreNames.contains("store")||i.createObjectStore("store",{keyPath:"id"}),i.objectStoreNames.contains("transactions")||i.createObjectStore("transactions",{keyPath:"id",autoIncrement:!0}),i.objectStoreNames.contains("offlineQueue")||i.createObjectStore("offlineQueue",{keyPath:"id",autoIncrement:!0}),i.objectStoreNames.contains("chunkCache")||i.createObjectStore("chunkCache",{keyPath:"id"})},n.onsuccess=()=>{this.db=n.result,this.loadIdentity(),this.loadOfflineQueue(),this.loadTransactions(),e()},n.onerror=i=>t(new Error(`Failed to initialize IndexedDB: ${i.target.error.message}`))})}async syncUserData(){if(!this.db)throw new Error("IndexedDB not initialized");try{await this.dbPut("store",{id:"dcrypt_identity",value:this.uint8ArrayToHex(this.keypair)}),await this.putBalance(this.keypair,await this.getBalance(this.keypair)||0)}catch(e){throw console.error("Sync failed:",e),e}}async saveUserData(){if(!this.db)throw new Error("IndexedDB not initialized");try{await this.dbPut("store",{id:"dcrypt_identity",value:this.uint8ArrayToHex(this.keypair)}),await this.updateBalance()}catch(e){throw console.error("Save failed:",e),e}}async initSwarm(){try{this.peerId=this.uint8ArrayToHex(this.keypair.slice(0,16)),console.log("Peer ID:",this.peerId),setInterval(()=>this.discoverPeers(),5e3)}catch(e){throw console.error("initSwarm failed:",e),e}}discoverPeers(){console.log("Discovering peers...");const e="mock-peer-"+Math.random().toString(36).substr(2,9);this.peers.has(e)||(this.peers.set(e,{connected:!1}),console.log("Discovered peer:",e))}async publishChunk(e,t){if(!this.db)throw new Error("IndexedDB not initialized");try{if(console.log("publishChunk: chunkHash=",e,"chunkData=",t),!e||typeof e!="string"||e.trim()==="")throw new Error("Invalid chunk hash");typeof t!="string"&&(t=String(t)),await this.dbPut("chunkCache",{id:e,value:t}),this.chunkToPeerMap.set(e,this.peerId),this.broadcastChunk(e)}catch(n){throw console.error("publishChunk failed:",n),n}}broadcastChunk(e){this.peers.forEach((t,n)=>{t.connected&&console.log(`Broadcasting chunk ${e} to ${n}`)})}async publishIP(e,t){if(!this.db)throw new Error("IndexedDB not initialized");try{const n=await this.hashObject(e);if(!n||typeof n!="string"||n.trim()==="")throw new Error("Invalid IP hash");const i=await Promise.all(t.map(s=>this.hashChunk(s)));t.forEach((s,c)=>{console.log("publishIP: Generated chunk hash=",i[c],"for chunk=",s)});const a={metadata:e,chunks:i};this.knownObjects.set(n,a),await this.dbPut("store",{id:n,value:JSON.stringify(a)});for(let s=0;s<t.length;s++){const c=t[s],l=i[s];await this.publishChunk(l,c)}this.broadcastIP(n)}catch(n){throw console.error("publishIP failed:",n),n}}broadcastIP(e){this.peers.forEach((t,n)=>{t.connected&&console.log(`Broadcasting IP ${e} to ${n}`)})}async requestData(e){if(!this.db)throw new Error("IndexedDB not initialized");try{if(!e||typeof e!="string")throw new Error("Invalid hash");const t=this.chunkToPeerMap.get(e);if(t&&this.peers.has(t)&&this.peers.get(t).connected)return await this.fetchChunkFromPeer(t,e);throw new Error("No available peer for requested data")}catch(t){throw console.error("requestData failed:",t),t}}async fetchChunkFromPeer(e,t){return new Promise(n=>setTimeout(()=>n(`Mock data for ${t}`),1e3))}async getBalance(e){if(!this.db)throw new Error("IndexedDB not initialized");const t=await this.dbGet("store","balance_"+this.uint8ArrayToHex(e));return t&&t.value?parseFloat(t.value):0}async putBalance(e,t){if(!this.db)throw new Error("IndexedDB not initialized");await this.dbPut("store",{id:"balance_"+this.uint8ArrayToHex(e),value:t.toString()})}async updateBalance(){if(!this.db)throw new Error("IndexedDB not initialized");const e=await this.getBalance(this.keypair);await this.putBalance(this.keypair,e)}async queueOfflineOperation(e){if(!this.db)throw new Error("IndexedDB not initialized");this.offlineQueue.push(e),await this.dbAdd("offlineQueue",{id:Date.now().toString(),value:e})}loadIdentity(){this.db&&this.dbGet("store","dcrypt_identity").then(e=>{e&&e.value&&typeof e.value=="string"&&(this.keypair=this.hexToUint8Array(e.value))})}loadOfflineQueue(){this.db&&this.dbGetAll("offlineQueue").then(e=>this.offlineQueue=e.map(t=>t.value))}loadTransactions(){this.db&&this.dbGetAll("transactions").then(e=>console.log("Loaded transactions:",e.map(t=>t.value)))}async dbPut(e,t){if(!this.db)throw new Error("IndexedDB not initialized");return new Promise((n,i)=>{const c=this.db.transaction(e,"readwrite").objectStore(e).put(t);c.onsuccess=n,c.onerror=l=>i(new Error(`DB put failed: ${l.target.error.message}`))})}async dbAdd(e,t){if(!this.db)throw new Error("IndexedDB not initialized");return new Promise((n,i)=>{const c=this.db.transaction(e,"readwrite").objectStore(e).add(t);c.onsuccess=n,c.onerror=l=>i(new Error(`DB add failed: ${l.target.error.message}`))})}async dbGet(e,t){if(!this.db)throw new Error("IndexedDB not initialized");return new Promise((n,i)=>{const c=this.db.transaction(e,"readonly").objectStore(e).get(t);c.onsuccess=()=>n(c.result),c.onerror=l=>i(new Error(`DB get failed: ${l.target.error.message}`))})}async dbGetAll(e){if(!this.db)throw new Error("IndexedDB not initialized");return new Promise((t,n)=>{const s=this.db.transaction(e,"readonly").objectStore(e).getAll();s.onsuccess=()=>t(s.result),s.onerror=c=>n(new Error(`DB getAll failed: ${c.target.error.message}`))})}async hashObject(e){const t=k.MD5(JSON.stringify(e)).toString();return console.log("hashObject: Generated hash=",t,"for object=",e),t}async hashChunk(e){if(typeof e!="string"&&(e=String(e)),!e)throw new Error("Chunk cannot be empty");const t=k.MD5(e).toString();if(console.log("hashChunk: Generated hash=",t,"for chunk=",e),!t||typeof t!="string")throw new Error("Failed to generate a valid chunk hash");return t}uint8ArrayToHex(e){return Array.from(e).map(t=>t.toString(16).padStart(2,"0")).join("")}hexToUint8Array(e){if(!e||typeof e!="string")return new Uint8Array(0);const t=e.match(/.{1,2}/g);return t?new Uint8Array(t.map(n=>parseInt(n,16))):new Uint8Array(0)}}const _={apiKey:"AIzaSyBrdrwvY-lPObZgortEgw7YWycUOGsBlyM",authDomain:"dcrypt-edb9c.firebaseapp.com",projectId:"dcrypt-edb9c",storageBucket:"dcrypt-edb9c.firebasestorage.app",messagingSenderId:"952133736604",appId:"1:952133736604:web:32d799360f200bce84f559",measurementId:"G-7KCDLQ6JNH"},D=T(_),m=$(D),A=O(D);let G=null,o=null,h=null;document.addEventListener("DOMContentLoaded",()=>{const r=document.getElementById("loginButton"),e=document.getElementById("logoutButton");getRedirectResult(m).then(t=>{t&&t.user&&(h=t.user,r.classList.add("hidden"),e.classList.remove("hidden"),I().catch(console.error))}).catch(t=>{console.error("Sign-in redirect failed:",t.code,t.message),d(`Sign-in failed: ${t.message}`)}),m.onAuthStateChanged(t=>{t?(h=t,r.classList.add("hidden"),e.classList.remove("hidden"),o||I().catch(console.error)):(h=null,r.classList.remove("hidden"),e.classList.add("hidden"))}),r.addEventListener("click",async()=>{try{const t=new C;await signInWithRedirect(m,t)}catch(t){console.error("Sign-in failed:",t.code,t.message),d(`Sign-in failed: ${t.message}`)}})});async function I(){console.log("Initializing app..."),u(!0);try{let r;const e=await N();e&&e.keypair?(r=o.hexToUint8Array(e.keypair),await Q(e)):(r=new Uint8Array(32),crypto.getRandomValues(r)),console.log("Loading WASM module..."),G=await M(),console.log("WASM module loaded successfully."),console.log("Initializing DHT..."),o=new U(r),window.dht=o,await o.initDB(),await o.initSwarm(),console.log("DHT initialized."),console.log("Syncing user data..."),await o.syncUserData(),console.log("Updating live feed..."),x(),console.log("Live feed updated."),await B(),"serviceWorker"in navigator&&console.log("Service worker registration skipped for debugging")}catch(r){console.error("Error initializing application:",r),d(`Initialization failed: ${r.message}`)}finally{u(!1),X(),ee()}}async function N(){if(!h)return null;try{const r=await F(v(A,"users",h.uid));return r.exists()?r.data():null}catch(r){return console.error("Failed to fetch user data from Firebase:",r),d(`Failed to fetch user data: ${r.message}`),null}}async function Q(r){if(!(!o||!r))try{if(r.keypair&&await o.dbPut("store",{id:"dcrypt_identity",value:r.keypair}),r.balance!==void 0&&await o.putBalance(o.keypair,r.balance),r.transactions)for(const e of r.transactions)await o.dbAdd("transactions",e);if(r.chunkCache)for(const[e,t]of Object.entries(r.chunkCache))await o.dbPut("chunkCache",{id:e,value:t})}catch(e){console.error("Failed to restore IndexedDB:",e),d(`Failed to restore data: ${e.message}`)}}async function R(){if(!o)return null;try{const r=await o.dbGet("store","dcrypt_identity"),e=await o.getBalance(o.keypair),t=await o.dbGetAll("transactions"),n=await o.dbGetAll("chunkCache"),i={};return n.forEach(a=>{i[a.id]=a.value}),{keypair:r?r.value:null,balance:e,transactions:t,chunkCache:i}}catch(r){return console.error("Failed to export IndexedDB:",r),null}}async function b(){if(!h)return;const r=3;let e=0;for(;e<r;)try{const t=await R();if(t){await j(v(A,"users",h.uid),t,{merge:!0}),console.log(`Firestore updated for user ${h.uid} at ${new Date().toISOString()}`);return}}catch(t){if(e++,console.error(`Failed to upload user data to Firebase (attempt ${e}/${r}):`,t),e===r){console.error("Max retries reached. Data not synced to Firestore."),d("Failed to sync data to Firestore. Please try again later.");return}await new Promise(n=>setTimeout(n,2e3))}}window.onunload=()=>{h&&console.log("Session closing, relying on periodic sync for data upload")};async function B(){if(!o)return;const r=await o.getBalance(o.keypair),e=document.getElementById("userBalance");e&&(e.textContent=`Balance: ${r}`)}async function W(r,e,t,n,i){if(!p()){d("Please sign in to publish.");return}u(!0);try{if(!o)throw new Error("DHT not initialized");if(!r)throw new Error("Title is required");let a=n||"";if(i&&i.files&&i.files.length>0){const w=i.files[0],y=new FileReader;a=await new Promise((f,E)=>{y.onload=g=>f(g.target.result),y.onerror=g=>E(new Error("Failed to read file")),y.readAsText(w)})}else if(!a)throw new Error("Content or file is required");const s=document.getElementById("isPremium").checked,c={content_type:r,description:e||"",tags:t?t.split(",").map(w=>w.trim()):[],isPremium:s},l=[a];await o.publishIP(c,l),d("Snippet published successfully!"),x(),P(),B(),await b()}catch(a){console.error("publishSnippet failed:",a),d(`Publish failed: ${a.message}`)}finally{u(!1)}}async function J(r){if(!p())return d("Please sign in to search."),[];u(!0);try{if(!o)throw new Error("DHT not initialized");const e=Array.from(o.knownObjects.entries()).filter(([t,n])=>n.metadata.content_type.includes(r)||n.metadata.description&&n.metadata.description.includes(r)).map(([t,n])=>({hash:t,...n.metadata}));return d(`Found ${e.length} results`),e}catch(e){return console.error("searchSnippets failed:",e),d(`Search failed: ${e.message}`),[]}finally{u(!1)}}async function K(r){if(!p())return d("Please sign in to buy."),null;u(!0);try{if(!o)throw new Error("DHT not initialized");if(!r)throw new Error("Hash is required");const e=o.knownObjects.get(r);if(!e)throw new Error("Snippet not found");const n=e.metadata.isPremium||!1?30:5,i=await o.getBalance(o.keypair);if(i<n)throw new Error("Insufficient balance");await o.putBalance(o.keypair,i-n),await o.dbAdd("transactions",{type:"buy",amount:n,timestamp:Date.now()});const a=await o.requestData(r);return await o.dbPut("chunkCache",{id:r,value:a}),d("Snippet purchased and cached!"),P(),B(),await b(),a}catch(e){return console.error("buySnippet failed:",e),d(`Purchase failed: ${e.message}`),null}finally{u(!1)}}async function V(r){if(!p()){d("Please sign in to withdraw.");return}u(!0);try{if(!o)throw new Error("DHT not initialized");if(!r||r<=0)throw new Error("Valid amount required");const e=await o.getBalance(o.keypair);if(e<r)throw new Error("Insufficient balance");await o.putBalance(o.keypair,e-r),await o.dbAdd("transactions",{type:"withdraw",amount:r,timestamp:Date.now()}),d(`Withdrawn ${r} successfully!`),P(),B(),await b()}catch(e){console.error("withdraw failed:",e),d(`Withdrawal failed: ${e.message}`)}finally{u(!1)}}function Y(){if(!p()){d("Please sign in to view history.");return}const r=document.getElementById("transactionHistory");r&&(r.style.display=r.style.display==="none"?"block":"none")}async function Z(r){if(!p())return d("Please sign in to load data."),null;u(!0);try{if(!o)throw new Error("DHT not initialized");if(!r)throw new Error("Hash is required");const e=await o.requestData(r);return d("Data loaded successfully!"),e}catch(e){return console.error("requestData failed:",e),d(`Data request failed: ${e.message}`),null}finally{u(!1)}}function x(){if(!p()||!o)return;const r=document.querySelector("#publishedItems tbody");r&&(r.innerHTML="",Array.from(o.knownObjects.entries()).forEach(([e,t])=>{const n=document.createElement("tr"),i=t.metadata.content_type||"Untitled",a=t.metadata.description||"No description",s=t.metadata.tags[0]||"No Tag";n.innerHTML=`
      <td>${i}</td>
      <td>${a}</td>
      <td>${s}</td>
      <td><button onclick="requestData('${e}')">Load Data</button></td>
    `,r.appendChild(n)}))}function P(){if(!p()||!o)return;const r=document.getElementById("transactionList");r&&o.dbGetAll("transactions").then(e=>{r.innerHTML=e.map(t=>`<p>${t.type}: ${t.amount} at ${new Date(t.timestamp).toLocaleString()}</p>`).join("")||"No transactions yet."})}function X(){const r=document.getElementById("publishButton"),e=document.getElementById("searchButton"),t=document.getElementById("buyButton"),n=document.getElementById("withdrawButton"),i=document.getElementById("toggleHistoryButton");r&&(r.disabled=!1),e&&(e.disabled=!1),t&&(t.disabled=!1),n&&(n.disabled=!1),i&&(i.disabled=!1),window.init=I,window.publishSnippet=W,window.searchSnippets=J,window.buySnippet=K,window.withdraw=V,window.toggleTransactionHistory=Y,window.requestData=Z,window.logout=te}function ee(){const r=document.getElementById("isPremium"),e=document.getElementById("withdrawAmount");r&&e&&r.addEventListener("change",()=>{e.classList.toggle("hidden",!r.checked),r.checked||(e.value="")})}function u(r){const e=document.getElementById("loading");e?e.style.display=r?"flex":"none":console.warn(`showLoading: Loading element not found (state: ${r})`)}function d(r){const e=document.getElementById("toast");e?(e.textContent=r,e.style.display="block",setTimeout(()=>e.style.display="none",3e3)):console.warn(`showToast: Toast element not found, logging message: ${r}`)}function p(){return!!h}async function te(){try{await b(),await L(m),h=null,window.location.reload()}catch(r){console.error("Logout failed:",r),d(`Logout failed: ${r.message}`)}}
