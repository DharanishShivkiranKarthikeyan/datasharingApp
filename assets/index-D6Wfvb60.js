import{initializeApp as U}from"https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";import{getAuth as j,onAuthStateChanged as x,GoogleAuthProvider as F,signInWithPopup as R,signOut as W}from"https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";import{getFirestore as Q,getDocs as G,collection as J,setDoc as L,doc as S,getDoc as K}from"https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";import"https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/+esm";import q from"https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))o(n);new MutationObserver(n=>{for(const s of n)if(s.type==="childList")for(const a of s.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&o(a)}).observe(document,{childList:!0,subtree:!0});function t(n){const s={};return n.integrity&&(s.integrity=n.integrity),n.referrerPolicy&&(s.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?s.credentials="include":n.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function o(n){if(n.ep)return;n.ep=!0;const s=t(n);fetch(n.href,s)}})();const Y={apiKey:"AIzaSyBrdrwvY-lPObZgortEgw7YWycUOGsBlyM",authDomain:"dcrypt-edb9c.firebaseapp.com",projectId:"dcrypt-edb9c",storageBucket:"dcrypt-edb9c.firebasestorage.app",messagingSenderId:"952133736604",appId:"1:952133736604:web:32d799360f200bce84f559",measurementId:"G-7KCDLQ6JNH"},N=U(Y),k=j(N),B=Q(N),V="modulepreload",Z=function(r){return"/datasharingApp/"+r},C={},X=function(e,t,o){let n=Promise.resolve();if(t&&t.length>0){document.getElementsByTagName("link");const a=document.querySelector("meta[property=csp-nonce]"),i=(a==null?void 0:a.nonce)||(a==null?void 0:a.getAttribute("nonce"));n=Promise.allSettled(t.map(c=>{if(c=Z(c),c in C)return;C[c]=!0;const l=c.endsWith(".css"),u=l?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${c}"]${u}`))return;const h=document.createElement("link");if(h.rel=l?"stylesheet":V,l||(h.as="script"),h.crossOrigin="",h.href=c,i&&h.setAttribute("nonce",i),document.head.appendChild(h),l)return new Promise((g,w)=>{h.addEventListener("load",g),h.addEventListener("error",()=>w(new Error(`Unable to preload CSS for ${c}`)))})}))}function s(a){const i=new Event("vite:preloadError",{cancelable:!0});if(i.payload=a,window.dispatchEvent(i),!i.defaultPrevented)throw a}return n.then(a=>{for(const i of a||[])i.status==="rejected"&&s(i.reason);return e().catch(s)})};async function ee(){try{const e=await(await X(()=>import("./dcrypt_wasm-Dm3nAcA-.js"),[])).default();return console.log("Initialized WASM module:",e),console.log("WASM module exports:",Object.keys(e)),e}catch(r){throw console.error("Failed to load WASM module:",r),r}}class te{constructor(e,t=!1,o){this.peers=new Map,this.channels=new Map,this.knownObjects=new Map,this.chunkToPeerMap=new Map,this.pendingRequests=new Map,this.db=null,this.keypair=e,this.activeNodes=new Set,this.nodes=new Set,this.offlineQueue=[],this.isNode=t,this.peerId=null,this.peer=null,this.connectionAttempts=new Map,this.maxConnectionAttempts=3,this.connectionRetryDelay=5e3,this.wasmModule=o,this.averageLatency=0,this.initializeKnownNodes()}async initializeKnownNodes(){const e=async()=>{try{const t=await G(J(B,"nodes"));this.nodes.clear(),t.empty?console.warn("No nodes found in Firestore. Using empty node list."):t.forEach(o=>{const n=`node-${o.id}`;this.nodes.add(n)}),console.log("Fetched nodes:",Array.from(this.nodes))}catch(t){console.error("Failed to fetch nodes from Firestore:",t),this.nodes.clear(),console.warn("No nodes available. Peer discovery will be limited to regular peers.")}};await e(),setInterval(e,5*60*1e3)}async measureLatency(){const e=[],t=Array.from(this.activeNodes).slice(0,5);for(const o of t){const n=this.peers.get(o);if(n&&n.connected&&n.conn){const s=Date.now();await new Promise(i=>{const c=`${o}-ping-${Date.now()}`;n.conn.send({type:"ping",requestId:c}),this.pendingRequests.set(c,{resolve:i}),setTimeout(()=>{this.pendingRequests.has(c)&&(this.pendingRequests.delete(c),i())},2e3)});const a=Date.now()-s;e.push(a)}}this.averageLatency=e.length>0?e.reduce((o,n)=>o+n,0)/e.length:0,console.log(`Average latency: ${this.averageLatency} ms`)}async initDB(){return new Promise((e,t)=>{const o=indexedDB.open("dcrypt_db",3);o.onupgradeneeded=()=>{const n=o.result;n.objectStoreNames.contains("store")||n.createObjectStore("store",{keyPath:"id"}),n.objectStoreNames.contains("transactions")||n.createObjectStore("transactions",{keyPath:"id",autoIncrement:!0}),n.objectStoreNames.contains("offlineQueue")||n.createObjectStore("offlineQueue",{keyPath:"id",autoIncrement:!0}),n.objectStoreNames.contains("chunkCache")||n.createObjectStore("chunkCache",{keyPath:"id"})},o.onsuccess=()=>{this.db=o.result,this.loadIdentity(),this.loadOfflineQueue(),this.loadTransactions(),console.log("IndexedDB initialized successfully"),e()},o.onerror=n=>{console.error("Failed to initialize IndexedDB:",n.target.error),t(new Error(`Failed to initialize IndexedDB: ${n.target.error.message}`))}})}async syncUserData(){if(!this.db)throw new Error("IndexedDB not initialized");try{await this.dbPut("store",{id:"dcrypt_identity",value:this.uint8ArrayToHex(this.keypair)}),await this.updateBalance(),this.activeNodes.size>0&&await this.processOfflineQueue();const e={type:"userData",peerId:this.peerId,keypair:this.uint8ArrayToHex(this.keypair),balance:await this.getBalance(this.keypair),timestamp:Date.now()};this.broadcast(e),console.log("User data synced successfully")}catch(e){throw console.error("Sync failed:",e),e}}async saveUserData(){if(!this.db)throw new Error("IndexedDB not initialized");try{await this.dbPut("store",{id:"dcrypt_identity",value:this.uint8ArrayToHex(this.keypair)}),await this.updateBalance(),console.log("User data saved to IndexedDB")}catch(e){throw console.error("Save failed:",e),e}}async initSwarm(){try{const e=new TextDecoder().decode(this.keypair);return this.peerId=this.isNode?`node-${e}`:e,console.log("Initializing PeerJS with Peer ID:",this.peerId),this.peer=new q(this.peerId,{host:"0.peerjs.com",port:443,path:"/",secure:!0,debug:2}),new Promise((t,o)=>{this.peer.on("open",n=>{console.log(`PeerJS connection opened with ID: ${n}`),this.activeNodes.add(this.peerId),this.peer.on("connection",s=>{this.handleConnection(s)}),this.peer.on("error",s=>{var a;if(console.error("PeerJS error:",s.type,s.message),s.type==="peer-unavailable"){const i=(a=s.message.match(/Peer (.+) is unavailable/))==null?void 0:a[1];i&&this.handlePeerDisconnect(i)}}),this.peer.on("disconnected",()=>{console.log("PeerJS disconnected. Attempting to reconnect..."),this.peer.reconnect()}),setInterval(()=>this.discoverPeers(),5e3),setInterval(()=>this.measureLatency(),6e4),t()}),this.peer.on("error",n=>{console.error("Failed to initialize PeerJS:",n),o(n)})})}catch(e){throw console.error("initSwarm failed:",e),e}}discoverPeers(){console.log("Discovering peers..."),console.log("My peer ID:",this.peerId),console.log("Known peer IDs:",Array.from(this.nodes));const e=[...Array.from(this.nodes)].filter(t=>t!==this.peerId);if(e.length===0){console.warn("No known peers to connect to. Waiting for nodes to be discovered.");return}e.forEach(t=>{this.peers.has(t)||(this.peers.set(t,{connected:!1,conn:null}),console.log("Discovered peer:",t),this.connectToPeer(t))}),this.peers.forEach((t,o)=>{!t.connected&&this.connectionAttempts.get(o)>=this.maxConnectionAttempts&&(console.log(`Removing unreachable peer: ${o}`),this.peers.delete(o),this.connectionAttempts.delete(o),this.activeNodes.delete(o))})}connectToPeer(e){var n;if((n=this.peers.get(e))!=null&&n.connected)return;const t=this.connectionAttempts.get(e)||0;if(t>=this.maxConnectionAttempts)return;console.log(`Attempting to connect to peer: ${e} (Attempt ${t+1}/${this.maxConnectionAttempts})`);const o=this.peer.connect(e,{reliable:!0});o.on("open",()=>{console.log(`Connected to peer: ${e}`),this.peers.set(e,{connected:!0,conn:o}),this.activeNodes.add(e),this.connectionAttempts.delete(e),o.send({type:"handshake",peerId:this.peerId})}),o.on("data",s=>{this.handlePeerData(s,e)}),o.on("close",()=>{console.log(`Connection closed with peer: ${e}`),this.handlePeerDisconnect(e)}),o.on("error",s=>{console.warn(`Connection error with peer ${e}: ${s.message}`),this.handlePeerDisconnect(e)}),this.connectionAttempts.set(e,t+1)}handleConnection(e){const t=e.peer;console.log(`Incoming connection from peer: ${t}`),this.peers.set(t,{connected:!0,conn:e}),this.activeNodes.add(t),e.on("data",o=>{this.handlePeerData(o,t)}),e.on("close",()=>{console.log(`Connection closed with peer: ${t}`),this.handlePeerDisconnect(t)}),e.on("error",o=>{console.error(`Connection error with peer ${t}:`,o),this.handlePeerDisconnect(t)})}handlePeerDisconnect(e){const t=this.peers.get(e);t&&(t.connected=!1,t.conn=null,this.activeNodes.delete(e),console.log(`Peer disconnected: ${e}. Will attempt to reconnect on next discovery.`))}handlePeerData(e,t){switch(console.log(`Received data from peer ${t}:`,e),e.type){case"handshake":console.log(`Handshake received from peer: ${t}`),this.activeNodes.add(t);break;case"chunk":this.chunkToPeerMap.set(e.chunkHash,new Set([...this.chunkToPeerMap.get(e.chunkHash)||[],t])),console.log(`Updated chunkToPeerMap for chunk ${e.chunkHash} with peer ${t}`);break;case"ip":this.knownObjects.set(e.ipHash,{metadata:e.metadata,chunks:e.chunkHashes}),this.dbPut("store",{id:e.ipHash,value:JSON.stringify({metadata:e.metadata,chunks:e.chunkHashes})}),console.log(`Received IP ${e.ipHash} from peer ${t}`);break;case"chunkRequest":this.handleChunkRequest(e,t);break;case"chunkResponse":this.handleChunkResponse(e);break;case"userData":console.log(`Received user data from peer ${t}:`,e);break;case"storeChunk":this.storeChunkFromPeer(e.chunkHash,e.chunkData,t);break;case"ping":const o=this.peers.get(t);o&&o.connected&&o.conn&&o.conn.send({type:"pong",requestId:e.requestId});break;case"pong":const n=this.pendingRequests.get(e.requestId);n&&(n.resolve(),this.pendingRequests.delete(e.requestId));break;case"commission":console.log(`Received commission of ${e.amount}. New balance: ${e.newBalance}`);break;default:console.warn(`Unknown data type received from peer ${t}:`,e.type)}}async storeChunkFromPeer(e,t,o){try{await this.dbPut("chunkCache",{id:e,value:t});let n=this.chunkToPeerMap.get(e)||new Set;n.add(this.peerId),this.chunkToPeerMap.set(e,n),console.log(`Stored chunk ${e} from peer ${o}`)}catch(n){console.error(`Failed to store chunk ${e} from peer ${o}:`,n)}}async publishChunk(e,t,o,n){if(!this.db)throw new Error("IndexedDB not initialized");try{if(console.log("publishChunk: chunkHash=",e,"chunkData=",t),!e||typeof e!="string"||e.trim()==="")throw new Error("Invalid chunk hash");await this.dbPut("chunkCache",{id:e,value:t});let s=this.chunkToPeerMap.get(e)||new Set;if(s.add(this.peerId),this.chunkToPeerMap.set(e,s),this.activeNodes.size>0){const a=Array.from(this.activeNodes).filter(c=>c.startsWith("node-"));if(a.length>0){const c=o%a.length,l=a[c],u=this.peers.get(l);u&&u.connected&&u.conn&&(u.conn.send({type:"storeChunk",chunkHash:e,chunkData:t,peerId:this.peerId}),s.add(l),this.chunkToPeerMap.set(e,s),console.log(`Sent chunk ${e} to node ${l}`))}const i=Array.from(this.activeNodes).filter(c=>!c.startsWith("node-")&&c!==this.peerId);if(i.length>0){const c=i[Math.floor(Math.random()*i.length)],l=this.peers.get(c);l&&l.connected&&l.conn&&(l.conn.send({type:"storeChunk",chunkHash:e,chunkData:t,peerId:this.peerId}),s.add(c),this.chunkToPeerMap.set(e,s),console.log(`Sent chunk ${e} to random peer ${c}`))}}else await this.queueOfflineOperation({type:"publishChunk",chunkHash:e,chunkData:t,chunkIndex:o,totalChunks:n});this.broadcastChunk(e)}catch(s){throw console.error("publishChunk failed:",s),s}}broadcastChunk(e){const t={type:"chunk",chunkHash:e,peerId:this.peerId};this.broadcast(t),console.log(`Broadcasted chunk ${e} to ${this.activeNodes.size} peers`)}async publishIP(e,t,o){if(!this.db)throw new Error("IndexedDB not initialized");if(!this.wasmModule)throw new Error("Wasm module not initialized");if(console.log("WASM module in DHT:",this.wasmModule),console.log("WASM module exports in DHT:",Object.keys(this.wasmModule)),typeof this.wasmModule.create_intellectual_property!="function")throw new Error("create_intellectual_property is not a function in WASM module");try{const n=Array.isArray(e.tags)?e.tags.map(p=>typeof p!="string"?(console.warn(`Invalid tag: ${p}, converting to string`),String(p)):p).filter(p=>p.trim()!==""):[];console.log("Processed tags:",n),console.log("Calling create_intellectual_property with:",{content:new Uint8Array(t),content_type:e.content_type,tags:n,isPremium:e.isPremium,priceUsd:e.isPremium?30:5,creatorId:this.keypair,fileType:o});const s=this.wasmModule.create_intellectual_property(new Uint8Array(t),e.content_type,n,e.isPremium,e.isPremium?30:5,this.keypair,o),a=this.wasmModule.get_ip_content(s),i=this.wasmModule.compute_full_hash(a),c=this.uint8ArrayToHex(i),l=Array.from(this.activeNodes).filter(p=>p.startsWith("node-")),u=l.length>0?l.length:1,h=this.wasmModule.chunk_encrypt(s,Array.from(this.keypair),u),g=[];for(let p=0;p<h.length;p++){const m=h[p],b=this.wasmModule.get_chunk_hash(m),H=this.uint8ArrayToHex(b);g.push(H)}const w={...e,chunk_count:h.length},P={metadata:w,chunks:g};this.knownObjects.set(c,P),await this.dbPut("store",{id:c,value:JSON.stringify(P)});for(let p=0;p<h.length;p++){const m=h[p],b=g[p];await this.publishChunk(b,m,p,h.length)}return this.activeNodes.size>0?this.broadcastIP(c,w,g):await this.queueOfflineOperation({type:"publishIP",ipHash:c,metadata:w,chunkHashes:g}),c}catch(n){throw console.error("publishIP failed:",n),n}}broadcastIP(e,t,o){const n={type:"ip",ipHash:e,metadata:t,chunkHashes:o,peerId:this.peerId};this.broadcast(n),console.log(`Broadcasted IP ${e} to ${this.activeNodes.size} peers`)}async requestData(e){if(!this.db)throw new Error("IndexedDB not initialized");if(!this.wasmModule)throw new Error("Wasm module not initialized");try{if(!e||typeof e!="string")throw new Error("Invalid IP hash");const t=this.knownObjects.get(e);if(!t)throw new Error("IP not found");const o=[];for(const l of t.chunks){const u=await this.dbGet("chunkCache",l);if(u&&u.value){o.push({chunk:u.value,hash:l});continue}const h=this.chunkToPeerMap.get(l);if(!h||h.size===0)throw new Error(`No peers found with chunk ${l}`);const g=Array.from(h).filter(m=>m.startsWith("node-")),w=Array.from(h).filter(m=>!m.startsWith("node-"));let P=!1,p=null;for(const m of[...g,...w])if(this.activeNodes.has(m))try{const b=await this.fetchChunkFromPeer(m,l);await this.dbPut("chunkCache",{id:l,value:b}),o.push({chunk:b,hash:l}),P=!0;break}catch(b){p=b,console.error(`Failed to fetch chunk ${l} from peer ${m}:`,b);continue}if(!P)throw p||new Error(`No available peer for chunk ${l}`)}const n=o.sort((l,u)=>{const h=this.wasmModule.get_chunk_index(l.chunk),g=this.wasmModule.get_chunk_index(u.chunk);return h-g}),s=[];for(const{chunk:l}of n){const u=this.wasmModule.decrypt_chunk(l,Array.from(this.keypair));s.push(u)}const a=new Uint8Array(s.reduce((l,u)=>l+u.length,0));let i=0;for(const l of s)a.set(l,i),i+=l.length;const c=this.wasmModule.get_chunk_file_type(n[0].chunk);return{data:a,fileType:c}}catch(t){throw console.error("requestData failed:",t),t}}async fetchChunkFromPeer(e,t){const o=this.peers.get(e);if(!o||!o.connected||!o.conn)throw new Error(`Peer ${e} is not connected`);const n=`${e}-${t}-${Date.now()}`,s={type:"chunkRequest",requestId:n,chunkHash:t,peerId:this.peerId};return o.conn.send(s),new Promise((a,i)=>{this.pendingRequests.set(n,{resolve:a,reject:i,hash:t}),setTimeout(()=>{this.pendingRequests.has(n)&&(this.pendingRequests.delete(n),i(new Error(`Request for chunk ${t} from peer ${e} timed out`)))},1e4)})}handleChunkRequest(e,t){const{requestId:o,chunkHash:n}=e;this.dbGet("chunkCache",n).then(s=>{if(s&&s.value){const a={type:"chunkResponse",requestId:o,chunkHash:n,chunkData:s.value,peerId:this.peerId},i=this.peers.get(t);i&&i.connected&&i.conn&&(i.conn.send(a),console.log(`Sent chunk ${n} to peer ${t}`))}else console.warn(`Chunk ${n} not found for peer ${t}`)}).catch(s=>{console.error(`Failed to retrieve chunk ${n} for peer ${t}:`,s)})}handleChunkResponse(e){const{requestId:t,chunkHash:o,chunkData:n}=e,s=this.pendingRequests.get(t);s&&(s.hash===o?s.resolve(n):s.reject(new Error(`Received chunk hash ${o} does not match requested hash ${s.hash}`)),this.pendingRequests.delete(t))}async distributeCommission(e){const t=Array.from(this.activeNodes).filter(n=>n.startsWith("node-"));if(t.length===0){console.log("No active nodes to distribute commission to.");return}const o=e/t.length;console.log(`Distributing commission of ${e} to ${t.length} nodes (${o} per node)`);for(const n of t){const s=this.hexToUint8Array(n.replace("node-","")),i=await this.getBalance(s)+o;await this.putBalance(s,i),console.log(`Awarded ${o} to node ${n}. New balance: ${i}`);const c=this.peers.get(n);c&&c.connected&&c.conn&&c.conn.send({type:"commission",amount:o,newBalance:i,peerId:this.peerId})}}async getBalance(e){if(!this.db)throw new Error("IndexedDB not initialized");const t=await this.dbGet("store","balance_"+this.uint8ArrayToHex(e));return t&&t.value?parseFloat(t.value):0}async putBalance(e,t){if(!this.db)throw new Error("IndexedDB not initialized");if(typeof t!="number"||t<0)throw new Error("Invalid balance amount");await this.dbPut("store",{id:"balance_"+this.uint8ArrayToHex(e),value:t.toString()}),this.activeNodes.size>0&&this.broadcast({type:"userData",peerId:this.peerId,keypair:this.uint8ArrayToHex(this.keypair),balance:t,timestamp:Date.now()})}async updateBalance(){if(!this.db)throw new Error("IndexedDB not initialized");const e=await this.getBalance(this.keypair);await this.putBalance(this.keypair,e)}async queueOfflineOperation(e){if(!this.db)throw new Error("IndexedDB not initialized");this.offlineQueue.push(e),await this.dbAdd("offlineQueue",{id:Date.now().toString(),value:e}),console.log("Queued offline operation:",e)}async processOfflineQueue(){if(this.offlineQueue.length===0)return;console.log("Processing offline queue...");const e=[...this.offlineQueue];this.offlineQueue=[];const o=this.db.transaction("offlineQueue","readwrite").objectStore("offlineQueue");await new Promise(n=>{o.clear().onsuccess=n});for(const n of e)try{switch(n.type){case"publishChunk":await this.publishChunk(n.chunkHash,n.chunkData,n.chunkIndex,n.totalChunks);break;case"publishIP":await this.broadcastIP(n.ipHash,n.metadata,n.chunkHashes);break;default:console.warn("Unknown offline operation type:",n.type)}}catch(s){console.error(`Failed to process offline operation ${n.type}:`,s),this.offlineQueue.push(n),await this.dbAdd("offlineQueue",{id:Date.now().toString(),value:n})}}loadIdentity(){this.db&&this.dbGet("store","dcrypt_identity").then(e=>{e&&e.value&&typeof e.value=="string"&&(this.keypair=this.hexToUint8Array(e.value),console.log("Loaded identity from IndexedDB"))}).catch(e=>{console.error("Failed to load identity:",e)})}loadOfflineQueue(){this.db&&this.dbGetAll("offlineQueue").then(e=>{this.offlineQueue=e.map(t=>t.value),console.log("Loaded offline queue:",this.offlineQueue)}).catch(e=>{console.error("Failed to load offline queue:",e)})}loadTransactions(){this.db&&this.dbGetAll("transactions").then(e=>{console.log("Loaded transactions:",e)}).catch(e=>{console.error("Failed to load transactions:",e)})}async dbPut(e,t){if(!this.db)throw new Error("IndexedDB not initialized");return new Promise((o,n)=>{const i=this.db.transaction(e,"readwrite").objectStore(e).put(t);i.onsuccess=()=>o(),i.onerror=c=>n(new Error(`DB put failed: ${c.target.error.message}`))})}async dbAdd(e,t){if(!this.db)throw new Error("IndexedDB not initialized");return new Promise((o,n)=>{const i=this.db.transaction(e,"readwrite").objectStore(e).add(t);i.onsuccess=()=>o(),i.onerror=c=>n(new Error(`DB add failed: ${c.target.error.message}`))})}async dbGet(e,t){if(!this.db)throw new Error("IndexedDB not initialized");return new Promise((o,n)=>{const i=this.db.transaction(e,"readonly").objectStore(e).get(t);i.onsuccess=()=>o(i.result),i.onerror=c=>n(new Error(`DB get failed: ${c.target.error.message}`))})}async dbGetAll(e){if(!this.db)throw new Error("IndexedDB not initialized");return new Promise((t,o)=>{const a=this.db.transaction(e,"readonly").objectStore(e).getAll();a.onsuccess=()=>t(a.result),a.onerror=i=>o(new Error(`DB getAll failed: ${i.target.error.message}`))})}uint8ArrayToHex(e){return Array.from(e).map(t=>t.toString(16).padStart(2,"0")).join("")}hexToUint8Array(e){if(!e||typeof e!="string")return new Uint8Array(0);const t=e.match(/.{1,2}/g);return t?new Uint8Array(t.map(o=>parseInt(o,16))):new Uint8Array(0)}broadcast(e){this.peers.forEach((t,o)=>{t.connected&&t.conn&&t.conn.send(e)})}}class ne{constructor(e,t=!0){this.uid=e,this.isNode=t,this.peerId=t?`node-${e}`:e,this.peer=null,this.connections=new Map}async init(){return console.log(`Initializing test peer with ID: ${this.peerId}`),this.peer=new q(this.peerId,{host:"0.peerjs.com",port:443,path:"/",secure:!0,debug:2}),new Promise((e,t)=>{this.peer.on("open",()=>{console.log(`Test peer ${this.peerId} is online`),this.setupListeners(),e()}),this.peer.on("error",o=>{console.error(`Test peer ${this.peerId} error:`,o),t(o)})})}setupListeners(){this.peer.on("connection",e=>{console.log(`Test peer ${this.peerId} received connection from ${e.peer}`),this.handleConnection(e)}),this.peer.on("disconnected",()=>{console.log(`Test peer ${this.peerId} disconnected. Attempting to reconnect...`),this.peer.reconnect()})}handleConnection(e){this.connections.set(e.peer,e),e.on("open",()=>{console.log(`Test peer ${this.peerId} connected to ${e.peer}`),e.send({type:"handshake",peerId:this.peerId})}),e.on("data",t=>{console.log(`Test peer ${this.peerId} received data from ${e.peer}:`,t)}),e.on("close",()=>{console.log(`Test peer ${this.peerId} connection closed with ${e.peer}`),this.connections.delete(e.peer)}),e.on("error",t=>{console.error(`Test peer ${this.peerId} connection error with ${e.peer}:`,t)})}connectToPeer(e){if(e===this.peerId||this.connections.has(e))return;console.log(`Test peer ${this.peerId} attempting to connect to ${e}`);const t=this.peer.connect(e,{reliable:!0});t.on("open",()=>{console.log(`Test peer ${this.peerId} connected to ${e}`),this.connections.set(e,t),t.send({type:"handshake",peerId:this.peerId})}),t.on("data",o=>{console.log(`Test peer ${this.peerId} received data from ${e}:`,o)}),t.on("close",()=>{console.log(`Test peer ${this.peerId} connection closed with ${e}`),this.connections.delete(e)}),t.on("error",o=>{console.error(`Test peer ${this.peerId} connection error with ${e}:`,o)})}}async function oe(){const r=[],e=["test-uid-1","test-uid-2","test-uid-3","test-uid-4","test-uid-5"];for(const t of e)try{await L(S(B,"nodes",t),{active:!0}),console.log(`Registered ${t} as a node in Firestore`)}catch(o){console.error(`Failed to register ${t} in Firestore:`,o)}for(const t of e){const o=new ne(t,!0);await o.init(),r.push(o)}for(let t=0;t<r.length;t++)for(let o=0;o<r.length;o++)t!==o&&r[t].connectToPeer(r[o].peerId);return r}let I,d,T=!1,$=[];document.addEventListener("DOMContentLoaded",()=>{const r=document.getElementById("loginButton"),e=document.getElementById("logoutButton"),t=document.getElementById("userBalance"),o=document.getElementById("publishButton"),n=document.getElementById("searchButton"),s=document.getElementById("buyButton"),a=document.getElementById("withdrawButton"),i=document.getElementById("toggleHistoryButton"),c=document.getElementById("transactionHistory"),l=document.getElementById("publishedItems").querySelector("tbody");if(!r||!e||!t||!o||!n||!s||!a||!i||!c||!l){console.error("Required DOM elements not found:",{loginButton:!!r,logoutButton:!!e,userBalanceElement:!!t,publishButton:!!o,searchButton:!!n,buyButton:!!s,withdrawButton:!!a,toggleHistoryButton:!!i,transactionHistory:!!c,publishedItemsTableBody:!!l});return}r.addEventListener("click",re),e.addEventListener("click",M),x(k,u=>{u?(console.log("User is signed in:",u.uid),r.classList.add("hidden"),e.classList.remove("hidden"),o.disabled=!1,n.disabled=!1,s.disabled=!1,a.disabled=!1,i.disabled=!1,z()):(console.log("No user is signed in."),r.classList.remove("hidden"),e.classList.add("hidden"),o.disabled=!0,n.disabled=!0,s.disabled=!0,a.disabled=!0,i.disabled=!0,_())}),window.logout=M,window.publishSnippet=ie,window.buySnippet=ae,window.searchSnippets=ce,window.withdraw=le,window.toggleTransactionHistory=de});async function z(){console.log("Initializing app..."),y(!0);try{console.log("Loading WASM module..."),I=await ee(),console.log("WASM module loaded successfully:",I),console.log("WASM module exports in init:",Object.keys(I));const r=await new Promise(o=>{x(k,n=>{o(n)})});if(!r){console.log("User is not authenticated. Please sign in."),f("Please sign in to continue.");return}const t=new TextEncoder().encode(r.uid);T=await se(),console.log(`User is ${T?"":"not "}a node.`),$.length===0&&(console.log("Creating test peers..."),$=await oe(),console.log("Test peers created:",$.map(o=>o.peerId))),console.log("Initializing DHT..."),d=new te(t,T,I),window.dht=d,await d.initDB(),console.log("IndexedDB initialized."),await d.initSwarm(),console.log("DHT initialized."),await d.syncUserData(),console.log("User data synced."),O(),console.log("Live feed updated."),E(),D()}catch(r){throw console.error("Error initializing application:",r),f(`Initialization failed: ${r.message}`),r}finally{y(!1),ue()}}async function se(){const r=k.currentUser;if(!r)return console.log("No authenticated user found."),!1;try{const e=S(B,"nodes",r.uid);return(await K(e)).exists()}catch(e){return console.error("Failed to check node status:",e),!1}}async function re(){const r=new F;try{const t=(await R(k,r)).user;console.log("Signed in user UID:",t.uid),f("Signed in successfully!"),await z()}catch(e){console.error("Sign-in failed:",e),f(`Sign-in failed: ${e.message}`)}}async function M(){try{await W(k),f("Signed out successfully!"),d=null,window.dht=null,$=[],_()}catch(r){console.error("Sign-out failed:",r),f(`Sign-out failed: ${r.message}`)}}function v(){return!!k.currentUser}async function ie(r,e,t,o,n){if(!v()){f("Please sign in to publish.");return}y(!0);try{if(!d)throw new Error("DHT not initialized");if(!r)throw new Error("Title is required");let s=o||"",a="text/plain";if(n&&n.files&&n.files.length>0){const l=n.files[0];a=l.type||"application/octet-stream";const u=new FileReader;s=await new Promise((h,g)=>{u.onload=w=>h(new Uint8Array(w.target.result)),u.onerror=w=>g(new Error("Failed to read file")),u.readAsArrayBuffer(l)})}else s=new TextEncoder().encode(s);const i=document.getElementById("isPremium").checked,c={content_type:r,description:e||"",tags:t?t.split(",").map(l=>l.trim()):[],isPremium:i};await d.publishIP(c,s,a),f("Snippet published successfully!"),O(),D(),E(),await A()}catch(s){console.error("publishSnippet failed:",s),f(`Publish failed: ${s.message}`)}finally{y(!1)}}async function ae(r){if(!v())return f("Please sign in to buy."),null;y(!0);try{if(!d)throw new Error("DHT not initialized");if(!r)throw new Error("Hash is required");const e=d.knownObjects.get(r);if(!e)throw new Error("Snippet not found");const o=e.metadata.isPremium||!1?30:5,n=await d.getBalance(d.keypair);if(n<o)throw new Error("Insufficient balance");const s=o*.05;await d.distributeCommission(s),await d.putBalance(d.keypair,n-o),await d.dbAdd("transactions",{type:"buy",amount:o,timestamp:Date.now()});const{data:a,fileType:i}=await d.requestData(r);return f("Snippet purchased and cached!"),D(),E(),await A(),{data:a,fileType:i}}catch(e){return console.error("buySnippet failed:",e),f(`Purchase failed: ${e.message}`),null}finally{y(!1)}}async function ce(r){if(!v()){f("Please sign in to search.");return}y(!0);try{if(!d)throw new Error("DHT not initialized");if(!r)throw new Error("Search query is required");const e=document.getElementById("publishedItems").querySelector("tbody");e.innerHTML="",d.knownObjects.forEach((t,o)=>{const{content_type:n,description:s,tags:a}=t.metadata,i=r.toLowerCase();if(n.toLowerCase().includes(i)||s&&s.toLowerCase().includes(i)||a&&a.some(c=>c.toLowerCase().includes(i))){const c=document.createElement("tr");c.innerHTML=`
          <td>${n}</td>
          <td>${s||"No description"}</td>
          <td>${a.join(", ")||"No tags"}</td>
          <td><button onclick="window.buySnippet('${o}')" class="bg-purple-500 text-white rounded hover:bg-purple-600">Buy (${t.metadata.isPremium?"30 DCT":"5 DCT"})</button></td>
        `,e.appendChild(c)}}),f("Search completed!")}catch(e){console.error("searchSnippets failed:",e),f(`Search failed: ${e.message}`)}finally{y(!1)}}async function le(r){if(!v()){f("Please sign in to withdraw.");return}y(!0);try{if(!d)throw new Error("DHT not initialized");if(!r||r<=0)throw new Error("Invalid withdrawal amount");const e=await d.getBalance(d.keypair);if(e<r)throw new Error("Insufficient balance");await d.putBalance(d.keypair,e-r),await d.dbAdd("transactions",{type:"withdraw",amount:r,timestamp:Date.now()}),f(`Withdrew ${r} DCT successfully!`),D(),E(),await A()}catch(e){console.error("withdraw failed:",e),f(`Withdrawal failed: ${e.message}`)}finally{y(!1)}}function de(){const r=document.getElementById("transactionHistory");r.style.display==="none"?r.style.display="block":r.style.display="none"}async function A(){const r=k.currentUser;if(r)try{const e=S(B,"users",r.uid);await L(e,{balance:await d.getBalance(d.keypair),lastUpdated:Date.now()},{merge:!0}),console.log("User data uploaded to Firebase")}catch(e){console.error("Failed to upload user data to Firebase:",e)}}function O(){const r=document.getElementById("publishedItems").querySelector("tbody");r&&(r.innerHTML="",d.knownObjects.forEach((e,t)=>{const o=document.createElement("tr");o.innerHTML=`
      <td>${e.metadata.content_type}</td>
      <td>${e.metadata.description||"No description"}</td>
      <td>${e.metadata.tags.join(", ")||"No tags"}</td>
      <td><button onclick="window.buySnippet('${t}')" class="bg-purple-500 text-white rounded hover:bg-purple-600">Buy (${e.metadata.isPremium?"30 DCT":"5 DCT"})</button></td>
    `,r.appendChild(o)}))}function D(){const r=document.getElementById("transactionList");r&&d.dbGetAll("transactions").then(e=>{if(e.length===0){r.innerHTML="No transactions yet.";return}r.innerHTML=e.map(t=>`<p>${t.type} - ${t.amount} DCT - ${new Date(t.timestamp).toLocaleString()}</p>`).join("")})}function E(){const r=document.getElementById("userBalance");r&&d.getBalance(d.keypair).then(e=>{r.textContent=`Balance: ${e} DCT`})}function _(){const r=document.getElementById("publishedItems").querySelector("tbody"),e=document.getElementById("transactionList"),t=document.getElementById("userBalance");r&&(r.innerHTML=""),e&&(e.innerHTML="No transactions yet."),t&&(t.textContent="Balance: 0 DCT")}function f(r){const e=document.getElementById("toast");e&&(e.textContent=r,e.style.display="block",setTimeout(()=>{e.style.display="none"},3e3))}function y(r){const e=document.getElementById("loading");e&&(e.style.display=r?"flex":"none")}function ue(){const r=document.getElementById("isPremium"),e=document.getElementById("withdrawAmount");r&&e&&r.addEventListener("change",t=>{console.log("Premium toggle:",t.target.checked),e.classList.toggle("hidden",!t.target.checked)})}
