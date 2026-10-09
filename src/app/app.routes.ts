import { Routes } from '@angular/router';
import { SchoolMap } from './school-map/school-map';

export const routes: Routes = [
  { path: '', component: SchoolMap, title: 'School Map' },
  { path: '**', redirectTo: '' },
];
