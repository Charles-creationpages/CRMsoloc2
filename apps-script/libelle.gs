// ─── SOLOC' — Libellé auto des mails reçus (dossiers, réponses clients) ───
// Compte hello@solocimmo.fr. Pas de déploiement web : déclencheur temporel (toutes les 15 min).
// Retrouve le client dans le CRM via son email et pose le libellé Emmy / Aya de la personne qui le suit
// (les deux si le client est suivi par les deux). Pose aussi le libellé « Charles » sur les mails
// Papernest, Qonto, factures, récap Papernest du CRM, et ceux où Charles est en copie (REGLES_CHARLES).
//
// Réglage (Paramètres du projet ⚙️ → Propriétés du script) :
//   • SCRIPT_PASSWORD : mot de passe du compte Firebase script@solocimmo.fr
//
// Plus léger qu'avant : seuls les mails arrivés depuis le dernier passage sont relus (avec 1 h de marge),
// et une erreur passagère de Google (« server error ») est simplement réessayée au passage suivant,
// sans mail d'échec.

const FIREBASE_API_KEY = "AIzaSyBSU4Yc5q6e0q5UHxgmn7gq2AwWg7aFl3Q"; // clé publique Firebase (déjà dans le CRM)
const FIREBASE_PROJECT = "soloc-crm";
const SCRIPT_EMAIL     = "script@solocimmo.fr";
const SCRIPT_PASSWORD  = PropertiesService.getScriptProperties().getProperty("SCRIPT_PASSWORD") || "";
const ASSIGNEE_LABEL   = { emmy: "Emmy", aya: "Aya" };
const MAX_THREADS      = 100;

// ── Libellé « Charles » : mails à traiter par Charles (modifiable) ─────────
// Recherche Gmail : chaque ligne est une condition, il suffit qu'une seule soit vraie.
const LABEL_CHARLES = "Charles";
const REGLES_CHARLES = [
  'subject:("AJOUT PAPERNEST")',          // récap « URGENT - AJOUT PAPERNEST » envoyé par le CRM
  'from:papernest',                       // tout ce qui vient de Papernest (pas les mails clients qui en parlent)
  'from:qonto.com',                       // banque Qonto
  'subject:facture', 'subject:factures', 'subject:invoice', // envois / réceptions de factures
  'cc:charlesblyopro@gmail.com', 'cc:charlespurpleimmobilier@gmail.com',
  'bcc:charlesblyopro@gmail.com', 'bcc:charlespurpleimmobilier@gmail.com' // Charles en copie
];

// ── Déclencheur (toutes les 15 min) ──────────────────────────────────────
function libellerReponses() {
  try {
    executer();
  } catch (e) {
    // Erreur passagère (serveur Google, réseau…) : on note et on réessaie au prochain passage
    Logger.log("Passage ignoré, nouvel essai dans 15 min : " + e.message);
  }
}

function executer() {
  var props = PropertiesService.getScriptProperties();
  var depuis = parseInt(props.getProperty("dernierPassage") || "0", 10);
  var maintenant = Math.floor(Date.now() / 1000);
  // 1er passage : 3 derniers jours ; ensuite : depuis le dernier passage, avec 1 h de marge
  var apres = depuis ? depuis - 3600 : maintenant - 3 * 24 * 3600;

  // 1) Libellé Charles (y compris les mails envoyés depuis hello@ vers hello@, comme le récap Papernest)
  var nbCharles = libellerCharles(apres);

  // 2) Libellés Emmy / Aya selon le client
  var threads = GmailApp.search("after:" + apres + " -in:sent -in:drafts -in:spam -in:trash", 0, MAX_THREADS);
  if (!threads.length) { props.setProperty("dernierPassage", String(maintenant)); Logger.log("Aucun nouveau mail client. Libellé Charles : " + nbCharles); return; }

  var map = carteClients();
  var labels = {};
  var lab = function(role) {
    if (!labels[role]) labels[role] = GmailApp.getUserLabelByName(ASSIGNEE_LABEL[role]) || GmailApp.createLabel(ASSIGNEE_LABEL[role]);
    return labels[role];
  };

  var poses = 0;
  threads.forEach(function(t) {
    try {
      var deja = t.getLabels().map(function(l) { return l.getName(); });
      var roles = {};
      t.getMessages().forEach(function(m) {
        (map[extractEmail(m.getFrom())] || []).forEach(function(r) { roles[r] = 1; });
      });
      Object.keys(roles).forEach(function(r) {
        if (deja.indexOf(ASSIGNEE_LABEL[r]) === -1) { t.addLabel(lab(r)); poses++; }
      });
    } catch (e) { Logger.log("Conversation ignorée : " + e.message); }
  });
  props.setProperty("dernierPassage", String(maintenant));
  Logger.log(threads.length + " conversation(s) relue(s), " + poses + " libellé(s) Emmy/Aya posé(s), " + nbCharles + " libellé(s) Charles.");
}

function libellerCharles(apres) {
  var q = "after:" + apres + " -in:drafts -in:spam -in:trash -label:" + LABEL_CHARLES + " {" + REGLES_CHARLES.join(" ") + "}";
  var threads = GmailApp.search(q, 0, MAX_THREADS);
  if (!threads.length) return 0;
  var label = GmailApp.getUserLabelByName(LABEL_CHARLES) || GmailApp.createLabel(LABEL_CHARLES);
  var n = 0;
  threads.forEach(function(t) { try { t.addLabel(label); n++; } catch (e) { Logger.log("Charles : " + e.message); } });
  return n;
}

// Email client (et emails des colocataires / garants) → ["emmy"], ["aya"] ou les deux
function carteClients() {
  var token = getFirebaseToken();
  var map = {};
  var ajoute = function(email, roles) {
    var e = String(email || "").trim().toLowerCase();
    if (!e || !roles.length) return;
    map[e] = (map[e] || []).concat(roles).filter(function(r, i, a) { return a.indexOf(r) === i; });
  };
  getCollection(token, "leads").forEach(function(l) {
    var a = Array.isArray(l.assignedTo) ? l.assignedTo : (l.assignedTo ? [l.assignedTo] : []);
    var roles = a.filter(function(r) { return ASSIGNEE_LABEL[r]; });
    ajoute(l.email, roles);
    [].concat(l.personnes || [], l.garants || []).forEach(function(p) { if (p && p.email) ajoute(p.email, roles); });
  });
  return map;
}

// Test manuel (affiche le résultat dans le journal)
function testLibeller() { executer(); }

// Relit les 3 derniers jours au prochain passage (utile après une panne)
function reprendreTroisJours() { PropertiesService.getScriptProperties().deleteProperty("dernierPassage"); executer(); }

function extractEmail(from) {
  var m = /<([^>]+)>/.exec(from || "");
  return (m ? m[1] : (from || "")).trim().toLowerCase();
}

// ── FIRESTORE ─────────────────────────────────────────────────────────────
function getFirebaseToken() {
  if (!SCRIPT_PASSWORD) throw new Error("Mot de passe manquant : ajoute SCRIPT_PASSWORD dans Paramètres du projet → Propriétés du script");
  var res = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + FIREBASE_API_KEY,
    { method: "post", contentType: "application/json", payload: JSON.stringify({ email: SCRIPT_EMAIL, password: SCRIPT_PASSWORD, returnSecureToken: true }), muteHttpExceptions: true });
  var data = JSON.parse(res.getContentText());
  if (!data.idToken) throw new Error("Firebase auth échouée");
  return data.idToken;
}
function getCollection(token, coll) {
  var out = [], pageToken = "";
  do {
    var url = "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT + "/databases/(default)/documents/" + coll + "?pageSize=300" + (pageToken ? "&pageToken=" + pageToken : "");
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error("Lecture CRM impossible (" + res.getResponseCode() + ")");
    var data = JSON.parse(res.getContentText());
    (data.documents || []).forEach(function(d) { out.push(parseFields(d.fields)); });
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return out;
}
function parseFields(fields) { var o = {}; if (!fields) return o; Object.keys(fields).forEach(function(k) { o[k] = parseVal(fields[k]); }); return o; }
function parseVal(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(parseVal);
  if (v.mapValue !== undefined) return parseFields(v.mapValue.fields);
  return null;
}
