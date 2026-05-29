// South Korea — 22nd National Assembly election (April 10, 2024)
// 254 constituency seats (FPTP) + 46 proportional seats (준연동형 / quasi-MMP) = 300
// Sources: NEC official results (via ko.wikipedia regional result pages, CC BY-SA);
//          254-district boundary geojson by OhmyNews (2024_22_elec_map).
// PR allocation: semi-linked formula, all 46 seats linked (no 30-seat cap, no parallel tier).
//   Threshold: ≥3% national PR vote OR ≥5 constituency seats.
//   Verified to reproduce the official 18/14/12/2 PR split exactly.

export type KrPartyId =
  | 'DPK' | 'PPP' | 'DEMALL' | 'PFP' | 'RKP' | 'REF'
  | 'NFP' | 'PROG' | 'GJP' | 'LUP' | 'IND' | 'OTH';

export interface KrParty {
  id: KrPartyId;
  name: string;       // short English / abbr
  nameKo: string;     // Korean name
  fullName: string;
  color: string;
  darkColor?: string; // override for dark mode if base is too dark
  order: number;      // ideology left→right (for parliament seating)
  tier: 'const' | 'pr' | 'both';
  parentId?: KrPartyId; // satellite → parent (PR satellites of the two majors)
}

// Ordered left → right by ideology
export const KR_PARTIES: KrParty[] = [
  { id: 'PROG',   name: 'PROG',  nameKo: '진보당',         fullName: 'Progressive Party',            color: '#E5007F', order: 1,  tier: 'const' },
  { id: 'GJP',    name: 'GJP',   nameKo: '녹색정의당',     fullName: 'Green Justice Party',          color: '#00A651', order: 2,  tier: 'both'  },
  { id: 'RKP',    name: 'RKP',   nameKo: '조국혁신당',     fullName: 'Rebuilding Korea Party',       color: '#1B3A8B', darkColor: '#5B8DEF', order: 3,  tier: 'pr' },
  { id: 'DEMALL', name: 'DemAll',nameKo: '더불어민주연합', fullName: 'Democratic Alliance (DPK list)', color: '#0067AC', order: 4,  tier: 'pr', parentId: 'DPK' },
  { id: 'DPK',    name: 'DPK',   nameKo: '더불어민주당',   fullName: 'Democratic Party of Korea',    color: '#004EA2', darkColor: '#3C7DD9', order: 5,  tier: 'const' },
  { id: 'NFP',    name: 'NFP',   nameKo: '새로운미래',     fullName: 'New Future Party',             color: '#00B0B9', order: 6,  tier: 'both' },
  { id: 'REF',    name: 'REF',   nameKo: '개혁신당',       fullName: 'Reform Party',                 color: '#FF7210', order: 7,  tier: 'both' },
  { id: 'PPP',    name: 'PPP',   nameKo: '국민의힘',       fullName: 'People Power Party',           color: '#E61E2B', order: 8,  tier: 'const' },
  { id: 'PFP',    name: 'PFP',   nameKo: '국민의미래',     fullName: 'People Future Party (PPP list)', color: '#C9151E', order: 9, tier: 'pr', parentId: 'PPP' },
  { id: 'LUP',    name: 'LUP',   nameKo: '자유통일당',     fullName: 'Liberty Unification Party',     color: '#2E3192', order: 10, tier: 'both' },
  { id: 'IND',    name: 'IND',   nameKo: '무소속',         fullName: 'Independent',                  color: '#8A8A8A', order: 11, tier: 'const' },
  { id: 'OTH',    name: 'OTH',   nameKo: '기타',           fullName: 'Other parties',                color: '#B6B6B6', order: 12, tier: 'both' },
];

export const KR_PARTY_MAP: Record<KrPartyId, KrParty> =
  Object.fromEntries(KR_PARTIES.map(p => [p.id, p])) as Record<KrPartyId, KrParty>;

export const ASSEMBLY_TOTAL    = 300;
export const CONSTITUENCY_SEATS = 254;
export const PR_SEATS          = 46;
export const PR_THRESHOLD_PCT  = 3.0;   // ≥3% national PR vote …
export const DIRECT_THRESHOLD  = 5;     // … OR ≥5 constituency seats → PR-eligible
export const MAJORITY          = Math.floor(ASSEMBLY_TOTAL / 2) + 1; // 151

export interface KrDistrict {
  nr:         number;                         // 1..254 (stable internal id)
  code:       string;                         // NEC SGG_Code (geojson join key)
  name:       string;                         // Korean constituency name
  state:      string;                         // region code (see SIDO_NAMES)
  stateName:  string;                         // region English name
  electorate: number;                         // registered electors (유권자)
  validVotes: number;                         // total valid votes (합계)
  votes:      Partial<Record<KrPartyId, number>>; // constituency votes by party
  winnerName: string;                         // winning candidate (Korean)
  winnerParty: KrPartyId;
}

function mkD(
  nr: number, code: string, name: string, state: string, stateName: string,
  electorate: number, validVotes: number,
  votes: Partial<Record<KrPartyId, number>>, winnerName: string, winnerParty: KrPartyId,
): KrDistrict {
  return { nr, code, name, state, stateName, electorate, validVotes, votes, winnerName, winnerParty };
}

// ── 254 constituencies — official 2024 results ────────────────────────────────
export const KR_DISTRICTS: KrDistrict[] = [
mkD(1, '2110101', 'Jongro', '11', 'Seoul', 126041, 87809, { DPK: 44713, PPP: 38752, REF: 2835, NFP: 1080, OTH: 429 }, '곽상언', 'DPK'),
mkD(2, '2110201', 'Jung-Seongdong B', '11', 'Seoul', 177422, 121476, { DPK: 61728, PPP: 58961, OTH: 787 }, '박성준', 'DPK'),
mkD(3, '2110301', 'Yongsan', '11', 'Seoul', 188998, 128592, { PPP: 66583, DPK: 60473, IND: 1536 }, '권영세', 'PPP'),
mkD(4, '2110402', 'Jung-Seongdong A', '11', 'Seoul', 180528, 123930, { DPK: 65204, PPP: 58726 }, '전현희', 'DPK'),
mkD(5, '2110501', 'Gwangjin A', '11', 'Seoul', 150187, 102986, { DPK: 54105, PPP: 48881 }, '이정헌', 'DPK'),
mkD(6, '2110502', 'Gwangjin B', '11', 'Seoul', 151508, 103665, { DPK: 53362, PPP: 49347, OTH: 956 }, '고민정', 'DPK'),
mkD(7, '2110601', 'Dongdaemun A', '11', 'Seoul', 151861, 102044, { DPK: 53978, PPP: 45377, REF: 2689 }, '안규백', 'DPK'),
mkD(8, '2110602', 'Dongdaemun B', '11', 'Seoul', 154549, 106694, { DPK: 58286, PPP: 48408 }, '장경태', 'DPK'),
mkD(9, '2110701', 'Jungrang A', '11', 'Seoul', 156202, 98310, { DPK: 60881, PPP: 37429 }, '서영교', 'DPK'),
mkD(10, '2110702', 'Jungrang B', '11', 'Seoul', 188139, 127498, { DPK: 73600, PPP: 53898 }, '박홍근', 'DPK'),
mkD(11, '2110801', 'Seongbuk A', '11', 'Seoul', 195813, 134152, { DPK: 74707, PPP: 52511, NFP: 6934 }, '김영배', 'DPK'),
mkD(12, '2110802', 'Seongbuk B', '11', 'Seoul', 178667, 121200, { DPK: 68872, PPP: 52328 }, '김남근', 'DPK'),
mkD(13, '2110901', 'Gangbuk A', '11', 'Seoul', 132265, 83340, { DPK: 47701, PPP: 35639 }, '천준호', 'DPK'),
mkD(14, '2110902', 'Gangbuk B', '11', 'Seoul', 128295, 84284, { DPK: 44623, PPP: 34989, NFP: 4672 }, '한민수', 'DPK'),
mkD(15, '2111001', 'Dobong A', '11', 'Seoul', 136836, 94532, { PPP: 46374, DPK: 45276, GJP: 2882 }, '김재섭', 'PPP'),
mkD(16, '2111002', 'Dobong B', '11', 'Seoul', 138197, 95353, { DPK: 50384, PPP: 44969 }, '오기형', 'DPK'),
mkD(17, '2111101', 'Nowon A', '11', 'Seoul', 224187, 155910, { DPK: 91986, PPP: 63924 }, '우원식', 'DPK'),
mkD(18, '2111102', 'Nowon B', '11', 'Seoul', 211043, 146495, { DPK: 85721, PPP: 57515, IND: 3259 }, '김성환', 'DPK'),
mkD(19, '2111201', 'Eunpyeong A', '11', 'Seoul', 219044, 147040, { DPK: 89379, PPP: 57661 }, '박주민', 'DPK'),
mkD(20, '2111202', 'Eunpyeong B', '11', 'Seoul', 195270, 130301, { DPK: 74211, PPP: 51612, GJP: 4478 }, '김우영', 'DPK'),
mkD(21, '2111301', 'Seodaemun A', '11', 'Seoul', 130042, 88443, { DPK: 44890, PPP: 38466, REF: 5087 }, '김동아', 'DPK'),
mkD(22, '2111302', 'Seodaemun B', '11', 'Seoul', 141489, 99257, { DPK: 57198, PPP: 42059 }, '김영호', 'DPK'),
mkD(23, '2111401', 'Mapo A', '11', 'Seoul', 139968, 100077, { PPP: 48342, DPK: 47743, GJP: 2033, REF: 1959 }, '조정훈', 'PPP'),
mkD(24, '2111402', 'Mapo B', '11', 'Seoul', 182761, 123402, { DPK: 64715, PPP: 47848, GJP: 10839 }, '정청래', 'DPK'),
mkD(25, '2111501', 'Yangcheon A', '11', 'Seoul', 195448, 143184, { DPK: 71285, PPP: 68959, IND: 2940 }, '황희', 'DPK'),
mkD(26, '2111502', 'Yangcheon B', '11', 'Seoul', 175761, 118255, { DPK: 67962, PPP: 50293 }, '이용선', 'DPK'),
mkD(27, '2111601', 'Gangseo A', '11', 'Seoul', 168119, 110414, { DPK: 64651, PPP: 42703, NFP: 3060 }, '강선우', 'DPK'),
mkD(28, '2111602', 'Gangseo B', '11', 'Seoul', 171060, 115955, { DPK: 63601, PPP: 52354 }, '진성준', 'DPK'),
mkD(29, '2111603', 'Gangseo C', '11', 'Seoul', 158668, 105343, { DPK: 62297, PPP: 43046 }, '한정애', 'DPK'),
mkD(30, '2111701', 'Guro A', '11', 'Seoul', 205069, 143846, { DPK: 80182, PPP: 63664 }, '이인영', 'DPK'),
mkD(31, '2111702', 'Guro B', '11', 'Seoul', 141985, 96529, { DPK: 57788, PPP: 38741 }, '윤건영', 'DPK'),
mkD(32, '2111801', 'Geumcheon', '11', 'Seoul', 207518, 133112, { DPK: 78587, PPP: 54525 }, '최기상', 'DPK'),
mkD(33, '2111901', 'Yeongdeungpo A', '11', 'Seoul', 193458, 134160, { DPK: 73163, PPP: 55913, REF: 5084 }, '채현일', 'DPK'),
mkD(34, '2111902', 'Yeongdeungpo B', '11', 'Seoul', 141494, 98945, { DPK: 49651, PPP: 48516, OTH: 778 }, '김민석', 'DPK'),
mkD(35, '2112001', 'Dongjak A', '11', 'Seoul', 180193, 125496, { DPK: 63372, PPP: 56498, NFP: 5626 }, '김병기', 'DPK'),
mkD(36, '2112002', 'Dongjak B', '11', 'Seoul', 158571, 116115, { PPP: 62720, DPK: 53395 }, '나경원', 'PPP'),
mkD(37, '2112101', 'Gwanak A', '11', 'Seoul', 242617, 157281, { DPK: 89778, PPP: 67503 }, '박민규', 'DPK'),
mkD(38, '2112102', 'Gwanak B', '11', 'Seoul', 204556, 127239, { DPK: 73771, PPP: 49418, PROG: 4050 }, '정태호', 'DPK'),
mkD(39, '2112201', 'Seocho A', '11', 'Seoul', 154336, 109301, { PPP: 74813, DPK: 34488 }, '조은희', 'PPP'),
mkD(40, '2112202', 'Seocho B', '11', 'Seoul', 189614, 135042, { PPP: 77638, DPK: 57404 }, '신동욱', 'PPP'),
mkD(41, '2112301', 'Gangnam A', '11', 'Seoul', 156085, 94330, { PPP: 60549, DPK: 33781 }, '서명옥', 'PPP'),
mkD(42, '2112302', 'Gangnam B', '11', 'Seoul', 168269, 122296, { PPP: 71633, DPK: 50663 }, '박수민', 'PPP'),
mkD(43, '2112303', 'Gangnam C', '11', 'Seoul', 143901, 100465, { PPP: 66597, DPK: 32908, OTH: 960 }, '고동진', 'PPP'),
mkD(44, '2112401', 'Songpa A', '11', 'Seoul', 151559, 108191, { PPP: 56521, DPK: 48831, REF: 2839 }, '박정훈', 'PPP'),
mkD(45, '2112402', 'Songpa B', '11', 'Seoul', 191803, 135521, { PPP: 77531, DPK: 57990 }, '배현진', 'PPP'),
mkD(46, '2112403', 'Songpa C', '11', 'Seoul', 220956, 157430, { DPK: 80358, PPP: 77072 }, '남인순', 'DPK'),
mkD(47, '2112501', 'Gangdong A', '11', 'Seoul', 199231, 147200, { DPK: 73791, PPP: 70489, REF: 2920 }, '진선미', 'DPK'),
mkD(48, '2112502', 'Gangdong B', '11', 'Seoul', 198766, 133280, { DPK: 71376, PPP: 59551, REF: 2353 }, '이해식', 'DPK'),
mkD(49, '2260201', 'Seo-Dong', '21', 'Busan', 172850, 111950, { PPP: 64884, DPK: 47066 }, '곽규택', 'PPP'),
mkD(50, '2260401', 'Jung-Yeongdo', '21', 'Busan', 132866, 84367, { PPP: 46254, DPK: 36739, GJP: 1374 }, '조승환', 'PPP'),
mkD(51, '2260501', 'Busanjin A', '21', 'Busan', 160658, 106373, { PPP: 56153, DPK: 50220 }, '정성국', 'PPP'),
mkD(52, '2260502', 'Busanjin B', '21', 'Busan', 161857, 100336, { PPP: 53897, DPK: 44286, LUP: 2153 }, '이헌승', 'PPP'),
mkD(53, '2260601', 'Dongrae', '21', 'Busan', 230465, 157212, { PPP: 85313, DPK: 67941, REF: 3958 }, '서지영', 'PPP'),
mkD(54, '2260703', 'Nam', '21', 'Busan', 223869, 155431, { PPP: 84563, DPK: 70868 }, '박수영', 'PPP'),
mkD(55, '2260802', 'Buk A', '21', 'Busan', 121889, 83234, { DPK: 43548, PPP: 38850, REF: 836 }, '전재수', 'DPK'),
mkD(56, '2260803', 'Buk B', '21', 'Busan', 117612, 85385, { PPP: 44886, DPK: 40499 }, '박성훈', 'PPP'),
mkD(57, '2260902', 'Haeundae A', '21', 'Busan', 185494, 127123, { PPP: 68267, DPK: 56717, IND: 2139 }, '주진우', 'PPP'),
mkD(58, '2260903', 'Haeundae B', '21', 'Busan', 141382, 93151, { PPP: 54340, DPK: 38811 }, '김미애', 'PPP'),
mkD(59, '2261002', 'Gijang', '21', 'Busan', 146425, 94100, { PPP: 49248, DPK: 44852 }, '정동만', 'PPP'),
mkD(60, '2261101', 'Saha A', '21', 'Busan', 131310, 87125, { PPP: 43909, DPK: 43216 }, '이성권', 'PPP'),
mkD(61, '2261102', 'Saha B', '21', 'Busan', 130588, 84234, { PPP: 46855, DPK: 35735, IND: 1644 }, '조경태', 'PPP'),
mkD(62, '2261201', 'Geumjeong', '21', 'Busan', 192113, 129337, { PPP: 73237, DPK: 56100 }, '백종헌', 'PPP'),
mkD(63, '2261302', 'Gangseo', '21', 'Busan', 111554, 75753, { PPP: 42108, DPK: 33645 }, '김도읍', 'PPP'),
mkD(64, '2261401', 'Yeonje', '21', 'Busan', 184060, 125695, { PPP: 68402, PROG: 57293 }, '김희정', 'PPP'),
mkD(65, '2261501', 'Suyeong', '21', 'Busan', 155728, 101508, { PPP: 51092, DPK: 41088, IND: 9328 }, '정연욱', 'PPP'),
mkD(66, '2261601', 'Sasang', '21', 'Busan', 181823, 119634, { PPP: 62975, DPK: 56659 }, '김대식', 'PPP'),
mkD(67, '2270203', 'Dong-Gunwi A', '22', 'Daegu', 145881, 92047, { PPP: 68563, DPK: 23484 }, '최은석', 'PPP'),
mkD(68, '2270204', 'Dong-Gunwi B', '22', 'Daegu', 174984, 108830, { PPP: 82855, PROG: 21190, LUP: 4785 }, '강대식', 'PPP'),
mkD(69, '2270301', 'Seo', '22', 'Daegu', 149953, 89096, { PPP: 64167, IND: 24929 }, '김상훈', 'PPP'),
mkD(70, '2270401', 'Jung-Nam', '22', 'Daegu', 204639, 124971, { PPP: 72380, DPK: 32783, IND: 19808 }, '김기웅', 'PPP'),
mkD(71, '2270501', 'Buk A', '22', 'Daegu', 152872, 96309, { PPP: 68742, DPK: 26266, LUP: 1301 }, '우재준', 'PPP'),
mkD(72, '2270502', 'Buk B', '22', 'Daegu', 208180, 128726, { PPP: 87356, DPK: 32797, REF: 6529, IND: 2044 }, '김승수', 'PPP'),
mkD(73, '2270601', 'Suseong A', '22', 'Daegu', 201088, 136262, { PPP: 89440, DPK: 41332, GJP: 2970, IND: 2520 }, '주호영', 'PPP'),
mkD(74, '2270602', 'Suseong B', '22', 'Daegu', 143624, 91683, { PPP: 66787, OTH: 14271, REF: 6768, IND: 3857 }, '이인선', 'PPP'),
mkD(75, '2270701', 'Dalseo A', '22', 'Daegu', 134682, 84138, { PPP: 60070, DPK: 24068 }, '유영하', 'PPP'),
mkD(76, '2270702', 'Dalseo B', '22', 'Daegu', 195189, 128316, { PPP: 93003, DPK: 35313 }, '윤재옥', 'PPP'),
mkD(77, '2270703', 'Dalseo C', '22', 'Daegu', 124723, 74253, { PPP: 49816, OTH: 12492, PROG: 11945 }, '권영진', 'PPP'),
mkD(78, '2270801', 'Dalseong', '22', 'Daegu', 214642, 133499, { PPP: 100544, DPK: 32955 }, '추경호', 'PPP'),
mkD(79, '2280101', 'Jung-Ganghwa-Ongjin', '23', 'Incheon', 218648, 142580, { PPP: 78408, DPK: 62582, IND: 1590 }, '배준영', 'PPP'),
mkD(80, '2280301', 'Dong-Michuhol A', '23', 'Incheon', 225741, 138864, { DPK: 74618, PPP: 64246 }, '허종식', 'DPK'),
mkD(81, '2280302', 'Dong-Michuhol B', '23', 'Incheon', 185368, 116435, { PPP: 58730, DPK: 57705 }, '윤상현', 'PPP'),
mkD(82, '2280402', 'Yeonsu A', '23', 'Incheon', 166126, 111854, { DPK: 58663, PPP: 51546, IND: 1645 }, '박찬대', 'DPK'),
mkD(83, '2280403', 'Yeonsu B', '23', 'Incheon', 156982, 110021, { DPK: 56667, PPP: 53354 }, '정일영', 'DPK'),
mkD(84, '2280501', 'Namdong A', '23', 'Incheon', 208476, 129501, { DPK: 73764, PPP: 52139, REF: 3598 }, '맹성규', 'DPK'),
mkD(85, '2280502', 'Namdong B', '23', 'Incheon', 215847, 140304, { DPK: 76443, PPP: 63861 }, '이훈기', 'DPK'),
mkD(86, '2280601', 'Bupyeong A', '23', 'Incheon', 229074, 139137, { DPK: 76797, PPP: 62340 }, '노종면', 'DPK'),
mkD(87, '2280602', 'Bupyeong B', '23', 'Incheon', 206143, 138023, { DPK: 70896, PPP: 53487, NFP: 11399, GJP: 2241 }, '박선원', 'DPK'),
mkD(88, '2280701', 'Gyeyang A', '23', 'Incheon', 120600, 78603, { DPK: 45823, PPP: 32780 }, '유동수', 'DPK'),
mkD(89, '2280702', 'Gyeyang B', '23', 'Incheon', 127351, 89354, { DPK: 48365, PPP: 40616, OTH: 373 }, '이재명', 'DPK'),
mkD(90, '2280802', 'Seo A', '23', 'Incheon', 174282, 110368, { DPK: 63564, PPP: 44565, REF: 1215, IND: 1024 }, '김교흥', 'DPK'),
mkD(91, '2280803', 'Seo B', '23', 'Incheon', 167373, 106871, { DPK: 60423, PPP: 46448 }, '이용우', 'DPK'),
mkD(92, '2280804', 'Seo C', '23', 'Incheon', 179572, 113045, { DPK: 65033, PPP: 44720, REF: 2622, OTH: 670 }, '모경종', 'DPK'),
mkD(93, '2290101', 'Dong-Nam B', '24', 'Gwangju', 133090, 92005, { DPK: 64558, IND: 14865, PPP: 7936, PROG: 3115, REF: 1531 }, '안도걸', 'DPK'),
mkD(94, '2290201', 'Seo A', '24', 'Gwangju', 124977, 82231, { DPK: 56267, OTH: 14292, PPP: 7498, PROG: 4174 }, '조인철', 'DPK'),
mkD(95, '2290202', 'Seo B', '24', 'Gwangju', 118893, 81294, { DPK: 58037, GJP: 11922, PPP: 6360, PROG: 3619, REF: 1138, OTH: 218 }, '양부남', 'DPK'),
mkD(96, '2290302', 'Dong-Nam A', '24', 'Gwangju', 136736, 93446, { DPK: 82883, PPP: 10563 }, '정진욱', 'DPK'),
mkD(97, '2290401', 'Buk A', '24', 'Gwangju', 158463, 103902, { DPK: 86713, PPP: 8856, PROG: 6396, IND: 1937 }, '정준호', 'DPK'),
mkD(98, '2290402', 'Buk B', '24', 'Gwangju', 202572, 138652, { DPK: 99993, PROG: 22664, PPP: 9877, NFP: 4674, REF: 1444 }, '전진숙', 'DPK'),
mkD(99, '2290501', 'Gwangsan A', '24', 'Gwangju', 138064, 90696, { DPK: 74102, PPP: 6318, PROG: 5780, NFP: 3145, IND: 1351 }, '박균택', 'DPK'),
mkD(100, '2290502', 'Gwangsan B', '24', 'Gwangju', 186787, 124492, { DPK: 94733, NFP: 17237, PPP: 5941, PROG: 5110, GJP: 1471 }, '민형배', 'DPK'),
mkD(101, '2300101', 'Dong', '25', 'Daejeon', 190412, 121131, { DPK: 64597, PPP: 54527, REF: 2007 }, '장철민', 'DPK'),
mkD(102, '2300201', 'Jung', '25', 'Daejeon', 195348, 127681, { DPK: 66509, PPP: 61172 }, '박용갑', 'DPK'),
mkD(103, '2300301', 'Seo A', '25', 'Daejeon', 212533, 135478, { DPK: 71576, PPP: 56136, IND: 4595, NFP: 3171 }, '장종태', 'DPK'),
mkD(104, '2300302', 'Seo B', '25', 'Daejeon', 183839, 119701, { DPK: 65340, PPP: 51320, REF: 2414, LUP: 627 }, '박범계', 'DPK'),
mkD(105, '2300402', 'Yuseong A', '25', 'Daejeon', 159614, 105741, { DPK: 60038, PPP: 43189, REF: 2514 }, '조승래', 'DPK'),
mkD(106, '2300403', 'Yuseong B', '25', 'Daejeon', 144975, 102720, { DPK: 61387, PPP: 38209, NFP: 3124 }, '황정아', 'DPK'),
mkD(107, '2300501', 'Daedeok', '25', 'Daejeon', 149618, 96752, { DPK: 49273, PPP: 41655, NFP: 5824 }, '박정현', 'DPK'),
mkD(108, '2310101', 'Jung', '26', 'Ulsan', 179055, 119759, { PPP: 67601, DPK: 52158 }, '박성민', 'PPP'),
mkD(109, '2310201', 'Nam A', '26', 'Ulsan', 139853, 92955, { PPP: 50066, DPK: 39687, NFP: 2880, OTH: 322 }, '김상욱', 'PPP'),
mkD(110, '2310202', 'Nam B', '26', 'Ulsan', 123722, 79146, { PPP: 44502, DPK: 34644 }, '김기현', 'PPP'),
mkD(111, '2310301', 'Dong', '26', 'Ulsan', 127134, 83845, { DPK: 38474, PPP: 37906, OTH: 7465 }, '김태선', 'DPK'),
mkD(112, '2310401', 'Buk', '26', 'Ulsan', 176056, 114620, { PROG: 63188, PPP: 49155, IND: 2277 }, '윤종오', 'PROG'),
mkD(113, '2310501', 'Ulju', '26', 'Ulsan', 188440, 125351, { PPP: 67044, DPK: 58307 }, '서범수', 'PPP'),
mkD(114, '2410101', 'Suwon A', '31', 'Gyeonggi', 200396, 136037, { DPK: 75562, PPP: 57366, REF: 3109 }, '김승원', 'DPK'),
mkD(115, '2410201', 'Suwon B', '31', 'Gyeonggi', 213733, 140397, { DPK: 86677, PPP: 53720 }, '백혜련', 'DPK'),
mkD(116, '2410202', 'Suwon E', '31', 'Gyeonggi', 227030, 148570, { DPK: 87665, PPP: 60905 }, '염태영', 'DPK'),
mkD(117, '2410301', 'Suwon C', '31', 'Gyeonggi', 182482, 116402, { DPK: 64505, PPP: 51897 }, '김영진', 'DPK'),
mkD(118, '2410401', 'Suwon D', '31', 'Gyeonggi', 201075, 137385, { DPK: 69881, PPP: 67504 }, '김준혁', 'DPK'),
mkD(119, '2410501', 'Seongnam-Sujeong', '31', 'Gyeonggi', 209986, 138374, { DPK: 80835, PPP: 57539 }, '김태년', 'DPK'),
mkD(120, '2410601', 'Seongnam-Jungwon', '31', 'Gyeonggi', 186583, 122529, { DPK: 73661, PPP: 48868 }, '이수진', 'DPK'),
mkD(121, '2410701', 'Seongnam-Bundang A', '31', 'Gyeonggi', 214158, 163893, { PPP: 87315, DPK: 76578 }, '안철수', 'PPP'),
mkD(122, '2410702', 'Seongnam-Bundang B', '31', 'Gyeonggi', 182451, 135455, { PPP: 69259, DPK: 66196 }, '김은혜', 'PPP'),
mkD(123, '2410801', 'Euijeongbu A', '31', 'Gyeonggi', 177927, 108686, { DPK: 59660, PPP: 47221, REF: 1805 }, '박지혜', 'DPK'),
mkD(124, '2410802', 'Euijeongbu B', '31', 'Gyeonggi', 222648, 144175, { DPK: 79697, PPP: 64478 }, '이재강', 'DPK'),
mkD(125, '2410901', 'Anyang-Manan', '31', 'Gyeonggi', 203664, 138808, { DPK: 78924, PPP: 59884 }, '강득구', 'DPK'),
mkD(126, '2411001', 'Anyang-Dongan A', '31', 'Gyeonggi', 138721, 99226, { DPK: 56891, PPP: 42335 }, '민병덕', 'DPK'),
mkD(127, '2411002', 'Anyang-Dongan B', '31', 'Gyeonggi', 129800, 96999, { DPK: 52248, PPP: 44751 }, '이재정', 'DPK'),
mkD(128, '2411401', 'Gwangmyeong A', '31', 'Gyeonggi', 113596, 81241, { DPK: 47716, PPP: 33525 }, '임오경', 'DPK'),
mkD(129, '2411402', 'Gwangmyeong B', '31', 'Gyeonggi', 125172, 88057, { DPK: 52455, PPP: 35602 }, '김남희', 'DPK'),
mkD(130, '2411501', 'Pyeongtaek A', '31', 'Gyeonggi', 166864, 96752, { DPK: 55550, PPP: 41202 }, '홍기원', 'DPK'),
mkD(131, '2411502', 'Pyeongtaek B', '31', 'Gyeonggi', 159378, 92195, { DPK: 49998, PPP: 42197 }, '이병진', 'DPK'),
mkD(132, '2411503', 'Pyeongtaek C', '31', 'Gyeonggi', 171693, 105739, { DPK: 55794, PPP: 45977, NFP: 3968 }, '김현정', 'DPK'),
mkD(133, '2411603', 'Dongducheon-Yangju-Yeoncheon A', '31', 'Gyeonggi', 218378, 136369, { DPK: 82186, PPP: 54183 }, '정성호', 'DPK'),
mkD(134, '2411702', 'Dongducheon-Yangju-Yeoncheon B', '31', 'Gyeonggi', 125278, 78933, { PPP: 42393, DPK: 36540 }, '김성원', 'PPP'),
mkD(135, '2411803', 'Ansan A', '31', 'Gyeonggi', 170398, 102567, { DPK: 57050, PPP: 45517 }, '양문석', 'DPK'),
mkD(136, '2411804', 'Ansan B', '31', 'Gyeonggi', 197297, 120162, { DPK: 67547, PPP: 45645, IND: 6970 }, '김현', 'DPK'),
mkD(137, '2411903', 'Ansan C', '31', 'Gyeonggi', 181427, 109474, { DPK: 59317, PPP: 47175, REF: 2982 }, '박해철', 'DPK'),
mkD(138, '2412001', 'Goyang A', '31', 'Gyeonggi', 228942, 153653, { DPK: 69617, PPP: 54308, GJP: 28293, IND: 1435 }, '김성회', 'DPK'),
mkD(139, '2412002', 'Goyang B', '31', 'Gyeonggi', 229773, 159030, { DPK: 97402, PPP: 59375, IND: 2253 }, '한준호', 'DPK'),
mkD(140, '2412101', 'Goyang C', '31', 'Gyeonggi', 236926, 157466, { DPK: 85134, PPP: 72332 }, '이기헌', 'DPK'),
mkD(141, '2412201', 'Goyang D', '31', 'Gyeonggi', 227947, 156047, { DPK: 85660, PPP: 70387 }, '김영환', 'DPK'),
mkD(142, '2412401', 'Euiwang-Gwacheon', '31', 'Gyeonggi', 202961, 150148, { DPK: 81640, PPP: 68508 }, '이소영', 'DPK'),
mkD(143, '2412501', 'Guri', '31', 'Gyeonggi', 161475, 109918, { DPK: 59331, PPP: 47620, REF: 2967 }, '윤호중', 'DPK'),
mkD(144, '2412601', 'Namyangju A', '31', 'Gyeonggi', 180754, 113808, { DPK: 58135, PPP: 40670, REF: 15003 }, '최민희', 'DPK'),
mkD(145, '2412602', 'Namyangju B', '31', 'Gyeonggi', 208484, 131756, { DPK: 75031, PPP: 53774, REF: 2951 }, '김병주', 'DPK'),
mkD(146, '2412603', 'Namyangju C', '31', 'Gyeonggi', 225084, 152760, { DPK: 83387, PPP: 64539, REF: 4834 }, '김용민', 'DPK'),
mkD(147, '2412701', 'Osan', '31', 'Gyeonggi', 193088, 114574, { DPK: 67619, PPP: 46955 }, '차지호', 'DPK'),
mkD(148, '2412901', 'Siheung A', '31', 'Gyeonggi', 221338, 145813, { DPK: 88676, PPP: 55817, LUP: 1320 }, '문정복', 'DPK'),
mkD(149, '2412902', 'Siheung B', '31', 'Gyeonggi', 212474, 125944, { DPK: 71207, PPP: 49828, NFP: 4909 }, '조정식', 'DPK'),
mkD(150, '2413002', 'Gunpo', '31', 'Gyeonggi', 226042, 157333, { DPK: 89561, PPP: 67772 }, '이학영', 'DPK'),
mkD(151, '2413102', 'Hanam A', '31', 'Gyeonggi', 144860, 101657, { DPK: 51428, PPP: 50229 }, '추미애', 'DPK'),
mkD(152, '2413103', 'Hanam B', '31', 'Gyeonggi', 127378, 86601, { DPK: 44734, PPP: 37850, NFP: 4017 }, '김용만', 'DPK'),
mkD(153, '2413202', 'Paju A', '31', 'Gyeonggi', 226611, 145985, { DPK: 92611, PPP: 53374 }, '윤후덕', 'DPK'),
mkD(154, '2413203', 'Paju B', '31', 'Gyeonggi', 192812, 118055, { DPK: 64741, PPP: 53314 }, '박정', 'DPK'),
mkD(155, '2413301', 'Yeoju-Yangpyeong', '31', 'Gyeonggi', 211775, 139809, { PPP: 74916, DPK: 64893 }, '김선교', 'PPP'),
mkD(156, '2413401', 'Icheon', '31', 'Gyeonggi', 188859, 117261, { PPP: 60191, DPK: 57070 }, '송석준', 'PPP'),
mkD(157, '2413501', 'Yongin A', '31', 'Gyeonggi', 225977, 141432, { DPK: 71030, PPP: 61995, REF: 4543, IND: 3864 }, '이상식', 'DPK'),
mkD(158, '2413602', 'Yongin C', '31', 'Gyeonggi', 220492, 162225, { DPK: 81538, PPP: 80687 }, '부승찬', 'DPK'),
mkD(159, '2413701', 'Yongin B', '31', 'Gyeonggi', 229759, 157505, { DPK: 87739, PPP: 65676, REF: 4090 }, '손명수', 'DPK'),
mkD(160, '2413702', 'Yongin D', '31', 'Gyeonggi', 223886, 160900, { DPK: 82156, PPP: 75436, NFP: 3308 }, '이언주', 'DPK'),
mkD(161, '2413801', 'Anseong', '31', 'Gyeonggi', 165008, 103548, { DPK: 52517, PPP: 49049, REF: 1982 }, '윤종군', 'DPK'),
mkD(162, '2413902', 'Gimpo A', '31', 'Gyeonggi', 186262, 128677, { DPK: 69836, PPP: 58841 }, '김주영', 'DPK'),
mkD(163, '2413903', 'Gimpo B', '31', 'Gyeonggi', 209555, 134273, { DPK: 74556, PPP: 59717 }, '박상혁', 'DPK'),
mkD(164, '2414002', 'Gwangju A', '31', 'Gyeonggi', 163581, 104074, { DPK: 58631, PPP: 45443 }, '소병훈', 'DPK'),
mkD(165, '2414003', 'Gwangju B', '31', 'Gyeonggi', 170215, 105210, { DPK: 57935, PPP: 47275 }, '안태준', 'DPK'),
mkD(166, '2414102', 'Pocheon-Gapyeong', '31', 'Gyeonggi', 183868, 117269, { PPP: 59192, DPK: 56715, REF: 1362 }, '김용태', 'PPP'),
mkD(167, '2414801', 'Hwaseong A', '31', 'Gyeonggi', 221628, 135837, { DPK: 75916, PPP: 59921 }, '송옥주', 'DPK'),
mkD(168, '2414802', 'Hwaseong C', '31', 'Gyeonggi', 207233, 130179, { DPK: 80110, PPP: 48360, IND: 1709 }, '권칠승', 'DPK'),
mkD(169, '2414901', 'Hwaseong B', '31', 'Gyeonggi', 169135, 122260, { REF: 51856, DPK: 48578, PPP: 21826 }, '이준석', 'REF'),
mkD(170, '2414902', 'Hwaseong D', '31', 'Gyeonggi', 164120, 112071, { DPK: 62457, PPP: 38207, REF: 10344, IND: 1063 }, '전용기', 'DPK'),
mkD(171, '2415001', 'Bucheon B', '31', 'Gyeonggi', 214471, 147537, { DPK: 82475, PPP: 55975, NFP: 9087 }, '김기표', 'DPK'),
mkD(172, '2415101', 'Bucheon C', '31', 'Gyeonggi', 233948, 155918, { DPK: 84886, PPP: 59312, NFP: 11720 }, '이건태', 'DPK'),
mkD(173, '2415201', 'Bucheon A', '31', 'Gyeonggi', 232632, 140371, { DPK: 85815, PPP: 54556 }, '서영석', 'DPK'),
mkD(174, '2430101', 'Cheongju-Sangdang', '33', 'Chungbuk', 169036, 108065, { DPK: 55602, PPP: 49905, GJP: 1761, IND: 797 }, '이강일', 'DPK'),
mkD(175, '2430202', 'Cheongju-Heungdeok', '33', 'Chungbuk', 231288, 139805, { DPK: 72375, PPP: 62334, REF: 5096 }, '이연희', 'DPK'),
mkD(176, '2430301', 'Chungju', '33', 'Chungbuk', 181005, 117996, { PPP: 60314, DPK: 57682 }, '이종배', 'PPP'),
mkD(177, '2430401', 'Jecheon-Danyang', '33', 'Chungbuk', 139768, 94125, { PPP: 46532, DPK: 39007, IND: 4595, NFP: 3991 }, '엄태영', 'PPP'),
mkD(178, '2430601', 'Cheongju-Cheongwon', '33', 'Chungbuk', 158647, 98749, { DPK: 52620, PPP: 46129 }, '송재봉', 'DPK'),
mkD(179, '2430701', 'Boeun-Okcheon-Yeongdong-Goesan', '33', 'Chungbuk', 146169, 104346, { PPP: 55234, DPK: 49112 }, '박덕흠', 'PPP'),
mkD(180, '2431002', 'Jeungpyeong-Jincheon-Eumseong', '33', 'Chungbuk', 185137, 115600, { DPK: 62370, PPP: 53230 }, '임호선', 'DPK'),
mkD(181, '2431401', 'Cheongju-Seowon', '33', 'Chungbuk', 161145, 104523, { DPK: 54835, PPP: 49688 }, '이광희', 'DPK'),
mkD(182, '2440202', 'Gongju-Buyeo-Cheongyang', '34', 'Chungnam', 174418, 123616, { DPK: 62635, PPP: 59855, IND: 1126 }, '박수현', 'DPK'),
mkD(183, '2440301', 'Boryeong-Seocheon', '34', 'Chungnam', 128959, 90288, { PPP: 46505, DPK: 42802, IND: 981 }, '장동혁', 'PPP'),
mkD(184, '2440402', 'Asan A', '34', 'Chungnam', 125706, 78360, { DPK: 42153, PPP: 34555, NFP: 1652 }, '복기왕', 'DPK'),
mkD(185, '2440403', 'Asan B', '34', 'Chungnam', 160464, 97648, { DPK: 58932, PPP: 38716 }, '강훈식', 'DPK'),
mkD(186, '2440501', 'Seosan-Taean', '34', 'Chungnam', 204098, 136709, { PPP: 70487, DPK: 66222 }, '성일종', 'PPP'),
mkD(187, '2440901', 'Nonsan-Gyeryong-Geumsan', '34', 'Chungnam', 180091, 120258, { DPK: 61146, PPP: 56706, IND: 2406 }, '황명선', 'DPK'),
mkD(188, '2441301', 'Hongseong-Yesan', '34', 'Chungnam', 154563, 104015, { PPP: 57043, DPK: 46972 }, '강승규', 'PPP'),
mkD(189, '2441601', 'Dangjin', '34', 'Chungnam', 143594, 89140, { DPK: 46157, PPP: 42983 }, '어기구', 'DPK'),
mkD(190, '2441701', 'Cheonan B', '34', 'Chungnam', 182191, 106774, { DPK: 58862, PPP: 44628, IND: 3284 }, '이재관', 'DPK'),
mkD(191, '2441801', 'Cheonan A', '34', 'Chungnam', 216611, 127626, { DPK: 64562, PPP: 60178, REF: 2886 }, '문진석', 'DPK'),
mkD(192, '2441802', 'Cheonan C', '34', 'Chungnam', 154083, 96351, { DPK: 53189, PPP: 40098, GJP: 1364, REF: 1700 }, '이정문', 'DPK'),
mkD(193, '2460101', 'Mokpo', '36', 'Jeonnam', 181418, 115774, { DPK: 82700, IND: 15811, PPP: 6393, OTH: 4647, PROG: 3546, GJP: 2677 }, '김원이', 'DPK'),
mkD(194, '2460201', 'Yeosu A', '36', 'Jeonnam', 120250, 77725, { DPK: 69092, PPP: 8633 }, '주철현', 'DPK'),
mkD(195, '2460202', 'Yeosu B', '36', 'Jeonnam', 114061, 76178, { DPK: 51811, IND: 17044, PPP: 4032, PROG: 3291 }, '조계원', 'DPK'),
mkD(196, '2460403', 'Suncheon-Gwangyang-Gokseong-Gurye A', '36', 'Jeonnam', 191614, 132375, { DPK: 85172, PROG: 23890, IND: 11721, PPP: 11592 }, '김문수', 'DPK'),
mkD(197, '2460601', 'Naju-Hwasun', '36', 'Jeonnam', 154071, 104216, { DPK: 74063, PROG: 20593, PPP: 9560 }, '신정훈', 'DPK'),
mkD(198, '2460702', 'Suncheon-Gwangyang-Gokseong-Gurye B', '36', 'Jeonnam', 218521, 149064, { DPK: 104493, PPP: 35283, PROG: 9288 }, '권향엽', 'DPK'),
mkD(199, '2461501', 'Goheung-Boseong-Jangheung-Gangjin', '36', 'Jeonnam', 151441, 105137, { DPK: 95357, PPP: 9780 }, '문금주', 'DPK'),
mkD(200, '2461801', 'Haenam-Wando-Jindo', '36', 'Jeonnam', 124718, 84805, { DPK: 78324, PPP: 6481 }, '박지원', 'DPK'),
mkD(201, '2462101', 'Yeongam-Muan-Sinan', '36', 'Jeonnam', 156151, 105611, { DPK: 73053, IND: 21651, PPP: 6891, PROG: 3284, OTH: 732 }, '서삼석', 'DPK'),
mkD(202, '2462202', 'Damyang-Hampyeong-Yeonggwang-Jangseong', '36', 'Jeonnam', 151967, 108105, { DPK: 61042, IND: 38827, PPP: 4904, NFP: 2228, REF: 1104 }, '이개호', 'DPK'),
mkD(203, '2470101', 'Pohang-Buk', '37', 'Gyeongbuk', 228023, 146376, { PPP: 91249, DPK: 42311, IND: 12816 }, '김정재', 'PPP'),
mkD(204, '2470201', 'Pohang-Nam-Ulreung', '37', 'Gyeongbuk', 203445, 123860, { PPP: 86740, DPK: 37120 }, '이상휘', 'PPP'),
mkD(205, '2470401', 'Gyeongju', '37', 'Gyeongbuk', 217609, 139975, { PPP: 92074, DPK: 33968, IND: 12510, LUP: 1423 }, '김석기', 'PPP'),
mkD(206, '2470501', 'Gimcheon', '37', 'Gyeongbuk', 118478, 77841, { PPP: 51208, DPK: 18079, IND: 8554 }, '송언석', 'PPP'),
mkD(207, '2470601', 'Andong-Yecheon', '37', 'Gyeongbuk', 181285, 120107, { PPP: 81040, DPK: 34748, IND: 2328, LUP: 1991 }, '김형동', 'PPP'),
mkD(208, '2470701', 'Gumi A', '37', 'Gyeongbuk', 173050, 104849, { PPP: 76100, DPK: 28749 }, '구자근', 'PPP'),
mkD(209, '2470702', 'Gumi B', '37', 'Gyeongbuk', 164338, 93681, { PPP: 61166, DPK: 31261, LUP: 1254 }, '강명구', 'PPP'),
mkD(210, '2470803', 'Yeongju-Yeongyang-Bonghwa', '37', 'Gyeongbuk', 129648, 87258, { PPP: 64325, DPK: 22933 }, '임종득', 'PPP'),
mkD(211, '2470901', 'Yeongcheon-Cheongdo', '37', 'Gyeongbuk', 128322, 87441, { PPP: 54987, DPK: 17083, IND: 15371 }, '이만희', 'PPP'),
mkD(212, '2471002', 'Sangju-Mungyeong', '37', 'Gyeongbuk', 144308, 98627, { PPP: 76583, DPK: 18578, NFP: 3466 }, '임이자', 'PPP'),
mkD(213, '2471302', 'Gyeongsan', '37', 'Gyeongbuk', 231226, 143689, { PPP: 62411, IND: 60746, PROG: 11488, GJP: 9044 }, '조지연', 'PPP'),
mkD(214, '2471701', 'Goryeong-Seongju-Chilgok', '37', 'Gyeongbuk', 160408, 101910, { PPP: 77692, DPK: 21901, IND: 2317 }, '정희용', 'PPP'),
mkD(215, '2471903', 'Euiseong-Cheongsong-Yeongdeok-Uljin', '37', 'Gyeongbuk', 141262, 96593, { PPP: 80495, IND: 16098 }, '박형수', 'PPP'),
mkD(216, '2480301', 'Jinju A', '38', 'Gyeongnam', 167725, 113789, { PPP: 66339, DPK: 47450 }, '박대출', 'PPP'),
mkD(217, '2480302', 'Jinju B', '38', 'Gyeongnam', 121959, 81214, { PPP: 45590, DPK: 24540, IND: 11084 }, '강민국', 'PPP'),
mkD(218, '2480501', 'Tongyeong-Goseong', '38', 'Gyeongnam', 147305, 99675, { PPP: 61251, DPK: 38424 }, '정점식', 'PPP'),
mkD(219, '2480702', 'Sacheon-Namhae-Hadong', '38', 'Gyeongnam', 169430, 116480, { PPP: 64750, DPK: 37664, IND: 14066 }, '서천호', 'PPP'),
mkD(220, '2480801', 'Gimhae A', '38', 'Gyeongnam', 222271, 140822, { DPK: 73901, PPP: 66921 }, '민홍철', 'DPK'),
mkD(221, '2480802', 'Gimhae B', '38', 'Gyeongnam', 223355, 143599, { DPK: 80695, PPP: 62904 }, '김정호', 'DPK'),
mkD(222, '2480901', 'Miryang-Euiryeong-Haman-Changnyeong', '38', 'Gyeongnam', 218917, 144261, { PPP: 96450, DPK: 47811 }, '박상웅', 'PPP'),
mkD(223, '2481001', 'Geoje', '38', 'Gyeongnam', 191224, 128019, { PPP: 65590, DPK: 59753, REF: 2676 }, '서일준', 'PPP'),
mkD(224, '2481402', 'Yangsan A', '38', 'Gyeongnam', 151262, 99894, { PPP: 53560, DPK: 44735, REF: 1599 }, '윤영석', 'PPP'),
mkD(225, '2481403', 'Yangsan B', '38', 'Gyeongnam', 146338, 99285, { PPP: 50685, DPK: 48600 }, '김태호', 'PPP'),
mkD(226, '2481901', 'Sancheong-Hamyang-Geochang-Hapcheon', '38', 'Gyeongnam', 154837, 106463, { PPP: 75582, DPK: 30881 }, '신성범', 'PPP'),
mkD(227, '2482101', 'Changwon-Euichang', '38', 'Gyeongnam', 182326, 120770, { PPP: 69210, DPK: 51560 }, '김종양', 'PPP'),
mkD(228, '2482201', 'Changwon-Seongsan', '38', 'Gyeongnam', 208594, 145507, { DPK: 67489, PPP: 66507, GJP: 11511 }, '허성무', 'DPK'),
mkD(229, '2482301', 'Changwon-Masanhappo', '38', 'Gyeongnam', 155430, 103488, { PPP: 66283, DPK: 37205 }, '최형두', 'PPP'),
mkD(230, '2482401', 'Changwon-Masanhoewon', '38', 'Gyeongnam', 156812, 106702, { PPP: 63778, DPK: 42924 }, '윤한홍', 'PPP'),
mkD(231, '2482501', 'Changwon-Jinhae', '38', 'Gyeongnam', 158141, 101703, { PPP: 51100, DPK: 50603 }, '이종욱', 'PPP'),
mkD(232, '2490101', 'Jeju A', '39', 'Jeju', 213825, 125279, { DPK: 78776, PPP: 46503 }, '문대림', 'DPK'),
mkD(233, '2490102', 'Jeju B', '39', 'Jeju', 194949, 121861, { DPK: 78774, PPP: 38948, GJP: 4139 }, '김한규', 'DPK'),
mkD(234, '2490201', 'Seogwipo', '39', 'Jeju', 155750, 99672, { DPK: 53831, PPP: 45841 }, '위성곤', 'DPK'),
mkD(235, '2510101', 'Sejong A', '29', 'Sejong', 171472, 115221, { NFP: 65599, PPP: 49622 }, '김종민', 'NFP'),
mkD(236, '2510102', 'Sejong B', '29', 'Sejong', 129759, 88297, { DPK: 49621, PPP: 33148, REF: 4104, IND: 1250, OTH: 174 }, '강준현', 'DPK'),
mkD(237, '2520101', 'Chuncheon-Cheorwon-Hwacheon-Yanggu A', '32', 'Gangwon', 196972, 131495, { DPK: 70273, PPP: 58542, NFP: 1402, IND: 1278 }, '허영', 'DPK'),
mkD(238, '2520102', 'Chuncheon-Cheorwon-Hwacheon-Yanggu B', '32', 'Gangwon', 124089, 81452, { PPP: 43935, DPK: 33774, IND: 3743 }, '한기호', 'PPP'),
mkD(239, '2520201', 'Wonju A', '32', 'Gangwon', 159375, 102536, { PPP: 52002, DPK: 50534 }, '박정하', 'PPP'),
mkD(240, '2520202', 'Wonju B', '32', 'Gangwon', 148344, 97839, { DPK: 52920, PPP: 44919 }, '송기헌', 'DPK'),
mkD(241, '2520301', 'Gangreung', '32', 'Gangwon', 183878, 119356, { PPP: 64743, DPK: 51731, REF: 2882 }, '권성동', 'PPP'),
mkD(242, '2520401', 'Donghae-Taebaek-Samcheok-Jeongseon', '32', 'Gangwon', 196849, 127931, { PPP: 78325, DPK: 46674, REF: 2932 }, '이철규', 'PPP'),
mkD(243, '2520801', 'Sokcho-Inje-Goseong-Yangyang', '32', 'Gangwon', 148964, 98014, { PPP: 54738, DPK: 43276 }, '이양수', 'PPP'),
mkD(244, '2521401', 'Hongcheon-Hoengseong-Yeongwol-Pyeongchang', '32', 'Gangwon', 173056, 118214, { PPP: 68226, DPK: 49988 }, '유상범', 'PPP'),
mkD(245, '2530101', 'Jeonju A', '35', 'Jeonbuk', 163995, 107071, { DPK: 83081, PPP: 12867, NFP: 6594, IND: 4529 }, '김윤덕', 'DPK'),
mkD(246, '2530102', 'Jeonju B', '35', 'Jeonbuk', 166404, 111530, { DPK: 74038, PPP: 23014, PROG: 12828, IND: 1075, OTH: 575 }, '이성윤', 'DPK'),
mkD(247, '2530201', 'Jeonju C', '35', 'Jeonbuk', 212820, 143026, { DPK: 117407, PPP: 17589, GJP: 8030 }, '정동영', 'DPK'),
mkD(248, '2530301', 'Gunsan-Gimje-Buan A', '35', 'Jeonbuk', 214985, 132936, { DPK: 115297, PPP: 17639 }, '신영대', 'DPK'),
mkD(249, '2530501', 'Iksan A', '35', 'Jeonbuk', 117633, 76492, { DPK: 58984, PPP: 7743, PROG: 6193, NFP: 3572 }, '이춘석', 'DPK'),
mkD(250, '2530502', 'Iksan B', '35', 'Jeonbuk', 116493, 74717, { DPK: 65027, PPP: 8288, LUP: 1402 }, '한병도', 'DPK'),
mkD(251, '2530701', 'Jeongeup-Gochang', '35', 'Jeonbuk', 137963, 91632, { DPK: 79593, PPP: 9595, LUP: 2444 }, '윤준병', 'DPK'),
mkD(252, '2530801', 'Namwon-Jangsu-Imsil-Sunchang', '35', 'Jeonbuk', 133870, 94439, { DPK: 79169, PPP: 11035, NFP: 2163, OTH: 2072 }, '박희승', 'DPK'),
mkD(253, '2530901', 'Gunsan-Gimje-Buan B', '35', 'Jeonbuk', 124423, 83633, { DPK: 72455, PPP: 8007, IND: 3171 }, '이원택', 'DPK'),
mkD(254, '2531001', 'Wanju-Jinan-Muju', '35', 'Jeonbuk', 128570, 86939, { DPK: 73236, PPP: 13703 }, '안호영', 'DPK'),
];

// geojson SGG_Code → internal nr
export const KR_CODE_TO_NR: Record<string, number> =
  Object.fromEntries(KR_DISTRICTS.map(d => [d.code, d.nr]));

// ── Official 2024 party-list (PR) votes ───────────────────────────────────────
export const PR_VOTES_2024: Partial<Record<KrPartyId, number>> = {
  PFP: 10395264,
  DEMALL: 7567459,
  RKP: 6874278,
  REF: 1025775,
  LUP: 642433,
  GJP: 609313,
  NFP: 483827,
};
export const PR_GRAND_TOTAL_2024 = 28344519;

// ── Region names (17 first-level divisions) ───────────────────────────────────
export const SIDO_NAMES: Record<string, string> = {
  '11': 'Seoul', '21': 'Busan', '22': 'Daegu', '23': 'Incheon', '24': 'Gwangju',
  '25': 'Daejeon', '26': 'Ulsan', '29': 'Sejong', '31': 'Gyeonggi', '32': 'Gangwon',
  '33': 'Chungbuk', '34': 'Chungnam', '35': 'Jeonbuk', '36': 'Jeonnam',
  '37': 'Gyeongbuk', '38': 'Gyeongnam', '39': 'Jeju',
};
export const SIDO_NAMES_KO: Record<string, string> = {
  '11': '서울', '21': '부산', '22': '대구', '23': '인천', '24': '광주',
  '25': '대전', '26': '울산', '29': '세종', '31': '경기', '32': '강원',
  '33': '충북', '34': '충남', '35': '전북', '36': '전남',
  '37': '경북', '38': '경남', '39': '제주',
};

// ── Party leaders (wikiTitle drives Wikipedia photo fetch) ─────────────────────
export const KR_LEADERS: Partial<Record<KrPartyId, { name: string; wikiTitle?: string }>> = {
  DPK:    { name: 'Lee Jae-myung',  wikiTitle: 'Lee_Jae-myung' },
  PPP:    { name: 'Han Dong-hoon',  wikiTitle: 'Han_Dong-hoon' },
  RKP:    { name: 'Cho Kuk',        wikiTitle: 'Cho_Kuk' },
  REF:    { name: 'Lee Jun-seok',   wikiTitle: 'Lee_Jun-seok' },
  NFP:    { name: 'Lee Nak-yon',    wikiTitle: 'Lee_Nak-yon' },
  PROG:   { name: 'Yoon Jong-oh' },
  GJP:    { name: 'Sim Sang-jung',  wikiTitle: 'Sim_Sang-jung' },
  DEMALL: { name: 'Democratic Alliance' },
  PFP:    { name: 'People Future Party' },
  LUP:    { name: 'Liberty Unification' },
  IND:    { name: 'Independents' },
  OTH:    { name: 'Others' },
};
// Current party leaders as of May 2026 (post-2025 realignment: Lee Jae-myung president;
// shown on the 2026-polling, blank-map and simulation scoreboards). Names verified via
// live sources; only Jang Dong-hyuk has a confirmed English-Wikipedia photo.
export const KR_LEADERS_2026: Partial<Record<KrPartyId, { name: string; wikiTitle?: string }>> = {
  DPK:  { name: 'Jung Cheong-rae', wikiTitle: 'Jung_Chung-rae' },              // 정청래 — DPK leader
  PPP:  { name: 'Jang Dong-hyuk',  wikiTitle: 'Jang_Dong-hyuk' },              // 장동혁 — PPP leader
  PROG: { name: 'Kim Jae-yeon',    wikiTitle: 'Kim_Jae-yeon_(politician)' },   // 김재연 — Progressive co-chair
  GJP:  { name: 'Kwon Young-guk',  wikiTitle: 'Kwon_Yeong-guk' },              // 권영국 — Justice Party leader
  // RKP (Cho Kuk), REF (Lee Jun-seok), NFP (Lee Nak-yon) unchanged — fall back to KR_LEADERS.
};

// ── Seat allocation ───────────────────────────────────────────────────────────
// FPTP constituency winners
export function calcConstituencySeats(
  districts: KrDistrict[],
  currentResults: Record<number, Partial<Record<KrPartyId, number>>>,
): Partial<Record<KrPartyId, number>> {
  const tally: Partial<Record<KrPartyId, number>> = {};
  for (const d of districts) {
    const res = currentResults[d.nr] ?? d.votes;
    let winner: KrPartyId | null = null, max = 0;
    for (const [pid, v] of Object.entries(res) as [KrPartyId, number][]) {
      if (v > max) { max = v; winner = pid; }
    }
    if (winner) tally[winner] = (tally[winner] ?? 0) + 1;
  }
  return tally;
}

// largest-remainder allocation of `seats` proportional to `weights`
function largestRemainder(ids: KrPartyId[], weights: Record<string, number>, seats: number): Partial<Record<KrPartyId, number>> {
  const out: Partial<Record<KrPartyId, number>> = {};
  const wsum = ids.reduce((s, id) => s + (weights[id] ?? 0), 0);
  if (wsum <= 0 || seats <= 0) { for (const id of ids) out[id] = 0; return out; }
  const rema: [KrPartyId, number][] = [];
  let used = 0;
  for (const id of ids) {
    const q = (weights[id] ?? 0) / wsum * seats;
    const f = Math.floor(q);
    out[id] = f; used += f; rema.push([id, q - f]);
  }
  rema.sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < seats - used; i++) out[rema[i % rema.length][0]] = (out[rema[i % rema.length][0]] ?? 0) + 1;
  return out;
}

// 준연동형 (semi-linked) PR allocation — all 46 seats linked (2024 rules)
export function calcPRSeats(
  prVotes: Partial<Record<KrPartyId, number>>,
  constituencySeats: Partial<Record<KrPartyId, number>>,
): { prSeats: Partial<Record<KrPartyId, number>>; eligible: Set<KrPartyId> } {
  let grand = 0;
  for (const v of Object.values(prVotes)) grand += v ?? 0;

  // eligible: ≥3% PR OR ≥5 constituency seats (Others never seated via PR here)
  const eligible = new Set<KrPartyId>();
  for (const p of KR_PARTIES) {
    if (p.id === 'OTH' || p.id === 'IND') continue;
    const pct = grand > 0 ? ((prVotes[p.id] ?? 0) / grand) * 100 : 0;
    if (pct >= PR_THRESHOLD_PCT || (constituencySeats[p.id] ?? 0) >= DIRECT_THRESHOLD) eligible.add(p.id);
  }

  // X = constituency winners from NON-eligible parties / independents
  let X = 0;
  for (const [pid, n] of Object.entries(constituencySeats) as [KrPartyId, number][]) {
    if (!eligible.has(pid)) X += n;
  }

  // normalized PR share among eligible *list* parties
  const elig = [...eligible];
  const eligVoteSum = elig.reduce((s, id) => s + (prVotes[id] ?? 0), 0);

  const linked: Record<string, number> = {};
  let linkedSum = 0;
  for (const id of elig) {
    const share = eligVoteSum > 0 ? (prVotes[id] ?? 0) / eligVoteSum : 0;
    const raw = ((ASSEMBLY_TOTAL - X) * share - (constituencySeats[id] ?? 0)) / 2;
    const v = Math.max(0, Math.round(raw));
    linked[id] = v; linkedSum += v;
  }

  let prSeats: Partial<Record<KrPartyId, number>>;
  if (linkedSum <= PR_SEATS) {
    // assign linked, then distribute remainder in parallel by PR share
    prSeats = {};
    for (const id of elig) prSeats[id] = linked[id];
    const remain = PR_SEATS - linkedSum;
    if (remain > 0) {
      const shares: Record<string, number> = {};
      for (const id of elig) shares[id] = prVotes[id] ?? 0;
      const extra = largestRemainder(elig, shares, remain);
      for (const id of elig) prSeats[id] = (prSeats[id] ?? 0) + (extra[id] ?? 0);
    }
  } else {
    // scale down: allocate all 46 proportional to linked values (조정의석)
    prSeats = largestRemainder(elig, linked, PR_SEATS);
  }
  return { prSeats, eligible };
}

export interface AssemblyResult {
  constituencySeats: Partial<Record<KrPartyId, number>>;
  prSeats:           Partial<Record<KrPartyId, number>>;
  totalSeats:        Partial<Record<KrPartyId, number>>;
  eligible:          Set<KrPartyId>;
}

export function calcAssembly(
  districts: KrDistrict[],
  currentResults: Record<number, Partial<Record<KrPartyId, number>>>,
  prVotes: Partial<Record<KrPartyId, number>>,
): AssemblyResult {
  const constituencySeats = calcConstituencySeats(districts, currentResults);
  const { prSeats, eligible } = calcPRSeats(prVotes, constituencySeats);
  const totalSeats: Partial<Record<KrPartyId, number>> = {};
  for (const p of KR_PARTIES) {
    const t = (constituencySeats[p.id] ?? 0) + (prSeats[p.id] ?? 0);
    if (t > 0) totalSeats[p.id] = t;
  }
  return { constituencySeats, prSeats, totalSeats, eligible };
}
