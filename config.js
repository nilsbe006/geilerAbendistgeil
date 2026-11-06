// Firebase-Web-Config: Firebase Console → Projekteinstellungen → Deine Apps → Web-App → "Konfiguration".
// Diese Werte sind laut Firebase öffentlich – geschützt wird über Login + database.rules.json.
window.FIREBASE_CONFIG = null;
/* Beispiel:
window.FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "dein-projekt.firebaseapp.com",
  databaseURL: "https://dein-projekt-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "dein-projekt",
  appId: "...",
};
*/

// Accounts: Login-Name → E-Mail <id>@geilerabend.app in Firebase Authentication.
window.USERS = [
  { id: "nils", name: "Nils", color: "#ff3d8b" },
  { id: "niklas", name: "Niklas", color: "#ffb238" },
  { id: "guido", name: "Guido", color: "#3ddc97" },
];
window.EMAIL_DOMAIN = "geilerabend.app";
