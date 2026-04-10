# Kova — déploiement & URLs (référence prod)

## URLs Vercel / domaine

| Rôle | URL |
|------|-----|
| Domaine prod (clients) | `https://kova.agencybinary.fr` |
| Projet Vercel (exemple) | `https://kova-liart.vercel.app` |
| Déploiement preview (varie par build) | `https://kova-h0bg9bhf5-agencybinarys-projects.vercel.app` (pattern type preview) |

`NEXT_PUBLIC_APP_URL` en prod doit être l’URL **publique canonique** (souvent `https://kova.agencybinary.fr`, sans slash final) pour OAuth / Stripe return URLs.

## Facturation (comportement code)

- Plan **free** : **50 requêtes / mois** (`src/lib/stripe.ts` → `PLANS.free.requests`), reset calendaire UTC (`src/lib/subscription.ts`).
- **Plus / Pro** : quotas plus élevés + Stripe Checkout / Portal (price IDs en env).

## Perf (notes)

- Le layout racine ne force plus tout le site en `force-dynamic` : landing + legal en **statique** (CDN), shell dashboard + auth Clerk en **dynamique** — meilleur TTFB sur les pages publiques et onboarding perçu plus rapide.
- Les métriques Vercel restent sensibles au poids JS (ex. Framer Motion, chat) ; itérer avec Lighthouse sur `/` et `/dashboard` si besoin.

## Cible produit

SaaS **agentique** : exécution d’actions sur intégrations (Gmail, Calendar, Meet, Docs, Drive, Notion, envois programmés, etc.) avec gouvernance / file d’approbation. Le comportement assistant est porté par le **modèle** (`systemPrompt` dans `src/lib/ai/client.ts`), pas par du texte marketing dans l’UI.
