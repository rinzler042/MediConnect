export type Rol = 'paciente' | 'medico' | 'enfermero' | 'recepcion' | 'direccion';

export interface Usuario {
  id: string;
  nombre: string;
  rol: Rol;
  medicoId?: string;
  pacienteId?: string;
}

export interface Medico {
  id: string;
  nombre: string;
  especialidad: string;
  sede: string;
  cedulaProfesional: string;
}

export interface PacienteResumen {
  id: string;
  nombre: string;
  fechaNacimiento: string;
}

export type Modalidad = 'presencial' | 'virtual';

export interface Cita {
  id: string;
  pacienteId: string;
  medicoId: string | null;
  sede: string;
  modalidad: Modalidad;
  fechaHora: string;
  estado: 'Pendiente' | 'Confirmada' | 'EnAtencion' | 'Completada' | 'Cancelada';
  urgencia: boolean;
  motivo: string | null;
  consultaId: string | null;
}

export interface Medicamento {
  id: string;
  nombre: string;
  existencia: number;
  contraindicaciones: string[];
}

export interface Consulta {
  id: string;
  citaId: string;
  fecha: string;
  signosVitales: Record<string, number>;
  diagnosticoCIE11: string;
  notasEvolucion: string;
  recetaId: string | null;
}

export interface Expediente {
  id: string;
  pacienteId: string;
  antecedentes: string;
  consultas: Consulta[];
  paciente: { id: string; nombre: string; alergias: { sustancia: string; severidad: string }[] };
}

export interface Receta {
  id: string;
  folio: string;
  consultaId: string;
  pacienteId: string;
  medicoId: string;
  items: { medicamentoId: string; nombre: string; cantidad: number }[];
  fechaEmision: string;
}

export interface EntradaAuditoria {
  usuarioId: string;
  accion: string;
  recurso: string;
  ts: string;
  hash: string;
  detalle?: Record<string, unknown>;
}

/** Cuerpo de error que devuelve la API (incluye alertas de RN-01 o faltantes de stock). */
export interface ErrorApi {
  error: string;
  alertas?: { medicamento: string; alergia: string }[];
  faltantes?: string[];
  errores?: string[];
}
