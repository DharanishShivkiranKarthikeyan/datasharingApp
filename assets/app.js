import{initializeApp as ce}from"https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";import{getAuth as le,GoogleAuthProvider as j,signInWithPopup as _,onAuthStateChanged as X,signOut as de}from"https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";import{getFirestore as ue,getDocs as N,collection as q,doc as B,setDoc as D,getDoc as ee,updateDoc as M,increment as he}from"https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";import"https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/+esm";import te from"https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))s(n);new MutationObserver(n=>{for(const r of n)if(r.type==="childList")for(const a of r.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&s(a)}).observe(document,{childList:!0,subtree:!0});function t(n){const r={};return n.integrity&&(r.integrity=n.integrity),n.referrerPolicy&&(r.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?r.credentials="include":n.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function s(n){if(n.ep)return;n.ep=!0;const r=t(n);fetch(n.href,r)}})();const pe={apiKey:"AIzaSyBrdrwvY-lPObZgortEgw7YWycUOGsBlyM",authDomain:"dcrypt-edb9c.firebaseapp.com",projectId:"dcrypt-edb9c",storageBucket:"dcrypt-edb9c.firebasestorage.app",messagingSenderId:"952133736604",appId:"1:952133736604:web:32d799360f200bce84f559",measurementId:"G-7KCDLQ6JNH"},ne=ce(pe),v=le(ne),x=ue(ne);var Z;const $=(Z=globalThis.crypto)==null?void 0:Z.subtle;if(!$)throw new Error("Web Crypto API is not available in this environment");function fe(){const o=new Uint8Array(12);for(let e=0;e<12;e++)o[e]=Math.floor(Math.random()*256);return o}function ge(o,e,t,s,n,r,a){return{content:new Uint8Array(o),content_type:e,tags:t||[],is_premium:s,price_usd:n,creator_id:new Uint8Array(r),file_type:a}}function me(o){return o.content}async function oe(o){const e=await $.digest("SHA-256",o);return new Uint8Array(e)}async function ye(o,e,t){const s=o.content,n=Math.ceil(s.length/t),r=[],a=await $.importKey("raw",new Uint8Array(e.slice(0,32)),{name:"AES-GCM"},!1,["encrypt"]);for(let i=0;i<t;i++){const c=i*n,l=Math.min(c+n,s.length),h=s.slice(c,l),p=fe(),m=await $.encrypt({name:"AES-GCM",iv:p},a,h),y={data:new Uint8Array(m),nonce:p,index:i,file_type:o.file_type};r.push(y)}return r}function we(o){const e=new Uint8Array(new Int32Array([o.index]).buffer),t=new Uint8Array([...o.data,...o.nonce,...e]);return oe(t)}function G(o){return o.index}async function be(o,e){const t=await $.importKey("raw",new Uint8Array(e.slice(0,32)),{name:"AES-GCM"},!1,["decrypt"]),s=await $.decrypt({name:"AES-GCM",iv:o.nonce},t,o.data);return new Uint8Array(s)}function xe(o){return o.file_type}class se{constructor(e,t=!1){this.peers=new Map,this.channels=new Map,this.knownObjects=new Map,this.chunkToPeerMap=new Map,this.pendingRequests=new Map,this.db=null,this.keypair=e,this.activeNodes=new Set,this.nodes=new Set,this.offlineQueue=[],this.isNode=t,this.peerId=null,this.peer=null,this.connectionAttempts=new Map,this.maxConnectionAttempts=3,this.connectionRetryDelay=5e3,this.averageLatency=0,this.initializeKnownNodes()}async initializeKnownNodes(){const e=async()=>{try{const t=await N(q(x,"nodes"));this.nodes.clear(),t.empty?console.warn("No nodes found in Firestore. Using empty node list."):t.forEach(s=>{const n=`node-${s.id}`;this.nodes.add(n)}),console.log("Fetched nodes:",Array.from(this.nodes))}catch(t){console.error("Failed to fetch nodes from Firestore:",t),this.nodes.clear(),console.warn("No nodes available. Peer discovery will be limited to regular peers.")}};await e(),setInterval(e,5*60*1e3)}async measureLatency(){const e=[],t=Array.from(this.activeNodes).slice(0,5);for(const s of t){const n=this.peers.get(s);if(n&&n.connected&&n.conn){const r=Date.now();await new Promise(i=>{const c=`${s}-ping-${Date.now()}`;n.conn.send({type:"ping",requestId:c}),this.pendingRequests.set(c,{resolve:i}),setTimeout(()=>{this.pendingRequests.has(c)&&(this.pendingRequests.delete(c),i())},2e3)});const a=Date.now()-r;e.push(a)}}this.averageLatency=e.length>0?e.reduce((s,n)=>s+n,0)/e.length:0,console.log(`Average latency: ${this.averageLatency} ms`)}async initDB(){return new Promise((e,t)=>{const s=indexedDB.open("dcrypt_db",3);s.onupgradeneeded=()=>{const n=s.result;n.objectStoreNames.contains("store")||n.createObjectStore("store",{keyPath:"id"}),n.objectStoreNames.contains("transactions")||n.createObjectStore("transactions",{keyPath:"id",autoIncrement:!0}),n.objectStoreNames.contains("offlineQueue")||n.createObjectStore("offlineQueue",{keyPath:"id",autoIncrement:!0}),n.objectStoreNames.contains("chunkCache")||n.createObjectStore("chunkCache",{keyPath:"id"})},s.onsuccess=()=>{this.db=s.result,this.loadIdentity(),this.loadOfflineQueue(),this.loadTransactions(),console.log("IndexedDB initialized successfully"),e()},s.onerror=n=>{console.error("Failed to initialize IndexedDB:",n.target.error),t(new Error(`Failed to initialize IndexedDB: ${n.target.error.message}`))}})}async syncUserData(){if(!this.db)throw new Error("IndexedDB not initialized");try{await this.dbPut("store",{id:"dcrypt_identity",value:this.uint8ArrayToHex(this.keypair)}),await this.updateBalance(),this.activeNodes.size>0&&await this.processOfflineQueue();const e={type:"userData",peerId:this.peerId,keypair:this.uint8ArrayToHex(this.keypair),balance:await this.getBalance(this.keypair),timestamp:Date.now()};this.broadcast(e),console.log("User data synced successfully")}catch(e){throw console.error("Sync failed:",e),e}}async saveUserData(){if(!this.db)throw new Error("IndexedDB not initialized");try{await this.dbPut("store",{id:"dcrypt_identity",value:this.uint8ArrayToHex(this.keypair)}),await this.updateBalance(),console.log("User data saved to IndexedDB")}catch(e){throw console.error("Save failed:",e),e}}async initSwarm(){try{const e=new TextDecoder().decode(this.keypair);return this.peerId=this.isNode?`node-${e}`:e,console.log("Initializing PeerJS with Peer ID:",this.peerId),this.peer=new te(this.peerId,{host:"0.peerjs.com",port:443,path:"/",secure:!0,debug:2}),new Promise((t,s)=>{this.peer.on("open",n=>{console.log(`PeerJS connection opened with ID: ${n}`),this.activeNodes.add(this.peerId),this.peer.on("connection",r=>{this.handleConnection(r)}),this.peer.on("error",r=>{var a;if(console.error("PeerJS error:",r.type,r.message),r.type==="peer-unavailable"){const i=(a=r.message.match(/Peer (.+) is unavailable/))==null?void 0:a[1];i&&this.handlePeerDisconnect(i)}}),this.peer.on("disconnected",()=>{console.log("PeerJS disconnected. Attempting to reconnect..."),this.peer.reconnect()}),setInterval(()=>this.discoverPeers(),5e3),setInterval(()=>this.measureLatency(),6e4),t()}),this.peer.on("error",n=>{console.error("Failed to initialize PeerJS:",n),s(n)})})}catch(e){throw console.error("initSwarm failed:",e),e}}discoverPeers(){console.log("Discovering peers..."),console.log("My peer ID:",this.peerId),console.log("Known peer IDs:",Array.from(this.nodes));const e=[...Array.from(this.nodes)].filter(t=>t!==this.peerId);if(e.length===0){console.warn("No known peers to connect to. Waiting for nodes to be discovered.");return}e.forEach(t=>{this.peers.has(t)||(this.peers.set(t,{connected:!1,conn:null}),console.log("Discovered peer:",t),this.connectToPeer(t))}),this.peers.forEach((t,s)=>{!t.connected&&this.connectionAttempts.get(s)>=this.maxConnectionAttempts&&(console.log(`Removing unreachable peer: ${s}`),this.peers.delete(s),this.connectionAttempts.delete(s),this.activeNodes.delete(s))})}connectToPeer(e){var n;if((n=this.peers.get(e))!=null&&n.connected)return;const t=this.connectionAttempts.get(e)||0;if(t>=this.maxConnectionAttempts)return;console.log(`Attempting to connect to peer: ${e} (Attempt ${t+1}/${this.maxConnectionAttempts})`);const s=this.peer.connect(e,{reliable:!0});s.on("open",()=>{console.log(`Connected to peer: ${e}`),this.peers.set(e,{connected:!0,conn:s}),this.activeNodes.add(e),this.connectionAttempts.delete(e),s.send({type:"handshake",peerId:this.peerId})}),s.on("data",r=>{this.handlePeerData(r,e)}),s.on("close",()=>{console.log(`Connection closed with peer: ${e}`),this.handlePeerDisconnect(e)}),s.on("error",r=>{console.warn(`Connection error with peer ${e}: ${r.message}`),this.handlePeerDisconnect(e)}),this.connectionAttempts.set(e,t+1)}handleConnection(e){const t=e.peer;console.log(`Incoming connection from peer: ${t}`),this.peers.set(t,{connected:!0,conn:e}),this.activeNodes.add(t),e.on("data",s=>{this.handlePeerData(s,t)}),e.on("close",()=>{console.log(`Connection closed with peer: ${t}`),this.handlePeerDisconnect(t)}),e.on("error",s=>{console.error(`Connection error with peer ${t}:`,s),this.handlePeerDisconnect(t)})}handlePeerDisconnect(e){const t=this.peers.get(e);t&&(t.connected=!1,t.conn=null,this.activeNodes.delete(e),console.log(`Peer disconnected: ${e}. Will attempt to reconnect on next discovery.`))}handlePeerData(e,t){switch(console.log(`Received data from peer ${t}:`,e),e.type){case"handshake":console.log(`Handshake received from peer: ${t}`),this.activeNodes.add(t);break;case"chunk":this.chunkToPeerMap.set(e.chunkHash,new Set([...this.chunkToPeerMap.get(e.chunkHash)||[],t])),console.log(`Updated chunkToPeerMap for chunk ${e.chunkHash} with peer ${t}`);break;case"ip":this.knownObjects.set(e.ipHash,{metadata:e.metadata,chunks:e.chunkHashes}),this.dbPut("store",{id:e.ipHash,value:JSON.stringify({metadata:e.metadata,chunks:e.chunkHashes})}),console.log(`Received IP ${e.ipHash} from peer ${t}`);break;case"chunkRequest":this.handleChunkRequest(e,t);break;case"chunkResponse":this.handleChunkResponse(e);break;case"userData":console.log(`Received user data from peer ${t}:`,e);break;case"storeChunk":this.storeChunkFromPeer(e.chunkHash,e.chunkData,t);break;case"ping":const s=this.peers.get(t);s&&s.connected&&s.conn&&s.conn.send({type:"pong",requestId:e.requestId});break;case"pong":const n=this.pendingRequests.get(e.requestId);n&&(n.resolve(),this.pendingRequests.delete(e.requestId));break;case"commission":console.log(`Received commission of ${e.amount}. New balance: ${e.newBalance}`);break;default:console.warn(`Unknown data type received from peer ${t}:`,e.type)}}async storeChunkFromPeer(e,t,s){try{await this.dbPut("chunkCache",{id:e,value:t});let n=this.chunkToPeerMap.get(e)||new Set;n.add(this.peerId),this.chunkToPeerMap.set(e,n),console.log(`Stored chunk ${e} from peer ${s}`)}catch(n){console.error(`Failed to store chunk ${e} from peer ${s}:`,n)}}async publishChunk(e,t,s,n){if(!this.db)throw new Error("IndexedDB not initialized");try{if(console.log("publishChunk: chunkHash=",e,"chunkData=",t),!e||typeof e!="string"||e.trim()==="")throw new Error("Invalid chunk hash");await this.dbPut("chunkCache",{id:e,value:t});let r=this.chunkToPeerMap.get(e)||new Set;if(r.add(this.peerId),this.chunkToPeerMap.set(e,r),this.activeNodes.size>0){const a=Array.from(this.activeNodes).filter(c=>c.startsWith("node-"));if(a.length>0){const c=s%a.length,l=a[c],h=this.peers.get(l);h&&h.connected&&h.conn&&(h.conn.send({type:"storeChunk",chunkHash:e,chunkData:t,peerId:this.peerId}),r.add(l),this.chunkToPeerMap.set(e,r),console.log(`Sent chunk ${e} to node ${l}`))}const i=Array.from(this.activeNodes).filter(c=>!c.startsWith("node-")&&c!==this.peerId);if(i.length>0){const c=i[Math.floor(Math.random()*i.length)],l=this.peers.get(c);l&&l.connected&&l.conn&&(l.conn.send({type:"storeChunk",chunkHash:e,chunkData:t,peerId:this.peerId}),r.add(c),this.chunkToPeerMap.set(e,r),console.log(`Sent chunk ${e} to random peer ${c}`))}}else await this.queueOfflineOperation({type:"publishChunk",chunkHash:e,chunkData:t,chunkIndex:s,totalChunks:n});this.broadcastChunk(e)}catch(r){throw console.error("publishChunk failed:",r),r}}broadcastChunk(e){const t={type:"chunk",chunkHash:e,peerId:this.peerId};this.broadcast(t),console.log(`Broadcasted chunk ${e} to ${this.activeNodes.size} peers`)}async publishIP(e,t,s){if(!this.db)throw new Error("IndexedDB not initialized");if(!this.keypair)throw new Error("Keypair not initialized");try{const n=Array.isArray(e.tags)?e.tags.map(f=>typeof f!="string"?(console.warn(`Invalid tag: ${f}, converting to string`),String(f)):f).filter(f=>f.trim()!==""):[];console.log("Processed tags:",n);const r=!!e.isPremium,a=r?e.priceUsd||30:0,i=new Uint8Array(t),c=e.content_type||"",l=this.keypair instanceof Uint8Array?this.keypair:new Uint8Array(this.keypair),p=ge(i,c,n,r,a,l,s||"text/plain"),m=me(p),y=await oe(m),w=this.uint8ArrayToHex(y),g=Array.from(this.activeNodes).filter(f=>f.startsWith("node-")),I=g.length>0?g.length:1,b=await ye(p,Array.from(this.keypair),I),S=[];for(let f=0;f<b.length;f++){const F=b[f],O=await we(F),ae=this.uint8ArrayToHex(O);S.push(ae)}const E={...e,chunk_count:b.length,isPremium:r,priceUsd:r?a:0},Q={metadata:E,chunks:S};this.knownObjects.set(w,Q),await this.dbPut("store",{id:w,value:JSON.stringify(Q)});for(let f=0;f<b.length;f++){const F=b[f],O=S[f];await this.publishChunk(O,F,f,b.length)}return this.activeNodes.size>0?this.broadcastIP(w,E,S):await this.queueOfflineOperation({type:"publishIP",ipHash:w,metadata:E,chunkHashes:S}),w}catch(n){throw console.error("publishIP failed:",n),n}}broadcastIP(e,t,s){const n={type:"ip",ipHash:e,metadata:t,chunkHashes:s,peerId:this.peerId};this.broadcast(n),console.log(`Broadcasted IP ${e} to ${this.activeNodes.size} peers`)}async requestData(e){if(!this.db)throw new Error("IndexedDB not initialized");try{if(!e||typeof e!="string")throw new Error("Invalid IP hash");const t=this.knownObjects.get(e);if(!t)throw new Error("IP not found");const s=[];for(const l of t.chunks){const h=await this.dbGet("chunkCache",l);if(h&&h.value){s.push({chunk:h.value,hash:l});continue}const p=this.chunkToPeerMap.get(l);if(!p||p.size===0)throw new Error(`No peers found with chunk ${l}`);const m=Array.from(p).filter(I=>I.startsWith("node-")),y=Array.from(p).filter(I=>!I.startsWith("node-"));let w=!1,g=null;for(const I of[...m,...y])if(this.activeNodes.has(I))try{const b=await this.fetchChunkFromPeer(I,l);await this.dbPut("chunkCache",{id:l,value:b}),s.push({chunk:b,hash:l}),w=!0;break}catch(b){g=b,console.error(`Failed to fetch chunk ${l} from peer ${I}:`,b);continue}if(!w)throw g||new Error(`No available peer for chunk ${l}`)}const n=s.sort((l,h)=>{const p=G(l.chunk),m=G(h.chunk);return p-m}),r=[];for(const{chunk:l}of n){const h=await be(l,Array.from(this.keypair));r.push(h)}const a=new Uint8Array(r.reduce((l,h)=>l+h.length,0));let i=0;for(const l of r)a.set(l,i),i+=l.length;const c=xe(n[0].chunk);return{data:a,fileType:c}}catch(t){throw console.error("requestData failed:",t),t}}async fetchChunkFromPeer(e,t){const s=this.peers.get(e);if(!s||!s.connected||!s.conn)throw new Error(`Peer ${e} is not connected`);const n=`${e}-${t}-${Date.now()}`,r={type:"chunkRequest",requestId:n,chunkHash:t,peerId:this.peerId};return s.conn.send(r),new Promise((a,i)=>{this.pendingRequests.set(n,{resolve:a,reject:i,hash:t}),setTimeout(()=>{this.pendingRequests.has(n)&&(this.pendingRequests.delete(n),i(new Error(`Request for chunk ${t} from peer ${e} timed out`)))},1e4)})}handleChunkRequest(e,t){const{requestId:s,chunkHash:n}=e;this.dbGet("chunkCache",n).then(r=>{if(r&&r.value){const a={type:"chunkResponse",requestId:s,chunkHash:n,chunkData:r.value,peerId:this.peerId},i=this.peers.get(t);i&&i.connected&&i.conn&&(i.conn.send(a),console.log(`Sent chunk ${n} to peer ${t}`))}else console.warn(`Chunk ${n} not found for peer ${t}`)}).catch(r=>{console.error(`Failed to retrieve chunk ${n} for peer ${t}:`,r)})}handleChunkResponse(e){const{requestId:t,chunkHash:s,chunkData:n}=e,r=this.pendingRequests.get(t);r&&(r.hash===s?r.resolve(n):r.reject(new Error(`Received chunk hash ${s} does not match requested hash ${r.hash}`)),this.pendingRequests.delete(t))}async distributeCommission(e){const t=Array.from(this.activeNodes).filter(n=>n.startsWith("node-"));if(t.length===0){console.log("No active nodes to distribute commission to.");return}const s=e/t.length;console.log(`Distributing commission of ${e} to ${t.length} nodes (${s} per node)`);for(const n of t){const r=this.hexToUint8Array(n.replace("node-","")),i=await this.getBalance(r)+s;await this.putBalance(r,i),console.log(`Awarded ${s} to node ${n}. New balance: ${i}`);const c=this.peers.get(n);c&&c.connected&&c.conn&&c.conn.send({type:"commission",amount:s,newBalance:i,peerId:this.peerId})}}async getBalance(e){if(!this.db)throw new Error("IndexedDB not initialized");const t=await this.dbGet("store","balance_"+this.uint8ArrayToHex(e));return t&&t.value?parseFloat(t.value):0}async putBalance(e,t){if(!this.db)throw new Error("IndexedDB not initialized");if(typeof t!="number"||t<0)throw new Error("Invalid balance amount");await this.dbPut("store",{id:"balance_"+this.uint8ArrayToHex(e),value:t.toString()}),this.activeNodes.size>0&&this.broadcast({type:"userData",peerId:this.peerId,keypair:this.uint8ArrayToHex(this.keypair),balance:t,timestamp:Date.now()})}async updateBalance(){if(!this.db)throw new Error("IndexedDB not initialized");const e=await this.getBalance(this.keypair);await this.putBalance(this.keypair,e)}async queueOfflineOperation(e){if(!this.db)throw new Error("IndexedDB not initialized");this.offlineQueue.push(e),await this.dbAdd("offlineQueue",{id:Date.now().toString(),value:e}),console.log("Queued offline operation:",e)}async processOfflineQueue(){if(this.offlineQueue.length===0)return;console.log("Processing offline queue...");const e=[...this.offlineQueue];this.offlineQueue=[];const s=this.db.transaction("offlineQueue","readwrite").objectStore("offlineQueue");await new Promise(n=>{s.clear().onsuccess=n});for(const n of e)try{switch(n.type){case"publishChunk":await this.publishChunk(n.chunkHash,n.chunkData,n.chunkIndex,n.totalChunks);break;case"publishIP":await this.broadcastIP(n.ipHash,n.metadata,n.chunkHashes);break;default:console.warn("Unknown offline operation type:",n.type)}}catch(r){console.error(`Failed to process offline operation ${n.type}:`,r),this.offlineQueue.push(n),await this.dbAdd("offlineQueue",{id:Date.now().toString(),value:n})}}loadIdentity(){this.db&&this.dbGet("store","dcrypt_identity").then(e=>{e&&e.value&&typeof e.value=="string"&&(this.keypair=this.hexToUint8Array(e.value),console.log("Loaded identity from IndexedDB"))}).catch(e=>{console.error("Failed to load identity:",e)})}loadOfflineQueue(){this.db&&this.dbGetAll("offlineQueue").then(e=>{this.offlineQueue=e.map(t=>t.value),console.log("Loaded offline queue:",this.offlineQueue)}).catch(e=>{console.error("Failed to load offline queue:",e)})}loadTransactions(){this.db&&this.dbGetAll("transactions").then(e=>{console.log("Loaded transactions:",e)}).catch(e=>{console.error("Failed to load transactions:",e)})}async dbPut(e,t){if(!this.db)throw new Error("IndexedDB not initialized");return new Promise((s,n)=>{const i=this.db.transaction(e,"readwrite").objectStore(e).put(t);i.onsuccess=()=>s(),i.onerror=c=>n(new Error(`DB put failed: ${c.target.error.message}`))})}async dbAdd(e,t){if(!this.db)throw new Error("IndexedDB not initialized");return new Promise((s,n)=>{const i=this.db.transaction(e,"readwrite").objectStore(e).add(t);i.onsuccess=()=>s(),i.onerror=c=>n(new Error(`DB add failed: ${c.target.error.message}`))})}async dbGet(e,t){if(!this.db)throw new Error("IndexedDB not initialized");return new Promise((s,n)=>{const i=this.db.transaction(e,"readonly").objectStore(e).get(t);i.onsuccess=()=>s(i.result),i.onerror=c=>n(new Error(`DB get failed: ${c.target.error.message}`))})}async dbGetAll(e){if(!this.db)throw new Error("IndexedDB not initialized");return new Promise((t,s)=>{const a=this.db.transaction(e,"readonly").objectStore(e).getAll();a.onsuccess=()=>t(a.result),a.onerror=i=>s(new Error(`DB getAll failed: ${i.target.error.message}`))})}uint8ArrayToHex(e){return Array.from(e).map(t=>t.toString(16).padStart(2,"0")).join("")}hexToUint8Array(e){if(!e||typeof e!="string")return new Uint8Array(0);const t=e.match(/.{1,2}/g);return t?new Uint8Array(t.map(s=>parseInt(s,16))):new Uint8Array(0)}broadcast(e){this.peers.forEach((t,s)=>{t.connected&&t.conn&&t.conn.send(e)})}}function ke(){return"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(o){const e=Math.random()*16|0;return(o==="x"?e:e&3|8).toString(16)})}async function Ie(){const o=[];for(let t=0;t<3;t++){const s=`node-test-${ke()}`;console.log(`Initializing test peer with ID: ${s}`);const n=new te(s,{host:"0.peerjs.com",port:443,path:"/",secure:!0,debug:2}),r=new Promise((a,i)=>{n.on("open",()=>{console.log(`Test peer ${s} opened`),o.push({peer:n,peerId:s}),a()}),n.on("error",c=>{console.error(`Test peer ${s} error:`,c),i(c)}),n.on("disconnected",()=>{console.log(`Test peer ${s} disconnected`)})});try{await r}catch(a){console.error(`Failed to initialize test peer ${s}:`,a)}}return o}(window.location.pathname==="/datasharingApp/signup.html"||window.location.pathname==="/signup.html")&&document.addEventListener("DOMContentLoaded",()=>{const o=document.getElementById("signupButton");if(!o){console.error("Sign-up button not found");return}o.addEventListener("click",ve)});async function ve(){K(!0);try{const o=new j,t=(await _(v,o)).user;if(console.log("Signed up user UID:",t.uid),document.querySelector('input[name="role"]:checked').value==="node"){const r=B(x,"nodes",t.uid);await D(r,{uid:t.uid,createdAt:Date.now(),status:"active"}),console.log("User registered as a node"),z("Signed up as a node successfully!"),window.location.href="/datasharingApp/node-instructions.html"}else{const r=B(x,"users",t.uid);await D(r,{uid:t.uid,createdAt:Date.now(),balance:0},{merge:!0}),console.log("User registered as a regular user"),z("Signed up successfully!"),window.location.href="/datasharingApp/index.html"}}catch(o){console.error("Sign-up failed:",o),z(`Sign-up failed: ${o.message}`)}finally{K(!1)}}function z(o){const e=document.getElementById("toast");e&&(e.textContent=o,e.style.display="block",setTimeout(()=>{e.style.display="none"},3e3))}function K(o){const e=document.getElementById("loading");e&&(e.style.display=o?"flex":"none")}if(window.location.pathname==="/datasharingApp/node-instructions.html"||window.location.pathname==="/node-instructions.html"){let o;document.addEventListener("DOMContentLoaded",async()=>{Y(!0);try{const e=await new Promise(i=>{X(v,c=>{i(c)})});if(!e){J("Please sign in to view node instructions."),window.location.href="/datasharingApp/index.html";return}const s=new TextEncoder().encode(e.uid);o=new se(s,!0),await o.initDB(),await o.initSwarm(),await o.syncUserData();const r=(await o.dbGetAll("transactions")).filter(i=>i.type==="commission").reduce((i,c)=>i+(c.amount||0),0),a=document.getElementById("nodeEarnings");a&&(a.textContent=`Total Earnings: ${r.toFixed(2)} DCT`)}catch(e){console.error("Error initializing node instructions:",e),J(`Initialization failed: ${e.message}`)}finally{Y(!1)}})}function J(o){const e=document.getElementById("toast");e&&(e.textContent=o,e.style.display="block",setTimeout(()=>{e.style.display="none"},3e3))}function Y(o){const e=document.getElementById("loading");e&&(e.style.display=o?"flex":"none")}self.addEventListener("install",o=>{o.waitUntil(caches.open("dcrypt-v1").then(e=>e.addAll(["/","/index.html","/assets/index.js","/wasm/dcrypt_wasm.js","/wasm/dcrypt_wasm_bg.wasm"])))});self.addEventListener("fetch",o=>{o.respondWith(caches.match(o.request).then(e=>e||fetch(o.request).catch(()=>caches.match("/index.html"))))});self.addEventListener("message",async o=>{if(o.data.type==="cache_chunk"){const{chunkHash:e,data:t}=o.data,s=await caches.open("dcrypt-chunks"),n=new Blob([t],{type:"application/octet-stream"}),r=new Response(n,{headers:{"Content-Type":"application/octet-stream"}});await s.put(`/chunks/${e}`,r),console.log(`Service Worker: Cached chunk ${e}`)}});self.addEventListener("fetch",o=>{const e=new URL(o.request.url);e.pathname.startsWith("/chunks/")?o.respondWith(caches.open("dcrypt-chunks").then(t=>t.match(o.request).then(s=>s?(console.log(`Service Worker: Serving chunk ${e.pathname} from cache`),s):fetch(o.request).catch(()=>new Response("Chunk not available offline",{status:503}))))):o.respondWith(caches.match(o.request).then(t=>t||fetch(o.request).catch(()=>caches.match("/index.html"))))});let d=null,A=!1,P=0,L=[];document.addEventListener("DOMContentLoaded",()=>{var w;const o=localStorage.getItem("role"),e=localStorage.getItem("nodeId");if(window.location.pathname.includes("index.html")&&o==="node"&&e){console.log("Node detected on index.html, redirecting to node-instructions.html"),window.location.href="/datasharingApp/node-instructions.html";return}const t=document.getElementById("signupButton"),s=document.getElementById("loginButton"),n=document.getElementById("logoutButton"),r=document.getElementById("userBalance"),a=document.getElementById("publishButton"),i=document.getElementById("searchButton"),c=document.getElementById("depositButton"),l=document.getElementById("withdrawButton"),h=document.getElementById("toggleHistoryButton"),p=document.getElementById("transactionHistory"),m=(w=document.getElementById("publishedItems"))==null?void 0:w.querySelector("tbody"),y=document.getElementById("buyHashButton");if(window.location.pathname.includes("index.html")){if(!t||!s||!n||!r||!a||!i||!c||!l||!h||!p||!m||!y){console.error("Required DOM elements not found:",{signupButton:!!t,loginButton:!!s,logoutButton:!!n,userBalanceElement:!!r,publishButton:!!a,searchButton:!!i,depositButton:!!c,withdrawButton:!!l,toggleHistoryButton:!!h,transactionHistory:!!p,publishedItemsTableBody:!!m,buyHashButton:!!y});return}o==="node"&&e?(A=!0,console.log("Node detected, but should have been redirected already.")):X(v,g=>{g?(console.log("User is signed in:",g.uid),t.classList.add("hidden"),s.classList.add("hidden"),n.classList.remove("hidden"),a.disabled=!1,i.disabled=!1,c.disabled=!1,l.disabled=!1,h.disabled=!1,y.disabled=!1,re(g.uid)):(console.log("No user is signed in."),t.classList.remove("hidden"),s.classList.remove("hidden"),n.classList.add("hidden"),a.disabled=!0,i.disabled=!0,c.disabled=!0,l.disabled=!0,h.disabled=!0,y.disabled=!0,W())}),s.addEventListener("click",De),n.addEventListener("click",V)}window.logout=V,window.publishSnippet=Ee,window.buySnippet=ie,window.buySnippetByHash=$e,window.searchSnippets=Te,window.deposit=Ue,window.withdraw=Le,window.toggleTransactionHistory=Ne,window.flagSnippet=Ce,window.handleSignup=Se});function Be(){return"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(o){const e=Math.random()*16|0;return(o==="x"?e:e&3|8).toString(16)})}async function Se(){var t;const o=document.querySelectorAll('input[name="role"]');if(!o){u("Role selection not found.",!0);return}const e=(t=Array.from(o).find(s=>s.checked))==null?void 0:t.value;if(!e){u("Please select a role.",!0);return}k(!0);try{if(e==="user"){console.log("Handling user signup with OAuth...");const s=new j,r=(await _(v,s)).user;console.log("Signed in user UID:",r.uid),u("Signed in successfully!");const a=B(x,"users",r.uid);await D(a,{role:"user",createdAt:Date.now()},{merge:!0}),window.location.href="/datasharingApp/index.html"}else{console.log("Handling node signup without OAuth...");const s=Be();console.log("Generated node ID:",s),localStorage.setItem("nodeId",s),localStorage.setItem("role","node");const n=B(x,"nodes",s);await D(n,{role:"node",createdAt:Date.now()},{merge:!0}),u("Node created successfully!"),window.location.href="/datasharingApp/node-instructions.html"}}catch(s){console.error("Signup failed:",s),u(`Signup failed: ${s.message}`,!0)}finally{k(!1)}}async function re(o){console.log("Initializing app..."),k(!0);try{const t=new TextEncoder().encode(o);A||(A=await Pe(o)),console.log(`User is ${A?"":"not "}a node.`),L.length===0&&(console.log("Creating test peers..."),L=await Ie(),console.log("Test peers created:",L.map(s=>s.peerId))),console.log("Initializing DHT..."),d=new se(t,A),window.dht=d,await d.initDB(),console.log("IndexedDB initialized."),await d.initSwarm(),console.log("DHT initialized."),await d.syncUserData(),console.log("User data synced."),H(),console.log("Live feed updated."),U(),T()}catch(e){console.error("Error initializing application:",e),u(`Initialization failed: ${e.message}`,!0),d=null,window.dht=null,P=0,W()}finally{k(!1),qe()}}async function Pe(o){try{const e=B(x,"nodes",o);return(await ee(e)).exists()}catch(e){return console.error("Failed to check node status:",e),!1}}async function De(){const o=new j;try{const t=(await _(v,o)).user;console.log("Signed in user UID:",t.uid),u("Signed in successfully!"),await re(t.uid)}catch(e){console.error("Sign-in failed:",e),u(`Sign-in failed: ${e.message}`,!0)}}async function V(){try{localStorage.getItem("role")==="node"?(localStorage.removeItem("nodeId"),localStorage.removeItem("role"),u("Node signed out successfully!")):(await de(v),u("Signed out successfully!")),d=null,window.dht=null,L=[],P=0,W()}catch(o){console.error("Sign-out failed:",o),u(`Sign-out failed: ${o.message}`,!0)}}function C(){return!!v.currentUser||localStorage.getItem("role")==="node"}async function Ee(o,e,t,s,n){var r;if(!C()){u("Please sign in to publish.");return}k(!0);try{if(!d)throw new Error("DHT not initialized");if(!o)throw new Error("Title is required");let a=s||"",i="text/plain";if(n&&n.files&&n.files.length>0){const g=n.files[0];i=g.type||"application/octet-stream";const I=new FileReader;a=await new Promise((b,S)=>{I.onload=E=>b(new Uint8Array(E.target.result)),I.onerror=E=>S(new Error("Failed to read file")),I.readAsArrayBuffer(g)})}else a=new TextEncoder().encode(a);const c=document.getElementById("isPremium").checked,l=document.getElementById("priceInput"),h=c&&l&&parseFloat(l.value)||0,p={content_type:o,description:e||"",tags:t?t.split(",").map(g=>g.trim()):[],isPremium:c,priceUsd:h},m=await d.publishIP(p,a,i),y=((r=v.currentUser)==null?void 0:r.uid)||localStorage.getItem("nodeId"),w=B(x,"snippets",m);await D(w,{ipHash:m,flagCount:0,averageRating:0,reviewStatus:"active",createdAt:Date.now(),creatorId:y},{merge:!0}),u("Snippet published successfully!"),H(),T(),U(),await R()}catch(a){console.error("publishSnippet failed:",a),u(`Publish failed: ${a.message}`,!0)}finally{k(!1)}}async function ie(o){if(!C())return u("Please sign in to buy."),null;k(!0);try{if(!d)throw new Error("DHT not initialized");if(!o)throw new Error("Hash is required");const e=d.knownObjects.get(o);if(!e)throw new Error("Snippet not found");const n=(e.metadata.isPremium||!1)&&e.metadata.priceUsd||0;if(n>0){const c=await d.getBalance(d.keypair);if(c<n)throw new Error("Insufficient balance");const l=n*.05;await d.distributeCommission(l),await d.putBalance(d.keypair,c-n),await d.dbAdd("transactions",{type:"buy",amount:n,timestamp:Date.now()})}else console.log("This snippet is free!"),await d.dbAdd("transactions",{type:"buy",amount:0,timestamp:Date.now()});const{data:r,fileType:a}=await d.requestData(o);u("Snippet retrieved successfully!"),T(),U(),await R();const i=prompt("Please rate this snippet (1-5 stars):","5");if(i!==null){const c=parseInt(i);c>=1&&c<=5?(await Ae(o,c),u(`Rated ${c} stars!`),H()):u("Invalid rating. Please enter a number between 1 and 5.",!0)}return Re(r,a,e.metadata.content_type),{data:r,fileType:a}}catch(e){return console.error("buySnippet failed:",e),u(`Purchase failed: ${e.message}`,!0),null}finally{k(!1)}}async function $e(o){const e=o||document.getElementById("buyHashInput").value.trim();if(!e){u("Please enter a valid hash.",!0);return}await ie(e)&&u("Snippet purchased and displayed below!")}async function Ae(o,e){var s;const t=((s=v.currentUser)==null?void 0:s.uid)||localStorage.getItem("nodeId");if(t)try{const n=B(x,"snippets",o,"ratings",t);await D(n,{rating:e,timestamp:Date.now()});const a=(await N(q(x,"snippets",o,"ratings"))).docs.map(l=>l.data().rating),i=a.length>0?a.reduce((l,h)=>l+h,0)/a.length:0,c=B(x,"snippets",o);await M(c,{averageRating:i.toFixed(1)})}catch(n){console.error("Failed to submit rating:",n),u(`Failed to submit rating: ${n.message}`,!0)}}async function Ce(o){var t;if(!(((t=v.currentUser)==null?void 0:t.uid)||localStorage.getItem("nodeId"))){u("Please sign in to flag content.");return}try{const s=B(x,"snippets",o);await M(s,{flagCount:he(1)}),((await ee(s)).data().flagCount||0)>=3?(await M(s,{reviewStatus:"under_review"}),u("Snippet has been flagged and is under review."),H()):u("Snippet flagged. It will be reviewed if flagged by more users.")}catch(s){console.error("Failed to flag snippet:",s),u(`Failed to flag snippet: ${s.message}`,!0)}}async function Te(o){if(!C()){u("Please sign in to search.");return}k(!0);try{if(!d)throw new Error("DHT not initialized");if(!o)throw new Error("Search query is required");console.log("Starting search with query:",o),console.log("dht.knownObjects size:",d.knownObjects.size),console.log("dht.knownObjects:",Array.from(d.knownObjects.entries()));const e=document.getElementById("publishedItems").querySelector("tbody");e.innerHTML="";const t=await N(q(x,"snippets")),s={};t.forEach(r=>{s[r.id]=r.data()}),console.log("Snippets from Firestore:",s);let n=!1;d.knownObjects.forEach((r,a)=>{const{content_type:i,description:c,tags:l}=r.metadata,h=o.toLowerCase(),p=s[a]||{averageRating:0,reviewStatus:"active"};if(console.log(`Checking snippet ${a}:`,{content_type:i,description:c,tags:l,reviewStatus:p.reviewStatus}),p.reviewStatus==="active"&&(i.toLowerCase().includes(h)||c&&c.toLowerCase().includes(h)||l&&l.some(m=>m.toLowerCase().includes(h)))){n=!0;const y=(r.metadata.isPremium||!1)&&r.metadata.priceUsd||0,w=y>0?`${y} DCT`:"Free",g=document.createElement("tr");g.innerHTML=`
          <td class="py-2 px-4">${i}</td>
          <td class="py-2 px-4">${c||"No description"}</td>
          <td class="py-2 px-4">${l.join(", ")||"No tags"}</td>
          <td class="py-2 px-4">${p.averageRating} / 5</td>
          <td class="py-2 px-4">
            <button onclick="window.buySnippet('${a}')" class="bg-purple-500 text-white rounded hover:bg-purple-600 px-3 py-1 mr-2">Get (${w})</button>
            <button onclick="window.flagSnippet('${a}')" class="bg-red-500 text-white rounded hover:bg-red-600 px-3 py-1">Flag</button>
          </td>
        `,e.appendChild(g),console.log(`Found matching snippet ${a}`)}}),u(n?"Search completed!":"No snippets found matching your search.")}catch(e){console.error("searchSnippets failed:",e),u(`Search failed: ${e.message}`,!0)}finally{k(!1)}}async function Ue(o){if(!C()){u("Please sign in to deposit.");return}k(!0);try{if(!d)throw new Error("DHT not initialized");if(!o||o<=0)throw new Error("Invalid deposit amount");const t=await d.getBalance(d.keypair)+o;await d.putBalance(d.keypair,t),await d.dbAdd("transactions",{type:"deposit",amount:o,timestamp:Date.now()}),u(`Deposited ${o} DCT successfully!`),T(),U(),await R()}catch(e){console.error("deposit failed:",e),u(`Deposit failed: ${e.message}`,!0)}finally{k(!1)}}async function Le(o){if(!C()){u("Please sign in to withdraw.");return}k(!0);try{if(!d)throw new Error("DHT not initialized");if(!o||o<=0)throw new Error("Invalid withdrawal amount");const e=await d.getBalance(d.keypair);if(e<o)throw new Error("Insufficient balance");await d.putBalance(d.keypair,e-o),await d.dbAdd("transactions",{type:"withdraw",amount:o,timestamp:Date.now()}),u(`Withdrew ${o} DCT successfully!`),T(),U(),await R()}catch(e){console.error("withdraw failed:",e),u(`Withdrawal failed: ${e.message}`,!0)}finally{k(!1)}}function Ne(){const o=document.getElementById("transactionHistory");o.style.display==="none"?o.style.display="block":o.style.display="none"}async function R(){var e;const o=((e=v.currentUser)==null?void 0:e.uid)||localStorage.getItem("nodeId");if(o)try{const t=B(x,"users",o),s=d?await d.getBalance(d.keypair):0;await D(t,{balance:s,lastUpdated:Date.now()},{merge:!0}),console.log("User data uploaded to Firebase")}catch(t){console.error("Failed to upload user data to Firebase:",t)}}function H(){var e;const o=(e=document.getElementById("publishedItems"))==null?void 0:e.querySelector("tbody");o&&(o.innerHTML="",N(q(x,"snippets")).then(t=>{const s={};t.forEach(n=>{s[n.id]=n.data()}),d&&d.knownObjects.forEach((n,r)=>{const a=s[r]||{averageRating:0,reviewStatus:"active"};if(a.reviewStatus!=="active")return;const c=(n.metadata.isPremium||!1)&&n.metadata.priceUsd||0,l=c>0?`${c} DCT`:"Free",h=document.createElement("tr");h.innerHTML=`
          <td class="py-2 px-4">${n.metadata.content_type}</td>
          <td class="py-2 px-4">${n.metadata.description||"No description"}</td>
          <td class="py-2 px-4">${n.metadata.tags.join(", ")||"No tags"}</td>
          <td class="py-2 px-4">${a.averageRating} / 5</td>
          <td class="py-2 px-4">
            <button onclick="window.buySnippet('${r}')" class="bg-purple-500 text-white rounded hover:bg-purple-600 px-3 py-1 mr-2">Get (${l})</button>
            <button onclick="window.flagSnippet('${r}')" class="bg-red-500 text-white rounded hover:bg-red-600 px-3 py-1">Flag</button>
          </td>
        `,o.appendChild(h)})}).catch(t=>{console.error("Failed to update live feed:",t),u("Failed to load live feed.",!0)}))}function T(){const o=document.getElementById("transactionList");if(o){if(!d){o.innerHTML="Not initialized.";return}d.dbGetAll("transactions").then(e=>{if(e.length===0){o.innerHTML="No transactions yet.";return}o.innerHTML=e.map(t=>`<p class="py-1">${t.type} - ${t.amount} DCT - ${new Date(t.timestamp).toLocaleString()}</p>`).join("")}).catch(e=>{console.error("Failed to update transaction history:",e),o.innerHTML="Failed to load transactions."})}}function U(){const o=document.getElementById("userBalance");if(o){if(!d){o.textContent="Balance: 0 DCT",P=0;return}d.getBalance(d.keypair).then(e=>{P=e||0,o.textContent=`Balance: ${P} DCT`}).catch(e=>{console.error("Failed to update balance:",e),o.textContent="Balance: 0 DCT",P=0})}}function W(){var s;const o=(s=document.getElementById("publishedItems"))==null?void 0:s.querySelector("tbody"),e=document.getElementById("transactionList"),t=document.getElementById("userBalance");o&&(o.innerHTML=""),e&&(e.innerHTML="No transactions yet."),t&&(t.textContent="Balance: 0 DCT"),P=0}function u(o,e=!1){const t=document.getElementById("toast");t&&(t.textContent=o,t.className="toast",e&&t.classList.add("error-toast"),t.style.display="block",setTimeout(()=>{t.style.display="none"},3e3))}function k(o){const e=document.getElementById("loading");e&&(e.style.display=o?"flex":"none")}function qe(){const o=document.getElementById("isPremium"),e=document.getElementById("priceInput");o&&e&&o.addEventListener("change",t=>{console.log("Premium toggle:",t.target.checked),e.classList.toggle("hidden",!t.target.checked),t.target.checked||(e.value="")})}function Re(o,e,t){const s=document.getElementById("snippetDisplay");if(!s)return;s.innerHTML="";const n=document.createElement("div");n.className="p-4 bg-gray-800 rounded-lg mt-4";const r=document.createElement("h3");if(r.className="text-lg font-semibold mb-2",r.textContent=t||"Snippet Content",n.appendChild(r),e.startsWith("text")){const a=new TextDecoder().decode(o),i=document.createElement("pre");i.className="text-sm text-gray-300 whitespace-pre-wrap",i.textContent=a,n.appendChild(i)}else if(e.startsWith("image")){const a=new Blob([o],{type:e}),i=URL.createObjectURL(a),c=document.createElement("img");c.src=i,c.className="max-w-full h-auto rounded",c.onload=()=>URL.revokeObjectURL(i),n.appendChild(c)}else{const a=new Blob([o],{type:e}),i=URL.createObjectURL(a),c=document.createElement("a");c.href=i,c.download=t||"downloaded_file",c.className="text-blue-400 hover:underline",c.textContent="Download File",c.onclick=()=>setTimeout(()=>URL.revokeObjectURL(i),1e3),n.appendChild(c)}s.appendChild(n)}
