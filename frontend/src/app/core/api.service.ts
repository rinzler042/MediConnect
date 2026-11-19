import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from './config';
import {
  Cita,
  EntradaAuditoria,
  Expediente,
  Medicamento,
  Medico,
  PacienteResumen,
  Usuario,
  Consulta,
  Receta,
} from './models';

export interface LoginRespuesta {
  desafioId: string;
  codigoDesarrollo?: string;
  mensaje: string;
}

export interface SesionRespuesta {
  token: string;
  usuario: Pick<Usuario, 'id' | 'nombre' | 'rol'>;
}

export interface NuevaCita {
  pacienteId?: string;
  medicoId: string;
  modalidad: 'presencial' | 'virtual';
  fechaHora: string;
}

export interface NuevaConsulta {
  citaId: string;
  signosVitales: Record<string, number>;
  diagnosticoCIE11: string;
  notasEvolucion: string;
}

export interface NuevaReceta {
  consultaId: string;
  items: { medicamentoId: string; cantidad: number }[];
}

/**
 * Cliente HTTP tipado de la API. El token se agrega en authInterceptor.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  // Autenticación
  login(correo: string): Observable<LoginRespuesta> {
    return this.http.post<LoginRespuesta>(`${API_URL}/auth/login`, { correo });
  }
  verificar(desafioId: string, codigo: string): Observable<SesionRespuesta> {
    return this.http.post<SesionRespuesta>(`${API_URL}/auth/verificar`, { desafioId, codigo });
  }
  salir(): Observable<void> {
    return this.http.post<void>(`${API_URL}/auth/salir`, {});
  }

  // Catálogos
  medicos(): Observable<Medico[]> {
    return this.http.get<Medico[]>(`${API_URL}/medicos`);
  }
  pacientes(): Observable<PacienteResumen[]> {
    return this.http.get<PacienteResumen[]>(`${API_URL}/pacientes`);
  }
  medicamentos(): Observable<Medicamento[]> {
    return this.http.get<Medicamento[]>(`${API_URL}/medicamentos`);
  }

  // Citas (RF-01, RF-04, RF-05)
  citas(): Observable<Cita[]> {
    return this.http.get<Cita[]>(`${API_URL}/citas`);
  }
  disponibilidad(medicoId: string, fecha: string): Observable<{ slots: string[] }> {
    const params = new HttpParams().set('medicoId', medicoId).set('fecha', fecha);
    return this.http.get<{ slots: string[] }>(`${API_URL}/citas/disponibilidad`, { params });
  }
  agendar(cita: NuevaCita): Observable<Cita> {
    return this.http.post<Cita>(`${API_URL}/citas`, cita);
  }
  confirmar(id: string): Observable<Cita> {
    return this.http.post<Cita>(`${API_URL}/citas/${id}/confirmar`, {});
  }
  cancelar(id: string): Observable<Cita> {
    return this.http.post<Cita>(`${API_URL}/citas/${id}/cancelar`, {});
  }
  enlaceTeleconsulta(id: string): Observable<{ url: string; expira: number }> {
    return this.http.post<{ url: string; expira: number }>(`${API_URL}/citas/${id}/enlace`, {});
  }
  ventanas(): Observable<{ recordatorios: number; liberadas: number }> {
    return this.http.post<{ recordatorios: number; liberadas: number }>(`${API_URL}/citas/procesar-ventanas`, {});
  }

  // Urgencias (RF-06)
  registrarUrgencia(body: { pacienteId: string; medicoId?: string; motivo: string }): Observable<Cita> {
    return this.http.post<Cita>(`${API_URL}/urgencias`, body);
  }

  // Expediente (RF-02, RNF-01)
  expediente(pacienteId: string): Observable<Expediente> {
    return this.http.get<Expediente>(`${API_URL}/expedientes/${pacienteId}`);
  }
  registrarConsulta(pacienteId: string, body: NuevaConsulta): Observable<Consulta> {
    return this.http.post<Consulta>(`${API_URL}/expedientes/${pacienteId}/consultas`, body);
  }

  // Recetas (RF-03, RN-01)
  emitirReceta(body: NuevaReceta): Observable<Receta> {
    return this.http.post<Receta>(`${API_URL}/recetas`, body);
  }

  // Auditoría (RNF-03)
  auditoria(): Observable<EntradaAuditoria[]> {
    return this.http.get<EntradaAuditoria[]>(`${API_URL}/auditoria`);
  }
  integridad(): Observable<{ valida: boolean; total: number; indiceAlterado?: number }> {
    return this.http.get<{ valida: boolean; total: number; indiceAlterado?: number }>(`${API_URL}/auditoria/integridad`);
  }
}
