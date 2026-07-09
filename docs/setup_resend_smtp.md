# Setup SMTP Resend pour Supabase Auth — AhOuai

## Pourquoi ?
Supabase utilise un SMTP par défaut limité à **3 mails/heure** et souvent flagué spam par Gmail.
Pour que les emails de confirmation (signup, reset password) arrivent bien, il faut configurer un SMTP custom.

**Recommandation : [Resend](https://resend.com)** — 3000 mails/mois gratuits, UI moderne, config Supabase 5 min.

---

## Étapes

### 1. Créer un compte Resend
1. Aller sur https://resend.com/signup
2. S'inscrire avec `jscoursault.pro@gmail.com`

### 2. Vérifier le domaine `ahouai.com`
1. Resend Dashboard → **Domains** → **Add Domain** → `ahouai.com`
2. Resend affiche **3 enregistrements DNS** à ajouter (2 TXT + 1 MX)
3. Aller chez le registrar (OVH ou autre) → **Zone DNS** de `ahouai.com`
4. Ajouter les 3 enregistrements donnés par Resend
5. Revenir dans Resend → cliquer **Verify** → attendre ~5 min la propagation DNS

### 3. Générer une API Key Resend
1. Resend Dashboard → **API Keys** → **Create API Key**
2. Nom : `AhOuai Supabase SMTP`
3. Permission : **Sending access** (pas Full)
4. **Copier la clé** (commence par `re_`)

### 4. Configurer dans Supabase Dashboard
1. Aller sur https://supabase.com/dashboard → projet `xjcomwhzupwiqbahaisc`
2. **Authentication** → **SMTP Settings** → **Enable Custom SMTP**
3. Remplir :
   | Champ | Valeur |
   |---|---|
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | `re_xxxxxxxxxxxx` (la clé API) |
   | Sender name | `AhOuai` |
   | Sender email | `noreply@ahouai.com` |
4. **Save**

### 5. Tester
1. Dans l'app, faire un signup avec email → un email doit arriver dans les 30 secondes
2. Vérifier que l'expéditeur est `AhOuai <noreply@ahouai.com>`

---

## Alternative : SendGrid
Si Resend ne convient pas, SendGrid offre 100 mails/jour gratuits.
- Host : `smtp.sendgrid.net`
- Port : `587`
- Username : `apikey`
- Password : la clé API SendGrid

---

*Créé le 9 juillet 2026 — Task #25*
