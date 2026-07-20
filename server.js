require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const puppeteer = require('puppeteer');
const fsSync = require('fs');
if (!fsSync.existsSync('uploads')){
  fsSync.mkdirSync('uploads');
  }

const app = express();
const PORT = 3000;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const upload = multer({ dest: 'uploads/' });

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const axios = require('axios');

app.post('/demarrer-paiement', upload.single('photo'), async (req, res) => {
  try {
    const donnees = req.body;
    
    const sessionId = Date.now().toString();
    const sessionPath = path.join(__dirname, 'uploads', `session_${sessionId}.json`);
    
    const sessionData = {
      donnees: donnees,
      photoPath: req.file ? req.file.path : null
    };
    fs.writeFileSync(sessionPath, JSON.stringify(sessionData));

    const monetbilData = new URLSearchParams({
      amount: 500,
      currency: 'XAF',
      item_ref: sessionId,
      payment_ref: sessionId,
      return_url: `${req.protocol}://${req.get('host')}/paiement-retour?session=${sessionId}`,
      notify_url: `${req.protocol}://${req.get('host')}/paiement-notification`
    });

    const response = await axios.post(
      `https://api.monetbil.com/widget/v2.1/${process.env.MONETBIL_SERVICE_KEY}`,
      monetbilData
    );

    if (response.data.success) {
      res.redirect(response.data.payment_url);
    } else {
      res.status(500).send('Erreur lors de la création du paiement.');
    }
  } catch (erreur) {
    console.error('Erreur paiement:', erreur);
    res.status(500).send('Erreur lors du démarrage du paiement.');
  }
});
app.get('/paiement-retour', async (req, res) => {
  try {
    const sessionId = req.query.session;
    const status = req.query.status;

    if (status !== 'success' && status !== '1') {
      return res.send('<h2>Paiement annulé ou échoué. <a href="/formulaire.html">Réessayer</a></h2>');
    }

    const sessionPath = path.join(__dirname, 'uploads', `session_${sessionId}.json`);
    if (!fs.existsSync(sessionPath)) {
      return res.status(404).send('Session introuvable ou expirée.');
    }

    const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    const donnees = sessionData.donnees;

    // On réutilise la logique de génération de CV existante
    req.body = donnees;
    req.file = sessionData.photoPath ? { path: sessionData.photoPath } : null;
    
    await genererEtEnvoyerCV(req, res, donnees);

    fs.unlinkSync(sessionPath);

  } catch (erreur) {
    console.error('Erreur retour paiement:', erreur);
    res.status(500).send('Une erreur est survenue après le paiement.');
  }
});

async function genererEtEnvoyerCV(req, res, donnees) {
  try {
    const modeleChoisi = donnees.modele;
    const langueChoisie = donnees.langue === 'anglais' ? 'anglais' : 'français';

    const prompt = `Tu es un expert en rédaction de CV professionnels. Voici les informations brutes d'un candidat. Rédige chaque section de façon professionnelle, concise et convaincante, en ${langueChoisie}.

Informations du candidat :
- Poste visé : ${donnees.poste || ''}
- Profil personnel (brut) : ${donnees.profil || ''}
- Formation (brut) : ${donnees.formation || ''}
- Expérience (brut) : ${donnees.experience || ''}
- Compétences (brut) : ${donnees.competences || ''}
- Langues (brut) : ${donnees.langues || ''}

Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises markdown, au format exact suivant :
{
  "profil": "texte reformulé du profil, 2-3 phrases professionnelles",
  "formation": "texte reformulé de la formation",
  "experience": "texte reformulé de l'expérience, avec des puces si pertinent sous forme de <ul><li>...</li></ul>",
  "competences": "texte reformulé des compétences",
  "langues": "texte reformulé des langues"
}`;

    const reponseIA = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const texteGenere = reponseIA.content[0].text;
    const contenuAmeliore = JSON.parse(texteGenere);

    const cheminTemplate = path.join(__dirname, 'public', 'templates', `${modeleChoisi}.html`);
    let templateHtml = fs.readFileSync(cheminTemplate, 'utf8');

    let photoUrl = 'https://via.placeholder.com/150';
    if (req.file) {
      photoUrl = 'file://' + path.join(__dirname, req.file.path);
    }

    templateHtml = templateHtml
      .replaceAll('{{NOM}}', donnees.nom || '')
      .replaceAll('{{POSTE}}', donnees.poste || '')
      .replaceAll('{{EMAIL}}', donnees.email || '')
      .replaceAll('{{TELEPHONE}}', donnees.telephone || '')
      .replaceAll('{{VILLE}}', donnees.ville || '')
      .replaceAll('{{LINKEDIN}}', donnees.linkedin || '')
      .replaceAll('{{PHOTO}}', photoUrl)
      .replaceAll('{{PROFIL}}', contenuAmeliore.profil || '')
      .replaceAll('{{FORMATION}}', contenuAmeliore.formation || '')
      .replaceAll('{{EXPERIENCE}}', contenuAmeliore.experience || '')
      .replaceAll('{{COMPETENCES}}', contenuAmeliore.competences || '')
      .replaceAll('{{LANGUES}}', contenuAmeliore.langues || '');

    const navigateur = await puppeteer.launch();
    const page = await navigateur.newPage();
    await page.setContent(templateHtml, { waitUntil: 'networkidle0' });

    const nomFichier = `CV_${(donnees.nom || 'candidat').replace(/\s+/g, '_')}.pdf`;
    const cheminPdf = path.join(__dirname, 'uploads', nomFichier);

    await page.pdf({ path: cheminPdf, format: 'A4', printBackground: true });
    await navigateur.close();
    res.download(cheminPdf, nomFichier);

  } } catch (erreur) {
    console.error('Erreur lors de la génération :', erreur);
    res.status(500).send(`
      <h2>Une erreur est survenue lors de la génération de votre CV</h2>
      <p>Votre paiement a bien été reçu, mais une erreur technique nous empêche de générer votre CV pour le moment.</p>
      <p>Merci de nous contacter avec votre numéro de transaction pour obtenir votre CV ou un remboursement.</p>
      <p><a href="/formulaire.html">Retour au formulaire</a></p>
    `);
  }

function nettoyerVieuxFichiers() {
  const dossierUploads = path.join(__dirname, 'uploads');
  const maintenant = Date.now();
  const uneJournee = 24 * 60 * 60 * 1000;

  fs.readdir(dossierUploads, (err, fichiers) => {
    if (err) return console.error('Erreur lecture dossier uploads:', err);
    
    fichiers.forEach(fichier => {
      if (fichier === '.gitkeep') return;
      
      const cheminFichier = path.join(dossierUploads, fichier);
      fs.stat(cheminFichier, (err, stats) => {
        if (err) return;
        if (maintenant - stats.mtimeMs > uneJournee) {
          fs.unlink(cheminFichier, (err) => {
            if (!err) console.log(`Fichier supprimé: ${fichier}`);
          });
        }
      });
    });
  });
}

setInterval(nettoyerVieuxFichiers, 60 * 60 * 1000);


app.listen(PORT, () => {
  console.log(`Le serveur tourne sur http://localhost:${PORT}`);
});
