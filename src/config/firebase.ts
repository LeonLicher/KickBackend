import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyCpF2SbYJClssBoPFIUV1UnGM-6z9D4gE0",
    authDomain: "my-firebase-express-app-e05bd.firebaseapp.com",
    projectId: "my-firebase-express-app-e05bd",
    storageBucket: "my-firebase-express-app-e05bd.firebasestorage.app",
    messagingSenderId: "1047074562519",
    appId: "1:1047074562519:web:96ad583d1128ab0b6d6b92",
    measurementId: "G-ZT7HZHN69X"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  
  // Initialize Firestore
  const db = getFirestore(app);
  
  export { db };