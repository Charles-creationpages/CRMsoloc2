// ─── SOLOC' — Mail de démarrage au passage en "Envoyé" (3 liens) — via BREVO ─
// À déployer en Application Web sur hello@solocimmo.fr
//   • Exécuter en tant que : Moi (hello@solocimmo.fr)
//   • Qui a accès : Tout le monde
// La clé Brevo se met dans : Paramètres du projet → Propriétés du script → BREVO_API_KEY
// Relances automatiques (clients en « Envoyé » sans mouvement depuis 3 jours, 3 fois max) :
//   • propriété SCRIPT_PASSWORD = mot de passe du compte Firebase script@solocimmo.fr
//   • lancer UNE fois installerRelances (déclencheur chaque matin vers 10 h)

// ── CONFIG BREVO ──────────────────────────────────────────────────────────
const EXPEDITEUR  = "hello@solocimmo.fr";
// Copie cachée de chaque mail client dans hello@ (pour garder la trace + libellés Emmy/Aya).
// Attention : chaque copie compte pour 1 mail dans le quota Brevo. Mettre false pour désactiver.
const COPIE_HELLO = false;

const SIGNATURES = {
  emmy:   { name:"Emmy MARIET",     role:"Responsable recherche locative", phone:"06 12 89 64 15", photo:"https://charles-creationpages.github.io/CRMsoloc2/emmy.jpg" },
  aya:    { name:"Aya BELKEBIR",    role:"Responsable recherche locative", phone:"07 84 69 80 44", photo:"https://charles-creationpages.github.io/CRMsoloc2/aya-placeholder.png" },
  equipe: { name:"L'équipe SOLOC'", role:"Chasseur locatif Lyon",          phone:"",                photo:"https://charles-creationpages.github.io/CRMsoloc2/icon-192.png" }
};

const SUJET_DEMARRAGE = "Bienvenue chez SOLOC' — vos 3 étapes pour démarrer";

// ── POINT D'ENTRÉE ────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    if (!p.email) return ContentService.createTextOutput("ERREUR : email manquant");
    var sign = SIGNATURES[p.sender] || SIGNATURES.equipe;
    envoyerMail({
      to: p.email,
      subject: SUJET_DEMARRAGE,
      html: buildEmail(p.prenom || "", sign, p.linkForm || "#", p.linkLettre || "#", p.linkDocs || "#"),
      name: "SOLOC'",
      bcc: COPIE_HELLO ? EXPEDITEUR : ""
    });
    rangerCopie(p.email, SUJET_DEMARRAGE, p.sender);
    return ContentService.createTextOutput("OK - mail envoye a " + p.email);
  } catch (err) {
    return ContentService.createTextOutput("ERREUR : " + err.message);
  }
}

// ── ENVOI : Brevo d'abord, Gmail en secours ─────────────────────────────
// Si Brevo refuse (quota de 300/jour dépassé, panne, clé invalide…), le même mail
// part par Gmail (quota Google ~100/jour). Si les deux échouent : erreur avec les deux raisons.
function envoyerMail(o) {
  try {
    envoyerBrevo(o);
  } catch (errBrevo) {
    Logger.log("Brevo KO, secours Gmail : " + errBrevo.message);
    try {
      GmailApp.sendEmail(o.to, o.subject, o.text || "", { htmlBody: o.html, name: o.name || "SOLOC'", replyTo: EXPEDITEUR });
    } catch (errGmail) {
      throw new Error("Brevo : " + errBrevo.message + " | Gmail : " + errGmail.message);
    }
  }
}

// ── ENVOI VIA BREVO ───────────────────────────────────────────────────────
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
  if (o.bcc && o.bcc.toLowerCase() !== String(o.to).toLowerCase()) payload.bcc = [{ email: o.bcc }];
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

// La copie cachée arrive dans la boîte de réception de hello@ : on pose le libellé
// Emmy / Aya et on l'archive (comme un mail « envoyé »). Quand le client répond,
// sa réponse arrive dans ce fil et hérite du libellé.
function rangerCopie(email, sujet, sender) {
  if (!COPIE_HELLO) return;
  try {
    var nom = sender === "emmy" ? "Emmy" : (sender === "aya" ? "Aya" : "");
    var label = nom ? (GmailApp.getUserLabelByName(nom) || GmailApp.createLabel(nom)) : null;
    var q = 'newer_than:1d to:' + email + ' subject:"' + sujet.replace(/"/g, "") + '"';
    for (var i = 0; i < 4; i++) {
      Utilities.sleep(3000);
      var threads = GmailApp.search(q, 0, 10);
      if (!threads.length) continue;
      threads.forEach(function (t) {
        if (label) t.addLabel(label);
        if (t.getMessageCount() === 1) t.moveToArchive(); // jamais un fil où le client a répondu
      });
      return;
    }
  } catch (e) { Logger.log("Copie: " + e.message); }
}

// Test : envoie le mail de démarrage à hello@ via Brevo (à lancer depuis l'éditeur)
function testBrevo() {
  envoyerBrevo({
    to: EXPEDITEUR, subject: "[TEST] " + SUJET_DEMARRAGE, name: "SOLOC'",
    html: buildEmail("Charles", SIGNATURES.equipe, "https://charles-creationpages.github.io/CRMsoloc2/formulaire.html?id=test", "https://charles-creationpages.github.io/CRMsoloc2/lettre.html?id=test", "https://charles-creationpages.github.io/CRMsoloc2/documents.html?p=etudiant")
  });
  Logger.log("OK : mail de test envoyé à " + EXPEDITEUR + " via Brevo");
}

function buildEmail(prenom, sign, linkForm, linkLettre, linkDocs) {
  var A="#C1614F", D="#2C3E50", CR="#FBF7F0", BD="#E5D9C6", G="#9AA7B2", T2="#5A6B7B";

  function etape(num, titre, desc, url, label, couleur) {
    return '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;border:1px solid ' + BD + ';border-radius:12px;' + (num===3?'background:'+CR+';':'') + '"><tr>'
      + '<td width="54" valign="top" style="padding:16px 0 16px 16px;">'
      +   '<div style="width:30px;height:30px;background:' + A + ';border-radius:50%;color:#fff;font-weight:800;font-size:15px;text-align:center;line-height:30px;">' + num + '</div>'
      + '</td>'
      + '<td valign="top" style="padding:16px 16px 16px 8px;">'
      +   '<div style="font-size:15px;font-weight:800;color:' + D + ';">' + titre + '</div>'
      +   '<div style="font-size:13px;color:' + T2 + ';line-height:1.5;margin:4px 0 10px;">' + desc + '</div>'
      +   '<a href="' + url + '" style="display:inline-block;background:' + couleur + ';color:#fff;text-decoration:none;font-size:13px;font-weight:700;padding:9px 18px;border-radius:9px;">' + label + '</a>'
      + '</td>'
      + '</tr></table>';
  }

  var html = ''
  + '<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:' + D + ';background:#fff;">'
  + '<div style="background:' + D + ';padding:16px 24px;">'
  +   '<span style="display:inline-block;width:32px;height:32px;background:' + A + ';border-radius:7px;color:#fff;font-weight:800;font-size:16px;text-align:center;line-height:32px;vertical-align:middle;">S</span>'
  +   ' <span style="color:#fff;font-size:15px;font-weight:800;vertical-align:middle;">soloc\'</span>'
  + '</div>'
  + '<div style="padding:26px 28px 4px;font-size:15px;line-height:1.7;">'
  +   'Bonjour <b>' + escapeHtml(prenom) + '</b>,<br><br>'
  +   'Comme convenu lors de notre échange, voici les 3 étapes pour démarrer votre accompagnement. Une fois ces éléments transmis, je vous attribue un chasseur dédié qui vous contactera rapidement pour lancer concrètement la recherche de votre futur logement.'
  + '</div>'
  + '<div style="padding:0 28px;">'
  +   etape(1, "Complétez votre formulaire", "Vos critères de recherche en quelques minutes, pour qu'on cible les bons logements.", linkForm, "Remplir le formulaire", A)
  +   etape(2, "Signez votre lettre de mission", "Elle officialise votre accompagnement. Signature en ligne, en 2 minutes.", linkLettre, "Signer la lettre", D)
  +   etape(3, "Préparez vos documents", "Une checklist personnalisée pour constituer votre dossier locatif sans rien oublier.", linkDocs, "Voir ma checklist", D)
  + '</div>'
  + '<div style="padding:6px 28px 4px;font-size:14px;color:' + T2 + ';line-height:1.7;">'
  +   'L\'objectif est simple : trouver un appartement qui vous correspond, en vous faisant gagner du temps et de l\'énergie, sans le stress des démarches et des allers-retours avec les agences. N\'hésitez pas à me solliciter pour la moindre question, je vous accompagne à chaque étape.'
  + '</div>'
  // Signature
  + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 28px 28px;border-top:1px solid ' + BD + ';padding-top:16px;width:auto;"><tr>'
  +   '<td width="70" valign="middle"><img src="' + sign.photo + '" width="60" height="60" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid ' + A + ';" alt=""/></td>'
  +   '<td valign="middle" style="padding-left:14px;">'
  +     '<div style="font-size:15px;font-weight:800;color:' + D + ';">' + sign.name + '</div>'
  +     '<div style="font-size:12px;color:' + A + ';font-weight:700;margin-bottom:5px;">' + sign.role + ' · SOLOC\'</div>'
  +     '<div style="font-size:11px;color:' + T2 + ';line-height:1.6;">' + (sign.phone ? 'Tél. ' + sign.phone + ' &nbsp;·&nbsp; ' : '') + 'hello@solocimmo.fr<br>solocimmo.fr</div>'
  +   '</td>'
  + '</tr></table>'
  + '</div>';
  return html;
}

function escapeHtml(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }


// ══════════════════════════════════════════════════════════════════════════
// ── RELANCES AUTOMATIQUES (clients en « Envoyé ») ──────────────────────────
// Chaque matin : pour chaque client en « Envoyé » avec un email, sans mouvement depuis
// RELANCE_JOURS jours (et au moins RELANCE_JOURS jours après la relance précédente),
// envoie un mail de relance signé par la personne assignée. RELANCE_MAX relances au plus.
// Le CRM affiche « 🔁 Relance auto n/3 » sur la fiche (champs relanceAutoCount / relanceAutoAt).
// ══════════════════════════════════════════════════════════════════════════
const RELANCE_JOURS    = 3;
const RELANCE_MAX      = 3;
// Ancienneté max : on ne relance que les clients passés en « Envoyé » depuis moins de N jours
// (les plus anciens sont ignorés, à traiter à la main). 0 = pas de limite.
const RELANCE_AGE_MAX_JOURS = 0;
const CLIENT_BASE_URL  = "https://charles-creationpages.github.io/CRMsoloc2/";
const FIREBASE_API_KEY = "AIzaSyBSU4Yc5q6e0q5UHxgmn7gq2AwWg7aFl3Q"; // clé publique Firebase (déjà dans le CRM)
const FIREBASE_PROJECT = "soloc-crm";
const SCRIPT_EMAIL     = "script@solocimmo.fr";

// Textes des 3 relances — {prenom} = prénom du client ; {criteres} = « correspondant à votre recherche
// (T2 · Lyon 7 · 750 € max) » d'après les critères de la fiche (ou sans parenthèse s'ils sont vides).
// encart = phrase mise en avant dans un bloc coloré sous l'introduction.
const RELANCE_TEXTES = [
  { sujet: "{prenom}, des logements correspondent déjà à votre recherche",
    intro: "Bonne nouvelle : nous recevons chaque jour de nouvelles offres {criteres}. Cependant, il manque encore quelques éléments à votre dossier pour que l'on puisse vous les proposer.",
    encart: "Complétez les étapes ci-dessous (quelques minutes suffisent) et nous vous envoyons les prochaines offres en priorité." },
  { sujet: "{prenom}, ne passez pas à côté des prochaines offres",
    intro: "Cette semaine encore, plusieurs biens {criteres} sont passés entre nos mains. Les meilleurs logements partent en quelques heures, et les propriétaires retiennent d'abord les dossiers complets.",
    encart: "Votre dossier n'est pas encore complet : finalisez-le pour que l'on puisse vous positionner dès la prochaine offre." },
  { sujet: "{prenom}, on garde votre place ?",
    intro: "Sans nouvelles de votre part, nous allons bientôt mettre votre recherche en pause. Si votre projet est toujours d'actualité, il suffit de finaliser les étapes ci-dessous et nous reprenons immédiatement la recherche de biens {criteres}.",
    encart: "Vos plans ont changé ? Répondez simplement à ce mail pour nous le dire, cela nous aide beaucoup." }
];

// À lancer UNE fois : crée la relance automatique chaque matin (vers 10 h).
function installerRelances() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "relancesAuto") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("relancesAuto").timeBased().everyDays(1).atHour(10).create();
  Logger.log("OK : relances automatiques installées (chaque matin vers 10 h)");
}

// Aperçu SANS rien envoyer : liste les clients qui seraient relancés aujourd'hui.
function apercuRelances() { relancesAuto(true); }

// Envoie un exemple de relance n°1 à hello@ (pour voir le rendu).
function testRelanceMail() {
  var faux = { id: "test", name: "Julien Test", firstName: "Julien", email: EXPEDITEUR, assignedTo: ["emmy"],
               criteria: { statutClient: "Étudiant" }, formulaireRempli: "2026-01-01T00:00:00Z" };
  var m = mailRelance(faux, 1);
  envoyerMail({ to: EXPEDITEUR, subject: "[TEST] " + m.sujet, html: m.html, name: "SOLOC'" });
  Logger.log("OK : exemple de relance envoyé à " + EXPEDITEUR);
}

function relancesAuto(apercu) {
  var token = getFirebaseToken();
  var leads = getCollectionAvecId(token, "leads");
  // Avancement lu directement dans la base (sans attendre que le CRM soit ouvert) :
  // formulaire reçu = soumissions/{id} ; lettre signée = lettres/{id} au statut « signe ».
  var soumissions = {}, lettres = {};
  getCollectionAvecId(token, "soumissions").forEach(function (x) { soumissions[x.leadId || x.id] = x; });
  getCollectionAvecId(token, "lettres").forEach(function (x) { lettres[x.id] = x; });
  var maintenant = Date.now(), jour = 24 * 3600 * 1000, envoyees = 0, lignes = [], ignores = [];
  leads.forEach(function (l) {
    var emailOrigine = String(l.email || "");
    l.email = corrigerEmail(emailOrigine);
    if (l.column !== "envoye" || l.archived || !l.email) return;
    var sm = soumissions[l.id], lt = lettres[l.id];
    var debut = dateMs(l.envoyeAt) || dateMs(l.envoiAt) || dateMs(l.lastActivity);
    var age = debut ? Math.floor((Date.now() - debut) / (24 * 3600 * 1000)) : 999;
    if (RELANCE_AGE_MAX_JOURS && age > RELANCE_AGE_MAX_JOURS) { ignores.push(l.name + " (en Envoyé depuis " + age + " j)"); return; }
    if (!l.formulaireRempli && sm) l.formulaireRempli = sm.submittedAt || "oui";
    if (!l.lettreSignee && lt && lt.status === "signe") l.lettreSignee = lt.signedAt || "oui";
    var n = parseInt(l.relanceAutoCount || 0, 10);
    if (n >= RELANCE_MAX) return;
    var dernier = Math.max(dateMs(l.lastActivity), dateMs(l.envoyeAt), dateMs(l.envoiAt), dateMs(l.relanceAutoAt),
                           dateMs(sm && sm.submittedAt), dateMs(lt && lt.signedAt)); // formulaire / signature = le dossier a bougé
    if (!dernier || maintenant - dernier < RELANCE_JOURS * jour) return;
    var num = n + 1;
    lignes.push(l.name + " <" + l.email + "> → relance " + num + "/" + RELANCE_MAX + " (en Envoyé depuis " + age + " j)"
      + (l.email !== emailOrigine ? "  [adresse corrigée, était « " + emailOrigine + " »]" : ""));
    if (apercu) return;
    try {
      var m = mailRelance(l, num);
      // 1) on note la relance dans le CRM AVANT d'envoyer : si l'écriture échoue, rien ne part
      //    (évite de renvoyer la même relance chaque matin)
      var iso = new Date().toISOString();
      var journal = (Array.isArray(l.relanceAutoLog) ? l.relanceAutoLog : []).concat([iso]);
      var champs = { relanceAutoCount: { integerValue: String(num) }, relanceAutoAt: { stringValue: iso },
        relanceAutoLog: { arrayValue: { values: journal.map(function (d) { return { stringValue: d }; }) } } };
      if (l.email !== emailOrigine) champs.email = { stringValue: l.email }; // adresse corrigée enregistrée sur la fiche
      majLead(token, l.id, champs);
      // 2) puis on envoie le mail
      envoyerMail({ to: l.email, subject: m.sujet, html: m.html, name: "SOLOC'" });
      envoyees++;
      Utilities.sleep(200);
    } catch (err) { Logger.log("Echec relance " + l.email + " : " + err.message); }
  });
  Logger.log((apercu ? "APERÇU (rien envoyé) — " : "") + lignes.length + " client(s) à relancer" + (lignes.length ? " :\n" + lignes.join("\n") : ""));
  if (ignores.length) Logger.log(ignores.length + " client(s) ignoré(s), trop anciens (limite " + RELANCE_AGE_MAX_JOURS + " j) :\n" + ignores.join("\n"));
  if (!apercu) Logger.log(envoyees + " relance(s) envoyée(s)");
}

// Nettoie l'adresse (espaces) et corrige les fautes de frappe courantes sur le domaine.
const DOMAINES_CORRIGES = {
  "ail.com": "gmail.com", "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmal.com": "gmail.com", "gamil.com": "gmail.com",
  "gmail.co": "gmail.com", "gmail.fr": "gmail.com", "gmail.con": "gmail.com", "gmaill.com": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmail.con": "hotmail.com", "hotmial.fr": "hotmail.fr",
  "yahou.fr": "yahoo.fr", "yaho.fr": "yahoo.fr", "yahoo.con": "yahoo.com", "outlok.fr": "outlook.fr", "outlok.com": "outlook.com"
};
function corrigerEmail(e) {
  e = String(e || "").replace(/\s+/g, "");
  var i = e.lastIndexOf("@");
  if (i > 0) { var dom = e.slice(i + 1).toLowerCase(); if (DOMAINES_CORRIGES[dom]) e = e.slice(0, i + 1) + DOMAINES_CORRIGES[dom]; }
  return e;
}

// Prénom propre (même règle que le CRM) : si le prénom de la fiche est vide ou contient le nom complet,
// on cherche le mot qui ressemble le plus à un prénom grâce à la liste officielle (prenoms.js du site,
// gardée 6 h en cache). Mots EN MAJUSCULES mêlés à des minuscules = nom ; « Da Rocha » reste entier ;
// aucun prénom reconnu → 1er mot ; prénom TOUT EN MAJUSCULES → « Karima ».
var _prenoms = null;
function listePrenoms() {
  if (_prenoms) return _prenoms;
  var txt = "";
  try {
    var cache = CacheService.getScriptCache();
    txt = cache.get("prenoms_fr") || "";
    if (!txt) {
      var r = UrlFetchApp.fetch("https://charles-creationpages.github.io/CRMsoloc2/prenoms.js", { muteHttpExceptions: true });
      var m = r.getResponseCode() === 200 ? r.getContentText().match(/PRENOMS_FR="([^"]*)"/) : null;
      txt = m ? m[1].replace(/\\n/g, "\n") : "";
      if (txt) cache.put("prenoms_fr", txt, 21600);
    }
  } catch (e) { txt = ""; } // liste indisponible → ancienne règle (1er mot)
  _prenoms = {}; txt.split("\n").forEach(function (x) { if (x) _prenoms[x] = 1; });
  return _prenoms;
}
function prenomDe(o) {
  var f = String(o.firstName || "").trim(), n = String(o.name || "").trim();
  if (f && !(/\s/.test(f) && (!String(o.lastName || "").trim() || f === n))) return f;
  var w = String(f || n).split(/\s+/).filter(function (x) { return x; });
  var P = listePrenoms(), aListe = Object.keys(P).length > 0;
  var PART = { DA:1, DE:1, DI:1, DU:1, DOS:1, DES:1, EL:1, AL:1, LE:1, LA:1, VAN:1, VON:1, DEL:1, BEN:1, BIN:1, OULD:1, MAC:1, MC:1 };
  var cle = function (t) { return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z-]/g, ""); };
  var estPrenom = function (t) { var k = cle(t); return !!k && k.split("-").filter(function (x) { return x; }).every(function (x) { return P[x]; }); };
  var titre = function (s) { return /[a-zà-ÿ]/.test(s) ? s : String(s).toLowerCase().replace(/(^|[\s-])(\p{L})/gu, function (m, a, b) { return a + b.toUpperCase(); }); };
  if (w.length <= 1) return titre(w[0] || "");
  var caps = function (t) { return t.length > 1 && t === t.toUpperCase() && /[A-ZÀ-Þ]/.test(t); };
  var low = w.filter(function (t) { return !caps(t); });
  if (low.length && low.length < w.length) {
    var pr = aListe ? low.filter(estPrenom) : low;
    return titre((pr.length ? pr : low).join(" "));
  }
  if (!aListe) return titre(w[0]);
  var flags = w.map(function (t, i) { return estPrenom(t) && !(PART[cle(t)] && i + 1 < w.length && !estPrenom(w[i + 1])); });
  var i = flags.indexOf(true);
  if (i < 0) return titre(PART[cle(w[0])] ? w.join(" ") : w[0]);
  var j = i; while (j + 1 < w.length && flags[j + 1]) j++;
  if (i === 0 && j === w.length - 1) j = 0;
  return titre(w.slice(i, j + 1).join(" "));
}

function dateMs(iso) { var t = iso ? new Date(iso).getTime() : 0; return isNaN(t) ? 0 : t; }

function signataire(l) {
  var a = Array.isArray(l.assignedTo) ? l.assignedTo : (l.assignedTo ? [l.assignedTo] : []);
  if (a.indexOf("emmy") !== -1) return SIGNATURES.emmy;
  if (a.indexOf("aya") !== -1) return SIGNATURES.aya;
  return SIGNATURES.equipe;
}

function docProfil(statut) {
  if (statut === "Étudiant") return "etudiant";
  if (statut === "Indépendant") return "independant";
  return "salarie";
}

function mailRelance(l, num) {
  var A="#C1614F", D="#2C3E50", BD="#E5D9C6", T2="#5A6B7B", G="#9AA7B2";
  var prenom = prenomDe(l);
  var txt = RELANCE_TEXTES[Math.min(num, RELANCE_TEXTES.length) - 1];
  var crit0 = l.criteria || {};
  var details = [ (Array.isArray(crit0.typologie) ? crit0.typologie : (crit0.typologie ? [crit0.typologie] : [])).join(" / "),
                  crit0.secteur || "", crit0.loyer ? String(crit0.loyer).replace(/\s*€?$/, "") + " € max" : "" ].filter(function (x) { return x; }).join(" · ");
  var criteres = "correspondant à votre recherche" + (details ? " (" + escapeHtml(details) + ")" : "");
  var sign = signataire(l);
  var crit = l.criteria || {};
  var liens = [
    { fait: !!l.formulaireRempli, titre: "Compléter votre formulaire", url: CLIENT_BASE_URL + "formulaire.html?id=" + l.id + "&n=" + encodeURIComponent(l.name || ""), bouton: "Remplir le formulaire" },
    { fait: !!l.lettreSignee,     titre: "Signer votre lettre de mission", url: CLIENT_BASE_URL + "lettre.html?id=" + l.id, bouton: "Signer la lettre" },
    { fait: false,                titre: "Envoyer vos documents", url: CLIENT_BASE_URL + "documents.html?id=" + l.id + "&p=" + docProfil(crit.statutClient), bouton: "Voir ma checklist" }
  ];
  var etapes = liens.map(function (e) {
    return '<tr><td style="padding:10px 0;border-bottom:1px solid ' + BD + ';">'
      + (e.fait
        ? '<span style="color:#15803d;font-weight:800;">✓ ' + e.titre + '</span> <span style="color:' + G + ';font-size:12px;">— c\'est fait, merci !</span>'
        : '<div style="font-weight:800;color:' + D + ';margin-bottom:6px;">' + e.titre + '</div>'
          + '<a href="' + e.url + '" style="display:inline-block;background:' + A + ';color:#fff;text-decoration:none;font-size:13px;font-weight:700;padding:8px 16px;border-radius:9px;">' + e.bouton + '</a>')
      + '</td></tr>';
  }).join("");
  var html = ''
  + '<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:' + D + ';background:#fff;">'
  + '<div style="padding:22px 28px 6px;font-size:15px;line-height:1.7;">Bonjour <b>' + escapeHtml(prenom) + '</b>,<br><br>' + txt.intro.replace("{criteres}", criteres) + '</div>'
  + (txt.encart ? '<div style="margin:10px 28px 4px;background:#F5E2DD;border-left:4px solid ' + A + ';border-radius:8px;padding:12px 14px;font-size:14px;font-weight:700;color:#A14E3F;line-height:1.5;">' + txt.encart + '</div>' : '')
  + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:0 28px;width:auto;margin:0 28px;">' + etapes + '</table>'
  + '<div style="padding:14px 28px 4px;font-size:14px;color:' + T2 + ';line-height:1.7;">Une question ? Répondez simplement à ce mail' + (sign.phone ? ' ou appelez-moi au <b>' + sign.phone + '</b>' : '') + '.</div>'
  + '<table cellpadding="0" cellspacing="0" border="0" style="margin:18px 28px 26px;border-top:1px solid ' + BD + ';padding-top:14px;"><tr>'
  +   '<td width="64" valign="middle"><img src="' + sign.photo + '" width="54" height="54" style="width:54px;height:54px;border-radius:50%;object-fit:cover;border:2px solid ' + A + ';" alt=""/></td>'
  +   '<td valign="middle" style="padding-left:12px;"><div style="font-size:14px;font-weight:800;">' + sign.name + '</div>'
  +   '<div style="font-size:12px;color:' + A + ';font-weight:700;">' + sign.role + ' · SOLOC\'</div>'
  +   '<div style="font-size:11px;color:' + T2 + ';">hello@solocimmo.fr · solocimmo.fr</div></td>'
  + '</tr></table></div>';
  return { sujet: txt.sujet.replace("{prenom}", prenom), html: html };
}

// ── FIRESTORE (lecture des leads + mise à jour des champs de relance) ─────
function getFirebaseToken() {
  var pwd = PropertiesService.getScriptProperties().getProperty("SCRIPT_PASSWORD");
  if (!pwd) throw new Error("Mot de passe manquant (Paramètres du projet → Propriétés du script → SCRIPT_PASSWORD)");
  var res = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + FIREBASE_API_KEY,
    { method: "post", contentType: "application/json", payload: JSON.stringify({ email: SCRIPT_EMAIL, password: pwd, returnSecureToken: true }), muteHttpExceptions: true });
  var data = JSON.parse(res.getContentText());
  if (!data.idToken) throw new Error("Firebase auth échoué");
  return data.idToken;
}

function getCollectionAvecId(token, coll) {
  var out = [], pageToken = "";
  do {
    var url = "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT + "/databases/(default)/documents/" + coll + "?pageSize=300" + (pageToken ? "&pageToken=" + pageToken : "");
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText());
    if (data.error) throw new Error("Firestore : " + (data.error.message || data.error.status));
    (data.documents || []).forEach(function (d) { var o = parseFields(d.fields); o.id = d.name.split("/").pop(); out.push(o); });
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return out;
}

function majLead(token, id, fields) {
  var mask = Object.keys(fields).map(function (k) { return "updateMask.fieldPaths=" + k; }).join("&");
  var res = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT + "/databases/(default)/documents/leads/" + id + "?" + mask,
    { method: "patch", contentType: "application/json", headers: { Authorization: "Bearer " + token }, payload: JSON.stringify({ fields: fields }), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error("Firestore " + res.getResponseCode() + " : " + res.getContentText().slice(0, 200));
}

function parseFields(fields) {
  var o = {};
  if (!fields) return o;
  Object.keys(fields).forEach(function (k) { o[k] = parseVal(fields[k]); });
  return o;
}
function parseVal(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.nullValue !== undefined) return null;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(parseVal);
  if (v.mapValue !== undefined) return parseFields(v.mapValue.fields);
  return null;
}
