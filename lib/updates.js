// What's new, newest update first. To ship an update: add an entry at the top, then bump
// "version" in package.json and the "v…" on the landing page to match (a test checks both).
// Teachers see the slides for every update they haven't seen yet, once.
export const FIRST = '0.1'; // the original version, before update notes existed

export const UPDATES = [
  {
    version: '0.4',
    slides: [
      {
        title: 'No more email',
        text: 'Signing in now takes two things: the name your students see, and your password. Hall Pass no longer asks for an email or keeps one.',
      },
      {
        title: 'Name your room in Settings',
        text: 'A new room is called after you to start with. Change the room name, or your own, under Names in Settings.',
      },
    ],
  },
  {
    version: '0.3',
    slides: [
      {
        title: 'A time limit for every place',
        text: 'The water fountain next door and the bathroom down the hall no longer share one limit. Each place has its own, starting at 5 minutes.',
      },
      {
        title: 'Set them in Places',
        text: 'The time limit has moved out of Settings. Open the Places tab, change the number next to a place, and it saves by itself.',
      },
    ],
  },
  {
    version: '0.2',
    slides: [
      {
        title: 'Exit code for the iPad',
        text: 'Set a short code in Settings. Type it on the iPad to leave the room, so your real password never goes near the classroom screen.',
      },
      {
        title: 'Open iPad screen',
        text: 'The new button at the top of your board opens the student screen in a new tab, already joined to your room. No room code, no signing out.',
      },
      {
        title: 'Screens stay put',
        text: 'Your teacher board and the student screen no longer swap places when both are open in the same browser.',
      },
      {
        title: 'Hall Pass is online',
        text: 'The app now runs on the web as well as on your own computer, and your room is saved in an online database.',
      },
      {
        title: 'Update notes',
        text: "You're looking at them. After every update these slides show once, and the update number sits at the bottom of Settings.",
      },
    ],
  },
];

export const CURRENT = UPDATES[0].version;

function compare(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

export function isKnownVersion(v) {
  return v === FIRST || UPDATES.some((u) => u.version === v);
}

export function unseenUpdates(lastSeen, updates = UPDATES) {
  const seen = lastSeen || FIRST;
  return updates.filter((u) => compare(u.version, seen) > 0);
}
