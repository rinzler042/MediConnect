import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent) },
  {
    path: 'citas',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/citas/citas.component').then((m) => m.CitasComponent),
  },
  {
    path: 'urgencias',
    canActivate: [authGuard],
    data: { roles: ['recepcion'] },
    loadComponent: () => import('./pages/urgencias/urgencias.component').then((m) => m.UrgenciasComponent),
  },
  {
    path: 'expedientes/:pacienteId',
    canActivate: [authGuard],
    data: { roles: ['medico', 'enfermero', 'paciente'] },
    loadComponent: () => import('./pages/expediente/expediente.component').then((m) => m.ExpedienteComponent),
  },
  {
    path: 'auditoria',
    canActivate: [authGuard],
    data: { roles: ['direccion'] },
    loadComponent: () => import('./pages/auditoria/auditoria.component').then((m) => m.AuditoriaComponent),
  },
  { path: '', pathMatch: 'full', redirectTo: 'citas' },
  { path: '**', redirectTo: 'citas' },
];
