// web/node-instructions.js
import { l } from 'vite/dist/node/types.d-aGj9QkWt.js';
import { DHT } from './dht.js';

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

