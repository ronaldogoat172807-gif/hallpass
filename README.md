# Hall Pass

A classroom hall pass board. Students tap out and back in on a shared iPad.
The teacher watches from her own device and gets a red row plus a chime when
someone is out past the time limit.

Two things it does that Happy Halls doesn't:

- **"That's not me."** Checking back in always asks "Welcome back, Chris! Is this you?"
  A wrong tap is one button away from being undone.
- **Forgot to check in?** Kids who are out sit in a yellow strip at the top of the iPad
  with a big *I'm back* button, and the teacher has a *They're back* button on every
  row so she can fix it from her seat.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000.

1. **Teacher:** click *Create account*, fill in your name, room name, email, password.
2. Go to **Settings** and copy the 6-letter room code.
3. **iPad / spare computer:** open the same address, type the room code, tap *Join room*.
   It stays joined after that.
4. Add students under **Students**. Places (Bathroom, Water, Nurse, Library, Office)
   are already there, and you can add more.

While you're testing on one computer, open the teacher screen in one browser window
and the iPad screen in a private/incognito window so they have separate sign-ins.

## Demo account (local only)

The local data file already has a demo room you can poke at:

- email `demo@hallpass.local`, password `chalkboard`
- room code is shown on its Settings page

Delete `data/db.json` to start fresh.

## Tests

```bash
npm test
```

## How it's built

- Node.js 20 + Express. Plain HTML, CSS and JavaScript, no framework.
- All data lives in `data/db.json`. One classroom's worth is tiny.
- Live updates use Server-Sent Events, so both screens update the instant anything changes.
- Design notes: `docs/superpowers/specs/2026-11-13-hallpass-design.md`.

## Putting it online

Not done yet. It needs a host that runs Node and keeps a file on disk
(Render, Railway and Fly all have free or near-free tiers). Set `PORT` and
`DATA_FILE` as environment variables if the host asks for them.
