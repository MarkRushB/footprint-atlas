import { readFile, writeFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../public/footprints.json', import.meta.url), 'utf8'));
const places = (data.visitPlaces || []).filter(place => place.address && !place.isDeleted);
const states = new Map(Object.entries({ AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia' }));
const countryAliases = new Map([['United States','United States of America']]);
const counts = { countries:new Map(), regions:new Map(), cities:new Map() };
const add = (map, value, weight) => value && map.set(value, (map.get(value) || 0) + weight);
const street = /^(?:\d+|route\b|highway\b|street\b|avenue\b|road\b)/i;

for (const place of places) {
  const parts = place.address.split('|').map(value => value.trim()).filter(Boolean);
  const tail = parts.at(-1) || '';
  const geo = tail.split('·').map(value => value.trim());
  const country = countryAliases.get(geo.at(-1)) || geo.at(-1);
  const weight = Math.max(1, Number(place.visitCount) || 1);
  add(counts.countries, country, weight);

  let region = geo.length > 1 ? geo[0] : '';
  if (!region && country === 'United States of America') {
    const match = place.address.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/);
    region = match ? states.get(match[1]) || match[1] : '';
  }
  add(counts.regions, region, weight);

  const beforeTail = parts.slice(0, -1);
  let city = beforeTail.at(-1) || '';
  city = city.replace(/,?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?\b.*$/, '').replace(/\s+\d{4,6}\b.*$/, '').trim();
  if (street.test(city) || city.length > 45) city = '';
  if (!city && ['Bogotá','Callao','La Paz'].includes(region)) city = region;
  add(counts.cities, city, weight);
}

const sorted = map => [...map].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).map(([name, visits]) => ({ name, visits }));
const result = {
  sourcePlaces: places.length,
  countries: sorted(counts.countries),
  regions: sorted(counts.regions),
  cities: sorted(counts.cities),
};
await writeFile(new URL('../public/place-stats.json', import.meta.url), JSON.stringify(result));
console.log(JSON.stringify({ sourcePlaces: result.sourcePlaces, countries: result.countries.length, regions: result.regions.length, cities: result.cities.length }));
