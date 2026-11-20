# Hall Pass — design (first version)

## Why

A teacher currently uses a site called Happy Halls to track students leaving the
classroom. She told a student in her class that if they build a better one, she
will switch. Two things are wrong with Happy Halls:

1. When a student checks back in and taps the wrong name, there is no way to say
   "that's not me."
2. It looks like generic AI-generated design.

A detail from real use: nobody has actually been out too long. The closest case
is a student coming back and forgetting to check in. So the "out too long" alert
is mostly going to fire because of a forgotten check-in, and the app must make
that easy to fix.

## What it is

A website with two screens that live on two devices in the same classroom:

- **Classroom iPad (kiosk).** A grid of student names. A student taps their
  name, then taps where they are going. Students who are out appear in a yellow
  "Out right now" strip at the top with a big **I'm back** button. Tapping it
  shows "Welcome back, Chris! — Yep, that's me / That's not me." Students who
  are out are faded in the name grid so they can't leave twice.
- **Teacher's device (dashboard).** Who is out right now, with elapsed time.
  A row turns red when it passes the time limit and a short chime plays once.
  Every row has a **They're back** button so the teacher can close a forgotten
  check-in from her seat. Below: today's history, then student and place
  management, then settings (time limit in minutes, chime on/off, room code).

## Goals

- Fix the wrong-name problem with a confirm step on check-in.
- Make forgotten check-ins obvious and one tap to fix, from either device.
- Look like a chalkboard, not like a template: dark green board, wood frame,
  chalk-colored text, yellow sticky-note accents, red for overdue.
- Free to run. A kid should be able to put it online with a free account.

## Non-goals (first version)

- Phone push notifications or email. The teacher said on-screen plus a chime is enough for now.
- Multiple classes per teacher. One teacher = one room.
- Student accounts or passwords. Students only tap names.
- Reports/exports. History on screen is enough.

## Anti-goals

- Purple gradients, giant hero banners, card-everything layouts, default sans-serif on everything.
- Anything that stores more about students than their first name.

## How it gets made (builder's calls)

- **Node.js 20 + Express**, plain HTML/CSS/JS, no front-end framework.
- **Storage:** a single JSON file (`data/db.json`) written atomically. One
  classroom's worth of data is tiny. Swappable later.
- **Live updates:** Server-Sent Events. Any change broadcasts to every screen
  in that room, which then refetches state.
- **Teacher sign-in:** email + password, scrypt-hashed, cookie session.
- **Kiosk join:** the teacher's settings page shows a 6-character room code.
  The iPad types it once and gets a kiosk cookie that can only check students
  in and out for that room.
- **Overdue:** computed from `outAt` and the room's `alertMinutes`. The
  dashboard chimes once per trip, client side.
- **Tests:** `node --test` for the pure logic and the HTTP API.

## Data

- teacher: id, name, roomName, email, passHash, salt, roomCode, alertMinutes, chime
- student: id, teacherId, name
- place: id, teacherId, name
- trip: id, teacherId, studentId, placeId, outAt, inAt (null while out), closedBy ("student" | "teacher")
- session: token, teacherId, kind ("teacher" | "kiosk")

## Left to the builder

- Exact chime sound. Exact chalk font stack (prefer system "Chalkboard SE" on
  Apple devices with a serif fallback).
- Hosting provider walkthrough, written after the app works locally.
