import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Cita, ErrorApi, Medico, PacienteResumen } from '../../core/models';

/**
 * Gestión de citas: agendar según disponibilidad (RF-01), confirmar y cancelar (RF-05, RN-02),
 * y acceder a la teleconsulta (RF-04).
 */
@Component({
  selector: 'app-citas',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <h2>Citas</h2>

    @if (mensaje()) { <p class="ok">{{ mensaje() }}</p> }
    @if (error()) { <p class="error">{{ error() }}</p> }

    @if (puedeAgendar()) {
      <section class="card">
        <h3>Agendar cita</h3>
        <div class="grid">
          @if (auth.tieneRol('recepcion')) {
            <label>Paciente
              <select [(ngModel)]="pacienteId">
                @for (p of pacientes(); track p.id) { <option [value]="p.id">{{ p.nombre }}</option> }
              </select>
            </label>
          }
          <label>Médico
            <select [(ngModel)]="medicoId" (ngModelChange)="cargarHorarios()">
              @for (m of medicos(); track m.id) { <option [value]="m.id">{{ m.nombre }} · {{ m.sede }}</option> }
            </select>
          </label>
          <label>Fecha
            <input type="date" [(ngModel)]="fecha" (ngModelChange)="cargarHorarios()">
          </label>
          <label>Modalidad
            <select [(ngModel)]="modalidad">
              <option value="presencial">Presencial</option>
              <option value="virtual">Virtual</option>
            </select>
          </label>
        </div>

        <p class="muted">Horarios disponibles (hora de Ciudad de México). Se requieren al menos 18 horas de anticipación.</p>
        <div class="slots">
          @for (s of horarios(); track s) {
            <button type="button" (click)="agendar(s)">{{ s | date: 'HH:mm' : '-0600' }}</button>
          } @empty {
            <span class="muted">Sin horarios disponibles para esa fecha.</span>
          }
        </div>
      </section>
    }

    <section class="card">
      <h3>Mis citas</h3>
      @if (citas().length === 0) {
        <p class="muted">No hay citas registradas.</p>
      } @else {
        <table>
          <thead>
            <tr><th>Fecha y hora</th><th>Médico</th><th>Modalidad</th><th>Estado</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            @for (c of citas(); track c.id) {
              <tr>
                <td>{{ c.fechaHora | date: 'dd/MM/yyyy HH:mm' : '-0600' }}</td>
                <td>{{ nombreMedico(c.medicoId) }}</td>
                <td>{{ c.modalidad }}</td>
                <td><span class="tag estado-{{ c.estado }}">{{ c.estado }}</span></td>
                <td class="acciones">
                  @if (c.estado === 'Pendiente' && (auth.tieneRol('paciente', 'recepcion'))) {
                    <button (click)="confirmar(c)">Confirmar</button>
                  }
                  @if (c.estado === 'Pendiente' || c.estado === 'Confirmada') {
                    <button class="peligro" (click)="cancelar(c)">Cancelar</button>
                  }
                  @if (c.modalidad === 'virtual' && c.estado !== 'Cancelada' && auth.tieneRol('paciente', 'medico')) {
                    <button class="secundario" (click)="enlace(c)">Teleconsulta</button>
                  }
                  @if (c.consultaId) { <a [routerLink]="['/expedientes', c.pacienteId]">Expediente</a> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      @if (enlaceUrl()) { <p class="hint">Enlace seguro: <code>{{ enlaceUrl() }}</code></p> }
    </section>

    @if (auth.tieneRol('recepcion')) {
      <p><a routerLink="/urgencias">Registrar urgencia sin cita →</a></p>
    }
  `,
})
export class CitasComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);

  readonly citas = signal<Cita[]>([]);
  readonly medicos = signal<Medico[]>([]);
  readonly pacientes = signal<PacienteResumen[]>([]);
  readonly horarios = signal<string[]>([]);
  readonly mensaje = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly enlaceUrl = signal<string | null>(null);

  readonly puedeAgendar = computed(() => this.auth.tieneRol('paciente', 'recepcion'));

  medicoId = '';
  pacienteId = '';
  modalidad: 'presencial' | 'virtual' = 'presencial';
  fecha = new Date().toISOString().slice(0, 10);

  ngOnInit(): void {
    this.api.medicos().subscribe((m) => {
      this.medicos.set(m);
      this.medicoId = m[0]?.id ?? '';
      this.cargarHorarios();
    });
    if (this.auth.tieneRol('recepcion')) {
      this.api.pacientes().subscribe((p) => {
        this.pacientes.set(p);
        this.pacienteId = p[0]?.id ?? '';
      });
    }
    this.recargar();
  }

  cargarHorarios(): void {
    if (!this.medicoId || !this.fecha) return;
    this.api.disponibilidad(this.medicoId, this.fecha).subscribe({
      next: (r) => this.horarios.set(r.slots),
      error: (e) => this.mostrarError(e),
    });
  }

  agendar(fechaHora: string): void {
    this.limpiarAvisos();
    this.api.agendar({
      pacienteId: this.pacienteId || undefined,
      medicoId: this.medicoId,
      modalidad: this.modalidad,
      fechaHora,
    }).subscribe({
      next: () => {
        this.mensaje.set('Cita agendada.');
        this.recargar();
        this.cargarHorarios();
      },
      error: (e) => this.mostrarError(e),
    });
  }

  confirmar(c: Cita): void {
    this.limpiarAvisos();
    this.api.confirmar(c.id).subscribe({
      next: () => { this.mensaje.set('Cita confirmada.'); this.recargar(); },
      error: (e) => this.mostrarError(e),
    });
  }

  cancelar(c: Cita): void {
    this.limpiarAvisos();
    this.api.cancelar(c.id).subscribe({
      next: () => { this.mensaje.set('Cita cancelada. El cupo se ofreció a la lista de espera.'); this.recargar(); },
      error: (e) => this.mostrarError(e),
    });
  }

  enlace(c: Cita): void {
    this.limpiarAvisos();
    this.api.enlaceTeleconsulta(c.id).subscribe({
      next: (r) => this.enlaceUrl.set(r.url),
      error: (e) => this.mostrarError(e),
    });
  }

  nombreMedico(id: string | null): string {
    return this.medicos().find((m) => m.id === id)?.nombre ?? '—';
  }

  private recargar(): void {
    this.api.citas().subscribe((c) => this.citas.set(c));
  }

  private limpiarAvisos(): void {
    this.mensaje.set(null);
    this.error.set(null);
    this.enlaceUrl.set(null);
  }

  private mostrarError(e: { error: ErrorApi }): void {
    this.error.set(e.error?.error ?? 'Ocurrió un error');
  }
}
