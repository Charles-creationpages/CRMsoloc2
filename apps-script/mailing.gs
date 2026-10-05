// ─── SOLOC' — Mailing hebdo agents partenaires ──────────────────────────
// Déclencheur : lundi, entre 8h et 9h → sendWeeklyMailing
// Test immédiat : exécuter testMailing (envoie les 3 versions de signature à TEST_EMAIL)
//
// Signature selon l'étiquette (« Propriétaire ») du partenaire dans le CRM :
//   • Aya     → signature d'Aya
//   • Emmy    → signature d'Emmy
//   • Charles → double signature : Aya + son numéro, puis Emmy + son numéro, puis hello@
//
// Réglage (Paramètres du projet ⚙️ → Propriétés du script) :
//   • SCRIPT_PASSWORD : mot de passe du compte Firebase script@solocimmo.fr

// ── CONFIG ───────────────────────────────────────────────────────────────
const FIREBASE_API_KEY = "AIzaSyBSU4Yc5q6e0q5UHxgmn7gq2AwWg7aFl3Q"; // clé publique Firebase (déjà dans le CRM)
const FIREBASE_PROJECT = "soloc-crm";
const SCRIPT_EMAIL     = "script@solocimmo.fr";
const SCRIPT_PASSWORD  = PropertiesService.getScriptProperties().getProperty("SCRIPT_PASSWORD") || "";
const TEST_EMAIL       = "charlespurpleimmobilier@gmail.com";

// Comptes CRM d'Emmy et d'Aya (pour retrouver l'étiquette des anciens partenaires sans « owner »)
const EMAIL_EMMY = "emmymariet8@gmail.com";
const EMAIL_AYA  = "ayabelkebir213@gmail.com";

const PERSONNES = {
  aya:  { prenom:"Aya",  phone:"07 84 69 80 44", photo:"https://charles-creationpages.github.io/CRMsoloc2/aya-placeholder.png" },
  emmy: { prenom:"Emmy", phone:"06 12 89 64 15", photo:"https://www.image2url.com/r2/default/images/1782485194319-214ff267-5164-41c4-97fd-d2fe963c4714.png" }
};

// Qui signe pour chaque étiquette (Charles → Aya puis Emmy)
function signatairesDe(owner) {
  if (owner === "aya")  return [PERSONNES.aya];
  if (owner === "emmy") return [PERSONNES.emmy];
  return [PERSONNES.aya, PERSONNES.emmy];
}

// Étiquette du partenaire : champ « owner » du CRM, sinon le compte qui l'a créé, sinon Charles
function ownerDe(p) {
  if (p.owner === "aya" || p.owner === "emmy" || p.owner === "charles") return p.owner;
  var e = String(p.createdBy || "").trim().toLowerCase();
  if (e === EMAIL_AYA)  return "aya";
  if (e === EMAIL_EMMY) return "emmy";
  return "charles";
}

function nomExpediteur(signataires) {
  return signataires.map(function(s){ return s.prenom; }).join(" & ") + " — SOLOC'";
}

// ── PROD ─────────────────────────────────────────────────────────────────
function sendWeeklyMailing() {
  var ok = [], ko = [];
  try {
    const token    = getFirebaseToken();
    const leads    = getLeadsEnRecherche(token);
    const partners = getPartners(token);
    if (leads.length === 0)    { Logger.log("Aucune recherche — mailing annule."); alerte("Mailing du lundi NON envoyé : aucune recherche « En recherche » dans le CRM."); return; }
    if (partners.length === 0) { Logger.log("Aucun partenaire — mailing annule."); alerte("Mailing du lundi NON envoyé : aucun partenaire avec email dans le CRM."); return; }
    partners.forEach(function(p) {
      try {
        const sign = signatairesDe(ownerDe(p));
        const html = buildEmailHtml(p.prenom || p.nom || "toi", leads, sign);
        const sujet = (sign.length > 1 ? "Nos" : "Mes") + " recherches locatives du " + todayLabel();
        GmailApp.sendEmail(p.email, sujet, "", { htmlBody: html, name: nomExpediteur(sign), bcc: "hello@solocimmo.fr" });
        ok.push(p.email);
        Logger.log("Mail envoye a : " + p.email + " (signature " + nomExpediteur(sign) + ")");
      } catch(e) { ko.push(p.email + " → " + e.message); Logger.log("Erreur pour " + p.email + " : " + e.message); }
    });
    Logger.log("Mailing termine — " + ok.length + " envoyes, " + ko.length + " en erreur.");
    // Compte rendu à Charles : succès (court) ou erreurs (détail)
    if (ko.length) alerte("Mailing du lundi : " + ok.length + " envoyé(s), " + ko.length + " en ERREUR.\n\n" + ko.join("\n"));
    else alerte("✓ Mailing du lundi envoyé à " + ok.length + " partenaire(s) (" + leads.length + " recherches).", true);
  } catch(e) {
    Logger.log("Erreur sendWeeklyMailing : " + e.message);
    alerte("Mailing du lundi NON envoyé — erreur : " + e.message + (ok.length ? "\n\nDéjà envoyés : " + ok.join(", ") : ""));
  }
}

// Prévient Charles par mail (succès ou échec) pour qu'une panne ne passe plus inaperçue
function alerte(texte, succes) {
  try {
    MailApp.sendEmail(TEST_EMAIL, (succes ? "" : "⚠ ") + "SOLOC' — " + texte.split("\n")[0].slice(0, 90), texte + "\n\n(Script : mailing hebdo partenaires — onglet Exécutions pour le détail)");
  } catch(e) { Logger.log("Alerte impossible : " + e.message); }
}

// Vérifie le déclencheur du lundi et le recrée s'il manque (à lancer une fois)
function installerDeclencheurLundi() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "sendWeeklyMailing") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendWeeklyMailing").timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).inTimezone("Europe/Paris").create();
  Logger.log("OK : déclencheur installé — chaque lundi entre 8h et 9h (heure de Paris).");
}

// ── TEST : 3 mails (signature Aya, Emmy, puis Aya + Emmy pour les partenaires de Charles) ──
function testMailing() {
  try {
    const token = getFirebaseToken();
    var leads   = getLeadsEnRecherche(token);
    if (leads.length === 0) {
      Logger.log("Aucune recherche — donnees fictives.");
      leads = [
        { firstName:"Emma",   criteria:{ statutClient:"Etudiant",    typologie:"T1", surface:"25", loyer:"600",  secteur:"Lyon 6",       prestationsSupp:"" }},
        { firstName:"Julien", criteria:{ statutClient:"CDI",         periodeEssaiValidee:true, typologie:"T2", surface:"40", loyer:"900",  secteur:"Villeurbanne", prestationsSupp:"" }},
        { firstName:"Sophie", criteria:{ statutClient:"Independant", typologie:"T3", surface:"60", loyer:"1100", secteur:"Lyon 3",        prestationsSupp:"Parking" }}
      ];
    }
    [["aya","partenaire d'Aya"],["emmy","partenaire d'Emmy"],["charles","partenaire de Charles"]].forEach(function(t) {
      const sign = signatairesDe(t[0]);
      const html = buildEmailHtml("Charles", leads, sign);
      GmailApp.sendEmail(TEST_EMAIL, "[TEST " + t[1] + "] " + (sign.length > 1 ? "Nos" : "Mes") + " recherches locatives — " + todayLabel(), "", { htmlBody: html, name: nomExpediteur(sign) });
    });
    Logger.log("3 mails de test envoyes a " + TEST_EMAIL + " (" + leads.length + " recherches).");
  } catch(e) { Logger.log("Erreur testMailing : " + e.message); }
}

// ── FIREBASE AUTH ─────────────────────────────────────────────────────────
function getFirebaseToken() {
  if (!SCRIPT_PASSWORD) throw new Error("Mot de passe manquant : ajoute SCRIPT_PASSWORD dans Paramètres du projet → Propriétés du script");
  const res  = UrlFetchApp.fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + FIREBASE_API_KEY,
    { method:"post", contentType:"application/json", muteHttpExceptions:true,
      payload: JSON.stringify({ email: SCRIPT_EMAIL, password: SCRIPT_PASSWORD, returnSecureToken: true }) }
  );
  const data = JSON.parse(res.getContentText());
  if (!data.idToken) throw new Error("Firebase auth echoue : " + res.getContentText());
  return data.idToken;
}

// ── FIRESTORE — leads en recherche ────────────────────────────────────────
function getLeadsEnRecherche(token) {
  const res = UrlFetchApp.fetch(
    "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT + "/databases/(default)/documents:runQuery",
    { method:"post", contentType:"application/json", muteHttpExceptions:true,
      headers:{ Authorization:"Bearer " + token },
      payload: JSON.stringify({ structuredQuery: { from:[{ collectionId:"leads" }], where:{ fieldFilter:{ field:{ fieldPath:"column" }, op:"EQUAL", value:{ stringValue:"en_recherche" } } } } }) }
  );
  return JSON.parse(res.getContentText())
    .filter(function(r){ return r.document; })
    .map(function(r){ return parseDoc(r.document.fields); });
}

// ── FIRESTORE — partenaires ───────────────────────────────────────────────
function getPartners(token) {
  const res = UrlFetchApp.fetch(
    "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT + "/databases/(default)/documents/partenaires?pageSize=300",
    { method:"get", contentType:"application/json", muteHttpExceptions:true, headers:{ Authorization:"Bearer " + token } }
  );
  const data = JSON.parse(res.getContentText());
  if (!data.documents) return [];
  return data.documents.map(function(d){ return parseDoc(d.fields); }).filter(function(p){ return p.email; });
}

// ── PARSER Firestore ──────────────────────────────────────────────────────
function parseDoc(fields) {
  if (!fields) return {};
  var obj = {};
  Object.keys(fields).forEach(function(k) {
    var v = fields[k];
    if      (v.stringValue  !== undefined) obj[k] = v.stringValue;
    else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
    else if (v.integerValue !== undefined) obj[k] = parseInt(v.integerValue);
    else if (v.nullValue    !== undefined) obj[k] = null;
    else if (v.mapValue     !== undefined) obj[k] = parseDoc(v.mapValue.fields);
    else if (v.arrayValue   !== undefined) obj[k] = (v.arrayValue.values||[]).map(function(i){
      return i.stringValue !== undefined ? i.stringValue : parseDoc(i.mapValue && i.mapValue.fields);
    });
  });
  return obj;
}

// ── COULEUR par statut ────────────────────────────────────────────────────
function statutColor(statut) {
  if (statut === "Etudiant" || statut === "Étudiant") return "#C1614F";
  if (statut === "CDI") return "#2C3E50";
  if (statut === "CDD") return "#3B82F6";
  return "#9AA7B2";
}

// ── CARTE HTML d'un lead ──────────────────────────────────────────────────
function buildLeadCard(lead) {
  var c      = lead.criteria || {};
  var prenom = lead.firstName || lead.name || "Client";
  var statut = c.statutClient || "";
  var typo   = Array.isArray(c.typologie) ? c.typologie.join("/") : (c.typologie || "");
  var surface= c.surface     || "";
  var loyer  = c.loyer       || "";
  var secteur= c.secteur     || "";
  var extras = c.prestationsSupp ? " " + c.prestationsSupp + " souhaité." : "";
  var color  = statutColor(statut);

  // Libellé statut
  var statutLabel = statut;
  if (statut === "CDI" && c.periodeEssaiValidee === true) statutLabel = "CDI — Essai validé";

  // Description solvabilité
  var solvabilite = "";
  var s = statut.toLowerCase().replace(/é/g,"e");
  if (s === "etudiant") {
    solvabilite = "Dispose de <strong style='color:#2C3E50;'>garants physiques solvables</strong>.";
  } else if (statut === "CDI") {
    solvabilite = "Solvabilité permettant jusqu'à <strong style='color:#2C3E50;'>" + loyer + "€/mois</strong>.";
  } else if (statut === "CDD") {
    solvabilite = "Dossier complet fourni.";
  } else {
    solvabilite = "Justifie de <strong style='color:#2C3E50;'>2 bilans minimum</strong>.";
  }

  var recherche = "";
  if (typo)    recherche += "<strong style='color:#2C3E50;'>" + typo + "</strong>";
  if (surface) recherche += ", <strong style='color:#2C3E50;'>" + surface + " m² min</strong>";
  if (secteur) recherche += ", secteur <strong style='color:#2C3E50;'>" + secteur + "</strong>";
  if (extras)  recherche += "." + extras;
  else         recherche += ".";

  var budgetColor = color;

  return [
    "<table cellpadding='0' cellspacing='0' border='0' width='100%' style='margin-bottom:12px;background:#FBF7F0;border-radius:12px;border:1px solid #E5D9C6;'>",
    "<tr>",
    "<td style='width:5px;background:" + color + ";border-radius:12px 0 0 12px;'></td>",
    "<td style='padding:14px 18px;'>",
    "<table cellpadding='0' cellspacing='0' border='0' width='100%'><tr valign='top'>",
    "<td>",
    "<div style='font-size:14px;font-weight:800;color:#2C3E50;margin-bottom:3px;'>" + prenom + "</div>",
    "<div style='font-size:10px;font-weight:700;color:" + color + ";text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;'>" + statutLabel + "</div>",
    "<div style='font-size:13px;color:#5A6B7B;line-height:1.65;'>" + solvabilite + " Recherche " + recherche + "</div>",
    "</td>",
    "<td style='width:95px;text-align:right;padding-left:14px;vertical-align:top;'>",
    "<div style='background:#fff;border:1px solid #E5D9C6;border-radius:10px;padding:9px 11px;text-align:center;'>",
    "<div style='font-size:10px;color:#9AA7B2;margin-bottom:3px;'>Budget max</div>",
    "<div style='font-size:19px;font-weight:800;color:" + budgetColor + ";'>" + loyer + " €</div>",
    "<div style='font-size:9px;color:#9AA7B2;'>CC / mois</div>",
    "</div>",
    "</td>",
    "</tr></table>",
    "</td>",
    "</tr>",
    "</table>"
  ].join("");
}

// ── SIGNATURE (1 personne, ou Aya puis Emmy pour les partenaires de Charles) ──
function buildSignature(sign) {
  var photos = sign.map(function(s, i) {
    return "<td style='" + (i < sign.length - 1 ? "padding-right:12px;" : "") + "text-align:center;'>"
      + "<img src='" + s.photo + "' width='72' height='72' style='border-radius:50%;display:block;border:3px solid #F5E2DD;' alt='" + s.prenom + "'/>"
      + "<div style='font-size:11px;color:#9AA7B2;font-weight:700;margin-top:5px;text-align:center;'>" + s.prenom + "</div>"
      + "</td>";
  }).join("");
  var noms = sign.map(function(s){ return s.prenom; }).join(" <span style='color:#C1614F;'>&amp;</span> ");
  var tels = sign.map(function(s) {
    return "<tr><td style='padding-bottom:6px;font-size:13px;color:#5A6B7B;'>&#128222; "
      + (sign.length > 1 ? "<span style='font-weight:700;color:#2C3E50;'>" + s.prenom + "</span>&nbsp;: " : "")
      + "<a href='tel:" + s.phone.replace(/\s/g, "") + "' style='color:#2C3E50;text-decoration:none;font-weight:600;'>" + s.phone + "</a></td></tr>";
  }).join("");

  return [
    "<table cellpadding='0' cellspacing='0' border='0' style='width:100%;max-width:520px;margin-top:24px;'>",
    "<tr><td style='background:#C1614F;height:4px;border-radius:4px 4px 0 0;'></td></tr>",
    "<tr><td style='background:#ffffff;border:1px solid #E5D9C6;border-top:none;border-radius:0 0 14px 14px;padding:22px 26px;'>",
    "<table cellpadding='0' cellspacing='0' border='0' width='100%'><tr valign='middle'>",
    // Photos
    "<td style='width:" + (sign.length > 1 ? 165 : 80) + "px;padding-right:22px;'>",
    "<table cellpadding='0' cellspacing='0' border='0'><tr>" + photos + "</tr></table>",
    "</td>",
    // Infos
    "<td style='vertical-align:middle;'>",
    "<div style='font-size:20px;font-weight:800;color:#2C3E50;letter-spacing:-.02em;margin-bottom:3px;'>" + noms + "</div>",
    "<div style='font-size:11px;color:#C1614F;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px;'>Chasse appartement en location</div>",
    "<table cellpadding='0' cellspacing='0' border='0'>",
    tels,
    "<tr><td style='padding-bottom:6px;font-size:13px;color:#5A6B7B;'>&#9993; <a href='mailto:hello@solocimmo.fr' style='color:#C1614F;text-decoration:none;font-weight:600;'>hello@solocimmo.fr</a></td></tr>",
    "<tr><td style='padding-bottom:6px;font-size:13px;color:#5A6B7B;'>&#128205; 345 rue Garibaldi, 69007 Lyon</td></tr>",
    "<tr><td style='font-size:13px;'><a href='https://solocimmo.fr' style='color:#C1614F;font-weight:700;text-decoration:none;'>&#127758; solocimmo.fr</a></td></tr>",
    "</table>",
    "</td>",
    "</tr></table>",
    "</td></tr>",
    "<tr><td style='background:#2C3E50;padding:12px 26px;border-radius:0 0 14px 14px;'>",
    "<span style='color:rgba(255,255,255,.9);font-size:13px;font-weight:800;'>soloc'</span>",
    "<span style='color:rgba(255,255,255,.35);font-size:12px;margin-left:8px;'>— Chasseur locatif Lyon</span>",
    "</td></tr>",
    "</table>"
  ].join("");
}

// ── EMAIL HTML complet ────────────────────────────────────────────────────
function buildEmailHtml(agentPrenom, leads, sign) {
  sign = sign || signatairesDe("charles");
  var cartes = leads.map(buildLeadCard).join("");
  var nb     = leads.length;
  var nous   = sign.length > 1; // double signature → « nous »
  var intro  = nous
    ? "Voici nos recherches actualisées en ce début de semaine. N'hésite pas à nous contacter si tu as quelque chose, même légèrement hors critères — nous recevons des clients en continu, tout peut aller vite."
    : "Voici mes recherches actualisées en ce début de semaine. N'hésite pas à me contacter si tu as quelque chose, même légèrement hors critères — je reçois des clients en continu, tout peut aller vite.";

  return [
    "<!DOCTYPE html><html lang='fr'><head><meta charset='UTF-8'/></head>",
    "<body style='margin:0;padding:0;background:#f4f1ec;font-family:Helvetica Neue,Arial,sans-serif;'>",
    "<div style='max-width:600px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 32px rgba(0,0,0,.10);'>",

    // Header
    "<table cellpadding='0' cellspacing='0' border='0' width='100%'>",
    "<tr><td style='background:#2C3E50;padding:26px 32px;'>",
    "<table cellpadding='0' cellspacing='0' border='0'><tr>",
    "<td style='width:46px;height:46px;background:#C1614F;border-radius:12px;text-align:center;vertical-align:middle;'>",
    "<span style='color:#fff;font-size:22px;font-weight:900;line-height:46px;display:block;'>S</span></td>",
    "<td style='padding-left:14px;vertical-align:middle;'>",
    "<div style='color:#fff;font-size:20px;font-weight:800;letter-spacing:-.02em;'>soloc'</div>",
    "<div style='color:rgba(255,255,255,.45);font-size:10px;letter-spacing:.12em;margin-top:2px;'>CHASSEUR LOCATIF LYON</div>",
    "</td></tr></table>",
    "</td></tr></table>",

    // Body
    "<div style='padding:32px;'>",
    "<p style='font-size:15px;color:#2C3E50;margin:0 0 10px;'>Salut " + agentPrenom + ", j'espère que tu vas bien !</p>",
    "<p style='font-size:14px;color:#5A6B7B;line-height:1.7;margin:0 0 26px;'>" + intro + "</p>",

    // Séparateur titre
    "<table cellpadding='0' cellspacing='0' border='0' width='100%' style='margin-bottom:16px;'><tr>",
    "<td style='border-top:1px solid #E5D9C6;'></td>",
    "<td style='white-space:nowrap;padding:0 12px;font-size:11px;font-weight:700;color:#C1614F;text-transform:uppercase;letter-spacing:.1em;'>",
    nb + " recherche" + (nb > 1 ? "s" : "") + " en cours",
    "</td>",
    "<td style='border-top:1px solid #E5D9C6;'></td>",
    "</tr></table>",

    // Cartes
    cartes,

    // Congé
    "<p style='font-size:14px;color:#2C3E50;margin:20px 0 4px;'>À très bientôt,</p>",

    // Signature
    buildSignature(sign),

    "</div>",

    // Footer
    "<div style='background:#F2E8DA;padding:14px 32px;border-top:1px solid #E5D9C6;'>",
    "<p style='font-size:11px;color:#9AA7B2;margin:0;'>SOLOC' — Chasseur locatif Lyon · <a href='https://solocimmo.fr' style='color:#C1614F;text-decoration:none;'>solocimmo.fr</a></p>",
    "<p style='font-size:11px;color:#9AA7B2;margin:4px 0 0;'>Vous recevez cet email car vous faites partie du réseau partenaires SOLOC'.</p>",
    "</div>",

    "</div></body></html>"
  ].join("");
}

// ── DATE française ────────────────────────────────────────────────────────
function todayLabel() {
  var d    = new Date();
  var mois = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
  return d.getDate() + " " + mois[d.getMonth()] + " " + d.getFullYear();
}
