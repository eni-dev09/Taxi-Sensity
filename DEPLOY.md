# 🚀 Guide de déploiement — Taxi Downtown

Tout est gratuit. Compte ~30 minutes la première fois.

---

## 📋 Prérequis

- Un compte **GitHub** (gratuit) → https://github.com/signup
- Un compte **Cloudflare** (gratuit) → https://dash.cloudflare.com/sign-up
- Un compte **JSONBin** (gratuit) → https://jsonbin.io

---

## 🗂 Étape 1 — Créer le dépôt GitHub

1. Va sur https://github.com/new
2. Nom : `taxi-downtown`
3. Public
4. Coche "Add a README file"
5. Clique **Create repository**

---

## 📤 Étape 2 — Uploader les fichiers

### Méthode simple (interface web)

1. Sur la page du dépôt, clique **Add file** → **Upload files**
2. Glisse les 6 fichiers : `index.html`, `worker.js`, `README.md`, `DEPLOY.md`, `LICENSE`, `.gitignore`
3. **Commit changes**

### Méthode Git (recommandée)

```bash
git clone https://github.com/TON-PSEUDO/taxi-downtown.git
cd taxi-downtown
# Copie tes fichiers ici
git add .
git commit -m "Init: site + worker"
git push