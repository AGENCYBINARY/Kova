# Kova

Kova is a Next.js operator console for AI-assisted execution across Gmail, Google Calendar, Google Meet, Google Docs, and Notion.

## Stack

- Next.js 14
- React 18
- Prisma
- Clerk
- Google + Notion OAuth integrations

## Local Dev

Install dependencies and start the app:

```bash
npm install
npm run dev
```

Default local URL:

```bash
http://127.0.0.1:3000
```

If `3000` is busy, Next will move to `3001`.

## Build Check

Use this before ending a work session:

```bash
npm run build
```

## Required Env

This project relies on local `.env` / `.env.local` files for:

- Clerk
- Prisma / database
- `APP_ENCRYPTION_KEY`
- Google OAuth
- Notion OAuth
- `NEXT_PUBLIC_APP_URL`

For Clerk redirects, use:

```env
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL="/dashboard"
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL="/dashboard"
```

Avoid the deprecated legacy variables:

```env
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL
```

## Git

Remote:

```bash
origin https://github.com/AGENCYBINARY/Kova.git
```

Useful commands:

```bash
git status --short
git log --oneline -5
git push -u origin main
```

## Current Behavior

- Gmail send flow works
- Calendar event creation works
- Google Meet is now forced into Calendar proposals when the request explicitly mentions Meet / visio / video
- Chat header has been simplified
- Auto/ask selector remains in the input only

## Session Handoff

When resuming in a new terminal/session:

1. Start the app with `npm run dev`
2. Open `/sign-in`
3. Reconnect with Clerk
4. Verify Google integrations are still connected in `/integrations`
5. Test from `/chat`

Good verification prompt:

```text
Create a Google Meet invite for Maxime Neveu on March 18 2026 at 17:00 for 30 minutes and send the invite to neveu.maxime29@gmail.com
```

Expected behavior:

- ask mode: proposal shows `Google Meet actif`
- auto mode: event executes automatically when confidence/routing allow it

## Notes

- `.env` and `.env.local` are intentionally ignored by Git
- `.next` can become inconsistent in dev; if you hit missing module errors, restart cleanly:

```bash
rm -rf .next
npm run dev
```
