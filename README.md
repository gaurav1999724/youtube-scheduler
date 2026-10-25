# youtube-scheduler

AutoTube AI Studio. It syncs videos from a Google Drive folder, drops duplicate pictures, writes YouTube titles with OpenAI, and publishes them on a daily schedule.

## Run

```bash
cp .env.example .env
npm install
npx prisma migrate deploy
npm run dev
```

In a second terminal:

```bash
npm run worker
```

Open http://localhost:3000. `ffmpeg` must be installed. Put the Google OAuth client, OpenAI key, and Drive folder link in `.env` or in Settings. Do not commit `.env`.

On Vercel, set `DATABASE_URL` and `DIRECT_URL` in the project environment. The app tables live in the Postgres schema `autotube`.
