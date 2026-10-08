// Copier ce fichier en "secrets.h" (même dossier) puis remplir les valeurs.
// secrets.h est ignoré par git : ne jamais le committer.
#pragma once

#define WIFI_SSID_VALUE   "MonReseauWiFi"
#define WIFI_PASS_VALUE   "motdepasse-wifi"
#define DB_URL_VALUE      "https://votre-projet-default-rtdb.europe-west1.firebasedatabase.app"
#define DEVICE_ID_VALUE   "esp32-01"

// Telegram (optionnel) : laisser "" pour désactiver.
// Token : dans Telegram, @BotFather -> /newbot. Le destinataire n'est pas fixé ici :
// l'utilisateur vérifie son numéro depuis l'app (Réglages > Alertes Telegram).
#define TELEGRAM_TOKEN_VALUE    "123456789:ABCdefGhIJKlmNoPQRstuVWxyz"
