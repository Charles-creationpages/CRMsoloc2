// ─── SOLOC' — Mail de démarrage au passage en "Envoyé" (3 liens) — via BREVO ─
// À déployer en Application Web sur hello@solocimmo.fr
//   • Exécuter en tant que : Moi (hello@solocimmo.fr)
//   • Qui a accès : Tout le monde
// La clé Brevo se met dans : Paramètres du projet → Propriétés du script → BREVO_API_KEY

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
    envoyerBrevo({
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
