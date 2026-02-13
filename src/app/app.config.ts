import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // We don't have routes defined yet, but this keeps the structure ready for Day 3
    provideRouter([]),
    provideHttpClient(),
  ]
};
