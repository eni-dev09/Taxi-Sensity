# 🚕 Taxi Downtown · Sensity RP

Site vitrine de la compagnie de taxi **Taxi Downtown** sur le serveur RP **Sensity**.

## 🌐 Site en ligne

- **Production** : https://TON-PSEUDO.github.io/taxi-downtown/
- **Worker API** : https://taxi-downtown.TON-PSEUDO.workers.dev

## ✨ Fonctionnalités

- **Site vitrine** : flotte, équipe, tarifs, primes, partenariat Horny's, règlement
- **Admin panel complet** : gestion des factures, véhicules, employés, attributions
- **Actions employés** : embaucher, changer rôle, sanctionner, virer, réembaucher
- **Synchronisation multi-utilisateurs** via Cloudflare Worker + JSONBin
- **Export** : JSON complet, CSV factures, impression
- **Thèmes** : Dark / Light / Halloween
- **PWA installable** sur mobile
- **Responsive** : PC, tablette, mobile
- **Sécurité** : code admin obfusqué, rate limiting login, session admin 2h

## 🛠 Stack

- HTML/CSS/JS vanilla (aucun framework)
- Cloudflare Workers (API proxy)
- JSONBin.io (stockage distant)
- GitHub Pages (hébergement)

## 🚀 Déploiement

Voir [DEPLOY.md](./DEPLOY.md)

## 👥 Accès admin

- Cliquer 5× sur "TD" en haut à gauche (ou double-clic)
- Code par défaut : `DOWNTOWN26` (à changer dans `worker.js` et `index.html`)

## 📝 Licence

MIT — voir [LICENSE](./LICENSE)
