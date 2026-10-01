// ─── SOLOC' — Sync Calendly → Firestore ────────────────────────────────
// Google Apps Script — compte hello@solocimmo.fr
// Déclencheur : syncCalendly, toutes les 15 minutes (UN SEUL déclencheur suffit)
//
// Réglages (Paramètres du projet ⚙️ → Propriétés du script) :
//   • CALENDLY_TOKEN  : jeton d'accès personnel Calendly
//   • SCRIPT_PASSWORD : mot de passe du compte Firebase script@solocimmo.fr
//
// Anti-doublon (3 sécurités) :
//   1. chaque RDV crée une fiche à identifiant fixe « cal_<id du RDV> » : Firestore refuse une 2e création ;
//   2. si la vérification dans le CRM échoue (erreur réseau…), on n'invente pas « absent » : on réessaie au passage suivant ;
//   3. un RDV déjà traité est mémorisé : une fiche supprimée ou fusionnée dans le CRM n'est pas recréée.

// ── CONFIG ────────────────────────────────────────────────────────────────
const PROPS             = PropertiesService.getScriptProperties();
const CALENDLY_TOKEN    = nettoyerSecret(PROPS.getProperty("CALENDLY_TOKEN"));
const CALENDLY_USER_URI = "https://api.calendly.com/users/3edae6fe-f73e-4bda-a495-4cae7fcf2a28";
const FIREBASE_API_KEY  = "AIzaSyBSU4Yc5q6e0q5UHxgmn7gq2AwWg7aFl3Q"; // clé publique Firebase (déjà dans le CRM)
const FIREBASE_PROJECT  = "soloc-crm";
const SCRIPT_EMAIL      = "script@solocimmo.fr";
const SCRIPT_PASSWORD   = nettoyerSecret(PROPS.getProperty("SCRIPT_PASSWORD"));
const MEMOIRE_JOURS     = 60; // durée de mémorisation des RDV déjà traités

// Valeur collée dans les propriétés : on enlève espaces, retours à la ligne, guillemets et « Bearer » éventuels
function nettoyerSecret(v) {
  return String(v || "").replace(/^\s*Bearer\s+/i, "").replace(/[\s"';]/g, "");
}

// Test : vérifie que le jeton Calendly est accepté
function testCalendly() {
  Logger.log("Jeton : " + CALENDLY_TOKEN.length + " caracteres, commence par " + CALENDLY_TOKEN.slice(0, 6) + "…, finit par …" + CALENDLY_TOKEN.slice(-6));
  var me = calendlyGet("https://api.calendly.com/users/me").resource;
  Logger.log("OK : jeton valide pour " + me.name + " (" + me.uri + ")");
}

// ══════════════════════════════════════════════════════════════════════════
//  SYNC AUTOMATIQUE (déclencheur toutes les 15 min)
// ══════════════════════════════════════════════════════════════════════════
function syncCalendly() {
  // Si deux exécutions se chevauchent, la seconde attend ou s'arrête (jamais deux en même temps)
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log("Une autre synchro est en cours — passage ignore."); return; }
  try {
    const token  = getFirebaseToken();
    const events = getNewCalendlyEvents(CALENDLY_USER_URI);

    if (events.length === 0) {
      Logger.log("Aucun nouveau RDV Calendly.");
      return;
    }

    Logger.log("RDV a venir trouves : " + events.length);
    events.forEach(function(evt) {
      try {
        if (dejaTraite(evt.uri)) return;
        if (leadExists(token, evt.uri)) { marquerTraite(evt.uri); return; }
        const invitee = getInvitee(evt.uri, evt);
        if (!invitee) return;
        const cree = createLead(token, idFiche(evt.uri), buildLead(evt, invitee));
        marquerTraite(evt.uri);
        Logger.log((cree ? "Lead cree : " : "Deja existant : ") + invitee.name + " | tel : " + (invitee.phone || "(vide)"));
      } catch(e) {
        Logger.log("Erreur sur un evenement (reessai au prochain passage) : " + e.message);
      }
    });
    nettoyerMemoire();
  } catch(e) {
    Logger.log("Erreur syncCalendly : " + e.message);
  } finally {
    lock.releaseLock();
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  REPARATION — remplit le numero des fiches deja creees (dernieres 24h)
//  A lancer manuellement quand des fiches sont sans numero.
// ══════════════════════════════════════════════════════════════════════════
function reparerNumeros() {
  var saved = PROPS.getProperty("lastCheck");
  PROPS.deleteProperty("lastCheck");                 // force la relecture des 24 dernieres heures
  var events = getNewCalendlyEvents(CALENDLY_USER_URI);
  if (saved) PROPS.setProperty("lastCheck", saved);  // restaure le marqueur de sync

  if (!events.length) { Logger.log("Aucun evenement sur 24h."); return; }

  var token = getFirebaseToken();
  Logger.log(events.length + " evenement(s) a traiter.");

  events.forEach(function(evt) {
    var invitee = getInvitee(evt.uri, evt);
    if (!invitee) return;
    Logger.log("→ " + invitee.name + " | tel : " + (invitee.phone || "(vide)"));
    if (!invitee.phone) return;

    var doc = chercherFiche(token, evt.uri);
    if (!doc) { Logger.log("   fiche introuvable dans le CRM"); return; }

    var up = UrlFetchApp.fetch(
      "https://firestore.googleapis.com/v1/" + doc.name + "?updateMask.fieldPaths=phone",
      { method: "patch", contentType: "application/json",
        headers: { Authorization: "Bearer " + token },
        payload: JSON.stringify({ fields: { phone: { stringValue: invitee.phone } } }),
        muteHttpExceptions: true });
    Logger.log(up.getResponseCode() === 200 ? "   OK numero ecrit dans le CRM" : "   ERREUR : " + up.getContentText());
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  MÉMOIRE DES RDV DÉJÀ TRAITÉS
// ══════════════════════════════════════════════════════════════════════════
function idFiche(eventUri) { return "cal_" + eventUri.split("/").pop(); }
function cleMemoire(eventUri) { return "vu_" + eventUri.split("/").pop(); }
function dejaTraite(eventUri) { return !!PROPS.getProperty(cleMemoire(eventUri)); }
function marquerTraite(eventUri) { PROPS.setProperty(cleMemoire(eventUri), new Date().toISOString()); }
function nettoyerMemoire() {
  var limite = Date.now() - MEMOIRE_JOURS * 24 * 60 * 60 * 1000;
  var all = PROPS.getProperties();
  Object.keys(all).forEach(function(k) {
    if (k.indexOf("vu_") === 0 && new Date(all[k]).getTime() < limite) PROPS.deleteProperty(k);
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  CALENDLY
// ══════════════════════════════════════════════════════════════════════════

// Liste les RDV actifs à venir (depuis le dernier passage, ou les 24 dernieres heures), toutes pages
function getNewCalendlyEvents(userUri) {
  const lastCheck = PROPS.getProperty("lastCheck") || new Date(Date.now() - 24*60*60*1000).toISOString();
  const now       = new Date().toISOString();

  var url = "https://api.calendly.com/scheduled_events"
    + "?user=" + encodeURIComponent(userUri)
    + "&min_start_time=" + encodeURIComponent(lastCheck)
    + "&status=active"
    + "&sort=start_time:asc"
    + "&count=100";

  var all = [];
  for (var page = 0; url && page < 10; page++) {
    var data = calendlyGet(url);
    all = all.concat(data.collection || []);
    url = data.pagination && data.pagination.next_page;
  }
  PROPS.setProperty("lastCheck", now);
  return all;
}

// Recupere l'invite d'un evenement, avec son numero de telephone
function getInvitee(eventUri, evt) {
  const uuid = eventUri.split("/").pop();
  const data = calendlyGet("https://api.calendly.com/scheduled_events/" + uuid + "/invitees?count=1");
  const inv  = data.collection && data.collection[0];
  if (!inv) return null;

  // Le numero peut venir de 3 endroits selon la config Calendly :
  //  1. une question personnalisee posee a la reservation
  var phone = extractAnswerByField(inv.questions_and_answers,
    ["numero","numéro","telephone","téléphone","phone","tel","tél","mobile","portable"]);

  //  2. le champ SMS integre de Calendly
  if (!phone) phone = inv.text_reminder_number || "";

  //  3. la localisation de l'evenement (type "appel telephonique" / outbound_call)
  if (!phone) {
    var ev = evt;
    if (!ev) {
      try { ev = calendlyGet("https://api.calendly.com/scheduled_events/" + uuid).resource; } catch (e) {}
    }
    if (ev && ev.location) {
      var candidate = String(ev.location.location || ev.location.phone_number || "");
      // On compte les chiffres apres avoir retire espaces et symboles
      if (candidate.replace(/[^0-9]/g, "").length >= 6) phone = candidate;
    }
  }

  return {
    name:    inv.name || "",
    email:   inv.email || "",
    phone:   phone,
    message: extractAnswerByField(inv.questions_and_answers, ["partager","préparat","preparat","message","information","note"]),
    uri:     inv.uri || ""
  };
}

// Extrait une reponse en cherchant un mot-cle dans l'intitule de la question
function extractAnswerByField(qna, keywords) {
  if (!qna || !qna.length) return "";
  for (var i = 0; i < qna.length; i++) {
    var q = (qna[i].question || "").toLowerCase();
    for (var k = 0; k < keywords.length; k++) {
      if (q.indexOf(keywords[k]) !== -1) return qna[i].answer || "";
    }
  }
  return "";
}

// Appel HTTP a l'API Calendly
function calendlyGet(url) {
  if (!CALENDLY_TOKEN) throw new Error("Jeton manquant : ajoute CALENDLY_TOKEN dans Paramètres du projet → Propriétés du script");
  var res = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { Authorization: "Bearer " + CALENDLY_TOKEN, "Content-Type": "application/json" },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error("Calendly API " + res.getResponseCode() + " : " + res.getContentText().slice(0,200));
  return JSON.parse(res.getContentText());
}

// ══════════════════════════════════════════════════════════════════════════
//  FIRESTORE
// ══════════════════════════════════════════════════════════════════════════
function getFirebaseToken() {
  if (!SCRIPT_PASSWORD) throw new Error("Mot de passe manquant : ajoute SCRIPT_PASSWORD dans Paramètres du projet → Propriétés du script");
  const url  = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + FIREBASE_API_KEY;
  const body = JSON.stringify({ email: SCRIPT_EMAIL, password: SCRIPT_PASSWORD, returnSecureToken: true });
  const res  = UrlFetchApp.fetch(url, { method:"post", contentType:"application/json", payload:body, muteHttpExceptions:true });
  const data = JSON.parse(res.getContentText());
  if (!data.idToken) throw new Error("Firebase auth echoue : " + res.getContentText());
  return data.idToken;
}

// Crée la fiche avec un identifiant fixe. Renvoie false si elle existe déjà (Firestore refuse le doublon).
function createLead(token, docId, lead) {
  const url  = "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT + "/databases/(default)/documents/leads?documentId=" + encodeURIComponent(docId);
  const res  = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({ fields: toFirestoreFields(lead) }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 409) return false;
  if (res.getResponseCode() !== 200) throw new Error("Firestore write error : " + res.getContentText());
  return true;
}

// Fiche du CRM liée à un RDV Calendly (null si aucune). Erreur = exception, jamais « absent » par défaut.
function chercherFiche(token, calendlyUri) {
  const url  = "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT + "/databases/(default)/documents:runQuery";
  const body = JSON.stringify({
    structuredQuery: {
      from: [{ collectionId: "leads" }],
      where: { fieldFilter: { field: { fieldPath: "calendlyEventUri" }, op: "EQUAL", value: { stringValue: calendlyUri } } },
      limit: 1
    }
  });
  const res  = UrlFetchApp.fetch(url, {
    method: "post", contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: body, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error("Verification CRM impossible (" + res.getResponseCode() + ")");
  const data = JSON.parse(res.getContentText());
  if (!Array.isArray(data)) throw new Error("Verification CRM : reponse inattendue");
  if (data.some(function(r){ return r.error; })) throw new Error("Verification CRM : " + JSON.stringify(data[0].error).slice(0,150));
  const hit = data.filter(function(r){ return r.document; })[0];
  return hit ? hit.document : null;
}

// Anti-doublon : un meme RDV Calendly ne cree qu'une seule fiche
function leadExists(token, calendlyUri) {
  return !!chercherFiche(token, calendlyUri);
}

// Construit la fiche lead au format attendu par le CRM
function buildLead(evt, invitee) {
  var startTime = new Date(evt.start_time);
  var dateLabel = formatDateLabel(startTime);
  var timeLabel = formatTimeLabel(startTime, new Date(evt.end_time));
  var nameParts = invitee.name.trim().split(/\s+/);
  var now       = new Date().toISOString();

  return {
    firstName:        nameParts[0] || "",
    lastName:         nameParts.slice(1).join(" ") || "",
    name:             invitee.name,
    email:            invitee.email,
    phone:            invitee.phone,
    column:           "premier_contact",
    relanceCount:     0,
    paid:             false,
    notes:            "",
    criteria: {
      statutClient:        "",
      periodeEssaiValidee: null,
      typologie:           [],
      surface:             "",
      loyer:               "",
      secteur:             "",
      prestationsSupp:     "",
      dateEntreeSouhaitee: "",
      dateAsap:            false,
      etatLogement:        []
    },
    createdAt:        now,
    lastActivity:     now,
    source:           "calendly",
    calendlyEventUri: evt.uri,
    calendlyRdv: {
      dateLabel: dateLabel,
      timeLabel: timeLabel,
      eventName: evt.name || "Votre location",
      startTime: evt.start_time,
      message:   invitee.message
    },
    history: [
      { id: "init-" + Date.now(), at: now, text: "Lead cree automatiquement via Calendly — RDV " + dateLabel + " a " + timeLabel }
    ]
  };
}

// Conversion objet JS → format de champs Firestore
function toFirestoreFields(obj) {
  var fields = {};
  Object.keys(obj).forEach(function(k) {
    var v = obj[k];
    if (v === null || v === undefined) {
      fields[k] = { nullValue: null };
    } else if (typeof v === "boolean") {
      fields[k] = { booleanValue: v };
    } else if (typeof v === "number") {
      fields[k] = { integerValue: String(v) };
    } else if (typeof v === "string") {
      fields[k] = { stringValue: v };
    } else if (Array.isArray(v)) {
      fields[k] = { arrayValue: { values: v.map(function(item) {
        return (item && typeof item === "object") ? { mapValue: { fields: toFirestoreFields(item) } } : { stringValue: String(item) };
      })}};
    } else if (typeof v === "object") {
      fields[k] = { mapValue: { fields: toFirestoreFields(v) } };
    }
  });
  return fields;
}

// ══════════════════════════════════════════════════════════════════════════
//  HELPERS DATE
// ══════════════════════════════════════════════════════════════════════════
function formatDateLabel(d) {
  var jours = ["Dim.","Lun.","Mar.","Mer.","Jeu.","Ven.","Sam."];
  var mois  = ["jan.","fev.","mars","avr.","mai","juin","juil.","aout","sept.","oct.","nov.","dec."];
  return jours[d.getDay()] + " " + d.getDate() + " " + mois[d.getMonth()];
}

function formatTimeLabel(start, end) {
  return pad(start.getHours()) + "h" + pad(start.getMinutes())
    + " – " + pad(end.getHours()) + "h" + pad(end.getMinutes());
}

function pad(n) { return n < 10 ? "0" + n : "" + n; }
