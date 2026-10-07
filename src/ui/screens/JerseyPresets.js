const TEAM_JERSEYS = [
  { id: 'galatasaray', name: 'Galatasaray', angle: 0, avatarColor: 'FFFFFF', colors: ['F28C28', '8A1538'], flag: '/assets/tr.png' },
  { id: 'fenerbahce', name: 'Fenerbahçe', angle: 0, avatarColor: 'FFFFFF', colors: ['FFC900', '002D72', 'FFC900'], flag: '/assets/tr.png' },
  { id: 'besiktas', name: 'Beşiktaş', angle: 0, avatarColor: '111111', colors: ['FFFFFF'], flag: '/assets/tr.png' },
  { id: 'trabzonspor', name: 'Trabzonspor', angle: 0, avatarColor: 'FFFFFF', colors: ['7A1731', '2A9FD6', '7A1731'], flag: '/assets/tr.png' },
  { id: 'rizespor', name: 'Rizespor', angle: 0, avatarColor: 'FFFFFF', colors: ['13107A', '00945F', '13107A'], flag: '/assets/tr.png' },
  { id: 'real-madrid', name: 'Real Madrid', angle: 0, avatarColor: '143832', colors: ['FFFFFF'], flag: '/assets/es.png' },
  { id: 'barcelona', name: 'Barcelona', angle: 0, avatarColor: 'FFCF30', colors: ['2C3F83', '781028'], flag: '/assets/es.png' },
  { id: 'atletico-madrid', name: 'Atlético Madrid', angle: 0, avatarColor: '0f5ac5', colors: ['FFFFFF', 'D40424', 'FFFFFF'], flag: '/assets/es.png' },
  { id: 'manchester-united', name: 'Manchester United', angle: 0, avatarColor: 'FFFFFF', colors: ['DA291C'], flag: '/assets/uk.png' },
  { id: 'manchester-city', name: 'Manchester City', angle: 0, avatarColor: 'FFFFFF', colors: ['6CABDD'], flag: '/assets/uk.png' },
  { id: 'liverpool', name: 'Liverpool', angle: 0, avatarColor: 'FFFFFF', colors: ['DA291C'], flag: '/assets/uk.png' },
  { id: 'arsenal', name: 'Arsenal', angle: 0, avatarColor: 'FFFFFF', colors: ['DA291C'], flag: '/assets/uk.png' },
  { id: 'chelsea', name: 'Chelsea', angle: 0, avatarColor: 'eecc1d', colors: ['034694'], flag: '/assets/uk.png' },
  { id: 'aston-villa', name: 'Aston Villa', angle: 0, avatarColor: 'bbd2f2', colors: ['6E303F'], flag: '/assets/uk.png' },
  { id: 'juventus', name: 'Juventus', angle: 0, avatarColor: 'd4be88', colors: ['000000', 'FFFFFF', '000000'], flag: '/assets/it.png' },
  { id: 'inter-milan', name: 'Inter Milan', angle: 0, avatarColor: 'f0ba56', colors: ['0068A8', '000000', '0068A8'], flag: '/assets/it.png' },
  { id: 'ac-milan', name: 'AC Milan', angle: 0, avatarColor: 'FFFFFF', colors: ['000000', 'AC1F2D', '000000'], flag: '/assets/it.png' },
  { id: 'bayern-munich', name: 'Bayern Munich', angle: 0, avatarColor: 'FFFFFF', colors: ['DC052D'], flag: '/assets/de.png' },
  { id: 'borussia-dortmund', name: 'Borussia Dortmund', angle: 0, avatarColor: '000000', colors: ['FDE100'], flag: '/assets/de.png' },
  { id: 'paris-saint-germain', name: 'Paris Saint-Germain', angle: 0, avatarColor: 'FFFFFF', colors: ['002A8A', 'DC0B28', '002A8A'], flag: '/assets/fr.png' },
  { id: 'turkiye', name: 'Türkiye', angle: 0, avatarColor: 'FFFFFF', colors: ['D0021B'], flag: '/assets/globe.png' },
  { id: 'argentina', name: 'Arjantin', angle: 0, avatarColor: '000000', colors: ['75AADB', 'FFFFFF', '75AADB'], flag: '/assets/globe.png' },
  { id: 'spain', name: 'İspanya', angle: 0, avatarColor: 'F1BF00', colors: ['AA151B'], flag: '/assets/globe.png' },
  { id: 'france', name: 'Fransa', angle: 0, avatarColor: 'FFFFFF', colors: ['243567'], flag: '/assets/globe.png' },
  { id: 'england', name: 'İngiltere', angle: 0, avatarColor: '000000', colors: ['DEE2E5'], flag: '/assets/globe.png' },
  { id: 'italy', name: 'İtalya', angle: 0, avatarColor: 'FFFFFF', colors: ['0067B1'], flag: '/assets/globe.png' },
  { id: 'portugal', name: 'Portekiz', angle: 0, avatarColor: 'FFFFFF', colors: ['9D2639'], flag: '/assets/globe.png' },
  { id: 'brazil', name: 'Brezilya', angle: 0, avatarColor: '0f4a36', colors: ['EED04B'], flag: '/assets/globe.png' },
  { id: 'germany', name: 'Almanya', angle: 90, avatarColor: 'FFFFFF', colors: ['000000', 'DD0000', 'FFCE00'], flag: '/assets/globe.png' }
];

export const JERSEY_PRESETS = [
  { id: 'random', name: 'Rastgele', angle: 0, avatarColor: 'FFFFFF', colors: [], flag: null },
  ...TEAM_JERSEYS
];

export function pickRandomJersey(excludeId = null) {
  const choices = TEAM_JERSEYS.filter(jersey => jersey.id !== excludeId);
  return choices[Math.floor(Math.random() * choices.length)] || TEAM_JERSEYS[0];
}
