/**
 * The lists a visitor starts with: SomaFM channels, which are https, list
 * three servers each, and let a page read their titles — so the demo shows
 * playback, backups and track titles working without a relay or a now-playing
 * address. Written as the app writes a list, so it reads them as its own.
 */
const soma = (id: string, name: string, group: string) => {
  const servers = ['ice2', 'ice5', 'ice6'].map((h) => `https://${h}.somafm.com/${id}-128-mp3`)
  return `#EXTINF:-1 tvg-logo="https://somafm.com/img/${id}120.png" group-title="${group}" tvg-country="US" ` +
    `radio-homepage="https://somafm.com/${id}/" radio-source="https://somafm.com/${id}.pls" ` +
    `radio-alt="${servers.slice(1).join(' ')}",${name}\n${servers[0]}\n`
}

export const seedFiles: Record<string, string> = {
  'Favourites.m3u8': '#EXTM3U\n' +
    soma('groovesalad', 'Groove Salad', 'Ambient') +
    soma('dronezone', 'Drone Zone', 'Ambient') +
    soma('secretagent', 'Secret Agent', 'Lounge') +
    soma('indiepop', 'Indie Pop Rocks!', 'Indie') +
    soma('defcon', 'DEF CON Radio', 'Electronic') +
    soma('lush', 'Lush', 'Electronic'),
  'Space.m3u8': '#EXTM3U\n' +
    soma('deepspaceone', 'Deep Space One', 'Ambient') +
    soma('spacestation', 'Space Station Soma', 'Electronic') +
    soma('missioncontrol', 'Mission Control', 'Ambient') +
    soma('fluid', 'Fluid', 'Electronic')
}
