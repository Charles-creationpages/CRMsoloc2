// ─── SOLOC' — Contacts Leboncoin transférés par Purple → CRM (Premier contact) ───
// Compte hello@solocimmo.fr. À coller comme NOUVEAU FICHIER dans le même projet Apps Script que libelle.gs :
// il réutilise sa connexion au CRM (getFirebaseToken, getCollection, mot de passe SCRIPT_PASSWORD des propriétés).
//
// Toutes les 15 min : lit les mails « Nouveau message pour … sur leboncoin » transférés par Purple Immobilier
// (Rodolphe Sabatini), récupère nom / e-mail / téléphone / ville / message, et crée le client dans le CRM
// en Premier contact, source « Leboncoin », attribué à Aya ET Emmy.
// Chaque conversation traitée reçoit le libellé Gmail « CRM Leboncoin » (elle n'est plus relue ensuite).
// Un contact déjà présent dans le CRM (même e-mail ou même téléphone) n'est pas recréé.
//
// Mise en route (une seule fois) : choisir installerLeboncoin dans la liste des fonctions → Exécuter.

var LBC_RECHERCHE = 'from:(purpleimmobilier.fr OR sabatini) subject:leboncoin -label:"CRM Leboncoin"';
var LBC_LABEL = "CRM Leboncoin";
var LBC_LABEL_VERIF = "CRM Leboncoin à vérifier";
var LBC_MAX = 50;

function installerLeboncoin() {
  ScriptApp.getProjectTriggers().forEach(function(t) { if (t.getHandlerFunction() === "importerLeboncoin") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("importerLeboncoin").timeBased().everyMinutes(15).create();
  importerLeboncoin();
}

// ── Déclencheur (toutes les 15 min) ──────────────────────────────────────
function importerLeboncoin() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try { executerLeboncoin(); }
  catch (e) { Logger.log("Leboncoin : passage ignoré, nouvel essai dans 15 min : " + e.message); }
  finally { lock.releaseLock(); }
}

function executerLeboncoin() {
  var threads = GmailApp.search(LBC_RECHERCHE, 0, LBC_MAX);
  if (!threads.length) { Logger.log("Leboncoin : aucun nouveau mail."); return; }
  var token = getFirebaseToken();
  var leads = getCollection(token, "leads");
  var mails = {}, tels = {};
  leads.forEach(function(l) {
    var m = String(l.email || "").trim().toLowerCase(); if (m) mails[m] = 1;
    var t = lbcCleTel(l.phone); if (t) tels[t] = 1;
  });
  var label = GmailApp.getUserLabelByName(LBC_LABEL) || GmailApp.createLabel(LBC_LABEL);
  var labelVerif = GmailApp.getUserLabelByName(LBC_LABEL_VERIF) || GmailApp.createLabel(LBC_LABEL_VERIF);
  var crees = 0, deja = 0, illisibles = 0;

  threads.forEach(function(t) {
    var ok = true;
    t.getMessages().forEach(function(msg) {
      if (!/leboncoin/i.test(msg.getSubject())) return;
      var c = lbcLire(msg);
      if (!c.email && !c.tel) { illisibles++; ok = false; return; }
      var cm = (c.email || "").toLowerCase(), ct = lbcCleTel(c.tel);
      if ((cm && mails[cm]) || (ct && tels[ct])) { deja++; return; }
      lbcCreer(token, msg, c);
      if (cm) mails[cm] = 1; if (ct) tels[ct] = 1;
      crees++;
    });
    t.addLabel(ok ? label : labelVerif);
  });
  Logger.log("Leboncoin : " + crees + " client(s) créé(s), " + deja + " déjà dans le CRM, " + illisibles + " mail(s) illisible(s) (libellé « " + LBC_LABEL_VERIF + " »).");
}

// ── Lecture d'un mail transféré ──────────────────────────────────────────
function lbcLire(msg) {
  var brut = msg.getPlainBody() || "";
  var txt = brut.replace(/^\s*>+ ?/gm, "").replace(/\*/g, "").replace(/\|/g, " ").replace(/\s+/g, " ");
  var pick = function(re) { var m = re.exec(txt); return m ? m[1].trim() : ""; };
  var nom = pick(/Nom\s*:\s*(.+?)\s+E-?mail\s*:/i);
  var email = pick(/E-?mail\s*:\s*([^\s<>()\[\]]+@[^\s<>()\[\]]+\.[a-z]{2,})/i).toLowerCase();
  var tel = pick(/T[ée]l[ée]phone\s*:\s*(\+?[\d][\d .]{7,}\d)/i);
  var ville = pick(/Ville\s*:\s*(.+?)\s*(?:«|Voir le profil|$)/i);
  var message = pick(/«\s*([\s\S]+?)\s*»/);
  var annonce = pick(/Nouveau message pour "(.+?)"/i) || pick(/Nouveau message pour “(.+?)”/i);
  var prix = pick(/m²"?\s*\)?\s*(\d[\d\s]*)\s*€/i);
  var lien = pick(/Lien\s*:\s*(https?:\/\/www\.leboncoin\.fr\/ad\/\S+)/i);
  var relais = pick(/([a-z0-9]+@messagerie\.leboncoin\.fr)/i);
  if (!nom) nom = pick(/De:\s*"?(.+?)\s+via leboncoin/i);
  return { nom: nom, email: email, tel: lbcFormatTel(tel), ville: ville, message: message, annonce: annonce, prix: prix, lien: lien, relais: relais };
}

function lbcCreer(token, msg, c) {
  var parts = c.nom.split(/\s+/).filter(Boolean);
  var prenom = parts.length ? parts[0] : "";
  var nom = parts.slice(1).join(" ");
  var quand = msg.getDate().toISOString();
  var m = (c.message || "").toLowerCase();
  var statut = /[ée]tudiant/.test(m) ? "Étudiant" : /\bcdi\b/.test(m) ? "CDI" : /\bcdd\b/.test(m) ? "CDD"
    : /(ind[ée]pendant|auto-?entrepreneur|freelance)/.test(m) ? "Indépendant" : "";
  var notes = "Contact Leboncoin transféré par Purple" + (c.annonce ? " — annonce « " + c.annonce + " »" + (c.prix ? " (" + c.prix + " €)" : "") : "") + "."
    + (c.message ? "\nMessage : « " + c.message + " »" : "")
    + (c.ville ? "\nVille : " + c.ville : "")
    + (c.lien ? "\nAnnonce : " + c.lien : "")
    + (c.relais ? "\nRépondre via la messagerie Leboncoin : " + c.relais : "");
  var lead = {
    firstName: prenom, lastName: nom, name: c.nom || c.email || c.tel,
    phone: c.tel || "", email: c.email || "",
    column: "premier_contact", relanceCount: 0, paid: false,
    assignedTo: ["aya", "emmy"], assignTouched: true,
    source: "leboncoin", notes: notes,
    criteria: { statutClient: statut, periodeEssaiValidee: null, typologie: [], surface: "", loyer: "", secteur: c.ville || "",
                prestationsSupp: "", dateEntreeSouhaitee: "", dateAsap: false, etatLogement: [], etatBien: [] },
    leboncoin: { annonce: c.annonce || "", prix: c.prix || "", lien: c.lien || "", relais: c.relais || "", mailId: msg.getId() },
    createdAt: quand, lastActivity: quand,
    history: [{ id: "lbc-" + msg.getId(), at: quand, text: "🧡 Lead créé depuis un contact Leboncoin transféré par Purple" }]
  };
  var url = "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT + "/databases/(default)/documents/leads?documentId=lbc_" + msg.getId();
  var res = UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({ fields: lbcChamps(lead) }), muteHttpExceptions: true });
  var code = res.getResponseCode();
  if (code !== 200 && code !== 409) throw new Error("Création CRM impossible (" + code + ") : " + res.getContentText().slice(0, 200));
}

// ── Outils ───────────────────────────────────────────────────────────────
function lbcCleTel(t) { var d = String(t || "").replace(/\D/g, ""); return d.length >= 9 ? d.slice(-9) : ""; }
function lbcFormatTel(t) {
  var d = String(t || "").replace(/\D/g, "");
  if (d.indexOf("33") === 0 && d.length === 11) d = "0" + d.slice(2);
  return d.length === 10 ? d.replace(/(\d{2})(?=\d)/g, "$1 ").trim() : String(t || "").trim();
}
function lbcChamps(o) { var f = {}; Object.keys(o).forEach(function(k) { f[k] = lbcVal(o[k]); }); return f; }
function lbcVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(lbcVal) } };
  if (typeof v === "object") return { mapValue: { fields: lbcChamps(v) } };
  return { stringValue: String(v) };
}

// Test manuel : affiche ce qui serait lu dans les 5 derniers mails, sans rien créer
function testLeboncoin() {
  GmailApp.search('from:(purpleimmobilier.fr OR sabatini) subject:leboncoin', 0, 5).forEach(function(t) {
    var c = lbcLire(t.getMessages()[t.getMessageCount() - 1]);
    Logger.log(JSON.stringify(c));
  });
}
