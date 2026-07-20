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

app.post('/generer-cv', upload.single('photo'), async (req, res) => {
  try {
    const donnees = req.body;
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
      // Chemin absolu nécessaire pour que Puppeteer trouve l'image
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

    // ---- GÉNÉRATION DU PDF ----
    const navigateur = await puppeteer.launch();
    const page = await navigateur.newPage();
    await page.setContent(templateHtml, { waitUntil: 'networkidle0' });

    const nomFichier = `CV_${(donnees.nom || 'candidat').replace(/\s+/g, '_')}.pdf`;
    const cheminPdf = path.join(__dirname, 'uploads', nomFichier);

    await page.pdf({
      path: cheminPdf,
      format: 'A4',
      printBackground: true,
    });

    await navigateur.close();

    // Envoie le PDF en téléchargement au client
    res.download(cheminPdf, nomFichier);

  } catch (erreur) {
    console.error('Erreur lors de la génération :', erreur);
    res.status(500).send('Une erreur est survenue lors de la génération du CV. Vérifiez la console du serveur.');
  }
});

app.listen(PORT, () => {
  console.log(`Le serveur tourne sur http://localhost:${PORT}`);
});
