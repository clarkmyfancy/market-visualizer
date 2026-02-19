import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';

import { AppComponent } from './app.component';
import { SERIES_DATA_PORT_PROVIDERS } from './core/services/adapters/series-data.providers';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), ...SERIES_DATA_PORT_PROVIDERS],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render dashboard shell', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement;
    expect(compiled.querySelector('app-dashboard')).not.toBeNull();
  });
});
