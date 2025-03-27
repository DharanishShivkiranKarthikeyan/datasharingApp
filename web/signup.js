// web/signup.js
import { auth, db } from './firebase.js';
import { signInWithPopup, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
import { generateUUID } from './index.js'; // Import generateUUID from index.js

// Only run this code if we're on signup.html
if (window.location.pathname === '/datasharingApp/signup.html' || window.location.pathname === '/signup.html') {
  document.addEventListener('DOMContentLoaded', () => {
    const signupButton = document.getElementById('signupButton');
    if (!signupButton) {
      console.error('Sign-up button not found');
      return;
    }

    signupButton.addEventListener('click', signUp);
  });
}

async function signUp() {
  const roleInputs = document.querySelectorAll('input[name="role"]');
  if (!roleInputs) {
    showToast('Role selection not found.', true);
    return;
  }

  const role = Array.from(roleInputs).find(input => input.checked)?.value;
  if (!role) {
    showToast('Please select a role.', true);
    return;
  }

  showLoading(true);
  try {
    if (role === 'user') {
      console.log("Handling user signup with OAuth...");
      // User signup with OAuth
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      console.log('Signed in user UID:', user.uid);
      showToast('Signed in successfully!');

      // Store user data in Firestore
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        uid: user.uid,
        createdAt: Date.now(),
        balance: 0
      }, { merge: true });

      window.location.href = '/datasharingApp/index.html';
    } else {
      console.log("Handling node signup without OAuth...");
      // Node signup without OAuth
      const nodeId = generateUUID();
      console.log('Generated node ID:', nodeId);

      // Store node ID in localStorage
      localStorage.setItem('nodeId', nodeId);
      localStorage.setItem('role', 'node');

      // Store node data in Firestore
      const nodeRef = doc(db, 'nodes', nodeId);
      await setDoc(nodeRef, {
        role: 'node',
        createdAt: Date.now(),
        status: 'active'
      }, { merge: true });

      showToast('Node created successfully!');
      window.location.href = '/datasharingApp/node-instructions.html';
    }
  } catch (error) {
    console.error('Sign-up failed:', error);
    showToast(`Sign-up failed: ${error.message}`, true);
  } finally {
    showLoading(false);
  }
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.className = 'toast';
  if (isError) toast.classList.add('error-toast');
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

function showLoading(show) {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = show ? 'flex' : 'none';
}