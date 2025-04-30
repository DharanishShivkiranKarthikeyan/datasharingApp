import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyBrdrwvY-lPObZgortEgw7YWycUOGsBlyM",
    authDomain: "dcrypt-edb9c.firebaseapp.com",
    projectId: "dcrypt-edb9c",
    storageBucket: "dcrypt-edb9c.firebasestorage.app",
    messagingSenderId: "952133736604",
    appId: "1:952133736604:web:32d799360f200bce84f559",
    measurementId: "G-7KCDLQ6JNH"
  };

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
const auth = getAuth(app);
const db = getFirestore(app);
// Export the initialized services
export { auth, db };