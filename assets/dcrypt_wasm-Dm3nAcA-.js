let c,s=0,A=null;function y(){return(A===null||A.byteLength===0)&&(A=new Uint8Array(c.memory.buffer)),A}const k=typeof TextEncoder<"u"?new TextEncoder("utf-8"):{encode:()=>{throw Error("TextEncoder not available")}},B=typeof k.encodeInto=="function"?function(n,e){return k.encodeInto(n,e)}:function(n,e){const t=k.encode(n);return e.set(t),{read:n.length,written:t.length}};function g(n,e,t){if(t===void 0){const u=k.encode(n),a=e(u.length,1)>>>0;return y().subarray(a,a+u.length).set(u),s=u.length,a}let r=n.length,i=e(r,1)>>>0;const _=y();let o=0;for(;o<r;o++){const u=n.charCodeAt(o);if(u>127)break;_[i+o]=u}if(o!==r){o!==0&&(n=n.slice(o)),i=t(i,r,r=o+n.length*3,1)>>>0;const u=y().subarray(i+o,i+r),a=B(n,u);o+=a.written,i=t(i,r,o,1)>>>0}return s=o,i}let w=null;function b(){return(w===null||w.buffer.detached===!0||w.buffer.detached===void 0&&w.buffer!==c.memory.buffer)&&(w=new DataView(c.memory.buffer)),w}function F(n){const e=c.__externref_table_alloc();return c.__wbindgen_export_4.set(e,n),e}function S(n,e){try{return n.apply(this,e)}catch(t){const r=F(t);c.__wbindgen_exn_store(r)}}const E=typeof TextDecoder<"u"?new TextDecoder("utf-8",{ignoreBOM:!0,fatal:!0}):{decode:()=>{throw Error("TextDecoder not available")}};typeof TextDecoder<"u"&&E.decode();function d(n,e){return n=n>>>0,E.decode(y().subarray(n,n+e))}function m(n){return n==null}function j(n){const e=typeof n;if(e=="number"||e=="boolean"||n==null)return`${n}`;if(e=="string")return`"${n}"`;if(e=="symbol"){const i=n.description;return i==null?"Symbol":`Symbol(${i})`}if(e=="function"){const i=n.name;return typeof i=="string"&&i.length>0?`Function(${i})`:"Function"}if(Array.isArray(n)){const i=n.length;let _="[";i>0&&(_+=j(n[0]));for(let o=1;o<i;o++)_+=", "+j(n[o]);return _+="]",_}const t=/\[object ([^\]]+)\]/.exec(toString.call(n));let r;if(t&&t.length>1)r=t[1];else return toString.call(n);if(r=="Object")try{return"Object("+JSON.stringify(n)+")"}catch{return"Object"}return n instanceof Error?`${n.name}: ${n.message}
${n.stack}`:r}function N(n,e,t,r,i){const _=g(n,c.__wbindgen_malloc,c.__wbindgen_realloc),o=s,u=g(t,c.__wbindgen_malloc,c.__wbindgen_realloc),a=s,h=g(i,c.__wbindgen_malloc,c.__wbindgen_realloc),x=s;return c.create_metadata(_,o,e,u,a,r,h,x)}function l(n,e){const t=e(n.length*1,1)>>>0;return y().set(n,t/1),s=n.length,t}function f(n){const e=c.__wbindgen_export_4.get(n);return c.__externref_table_dealloc(n),e}function $(n,e,t,r,i,_,o){const u=l(n,c.__wbindgen_malloc),a=s,h=g(e,c.__wbindgen_malloc,c.__wbindgen_realloc),x=s,v=l(_,c.__wbindgen_malloc),O=s,U=g(o,c.__wbindgen_malloc,c.__wbindgen_realloc),M=s,I=c.create_intellectual_property(u,a,h,x,t,r,i,v,O,U,M);if(I[2])throw f(I[1]);return f(I[0])}function z(n,e,t,r){const i=l(n,c.__wbindgen_malloc),_=s,o=l(e,c.__wbindgen_malloc),u=s,a=g(r,c.__wbindgen_malloc,c.__wbindgen_realloc),h=s;return c.create_chunk(i,_,o,u,t,a,h)}function p(n,e){return n=n>>>0,y().subarray(n/1,n/1+e)}function L(n){const e=c.get_ip_content(n);if(e[3])throw f(e[2]);var t=p(e[0],e[1]).slice();return c.__wbindgen_free(e[0],e[1]*1,1),t}function q(n){const e=c.get_ip_metadata(n);if(e[2])throw f(e[1]);return f(e[0])}function V(n){const e=c.get_ip_is_premium(n);if(e[2])throw f(e[1]);return e[0]!==0}function C(n){const e=c.get_ip_price_dct(n);if(e[2])throw f(e[1]);return BigInt.asUintN(64,e[0])}function P(n){const e=c.get_ip_creator_id(n);if(e[3])throw f(e[2]);var t=p(e[0],e[1]).slice();return c.__wbindgen_free(e[0],e[1]*1,1),t}function J(n){const e=c.get_ip_file_size(n);if(e[2])throw f(e[1]);return BigInt.asUintN(64,e[0])}function G(n){let e,t;try{const _=c.get_ip_file_type(n);var r=_[0],i=_[1];if(_[3])throw r=0,i=0,f(_[2]);return e=r,t=i,d(r,i)}finally{c.__wbindgen_free(e,t,1)}}function H(n){const e=c.get_chunk_hash(n);if(e[3])throw f(e[2]);var t=p(e[0],e[1]).slice();return c.__wbindgen_free(e[0],e[1]*1,1),t}function K(n){const e=c.get_chunk_data(n);if(e[3])throw f(e[2]);var t=p(e[0],e[1]).slice();return c.__wbindgen_free(e[0],e[1]*1,1),t}function Q(n){const e=c.get_chunk_index(n);if(e[2])throw f(e[1]);return e[0]>>>0}function X(n){let e,t;try{const _=c.get_chunk_file_type(n);var r=_[0],i=_[1];if(_[3])throw r=0,i=0,f(_[2]);return e=r,t=i,d(r,i)}finally{c.__wbindgen_free(e,t,1)}}function Y(){c.init()}function Z(n,e){return c.compute_chunk_size(n,e)>>>0}function ee(n,e,t){const r=l(e,c.__wbindgen_malloc),i=s,_=c.chunk_encrypt(n,r,i,t);if(_[2])throw f(_[1]);return f(_[0])}function ne(n,e){const t=l(e,c.__wbindgen_malloc),r=s,i=c.decrypt_chunk(n,t,r);if(i[3])throw f(i[2]);var _=p(i[0],i[1]).slice();return c.__wbindgen_free(i[0],i[1]*1,1),_}function te(n){const e=l(n,c.__wbindgen_malloc),t=s,r=c.compute_full_hash(e,t);var i=p(r[0],r[1]).slice();return c.__wbindgen_free(r[0],r[1]*1,1),i}async function R(n,e){if(typeof Response=="function"&&n instanceof Response){if(typeof WebAssembly.instantiateStreaming=="function")try{return await WebAssembly.instantiateStreaming(n,e)}catch(r){if(n.headers.get("Content-Type")!="application/wasm")console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n",r);else throw r}const t=await n.arrayBuffer();return await WebAssembly.instantiate(t,e)}else{const t=await WebAssembly.instantiate(n,e);return t instanceof WebAssembly.Instance?{instance:t,module:n}:t}}function T(){const n={};return n.wbg={},n.wbg.__wbg_String_8f0eb39a4a4c2f66=function(e,t){const r=String(t),i=g(r,c.__wbindgen_malloc,c.__wbindgen_realloc),_=s;b().setInt32(e+4*1,_,!0),b().setInt32(e+4*0,i,!0)},n.wbg.__wbg_buffer_609cc3eee51ed158=function(e){return e.buffer},n.wbg.__wbg_call_672a4d21634d4a24=function(){return S(function(e,t){return e.call(t)},arguments)},n.wbg.__wbg_done_769e5ede4b31c67b=function(e){return e.done},n.wbg.__wbg_error_7534b8e9a36f1ab4=function(e,t){let r,i;try{r=e,i=t,console.error(d(e,t))}finally{c.__wbindgen_free(r,i,1)}},n.wbg.__wbg_get_67b2ba62fc30de12=function(){return S(function(e,t){return Reflect.get(e,t)},arguments)},n.wbg.__wbg_get_b9b93047fe3cf45b=function(e,t){return e[t>>>0]},n.wbg.__wbg_getwithrefkey_1dc361bd10053bfe=function(e,t){return e[t]},n.wbg.__wbg_instanceof_ArrayBuffer_e14585432e3737fc=function(e){let t;try{t=e instanceof ArrayBuffer}catch{t=!1}return t},n.wbg.__wbg_instanceof_Uint8Array_17156bcf118086a9=function(e){let t;try{t=e instanceof Uint8Array}catch{t=!1}return t},n.wbg.__wbg_isArray_a1eab7e0d067391b=function(e){return Array.isArray(e)},n.wbg.__wbg_isSafeInteger_343e2beeeece1bb0=function(e){return Number.isSafeInteger(e)},n.wbg.__wbg_iterator_9a24c88df860dc65=function(){return Symbol.iterator},n.wbg.__wbg_length_a446193dc22c12f8=function(e){return e.length},n.wbg.__wbg_length_e2d2a49132c1b256=function(e){return e.length},n.wbg.__wbg_log_c222819a41e063d3=function(e){console.log(e)},n.wbg.__wbg_new_405e22f390576ce2=function(){return new Object},n.wbg.__wbg_new_78feb108b6472713=function(){return new Array},n.wbg.__wbg_new_8a6f238a6ece86ea=function(){return new Error},n.wbg.__wbg_new_a12002a7f91c75be=function(e){return new Uint8Array(e)},n.wbg.__wbg_next_25feadfc0913fea9=function(e){return e.next},n.wbg.__wbg_next_6574e1a8a62d1055=function(){return S(function(e){return e.next()},arguments)},n.wbg.__wbg_push_737cfc8c1432c2c6=function(e,t){return e.push(t)},n.wbg.__wbg_set_37837023f3d740e8=function(e,t,r){e[t>>>0]=r},n.wbg.__wbg_set_3f1d0b984ed272ed=function(e,t,r){e[t]=r},n.wbg.__wbg_set_65595bdd868b3009=function(e,t,r){e.set(t,r>>>0)},n.wbg.__wbg_stack_0ed75d68575b0f3c=function(e,t){const r=t.stack,i=g(r,c.__wbindgen_malloc,c.__wbindgen_realloc),_=s;b().setInt32(e+4*1,_,!0),b().setInt32(e+4*0,i,!0)},n.wbg.__wbg_value_cd1ffa7b1ab794f1=function(e){return e.value},n.wbg.__wbindgen_as_number=function(e){return+e},n.wbg.__wbindgen_bigint_from_u64=function(e){return BigInt.asUintN(64,e)},n.wbg.__wbindgen_bigint_get_as_i64=function(e,t){const r=t,i=typeof r=="bigint"?r:void 0;b().setBigInt64(e+8*1,m(i)?BigInt(0):i,!0),b().setInt32(e+4*0,!m(i),!0)},n.wbg.__wbindgen_boolean_get=function(e){const t=e;return typeof t=="boolean"?t?1:0:2},n.wbg.__wbindgen_debug_string=function(e,t){const r=j(t),i=g(r,c.__wbindgen_malloc,c.__wbindgen_realloc),_=s;b().setInt32(e+4*1,_,!0),b().setInt32(e+4*0,i,!0)},n.wbg.__wbindgen_error_new=function(e,t){return new Error(d(e,t))},n.wbg.__wbindgen_in=function(e,t){return e in t},n.wbg.__wbindgen_init_externref_table=function(){const e=c.__wbindgen_export_4,t=e.grow(4);e.set(0,void 0),e.set(t+0,void 0),e.set(t+1,null),e.set(t+2,!0),e.set(t+3,!1)},n.wbg.__wbindgen_is_bigint=function(e){return typeof e=="bigint"},n.wbg.__wbindgen_is_function=function(e){return typeof e=="function"},n.wbg.__wbindgen_is_object=function(e){const t=e;return typeof t=="object"&&t!==null},n.wbg.__wbindgen_is_undefined=function(e){return e===void 0},n.wbg.__wbindgen_jsval_eq=function(e,t){return e===t},n.wbg.__wbindgen_jsval_loose_eq=function(e,t){return e==t},n.wbg.__wbindgen_memory=function(){return c.memory},n.wbg.__wbindgen_number_get=function(e,t){const r=t,i=typeof r=="number"?r:void 0;b().setFloat64(e+8*1,m(i)?0:i,!0),b().setInt32(e+4*0,!m(i),!0)},n.wbg.__wbindgen_number_new=function(e){return e},n.wbg.__wbindgen_string_get=function(e,t){const r=t,i=typeof r=="string"?r:void 0;var _=m(i)?0:g(i,c.__wbindgen_malloc,c.__wbindgen_realloc),o=s;b().setInt32(e+4*1,o,!0),b().setInt32(e+4*0,_,!0)},n.wbg.__wbindgen_string_new=function(e,t){return d(e,t)},n.wbg.__wbindgen_throw=function(e,t){throw new Error(d(e,t))},n}function W(n,e){return c=n.exports,D.__wbindgen_wasm_module=e,w=null,A=null,c.__wbindgen_start(),c}function re(n){if(c!==void 0)return c;typeof n<"u"&&(Object.getPrototypeOf(n)===Object.prototype?{module:n}=n:console.warn("using deprecated parameters for `initSync()`; pass a single object instead"));const e=T();n instanceof WebAssembly.Module||(n=new WebAssembly.Module(n));const t=new WebAssembly.Instance(n,e);return W(t,n)}async function D(n){if(c!==void 0)return c;typeof n<"u"&&(Object.getPrototypeOf(n)===Object.prototype?{module_or_path:n}=n:console.warn("using deprecated parameters for the initialization function; pass a single object instead")),typeof n>"u"&&(n=new URL("/datasharingApp/assets/dcrypt_wasm_bg-B-F1cFiv.wasm",import.meta.url));const e=T();(typeof n=="string"||typeof Request=="function"&&n instanceof Request||typeof URL=="function"&&n instanceof URL)&&(n=fetch(n));const{instance:t,module:r}=await R(await n,e);return W(t,r)}export{ee as chunk_encrypt,Z as compute_chunk_size,te as compute_full_hash,z as create_chunk,$ as create_intellectual_property,N as create_metadata,ne as decrypt_chunk,D as default,K as get_chunk_data,X as get_chunk_file_type,H as get_chunk_hash,Q as get_chunk_index,L as get_ip_content,P as get_ip_creator_id,J as get_ip_file_size,G as get_ip_file_type,V as get_ip_is_premium,q as get_ip_metadata,C as get_ip_price_dct,Y as init,re as initSync};
