// web/signup.js
import { auth, db } from './firebase.js';
import { signInWithPopup, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

document.addEventListener('DOMContentLoaded', () => {
  const signupButton = document.getElementById('signupButton');
  if (!signupButton) {
    console.error('Sign-up button not found');
    return;
  }

  signupButton.addEventListener('click', signUp);
});

async function signUp() {
  showLoading(true);
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    console.log('Signed up user UID:', user.uid);

    // Check if the user wants to sign up as a node
    const role = document.querySelector('input[name="role"]:checked').value;
    const isNode = role === 'node';

    if (isNode) {
      // Register the user as a node in Firestore
      const nodeRef = doc(db, 'nodes', user.uid);
      await setDoc(nodeRef, {
        uid: user.uid,
        createdAt: Date.now(),
        status: 'active'
      });
      console.log('User registered as a node');
      showToast('Signed up as a node successfully!');
      // Redirect to node instructions page
      window.location.href = '/node-instructions.html';
    } else {
      // Register the user as a regular user (optional: store user metadata)
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        uid: user.uid,
        createdAt: Date.now(),
        balance: 0
      }, { merge: true });
      console.log('User registered as a regular user');
      showToast('Signed up successfully!');
      // Redirect back to the dashboard
      window.location.href = '/index.html';
    }
  } catch (error) {
    console.error('Sign-up failed:', error);
    showToast(`Sign-up failed: ${error.message}`);
  } finally {
    showLoading(false);
  }
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

function showLoading(show) {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = show ? 'flex' : 'none';
}