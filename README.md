# TollyDraw 🎬✏️
Drawasaurus-style multiplayer draw & guess game — with **Telugu movie titles (English letters)**.
Words come from `data/TeluguMovies_dataset.csv` (~1,340 titles, sorted by popularity into easy / medium / hard).

## Run
```
npm install
npm start          # http://localhost:3000   (PORT=4000 npm start to change)
```
Open it in 2+ browser tabs/devices. Create a room, share the link/code, host presses Start.

## Features
- Create room / join by 4-letter code or invite link / play with strangers (public rooms)
- Host settings: rounds, draw time, "Popular hits" or "Everything"
- Drawer picks 1 of 3 movies; canvas with colours, sizes, pen, fill bucket, eraser, undo, clear
- Live drawing sync, chat-based guessing, "close!" hints, letter hints revealed over time
- Faster guess = more points; drawer earns points too; final leaderboard
- Spelling-tolerant matching (Bahubali = Baahubali, Srimanthudu = Shreemanthudu...)

## Edit the words
Change the CSV, then `python3 scripts/build_words.py` to regenerate `words.json`.

## Deploy
Needs a host that keeps a Node server running (Render, Railway, Fly.io, VPS). Start command: `npm start`.
