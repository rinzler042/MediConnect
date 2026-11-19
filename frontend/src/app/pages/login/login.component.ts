import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ErrorApi } from '../../core/models';

/** Inicio de sesión con segundo factor (RNF-01): correo → código OTP. */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="card login">
      <h2>Iniciar sesión</h2>
      <p class="muted">Acceso con autenticación de dos factores.</p>

      @if (error()) { <p class="error">{{ error() }}</p> }

      @if (paso() === 1) {
        <form (ngSubmit)="enviarCorreo()">
          <label>Correo institucional
            <input type="email" name="correo" [(ngModel)]="correo" required>
          </label>
          <button type="submit" [disabled]="cargando()">Enviar código</button>
        </form>
      } @else {
        <form (ngSubmit)="verificarCodigo()">
          <label>Código de 6 dígitos
            <input name="codigo" inputmode="numeric" maxlength="6" [(ngModel)]="codigo" required>
          </label>
          @if (codigoDesarrollo()) {
            <p class="hint">Modo desarrollo: código <strong>{{ codigoDesarrollo() }}</strong></p>
          }
          <button type="submit" [disabled]="cargando()">Verificar</button>
          <button type="button" class="secundario" (click)="paso.set(1)">Cambiar correo</button>
        </form>
      }
    </section>
  `,
  styles: `
    .login { max-width: 420px; margin: 3rem auto; }
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly paso = signal<1 | 2>(1);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly codigoDesarrollo = signal<string | null>(null);

  correo = '';
  codigo = '';
  private desafioId = '';

  enviarCorreo(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.auth.iniciar(this.correo.trim().toLowerCase()).subscribe({
      next: (r) => {
        this.desafioId = r.desafioId;
        this.codigoDesarrollo.set(r.codigoDesarrollo ?? null);
        this.paso.set(2);
        this.cargando.set(false);
      },
      error: (e) => this.fallo(e.error as ErrorApi),
    });
  }

  verificarCodigo(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.auth.verificar(this.desafioId, this.codigo.trim()).subscribe({
      next: () => this.router.navigateByUrl('/citas'),
      error: (e) => this.fallo(e.error as ErrorApi),
    });
  }

  private fallo(e: ErrorApi): void {
    this.error.set(e?.error ?? 'No fue posible completar la operación');
    this.cargando.set(false);
  }
}
