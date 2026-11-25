function showReport() {
  return fetch(SHOP_API + '/api/reports/daily').then((answer) => answer.json());
}

function showStock() {
  return fetch(SHOP_API + '/api/stock').then((answer) => answer.json());
}

/** The kiosk's screens, a record keyed by the name a button carries. */
const SCREENS = {
  report: { title: 'Today', open: showReport },
  stock: { title: 'Stock', open: showStock },
};

function openScreen(name) {
  const screen = SCREENS[name];
  if (screen) return screen.open();
  return undefined;
}

document.querySelector('#screens').addEventListener('click', (event) => openScreen(event.target.dataset.screen));
