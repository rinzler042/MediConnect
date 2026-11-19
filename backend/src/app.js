'use strict';

const express = require('express');
const cors = require('cors');
const { crearDb } = require('./db');
const { HttpError } = require('./errors');
const auth = require('./auth');
const audit = require('./audit');
const citas = require('./services/citas');
const clinico = require('./services/clinico');

/**
 * Crea la aplicación Express. Recibe el almacén para poder probarla con datos aislados.
 */
function createApp(db = crearDb(), { exponerOtp = process.env.DEV_EXPOSE_OTP !== 'false' } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  const autenticar = auth.autenticar(db);
  const dosFactores = [autenticar, auth.requerirDosFactores];
  const soloRol = (...roles) => auth.requerirRol(...roles);

  /* ---------- autenticación ---------- */

  app.post('/api/auth/login', (req, res) => {
    const desafio = auth.iniciarDesafio(db, req.body.correo);
    const respuesta = { desafioId: desafio.id, mensaje: 'Código de verificación enviado' };
    if (exponerOtp) respuesta.codigoDesarrollo = desafio.codigo; // solo desarrollo
    res.status(201).json(respuesta);
  });

  app.post('/api/auth/verificar', (req, res) => {
    const token = auth.verificarDesafio(db, req.body.desafioId, req.body.codigo);
    const sesion = db.sesiones.get(token);
    const usuario = db.usuarios.find((u) => u.id === sesion.usuarioId);
    res.json({ token, usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol } });
  });

  app.get('/api/auth/yo', autenticar, (req, res) => {
    const { id, nombre, rol, medicoId, pacienteId } = req.usuario;
    res.json({ id, nombre, rol, medicoId, pacienteId });
  });

  app.post('/api/auth/salir', autenticar, (req, res) => {
    db.sesiones.delete(req.token);
    res.status(204).end();
  });

  /* ---------- catálogos ---------- */

  app.get('/api/medicos', autenticar, (_req, res) => res.json(db.medicos));

  app.get('/api/pacientes', autenticar, soloRol('recepcion', 'medico', 'enfermero', 'direccion'), (_req, res) => {
    res.json(db.pacientes.map(({ id, nombre, fechaNacimiento }) => ({ id, nombre, fechaNacimiento })));
  });

  app.get('/api/medicamentos', ...dosFactores, (_req, res) => res.json(clinico.listarMedicamentos(db)));

  /* ---------- citas (RF-01, RF-04, RF-05, RN-02) ---------- */

  app.get('/api/citas', autenticar, (req, res) => res.json(citas.listarCitas(db, req.usuario)));

  app.get('/api/citas/disponibilidad', autenticar, (req, res) => {
    res.json({ slots: citas.disponibilidad(db, { medicoId: req.query.medicoId, fecha: req.query.fecha }) });
  });

  app.post('/api/citas', autenticar, (req, res) => {
    res.status(201).json(citas.agendar(db, req.body, req.usuario));
  });

  app.patch('/api/citas/:id/reprogramar', autenticar, (req, res) => {
    res.json(citas.reprogramar(db, req.params.id, req.body.fechaHora, req.usuario));
  });

  app.post('/api/citas/:id/confirmar', autenticar, (req, res) => {
    res.json(citas.confirmar(db, req.params.id, req.usuario));
  });

  app.post('/api/citas/:id/cancelar', autenticar, (req, res) => {
    res.json(citas.cancelar(db, req.params.id, req.usuario));
  });

  app.post('/api/citas/:id/enlace', autenticar, (req, res) => {
    res.status(201).json(citas.generarEnlace(db, req.params.id, req.usuario));
  });

  app.post('/api/citas/procesar-ventanas', autenticar, soloRol('direccion'), (_req, res) => {
    res.json(citas.procesarVentanas(db));
  });

  app.get('/api/notificaciones', autenticar, (req, res) => {
    const visibles = db.notificaciones.filter(
      (n) => req.usuario.rol !== 'paciente' || n.pacienteId === req.usuario.pacienteId,
    );
    res.json(visibles);
  });

  /* ---------- lista de espera ---------- */

  app.get('/api/lista-espera', autenticar, soloRol('recepcion', 'direccion', 'paciente'), (req, res) => {
    const visibles = db.listaEspera.filter((e) => req.usuario.rol !== 'paciente' || e.pacienteId === req.usuario.pacienteId);
    res.json(visibles);
  });

  app.post('/api/lista-espera', autenticar, soloRol('recepcion', 'paciente'), (req, res) => {
    res.status(201).json(citas.agregarListaEspera(db, req.body, req.usuario));
  });

  /* ---------- urgencias (RF-06) ---------- */

  app.post('/api/urgencias', autenticar, soloRol('recepcion'), (req, res) => {
    res.status(201).json(citas.registrarUrgencia(db, req.body, req.usuario));
  });

  /* ---------- expediente y consultas (RF-02, RNF-01, RES-02) ---------- */

  app.get('/api/expedientes/:pacienteId', ...dosFactores, (req, res) => {
    res.json(clinico.obtenerExpediente(db, req.params.pacienteId, req.usuario));
  });

  app.post('/api/expedientes/:pacienteId/consultas', ...dosFactores, (req, res) => {
    res.status(201).json(clinico.registrarConsulta(db, req.params.pacienteId, req.body, req.usuario));
  });

  /* ---------- recetas (RF-03, RN-01) ---------- */

  app.post('/api/recetas', ...dosFactores, (req, res) => {
    res.status(201).json(clinico.emitirReceta(db, req.body, req.usuario));
  });

  /* ---------- auditoría (RNF-03) ---------- */

  app.get('/api/auditoria', autenticar, soloRol('direccion'), (_req, res) => res.json(db.auditoria));

  app.get('/api/auditoria/integridad', autenticar, soloRol('direccion'), (_req, res) => {
    res.json(audit.verificarIntegridad(db));
  });

  /* ---------- manejo de errores ---------- */

  app.use((req, _res, next) => next(new HttpError(404, `Ruta no encontrada: ${req.method} ${req.path}`)));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON inválido' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}

module.exports = { createApp };
