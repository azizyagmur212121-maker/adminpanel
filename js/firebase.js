import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCSZzQwWvgAoIrhGtqtFU6hV1SoQfHBMDs",
    authDomain: "muglaburadaa.firebaseapp.com",
    projectId: "muglaburadaa",
    storageBucket: "muglaburadaa.firebasestorage.app",
    messagingSenderId: "958205095433",
    appId: "1:958205095433:web:413e523abce2d24575d2d8",
    measurementId: "G-JDVVT9NMP5"
};

// Firebase'i başlat
const app = initializeApp(firebaseConfig);

// Diğer dosyalarda kullanmak için dışa aktar
export const auth = getAuth(app);
export const db = getFirestore(app);