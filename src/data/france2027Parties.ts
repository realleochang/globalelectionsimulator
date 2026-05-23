export type Fr2027PartyId =
  | 'LO' | 'NPA' | 'PCF' | 'LFI' | 'D!'
  | 'PS' | 'PP' | 'LE' | 'LC'
  | 'RE' | 'MD' | 'HOR' | 'LFH' | 'BE' | 'NF' | 'NE'
  | 'LR' | 'DIV' | 'DLF' | 'RN' | 'R!';

export type Fr2027Party = {
  id: Fr2027PartyId;
  name: string;
  color: string;
  candidates: string[];
};

export const FR_2027_PARTIES: Fr2027Party[] = [
  { id: 'LO',  name: 'Lutte Ouvrière',                color: '#DD2222', candidates: ['Nathalie Arthaud'] },
  { id: 'NPA', name: 'Nouveau Parti Anticapitaliste',  color: '#8B0000', candidates: ['Philippe Poutou'] },
  { id: 'PCF', name: 'Parti Communiste Français',      color: '#C41E3A', candidates: ['Fabien Roussel'] },
  { id: 'LFI', name: 'La France Insoumise',            color: '#CC2443', candidates: ['Jean-Luc Mélenchon'] },
  { id: 'D!',  name: 'Debout !',                       color: '#E05500', candidates: ['François Ruffin'] },
  { id: 'PS',  name: 'Parti Socialiste',               color: '#E75480', candidates: ['François Hollande', 'Olivier Faure', 'Karim Bouamrane', 'Carole Delga'] },
  { id: 'PP',  name: 'Place Publique',                 color: '#A93226', candidates: ['Raphaël Glucksmann'] },
  { id: 'LE',  name: 'Les Écologistes',                color: '#37A349', candidates: ['Marine Tondelier', 'Yannick Jadot'] },
  { id: 'LC',  name: 'La Convention',                  color: '#6B3FA0', candidates: ['Bernard Cazeneuve'] },
  { id: 'RE',  name: 'Renaissance',                    color: '#FF7900', candidates: ['Gabriel Attal', 'Sébastien Lecornu', 'Gérald Darmanin', 'Aurore Bergé'] },
  { id: 'MD',  name: 'Mouvement Démocrate',            color: '#FF8C00', candidates: ['François Bayrou'] },
  { id: 'HOR', name: 'Horizons',                       color: '#009999', candidates: ['Édouard Philippe'] },
  { id: 'LFH', name: 'La France Hors des Cadres',      color: '#607D8B', candidates: ['Dominique de Villepin'] },
  { id: 'BE',  name: 'Bâtissons ensemble',             color: '#0097A7', candidates: ['Élisabeth Borne'] },
  { id: 'NF',  name: 'Nous France',                    color: '#1565C0', candidates: ['Xavier Bertrand'] },
  { id: 'NE',  name: 'Nouvelle Énergie',               color: '#5C6BC0', candidates: ['David Lisnard'] },
  { id: 'LR',  name: 'Les Républicains',               color: '#0066CC', candidates: ['Bruno Retailleau', 'Laurent Wauquiez', 'François Baroin', 'Michel Barnier'] },
  { id: 'DIV', name: 'Divers',                         color: '#888888', candidates: ['Teddy Riner', 'Cyril Hanouna', 'Patrick Sébastien', 'Michel-Édouard Leclerc', 'Jean Castex', 'Robert Ménard', 'Valérie Pécresse'] },
  { id: 'DLF', name: 'Debout la France',               color: '#2355A0', candidates: ['Nicolas Dupont-Aignan'] },
  { id: 'RN',  name: 'Rassemblement National',         color: '#003189', candidates: ['Jordan Bardella', 'Marine Le Pen'] },
  { id: 'R!',  name: 'Reconquête !',                   color: '#0A0A6E', candidates: ['Éric Zemmour', 'Sarah Knafo', 'Philippe de Villiers'] },
];

export const FR_2027_PARTY_MAP = Object.fromEntries(
  FR_2027_PARTIES.map(p => [p.id, p])
) as Record<Fr2027PartyId, Fr2027Party>;

export const FR_2027_WIKI_TITLES: Record<string, string> = {
  'Nathalie Arthaud':          'Nathalie_Arthaud',
  'Philippe Poutou':           'Philippe_Poutou',
  'Fabien Roussel':            'Fabien_Roussel',
  'Jean-Luc Mélenchon':       'Jean-Luc_Mélenchon',
  'François Ruffin':           'François_Ruffin',
  'Olivier Faure':             'Olivier_Faure',
  'François Hollande':         'François_Hollande',
  'Karim Bouamrane':           'Karim_Bouamrane',
  'Carole Delga':              'Carole_Delga',
  'Raphaël Glucksmann':       'Raphaël_Glucksmann',
  'Marine Tondelier':          'Marine_Tondelier',
  'Yannick Jadot':             'Yannick_Jadot',
  'Bernard Cazeneuve':         'Bernard_Cazeneuve',
  'Gabriel Attal':             'Gabriel_Attal',
  'Gérald Darmanin':          'Gérald_Darmanin',
  'Sébastien Lecornu':        'Sébastien_Lecornu',
  'Aurore Bergé':              'Aurore_Bergé',
  'François Bayrou':           'François_Bayrou',
  'Édouard Philippe':          'Édouard_Philippe',
  'Dominique de Villepin':     'Dominique_de_Villepin',
  'Élisabeth Borne':           'Élisabeth_Borne',
  'Xavier Bertrand':           'Xavier_Bertrand',
  'David Lisnard':             'David_Lisnard',
  'Bruno Retailleau':          'Bruno_Retailleau',
  'Laurent Wauquiez':          'Laurent_Wauquiez',
  'François Baroin':           'François_Baroin',
  'Michel Barnier':            'Michel_Barnier',
  'Cyril Hanouna':             'Cyril_Hanouna',
  'Michel-Édouard Leclerc':   'Michel-Édouard_Leclerc',
  'Teddy Riner':               'Teddy_Riner',
  'Patrick Sébastien':         'Patrick_Sébastien',
  'Jean Castex':               'Jean_Castex',
  'Robert Ménard':             'Robert_Ménard',
  'Valérie Pécresse':          'Valérie_Pécresse',
  'Nicolas Dupont-Aignan':     'Nicolas_Dupont-Aignan',
  'Jordan Bardella':           'Jordan_Bardella',
  'Marine Le Pen':             'Marine_Le_Pen',
  'Philippe de Villiers':      'Philippe_de_Villiers',
  'Sarah Knafo':               'Sarah_Knafo',
  'Éric Zemmour':              'Éric_Zemmour',
};
