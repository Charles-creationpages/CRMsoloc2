// ─── SOLOC' — Mail de validation dossier (Papernest + pack électroménager) — via BREVO ─
// À déployer en Application Web sur le compte hello@solocimmo.fr
//   • Exécuter en tant que : Moi (hello@solocimmo.fr)
//   • Qui a accès : Tout le monde
// La clé Brevo se met dans : Paramètres du projet → Propriétés du script → BREVO_API_KEY

// ── CONFIG ────────────────────────────────────────────────────────────────
const EXPEDITEUR  = "hello@solocimmo.fr";
// Copie cachée de chaque mail client dans hello@ (pour garder la trace + libellés Emmy/Aya).
// Attention : chaque copie compte pour 1 mail dans le quota Brevo. Mettre false pour désactiver.
const COPIE_HELLO = false;

// Lien de réservation du pack électroménager.
// Tant qu'il est vide, le bouton "Réserver mon pack" n'apparaît pas.
const PACK_ELECTRO_URL = "https://charles-creationpages.github.io/CRMsoloc2/pack.html";

const SIGNATURES = {
  emmy:   { name:"Emmy MARIET",     role:"Responsable recherche locative", phone:"06 12 89 64 15", photo:"https://charles-creationpages.github.io/CRMsoloc2/emmy.jpg" },
  aya:    { name:"Aya BELKEBIR",    role:"Responsable recherche locative", phone:"07 84 69 80 44", photo:"https://charles-creationpages.github.io/CRMsoloc2/aya-placeholder.png" },
  equipe: { name:"L'équipe SOLOC'", role:"Chasseur locatif Lyon",          phone:"",                photo:"https://charles-creationpages.github.io/CRMsoloc2/icon-192.png" }
};

// ── POINT D'ENTRÉE ────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    var sign = SIGNATURES[p.sender] || SIGNATURES.equipe;
    // Mail de félicitations au client (seulement s'il a un email)
    if (p.email) {
      var sujet = "Félicitations " + (p.prenom || "") + ", votre dossier est validé !";
      envoyerMail({
        to: p.email, subject: sujet, name: "SOLOC'",
        html: buildEmail(p.prenom || "", p.rdvLabel || "", sign),
        bcc: COPIE_HELLO ? EXPEDITEUR : ""
      });
      rangerCopie(p.email, sujet, p.sender);
    }
    // Mail interne à hello@ (RDV Papernest + adresse du bien)
    // S'il échoue, le mail client est déjà parti : on le signale sans tout marquer en erreur.
    if (p.rdvLabel) {
      try { mailInternePapernest(p); }
      catch (err2) { return ContentService.createTextOutput("OK_SANS_RECAP : " + err2.message); }
    }
    return ContentService.createTextOutput("OK");
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

// ── Mail interne "URGENT - AJOUT PAPERNEST" (libellé Charles) ─────────────
function mailInternePapernest(p) {
  var texte = "Nouveau RDV Papernest a enregistrer sur le site Papernest :\n\n"
    + "Nom : " + (p.nom || "") + "\n"
    + "Prenom : " + (p.prenom || "") + "\n"
    + "Telephone : " + (p.phone || "") + "\n"
    + "Email : " + (p.email || "") + "\n"
    + "Adresse du bien : " + (p.adresse || "") + "\n"
    + "Date du RDV Papernest : " + (p.rdvLabel || "");
  envoyerMail({ to: EXPEDITEUR, subject: "URGENT - AJOUT PAPERNEST", name: "CRM SOLOC'", html: buildInterne(p), text: texte });
  try {
    var label = GmailApp.getUserLabelByName("Charles") || GmailApp.createLabel("Charles");
    for (var i = 0; i < 4; i++) {
      Utilities.sleep(3000);
      var threads = GmailApp.search('newer_than:1d subject:(URGENT AJOUT PAPERNEST)', 0, 5);
      if (!threads.length) continue;
      for (var j = 0; j < threads.length; j++) { threads[j].addLabel(label); }
      return;
    }
  } catch (e) { Logger.log("Libelle Charles: " + e.message); }
}

function buildInterne(p) {
  var A = "#C1614F", D = "#2C3E50", CR = "#FBF7F0", BD = "#E5D9C6", G = "#9AA7B2";
  var row = function (k, v) {
    return '<tr><td style="padding:8px 14px;border-bottom:1px solid ' + BD + ';font-size:12px;color:' + G + ';font-weight:700;white-space:nowrap;">' + k + '</td>'
      + '<td style="padding:8px 14px;border-bottom:1px solid ' + BD + ';font-size:14px;color:' + D + ';font-weight:700;">' + escapeHtml(v || "—") + '</td></tr>';
  };
  return '<div style="max-width:520px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:' + D + ';">'
    + '<div style="background:' + A + ';color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-size:16px;font-weight:800;">&#9888;&#65039; RDV Papernest à enregistrer</div>'
    + '<div style="border:1px solid ' + BD + ';border-top:none;border-radius:0 0 10px 10px;padding:6px 4px;background:#fff;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0">'
    + row("Nom", p.nom) + row("Prénom", p.prenom) + row("Téléphone", p.phone) + row("Email", p.email)
    + row("Adresse du bien", p.adresse) + row("Date du RDV", p.rdvLabel)
    + '</table></div>'
    + '<div style="font-size:12px;color:' + G + ';margin-top:10px;">À reporter sur le site Papernest. Infos ci-dessus copiables directement.</div>'
    + '</div>';
}

// Test : envoie le mail de validation à hello@ via Brevo (à lancer depuis l'éditeur)
function testBrevo() {
  envoyerBrevo({ to: EXPEDITEUR, subject: "[TEST] Félicitations Julien, votre dossier est validé !", name: "SOLOC'",
    html: buildEmail("Julien", "jeudi 12 septembre à 14h30", SIGNATURES.emmy) });
  Logger.log("OK : mail de test envoyé à " + EXPEDITEUR + " via Brevo");
}

// ── CONSTRUCTION DU MAIL (HTML inline, compatible Gmail) ─────────────────
function buildEmail(prenom, rdvLabel, sign) {
  var A="#C1614F", D="#2C3E50", CR="#FBF7F0", BD="#E5D9C6", G="#9AA7B2", T2="#5A6B7B";

  var packBtn = PACK_ELECTRO_URL
    ? '<a href="' + PACK_ELECTRO_URL + '" style="display:inline-block;background:' + D + ';color:#fff;text-decoration:none;font-size:13px;font-weight:700;padding:10px 20px;border-radius:9px;">Réserver mon pack</a>'
    : '<span style="font-size:12px;color:' + G + ';font-style:italic;">Notre équipe vous recontacte pour la réservation.</span>';

  var rdvBloc = rdvLabel
    ? ('<div style="background:#F5E2DD;border-radius:9px;padding:12px;text-align:center;margin-bottom:12px;">'
      + '<div style="font-size:11px;color:#A14E3F;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">Rendez-vous Papernest</div>'
      + '<div style="font-size:18px;font-weight:800;color:' + D + ';margin-top:3px;">' + rdvLabel + '</div></div>')
    : '';

  var html = ''
  + '<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:' + D + ';background:#fff;">'
  // Header
  + '<div style="background:' + D + ';padding:16px 24px;">'
  +   '<span style="display:inline-block;width:32px;height:32px;background:' + A + ';border-radius:7px;color:#fff;font-weight:800;font-size:16px;text-align:center;line-height:32px;vertical-align:middle;">S</span>'
  +   ' <span style="color:#fff;font-size:15px;font-weight:800;vertical-align:middle;">soloc\'</span>'
  + '</div>'
  // Felicitations
  + '<div style="padding:26px 28px 8px;text-align:center;">'
  +   '<div style="font-size:32px;">&#127881;</div>'
  +   '<div style="font-size:22px;font-weight:800;color:' + D + ';margin-top:6px;">Félicitations ' + escapeHtml(prenom) + ',<br>votre dossier est validé !</div>'
  +   '<div style="font-size:14px;color:' + T2 + ';line-height:1.6;margin-top:10px;">L\'appartement est à vous, toute l\'équipe SOLOC\' vous félicite. On continue de vous accompagner pour votre installation.</div>'
  + '</div>'
  // Rappel RDV Papernest
  + '<div style="margin:18px 28px;border:1.5px solid ' + A + ';border-radius:12px;overflow:hidden;">'
  +   '<div style="background:' + A + ';color:#fff;padding:12px 16px;font-size:14px;font-weight:800;">&#128197; Votre rendez-vous énergie est calé</div>'
  +   '<div style="padding:16px;">' + rdvBloc
  +     '<div style="font-size:13px;color:' + T2 + ';line-height:1.6;">En 30 minutes, Papernest s\'occupe de <b>tout</b> : électricité, gaz, eau, box internet, assurance habitation. <b style="color:' + A + ';">Tout en une seule fois, aux meilleurs prix, et sans frais.</b> Vous n\'avez qu\'à être disponible, on gère le reste.</div>'
  +   '</div>'
  + '</div>'
  // Pack electromenager
  + '<div style="margin:18px 28px;border:1.5px solid ' + A + ';border-radius:12px;padding:16px;background:' + CR + ';">'
  +   '<div style="font-size:15px;font-weight:800;color:' + D + ';margin-bottom:4px;">&#129531; Pack électroménager <span style="font-size:11px;font-weight:800;color:#fff;background:' + A + ';border-radius:20px;padding:2px 9px;">À PRIX NÉGOCIÉ</span></div>'
  +   '<div style="font-size:13px;color:' + T2 + ';line-height:1.6;margin-bottom:10px;">Frigo, lave-linge, micro-ondes… on vous <b>livre ET installe tout</b> dans votre logement. <b style="color:' + D + ';">Vous n\'avez rien à faire</b>, tout est prêt à l\'emploi le jour de votre emménagement, <b style="color:' + A + ';">à prix négocié rien que pour vous.</b></div>'
  +   '<table cellpadding="0" cellspacing="0" border="0" style="background:#F5E2DD;border-radius:8px;margin-bottom:12px;"><tr>'
  +     '<td width="70" style="padding:8px 4px 8px 10px;"><img src="https://packelectrosolocimmo.lovable.app/assets/trottinette-gP68MjRm.jpg" width="58" height="58" style="width:58px;height:58px;object-fit:contain;border-radius:6px;background:#fff;" alt="Trottinette"/></td>'
  +     '<td style="padding:8px 12px 8px 6px;font-size:14px;font-weight:800;color:#A14E3F;">Trottinette électrique <span style="color:' + A + ';">OFFERTE</span></td>'
  +   '</tr></table>'
  +   packBtn
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
