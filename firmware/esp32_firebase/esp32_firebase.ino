// DeskGuard - Assistant connecté de poste de travail (EILCO MISC2)
// ESP32 -> Firebase Realtime Database (REST) :
//   devices/<id>/live     : dernière mesure (toutes les sendPeriodS secondes)
//   devices/<id>/history  : 1 enregistrement/min + à chaque changement d'état
//   devices/<id>/config   : réglages lus par l'ESP32, mémorisés en NVS

#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "mbedtls/sha256.h"
#include "Adafruit_VEML7700.h"
#include "secrets.h"   // copier secrets.example.h -> secrets.h

// --- Assignation des broches ---
const int PIN_US      = 18; // Ultrasons Grove (Signal)
const int PIN_PIR     = 19; // Capteur de mouvement PIR (SIG)
const int PIN_RED     = 17; // LED RGB (R)
const int PIN_GREEN   = 16; // LED RGB (G)
const int PIN_BLUE    = 4;  // LED RGB (B)

// --- Bus I2C distincts pour les 2 VEML7700 (même adresse 0x10) ---
TwoWire I2C_1 = TwoWire(0); // Bus 1 : SDA 21, SCL 22 -> capteur côté écran
TwoWire I2C_2 = TwoWire(1); // Bus 2 : SDA 32, SCL 33 -> capteur côté pièce

Adafruit_VEML7700 veml1 = Adafruit_VEML7700();
Adafruit_VEML7700 veml2 = Adafruit_VEML7700();

bool veml1_ok = false;
bool veml2_ok = false;

// --- Réglages (FC6), valeurs par défaut du cahier des charges ---
struct Config {
  float distMin;      // FP1 : seuil de proximité (cm), 40..80
  int   proxDelayS;   // FP1 : durée de dépassement avant alerte (s)
  int   imbalancePct; // FP2 : écart lumineux toléré (%)
  float luxCal;       // FP2 : coefficient de calibration appliqué au capteur pièce
  int   lightDelayS;  // FP2 : durée de dépassement avant alerte (s)
  int   pauseMin;     // FP3 : rappel de pause (min), 20..90
  int   sendPeriodS;  // FC1 : période d'envoi live (s), 1..10
  int   telegramOn;   // 1 = alertes envoyées sur Telegram
};
Config cfg = {45.0, 10, 50, 1.0, 10, 50, 5, 1};
Preferences prefs;

// --- Constantes de détection ---
const float PRESENCE_MAX_CM          = 120.0;  // personne devant l'écran en deçà
const unsigned long ABSENCE_RESET_MS = 120000; // 2 min d'absence = pause prise
const float LUX_MIN_FOR_RATIO        = 10.0;   // en dessous, comparaison non significative

// --- Périodes réseau ---
const unsigned long HISTORY_PERIOD_MS = 60000;
const unsigned long CONFIG_PERIOD_MS  = 30000;
const unsigned long WIFI_RETRY_MS     = 10000;
const unsigned long TELEGRAM_COOLDOWN_MS = 600000; // 1 message max / 10 min par type d'alerte
const unsigned long TELEGRAM_RETRY_MS    = 30000;

// Suivi des messages Telegram par type d'alerte
struct TelegramAlert { bool sent; unsigned long lastSentMs, lastTryMs; };
TelegramAlert tgProx = {}, tgLight = {}, tgBreak = {};

// --- État courant ---
unsigned long proxSinceMs = 0, lightSinceMs = 0;
unsigned long sessionStartMs = 0, lastSeenMs = 0;
unsigned long lastLiveMs = 0, lastHistoryMs = 0, lastConfigMs = 0, lastWifiTryMs = 0;
String lastState = "";

WiFiClientSecure tls;

// Fonction de commande de la LED RGB (0..255 par canal, anode commune non gérée)
void setLed(int r, int g, int b) {
  analogWrite(PIN_RED,   r);
  analogWrite(PIN_GREEN, g);
  analogWrite(PIN_BLUE,  b);
}

// Fonction de mesure ultrasons (Grove monobroche)
float getDistance() {
  pinMode(PIN_US, OUTPUT);
  digitalWrite(PIN_US, LOW);
  delayMicroseconds(5);
  digitalWrite(PIN_US, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_US, LOW);

  pinMode(PIN_US, INPUT);
  long duration = pulseIn(PIN_US, HIGH, 25000); // Timeout à 25 ms (~4 m)

  if (duration == 0) return -1.0;
  return (duration * 0.0343) / 2.0;
}

// ---------------------------------------------------------------------------
// Configuration : NVS + Firebase
// ---------------------------------------------------------------------------
void clampConfig(Config &c) {
  c.distMin      = constrain(c.distMin, 20.0f, 150.0f);
  c.proxDelayS   = constrain(c.proxDelayS, 0, 120);
  c.imbalancePct = constrain(c.imbalancePct, 5, 95);
  c.luxCal       = constrain(c.luxCal, 0.1f, 10.0f);
  c.lightDelayS  = constrain(c.lightDelayS, 0, 120);
  c.pauseMin     = constrain(c.pauseMin, 1, 240);
  c.sendPeriodS  = constrain(c.sendPeriodS, 1, 10);
  c.telegramOn   = c.telegramOn ? 1 : 0;
}

void loadConfig() {
  prefs.begin("cfg", true);
  cfg.distMin      = prefs.getFloat("distMin", cfg.distMin);
  cfg.proxDelayS   = prefs.getInt("proxDelayS", cfg.proxDelayS);
  cfg.imbalancePct = prefs.getInt("imbalancePct", cfg.imbalancePct);
  cfg.luxCal       = prefs.getFloat("luxCal", cfg.luxCal);
  cfg.lightDelayS  = prefs.getInt("lightDelayS", cfg.lightDelayS);
  cfg.pauseMin     = prefs.getInt("pauseMin", cfg.pauseMin);
  cfg.sendPeriodS  = prefs.getInt("sendPeriodS", cfg.sendPeriodS);
  cfg.telegramOn   = prefs.getInt("telegramOn", cfg.telegramOn);
  prefs.end();
  clampConfig(cfg);
}

void saveConfig() {
  prefs.begin("cfg", false);
  prefs.putFloat("distMin", cfg.distMin);
  prefs.putInt("proxDelayS", cfg.proxDelayS);
  prefs.putInt("imbalancePct", cfg.imbalancePct);
  prefs.putFloat("luxCal", cfg.luxCal);
  prefs.putInt("lightDelayS", cfg.lightDelayS);
  prefs.putInt("pauseMin", cfg.pauseMin);
  prefs.putInt("sendPeriodS", cfg.sendPeriodS);
  prefs.putInt("telegramOn", cfg.telegramOn);
  prefs.end();
}

String configJson() {
  char buf[240];
  snprintf(buf, sizeof(buf),
    "{\"distMin\":%.0f,\"proxDelayS\":%d,\"imbalancePct\":%d,\"luxCal\":%.2f,"
    "\"lightDelayS\":%d,\"pauseMin\":%d,\"sendPeriodS\":%d,\"telegramOn\":%s}",
    cfg.distMin, cfg.proxDelayS, cfg.imbalancePct, cfg.luxCal,
    cfg.lightDelayS, cfg.pauseMin, cfg.sendPeriodS, cfg.telegramOn ? "true" : "false");
  return String(buf);
}

// Lecture d'un nombre ou booléen dans un objet JSON plat ({"cle":12.5,"b":true})
bool jsonNumber(const String &body, const char *key, float &out) {
  String k = String("\"") + key + "\":";
  int i = body.indexOf(k);
  if (i < 0) return false;
  String rest = body.substring(i + k.length());
  if (rest.startsWith("true"))       out = 1;
  else if (rest.startsWith("false")) out = 0;
  else                               out = rest.toFloat();
  return true;
}

// ---------------------------------------------------------------------------
// Firebase REST
// ---------------------------------------------------------------------------
bool firebaseRequest(const char *method, const String &path, const String &body, String *response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.setTimeout(4000);
  String url = String(DB_URL_VALUE) + "/devices/" + DEVICE_ID_VALUE + path + ".json";
  if (!http.begin(tls, url)) return false;
  http.addHeader("Content-Type", "application/json");
  int code = http.sendRequest(method, body);
  if (code == 200 && response) *response = http.getString();
  http.end();
  if (code != 200) Serial.printf("[HTTP] %s %s -> %d\n", method, path.c_str(), code);
  return code == 200;
}

void fetchConfig() {
  String body;
  if (!firebaseRequest("GET", "/config", "", &body)) return;
  body.trim();
  if (body == "null") {
    // Première connexion : publier la config locale pour que l'app l'affiche
    firebaseRequest("PUT", "/config", configJson(), nullptr);
    return;
  }
  Config c = cfg;
  float v;
  if (jsonNumber(body, "distMin", v))      c.distMin = v;
  if (jsonNumber(body, "proxDelayS", v))   c.proxDelayS = (int)v;
  if (jsonNumber(body, "imbalancePct", v)) c.imbalancePct = (int)v;
  if (jsonNumber(body, "luxCal", v))       c.luxCal = v;
  if (jsonNumber(body, "lightDelayS", v))  c.lightDelayS = (int)v;
  if (jsonNumber(body, "pauseMin", v))     c.pauseMin = (int)v;
  if (jsonNumber(body, "sendPeriodS", v))  c.sendPeriodS = (int)v;
  if (jsonNumber(body, "telegramOn", v))   c.telegramOn = (int)v;
  clampConfig(c);
  if (memcmp(&c, &cfg, sizeof(Config)) != 0) {
    cfg = c;
    saveConfig();
    Serial.println("[CONFIG] Nouvelle configuration : " + configJson());
  }
}

// ---------------------------------------------------------------------------
// Telegram
//  - Vérification du numéro : l'app écrit devices/<id>/telegram {phoneHash, code,
//    status:"pending"} ; l'utilisateur envoie /start <code> au bot puis partage son
//    contact ; l'ESP32 compare l'empreinte SHA-256 et enregistre le chatId.
//  - Alertes : message au début de chaque alerte (anti-spam par cooldown).
// ---------------------------------------------------------------------------
const unsigned long TG_POLL_PENDING_MS = 5000;  // vérification en cours : réponse rapide
const unsigned long TG_POLL_IDLE_MS    = 60000; // sinon : vider la file de messages

long long tgChatId = 0;       // destinataire vérifié des alertes (0 = aucun)
String tgStatus = "";         // "", "pending", "verified", "failed"
String tgCode = "", tgPhoneHash = "";
long long tgPendingChat = 0;  // chat qui a envoyé le bon /start
long tgOffset = 0;
unsigned long lastTgPollMs = 0;

bool telegramEnabled() {
  return strlen(TELEGRAM_TOKEN_VALUE) > 0 && WiFi.status() == WL_CONNECTED;
}

int telegramApi(const char *method, const String &body, String *response) {
  HTTPClient http;
  http.setTimeout(5000);
  if (!http.begin(tls, String("https://api.telegram.org/bot") + TELEGRAM_TOKEN_VALUE + "/" + method)) return -1;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  if (code == 200 && response) *response = http.getString();
  http.end();
  if (code != 200) Serial.printf("[TELEGRAM] %s -> %d\n", method, code);
  return code;
}

// extra : champs JSON supplémentaires, ex. ",\"reply_markup\":{...}"
bool sendTelegramTo(long long chatId, const String &text, const char *extra = "") {
  if (!telegramEnabled() || chatId == 0) return false;
  char head[48];
  snprintf(head, sizeof(head), "{\"chat_id\":%lld,\"text\":\"", chatId);
  return telegramApi("sendMessage", String(head) + text + "\"" + extra + "}", nullptr) == 200;
}

String sha256Hex(const String &s) {
  uint8_t out[32];
  mbedtls_sha256((const unsigned char *)s.c_str(), s.length(), out, 0);
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + 2 * i, "%02x", out[i]);
  return String(hex);
}

// 9 derniers chiffres : "+33 6 12 34 56 78" et "0612345678" donnent "612345678"
String normalizePhone(const String &phone) {
  String digits;
  for (char c : phone) if (isDigit(c)) digits += c;
  return digits.length() > 9 ? digits.substring(digits.length() - 9) : digits;
}

void saveChatId() {
  char buf[24];
  snprintf(buf, sizeof(buf), "%lld", tgChatId);
  prefs.begin("cfg", false);
  prefs.putString("tgChat", buf);
  prefs.end();
}

void loadChatId() {
  prefs.begin("cfg", true);
  tgChatId = atoll(prefs.getString("tgChat", "0").c_str());
  prefs.end();
}

// Lit devices/<id>/telegram (état de la liaison écrit par l'app)
void fetchTelegramLink() {
  String body;
  if (!firebaseRequest("GET", "/telegram", "", &body)) return;
  JsonDocument doc;
  if (deserializeJson(doc, body)) return;
  long long previous = tgChatId;
  if (doc.isNull()) {
    tgStatus = ""; tgCode = ""; tgPhoneHash = ""; tgChatId = 0; // liaison retirée dans l'app
  } else {
    tgStatus    = doc["status"] | "";
    tgCode      = doc["code"] | "";
    tgPhoneHash = doc["phoneHash"] | "";
    tgChatId    = tgStatus == "verified" ? doc["chatId"].as<long long>() : tgChatId;
  }
  if (tgChatId != previous) saveChatId();
}

void handleStart(long long chat, String code) {
  code.trim();
  if (tgStatus == "pending" && code.length() > 0 && code == tgCode) {
    tgPendingChat = chat;
    sendTelegramTo(chat, "Bonjour ! Pour vérifier votre numéro, appuyez sur le bouton ci-dessous.",
      ",\"reply_markup\":{\"keyboard\":[[{\"text\":\"📱 Partager mon numéro\",\"request_contact\":true}]],"
      "\"one_time_keyboard\":true,\"resize_keyboard\":true}");
  } else {
    sendTelegramTo(chat, "Code invalide ou expiré. Lancez la vérification depuis l'app DeskGuard (Réglages).");
  }
}

void handleContact(long long chat, long long from, long long contactUser, const String &phone) {
  if (tgStatus != "pending" || chat != tgPendingChat) {
    sendTelegramTo(chat, "Lancez d'abord la vérification depuis l'app DeskGuard (Réglages).");
    return;
  }
  // Le contact doit être celui de l'expéditeur, et le numéro celui saisi dans l'app
  bool ok = contactUser == from && sha256Hex(normalizePhone(phone)) == tgPhoneHash;
  char patch[96];
  if (ok) {
    snprintf(patch, sizeof(patch), "{\"status\":\"verified\",\"chatId\":%lld,\"code\":null}", chat);
    if (!firebaseRequest("PATCH", "/telegram", patch, nullptr)) return;
    tgStatus = "verified";
    tgChatId = chat;
    saveChatId();
    sendTelegramTo(chat, "✅ Numéro vérifié. Vous recevrez ici les alertes DeskGuard.",
      ",\"reply_markup\":{\"remove_keyboard\":true}");
  } else {
    firebaseRequest("PATCH", "/telegram", "{\"status\":\"failed\",\"code\":null}", nullptr);
    tgStatus = "failed";
    sendTelegramTo(chat, "❌ Ce numéro ne correspond pas à celui saisi dans l'app. Réessayez depuis l'app.",
      ",\"reply_markup\":{\"remove_keyboard\":true}");
  }
  tgPendingChat = 0;
}

void pollTelegram() {
  char body[64];
  snprintf(body, sizeof(body), "{\"offset\":%ld,\"timeout\":0,\"allowed_updates\":[\"message\"]}", tgOffset);
  String response;
  if (telegramApi("getUpdates", body, &response) != 200) return;

  JsonDocument filter;
  JsonObject f = filter["result"][0].to<JsonObject>();
  f["update_id"] = true;
  f["message"]["chat"]["id"] = true;
  f["message"]["from"]["id"] = true;
  f["message"]["text"] = true;
  f["message"]["contact"]["phone_number"] = true;
  f["message"]["contact"]["user_id"] = true;
  JsonDocument doc;
  if (deserializeJson(doc, response, DeserializationOption::Filter(filter))) return;

  for (JsonObject u : doc["result"].as<JsonArray>()) {
    tgOffset = u["update_id"].as<long>() + 1;
    JsonObject m = u["message"];
    long long chat = m["chat"]["id"].as<long long>();
    long long from = m["from"]["id"].as<long long>();
    const char *text = m["text"] | "";
    if (!m["contact"].isNull()) {
      handleContact(chat, from, m["contact"]["user_id"].as<long long>(), m["contact"]["phone_number"] | "");
    } else if (strncmp(text, "/start", 6) == 0) {
      handleStart(chat, String(text + 6));
    } else {
      sendTelegramTo(chat, "Je suis le bot DeskGuard : j'envoie les alertes de votre poste de travail.");
    }
  }
}

// Publie le nom du bot pour que l'app affiche le lien t.me/<bot>
void publishBotName() {
  if (!telegramEnabled()) return;
  String response;
  if (telegramApi("getMe", "{}", &response) != 200) return;
  JsonDocument doc;
  if (deserializeJson(doc, response)) return;
  String name = doc["result"]["username"] | "";
  if (name.length()) firebaseRequest("PUT", "/telegramBot", "\"" + name + "\"", nullptr);
}

void telegramAlert(TelegramAlert &a, bool active, const String &text, unsigned long now) {
  if (!active) { a.sent = false; return; }
  if (a.sent || !cfg.telegramOn || tgChatId == 0) return;
  if (a.lastSentMs && now - a.lastSentMs < TELEGRAM_COOLDOWN_MS) return;
  if (a.lastTryMs && now - a.lastTryMs < TELEGRAM_RETRY_MS) return;
  a.lastTryMs = now;
  if (sendTelegramTo(tgChatId, text)) { a.sent = true; a.lastSentMs = now; }
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID_VALUE, WIFI_PASS_VALUE);
  Serial.print("Connexion Wi-Fi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\n[OK] Wi-Fi connecte, IP ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[ATTENTION] Wi-Fi indisponible : alertes locales avec la config NVS");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n==============================================");
  Serial.println("  DESKGUARD - INITIALISATION                  ");
  Serial.println("==============================================");

  // Configuration E/S
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_RED, OUTPUT);
  pinMode(PIN_GREEN, OUTPUT);
  pinMode(PIN_BLUE, OUTPUT);

  // Test visuel rapide de la LED RGB (Blanc bref au démarrage)
  setLed(255, 255, 255);
  delay(300);
  setLed(0, 0, 0);

  // 1. Initialisation VEML7700 n°1 (GPIO 21 / 22)
  I2C_1.begin(21, 22);
  if (veml1.begin(&I2C_1)) {
    veml1.setGain(VEML7700_GAIN_1);
    veml1.setIntegrationTime(VEML7700_IT_100MS);
    veml1_ok = true;
    Serial.println("[OK] VEML7700 n°1 initialise (GPIO 21/22)");
  } else {
    Serial.println("[ERREUR] VEML7700 n°1 introuvable (GPIO 21/22) !");
  }

  // 2. Initialisation VEML7700 n°2 (GPIO 32 / 33)
  I2C_2.begin(32, 33);
  if (veml2.begin(&I2C_2)) {
    veml2.setGain(VEML7700_GAIN_1);
    veml2.setIntegrationTime(VEML7700_IT_100MS);
    veml2_ok = true;
    Serial.println("[OK] VEML7700 n°2 initialise (GPIO 32/33)");
  } else {
    Serial.println("[ERREUR] VEML7700 n°2 introuvable (GPIO 32/33) !");
  }

  // 3. Configuration mémorisée (NVS) puis réseau
  loadConfig();
  Serial.println("[CONFIG] NVS : " + configJson());
  tls.setInsecure(); // prototype : pas de vérification du certificat
  loadChatId();
  connectWifi();
  fetchConfig();
  fetchTelegramLink();
  publishBotName();
  lastConfigMs = millis();

  // Calibration rapide capteur PIR
  Serial.print("Stabilisation PIR (5s)... ");
  for (int i = 5; i > 0; i--) {
    Serial.print(i);
    Serial.print(" ");
    delay(1000);
  }
  Serial.println("\n[OK] Tout est pret. Debut de la surveillance !\n");
}

void loop() {
  unsigned long now = millis();

  // 1. Lecture des capteurs
  bool motion = (digitalRead(PIN_PIR) == HIGH);
  float distance = getDistance();
  float lux1 = veml1_ok ? veml1.readLux() : -1.0;
  float lux2 = veml2_ok ? veml2.readLux() : -1.0;

  // 2. Affichage sur la console serie
  Serial.print("Dist: ");
  if (distance > 0 && distance < 400) {
    Serial.print(distance, 1);
    Serial.print(" cm");
  } else {
    Serial.print("---");
  }

  Serial.print(" | PIR: ");
  Serial.print(motion ? "MOUVEMENT" : "repos");

  Serial.print(" | Lux1: ");
  if (lux1 >= 0) {
    Serial.print(lux1, 1);
    Serial.print(" lx");
  } else {
    Serial.print("Err");
  }

  Serial.print(" | Lux2: ");
  if (lux2 >= 0) {
    Serial.print(lux2, 1);
    Serial.print(" lx");
  } else {
    Serial.print("Err");
  }

  // 3. Présence et durée de session (FP3)
  bool present = motion || (distance > 0 && distance < PRESENCE_MAX_CM);
  if (present) {
    if (sessionStartMs == 0) sessionStartMs = now;
    lastSeenMs = now;
  } else if (sessionStartMs != 0 && now - lastSeenMs > ABSENCE_RESET_MS) {
    sessionStartMs = 0; // interruption détectée : la pause remet le compteur à zéro
  }
  bool seated = sessionStartMs != 0; // présence lissée : faux après 2 min d'absence
  unsigned long sitMin = seated ? (now - sessionStartMs) / 60000UL : 0;

  // 4. Proximité prolongée (FP1)
  bool tooClose = distance > 0 && distance < cfg.distMin;
  if (!tooClose) proxSinceMs = 0;
  else if (proxSinceMs == 0) proxSinceMs = now;
  bool alertProx = tooClose && now - proxSinceMs >= (unsigned long)cfg.proxDelayS * 1000UL;

  // 5. Déséquilibre lumineux écran / pièce calibrée (FP2)
  int imbalance = -1;
  if (lux1 >= 0 && lux2 >= 0) {
    float room = lux2 * cfg.luxCal;
    float mx = max(lux1, room);
    imbalance = mx >= LUX_MIN_FOR_RATIO ? (int)round(fabs(lux1 - room) / mx * 100.0) : 0;
  }
  bool unbalanced = imbalance > cfg.imbalancePct;
  if (!unbalanced) lightSinceMs = 0;
  else if (lightSinceMs == 0) lightSinceMs = now;
  bool alertLight = unbalanced && now - lightSinceMs >= (unsigned long)cfg.lightDelayS * 1000UL;

  bool alertBreak = sitMin >= (unsigned long)cfg.pauseMin;

  // 6. Logique LED RGB (FC5) : rouge > orange > vert
  const char *state, *reason;
  if (alertProx) {
    setLed(255, 0, 0);
    state = "red"; reason = "proximity";
    Serial.println("  -> [LED: ROUGE - Trop pres]");
  } else if (alertBreak) {
    setLed(255, 60, 0);
    state = "orange"; reason = "break";
    Serial.println("  -> [LED: ORANGE - Pause]");
  } else if (alertLight) {
    setLed(255, 60, 0);
    state = "orange"; reason = "light";
    Serial.println("  -> [LED: ORANGE - Eclairage]");
  } else {
    setLed(0, 255, 0);
    state = "green"; reason = "ok";
    Serial.println("  -> [LED: VERT - OK]");
  }

  // 7. Envoi Firebase (FP4, FC1, FC2)
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifiTryMs >= WIFI_RETRY_MS) {
      lastWifiTryMs = now;
      WiFi.reconnect();
    }
  } else {
    char json[512];
    snprintf(json, sizeof(json),
      "{\"ts\":{\".sv\":\"timestamp\"},\"device\":\"%s\",\"distance\":%.1f,"
      "\"motion\":%s,\"present\":%s,\"seated\":%s,\"lux1\":%.1f,\"lux2\":%.1f,\"imbalance\":%d,"
      "\"sitMin\":%lu,\"state\":\"%s\",\"reason\":\"%s\","
      "\"alerts\":{\"proximity\":%s,\"light\":%s,\"break\":%s}}",
      DEVICE_ID_VALUE, distance, motion ? "true" : "false", present ? "true" : "false",
      seated ? "true" : "false", lux1, lux2, imbalance, sitMin, state, reason,
      alertProx ? "true" : "false", alertLight ? "true" : "false", alertBreak ? "true" : "false");

    // Changement d'état LED ou début/fin de session -> enregistrement immédiat
    String stateKey = String(state) + (seated ? ":s" : ":a");
    bool changed = lastState != stateKey;
    if (changed || now - lastLiveMs >= (unsigned long)cfg.sendPeriodS * 1000UL) {
      lastLiveMs = now;
      firebaseRequest("PUT", "/live", json, nullptr);
    }
    if (changed || now - lastHistoryMs >= HISTORY_PERIOD_MS) {
      lastHistoryMs = now;
      if (firebaseRequest("POST", "/history", json, nullptr)) lastState = stateKey;
    }
    String who = String("DeskGuard ") + DEVICE_ID_VALUE + " : ";
    telegramAlert(tgProx, alertProx,
      "🔴 " + who + "trop près de l'écran (" + String(distance, 0) + " cm). Reculez un peu.", now);
    telegramAlert(tgBreak, alertBreak,
      "🟠 " + who + "pause recommandée, assis depuis " + String(sitMin) + " min.", now);
    telegramAlert(tgLight, alertLight,
      "🟠 " + who + "éclairage déséquilibré (" + String(imbalance) + " % d'écart).", now);

    if (now - lastConfigMs >= CONFIG_PERIOD_MS) {
      lastConfigMs = now;
      fetchConfig();
      fetchTelegramLink();
    }
    unsigned long pollPeriod = tgStatus == "pending" ? TG_POLL_PENDING_MS : TG_POLL_IDLE_MS;
    if (telegramEnabled() && now - lastTgPollMs >= pollPeriod) {
      lastTgPollMs = now;
      pollTelegram();
    }
  }

  delay(600);
}
