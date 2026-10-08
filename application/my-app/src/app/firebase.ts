import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

// Realtime Database en accès public (voir firebase/database.rules.json) : l'URL suffit.
// Pour ajouter Auth plus tard, compléter avec la config web du projet
// (console Firebase > Paramètres du projet > Vos applications > Web).
export const firebaseConfig = {
  databaseURL: 'https://myapp-db367-default-rtdb.europe-west1.firebasedatabase.app',
};

// Poste suivi : ?device=esp32-02 dans l'URL pour en changer
export const DEVICE_ID = new URLSearchParams(location.search).get('device') ?? 'esp32-01';

export const firebaseApp = initializeApp(firebaseConfig);
export const db = getDatabase(firebaseApp);
