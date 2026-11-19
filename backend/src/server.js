'use strict';

const { crearDb } = require('./db');
const { createApp } = require('./app');
const citas = require('./services/citas');

const PORT = Number(process.env.PORT) || 3000;
const INTERVALO_VENTANAS_MS = Number(process.env.INTERVALO_VENTANAS_MS) || 60_000;

const db = crearDb();
const app = createApp(db);

// Proceso periódico de recordatorios y liberación de cupos (RF-05, RN-02).
const timer = setInterval(() => {
  const r = citas.procesarVentanas(db);
  if (r.recordatorios || r.liberadas) console.log('[ventanas]', r);
}, INTERVALO_VENTANAS_MS);
timer.unref();

app.listen(PORT, () => {
  console.log(`MediConnect Plus API escuchando en http://localhost:${PORT}`);
});
