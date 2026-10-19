# Davai Suka — PWA de suivi d'entraînement

Fichiers statiques (aucun serveur nécessaire) : `index.html`, `app.js`, `styles.css`,
`manifest.webmanifest`, `sw.js`, `icons/`.

## Renommer l'application
1. `app.js` : constante `APP_NAME` (en haut du fichier).
2. `manifest.webmanifest` : champs `name` et `short_name` (nom affiché sous l'icône Android).
3. `index.html` : balise `<title>`.
4. `sw.js` : augmenter `CACHE_VERSION` (ex. `-v2`) pour forcer la mise à jour sur le téléphone.

## Tester sur ordinateur
`python3 -m http.server 8000` dans ce dossier puis ouvrir http://localhost:8000

## Installer sur Android
Une fois hébergé en HTTPS (ex. GitHub Pages) : ouvrir l'adresse dans Chrome → menu ⋮ →
« Ajouter à l'écran d'accueil » / « Installer l'application ».

Les données restent dans le navigateur du téléphone (localStorage). Utiliser
Programme → Mes données → Exporter pour faire une sauvegarde.
