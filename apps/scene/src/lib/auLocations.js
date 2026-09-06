import { postcodeState } from './geo';
/* ⚠ auLocations → geo is safe: geo imports only ./postcodes, never this file. */

// suburb / city name → postcode(s)
// Used in Discover location filter so users can type a suburb name instead of a postcode
export const SUBURB_MAP = {
  // ── NSW – Sydney inner ───────────────────────────────────────────────
  "sydney":["2000"],"haymarket":["2000"],"the rocks":["2000"],"barangaroo":["2000"],
  "pyrmont":["2009"],"ultimo":["2007"],"chippendale":["2008"],
  "surry hills":["2010"],"darlinghurst":["2010"],
  "kings cross":["2011"],"potts point":["2011"],"elizabeth bay":["2011"],
  "woolloomooloo":["2011"],"rushcutters bay":["2027"],
  "paddington":["2021","4064"],"woollahra":["2025"],"edgecliff":["2027"],
  "bondi":["2026"],"bondi beach":["2026"],"bondi junction":["2022"],
  "coogee":["2034"],"randwick":["2031"],"kingsford":["2032"],
  "maroubra":["2035"],"mascot":["2020"],"alexandria":["2015"],
  "erskineville":["2043"],"st peters":["2044","5069"],"sydenham":["2044","8023"],
  "newtown":["2042","3220","6021"],"enmore":["2042"],"marrickville":["2204"],
  "dulwich hill":["2203"],"petersham":["2049"],"stanmore":["2048"],
  "leichhardt":["2040"],"annandale":["2038"],"glebe":["2037","7000"],
  "forest lodge":["2037"],"rozelle":["2039"],"balmain":["2041"],
  "lilyfield":["2040"],"five dock":["2046"],
  "redfern":["2016"],"waterloo":["2017"],"zetland":["2017"],
  "green square":["2017"],"beaconsfield":["2015","3807","6162"],
  "north sydney":["2060"],"milsons point":["2061"],"kirribilli":["2061"],
  "mcmahons point":["2060"],"lavender bay":["2060"],
  "neutral bay":["2089"],"cremorne":["2090","3121"],"mosman":["2088"],
  "spit junction":["2088"],"balgowlah":["2093"],
  "manly":["2095"],"freshwater":["2096"],"dee why":["2099"],
  "brookvale":["2100"],"mona vale":["2103"],"avalon":["2107"],
  "palm beach":["2108","4221"],"newport":["2106","3015"],"narrabeen":["2101"],
  "chatswood":["2067"],"lane cove":["2066"],"artarmon":["2064"],
  "st leonards":["2065"],"crows nest":["2065"],"waverton":["2060"],
  "hornsby":["2077"],"wahroonga":["2076"],"turramurra":["2074"],
  "pymble":["2073"],"gordon":["2072"],"killara":["2071"],
  "lindfield":["2070"],"roseville":["2069"],
  "epping":["2121"],"meadowbank":["2114"],"ryde":["2112"],
  "parramatta":["2150"],"westmead":["2145"],"wentworthville":["2145"],
  "penrith":["2750"],"st marys":["2760"],"mt druitt":["2770"],
  "blacktown":["2148"],"seven hills":["2147"],"toongabbie":["2146"],
  "liverpool":["2170"],"fairfield":["2165"],"cabramatta":["2166"],
  "bankstown":["2200"],"campsie":["2194"],"ashfield":["2131"],
  "summer hill":["2130"],"burwood":["2134"],"strathfield":["2135"],
  "hurstville":["2220"],"kogarah":["2217"],"rockdale":["2216"],
  "arncliffe":["2205"],"wolli creek":["2205"],
  "cronulla":["2230"],"caringbah":["2229"],"sutherland":["2232"],
  "miranda":["2228"],"como":["2226"],"engadine":["2233"],
  "wollongong":["2500"],"north wollongong":["2500"],"figtree":["2525"],
  "thirroul":["2515"],"bulli":["2516"],"helensburgh":["2508"],
  "newcastle":["2300"],"newcastle west":["2302"],"hamilton":["2303","3204","3300","4007","7140"],
  "islington":["2296"],"maryville":["2293"],"wickham":["2293"],
  "cooks hill":["2300"],"bar beach":["2300"],"merewether":["2291"],
  "mayfield":["2304"],"broadmeadow":["2292"],"charlestown":["2290"],
  "toronto":["2283"],"lake macquarie":["2285"],"speers point":["2284"],
  "gosford":["2250"],"wyong":["2259"],"central coast":["2250"],
  "terrigal":["2260"],"wamberal":["2260"],"avoca beach":["2251"],

  // ── NSW – Regional ───────────────────────────────────────────────────
  "byron bay":["2481"],"bangalow":["2479"],"mullumbimby":["2482"],
  "brunswick heads":["2483"],"ocean shores":["2483"],
  "lismore":["2480"],"ballina":["2478"],"lennox head":["2478"],
  "nimbin":["2480"],"kyogle":["2474"],
  "grafton":["2460"],"maclean":["2463"],
  "coffs harbour":["2450"],"sawtell":["2452"],"toormina":["2452"],
  "bellingen":["2454"],"dorrigo":["2453"],
  "nambucca heads":["2448"],"macksville":["2447"],
  "port macquarie":["2444"],"wauchope":["2446"],
  "taree":["2430"],"forster":["2428"],"tuncurry":["2428"],
  "tamworth":["2340"],"armidale":["2350"],"inverell":["2360"],
  "glen innes":["2370"],"tenterfield":["2372"],
  "narrabri":["2390"],"moree":["2400"],
  "dubbo":["2830"],"orange":["2800"],"bathurst":["2795"],
  "cowra":["2794"],"young":["2594"],"forbes":["2871"],
  "parkes":["2870"],"mudgee":["2850"],"gulgong":["2852"],
  "katoomba":["2780"],"leura":["2780"],"springwood":["2777"],"richmond":["2753","3121","7020"],"windsor":["2756","3181","4030"],
  "bowral":["2576"],"moss vale":["2577"],"mittagong":["2575"],
  "nowra":["2541"],"bomaderry":["2541"],"ulladulla":["2539"],
  "batemans bay":["2536"],"moruya":["2537"],"narooma":["2546"],
  "merimbula":["2548"],"eden":["2551"],"pambula":["2549"],
  "cooma":["2630"],"jindabyne":["2627"],"berridale":["2628"],
  "queanbeyan":["2620"],"goulburn":["2580"],"yass":["2582"],

  // ── ACT ──────────────────────────────────────────────────────────────
  "canberra":["2600","2601","2602"],"braddon":["2612"],
  "new acton":["2601"],"civic":["2601"],
  "kingston":["2604","7050"],"manuka":["2603"],"griffith":["2603"],
  "deakin":["2600"],"barton":["2600"],"forrest":["2603"],
  "yarralumla":["2600"],"reid":["2612"],"ainslie":["2602"],
  "watson":["2602"],"downer":["2602"],"hackett":["2602"],
  "dickson":["2602"],"o'connor":["2602"],"turner":["2612"],
  "belconnen":["2617"],"bruce":["2617"],"macquarie":["2614"],
  "tuggeranong":["2900"],"greenway":["2900"],"kambah":["2902"],
  "woden":["2606"],"phillip":["2606"],"curtin":["2605"],
  "gungahlin":["2912"],"hall":["2618"],

  // ── VIC – Melbourne inner ─────────────────────────────────────────────
  "melbourne":["3000"],"cbd":["3000"],"docklands":["3008"],
  "southbank":["3006"],"south wharf":["3006"],
  "fitzroy":["3065"],"fitzroy north":["3068"],
  "collingwood":["3066"],"abbotsford":["3067"],
  "brunswick":["3056"],"brunswick east":["3057"],"brunswick west":["3055"],
  "northcote":["3070"],"thornbury":["3071"],"preston":["3072"],
  "reservoir":["3073"],"coburg":["3058"],"coburg north":["3058"],
  "carlton":["3053"],"carlton north":["3054"],"parkville":["3052"],
  "north melbourne":["3051"],"west melbourne":["3003"],
  "south melbourne":["3205"],"port melbourne":["3207"],
  "st kilda":["3182"],"st kilda east":["3183"],"st kilda west":["3182"],
  "elwood":["3184"],"balaclava":["3183"],"ripponlea":["3185"],
  "elsternwick":["3185"],"gardenvale":["3185"],
  "prahran":["3181"],"hawksburn":["3142"],
  "south yarra":["3141"],"toorak":["3142"],
  "armadale":["3143"],"malvern":["3144","5061"],"malvern east":["3145"],
  "glen iris":["3146"],"hawthorn":["3122"],"hawthorn east":["3123"],
  "camberwell":["3124"],"glen waverley":["3150"],
  "box hill":["3128"],"box hill north":["3129"],"box hill south":["3128"],
  "doncaster":["3108"],"templestowe":["3106"],
  "heidelberg":["3084"],"heidelberg west":["3081"],
  "ivanhoe":["3079"],"eaglemont":["3084"],
  "kew":["3101"],"kew east":["3102"],"balwyn":["3103"],"balwyn north":["3104"],
  "essendon":["3040"],"essendon north":["3041"],"moonee ponds":["3039"],
  "flemington":["3031"],"kensington":["3031"],"ascot vale":["3032"],
  "footscray":["3011"],"seddon":["3011"],"yarraville":["3013"],"williamstown":["3016"],"altona":["3018"],
  "sunshine":["3020"],"albion":["3020","4010"],"st albans":["3021"],
  "frankston":["3199"],"seaford":["3198"],"langwarrin":["3910"],
  "dandenong":["3175"],"springvale":["3171"],
  "ringwood":["3134"],"croydon":["3136"],"mooroolbark":["3138"],
  "lilydale":["3140"],"yarra glen":["3775"],
  "berwick":["3806"],"cranbourne":["3977"],"pakenham":["3810"],
  "officer":["3809"],
  "geelong":["3220"],"geelong west":["3218"],
  "torquay":["3228"],"jan juc":["3228"],"anglesea":["3230"],
  "lorne":["3232"],"apollo bay":["3233"],
  "barwon heads":["3227"],"ocean grove":["3226"],"portarlington":["3223"],
  "queenscliff":["3225"],"point lonsdale":["3225"],
  "sorrento":["3943"],"portsea":["3944"],"rye":["3941"],"rosebud":["3939"],
  "dromana":["3936"],"mornington":["3931"],"mount martha":["3934"],"phillip island":["3922"],"cowes":["3922"],
  "ballarat":["3350"],"ballarat east":["3350"],"ballarat central":["3350"],
  "wendouree":["3355"],"sebastopol":["3356"],
  "bendigo":["3550"],"flora hill":["3550"],"long gully":["3550"],
  "castlemaine":["3450"],"chewton":["3451"],"maldon":["3463"],
  "daylesford":["3460"],"hepburn springs":["3461"],"clunes":["3462"],
  "maryborough":["3465","4650"],"dunolly":["3472"],
  "ararat":["3377"],"stawell":["3380"],"horsham":["3400"],"portland":["3305"],"warrnambool":["3280"],
  "colac":["3250"],"camperdown":["3260"],"terang":["3264"],
  "shepparton":["3630"],"mooroopna":["3629"],"tatura":["3616"],
  "wodonga":["3690"],"albury":["2640"],"wangaratta":["3677"],
  "benalla":["3672"],"seymour":["3660"],"kilmore":["3764"],
  "bright":["3741"],"myrtleford":["3737"],"mount beauty":["3699"],
  "healesville":["3777"],"yarra valley":["3775"],"warburton":["3799"],
  "macedon":["3440"],"woodend":["3442"],"kyneton":["3444"],
  "malmsbury":["3446"],"lancefield":["3435"],"romsey":["3434"],
  "mildura":["3500"],"red cliffs":["3496"],"ouyen":["3490"],
  "sale":["3850"],"maffra":["3860"],"bairnsdale":["3875"],
  "lakes entrance":["3909"],"orbost":["3888"],"mallacoota":["3892"],

  // ── QLD – Brisbane inner ──────────────────────────────────────────────
  "brisbane":["4000"],"brisbane city":["4000"],"spring hill":["4000"],
  "fortitude valley":["4006"],"the valley":["4006"],"valley":["4006"],
  "new farm":["4005"],"newstead":["4006"],"teneriffe":["4005"],
  "kangaroo point":["4169"],"east brisbane":["4169"],
  "west end":["4101"],"south brisbane":["4101"],"highgate hill":["4101"],
  "woolloongabba":["4102"],"stones corner":["4120"],"red hill":["4059"],"kelvin grove":["4059"],
  "milton":["4064"],"toowong":["4066"],"st lucia":["4067"],
  "indooroopilly":["4068"],"taringa":["4068"],"chapel hill":["4069"],
  "bowen hills":["4006"],"clayfield":["4011"],
  "ascot":["4007"],"eagle farm":["4009"],
  "nundah":["4012"],"hendra":["4011"],"northgate":["4013"],"lutwyche":["4030"],"gordon park":["4031"],
  "kedron":["4031"],"chermside":["4032"],"stafford":["4053"],
  "morningside":["4170"],"hawthorne":["4171"],"balmoral":["4171"],
  "bulimba":["4171"],"camp hill":["4152"],"norman park":["4170"],
  "coorparoo":["4151"],"greenslopes":["4120"],"annerley":["4103"],
  "moorooka":["4105"],"yeronga":["4104"],"tarragindi":["4121"],
  "sunnybank":["4109"],"runcorn":["4113"],
  "gold coast":["4217"],"surfers paradise":["4217"],
  "broadbeach":["4218"],"mermaid beach":["4218"],
  "burleigh heads":["4220"],"burleigh":["4220"],"coolangatta":["4225"],"robina":["4226"],
  "helensvale":["4212"],"coomera":["4209"],"oxenford":["4210"],
  "southport":["4215"],"labrador":["4215"],"biggera waters":["4216"],
  "nerang":["4211"],"mudgeeraba":["4213"],"currumbin":["4223"],
  "ipswich":["4305"],"toowoomba":["4350"],"darling heights":["4350"],
  "sunshine coast":["4551"],"caloundra":["4551"],
  "mooloolaba":["4557"],"maroochydore":["4558"],"cotton tree":["4558"],
  "noosa":["4567"],"noosaville":["4566"],"noosa heads":["4567"],
  "coolum beach":["4573"],"peregian beach":["4573"],
  "buderim":["4556"],"mountain creek":["4557"],
  "caboolture":["4510"],"redcliffe":["4020"],"deception bay":["4508"],
  "cairns":["4870"],"cairns north":["4870"],"earlville":["4870"],
  "port douglas":["4877"],"mossman":["4873"],
  "townsville":["4810"],"thuringowa":["4817"],"kirwan":["4817"],
  "rockhampton":["4700"],"north rockhampton":["4701"],
  "mackay":["4740"],"north mackay":["4740"],
  "bundaberg":["4670"],"bundaberg north":["4670"],
  "hervey Bay":["4655"],"urangan":["4655"],"pialba":["4655"],"gympie":["4570"],
  "mount isa":["4825"],"charters towers":["4820"],

  // ── SA – Adelaide ─────────────────────────────────────────────────────
  "adelaide":["5000"],"adelaide cbd":["5000"],
  "north adelaide":["5006"],"bowden":["5007"],"hindmarsh":["5007"],
  "prospect":["5082"],"nailsworth":["5083"],"broadview":["5083"],
  "norwood":["5067"],"kent town":["5067"],"hackney":["5069"],
  "stepney":["5069"],
  "thebarton":["5031"],"mile end":["5031"],"torrensville":["5031"],
  "parkside":["5063"],"unley":["5061"],
  "mitcham":["5062"],"lower mitcham":["5062"],
  "glenelg":["5045"],"glenelg north":["5045"],"glenelg south":["5045"],
  "henley beach":["5022"],"fulham":["5024"],"west beach":["5024"],
  "semaphore":["5019"],"port adelaide":["5015"],"exeter":["5019"],
  "woodville":["5011"],"pennington":["5013"],
  "gawler":["5118"],"elizabeth":["5112"],"salisbury":["5108"],
  "mount barker":["5251"],"hahndorf":["5245"],"stirling":["5152","6021"],
  "victor harbor":["5211"],"goolwa":["5214"],
  "mclaren vale":["5171"],"willunga":["5172"],"aldinga":["5173"],
  "port elliot":["5212"],"middleton":["5213"],
  "barossa valley":["5352"],"nuriootpa":["5355"],"tanunda":["5352"],
  "mount gambier":["5290"],"naracoorte":["5271"],"bordertown":["5268"],
  "whyalla":["5600"],"port augusta":["5700"],"port pirie":["5540"],

  // ── WA – Perth ────────────────────────────────────────────────────────
  "perth":["6000"],"perth cbd":["6000"],
  "northbridge":["6003"],"highgate":["6003"],"east perth":["6004"],
  "west perth":["6005"],"leederville":["6007"],
  "mount lawley":["6050"],"inglewood":["6052"],"maylands":["6051"],
  "bayswater":["6053"],"guildford":["6055"],"midland":["6056"],
  "subiaco":["6008"],"nedlands":["6009"],"claremont":["6010","7011"],
  "cottesloe":["6011"],"peppermint grove":["6011"],
  "mosman park":["6012"],"dalkeith":["6009"],"crawley":["6009"],
  "floreat":["6014"],"wembley":["6014"],"west leederville":["6007"],
  "scarborough":["6019"],"karrinyup":["6018"],
  "churchlands":["6018"],"joondanna":["6060"],"tuart hill":["6060"],
  "victoria park":["6100"],"carlisle":["6101"],"lathlain":["6100"],
  "fremantle":["6160"],"north fremantle":["6159"],"east fremantle":["6158"],
  "white gum valley":["6162"],"hilton":["6163"],
  "joondalup":["6027"],"wanneroo":["6065"],"ellenbrook":["6069"],
  "mandurah":["6210"],"rockingham":["6168"],"baldivis":["6171"],
  "bunbury":["6230"],"busselton":["6280"],"margaret river":["6285"],
  "albany":["6330"],"denmark":["6333"],
  "geraldton":["6530"],"kalgoorlie":["6430"],"boulder":["6432"],
  "broome":["6725"],"port hedland":["6721"],"karratha":["6714"],
  "exmouth":["6707"],"carnarvon":["6701"],

  // ── TAS ───────────────────────────────────────────────────────────────
  "hobart":["7000"],"hobart cbd":["7000"],
  "north hobart":["7000"],"west hobart":["7000"],
  "battery point":["7004"],"south hobart":["7004"],
  "new town":["7008"],"lenah valley":["7008"],
  "moonah":["7009"],"glenorchy":["7010"],
  "sandy bay":["7005"],"dynnyrne":["7005"],"tolmans hill":["7007"],"margate":["7054"],"snug":["7054"],
  "launceston":["7250"],"south launceston":["7249"],
  "devonport":["0624","7310"],"ulverstone":["7315"],"penguin":["7316"],
  "burnie":["7320"],"wynyard":["7325"],"stanley":["7331"],
  "deloraine":["7304"],"westbury":["7303"],"longford":["7301"],
  "scottsdale":["7260"],"st helens":["7216"],"bicheno":["7215"],
  "swansea":["7190"],"orford":["7190"],"triabunna":["7190"],
  "oatlands":["7120"],"ross":["7209"],"campbell town":["7210"],"bothwell":["7030"],
  "queenstown":["7467","9300"],"strahan":["7468"],"zeehan":["7469"],

  // ── NT ────────────────────────────────────────────────────────────────
  "darwin":["0800"],"darwin cbd":["0800"],"stuart park":["0820"],
  "nightcliff":["0814"],"rapid creek":["0810"],"casuarina":["0810"],
  "palmerston":["0830"],"katherine":["0850"],
  "alice springs":["0870"],"tennant creek":["0860"],

  // ── NZ – Major cities ─────────────────────────────────────────────────
  "auckland":["1010"],"city centre":["1010"],"ponsonby":["1011"],
  "grey lynn":["1021"],"newton":["1010"],"eden terrace":["1021"],
  "parnell":["1052"],"newmarket":["1023"],"remuera":["1050"],
  "mt eden":["1024"],"mt albert":["1025"],"sandringham":["1025"],
  "three kings":["1042"],"onehunga":["1061"],"epsom":["1051"],
  "takapuna":["0622"],"birkenhead":["0626"],
  "henderson":["0612"],"west auckland":["0612"],
  "wellington":["6011"],"te aro":["6011"],
  "mount victoria":["6011"],"brooklyn":["6021"],"thorndon":["6011"],
  "lambton quay":["6011"],"lower hutt":["5010"],"upper hutt":["5018"],
  "christchurch":["8011"],"cbd christchurch":["8011"],"addington":["8024"],"riccarton":["8041"],
  "dunedin":["9016"],"south dunedin":["9012"],"mosgiel":["9024"],"hamilton cbd":["3204"],
  "tauranga":["3110"],"mount maunganui":["3116"],"papamoa":["3118"],
  "napier":["4110"],"hastings":["4122"],"havelock north":["4130"],
  "new plymouth":["4310"],"whanganui":["4500"],
  "palmerston north":["4410"],"feilding":["4702"],
  "nelson":["7010"],"motueka":["7120"],"arrowtown":["9302"],"wanaka":["9305"],
  "rotorua":["3010"],"taupo":["3330"],"gisborne":["4010"],
  "invercargill":["9810"],"gore":["9710"],"whangarei":["0110"]
};

/**
 * Given a free-text location input, return matching postcodes.
 * Returns empty array if nothing found.
 */

/**
 * Return all suburb names that match the input (for autocomplete suggestions).
 */

// ── Shared state options (10F) ───────────────────────────────────────────
// One list, seven consumers. This exact array was declared byte-identically in
// ArtistProfileScreen, BandProfileScreen, StandupProfileScreen, HostProfileScreen,
// VenueProfileScreen, ProfileEditScreen and DiscoverScreen — seven copies of the
// same ten strings, any one of which could gain or lose an entry on its own.
// "NZ" and "International" are deliberate: the scene isn't only Australian.
export const STATE_OPTIONS = ['NSW','VIC','QLD','WA','SA','TAS','ACT','NT','NZ','International'];

/**
 * ⚠⚠ THERE IS NO POSTCODE→STATE TABLE HERE, AND THAT IS DELIBERATE.
 *
 * ⛔⛔ ONE WAS WRITTEN HERE AND DELETED THE SAME DAY. `lib/geo.js` already
 * owns `postcodeState`, and a second table agreed on every real suburb while
 * differing on four PO-box ranges — the exact shape of a drift that shows up
 * months later as two screens disagreeing about where somebody lives.
 *
 * ⭐ `geo`'s ranges are the NARROWER, physical-delivery ones, which is right:
 * a suburb is a place, not a mailbox. ⛔ Do not reintroduce a local copy.
 */

/** The eight postcode-bearing states. ⚠ `STATE_OPTIONS` also carries `NZ` and
 *  `International`, which are profile locations but never postcodes. */
const AU_STATE_CODES = new Set(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']);

/**
 * Keys are stored lowercase; people read Title Case. ⭐ ONE definition, because
 * this was written inline three times and a shell-escaped edit once turned one
 * of the copies into a control character that still parsed and silently stopped
 * capitalising. A single function is one place for that to go wrong.
 */
function titleCase(name) {
  return String(name || '').replace(/\b\w/g, c => c.toUpperCase());
}

export function locationOptions(name) {
  const key = String(name || '').trim().toLowerCase();
  const codes = SUBURB_MAP[key];
  if (!codes || !codes.length) return [];
  const title = titleCase(key);
  /* One option per STATE, not per postcode: a suburb with three postcodes in
     one state is one place, and offering it three times is not a choice. */
  const byState = new Map();
  for (const pc of codes) {
    const st = postcodeState(pc);
    if (!byState.has(st)) byState.set(st, []);
    byState.get(st).push(pc);
  }
  return [...byState.entries()].map(([state, postcodes]) => ({
    suburb: title,
    state,
    postcodes: [...postcodes].sort(),
    label: state ? `${title}, ${state}` : title
  })).sort((a, b) => a.state.localeCompare(b.state));
}

/** Does this name mean more than one place? */
export function isAmbiguousLocation(name) {
  return locationOptions(name).length > 1;
}

/**
 * ⚠ ACCEPTS "Newtown, NSW" AS WELL AS "Newtown". That is how the answer to the
 * ambiguity travels: the suggestion list offers the qualified label, the user
 * picks one, and it arrives back here still carrying the state.
 */
function splitQualified(input) {
  const m = String(input || '').match(/^(.*?)\s*,\s*([A-Za-z]{2,3})$/);
  if (!m) return { name: String(input || '').trim(), state: '' };
  return { name: m[1].trim(), state: m[2].toUpperCase() };
}

/**
 * ⭐ THE TOWN WITHOUT ITS QUALIFIER — "Newtown, NSW" becomes "Newtown".
 *
 * ⚠⚠ STORE THIS, ⛔ NOT THE QUALIFIED LABEL. The suffix exists to answer a
 * question at the moment of typing; it is not part of the town's name. A
 * profile that stored "Newtown, NSW" in `suburb` alongside `state: 'NSW'`
 * would render "Newtown, NSW, NSW" everywhere `formatLocation` is used.
 *
 * ⚠ Only strips a REAL state code. A town whose name genuinely ends in
 * something comma-separated keeps it, because the suffix has to match one of
 * the eight states to be treated as one.
 */
export function plainLocationName(input) {
  const { name, state } = splitQualified(input);
  return state && AU_STATE_CODES.has(state) ? name : String(input || '').trim();
}

export function resolveLocationToPostcodes(input) {
  if (!input) return [];
  const trimmed = String(input).trim();
  // Pure 4-digit postcode — return as-is
  if (/^\d{4}$/.test(trimmed)) return [trimmed];

  /* ⭐ A QUALIFIED NAME ANSWERS THE QUESTION. "Newtown, NSW" resolves to 2042
     alone, ⛔ never to the Victorian and Western Australian ones as well. */
  const { name, state } = splitQualified(trimmed);
  if (state) {
    const hit = locationOptions(name).find(o => o.state === state);
    if (hit) return hit.postcodes;
  }

  const key = trimmed.toLowerCase();
  // Exact match
  if (SUBURB_MAP[key]) return SUBURB_MAP[key];
  // Partial match — find all entries where the suburb starts with the input
  const matches = [];
  for (const [suburb, codes] of Object.entries(SUBURB_MAP)) {
    if (suburb.startsWith(key)) matches.push(...codes);
  }
  return [...new Set(matches)];
}

/**
 * ⭐⭐ AN AMBIGUOUS NAME IS OFFERED ONCE PER STATE, and that is the whole
 * disambiguation (owner, 2026-09-06: "if theres more than one town it could
 * be, just ask for clarification").
 *
 * ⛔ NO PROMPT, NO MODAL. The autocomplete is already the place where the user
 * chooses; a name that means three places simply becomes three choices. A
 * dialog would be a second thing to build and a second thing to dismiss.
 *
 * ⚠ AN UNAMBIGUOUS NAME IS NEVER QUALIFIED. "Bellingen" stays "Bellingen" —
 * appending a state to every suggestion would make the common case noisier to
 * fix the rare one.
 */
export function suggestLocations(input) {
  if (!input || input.length < 2) return [];
  const key = input.trim().toLowerCase();
  const names = Object.keys(SUBURB_MAP)
    .filter(s => s.includes(key))
    .sort((a, b) => (a.startsWith(key) ? -1 : b.startsWith(key) ? 1 : 0));

  const out = [];
  for (const n of names) {
    const opts = locationOptions(n);
    if (opts.length > 1) out.push(...opts.map(o => o.label));
    else out.push(titleCase(n));
    if (out.length >= 8) break;
  }
  return out.slice(0, 8);
}

/**
 * ⭐⭐ THE THIRD DIRECTION: A POSTCODE BACK TO ITS TOWNS.
 *
 * Owner, 2026-09-06: "all 3 should serve each other. postcode, town name and
 * state." Name→postcode and postcode→state already existed; this is the one
 * that did not, so a profile holding only a postcode could never say where
 * that was in words.
 *
 * ⚠⚠ A POSTCODE IS AMBIGUOUS TOO, and in the opposite direction. 2042 is
 * Newtown AND Enmore; 2037 is Glebe AND Forest Lodge. ⛔ So this returns a
 * LIST, exactly as `locationOptions` does — the asymmetry would be a lie.
 *
 * ⚠ Built once, lazily. Walking 711 keys on every call is cheap but this is
 * used inside list rendering, and a map built on first use costs one pass.
 */
let byPostcode = null;
function postcodeIndex() {
  if (byPostcode) return byPostcode;
  byPostcode = new Map();
  for (const [suburb, codes] of Object.entries(SUBURB_MAP)) {
    for (const pc of codes) {
      if (!byPostcode.has(pc)) byPostcode.set(pc, []);
      byPostcode.get(pc).push(titleCase(suburb));
    }
  }
  for (const list of byPostcode.values()) list.sort();
  return byPostcode;
}

/** Every town that shares a postcode, title-cased. Empty when unknown. */
export function townsForPostcode(postcode) {
  const pc = String(postcode ?? '').trim();
  return [...(postcodeIndex().get(pc) || [])];
}

/**
 * ⭐⭐ COMPLETE THE TRIPLE FROM WHATEVER YOU HAVE.
 *
 * Takes a postcode, a town, or a qualified "Town, STATE", and returns the same
 * shape every time so a caller never has to know which it was given:
 *
 *   { suburb, postcode, state, ambiguous, options }
 *
 * ⛔⛔ `ambiguous` IS THE POINT, not a detail. When more than one place fits,
 * `suburb` and `postcode` are left EMPTY and `options` carries the choices —
 * so a caller that ignores the flag gets nothing rather than the wrong town.
 * ⚠ That is deliberate: the old failure was a confident wrong answer, and a
 * blank is recoverable in a way a silent mistake is not.
 *
 * ⚠ `state` is filled even when ambiguous IF every option agrees on it — two
 * towns in the one state still place you in that state.
 */
export function resolvePlace(input) {
  const raw = String(input ?? '').trim();
  const empty = { suburb: '', postcode: '', state: '', ambiguous: false, options: [] };
  if (!raw) return empty;

  // A postcode: the town may still be ambiguous, the state never is.
  if (/^\d{4}$/.test(raw)) {
    const towns = townsForPostcode(raw);
    const state = postcodeState(raw);
    if (towns.length === 1) return { suburb: towns[0], postcode: raw, state, ambiguous: false, options: [] };
    return {
      suburb: '', postcode: raw, state,
      ambiguous: towns.length > 1,
      options: towns.map(t => ({ suburb: t, postcode: raw, state, label: `${t}, ${state}` })),
    };
  }

  // A name, qualified or not.
  const opts = locationOptions(plainLocationName(raw));
  const qualified = locationOptions(raw).length === 0 && opts.length > 0
    ? resolveLocationToPostcodes(raw) : null;
  if (qualified && qualified.length) {
    const state = postcodeState(qualified[0]);
    return { suburb: plainLocationName(raw), postcode: qualified[0], state, ambiguous: false, options: [] };
  }
  if (!opts.length) return empty;
  if (opts.length === 1) {
    const o = opts[0];
    return { suburb: o.suburb, postcode: o.postcodes[0], state: o.state, ambiguous: false, options: [] };
  }
  const states = new Set(opts.map(o => o.state));
  return {
    suburb: '', postcode: '',
    state: states.size === 1 ? [...states][0] : '',
    ambiguous: true,
    options: opts.map(o => ({ suburb: o.suburb, postcode: o.postcodes[0], state: o.state, label: o.label })),
  };
}
