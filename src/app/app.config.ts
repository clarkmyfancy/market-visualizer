import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { SERIES_DATA_PORT_PROVIDERS } from './core/services/adapters/series-data.providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(),
    ...SERIES_DATA_PORT_PROVIDERS,
  ],
};
