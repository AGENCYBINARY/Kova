# Kova — déploiement & URLs (référence prod)

## URLs Vercel / domaine

| Rôle | URL |
|------|-----|
| Domaine prod (clients) | `https://kova.agencybinary.fr` |
| Projet Vercel (exemple) | `https://kova-liart.vercel.app` |
| Déploiement preview (varie par build) | `https://kova-h0bg9bhf5-agencybinarys-projects.vercel.app` (pattern type preview) |

`NEXT_PUBLIC_APP_URL` en prod doit être l’URL **publique canonique** (souvent `https://kova.agencybinary.fr`, sans slash final) pour OAuth / Stripe return URLs.

## Vercel Crons — plan Hobby vs Pro

Sur le **plan Hobby**, Vercel **refuse** tout cron qui s’exécute **plus d’une fois par jour** (ex. `*/5 * * * *` → échec au déploiement avec le message sur les limites Hobby).

- **Ce repo** : `scheduled-sends` est donc calé sur **1× par jour** (`30 7 * * *` ≈ 07:30 UTC) pour que le build passe en Hobby. Les files `workflows` et `prune` restent quotidiens.
- **Envois Gmail programmés “dans l’heure”** : en Hobby, il faut soit **passer en Vercel Pro** et remettre un schedule type `*/5 * * * *` dans `vercel.json`, soit appeler l’URL `GET /api/internal/maintenance/scheduled-sends` avec `Authorization: Bearer CRON_SECRET` depuis un **cron externe** (ex. toutes les 5 min).

Voir [docs Vercel — Cron Hobby limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Facturation (comportement code)

- Plan **free** : **50 requêtes / mois** (`src/lib/stripe.ts` → `PLANS.free.requests`), reset calendaire UTC (`src/lib/subscription.ts`).
- **Plus / Pro** : quotas plus élevés + Stripe Checkout / Portal (price IDs en env).

## Perf (notes)

- Le layout racine ne force plus tout le site en `force-dynamic` : landing + legal en **statique** (CDN), shell dashboard + auth Clerk en **dynamique** — meilleur TTFB sur les pages publiques et onboarding perçu plus rapide.
- Les métriques Vercel restent sensibles au poids JS (ex. Framer Motion, chat) ; itérer avec Lighthouse sur `/` et `/dashboard` si besoin.

## Cible produit

SaaS **agentique** : exécution d’actions sur intégrations (Gmail, Calendar, Meet, Docs, Drive, Notion, envois programmés, etc.) avec gouvernance / file d’approbation. Le comportement assistant est porté par le **modèle** (`systemPrompt` dans `src/lib/ai/client.ts`), pas par du texte marketing dans l’UI. Message d’accueil vide : `src/lib/chat/welcome-copy.ts` (court, une seule source serveur + client). Erreurs tour chat : `getChatRouteErrorPayload` → JSON `messageFr` / `messageEn` pour éviter les dumps OpenAI bruts.

## Recommandations Vercel (panneau « Recommendations »)

Certaines entrées ne se configurent **pas** dans le repo : elles dépendent du **plan** (Hobby vs Pro) et des **réglages projet** sur [vercel.com](https://vercel.com). Voici quoi activer pour Kova et quoi ignorer.

### À activer (forte utilité)

1. **Secure Preview Deployments (Deployment Protection)**  
   Limite l’accès aux **preview URLs** (et optionnellement à la prod) avant qu’un visiteur anonyme ne voie l’app.  
   **Où :** Projet → *Settings* → *Deployment Protection* → activer la protection adaptée (ex. *Vercel Authentication* ou *Standard Protection* selon ton équipe).  
   **Note :** Clerk sur l’app protège l’**application**, pas l’URL Vercel brute ; les deux sont complémentaires.

2. **Prevent Frontend-Backend Mismatches (Skew Protection)**  
   Réduit les erreurs quand un onglet garde un vieux bundle JS alors qu’un nouveau déploiement sert déjà un autre serveur.  
   **Où :** Projet → *Settings* → *Advanced* → **Skew Protection** (souvent **Pro / Enterprise** ; les projets récents peuvent l’avoir par défaut).  
   **Prérequis :** *Automatically expose system environment variables* activé pour le projet.  
   Avec **Next.js 14.2+** build **sur Vercel**, il n’y a en général **rien à ajouter** dans `next.config.js` pour le cœur du mécanisme.

### Utile seulement si tu payes Vercel Pro+ (pas « inutile », mais pas applicable en Hobby)

3. **Build Multiple Deployments Simultaneously** — débloque des **builds en parallèle** au lieu de la file d’attente : réglage / offre **Pro** (pas de clé dans `vercel.json`).

4. **Switch to a bigger build machine** — *Settings* → *Build & Deployment* → taille de machine : accélère `prisma generate` + `next build` sur grosses bases.

### Ce qu’on ne pousse pas dans le dépôt

- Pas de fichier magique pour forcer Skew Protection ou Deployment Protection : c’est volontairement **côté dashboard** pour éviter de figer des politiques d’équipe dans Git sans discussion.
- Le fichier `vercel.json` du repo reste centré sur **build** + **crons** (voir section Hobby vs Pro ci-dessus).
