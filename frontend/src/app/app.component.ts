import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="barra">
      <div class="marca">MediConnect Plus</div>
      @if (auth.usuario(); as u) {
        <nav>
          <a routerLink="/citas" routerLinkActive="activa">Citas</a>
          @if (auth.tieneRol('recepcion')) { <a routerLink="/urgencias" routerLinkActive="activa">Urgencias</a> }
          @if (auth.tieneRol('medico', 'enfermero')) { <a routerLink="/expedientes/p1" routerLinkActive="activa">Expedientes</a> }
          @if (auth.tieneRol('direccion')) { <a routerLink="/auditoria" routerLinkActive="activa">Auditoría</a> }
        </nav>
        <div class="sesion">
          <span>{{ u.nombre }} <small>({{ u.rol }})</small></span>
          <button class="secundario" (click)="auth.salir()">Salir</button>
        </div>
      }
    </header>
    <main>
      <router-outlet />
    </main>
  `,
})
export class AppComponent {
  readonly auth = inject(AuthService);
}
