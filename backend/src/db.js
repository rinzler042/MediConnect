'use strict';

/**
 * Almacén en memoria con datos de prueba.
 * En producción se reemplazaría por una base de datos clínica (RF-02, RNF-03).
 */
function crearDb() {
  return {
    usuarios: [
      { id: 'u-rec-1', nombre: 'Carlos Mendoza', correo: 'carlos.mendoza@mediconnect.mx', rol: 'recepcion' },
      { id: 'u-med-1', nombre: 'Dra. Lucía Herrera', correo: 'lucia.herrera@mediconnect.mx', rol: 'medico', medicoId: 'm1' },
      { id: 'u-med-2', nombre: 'Dr. Iván Ortiz', correo: 'ivan.ortiz@mediconnect.mx', rol: 'medico', medicoId: 'm2' },
      { id: 'u-enf-1', nombre: 'Enf. Sofía Ruiz', correo: 'sofia.ruiz@mediconnect.mx', rol: 'enfermero' },
      { id: 'u-pac-1', nombre: 'Ana Gómez', correo: 'ana.gomez@correo.mx', rol: 'paciente', pacienteId: 'p1' },
      { id: 'u-pac-2', nombre: 'Luis Treviño', correo: 'luis.trevino@correo.mx', rol: 'paciente', pacienteId: 'p2' },
      { id: 'u-dir-1', nombre: 'Dirección médica', correo: 'direccion@mediconnect.mx', rol: 'direccion' },
    ],
    medicos: [
      { id: 'm1', nombre: 'Dra. Lucía Herrera', cedulaProfesional: '1234567', especialidad: 'Medicina interna', sede: 'Hospital Central' },
      { id: 'm2', nombre: 'Dr. Iván Ortiz', cedulaProfesional: '7654321', especialidad: 'Pediatría', sede: 'Clínica Norte' },
    ],
    pacientes: [
      { id: 'p1', nombre: 'Ana Gómez', fechaNacimiento: '1990-04-12', alergias: [{ sustancia: 'penicilina', severidad: 'severa' }] },
      { id: 'p2', nombre: 'Luis Treviño', fechaNacimiento: '1978-09-30', alergias: [] },
    ],
    expedientes: [
      { id: 'e1', pacienteId: 'p1', antecedentes: 'Hipertensión en familiares de primer grado.', consultas: [] },
      { id: 'e2', pacienteId: 'p2', antecedentes: '', consultas: [] },
    ],
    medicamentos: [
      { id: 'med-1', nombre: 'Amoxicilina 500 mg', existencia: 40, contraindicaciones: ['penicilina'] },
      { id: 'med-2', nombre: 'Paracetamol 500 mg', existencia: 120, contraindicaciones: [] },
      { id: 'med-3', nombre: 'Losartán 50 mg', existencia: 0, contraindicaciones: [] },
    ],
    citas: [],
    listaEspera: [],
    recetas: [],
    notificaciones: [],
    enlaces: [],
    auditoria: [],
    desafios: [],
    sesiones: new Map(),
    contadores: { cita: 0, consulta: 0, receta: 0 },
  };
}

module.exports = { crearDb };
