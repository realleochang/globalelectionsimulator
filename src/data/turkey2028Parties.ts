// Parties for the projected next (2028) Turkish presidential election.
// Turkey elects its president by direct national popular vote (two rounds).
// Each party offers one or more plausible candidates the player can choose from.
// Ordered left → right by ideology.
export type Tr2028PartyId =
  | 'TIP' | 'DEM' | 'CHP' | 'MEM' | 'DEVA' | 'GEL'
  | 'SAA' | 'IYI' | 'AKP' | 'YRP' | 'MHP' | 'ZAF';

export type Tr2028Party = {
  id: Tr2028PartyId;
  name: string;
  color: string;
  candidates: string[];
};

export const TR_2028_PARTIES: Tr2028Party[] = [
  { id: 'TIP',  name: 'Türkiye İşçi Partisi',           color: '#D81B60', candidates: ['Erkan Baş'] },
  { id: 'DEM',  name: 'Halkların Eşitlik ve Demokrasi',  color: '#6A1B9A', candidates: ['Tuncer Bakırhan', 'Tülay Hatimoğulları'] },
  { id: 'CHP',  name: 'Cumhuriyet Halk Partisi',         color: '#E30A17', candidates: ['Ekrem İmamoğlu', 'Mansur Yavaş', 'Özgür Özel'] },
  { id: 'MEM',  name: 'Memleket Partisi',                color: '#00838F', candidates: ['Muharrem İnce'] },
  { id: 'DEVA', name: 'DEVA Partisi',                    color: '#26A69A', candidates: ['Ali Babacan'] },
  { id: 'GEL',  name: 'Gelecek Partisi',                 color: '#5D4037', candidates: ['Ahmet Davutoğlu'] },
  { id: 'SAA',  name: 'Saadet Partisi',                  color: '#2E7D32', candidates: ['Mahmut Arıkan'] },
  { id: 'IYI',  name: 'İYİ Parti',                       color: '#19A0D2', candidates: ['Müsavat Dervişoğlu'] },
  { id: 'AKP',  name: 'Adalet ve Kalkınma Partisi',      color: '#F37021', candidates: ['Recep Tayyip Erdoğan'] },
  { id: 'YRP',  name: 'Yeniden Refah Partisi',           color: '#66BB6A', candidates: ['Fatih Erbakan'] },
  { id: 'MHP',  name: 'Milliyetçi Hareket Partisi',      color: '#6D071A', candidates: ['Devlet Bahçeli'] },
  { id: 'ZAF',  name: 'Zafer Partisi',                   color: '#283593', candidates: ['Ümit Özdağ'] },
];

export const TR_2028_PARTY_MAP = Object.fromEntries(
  TR_2028_PARTIES.map(p => [p.id, p])
) as Record<Tr2028PartyId, Tr2028Party>;

export const TR_2028_WIKI_TITLES: Record<string, string> = {
  'Erkan Baş':             'Erkan_Baş',
  'Tuncer Bakırhan':       'Tuncer_Bakırhan',
  'Tülay Hatimoğulları':   'Tülay_Hatimoğulları',
  'Ekrem İmamoğlu':        'Ekrem_İmamoğlu',
  'Mansur Yavaş':          'Mansur_Yavaş',
  'Özgür Özel':            'Özgür_Özel',
  'Muharrem İnce':         'Muharrem_İnce',
  'Ali Babacan':           'Ali_Babacan',
  'Ahmet Davutoğlu':       'Ahmet_Davutoğlu',
  'Mahmut Arıkan':         'Mahmut_Arıkan',
  'Müsavat Dervişoğlu':    'Müsavat_Dervişoğlu',
  'Recep Tayyip Erdoğan':  'Recep_Tayyip_Erdoğan',
  'Fatih Erbakan':         'Fatih_Erbakan',
  'Devlet Bahçeli':        'Devlet_Bahçeli',
  'Ümit Özdağ':            'Ümit_Özdağ',
};
