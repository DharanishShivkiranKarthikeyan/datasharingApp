// web/signup.js
import { auth, db } from './firebase.js';
import { signInWithPopup, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

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
  showLoading(true);
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    console.log('Signed up user UID:', user.uid);

    // Check if the user wants to sign up as a node
      window.location.href = '/datasharingApp/';
    }
    finally{
        showLoading(false)
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