# YesPleez

A live-event web app that lets hosts and artists manage song requests in real time.

## What it does

- **Hosts** create events, manage a live lineup, and control what plays
- **Artists** have their own dashboard to see and fulfill requests from the crowd
- **Guests** browse, search, and submit song requests from their phone
- Real-time notifications keep everyone in sync during the show

## Tech

Single-page vanilla JS app — no build step required. Open `index.html` directly or serve the folder with any static file server.

## Modules

| File | Purpose |
|------|---------|
| `app.js` | Boot & event wiring (load last) |
| `auth.js` | Session management & role selection |
| `events.js` | Event creation and public event loading |
| `profiles.js` | Host / artist profile data |
| `search.js` | Song search logic |
| `audio.js` | Audio playback helpers |
| `navigation.js` | Screen routing |
| `notifications.js` | In-app notification system |
| `state.js` | Shared app state |
