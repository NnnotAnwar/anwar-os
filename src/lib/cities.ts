// A small built-in list for "Sunset to sunrise": the place is picked here (or
// typed as coordinates, or read once from the device), never looked up on a
// third-party service. One decimal (~10 km) is plenty for sunset times.

export type City = { name: string; lat: number; lon: number }

export const CITIES: readonly City[] = [
  // Czechia
  { name: "Prague", lat: 50.1, lon: 14.4 },
  { name: "Brno", lat: 49.2, lon: 16.6 },
  { name: "Ostrava", lat: 49.8, lon: 18.3 },
  { name: "Plzeň", lat: 49.7, lon: 13.4 },
  { name: "Liberec", lat: 50.8, lon: 15.1 },
  { name: "Olomouc", lat: 49.6, lon: 17.3 },
  { name: "České Budějovice", lat: 49.0, lon: 14.5 },
  { name: "Hradec Králové", lat: 50.2, lon: 15.8 },
  { name: "Pardubice", lat: 50.0, lon: 15.8 },
  { name: "Karlovy Vary", lat: 50.2, lon: 12.9 },
  // Kazakhstan and Central Asia
  { name: "Almaty", lat: 43.2, lon: 76.9 },
  { name: "Astana", lat: 51.2, lon: 71.4 },
  { name: "Shymkent", lat: 42.3, lon: 69.6 },
  { name: "Karaganda", lat: 49.8, lon: 73.1 },
  { name: "Aktobe", lat: 50.3, lon: 57.2 },
  { name: "Atyrau", lat: 47.1, lon: 51.9 },
  { name: "Aktau", lat: 43.7, lon: 51.2 },
  { name: "Oskemen", lat: 50.0, lon: 82.6 },
  { name: "Pavlodar", lat: 52.3, lon: 77.0 },
  { name: "Kostanay", lat: 53.2, lon: 63.6 },
  { name: "Taraz", lat: 42.9, lon: 71.4 },
  { name: "Kyzylorda", lat: 44.8, lon: 65.5 },
  { name: "Turkistan", lat: 43.3, lon: 68.3 },
  { name: "Tashkent", lat: 41.3, lon: 69.3 },
  { name: "Bishkek", lat: 42.9, lon: 74.6 },
  { name: "Dushanbe", lat: 38.6, lon: 68.8 },
  { name: "Ashgabat", lat: 37.9, lon: 58.4 },
  { name: "Baku", lat: 40.4, lon: 49.9 },
  { name: "Tbilisi", lat: 41.7, lon: 44.8 },
  { name: "Yerevan", lat: 40.2, lon: 44.5 },
  // Russia, Ukraine, Belarus
  { name: "Moscow", lat: 55.8, lon: 37.6 },
  { name: "Saint Petersburg", lat: 59.9, lon: 30.3 },
  { name: "Novosibirsk", lat: 55.0, lon: 82.9 },
  { name: "Yekaterinburg", lat: 56.8, lon: 60.6 },
  { name: "Kazan", lat: 55.8, lon: 49.1 },
  { name: "Omsk", lat: 55.0, lon: 73.4 },
  { name: "Kyiv", lat: 50.5, lon: 30.5 },
  { name: "Minsk", lat: 53.9, lon: 27.6 },
  // Europe
  { name: "Vienna", lat: 48.2, lon: 16.4 },
  { name: "Bratislava", lat: 48.1, lon: 17.1 },
  { name: "Berlin", lat: 52.5, lon: 13.4 },
  { name: "Munich", lat: 48.1, lon: 11.6 },
  { name: "Dresden", lat: 51.1, lon: 13.7 },
  { name: "Warsaw", lat: 52.2, lon: 21.0 },
  { name: "Kraków", lat: 50.1, lon: 19.9 },
  { name: "Budapest", lat: 47.5, lon: 19.0 },
  { name: "Ljubljana", lat: 46.1, lon: 14.5 },
  { name: "Zagreb", lat: 45.8, lon: 16.0 },
  { name: "Belgrade", lat: 44.8, lon: 20.5 },
  { name: "Bucharest", lat: 44.4, lon: 26.1 },
  { name: "Sofia", lat: 42.7, lon: 23.3 },
  { name: "Athens", lat: 38.0, lon: 23.7 },
  { name: "Istanbul", lat: 41.0, lon: 29.0 },
  { name: "Rome", lat: 41.9, lon: 12.5 },
  { name: "Milan", lat: 45.5, lon: 9.2 },
  { name: "Zurich", lat: 47.4, lon: 8.5 },
  { name: "Paris", lat: 48.9, lon: 2.4 },
  { name: "Brussels", lat: 50.8, lon: 4.4 },
  { name: "Amsterdam", lat: 52.4, lon: 4.9 },
  { name: "London", lat: 51.5, lon: -0.1 },
  { name: "Dublin", lat: 53.3, lon: -6.3 },
  { name: "Madrid", lat: 40.4, lon: -3.7 },
  { name: "Barcelona", lat: 41.4, lon: 2.2 },
  { name: "Lisbon", lat: 38.7, lon: -9.1 },
  { name: "Copenhagen", lat: 55.7, lon: 12.6 },
  { name: "Oslo", lat: 59.9, lon: 10.8 },
  { name: "Stockholm", lat: 59.3, lon: 18.1 },
  { name: "Helsinki", lat: 60.2, lon: 24.9 },
  { name: "Tallinn", lat: 59.4, lon: 24.8 },
  { name: "Riga", lat: 56.9, lon: 24.1 },
  { name: "Vilnius", lat: 54.7, lon: 25.3 },
  { name: "Reykjavík", lat: 64.1, lon: -21.9 },
  { name: "Tromsø", lat: 69.6, lon: 19.0 },
  // Elsewhere
  { name: "Dubai", lat: 25.2, lon: 55.3 },
  { name: "Tel Aviv", lat: 32.1, lon: 34.8 },
  { name: "Cairo", lat: 30.0, lon: 31.2 },
  { name: "Delhi", lat: 28.6, lon: 77.2 },
  { name: "Mumbai", lat: 19.1, lon: 72.9 },
  { name: "Bangkok", lat: 13.8, lon: 100.5 },
  { name: "Singapore", lat: 1.4, lon: 103.8 },
  { name: "Seoul", lat: 37.6, lon: 127.0 },
  { name: "Tokyo", lat: 35.7, lon: 139.7 },
  { name: "Beijing", lat: 39.9, lon: 116.4 },
  { name: "Shanghai", lat: 31.2, lon: 121.5 },
  { name: "Sydney", lat: -33.9, lon: 151.2 },
  { name: "Cape Town", lat: -33.9, lon: 18.4 },
  { name: "New York", lat: 40.7, lon: -74.0 },
  { name: "Toronto", lat: 43.7, lon: -79.4 },
  { name: "Chicago", lat: 41.9, lon: -87.6 },
  { name: "San Francisco", lat: 37.8, lon: -122.4 },
  { name: "Los Angeles", lat: 34.1, lon: -118.2 },
  { name: "Mexico City", lat: 19.4, lon: -99.1 },
  { name: "São Paulo", lat: -23.6, lon: -46.6 },
  { name: "Buenos Aires", lat: -34.6, lon: -58.4 },
]

function fold(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase()
}

/** Exact name, case- and accent-insensitive ("plzen" finds Plzeň). */
export function findCity(name: string): City | undefined {
  const wanted = fold(name)
  return wanted ? CITIES.find((c) => fold(c.name) === wanted) : undefined
}

/** "50.1, 14.4" or "50.1 14.4" → a place; null when it isn't a coordinate pair. */
export function parseCoordinates(text: string): { lat: number; lon: number } | null {
  const match = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!match) return null
  const lat = Number(match[1])
  const lon = Number(match[2])
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}
