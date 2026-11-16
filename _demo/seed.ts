/**
 * The lists a visitor starts with: SomaFM channels, which are https, list
 * three servers each, and let a page read their titles — so the demo shows
 * playback, backups and track titles working without a relay or a now-playing
 * address. Written as the app writes a list, so it reads them as its own.
 */
/** Logo: `api.somafm.com/logos/120/<id>120.<type>`; the file type differs by channel (channels.json's `image`). */
const soma = (id: string, name: string, group: string, logo: 'png' | 'jpg' | 'gif') => {
  const servers = ['ice2', 'ice5', 'ice6'].map((h) => `https://${h}.somafm.com/${id}-128-mp3`)
  return `#EXTINF:-1 tvg-logo="https://api.somafm.com/logos/120/${id}120.${logo}" group-title="${group}" tvg-country="US" ` +
    `radio-homepage="https://somafm.com/${id}/" radio-source="https://somafm.com/${id}.pls" ` +
    `radio-alt="${servers.slice(1).join(' ')}",${name}\n${servers[0]}\n`
}

export const seedFiles: Record<string, string> = {
  'Favourites.m3u8': '#EXTM3U\n' +
    soma('groovesalad', 'Groove Salad', 'Ambient', 'png') +
    soma('dronezone', 'Drone Zone', 'Ambient', 'jpg') +
    soma('secretagent', 'Secret Agent', 'Lounge', 'jpg') +
    soma('indiepop', 'Indie Pop Rocks!', 'Indie', 'jpg') +
    soma('defcon', 'DEF CON Radio', 'Electronic', 'png') +
    soma('lush', 'Lush', 'Electronic', 'jpg'),
  'Space.m3u8': '#EXTM3U\n' +
    soma('deepspaceone', 'Deep Space One', 'Ambient', 'gif') +
    soma('spacestation', 'Space Station Soma', 'Electronic', 'jpg') +
    soma('missioncontrol', 'Mission Control', 'Ambient', 'jpg') +
    soma('fluid', 'Fluid', 'Electronic', 'jpg')
}
