import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAS0NNcZy0t-LN2wCB7p0941jR0bo-MNls",
  authDomain: "ahmedelzaiady.firebaseapp.com",
  projectId: "ahmedelzaiady",
  storageBucket: "ahmedelzaiady.firebasestorage.app",
  messagingSenderId: "300306825071",
  appId: "1:300306825071:web:0426ddde56280fa090329a",
  measurementId: "G-WE04GK5XZZ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function createUsers() {
  await setDoc(doc(db, "users", "admin"), {
    pass: "1234",
    role: "admin"
  });

  await setDoc(doc(db, "users", "cashier1"), {
    pass: "1111",
    role: "cashier"
  });

  await setDoc(doc(db, "users", "ahmed"), {
    pass: "2222",
    role: "admin"
  });

  console.log("Users created ✅");
}

createUsers();
