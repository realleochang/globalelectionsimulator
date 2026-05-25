// Germany – Bundestagswahl 2025 (February 23, 2025)
// 299 Wahlkreise · Erststimmen only (amtliches Endergebnis 2025-03-14)
// Source: Bundeswahlleiterin kerg.csv open data
// Seat allocation: national Erststimmen aggregate → Sainte-Laguë on 630 seats
// Threshold: ≥5% national OR ≥3 direct wins (SSW minority-party exempt)

export type DePartyId = 'CDU' | 'CSU' | 'SPD' | 'GRUE' | 'AFD' | 'LINKE' | 'BSW' | 'FDP' | 'FW' | 'SSW' | 'SONST';

export interface DeParty {
  id: DePartyId;
  name: string;
  fullName: string;
  color: string;
  state?: string;
}

export const DE_PARTIES: DeParty[] = [
  { id: 'CDU',   name: 'CDU',   fullName: 'Christlich Demokratische Union',    color: '#151518' },
  { id: 'CSU',   name: 'CSU',   fullName: 'Christlich-Soziale Union',           color: '#0066B3', state: '09' },
  { id: 'SPD',   name: 'SPD',   fullName: 'Sozialdemokratische Partei',         color: '#E3000F' },
  { id: 'GRUE',  name: 'Grüne', fullName: 'Bündnis 90/Die Grünen',              color: '#1AA037' },
  { id: 'AFD',   name: 'AfD',   fullName: 'Alternative für Deutschland',         color: '#009EE0' },
  { id: 'LINKE', name: 'Linke', fullName: 'Die Linke',                           color: '#BE3075' },
  { id: 'FDP',   name: 'FDP',   fullName: 'Freie Demokratische Partei',          color: '#D4A017' },
  { id: 'FW',    name: 'FW',    fullName: 'Freie Wähler',                        color: '#F07000' },
  { id: 'BSW',   name: 'BSW',   fullName: 'Bündnis Sahra Wagenknecht',           color: '#7B2D8B' },
  { id: 'SSW',   name: 'SSW',   fullName: 'Südschleswigscher Wählerverband',     color: '#003399', state: '01' },
  { id: 'SONST', name: 'Sonst.', fullName: 'Sonstige',                           color: '#8B8B8B' },
];

export const DE_PARTY_MAP: Record<DePartyId, DeParty> =
  Object.fromEntries(DE_PARTIES.map(p => [p.id, p])) as Record<DePartyId, DeParty>;

export const BUNDESTAG_TOTAL  = 630;
export const THRESHOLD_PCT    = 5.0;
export const DIRECT_THRESHOLD = 3;
export const THRESHOLD_EXEMPT: Set<DePartyId> = new Set(['SSW']); // national minority party

export interface DeWahlkreis {
  nr:          number;
  name:        string;
  state:       string;
  stateName:   string;
  validVotes:  number;
  erststimmen: Partial<Record<DePartyId, number>>;
}

// ── Helper: raw votes → DeWahlkreis ───────────────────────────────────────────
// vote order: spd, cdu, grue, fdp, afd, csu, linke, fw, bsw, ssw
function mkV(nr: number, name: string, state: string, stateName: string,
  spd: number, cdu: number, grue: number, fdp: number, afd: number,
  csu: number, linke: number, fw: number, bsw: number, ssw: number
): DeWahlkreis {
  const raw: [DePartyId, number][] = [
    ['SPD', spd], ['CDU', cdu], ['GRUE', grue], ['FDP', fdp], ['AFD', afd],
    ['CSU', csu], ['LINKE', linke], ['FW', fw], ['BSW', bsw], ['SSW', ssw],
  ];
  const erststimmen: Partial<Record<DePartyId, number>> = {};
  let validVotes = 0;
  for (const [id, v] of raw) {
    if (v > 0) { erststimmen[id] = v; validVotes += v; }
  }
  return { nr, name, state, stateName, validVotes, erststimmen };
}

// ── 299 Wahlkreise – official Erststimmen (amtliches Endergebnis) ─────────────
// Cols: spd, cdu, grue, fdp, afd, csu, linke, fw, bsw, ssw
export const DE_WAHLKREISE: DeWahlkreis[] = [
// ── Schleswig-Holstein (01) ──────────────────────────────────────────────────
mkV(1,  'Flensburg – Schleswig',                   '01','Schleswig-Holstein', 28376,50838,43298,4487,28827,0,10375,1547,0,21468),
mkV(2,  'Nordfriesland – Dithmarschen Nord',        '01','Schleswig-Holstein', 31169,49866,16628,5750,24474,0,7920,1484,0,14254),
mkV(3,  'Steinburg – Dithmarschen Süd',             '01','Schleswig-Holstein', 30702,50887,14449,5625,29674,0,8665,3111,0,0),
mkV(4,  'Rendsburg-Eckernförde',                   '01','Schleswig-Holstein', 36266,56163,20473,8170,26417,0,8675,1367,0,11075),
mkV(5,  'Kiel',                                    '01','Schleswig-Holstein', 36690,34944,43281,4828,17811,0,15953,777,0,7365),
mkV(6,  'Plön – Neumünster',                       '01','Schleswig-Holstein', 33977,46370,18852,4693,25249,0,7623,3022,0,0),
mkV(7,  'Pinneberg',                               '01','Schleswig-Holstein', 49714,63232,25395,7675,30417,0,12683,2190,0,4617),
mkV(8,  'Segeberg – Stormarn-Mitte',               '01','Schleswig-Holstein', 51437,67880,24800,9417,36071,0,12636,3261,0,0),
mkV(9,  'Ostholstein – Stormarn-Nord',             '01','Schleswig-Holstein', 38070,52024,15636,5423,25929,0,8232,2636,0,0),
mkV(10, 'Herzogtum Lauenburg – Stormarn-Süd',      '01','Schleswig-Holstein', 48275,67642,29009,7445,35418,0,12161,3784,0,0),
mkV(11, 'Lübeck',                                  '01','Schleswig-Holstein', 39809,33695,27477,4028,21972,0,10175,1960,0,0),
// ── Mecklenburg-Vorpommern (13) ───────────────────────────────────────────────
mkV(12, 'Schwerin – Ludwigslust-Parchim I – Nordwestmecklenburg I',           '13','Mecklenburg-Vorpommern', 34100,35455,5532,4870,60865,0,21570,4753,0,0),
mkV(13, 'Ludwigslust-Parchim II – Nordwestmecklenburg II – Landkreis Rostock I','13','Mecklenburg-Vorpommern', 34657,32832,5748,4422,59419,0,18099,6054,0,0),
mkV(14, 'Rostock – Landkreis Rostock II',          '13','Mecklenburg-Vorpommern', 30034,34403,9400,5037,47597,0,45518,3431,0,0),
mkV(15, 'Vorpommern-Rügen – Vorpommern-Greifswald I','13','Mecklenburg-Vorpommern', 26885,39237,9066,4814,68848,0,24633,4982,0,0),
mkV(16, 'Mecklenburgische Seenplatte I – Vorpommern-Greifswald II','13','Mecklenburg-Vorpommern', 22871,33049,3782,5883,75078,0,18009,4768,0,0),
mkV(17, 'Mecklenburgische Seenplatte II – Landkreis Rostock III','13','Mecklenburg-Vorpommern', 31000,30810,3370,4313,65039,0,16949,3583,0,0),
// ── Hamburg (02) ──────────────────────────────────────────────────────────────
mkV(18, 'Hamburg-Mitte',                           '02','Hamburg', 51554,31834,40350,6541,19903,0,31019,1468,0,0),
mkV(19, 'Hamburg-Altona',                          '02','Hamburg', 36941,33415,43372,5283,11911,0,25285,1029,0,0),
mkV(20, 'Hamburg-Eimsbüttel',                      '02','Hamburg', 42765,34521,45674,6578,12752,0,20739,1563,0,0),
mkV(21, 'Hamburg-Nord',                            '02','Hamburg', 50363,53108,42875,7028,15271,0,14921,1376,0,0),
mkV(22, 'Hamburg-Wandsbek',                        '02','Hamburg', 57629,43981,23211,5707,25894,0,18956,2458,0,0),
mkV(23, 'Hamburg-Bergedorf – Harburg',             '02','Hamburg', 53073,35208,19139,4162,28983,0,19075,1820,0,0),
// ── Niedersachsen (03) ────────────────────────────────────────────────────────
mkV(24, 'Aurich – Emden',                          '03','Niedersachsen', 63557,34070,7790,3581,31160,0,8939,0,0,0),
mkV(25, 'Unterems',                                '03','Niedersachsen', 44288,79775,13738,4981,40010,0,10839,3213,0,0),
mkV(26, 'Friesland – Wilhelmshaven – Wittmund',    '03','Niedersachsen', 52918,40095,8630,3974,29533,0,8246,2535,0,0),
mkV(27, 'Oldenburg – Ammerland',                   '03','Niedersachsen', 66280,46172,28728,5996,25046,0,15672,2071,0,0),
mkV(28, 'Delmenhorst – Wesermarsch – Oldenburg-Land','03','Niedersachsen', 48627,53762,18021,10208,35331,0,12645,3925,0,0),
mkV(29, 'Cuxhaven – Stade II',                     '03','Niedersachsen', 46915,50395,11029,4167,30471,0,7968,3087,0,0),
mkV(30, 'Stade I – Rotenburg II',                  '03','Niedersachsen', 42400,60307,16205,4665,29891,0,10351,0,0,0),
mkV(31, 'Mittelems',                               '03','Niedersachsen', 48325,86995,14462,6904,27995,0,10169,2832,0,0),
mkV(32, 'Cloppenburg – Vechta',                    '03','Niedersachsen', 32516,85241,11281,6135,38364,0,9485,2955,0,0),
mkV(33, 'Diepholz – Nienburg I',                   '03','Niedersachsen', 44317,56921,13005,5318,27351,0,9614,4449,0,0),
mkV(34, 'Osterholz – Verden',                      '03','Niedersachsen', 40965,59337,18452,4952,28057,0,11072,0,0,0),
mkV(35, 'Rotenburg I – Heidekreis',                '03','Niedersachsen', 58183,37774,7411,3260,26671,0,0,2923,0,0),
mkV(36, 'Harburg',                                 '03','Niedersachsen', 45738,57718,18423,6047,28905,0,10310,3142,0,0),
mkV(37, 'Lüchow-Dannenberg – Lüneburg',            '03','Niedersachsen', 42910,40563,25297,3894,23895,0,10937,3710,0,0),
mkV(38, 'Osnabrück-Land',                          '03','Niedersachsen', 40394,60952,16758,4914,29985,0,9516,2850,0,0),
mkV(39, 'Stadt Osnabrück',                         '03','Niedersachsen', 45259,47727,21954,4178,18266,0,18862,1843,0,0),
mkV(40, 'Nienburg II – Schaumburg',                '03','Niedersachsen', 49658,44793,11725,4384,31470,0,8669,2635,0,0),
mkV(41, 'Stadt Hannover I',                        '03','Niedersachsen', 48667,32819,22397,3994,18719,0,12047,1081,0,0),
mkV(42, 'Stadt Hannover II',                       '03','Niedersachsen', 57217,28168,30166,3769,16190,0,18042,863,0,0),
mkV(43, 'Hannover-Land I',                         '03','Niedersachsen', 52313,66485,18120,5102,33139,0,10431,2523,0,0),
mkV(44, 'Celle – Uelzen',                          '03','Niedersachsen', 40066,61127,16099,5920,34968,0,10278,3442,0,0),
mkV(45, 'Gifhorn – Peine',                         '03','Niedersachsen', 61983,50990,11761,4716,38897,0,9066,2664,0,0),
mkV(46, 'Hameln-Pyrmont – Holzminden',             '03','Niedersachsen', 47556,41181,10314,4628,30078,0,7757,2623,0,0),
mkV(47, 'Hannover-Land II',                        '03','Niedersachsen', 62406,59010,17552,4926,33774,0,10888,2208,0,0),
mkV(48, 'Hildesheim',                              '03','Niedersachsen', 53926,51421,16511,4369,31963,0,12021,2120,0,0),
mkV(49, 'Salzgitter – Wolfenbüttel',               '03','Niedersachsen', 48410,44809,10911,3934,33787,0,11137,2294,0,0),
mkV(50, 'Braunschweig',                            '03','Niedersachsen', 51553,38158,21984,4462,20472,0,12660,1671,0,0),
mkV(51, 'Helmstedt – Wolfsburg',                   '03','Niedersachsen', 40859,44217,9909,4621,31590,0,8826,0,0,0),
mkV(52, 'Goslar – Northeim – Göttingen II',        '03','Niedersachsen', 46875,46699,11922,4000,30494,0,9187,2556,0,0),
mkV(53, 'Göttingen I',                             '03','Niedersachsen', 44623,50736,26771,6321,24753,0,15935,2217,0,0),
// ── Bremen (04) ───────────────────────────────────────────────────────────────
mkV(54, 'Bremen I',                                '04','Bremen', 48663,46309,36571,5594,22752,0,25810,0,0,0),
mkV(55, 'Bremen II – Bremerhaven',                 '04','Bremen', 46604,32364,16716,4070,29886,0,18598,1758,0,0),
// ── Brandenburg (12) ─────────────────────────────────────────────────────────
mkV(56, 'Prignitz – Ostprignitz-Ruppin – Havelland I',    '12','Brandenburg', 29296,25868,4033,2847,51213,0,13871,4596,0,0),
mkV(57, 'Uckermark – Barnim I',                           '12','Brandenburg', 27211,25664,5459,3322,53912,0,17198,5177,0,0),
mkV(58, 'Oberhavel – Havelland II',                       '12','Brandenburg', 41825,52000,13889,6039,64557,0,19832,6805,0,0),
mkV(59, 'Märkisch-Oderland – Barnim II',                  '12','Brandenburg', 35789,34599,7625,4692,69020,0,25447,6648,0,0),
mkV(60, 'Brandenburg an der Havel – Potsdam-Mittelmark I – Havelland III – Teltow-Fläming I','12','Brandenburg', 41062,30938,5956,3717,53611,0,17349,4803,0,0),
mkV(61, 'Potsdam – Potsdam-Mittelmark II – Teltow-Fläming II','12','Brandenburg', 43332,40956,31629,7959,37796,0,27522,3905,0,0),
mkV(62, 'Dahme-Spreewald – Teltow-Fläming III',           '12','Brandenburg', 35055,47405,10248,4967,66815,0,22422,5510,0,0),
mkV(63, 'Frankfurt (Oder) – Oder-Spree',                  '12','Brandenburg', 30831,27858,4463,3528,56620,0,16788,5726,0,0),
mkV(64, 'Cottbus – Spree-Neiße',                          '12','Brandenburg', 30552,22712,0,3558,54980,0,12818,2882,0,0),
mkV(65, 'Elbe-Elster – Oberspreewald-Lausitz',            '12','Brandenburg', 22087,24331,2704,3822,57194,0,15935,7005,0,0),
// ── Sachsen-Anhalt (15) ───────────────────────────────────────────────────────
mkV(66, 'Altmark – Jerichower Land',               '15','Sachsen-Anhalt', 28276,38820,4852,6047,69054,0,22147,7010,0,0),
mkV(67, 'Börde – Salzlandkreis',                   '15','Sachsen-Anhalt', 22895,37609,3745,4608,72651,0,17753,4738,0,0),
mkV(68, 'Harz',                                    '15','Sachsen-Anhalt', 21243,35708,4958,3405,59302,0,18076,4379,0,0),
mkV(69, 'Magdeburg',                               '15','Sachsen-Anhalt', 29617,39726,10305,4647,55457,0,25560,3984,0,0),
mkV(70, 'Anhalt – Dessau – Wittenberg',            '15','Sachsen-Anhalt', 18255,51474,8426,3715,67245,0,17745,7458,0,0),
mkV(71, 'Halle',                                   '15','Sachsen-Anhalt', 30798,38174,9366,5045,52546,0,27804,2866,0,0),
mkV(72, 'Burgenland – Saalekreis',                 '15','Sachsen-Anhalt', 15653,37721,3752,4612,69074,0,17034,6315,0,0),
mkV(73, 'Mansfeld',                                '15','Sachsen-Anhalt', 17214,34087,3195,5524,70305,0,19699,5613,0,0),
// ── Berlin (11) ───────────────────────────────────────────────────────────────
mkV(74, 'Berlin-Mitte',                            '11','Berlin', 26816,22933,40672,4586,13706,0,38521,471,8012,0),
mkV(75, 'Berlin-Pankow',                           '11','Berlin', 26106,31918,50854,5407,33179,0,45010,2357,0,0),
mkV(76, 'Berlin-Reinickendorf',                    '11','Berlin', 28956,40867,17136,4737,23866,0,15584,0,0,0),
mkV(77, 'Berlin-Spandau – Charlottenburg Nord',    '11','Berlin', 36200,34305,12217,4283,25931,0,15044,0,0,0),
mkV(78, 'Berlin-Steglitz-Zehlendorf',              '11','Berlin', 40355,55398,39843,7382,18539,0,15823,1905,0,0),
mkV(79, 'Berlin-Charlottenburg-Wilmersdorf',       '11','Berlin', 38187,42273,38681,7063,13870,0,17861,0,0,0),
mkV(80, 'Berlin-Tempelhof-Schöneberg',             '11','Berlin', 37934,45573,45639,4986,20626,0,22399,0,0,0),
mkV(81, 'Berlin-Neukölln',                         '11','Berlin', 27266,28487,16136,2791,18893,0,43413,831,0,0),
mkV(82, 'Berlin-Friedrichshain-Kreuzberg – Prenzlauer Berg Ost','11','Berlin', 23519,17940,54771,4277,13854,0,62049,0,0,0),
mkV(83, 'Berlin-Treptow-Köpenick',                 '11','Berlin', 14472,23747,8081,2961,34646,0,70572,892,9494,0),
mkV(84, 'Berlin-Marzahn-Hellersdorf',              '11','Berlin', 12926,43262,6093,1871,43729,0,24895,1834,12754,0),
mkV(85, 'Berlin-Lichtenberg',                      '11','Berlin', 13926,27190,8108,2231,33707,0,52378,851,11527,0),
// ── Nordrhein-Westfalen (05) ──────────────────────────────────────────────────
mkV(86,  'Aachen I',                               '05','Nordrhein-Westfalen', 27722,45548,39377,5916,0,0,13162,3338,0,0),
mkV(87,  'Aachen II',                              '05','Nordrhein-Westfalen', 53747,70541,13269,8191,0,0,13330,12919,0,0),
mkV(88,  'Heinsberg',                              '05','Nordrhein-Westfalen', 29813,64624,11797,4679,30784,0,8959,2804,0,0),
mkV(89,  'Düren',                                  '05','Nordrhein-Westfalen', 35854,64996,12153,4591,33137,0,9105,3264,0,0),
mkV(90,  'Rhein-Erft-Kreis I',                     '05','Nordrhein-Westfalen', 53545,71833,20977,7550,34348,0,13218,2567,0,0),
mkV(91,  'Euskirchen – Rhein-Erft-Kreis II',       '05','Nordrhein-Westfalen', 42466,78883,19549,8498,37837,0,11457,2885,0,0),
mkV(92,  'Köln I',                                 '05','Nordrhein-Westfalen', 37717,37261,30496,4672,20022,0,16894,1488,0,0),
mkV(93,  'Köln II',                                '05','Nordrhein-Westfalen', 35124,59925,72858,8061,12775,0,18454,881,0,0),
mkV(94,  'Köln III',                               '05','Nordrhein-Westfalen', 43307,32639,43697,4773,19459,0,18806,1322,0,0),
mkV(95,  'Bonn',                                   '05','Nordrhein-Westfalen', 41577,63973,46819,4737,15681,0,14776,935,0,0),
mkV(96,  'Rhein-Sieg-Kreis I',                     '05','Nordrhein-Westfalen', 44274,70350,22219,8438,34564,0,11331,3319,0,0),
mkV(97,  'Rhein-Sieg-Kreis II',                    '05','Nordrhein-Westfalen', 32287,79639,23157,5879,25832,0,9768,2139,0,0),
mkV(98,  'Oberbergischer Kreis',                   '05','Nordrhein-Westfalen', 34869,62100,14813,5476,36265,0,10064,2914,0,0),
mkV(99,  'Rheinisch-Bergischer Kreis',             '05','Nordrhein-Westfalen', 34424,77301,25245,9054,22758,0,9309,1692,0,0),
mkV(100, 'Leverkusen – Köln IV',                   '05','Nordrhein-Westfalen', 53574,41855,18081,5102,25439,0,14848,1984,0,0),
mkV(101, 'Wuppertal I',                            '05','Nordrhein-Westfalen', 50907,36841,13033,4563,27707,0,13852,1805,0,0),
mkV(102, 'Solingen – Remscheid – Wuppertal II',    '05','Nordrhein-Westfalen', 47237,55860,14997,5555,31911,0,12886,0,0,0),
mkV(103, 'Mettmann I',                             '05','Nordrhein-Westfalen', 37459,60813,20705,7482,26187,0,10713,0,0,0),
mkV(104, 'Mettmann II',                            '05','Nordrhein-Westfalen', 32169,46152,14237,5007,22097,0,8542,0,0,0),
mkV(105, 'Düsseldorf I',                           '05','Nordrhein-Westfalen', 39356,67108,32269,9883,18227,0,13321,1026,0,0),
mkV(106, 'Düsseldorf II',                          '05','Nordrhein-Westfalen', 34739,43282,27347,6250,19574,0,14024,934,0,0),
mkV(107, 'Neuss I',                                '05','Nordrhein-Westfalen', 46410,62250,14559,7267,29039,0,12035,0,0,0),
mkV(108, 'Mönchengladbach',                        '05','Nordrhein-Westfalen', 36259,50331,13648,4555,25280,0,0,1478,0,0),
mkV(109, 'Krefeld I – Neuss II',                   '05','Nordrhein-Westfalen', 36512,61543,17840,8910,23769,0,10838,3268,0,0),
mkV(110, 'Viersen',                                '05','Nordrhein-Westfalen', 38071,73676,19438,7317,29425,0,11337,2510,0,0),
mkV(111, 'Kleve',                                  '05','Nordrhein-Westfalen', 39191,74631,16447,6098,28974,0,10755,2429,0,0),
mkV(112, 'Wesel I',                                '05','Nordrhein-Westfalen', 47432,58854,13786,6123,29375,0,10275,2154,0,0),
mkV(113, 'Krefeld II – Wesel II',                  '05','Nordrhein-Westfalen', 41999,44412,12133,4841,23421,0,8552,1829,0,0),
mkV(114, 'Duisburg I',                             '05','Nordrhein-Westfalen', 49116,27748,9830,3081,22224,0,10805,1378,0,0),
mkV(115, 'Duisburg II',                            '05','Nordrhein-Westfalen', 36731,21791,7599,2394,29445,0,9976,1575,0,0),
mkV(116, 'Oberhausen – Wesel III',                 '05','Nordrhein-Westfalen', 48434,41519,12638,4456,32461,0,12062,0,0,0),
mkV(117, 'Mülheim – Essen I',                      '05','Nordrhein-Westfalen', 47047,41707,13280,4958,25140,0,9854,2370,0,0),
mkV(118, 'Essen II',                               '05','Nordrhein-Westfalen', 34227,27842,9316,2683,26058,0,10655,1681,0,0),
mkV(119, 'Essen III',                              '05','Nordrhein-Westfalen', 38546,55807,24617,4835,18563,0,11667,1751,0,0),
mkV(120, 'Recklinghausen I',                       '05','Nordrhein-Westfalen', 42356,36875,8686,3278,25912,0,7544,1096,0,0),
mkV(121, 'Recklinghausen II',                      '05','Nordrhein-Westfalen', 42454,46217,10574,3419,30367,0,8501,1891,0,0),
mkV(122, 'Gelsenkirchen',                          '05','Nordrhein-Westfalen', 38118,28051,7379,4038,31302,0,10246,1720,0,0),
mkV(123, 'Steinfurt I – Borken I',                 '05','Nordrhein-Westfalen', 38037,70066,15800,5775,25233,0,10029,2633,0,0),
mkV(124, 'Bottrop – Recklinghausen III',           '05','Nordrhein-Westfalen', 46276,49625,10249,4185,32869,0,8927,1810,0,0),
mkV(125, 'Borken II',                              '05','Nordrhein-Westfalen', 33511,82000,16486,5043,22179,0,8742,3362,0,0),
mkV(126, 'Coesfeld – Steinfurt II',                '05','Nordrhein-Westfalen', 34152,76819,21571,5338,20615,0,7708,0,0,0),
mkV(127, 'Steinfurt III',                          '05','Nordrhein-Westfalen', 41397,62253,19383,4874,25484,0,9868,0,0,0),
mkV(128, 'Münster',                                '05','Nordrhein-Westfalen', 42553,58996,64528,6779,13426,0,14083,0,0,0),
mkV(129, 'Warendorf',                              '05','Nordrhein-Westfalen', 36247,72720,18940,5119,27935,0,9798,3768,0,0),
mkV(130, 'Gütersloh I',                            '05','Nordrhein-Westfalen', 40229,79373,17268,5942,32673,0,10489,2489,0,0),
mkV(131, 'Bielefeld – Gütersloh II',               '05','Nordrhein-Westfalen', 53130,50742,31274,5930,27995,0,19802,0,0,0),
mkV(132, 'Herford – Minden-Lübbecke II',           '05','Nordrhein-Westfalen', 52576,54253,12899,5867,38341,0,10740,2222,0,0),
mkV(133, 'Minden-Lübbecke I',                      '05','Nordrhein-Westfalen', 39931,51975,15008,5432,35399,0,9061,2975,0,0),
mkV(134, 'Lippe I',                                '05','Nordrhein-Westfalen', 42552,56640,21911,5474,39427,0,10896,3857,0,0),
mkV(135, 'Höxter – Gütersloh III – Lippe II',      '05','Nordrhein-Westfalen', 26226,60581,10482,4391,28854,0,7421,2482,0,0),
mkV(136, 'Paderborn',                              '05','Nordrhein-Westfalen', 29097,86833,20143,4528,34928,0,11949,0,0,0),
mkV(137, 'Hagen – Ennepe-Ruhr-Kreis I',            '05','Nordrhein-Westfalen', 39188,44170,12584,5216,32643,0,9095,1784,6515,0),
mkV(138, 'Ennepe-Ruhr-Kreis II',                   '05','Nordrhein-Westfalen', 42576,43775,14587,4265,23488,0,8617,1408,0,0),
mkV(139, 'Bochum I',                               '05','Nordrhein-Westfalen', 53007,39925,22181,4680,22797,0,15273,0,0,0),
mkV(140, 'Herne – Bochum II',                      '05','Nordrhein-Westfalen', 43832,31032,11111,2948,28088,0,10878,0,0,0),
mkV(141, 'Dortmund I',                             '05','Nordrhein-Westfalen', 50260,38929,22994,4857,26057,0,15048,0,0,0),
mkV(142, 'Dortmund II',                            '05','Nordrhein-Westfalen', 49553,37891,15742,4047,28240,0,13794,0,0,0),
mkV(143, 'Unna I',                                 '05','Nordrhein-Westfalen', 49685,46509,14059,3974,29070,0,9491,0,0,0),
mkV(144, 'Hamm – Unna II',                         '05','Nordrhein-Westfalen', 58097,54186,11476,4786,38828,0,12865,0,0,0),
mkV(145, 'Soest',                                  '05','Nordrhein-Westfalen', 42544,70487,18133,7449,36727,0,11144,2537,0,0),
mkV(146, 'Hochsauerlandkreis',                     '05','Nordrhein-Westfalen', 35080,78259,10024,4120,26087,0,7655,2773,0,0),
mkV(147, 'Siegen-Wittgenstein',                    '05','Nordrhein-Westfalen', 40824,56827,12486,5300,34138,0,10735,2344,0,0),
mkV(148, 'Olpe – Märkischer Kreis I',              '05','Nordrhein-Westfalen', 33640,68241,10191,5650,32358,0,8231,2102,0,0),
mkV(149, 'Märkischer Kreis II',                    '05','Nordrhein-Westfalen', 34522,58968,9878,4578,31658,0,9917,0,0,0),
// ── Sachsen (14) ─────────────────────────────────────────────────────────────
mkV(150, 'Nordsachsen',                            '14','Sachsen', 12554,31398,3090,2684,55024,0,10502,7092,0,0),
mkV(151, 'Leipzig I',                              '14','Sachsen', 21472,39286,13796,3828,45730,0,39377,2186,11727,0),
mkV(152, 'Leipzig II',                             '14','Sachsen', 16615,31270,19954,3987,36549,0,71811,2005,10113,0),
mkV(153, 'Leipzig-Land',                           '14','Sachsen', 18676,42046,6053,4395,65318,0,14944,8207,10899,0),
mkV(154, 'Meißen',                                 '14','Sachsen', 11413,37049,6529,8223,70572,0,14695,5610,0,0),
mkV(155, 'Bautzen I',                              '14','Sachsen', 11384,38643,3484,4199,77339,0,15654,8050,0,0),
mkV(156, 'Görlitz',                                '14','Sachsen', 9626,37197,4659,2952,75147,0,9795,3588,9832,0),
mkV(157, 'Sächsische Schweiz-Osterzgebirge',       '14','Sachsen', 12766,35961,4751,4478,77901,0,14523,7008,0,0),
mkV(158, 'Dresden I',                              '14','Sachsen', 21457,50040,19899,6229,53853,0,26085,0,0,0),
mkV(159, 'Dresden II – Bautzen II',                '14','Sachsen', 18245,47107,22140,5130,58238,0,31961,3253,0,0),
mkV(160, 'Mittelsachsen',                          '14','Sachsen', 13321,39665,3680,4284,66688,0,13234,6156,0,0),
mkV(161, 'Chemnitz',                               '14','Sachsen', 24128,30868,6554,3314,46401,0,14349,2066,13190,0),
mkV(162, 'Chemnitzer Umland – Erzgebirgskreis II', '14','Sachsen', 16139,38304,3828,4655,61027,0,14229,0,0,0),
mkV(163, 'Erzgebirgskreis I',                      '14','Sachsen', 10741,40716,2597,3579,75876,0,11121,5544,10288,0),
mkV(164, 'Zwickau',                                '14','Sachsen', 14837,35506,3485,4279,59725,0,11214,4712,13507,0),
mkV(165, 'Vogtlandkreis',                          '14','Sachsen', 13975,37770,4526,3413,60672,0,13336,6298,0,0),
// ── Hessen (06) ───────────────────────────────────────────────────────────────
mkV(166, 'Waldeck',                                '06','Hessen', 41883,46166,10559,4863,31701,0,8462,4806,0,0),
mkV(167, 'Kassel',                                 '06','Hessen', 47900,42004,24338,4735,28126,0,20203,2934,0,0),
mkV(168, 'Werra-Meißner – Hersfeld-Rotenburg',     '06','Hessen', 38010,44173,7357,3326,30926,0,7246,3961,0,0),
mkV(169, 'Schwalm-Eder',                           '06','Hessen', 42943,45647,8705,4329,36357,0,7974,5763,0,0),
mkV(170, 'Marburg',                                '06','Hessen', 45774,44014,13738,3481,27633,0,11452,2642,0,0),
mkV(171, 'Lahn-Dill',                              '06','Hessen', 39533,56424,11201,4544,37998,0,8677,3807,0,0),
mkV(172, 'Gießen',                                 '06','Hessen', 49204,53851,15276,4906,33541,0,12444,5122,0,0),
mkV(173, 'Fulda',                                  '06','Hessen', 23675,75039,11460,5969,39790,0,7262,6093,0,0),
mkV(174, 'Main-Kinzig – Wetterau II – Schotten',   '06','Hessen', 29795,49611,10738,4755,36231,0,7064,4511,0,0),
mkV(175, 'Hochtaunus',                             '06','Hessen', 29458,57261,18418,7275,25045,0,8108,3299,0,0),
mkV(176, 'Wetterau I',                             '06','Hessen', 38192,49929,14407,5766,25930,0,7726,3830,0,0),
mkV(177, 'Rheingau-Taunus – Limburg',              '06','Hessen', 40101,66648,19472,7660,31379,0,9026,3890,0,0),
mkV(178, 'Wiesbaden',                              '06','Hessen', 32697,44997,21876,5944,20406,0,15408,2317,0,0),
mkV(179, 'Hanau',                                  '06','Hessen', 35906,45346,12134,5177,27150,0,10745,3340,0,0),
mkV(180, 'Main-Taunus',                            '06','Hessen', 29238,65495,23001,8847,21541,0,9860,2962,0,0),
mkV(181, 'Frankfurt am Main I',                    '06','Hessen', 40832,41232,25756,7418,17067,0,20329,1465,0,0),
mkV(182, 'Frankfurt am Main II',                   '06','Hessen', 35101,52010,50207,8773,17449,0,18780,1500,0,0),
mkV(183, 'Groß-Gerau',                             '06','Hessen', 40121,42181,11195,4667,22816,0,12390,3442,0,0),
mkV(184, 'Offenbach',                              '06','Hessen', 38384,53821,25416,6606,26300,0,17841,4159,0,0),
mkV(185, 'Darmstadt',                              '06','Hessen', 42398,53802,43629,6626,27391,0,15384,2038,0,0),
mkV(186, 'Odenwald',                               '06','Hessen', 47730,65470,17327,6825,35564,0,11704,5264,0,0),
mkV(187, 'Bergstraße',                             '06','Hessen', 34219,59209,14917,6289,33328,0,8822,3650,0,0),
// ── Thüringen (16) ────────────────────────────────────────────────────────────
mkV(188, 'Eichsfeld – Nordhausen – Kyffhäuserkreis','16','Thüringen', 14361,45728,3000,3815,65033,0,19527,0,12712,0),
mkV(189, 'Eisenach – Wartburgkreis – Unstrut-Hainich-Kreis','16','Thüringen', 18892,35936,3882,2345,61095,0,16030,3765,12824,0),
mkV(190, 'Jena – Sömmerda – Weimarer Land I',      '16','Thüringen', 18734,29661,9587,3655,52003,0,31247,3415,11453,0),
mkV(191, 'Gotha – Ilm-Kreis',                      '16','Thüringen', 14681,29345,4403,2998,60354,0,18753,3236,11660,0),
mkV(192, 'Erfurt – Weimar – Weimarer Land II',     '16','Thüringen', 13900,28587,5458,3350,46612,0,64390,1918,10299,0),
mkV(193, 'Gera – Greiz – Altenburger Land',        '16','Thüringen', 18698,34406,3323,3918,77161,0,20441,3416,10915,0),
mkV(194, 'Saalfeld-Rudolstadt – Saale-Holzland-Kreis – Saale-Orla-Kreis','16','Thüringen', 14261,35224,4340,3835,76204,0,21114,3941,12415,0),
mkV(195, 'Suhl – Schmalkalden-Meiningen – Hildburghausen – Sonneberg','16','Thüringen', 18315,33940,2829,4205,73608,0,18445,6140,14697,0),
// ── Rheinland-Pfalz (07) ──────────────────────────────────────────────────────
mkV(196, 'Neuwied',                                '07','Rheinland-Pfalz', 42314,68501,11921,6858,40365,0,9689,4345,6445,0),
mkV(197, 'Ahrweiler',                              '07','Rheinland-Pfalz', 30537,62011,14413,5283,28335,0,8220,5584,0,0),
mkV(198, 'Koblenz',                                '07','Rheinland-Pfalz', 37659,55097,15001,4703,24836,0,9028,5858,0,0),
mkV(199, 'Mosel/Rhein-Hunsrück',                   '07','Rheinland-Pfalz', 27079,53505,10039,7588,27060,0,6494,6009,0,0),
mkV(200, 'Kreuznach',                              '07','Rheinland-Pfalz', 38082,46768,7765,4714,30688,0,6352,4404,4722,0),
mkV(201, 'Bitburg',                                '07','Rheinland-Pfalz', 27098,53459,7362,4155,22265,0,4893,11825,0,0),
mkV(202, 'Trier',                                  '07','Rheinland-Pfalz', 46951,47826,12843,6148,22088,0,7791,4125,5351,0),
mkV(203, 'Montabaur',                              '07','Rheinland-Pfalz', 40294,61574,10832,5462,35321,0,8709,5923,0,0),
mkV(204, 'Mainz',                                  '07','Rheinland-Pfalz', 50411,57966,40617,8024,21665,0,19474,3013,4963,0),
mkV(205, 'Worms',                                  '07','Rheinland-Pfalz', 39042,62290,13996,5171,35866,0,8638,3857,4401,0),
mkV(206, 'Ludwigshafen/Frankenthal',               '07','Rheinland-Pfalz', 42213,43627,12367,5737,37117,0,7794,4621,5445,0),
mkV(207, 'Neustadt – Speyer',                      '07','Rheinland-Pfalz', 39569,62590,16914,5582,35237,0,7122,4894,5496,0),
mkV(208, 'Kaiserslautern',                         '07','Rheinland-Pfalz', 49464,42591,10099,5138,45160,0,7396,7385,7628,0),
mkV(209, 'Pirmasens',                              '07','Rheinland-Pfalz', 28474,45682,6112,4078,34424,0,4924,4632,4827,0),
mkV(210, 'Südpfalz',                               '07','Rheinland-Pfalz', 34274,68124,13799,4686,35587,0,7114,4097,5361,0),
// ── Bayern (09) – CSU instead of CDU ─────────────────────────────────────────
mkV(211, 'Altötting',                              '09','Bayern', 11870,0,10399,3994,32269,60164,5867,8637,0,0),
mkV(212, 'Erding – Ebersberg',                     '09','Bayern', 17609,0,23383,6324,27275,80087,6856,7059,0,0),
mkV(213, 'Freising',                               '09','Bayern', 23356,0,25718,5803,36965,88025,8630,13208,0,0),
mkV(214, 'Fürstenfeldbruck',                       '09','Bayern', 29795,0,23886,8748,27997,84651,7313,8829,0,0),
mkV(215, 'Ingolstadt',                             '09','Bayern', 21556,0,14531,3711,39220,91839,7731,9909,0,0),
mkV(216, 'München-Nord',                           '09','Bayern', 36495,0,44708,8536,16684,59875,12123,2700,0,0),
mkV(217, 'München-Ost',                            '09','Bayern', 31546,0,49442,8278,18451,74027,12477,3649,0,0),
mkV(218, 'München-Süd',                            '09','Bayern', 26461,0,53775,7171,15876,54859,9825,2364,4593,0),
mkV(219, 'München-West/Mitte',                     '09','Bayern', 33018,0,60243,10329,0,72200,12683,6366,0,0),
mkV(220, 'München-Land',                           '09','Bayern', 27306,0,40045,8786,22924,88204,8428,6071,0,0),
mkV(221, 'Rosenheim',                              '09','Bayern', 17916,0,25196,5724,36813,82023,9152,16037,0,0),
mkV(222, 'Bad Tölz-Wolfratshausen – Miesbach',     '09','Bayern', 10901,0,20820,4754,23291,65481,4694,7226,0,0),
mkV(223, 'Starnberg – Landsberg am Lech',          '09','Bayern', 24177,0,31311,6665,24187,80441,6449,6051,0,0),
mkV(224, 'Traunstein',                             '09','Bayern', 20845,0,14985,3270,30994,80507,6884,10690,0,0),
mkV(225, 'Weilheim',                               '09','Bayern', 13489,0,18128,6356,22169,65409,5698,7936,0,0),
mkV(226, 'Deggendorf',                             '09','Bayern', 12156,0,6354,5188,36406,58347,3070,11370,0,0),
mkV(227, 'Landshut',                               '09','Bayern', 18800,0,17125,6437,42123,70986,7562,38342,0,0),
mkV(228, 'Passau',                                 '09','Bayern', 20121,0,7425,3072,33776,58538,4161,9198,3804,0),
mkV(229, 'Rottal-Inn',                             '09','Bayern', 9947,0,7688,2625,32885,49582,4167,32668,0,0),
mkV(230, 'Straubing',                              '09','Bayern', 11132,0,7241,2715,36673,65291,4394,11139,0,0),
mkV(231, 'Amberg',                                 '09','Bayern', 19705,0,12177,4698,38359,80626,7316,12883,0,0),
mkV(232, 'Regensburg',                             '09','Bayern', 27626,0,27741,5229,37964,81105,9736,11214,5151,0),
mkV(233, 'Schwandorf',                             '09','Bayern', 25534,0,7516,3432,49695,77717,4914,13591,0,0),
mkV(234, 'Weiden',                                 '09','Bayern', 16294,0,6624,4126,31352,59268,5591,9673,0,0),
mkV(235, 'Bamberg',                                '09','Bayern', 22569,0,20762,4709,28891,61044,7914,6174,0,0),
mkV(236, 'Bayreuth',                               '09','Bayern', 19031,0,10999,3680,25144,59366,6117,6741,0,0),
mkV(237, 'Coburg',                                 '09','Bayern', 18425,0,10943,2490,26822,53725,5019,6944,2846,0),
mkV(238, 'Hof',                                    '09','Bayern', 22966,0,6391,3160,30614,51926,5789,6181,0,0),
mkV(239, 'Kulmbach',                               '09','Bayern', 13210,0,9233,2838,30698,69446,5361,8742,0,0),
mkV(240, 'Ansbach',                                '09','Bayern', 26718,0,18248,5276,43100,84723,9434,10960,0,0),
mkV(241, 'Erlangen',                               '09','Bayern', 28003,0,29337,4761,22637,57971,9115,7023,0,0),
mkV(242, 'Fürth',                                  '09','Bayern', 36983,0,22502,6095,38344,77512,12638,8042,0,0),
mkV(243, 'Nürnberg-Nord',                          '09','Bayern', 26738,0,32432,4976,18093,45424,14697,2963,0,0),
mkV(244, 'Nürnberg-Süd',                           '09','Bayern', 24213,0,14730,3556,27128,48913,10821,3662,0,0),
mkV(245, 'Roth',                                   '09','Bayern', 25561,0,24181,5525,33199,84151,9951,8872,0,0),
mkV(246, 'Aschaffenburg',                          '09','Bayern', 19006,0,18230,5169,28438,67597,7334,4314,0,0),
mkV(247, 'Bad Kissingen',                          '09','Bayern', 25127,0,10615,8444,0,87357,9957,22323,0,0),
mkV(248, 'Main-Spessart',                          '09','Bayern', 25806,0,13740,3802,29752,74896,6784,8328,0,0),
mkV(249, 'Schweinfurt',                            '09','Bayern', 21834,0,12894,3992,33832,70455,7606,7823,0,0),
mkV(250, 'Würzburg',                               '09','Bayern', 26349,0,36587,8012,24817,74917,9766,5704,0,0),
mkV(251, 'Augsburg-Stadt',                         '09','Bayern', 20701,0,30320,4139,25488,45742,10966,5463,0,0),
mkV(252, 'Augsburg-Land',                          '09','Bayern', 25217,0,18278,5509,37563,88388,7842,10256,0,0),
mkV(253, 'Donau-Ries',                             '09','Bayern', 19720,0,9398,3895,34916,73296,5536,9972,3535,0),
mkV(254, 'Neu-Ulm',                                '09','Bayern', 18762,0,14869,5121,41999,75359,8006,6162,0,0),
mkV(255, 'Memmingen – Unterallgäu',                '09','Bayern', 12674,0,10821,3938,30371,58479,6212,11106,0,0),
mkV(256, 'Oberallgäu',                             '09','Bayern', 16065,0,23668,8113,31804,70226,7461,16475,0,0),
mkV(257, 'Ostallgäu',                              '09','Bayern', 13508,0,14096,3529,26633,61899,6102,10158,0,0),
// ── Baden-Württemberg (08) ────────────────────────────────────────────────────
mkV(258, 'Stuttgart I',                            '08','Baden-Württemberg', 25231,45662,45667,9327,13843,0,14203,1981,0,0),
mkV(259, 'Stuttgart II',                           '08','Baden-Württemberg', 22057,42061,29438,5789,20166,0,12414,1790,0,0),
mkV(260, 'Böblingen',                              '08','Baden-Württemberg', 34198,76033,27409,12438,34826,0,9936,6046,0,0),
mkV(261, 'Esslingen',                              '08','Baden-Württemberg', 22446,51329,21500,6021,21754,0,9177,3479,0,0),
mkV(262, 'Nürtingen',                              '08','Baden-Württemberg', 28298,64951,24795,9105,30579,0,9264,5143,0,0),
mkV(263, 'Göppingen',                              '08','Baden-Württemberg', 24232,52947,13239,5839,32264,0,6812,4449,0,0),
mkV(264, 'Waiblingen',                             '08','Baden-Württemberg', 31595,69225,22702,10519,33168,0,9726,4714,0,0),
mkV(265, 'Ludwigsburg',                            '08','Baden-Württemberg', 27111,65326,28680,9149,30176,0,11154,3175,0,0),
mkV(266, 'Neckar-Zaber',                           '08','Baden-Württemberg', 29184,76390,22572,7695,37967,0,9925,5081,0,0),
mkV(267, 'Heilbronn',                              '08','Baden-Württemberg', 29914,67516,16637,9852,48360,0,11484,4328,0,0),
mkV(268, 'Schwäbisch Hall – Hohenlohe',            '08','Baden-Württemberg', 27499,67218,18528,8307,44363,0,8902,4614,0,0),
mkV(269, 'Backnang – Schwäbisch Gmünd',            '08','Baden-Württemberg', 23870,53064,15499,5844,33940,0,7486,3174,0,0),
mkV(270, 'Aalen – Heidenheim',                     '08','Baden-Württemberg', 25137,74010,14872,6425,41337,0,8987,4984,0,0),
mkV(271, 'Karlsruhe-Stadt',                        '08','Baden-Württemberg', 25553,39597,51306,6399,22986,0,13353,2015,0,0),
mkV(272, 'Karlsruhe-Land',                         '08','Baden-Württemberg', 26153,68439,22739,7330,32293,0,8839,4589,0,0),
mkV(273, 'Rastatt',                                '08','Baden-Württemberg', 24569,63116,18274,5727,36075,0,7608,5411,0,0),
mkV(274, 'Heidelberg',                             '08','Baden-Württemberg', 29464,54060,51423,6767,22182,0,13225,2566,0,0),
mkV(275, 'Mannheim',                               '08','Baden-Württemberg', 34137,37566,27493,6391,27170,0,12117,2626,0,0),
mkV(276, 'Odenwald – Tauber',                      '08','Baden-Württemberg', 24015,72800,13334,5336,39075,0,7689,5759,0,0),
mkV(277, 'Rhein-Neckar',                           '08','Baden-Württemberg', 33082,55930,17909,7029,33086,0,8276,4754,0,0),
mkV(278, 'Bruchsal – Schwetzingen',                '08','Baden-Württemberg', 26254,58113,17251,6699,35749,0,8294,5673,0,0),
mkV(279, 'Pforzheim',                              '08','Baden-Württemberg', 36222,63762,0,9382,46265,0,11023,0,0,0),
mkV(280, 'Calw',                                   '08','Baden-Württemberg', 20945,63399,13187,6838,39325,0,6312,5812,0,0),
mkV(281, 'Freiburg',                               '08','Baden-Württemberg', 30486,47806,63281,5541,20008,0,19518,2574,0,0),
mkV(282, 'Lörrach – Müllheim',                     '08','Baden-Württemberg', 32290,61900,29239,5810,32848,0,11325,10174,0,0),
mkV(283, 'Emmendingen – Lahr',                     '08','Baden-Württemberg', 40204,66984,18328,5695,34282,0,8504,6875,0,0),
mkV(284, 'Offenburg',                              '08','Baden-Württemberg', 21575,63492,20482,7406,34411,0,8993,7685,0,0),
mkV(285, 'Rottweil – Tuttlingen',                  '08','Baden-Württemberg', 17697,62245,12461,8719,44002,0,7147,4794,0,0),
mkV(286, 'Schwarzwald-Baar',                       '08','Baden-Württemberg', 19396,55044,9979,4524,29143,0,5295,2933,0,0),
mkV(287, 'Konstanz',                               '08','Baden-Württemberg', 26451,63922,25390,7363,29587,0,9987,3341,0,0),
mkV(288, 'Waldshut',                               '08','Baden-Württemberg', 26958,54467,16809,5169,26710,0,6839,4321,0,0),
mkV(289, 'Reutlingen',                             '08','Baden-Württemberg', 22440,63189,20868,9115,32479,0,9118,4649,0,0),
mkV(290, 'Tübingen',                               '08','Baden-Württemberg', 22149,54252,42176,6242,26760,0,10521,3862,0,0),
mkV(291, 'Ulm',                                    '08','Baden-Württemberg', 25220,73225,29344,6700,34990,0,9375,3800,0,0),
mkV(292, 'Biberach',                               '08','Baden-Württemberg', 18225,58651,14819,5555,32077,0,5447,4638,0,0),
mkV(293, 'Bodensee',                               '08','Baden-Württemberg', 21966,57658,18269,4628,29318,0,6090,3535,0,0),
mkV(294, 'Ravensburg',                             '08','Baden-Württemberg', 17209,60702,23871,8948,29159,0,9810,4667,0,0),
mkV(295, 'Zollernalb – Sigmaringen',               '08','Baden-Württemberg', 28895,54656,7838,6171,38498,0,5862,3858,0,0),
// ── Saarland (10) ─────────────────────────────────────────────────────────────
mkV(296, 'Saarbrücken',                            '10','Saarland', 47772,36514,10931,5305,30422,0,12484,3532,0,0),
mkV(297, 'Saarlouis',                              '10','Saarland', 46008,51704,7726,5260,35621,0,10903,5170,0,0),
mkV(298, 'St. Wendel',                             '10','Saarland', 40408,47875,5342,5361,29038,0,8133,5166,0,0),
mkV(299, 'Homburg',                                '10','Saarland', 44557,40910,6478,4685,34096,0,9695,5590,0,0),
];

// ── Direct seat calculator ─────────────────────────────────────────────────────
export function calcDirectSeats(
  wahlkreise: DeWahlkreis[],
  currentResults: Record<number, Partial<Record<DePartyId, number>>>
): Partial<Record<DePartyId, number>> {
  const tally: Partial<Record<DePartyId, number>> = {};
  for (const wk of wahlkreise) {
    const results = currentResults[wk.nr] ?? wk.erststimmen;
    let winner: DePartyId | null = null;
    let maxVotes = 0;
    for (const [party, votes] of Object.entries(results) as [DePartyId, number][]) {
      if (votes > maxVotes) { maxVotes = votes; winner = party; }
    }
    if (winner) tally[winner] = (tally[winner] ?? 0) + 1;
  }
  return tally;
}

export function sainteLague(shares: Record<string, number>, totalSeats: number): Record<string, number> {
  const seats: Record<string, number> = Object.fromEntries(Object.keys(shares).map(k => [k, 0]));
  for (let i = 0; i < totalSeats; i++) {
    let best: string | null = null;
    let bestQ = -Infinity;
    for (const [party, share] of Object.entries(shares)) {
      const q = share / (2 * (seats[party] ?? 0) + 1);
      if (q > bestQ) { bestQ = q; best = party; }
    }
    if (best) seats[best]++;
  }
  return seats;
}

// ── Bundestag allocator (simplified: Erststimmen only) ────────────────────────
// 1. Sum national Erststimmen by party
// 2. Qualify: ≥5% national share, OR ≥3 direct wins, OR threshold-exempt (SSW)
// 3. Sainte-Laguë on 630 total seats among qualifying parties
export function calcBundestag(
  wahlkreise: DeWahlkreis[],
  currentResults: Record<number, Partial<Record<DePartyId, number>>>
): {
  directSeats:       Partial<Record<DePartyId, number>>;
  totalSeats:        Partial<Record<DePartyId, number>>;
  qualifyingParties: Set<DePartyId>;
} {
  // National vote totals
  const national: Partial<Record<DePartyId, number>> = {};
  let grandTotal = 0;
  for (const wk of wahlkreise) {
    const results = currentResults[wk.nr] ?? wk.erststimmen;
    for (const [pid, v] of Object.entries(results) as [DePartyId, number][]) {
      if (v > 0) { national[pid] = (national[pid] ?? 0) + v; grandTotal += v; }
    }
  }

  const directSeats = calcDirectSeats(wahlkreise, currentResults);

  // Qualifying parties
  const qualifying = new Set<DePartyId>();
  for (const party of DE_PARTIES) {
    if (party.id === 'SONST') continue;
    const votes = national[party.id] ?? 0;
    const pct = grandTotal > 0 ? (votes / grandTotal) * 100 : 0;
    if (THRESHOLD_EXEMPT.has(party.id) && votes > 0) qualifying.add(party.id);
    else if (pct >= THRESHOLD_PCT) qualifying.add(party.id);
    else if ((directSeats[party.id] ?? 0) >= DIRECT_THRESHOLD) qualifying.add(party.id);
  }

  // Sainte-Laguë proportional allocation
  const qualifyingShares: Record<string, number> = {};
  for (const pid of qualifying) qualifyingShares[pid] = national[pid] ?? 0;

  const totalSeats: Partial<Record<DePartyId, number>> = qualifying.size > 0
    ? sainteLague(qualifyingShares, BUNDESTAG_TOTAL) as Partial<Record<DePartyId, number>>
    : {};

  return { directSeats, totalSeats, qualifyingParties: qualifying };
}

// ── Official 2025 Zweitstimmen (party list votes) ─────────────────────────────
// Source: Federal Returning Officer (Bundeswahlleiterin), amtliches Endergebnis
export const ZWEITSTIMMEN_2025: Partial<Record<DePartyId, number>> = {
  CDU:   11_196_374,
  AFD:   10_328_780,
  SPD:    8_149_124,
  GRUE:   5_762_380,
  LINKE:  4_356_532,
  CSU:    2_964_028,
  BSW:    2_472_947,
  FDP:    2_148_757,
  FW:       769_279,
  SSW:        76_138,
};
export const ZWEIT_GRAND_TOTAL_2025 = 49_649_512;

// ── MMP seat calculator (post-2023 Wahlrechtsreform) ──────────────────────────
// Zweitstimmen drives proportional allocation; constituency seats capped to proportional share
export function calcMMP(
  zweitstimmen: Partial<Record<DePartyId, number>>,
  directSeats:  Partial<Record<DePartyId, number>>
): {
  listSeats:         Partial<Record<DePartyId, number>>;
  constSeats:        Partial<Record<DePartyId, number>>;
  totalSeats:        Partial<Record<DePartyId, number>>;
  qualifyingParties: Set<DePartyId>;
} {
  let grandTotal = 0;
  for (const v of Object.values(zweitstimmen)) grandTotal += v ?? 0;

  const qualifying = new Set<DePartyId>();
  for (const party of DE_PARTIES) {
    if (party.id === 'SONST') continue;
    const votes = zweitstimmen[party.id] ?? 0;
    const pct   = grandTotal > 0 ? (votes / grandTotal) * 100 : 0;
    if (THRESHOLD_EXEMPT.has(party.id) && votes > 0) qualifying.add(party.id);
    else if (pct >= THRESHOLD_PCT)                              qualifying.add(party.id);
    else if ((directSeats[party.id] ?? 0) >= DIRECT_THRESHOLD) qualifying.add(party.id);
  }

  const qualShares: Record<string, number> = {};
  for (const pid of qualifying) qualShares[pid] = zweitstimmen[pid] ?? 0;

  const totalSeats: Partial<Record<DePartyId, number>> = qualifying.size > 0
    ? sainteLague(qualShares, BUNDESTAG_TOTAL) as Partial<Record<DePartyId, number>>
    : {};

  const constSeats: Partial<Record<DePartyId, number>> = {};
  const listSeats:  Partial<Record<DePartyId, number>> = {};
  for (const pid of qualifying) {
    const total  = totalSeats[pid] ?? 0;
    const direct = Math.min(directSeats[pid] ?? 0, total);
    constSeats[pid] = direct;
    listSeats[pid]  = total - direct;
  }

  return { listSeats, constSeats, totalSeats, qualifyingParties: qualifying };
}

// ── 2025 actual awarded constituency seats by state ──────────────────────────
// 276 of 299 constituencies awarded (23 "losing winners" not seated — 2023 reform)
export const DIRECT_SEATS_2025_BY_STATE: Record<string, Partial<Record<DePartyId, number>>> = {
  '01': { CDU: 8,  SPD: 1,  GRUE: 1 },                        // Schleswig-Holstein
  '02': { SPD: 3,  CDU: 1,  GRUE: 2 },                        // Hamburg
  '03': { SPD: 15, CDU: 15 },                                  // Niedersachsen
  '04': { SPD: 1 },                                            // Bremen
  '05': { SPD: 17, CDU: 44, GRUE: 3 },                        // Nordrhein-Westfalen
  '06': { SPD: 2,  CDU: 15 },                                  // Hessen
  '07': { SPD: 1,  CDU: 11 },                                  // Rheinland-Pfalz
  '08': { CDU: 29, GRUE: 3 },                                  // Baden-Württemberg
  '09': { CSU: 44 },                                           // Bayern
  '10': { SPD: 2,  CDU: 2 },                                   // Saarland
  '11': { SPD: 1,  CDU: 3,  GRUE: 3, AFD: 1,  LINKE: 4 },    // Berlin
  '12': { SPD: 1,  AFD: 8 },                                   // Brandenburg
  '13': { AFD: 5 },                                            // Mecklenburg-Vorpommern
  '14': { AFD: 14, LINKE: 1 },                                 // Sachsen
  '15': { AFD: 7 },                                            // Sachsen-Anhalt
  '16': { AFD: 7,  LINKE: 1 },                                 // Thüringen
};

// ── 2025 actual list seats by state ──────────────────────────────────────────
// 354 list seats total; source: Federal Returning Officer / Bundeswahlleiterin
export const LIST_SEATS_2025_BY_STATE: Record<string, Partial<Record<DePartyId, number>>> = {
  '01': { SPD: 4,  GRUE: 3,  AFD: 5,  LINKE: 2, SSW: 1 },    // SH: 15
  '02': { CDU: 2,  GRUE: 1,  AFD: 2,  LINKE: 2 },             // HH: 7
  '03': { SPD: 2,  CDU: 6,  GRUE: 8,  AFD: 13, LINKE: 6 },   // NI: 35
  '04': { CDU: 1,  GRUE: 1,  AFD: 1,  LINKE: 1 },             // HB: 4
  '05': { SPD: 14, CDU: 3,  GRUE: 16, AFD: 26, LINKE: 13 },  // NW: 72
  '06': { SPD: 8,  GRUE: 7,  AFD: 9,  LINKE: 4 },             // HE: 28
  '07': { SPD: 6,  GRUE: 4,  AFD: 7,  LINKE: 2 },             // RP: 19
  '08': { SPD: 13, GRUE: 9,  AFD: 19, LINKE: 6 },             // BW: 47
  '09': { SPD: 14, GRUE: 14, AFD: 22, LINKE: 7 },             // BY: 57
  '10': { GRUE: 1,  AFD: 2,  LINKE: 1 },                      // SL: 4
  '11': { SPD: 3,  CDU: 2,  GRUE: 2,  AFD: 3,  LINKE: 2 },   // B: 12
  '12': { SPD: 3,  CDU: 4,  GRUE: 2,  LINKE: 3 },             // BB: 12
  '13': { SPD: 2,  CDU: 3,  GRUE: 1,  LINKE: 2 },             // MV: 8
  '14': { SPD: 3,  CDU: 7,  GRUE: 2,  LINKE: 3 },             // SN: 15
  '15': { SPD: 2,  CDU: 4,  GRUE: 1,  LINKE: 2 },             // ST: 9
  '16': { SPD: 2,  CDU: 4,  GRUE: 1,  AFD: 1,  LINKE: 2 },   // TH: 10
};

// ── State name map ─────────────────────────────────────────────────────────────
export const STATE_NAMES: Record<string, string> = {
  '01': 'Schleswig-Holstein', '02': 'Hamburg', '03': 'Niedersachsen',
  '04': 'Bremen', '05': 'Nordrhein-Westfalen', '06': 'Hessen',
  '07': 'Rheinland-Pfalz', '08': 'Baden-Württemberg', '09': 'Bayern',
  '10': 'Saarland', '11': 'Berlin', '12': 'Brandenburg',
  '13': 'Mecklenburg-Vorpommern', '14': 'Sachsen', '15': 'Sachsen-Anhalt',
  '16': 'Thüringen',
};

// ── Leaders ────────────────────────────────────────────────────────────────────
export const DE_LEADERS: Partial<Record<DePartyId, { name: string; wikiTitle?: string }>> = {
  CDU:   { name: 'Friedrich Merz',    wikiTitle: 'Friedrich_Merz' },
  CSU:   { name: 'Markus Söder',      wikiTitle: 'Markus_Söder' },
  SPD:   { name: 'Olaf Scholz',       wikiTitle: 'Olaf_Scholz' },
  GRUE:  { name: 'Robert Habeck',     wikiTitle: 'Robert_Habeck' },
  AFD:   { name: 'Alice Weidel',      wikiTitle: 'Alice_Weidel' },
  LINKE: { name: 'Jan van Aken',      wikiTitle: 'Jan_van_Aken_(politician)' },
  FDP:   { name: 'Christian Lindner', wikiTitle: 'Christian_Lindner' },
  FW:    { name: 'Hubert Aiwanger',   wikiTitle: 'Hubert_Aiwanger' },
  BSW:   { name: 'Sahra Wagenknecht', wikiTitle: 'Sahra_Wagenknecht' },
  SSW:   { name: 'Stefan Seidler',    wikiTitle: 'Stefan_Seidler' },
  SONST: { name: 'Sonstige' },
};

export const DE_LEADERS_2026: Partial<Record<DePartyId, { name: string; wikiTitle?: string }>> = {
  SPD:  { name: 'Lars Klingbeil',     wikiTitle: 'Lars_Klingbeil' },
  GRUE: { name: 'Franziska Brantner', wikiTitle: 'Franziska_Brantner' },
};
