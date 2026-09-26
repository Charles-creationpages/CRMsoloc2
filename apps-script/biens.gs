// ─── SOLOC' — Envoi d'un bien par mail (Newsletter + Lettre de Mission) — via BREVO ─
// À déployer en Application Web sur le compte hello@solocimmo.fr
//   • Exécuter en tant que : Moi (hello@solocimmo.fr)
//   • Qui a accès : Tout le monde
// Réglages (Paramètres du projet → Propriétés du script) :
//   • BREVO_API_KEY   : clé API Brevo (xkeysib-…)
//   • SCRIPT_PASSWORD : mot de passe du compte Firebase script@solocimmo.fr
// Envoi : Brevo d'abord (300/jour), Gmail en secours si Brevo refuse.

// ── CONFIG ────────────────────────────────────────────────────────────────
const EXPEDITEUR       = "hello@solocimmo.fr";
const FIREBASE_API_KEY = "AIzaSyBSU4Yc5q6e0q5UHxgmn7gq2AwWg7aFl3Q"; // clé publique Firebase (déjà dans le CRM)
const FIREBASE_PROJECT = "soloc-crm";
const SCRIPT_EMAIL     = "script@solocimmo.fr";

const SIGNATURES = {
  emmy:   { name:"Emmy MARIET",     role:"Responsable recherche locative", phone:"06 12 89 64 15", photo:"https://charles-creationpages.github.io/CRMsoloc2/emmy.jpg" },
  aya:    { name:"Aya BELKEBIR",    role:"Responsable recherche locative", phone:"07 84 69 80 44", photo:"https://charles-creationpages.github.io/CRMsoloc2/aya-placeholder.png" },
  equipe: { name:"L'équipe SOLOC'", role:"Chasseur locatif Lyon",          phone:"",                photo:"https://charles-creationpages.github.io/CRMsoloc2/icon-192.png" }
};

// ── POINT D'ENTRÉE (appelé par le bouton du CRM) ─────────────────────────
function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    return runSend(p.bienId, p.newsletter===true, p.mission===true, p.sender || "equipe");
  } catch (err) {
    return ContentService.createTextOutput("ERREUR : " + err.message);
  }
}

// Test : envoie un mail de test à hello@ via Brevo (à lancer depuis l'éditeur)
function testBrevo() {
  envoyerBrevo({ to: EXPEDITEUR, subject: "[TEST] Envoi de biens via Brevo", name: "SOLOC'",
    html: "<p>Test OK : le script d'envoi de biens peut envoyer via Brevo.</p>" });
  Logger.log("OK : mail de test envoyé à " + EXPEDITEUR + " via Brevo");
}

// Test : vérifie la connexion à Firebase (mot de passe SCRIPT_PASSWORD)
function testFirebase() {
  var token = getFirebaseToken();
  Logger.log("OK : connexion Firebase réussie, " + getCollection(token, "biens").length + " bien(s) trouvé(s)");
}

function runSend(bienId, doNewsletter, doMission, senderKey) {
  var token = getFirebaseToken();
  var bien  = getDoc(token, "biens/" + bienId);
  if (!bien) return ContentService.createTextOutput("ERREUR : bien introuvable");
  var typo = bien.typologie || "";
  var sign = SIGNATURES[senderKey] || SIGNATURES.equipe;
  var suj = sujet(bien, typo);

  var recipients = [];
  var seen = {};

  if (doNewsletter) {
    getCollection(token, "newsletter").forEach(function(n) {
      if (arrIncludes(n.typologie, typo) && n.email) {
        var key = norm(n.email);
        if (!seen[key]) { seen[key] = 1; recipients.push({ prenom:firstName(n), email:n.email, hono:honoForProfile(n.statutClient, n) }); }
      }
    });
  }
  if (doMission) {
    getCollection(token, "leads").forEach(function(l) {
      if (l.column === "en_recherche" && l.criteria && arrIncludes(l.criteria.typologie, typo) && l.email) {
        var key = norm(l.email);
        if (!seen[key]) { seen[key] = 1; recipients.push({ prenom:firstName(l), email:l.email, hono:honoForProfile(l.criteria.statutClient, l.criteria) }); }
      }
    });
  }

  var sent = 0, viaGmail = 0, premiereErreur = "";
  var etat = { brevoKO: false };
  recipients.forEach(function(r) {
    try {
      var canal = envoyerMail({ to: r.email, subject: suj, html: buildEmail(bien, r.prenom, r.hono, sign), name: "SOLOC'" }, etat);
      sent++;
      if (canal === "gmail") viaGmail++;
      Utilities.sleep(100);
    } catch (err) {
      Logger.log("Echec " + r.email + " : " + err.message);
      if (!premiereErreur) premiereErreur = err.message;
    }
  });
  if (viaGmail) poseLibelle("subject:(" + suj + ")", senderKey); // libellés possibles seulement pour les envois Gmail
  var detail = sent + "/" + recipients.length + " mail(s) envoyé(s)" + (viaGmail ? " (dont " + viaGmail + " via Gmail)" : "");
  if (recipients.length && sent === 0) return ContentService.createTextOutput("ERREUR : aucun mail envoyé — " + premiereErreur);
  if (sent < recipients.length) return ContentService.createTextOutput("PARTIEL - " + detail + " — " + premiereErreur);
  return ContentService.createTextOutput("OK - " + detail);
}

// ── ENVOI : Brevo d'abord, Gmail en secours ─────────────────────────────
// etat.brevoKO : dès que Brevo refuse une fois, les mails suivants partent directement par Gmail.
function envoyerMail(o, etat) {
  etat = etat || {};
  var errBrevo = null;
  if (!etat.brevoKO) {
    try { envoyerBrevo(o); return "brevo"; }
    catch (e) { errBrevo = e; etat.brevoKO = true; Logger.log("Brevo KO, secours Gmail : " + e.message); }
  }
  try {
    GmailApp.sendEmail(o.to, o.subject, o.text || "", { htmlBody: o.html, name: o.name || "SOLOC'", replyTo: EXPEDITEUR });
    return "gmail";
  } catch (errGmail) {
    throw new Error((errBrevo ? "Brevo : " + errBrevo.message + " | " : "Brevo indisponible | ") + "Gmail : " + errGmail.message);
  }
}

function envoyerBrevo(o) {
  var key = PropertiesService.getScriptProperties().getProperty("BREVO_API_KEY");
  if (!key) throw new Error("Clé Brevo manquante (Paramètres du projet → Propriétés du script → BREVO_API_KEY)");
  var payload = {
    sender:  { name: o.name || "SOLOC'", email: EXPEDITEUR },
    to:      [{ email: o.to }],
    replyTo: { email: EXPEDITEUR },
    subject: o.subject,
    htmlContent: o.html
  };
  if (o.text) payload.textContent = o.text;
  var r = UrlFetchApp.fetch("https://api.brevo.com/v3/smtp/email", {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { "api-key": key, "accept": "application/json" },
    payload: JSON.stringify(payload)
  });
  var code = r.getResponseCode();
  if (code >= 300) {
    var msg = r.getContentText();
    try { msg = JSON.parse(msg).message || msg; } catch (e) {}
    throw new Error("Brevo " + code + " : " + msg);
  }
}

// ── BARÈME (identique au CRM) ────────────────────────────────────────────
function honoForProfile(statut, o) {
  o = o || {};
  if (statut === "Étudiant") return 890;
  if (statut === "CDI") return o.periodeEssaiValidee === true ? 990 : 1090;
  if (statut === "CDD") return 1090;
  if (statut === "Indépendant") return 1190;
  if (statut === "Colocation") return 590 * (parseInt(o.nbColoc, 10) || 2);
  return 890;
}

// ── CONSTRUCTION DU MAIL (HTML inline, compatible Gmail) ─────────────────
function sujet(bien, typo) {
  var loc = bien.secteur || bien.rue || "Lyon";
  return "Un bien pour vous — " + (typo || "") + " · " + loc;
}

function buildEmail(bien, prenom, honoSoloc, sign) {
  var A="#C1614F", D="#2C3E50", CR="#FBF7F0", BD="#E5D9C6", G="#9AA7B2", T2="#5A6B7B";
  var loyerCC = bien.loyerCC || bien.loyer || "";
  var surface = bien.surface || "";
  var etage   = bien.etage || "—";
  var meuble  = bien.meuble ? "Oui" : "Non";
  var rue     = bien.rue || "";
  var loc     = bien.secteur || "";
  var badge   = bien.dispoAsap ? "Disponible dès maintenant" : (bien.dateDisponibilite ? "Disponible" : "Bien disponible");
  var agence  = Math.round((parseFloat(bien.surface) || 0) * 13.2);
  var depotHC = parseFloat(bien.loyerHC || bien.loyer) || 0;
  var depot   = Math.round(depotHC * (bien.meuble ? 2 : 1));
  var photos  = bien.photos || [];

  // Photos : hero + jusqu'à 4 vignettes
  var photoHtml = "";
  if (photos[0]) {
    photoHtml += '<tr><td><img src="' + photos[0] + '" width="600" style="width:100%;max-height:300px;object-fit:cover;display:block;" alt=""/></td></tr>';
    var thumbs = photos.slice(1, 5);
    if (thumbs.length) {
      var tw = Math.floor(600 / thumbs.length);
      var row = "";
      thumbs.forEach(function(u) { row += '<td width="' + tw + '"><img src="' + u + '" width="' + tw + '" style="width:100%;height:80px;object-fit:cover;display:block;" alt=""/></td>'; });
      photoHtml += '<tr><td style="padding:0;"><table width="100%" cellpadding="0" cellspacing="2" border="0"><tr>' + row + '</tr></table></td></tr>';
    }
  }

  var atoutsHtml = "";
  (bien.atouts || []).forEach(function(a) {
    atoutsHtml += '<span style="display:inline-block;background:#F2E8DA;color:' + T2 + ';border:1px solid ' + BD + ';border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;margin:0 4px 4px 0;">' + a + '</span>';
  });

  var stat = function(label, val, first) {
    return '<td align="center" style="padding:10px 6px;border-right:1px solid ' + BD + ';' + (first ? 'background:' + CR + ';' : '') + '">'
      + '<div style="font-size:9px;color:' + G + ';text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px;">' + label + '</div>'
      + '<div style="font-size:15px;font-weight:800;color:' + (first ? A : D) + ';">' + val + '</div></td>';
  };

  var honoBox = function(label, val, accent) {
    return '<td align="center" style="background:#fff;border:1px solid ' + BD + ';border-radius:8px;padding:8px;">'
      + '<div style="font-size:8px;color:' + G + ';margin-bottom:2px;">' + label + '</div>'
      + '<div style="font-size:14px;font-weight:800;color:' + (accent ? A : D) + ';">' + val + ' €</div></td>';
  };

  var html = ''
  + '<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:' + D + ';">'
  // Accroche
  + '<div style="font-size:15px;line-height:1.7;padding:6px 4px 18px;">'
  +   'Bonjour <b>' + escapeHtml(prenom || "") + '</b>,<br><br>'
  +   'Un bien correspondant à votre recherche vient de se libérer — on a pensé à vous. Voici sa fiche complète juste en dessous.<br><br>'
  +   'S\'il vous intéresse, <b>appelez-moi directement, il va partir vite&nbsp;!</b>'
  + '</div>'
  // Fiche
  + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ' + BD + ';border-radius:12px;overflow:hidden;">'
  +   '<tr><td style="background:' + D + ';padding:13px 18px;">'
  +     '<table width="100%"><tr>'
  +       '<td><span style="display:inline-block;width:30px;height:30px;background:' + A + ';border-radius:7px;color:#fff;font-weight:800;font-size:15px;text-align:center;line-height:30px;vertical-align:middle;">S</span> <span style="color:#fff;font-size:15px;font-weight:800;vertical-align:middle;">soloc\'</span></td>'
  +       '<td align="right"><span style="background:rgba(255,255,255,.15);color:#fff;border-radius:20px;padding:4px 11px;font-size:10px;font-weight:700;">' + badge + '</span></td>'
  +     '</tr></table>'
  +   '</td></tr>'
  +   photoHtml
  +   '<tr><td style="padding:16px 18px;">'
  +     '<table width="100%"><tr>'
  +       '<td valign="top"><div style="font-size:20px;font-weight:800;color:' + D + ';">' + escapeHtml(rue || loc || "Bien") + '</div>'
  +         (loc ? '<div style="font-size:12px;color:' + G + ';font-weight:600;margin-top:3px;">' + escapeHtml(loc) + '</div>' : '') + '</td>'
  +       '<td valign="top" align="right"><div style="font-size:24px;font-weight:800;color:' + A + ';white-space:nowrap;">' + loyerCC + ' €</div>'
  +         '<div style="font-size:10px;color:' + G + ';font-weight:600;">charges comprises / mois</div></td>'
  +     '</tr></table>'
  +     '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ' + BD + ';border-radius:10px;overflow:hidden;margin-top:14px;"><tr>'
  +       stat("Typologie", typo(bien) , true) + stat("Surface", surface ? surface + " m²" : "—") + stat("Meublé", meuble) + stat("Étage", etage)
  +     '</tr></table>'
  +     (atoutsHtml ? '<div style="font-size:9px;font-weight:800;color:' + A + ';text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px;">Atouts</div><div>' + atoutsHtml + '</div>' : '')
  +     (bien.description ? '<div style="font-size:9px;font-weight:800;color:' + A + ';text-transform:uppercase;letter-spacing:.5px;margin:14px 0 5px;">Description</div><div style="font-size:13px;color:' + T2 + ';line-height:1.6;">' + escapeHtml(bien.description) + '</div>' : '')
  +     '<div style="background:' + CR + ';border:1px solid ' + BD + ';border-radius:10px;padding:12px;margin-top:14px;">'
  +       '<div style="font-size:9px;font-weight:800;color:' + A + ';text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Honoraires &amp; dépôt</div>'
  +       '<table width="100%" cellpadding="0" cellspacing="4" border="0"><tr>'
  +         honoBox("Honoraires SOLOC'", honoSoloc, true) + honoBox("Frais agence", agence) + honoBox("Dépôt", depot)
  +       '</tr></table>'
  +       '<div style="font-size:10px;color:' + G + ';text-align:center;margin-top:8px;">Paiement au résultat — zéro frais avant signature du bail</div>'
  +     '</div>'
  +   '</td></tr>'
  + '</table>'
  // CTA appel (visible) — numéro de l'envoyeur
  + (sign.phone ? ('<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr>'
  +   '<td align="center" style="background:' + A + ';border-radius:12px;padding:16px 18px;">'
  +     '<div style="font-size:15px;font-weight:800;color:#fff;">Ce bien vous intéresse ?</div>'
  +     '<div style="font-size:13px;color:#fff;opacity:.92;margin-top:2px;">Il va partir vite — appelez-moi directement :</div>'
  +     '<div style="font-size:24px;font-weight:800;color:#fff;margin-top:6px;letter-spacing:.5px;"><a href="tel:' + sign.phone.replace(/\s/g,"") + '" style="color:#fff;text-decoration:none;">' + sign.phone + '</a></div>'
  +   '</td>'
  + '</tr></table>') : '')
  // Signature
  + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;border-top:1px solid ' + BD + ';padding-top:16px;"><tr>'
  +   '<td width="70" valign="middle"><img src="' + sign.photo + '" width="60" height="60" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid ' + A + ';" alt=""/></td>'
  +   '<td valign="middle" style="padding-left:14px;">'
  +     '<div style="font-size:15px;font-weight:800;color:' + D + ';">' + sign.name + '</div>'
  +     '<div style="font-size:12px;color:' + A + ';font-weight:700;margin-bottom:5px;">' + sign.role + ' · SOLOC\'</div>'
  +     '<div style="font-size:11px;color:' + T2 + ';line-height:1.6;">'
  +       (sign.phone ? 'Tél. ' + sign.phone + ' &nbsp;·&nbsp; ' : '') + 'hello@solocimmo.fr<br>solocimmo.fr</div>'
  +   '</td>'
  + '</tr></table>'
  + '</div>';
  return html;
}

// petit helper : typologie du bien (fonction pour éviter collision de nom)
function typo(bien){ return bien.typologie || "—"; }

// ── FIRESTORE ─────────────────────────────────────────────────────────────
function getFirebaseToken() {
  var pwd = PropertiesService.getScriptProperties().getProperty("SCRIPT_PASSWORD");
  if (!pwd) throw new Error("Mot de passe manquant (Paramètres du projet → Propriétés du script → SCRIPT_PASSWORD)");
  var res = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + FIREBASE_API_KEY,
    { method:"post", contentType:"application/json", payload:JSON.stringify({ email:SCRIPT_EMAIL, password:pwd, returnSecureToken:true }), muteHttpExceptions:true });
  var data = JSON.parse(res.getContentText());
  if (!data.idToken) throw new Error("Firebase auth échoué");
  return data.idToken;
}

function getDoc(token, path) {
  var res = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT + "/databases/(default)/documents/" + path,
    { headers:{ Authorization:"Bearer " + token }, muteHttpExceptions:true });
  if (res.getResponseCode() !== 200) return null;
  return parseFields(JSON.parse(res.getContentText()).fields);
}

function getCollection(token, coll) {
  var out = [], pageToken = "";
  do {
    var url = "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT + "/databases/(default)/documents/" + coll + "?pageSize=300" + (pageToken ? "&pageToken=" + pageToken : "");
    var res = UrlFetchApp.fetch(url, { headers:{ Authorization:"Bearer " + token }, muteHttpExceptions:true });
    var data = JSON.parse(res.getContentText());
    (data.documents || []).forEach(function(d) { out.push(parseFields(d.fields)); });
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return out;
}

// Convertit les champs Firestore REST en objet JS simple
function parseFields(fields) {
  var o = {};
  if (!fields) return o;
  Object.keys(fields).forEach(function(k) { o[k] = parseVal(fields[k]); });
  return o;
}
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

// ── HELPERS ───────────────────────────────────────────────────────────────
function arrIncludes(arr, val) {
  if (!val) return false;
  if (Array.isArray(arr)) return arr.indexOf(val) !== -1;
  return arr === val;
}
function norm(s) { return String(s || "").trim().toLowerCase(); }
function firstName(o) {
  if (o.firstName) return o.firstName;
  if (o.name) return String(o.name).trim().split(/\s+/)[0];
  return "";
}
function escapeHtml(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// Pose un libellé Gmail "Emmy" ou "Aya" sur les mails partis en secours par Gmail (dans hello@).
// Les mails partis par Brevo n'apparaissent pas dans « Envoyés » : pas de libellé possible.
function poseLibelle(query, sender) {
  try {
    var nom = sender === "emmy" ? "Emmy" : (sender === "aya" ? "Aya" : "");
    if (!nom) return;
    var label = GmailApp.getUserLabelByName(nom) || GmailApp.createLabel(nom);
    Utilities.sleep(1500);
    var threads = GmailApp.search("in:sent newer_than:1d " + query, 0, 30);
    for (var i = 0; i < threads.length; i++) { threads[i].addLabel(label); }
  } catch (e) { Logger.log("Libelle: " + e.message); }
}
