// Mirrors internal/delivery/geo_data.go on the backend — keep both in sync.
// Ghana is the only country with region-level (state) resolution for now;
// the rest fall back to a plain freeform region/city text field.

export interface AfricanCountry {
  name: string;
  iso2: string;
}

export const AFRICAN_COUNTRIES: AfricanCountry[] = [
  { name: 'Ghana', iso2: 'GH' },
  { name: 'Togo', iso2: 'TG' },
  { name: "Côte d'Ivoire", iso2: 'CI' },
  { name: 'Burkina Faso', iso2: 'BF' },
  { name: 'Benin', iso2: 'BJ' },
  { name: 'Nigeria', iso2: 'NG' },
  { name: 'Senegal', iso2: 'SN' },
  { name: 'Cameroon', iso2: 'CM' },
  { name: 'Kenya', iso2: 'KE' },
  { name: 'South Africa', iso2: 'ZA' },
];

// Ghana's 16 current administrative regions (post-2019 split).
export const GHANA_REGIONS: string[] = [
  'Greater Accra',
  'Ashanti',
  'Western',
  'Western North',
  'Central',
  'Eastern',
  'Volta',
  'Oti',
  'Bono',
  'Bono East',
  'Ahafo',
  'Northern',
  'Savannah',
  'North East',
  'Upper East',
  'Upper West',
];
