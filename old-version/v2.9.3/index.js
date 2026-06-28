'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { generateChecksum } = require('./lib/checksum');
const C = require('./lib/constants');

// ── Translations ────────────────────────────────────────────────
// Add new languages by adding a key here. Frontend translations
// are served via /api/lang/:code. Backend uses these for event strings.
const LANG = {
  en: {
    _name: 'English',
    // Backend: event detail strings ({0},{1},... are replaced)
    engineStarted: 'Engine started',
    engineStopped: 'Engine stopped',
    engineStoppedDur: 'Engine stopped ({0} min)',
    batteryLow: 'Battery low: {0}V (< {1}V)',
    batteryLowId: 'Battery low: {0}V (< {1}V) {2}',
    batteryRecover: 'Battery recovered: {0}V',
    batteryRecoverId: 'Battery recovered: {0}V {1}',
    // Frontend: UI
    title: 'NMEA0183 Logger',
    back: 'Back',
    view: 'View',
    delete: 'Delete',
    download: 'Download',
    loading: 'Loading…',
    analyzing: 'Analyzing…',
    fetchingWeather: 'Fetching weather & sea state…',
    noLogs: 'No log files yet.',
    noTrack: 'No GPS track (RMC sentences required)',
    noResults: 'No results.',
    noWeather: 'No weather data available',
    waitingData: 'Waiting for data…',
    errorLoading: 'Error loading.',
    confirmDelete: 'Delete {0}?',
    deleteInVoyage: 'Cannot delete — log is part of voyage: {0}. Remove from voyage first.',
    loginRequired: 'You must be logged in to SignalK to delete files.\n\nGo to the SignalK admin UI and log in first.',
    errorPrefix: 'Error',
    noJson: 'Not JSON',
    // File list
    date: 'Date',
    size: 'Size',
    // Stats sections
    navigation: 'Navigation',
    wind: 'Wind',
    engine: 'Engine',
    // Stats labels
    distance: 'Distance',
    duration: 'Duration',
    sogAvg: 'SOG avg',
    sogMax: 'SOG max',
    start: 'Start',
    end: 'End',
    twsAvg: 'TWS avg',
    twsMax: 'TWS max',
    twaAvg: 'TWA avg',
    twaMin: 'TWA min',
    twaMax: 'TWA max',
    hours: 'Hours',
    periods: 'Periods',
    rpmData: 'RPM data',
    // Events
    events: 'Events',
    addEvent: 'Add event',
    evTypeHazard: 'Hazard',
    evTypeSighting: 'Sighting',
    evTypeVhf: 'VHF',
    evTypeNote: 'Note',
    evTypeCustom: 'Custom',
    evDetail: 'What happened?',
    evNote: 'Note (optional)',
    evSave: 'Save',
    evCancel: 'Cancel',
    evNoteEdit: 'Edit note',
    evNoteSave: 'Save note',
    evDelete: 'Delete',
    evTime: 'Time',
    // Voyages
    voyages: 'Voyages',
    logs: 'Logs',
    newVoyage: 'Create voyage',
    voyageName: 'Voyage name',
    voyageCreate: 'Create',
    voyageSelectLogs: 'Select logs to combine',
    voyageNoLogs: 'Select at least one log',
    voyageDays: 'days',
    voyageTotal: 'Total',
    voyageBestDay: 'Best day',
    voyagePerDay: 'Per day',
    voyageDelete: 'Delete voyage',
    voyageDeleteConfirm: 'Delete voyage "{0}"?',
    voyageExport: 'Export',
    voyageMissing: '{0} log file(s) missing or deleted',
    voyageTimeout: 'Loading took too long — try again (cache will speed up next time)',
    warmCache: 'Build stats cache',
    warmCacheHint: 'Pre-compute all log stats for fast loading',
    warmCacheDone: '{0} logs cached, {1} already cached',
    // Weather
    weatherTitle: 'Weather & sea state per hour',
    wxHour: 'Hour',
    wxWeather: 'Weather',
    wxTemp: 'Temp',
    wxWind: 'Wind',
    wxGusts: 'Gusts',
    wxWave: 'Wave',
    wxMeasured: 'Measured',
    wxDelta: 'Δ',
    wxSource: 'Source: Open-Meteo.com — weather + marine API per hour at GPS position. Measured = NMEA sensors. Δ = measured − forecast.',
    // Log viewer
    filterPlaceholder: 'Filter (e.g. RMC, VDM)',
    linesOf: '{0} of {1} lines',
    linesOfFiltered: '{0} of {1} lines (filter: {2})',
    // Time formatting
    durH: 'h', durM: 'm',
    // WMO weather codes
    wmo0: 'Clear sky', wmo1: 'Mainly clear', wmo2: 'Partly cloudy', wmo3: 'Overcast',
    wmo45: 'Fog', wmo48: 'Rime fog',
    wmo51: 'Light drizzle', wmo53: 'Drizzle', wmo55: 'Heavy drizzle',
    wmo56: 'Freezing drizzle', wmo57: 'Heavy freezing drizzle',
    wmo61: 'Light rain', wmo63: 'Rain', wmo65: 'Heavy rain',
    wmo66: 'Freezing rain', wmo67: 'Heavy freezing rain',
    wmo71: 'Light snow', wmo73: 'Snow', wmo75: 'Heavy snow', wmo77: 'Snow grains',
    wmo80: 'Light showers', wmo81: 'Showers', wmo82: 'Heavy showers',
    wmo85: 'Snow showers', wmo86: 'Heavy snow showers',
    wmo95: 'Thunderstorm', wmo96: 'Thunderstorm+hail', wmo99: 'Severe thunderstorm',
    // Settings
    settings: 'Settings',
    setTimeLang: 'Time & language',
    setLang: 'Language',
    setTZ: 'Time display',
    tzDevice: 'Device timezone',
    tzCustom: 'Custom timezone',
    setTZPick: 'Timezone',
    setUnits: 'Units',
    setSpeed: 'Speed',
    setDist: 'Distance',
    setDepth: 'Depth',
    setTemp: 'Temperature',
    setWind: 'Wind speed',
    setPress: 'Pressure',
    setMap: 'Map',
    setSeaMap: 'OpenSeaMap overlay',
    setSeaMapHint: 'Disable to save mobile data',
    setMapHeight: 'Map height',
    setCompact: 'Compact',
    setDefault: 'Default',
    setLarge: 'Large',
    setDisplay: 'Display',
    setLogLines: 'Default log lines',
    setAutoRefresh: 'Auto-refresh interval',
    setCompactMode: 'Compact mode',
    setCompactHint: 'Less padding, more data on screen',
    setExport: 'Export defaults',
    setGpxAis: 'Include AIS tracks in GPX',
    setGpxEvents: 'Include events in GPX',
    setReset: 'Reset to defaults',
    setResetConfirm: 'Reset all settings?',
    // Trash
    trash: 'Deleted logs',
    trashEmpty: 'Trash is empty',
    trashRestore: 'Restore',
    trashDelete: 'Delete permanently',
    trashEmptyAll: 'Empty trash',
    trashEmptyConfirm: 'Permanently delete all trashed logs?',
    trashDeleteConfirm: 'Permanently delete "{0}"?',
    trashRestored: 'Restored',
    trashEmptied: 'Trash emptied',
    // Log & voyage notes
    logNote: 'Day notes',
    logNotePlaceholder: 'Notes about this day (weather, crew, conditions…)',
    voyageNote: 'Voyage notes',
    voyageNotePlaceholder: 'Notes about this voyage…',
    // Sentence coverage
    sentenceCoverage: 'Sentence coverage',
    totalLines: 'Total lines',
    // Season
    season: 'Season',
    sailingDays: 'Sailing days',
    totalDistance: 'Total distance',
    totalEngine: 'Total engine hours',
    totalDuration: 'Total duration',
    // Storage
    storageUsage: 'Storage',
    storageLogs: 'Log files',
    storageCompressed: 'Compressed',
    storageTrash: 'In trash',
    // Misc
    duplicate: 'Duplicate date',
    autoTrashDays: 'Auto-empty trash after (days)',
    // Depth
    depth: 'Depth',
    depthMin: 'Shallowest',
    depthMax: 'Deepest',
    depthAvg: 'Avg depth',
    depthSamples: 'Soundings',
    shallowest: 'Shallowest point',
    // Autopilot
    autopilot: 'Autopilot',
    heading: 'Avg heading',
    rudder: 'Rudder',
    rudderAvg: 'Avg rudder',
    rudderMax: 'Max rudder',
    xte: 'Cross-track',
    xteAvg: 'Avg XTE',
    xteMax: 'Max XTE',
    apSegments: 'AP segments',
    // DSC
    dscCall: 'DSC {0} from {1}',
    dscCallNature: 'DSC {0} from {1}: {2}',
    dscCalls: 'DSC calls',
    dscDistress: 'Distress',
    dscUrgency: 'Urgency',
    dscSafety: 'Safety',
    dscRoutine: 'Routine',
    off: 'Off',
    all: 'All',
    on: 'On',
    // Engine / Fuel
    engineTab: 'Engine + maintenance',
    engineHoursTotal: 'Total engine hours',
    engineBaseHours: 'Hours before logger',
    engineLoggedHours: 'Logged hours',
    fuelLog: 'Fuel log',
    fuelAdd: 'Add fueling',
    fuelDate: 'Date',
    fuelHours: 'Engine hours',
    fuelLiters: 'Liters',
    fuelPricePerL: '€/L',
    fuelTotal: 'Total cost',
    fuelFullTank: 'Full tank',
    fuelNote: 'Location / note',
    fuelAvgConsumption: 'Avg consumption',
    fuelRange: 'Est. range',
    fuelRangeHours: 'hours',
    fuelTankLevel: 'Tank level',
    fuelTankCapacity: 'Tank capacity (L)',
    fuelNoSensor: 'No sensor data',
    maintenanceLog: 'Maintenance log',
    maintenanceAdd: 'Add maintenance',
    maintenanceType: 'Type',
    maintenanceSchedule: 'Maintenance schedule',
    maintenanceDue: 'Due',
    maintenanceOverdue: 'Overdue',
    maintenanceOk: 'OK',
    maintenanceSince: 'Since last',
    maintenanceNext: 'Next at',
    maintenanceNever: 'Never done',
    maint_oil: 'Oil + filters',
    maint_impeller: 'Impeller',
    maint_fuel_filter: 'Fuel filter',
    maint_air_filter: 'Air filter',
    maint_zincs: 'Anodes',
    maint_antifouling: 'Antifouling',
    maint_gearbox: 'Gearbox oil',
    maint_other: 'Other',
    maint_underwater_inspect: 'Underwater inspection',
    maint_shaft_seal: 'Shaft seal / packing',
    maint_sail_inspect: 'Sail inspection / repair',
    maint_rigging: 'Standing rigging inspection',
    maint_rig_check: 'Rig check (pins, tape)',
    maint_winch_lube: 'Winch / block lubrication',
    maint_windlass: 'Windlass service',
    maint_lines: 'Replace lines',
    maint_nav_lights: 'Navigation lights check',
    maint_lifejacket: 'Life jacket service',
    maint_extinguisher: 'Fire extinguisher service',
    maint_flares: 'Replace flares',
    maint_lifebuoy: 'Lifebuoy / EPIRB check',
    maint_battery: 'Battery maintenance',
    maint_electronics: 'Electronics check',
    maint_wiring: 'Wiring inspection',
    tankSensorPath: 'SignalK tank path',
    // Power / Electrical
    powerTab: 'Power',
    powerVoltage: 'Voltage',
    powerCurrent: 'Current',
    powerSoc: 'State of charge',
    powerWatts: 'Power',
    powerCharger: 'Charger',
    powerAlternator: 'Alternator',
    powerSolar: 'Solar',
    powerBattTemp: 'Battery temp',
    powerBank1: 'House bank',
    powerBank2: 'Start battery',
    powerNoData: 'No electrical data available',
    powerHint: 'Connect a battery monitor via NMEA2000 or SignalK',
    powerTodayAh: 'Today consumed',
    fuelEstimate: 'Est. fuel used',
    or: 'or',
    // Crew
    crewTab: 'Crew',
    crewList: 'Crew list',
    crewAdd: 'Add crew member',
    crewName: 'Name',
    crewRole: 'Role',
    crewCert: 'Certificates',
    crewFrom: 'From',
    crewTo: 'To',
    crewRoleSkipper: 'Skipper',
    crewRoleMate: 'Mate',
    crewRoleCrew: 'Crew',
    crewRoleGuest: 'Guest',
    crewNoMembers: 'No crew added yet',
    // Report
    report: 'Report',
    reportGenerate: 'Day report',
    reportVoyageReport: 'Voyage report',
    reportSummary: 'Summary',
    reportRoute: 'Route',
    reportConditions: 'Conditions',
    reportEvents: 'Events',
    reportEngine: 'Engine & fuel',
    reportNoData: 'No data available',
    // Fuel segments
    fuelMotor: 'Motor',
    fuelSail: 'Sailing',
    fuelMotorPct: 'Motor %',
    fuelMotorDist: 'Motor distance',
    fuelSailDist: 'Sailing distance',
    fuelLperNm: 'L/nm',
    // Auto-detected events
    anchorDropped: 'Anchored ({0}h)',
    anchorWeighed: 'Anchor weighed',
    harborArrival: 'Arrival in {0}',
    harborDeparture: 'Departure from {0}',
    sailReductionSuspect: 'Sail reduction suspected (TWS {0}kn, SOG {1}→{2}kn)',
    // Replay
  },
  nl: {
    _name: 'Nederlands',
    engineStarted: 'Motor gestart',
    engineStopped: 'Motor gestopt',
    engineStoppedDur: 'Motor gestopt ({0} min)',
    batteryLow: 'Accu laag: {0}V (< {1}V)',
    batteryLowId: 'Accu laag: {0}V (< {1}V) {2}',
    batteryRecover: 'Accu herstel: {0}V',
    batteryRecoverId: 'Accu herstel: {0}V {1}',
    title: 'NMEA0183 Logger',
    back: 'Terug',
    view: 'Bekijk',
    delete: 'Verwijder',
    download: 'Download',
    loading: 'Laden…',
    analyzing: 'Analyseren…',
    fetchingWeather: 'Weer en zeegang ophalen…',
    noLogs: 'Nog geen logbestanden.',
    noTrack: 'Geen GPS-track (RMC sentences nodig)',
    noResults: 'Geen resultaten.',
    noWeather: 'Geen weerdata beschikbaar',
    waitingData: 'Wacht op data…',
    errorLoading: 'Fout bij laden.',
    confirmDelete: 'Verwijder {0}?',
    deleteInVoyage: 'Kan niet verwijderen — log is onderdeel van reis: {0}. Verwijder eerst uit de reis.',
    loginRequired: 'Je moet ingelogd zijn in SignalK om bestanden te verwijderen.\n\nGa naar de SignalK admin UI en log eerst in.',
    errorPrefix: 'Fout',
    noJson: 'Geen JSON',
    date: 'Datum',
    size: 'Grootte',
    navigation: 'Navigatie',
    wind: 'Wind',
    engine: 'Motor',
    distance: 'Afstand',
    duration: 'Duur',
    sogAvg: 'SOG gem.',
    sogMax: 'SOG max',
    start: 'Begin',
    end: 'Einde',
    twsAvg: 'TWS gem.',
    twsMax: 'TWS max',
    twaAvg: 'TWA gem.',
    twaMin: 'TWA min',
    twaMax: 'TWA max',
    hours: 'Uren',
    periods: 'Periodes',
    rpmData: 'RPM data',
    events: 'Gebeurtenissen',
    addEvent: 'Gebeurtenis toevoegen',
    evTypeHazard: 'Gevaar',
    evTypeSighting: 'Waarneming',
    evTypeVhf: 'VHF',
    evTypeNote: 'Notitie',
    evTypeCustom: 'Overig',
    evDetail: 'Wat is er gebeurd?',
    evNote: 'Notitie (optioneel)',
    evSave: 'Opslaan',
    evCancel: 'Annuleren',
    evNoteEdit: 'Notitie bewerken',
    evNoteSave: 'Notitie opslaan',
    evDelete: 'Verwijder',
    evTime: 'Tijd',
    voyages: 'Reizen',
    logs: 'Logbestanden',
    newVoyage: 'Reis aanmaken',
    voyageName: 'Reisnaam',
    voyageCreate: 'Aanmaken',
    voyageSelectLogs: 'Selecteer logs om samen te voegen',
    voyageNoLogs: 'Selecteer minimaal één log',
    voyageDays: 'dagen',
    voyageTotal: 'Totaal',
    voyageBestDay: 'Beste dag',
    voyagePerDay: 'Per dag',
    voyageDelete: 'Reis verwijderen',
    voyageDeleteConfirm: 'Reis "{0}" verwijderen?',
    voyageExport: 'Exporteer',
    voyageMissing: '{0} logbestand(en) ontbreken of verwijderd',
    voyageTimeout: 'Laden duurde te lang — probeer opnieuw (cache versnelt volgende keer)',
    warmCache: 'Stats cache opbouwen',
    warmCacheHint: 'Vooraf alle logstats berekenen voor snel laden',
    warmCacheDone: '{0} logs gecached, {1} al gecached',
    weatherTitle: 'Weer & zeegang per uur',
    wxHour: 'Uur',
    wxWeather: 'Weer',
    wxTemp: 'Temp',
    wxWind: 'Wind',
    wxGusts: 'Vlagen',
    wxWave: 'Golf',
    wxMeasured: 'Gemeten',
    wxDelta: 'Δ',
    wxSource: 'Bron: Open-Meteo.com — weer + marine API per uur op GPS-positie. Gemeten = NMEA sensoren. Δ = gemeten − verwacht.',
    filterPlaceholder: 'Filter (bv. RMC, VDM)',
    linesOf: '{0} van {1} regels',
    linesOfFiltered: '{0} van {1} regels (filter: {2})',
    durH: 'u', durM: 'm',
    wmo0: 'Onbewolkt', wmo1: 'Licht bewolkt', wmo2: 'Half bewolkt', wmo3: 'Bewolkt',
    wmo45: 'Mist', wmo48: 'Rijpmist',
    wmo51: 'Lichte motregen', wmo53: 'Motregen', wmo55: 'Zware motregen',
    wmo56: 'Aanvr. motregen', wmo57: 'Zware aanvr. motregen',
    wmo61: 'Lichte regen', wmo63: 'Regen', wmo65: 'Zware regen',
    wmo66: 'Aanvr. regen', wmo67: 'Zware aanvr. regen',
    wmo71: 'Lichte sneeuw', wmo73: 'Sneeuw', wmo75: 'Zware sneeuw', wmo77: 'Sneeuwkorrels',
    wmo80: 'Lichte buien', wmo81: 'Buien', wmo82: 'Zware buien',
    wmo85: 'Sneeuwbuien', wmo86: 'Zware sneeuwbuien',
    wmo95: 'Onweer', wmo96: 'Onweer+hagel', wmo99: 'Zwaar onweer',
    // Settings
    settings: 'Instellingen',
    setTimeLang: 'Tijd & taal',
    setLang: 'Taal',
    setTZ: 'Tijdweergave',
    tzDevice: 'Apparaat tijdzone',
    tzCustom: 'Eigen tijdzone',
    setTZPick: 'Tijdzone',
    setUnits: 'Eenheden',
    setSpeed: 'Snelheid',
    setDist: 'Afstand',
    setDepth: 'Diepte',
    setTemp: 'Temperatuur',
    setWind: 'Windsnelheid',
    setPress: 'Luchtdruk',
    setMap: 'Kaart',
    setSeaMap: 'OpenSeaMap overlay',
    setSeaMapHint: 'Uit = bespaart mobiele data',
    setMapHeight: 'Kaarthoogte',
    setCompact: 'Compact',
    setDefault: 'Standaard',
    setLarge: 'Groot',
    setDisplay: 'Weergave',
    setLogLines: 'Standaard aantal logregels',
    setAutoRefresh: 'Auto-verversing',
    setCompactMode: 'Compacte modus',
    setCompactHint: 'Minder witruimte, meer data op het scherm',
    setExport: 'Export standaarden',
    setGpxAis: 'AIS-tracks in GPX opnemen',
    setGpxEvents: 'Events in GPX opnemen',
    setReset: 'Standaardwaarden herstellen',
    setResetConfirm: 'Alle instellingen resetten?',
    // Trash
    trash: 'Verwijderde logs',
    trashEmpty: 'Prullenbak is leeg',
    trashRestore: 'Herstellen',
    trashDelete: 'Definitief verwijderen',
    trashEmptyAll: 'Prullenbak legen',
    trashEmptyConfirm: 'Alle verwijderde logs definitief verwijderen?',
    trashDeleteConfirm: '"{0}" definitief verwijderen?',
    trashRestored: 'Hersteld',
    trashEmptied: 'Prullenbak geleegd',
    logNote: 'Dagnotities',
    logNotePlaceholder: 'Notities over deze dag (weer, bemanning, omstandigheden…)',
    voyageNote: 'Reisnotities',
    voyageNotePlaceholder: 'Notities over deze reis…',
    sentenceCoverage: 'Sentence-types',
    totalLines: 'Totaal regels',
    season: 'Seizoen',
    sailingDays: 'Vaardagen',
    totalDistance: 'Totale afstand',
    totalEngine: 'Totale motoruren',
    totalDuration: 'Totale vaartijd',
    storageUsage: 'Opslag',
    storageLogs: 'Logbestanden',
    storageCompressed: 'Gecomprimeerd',
    storageTrash: 'In prullenbak',
    duplicate: 'Dubbele datum',
    autoTrashDays: 'Prullenbak automatisch legen na (dagen)',
    depth: 'Diepte',
    depthMin: 'Ondiepst',
    depthMax: 'Diepst',
    depthAvg: 'Gem. diepte',
    depthSamples: 'Metingen',
    shallowest: 'Ondiepste punt',
    autopilot: 'Autopilot',
    heading: 'Gem. koers',
    rudder: 'Roer',
    rudderAvg: 'Gem. roerhoek',
    rudderMax: 'Max roerhoek',
    xte: 'Dwarsafwijking',
    xteAvg: 'Gem. XTE',
    xteMax: 'Max XTE',
    apSegments: 'AP-segmenten',
    dscCall: 'DSC {0} van {1}',
    dscCallNature: 'DSC {0} van {1}: {2}',
    dscCalls: 'DSC-oproepen',
    dscDistress: 'Nood',
    dscUrgency: 'Urgentie',
    dscSafety: 'Veiligheid',
    dscRoutine: 'Routine',
    off: 'Uit',
    all: 'Alles',
    on: 'Aan',
    engineTab: 'Motor + onderhoud',
    engineHoursTotal: 'Totale motoruren',
    engineBaseHours: 'Uren vóór logger',
    engineLoggedHours: 'Gelogde uren',
    fuelLog: 'Brandstoflog',
    fuelAdd: 'Tankbeurt toevoegen',
    fuelDate: 'Datum',
    fuelHours: 'Motoruren',
    fuelLiters: 'Liters',
    fuelPricePerL: '€/L',
    fuelTotal: 'Totaalkosten',
    fuelFullTank: 'Volle tank',
    fuelNote: 'Locatie / notitie',
    fuelAvgConsumption: 'Gem. verbruik',
    fuelRange: 'Geschatte actieradius',
    fuelRangeHours: 'uur',
    fuelTankLevel: 'Tankniveau',
    fuelTankCapacity: 'Tankinhoud (L)',
    fuelNoSensor: 'Geen sensordata',
    maintenanceLog: 'Onderhoudslog',
    maintenanceAdd: 'Onderhoud toevoegen',
    maintenanceType: 'Type',
    maintenanceSchedule: 'Onderhoudsschema',
    maintenanceDue: 'Binnenkort',
    maintenanceOverdue: 'Achterstallig',
    maintenanceOk: 'OK',
    maintenanceSince: 'Sinds laatste',
    maintenanceNext: 'Volgende bij',
    maintenanceNever: 'Nooit gedaan',
    maint_oil: 'Olie + filters',
    maint_impeller: 'Impeller',
    maint_fuel_filter: 'Brandstoffilter',
    maint_air_filter: 'Luchtfilter',
    maint_zincs: 'Anodes',
    maint_antifouling: 'Antifouling',
    maint_gearbox: 'Keerkoppeling olie',
    maint_other: 'Overig',
    maint_underwater_inspect: 'Onderwaterinspectie',
    maint_shaft_seal: 'Schroefaspakking',
    maint_sail_inspect: 'Zeilinspectie / reparatie',
    maint_rigging: 'Verstaging inspectie',
    maint_rig_check: 'Tuig check (splitpennen)',
    maint_winch_lube: 'Lieren / blokken smeren',
    maint_windlass: 'Ankerlier onderhoud',
    maint_lines: 'Lijnen vervangen',
    maint_nav_lights: 'Navigatieverlichting check',
    maint_lifejacket: 'Reddingsvest keuring',
    maint_extinguisher: 'Brandblusser keuring',
    maint_flares: 'Noodvuur vervangen',
    maint_lifebuoy: 'Reddingsboei / EPIRB check',
    maint_battery: 'Accu onderhoud',
    maint_electronics: 'Elektronica check',
    maint_wiring: 'Bedrading inspectie',
    tankSensorPath: 'SignalK tankpad',
    powerTab: 'Stroom',
    powerVoltage: 'Spanning',
    powerCurrent: 'Stroom',
    powerSoc: 'Laadtoestand',
    powerWatts: 'Vermogen',
    powerCharger: 'Lader',
    powerAlternator: 'Dynamo',
    powerSolar: 'Zonnepaneel',
    powerBattTemp: 'Accu temp',
    powerBank1: 'Huisbatterij',
    powerBank2: 'Startaccu',
    powerNoData: 'Geen stroomdata beschikbaar',
    powerHint: 'Sluit een batterijmonitor aan via NMEA2000 of SignalK',
    powerTodayAh: 'Vandaag verbruikt',
    fuelEstimate: 'Gesch. brandstofverbruik',
    or: 'of',
    // Crew
    crewTab: 'Bemanning',
    crewList: 'Bemanningslijst',
    crewAdd: 'Bemanningslid toevoegen',
    crewName: 'Naam',
    crewRole: 'Rol',
    crewCert: 'Vaarbewijs / certificaten',
    crewFrom: 'Van',
    crewTo: 'Tot',
    crewRoleSkipper: 'Schipper',
    crewRoleMate: 'Stuurman',
    crewRoleCrew: 'Bemanning',
    crewRoleGuest: 'Gast',
    crewNoMembers: 'Nog geen bemanning toegevoegd',
    // Report
    report: 'Rapport',
    reportGenerate: 'Dagrapport',
    reportVoyageReport: 'Reisrapport',
    reportSummary: 'Samenvatting',
    reportRoute: 'Route',
    reportConditions: 'Omstandigheden',
    reportEvents: 'Gebeurtenissen',
    reportEngine: 'Motor & brandstof',
    reportNoData: 'Geen data beschikbaar',
    // Fuel segments
    fuelMotor: 'Motor',
    fuelSail: 'Zeilen',
    fuelMotorPct: 'Motor %',
    fuelMotorDist: 'Motorafstand',
    fuelSailDist: 'Zeilafstand',
    fuelLperNm: 'L/nm',
    // Auto-detected events
    anchorDropped: 'Voor anker ({0}u)',
    anchorWeighed: 'Anker op',
    harborArrival: 'Aankomst in {0}',
    harborDeparture: 'Vertrek uit {0}',
    sailReductionSuspect: 'Zeilreductie verdacht (TWS {0}kn, SOG {1}→{2}kn)',
    // Replay
  }
};

function tr(lang, key, ...args) {
  const dict = LANG[lang] || LANG.en;
  let s = dict[key] || LANG.en[key] || key;
  args.forEach((a, i) => { s = s.replace(`{${i}}`, a); });
  return s;
}

module.exports = function (app) {
  const plugin = {};
  plugin.id = 'signalk-nmea0183-logger';
  plugin.name = 'NMEA0183 Sentence Logger';
  plugin.description = 'NMEA0183 logger with track, events, AIS throttle, weather + sea state.';

  let unsubscribe = null, currentLogDate = null, currentWriteStream = null;
  let logDir = null, config = {}, sentenceStats = {}, statusInterval = null;
  let publicServer = null;
  let currentFileSize = 0, currentFilePart = 0;

  const aisLastSeen = {};
  let vdoLastSeen = 0;
  let hasRMC = false;
  let throttledCount = 0, dedupCount = 0;
  let lastSentenceTime = 0;

  function lang() { return config.language || 'en'; }
  function t(key, ...args) { return tr(lang(), key, ...args); }

  const { parseLogFile } = require('./lib/parser');
  const { fetchWeather } = require('./lib/weather');
  const { toGPX, toCSV } = require('./lib/export');

  const SENTENCE_TYPES = C.SENTENCE_TYPES;

  // ── Delta input system (SignalK universal mode) ──────────────────
  let deltaState = {};   // accumulated latest values from SignalK
  let deltaInterval = null;
  let deltaUnsubscribes = [];


  function pad2(n) { return String(Math.floor(n)).padStart(2, '0'); }
  function pad3(n) { return String(Math.floor(n)).padStart(3, '0'); }

  function latToNmea(lat) {
    const d = Math.floor(Math.abs(lat));
    const m = (Math.abs(lat) - d) * 60;
    return `${pad2(d)}${m.toFixed(4)},${lat >= 0 ? 'N' : 'S'}`;
  }
  function lonToNmea(lon) {
    const d = Math.floor(Math.abs(lon));
    const m = (Math.abs(lon) - d) * 60;
    return `${pad3(d)}${m.toFixed(4)},${lon >= 0 ? 'E' : 'W'}`;
  }

  const R2D = C.R2D;
  const MS2KN = C.MS2KN;
  const K2C = C.K2C;
  const PA2MBAR = C.PA2MBAR;

  /**
   * Generate NMEA0183 sentences from accumulated SignalK delta state.
   * Called periodically in delta input mode. Converts SI units back to NMEA conventions.
   */
  function generateDeltaSentences() {
    const s = deltaState;
    const now = new Date();
    const hhmmss = pad2(now.getUTCHours()) + pad2(now.getUTCMinutes()) + pad2(now.getUTCSeconds());
    const ddmmyy = pad2(now.getUTCDate()) + pad2(now.getUTCMonth() + 1) + String(now.getUTCFullYear()).slice(2);
    const sentences = [];

    // RMC — position, speed, course
    if (s.lat !== undefined && s.lon !== undefined) {
      const sog = s.sog !== undefined ? (s.sog * MS2KN).toFixed(1) : '';
      const cog = s.cog !== undefined ? (s.cog * R2D).toFixed(1) : '';
      sentences.push(generateChecksum(`$GPRMC,${hhmmss},A,${latToNmea(s.lat)},${lonToNmea(s.lon)},${sog},${cog},${ddmmyy},,,A`));
    }

    // GGA — fix quality
    if (s.lat !== undefined && s.lon !== undefined) {
      const sats = s.satellites || 8;
      sentences.push(generateChecksum(`$GPGGA,${hhmmss},${latToNmea(s.lat)},${lonToNmea(s.lon)},2,${sats},0.9,2.5,M,,M,,`));
    }

    // HDG — heading
    if (s.headingMag !== undefined) {
      const hdg = (s.headingMag * R2D).toFixed(1);
      const variation = s.variation !== undefined ? (Math.abs(s.variation * R2D)).toFixed(1) + ',' + (s.variation >= 0 ? 'E' : 'W') : ',';
      sentences.push(generateChecksum(`$IIHDG,${hdg},,${variation}`));
    }

    // MWV — true wind
    if (s.tws !== undefined && s.twa !== undefined) {
      const kn = (s.tws * MS2KN).toFixed(1);
      const angle = (s.twa * R2D).toFixed(1);
      sentences.push(generateChecksum(`$IIMWV,${angle},T,${kn},N,A`));
    }

    // MWV — apparent wind
    if (s.aws !== undefined && s.awa !== undefined) {
      const kn = (s.aws * MS2KN).toFixed(1);
      const angle = (s.awa * R2D).toFixed(1);
      sentences.push(generateChecksum(`$IIMWV,${angle},R,${kn},N,A`));
    }

    // DBT — depth
    if (s.depth !== undefined) {
      const m = s.depth.toFixed(1);
      const ft = (s.depth * 3.28084).toFixed(1);
      const fa = (s.depth / 1.8288).toFixed(1);
      sentences.push(generateChecksum(`$IIDBT,${ft},f,${m},M,${fa},F`));
    }

    // RSA — rudder angle
    if (s.rudder !== undefined) {
      const angle = (s.rudder * R2D).toFixed(1);
      sentences.push(generateChecksum(`$IIRSA,${angle},A,,V`));
    }

    // XTE — cross-track error
    if (s.xte !== undefined) {
      const nm = Math.abs(s.xte / 1852).toFixed(3); // meters to nm
      const dir = s.xte >= 0 ? 'R' : 'L';
      sentences.push(generateChecksum(`$GPXTE,A,A,${nm},${dir},N,A`));
    }

    // RPM — engine revolutions
    if (s.rpm !== undefined) {
      sentences.push(generateChecksum(`$IIRPM,E,1,${Math.round(s.rpm)},,A`));
    }

    // XDR voltage — battery
    if (s.batteryVoltage !== undefined) {
      sentences.push(generateChecksum(`$IIXDR,V,${s.batteryVoltage.toFixed(2)},V,BATT`));
    }

    // MTA — air temperature
    if (s.airTemp !== undefined) {
      const c = (s.airTemp + K2C).toFixed(1);
      sentences.push(generateChecksum(`$IIMTA,${c},C`));
    }

    // MTW — water temperature
    if (s.waterTemp !== undefined) {
      const c = (s.waterTemp + K2C).toFixed(1);
      sentences.push(generateChecksum(`$IIMTW,${c},C`));
    }

    // MDA — barometric pressure + air temp
    if (s.pressure !== undefined) {
      const mbar = s.pressure * PA2MBAR;
      const bar = mbar / 1000;
      const inHg = mbar * 0.02953;
      const tempC = s.airTemp !== undefined ? (s.airTemp + K2C).toFixed(1) : '';
      sentences.push(generateChecksum(`$IIMDA,${inHg.toFixed(4)},I,${bar.toFixed(4)},B,${tempC},C,,C,,,,,,,,,,`));
    }

    // VHW — water speed
    if (s.stw !== undefined) {
      const kn = (s.stw * MS2KN).toFixed(1);
      const hdg = s.headingMag !== undefined ? (s.headingMag * R2D).toFixed(1) : '';
      sentences.push(generateChecksum(`$IIVHW,${hdg},T,,M,${kn},N,,K`));
    }

    // XDR fuel level
    if (s.fuelLevel !== undefined) {
      const pct = Math.round(s.fuelLevel * 100);
      sentences.push(generateChecksum(`$IIXDR,V,${pct},%,FUEL`));
    }

    // XDR battery current
    if (s.batteryCurrent !== undefined) {
      sentences.push(generateChecksum(`$IIXDR,I,${s.batteryCurrent.toFixed(1)},A,BATT`));
    }

    // XDR state of charge
    if (s.soc !== undefined) {
      const pct = Math.round(s.soc * 100);
      sentences.push(generateChecksum(`$IIXDR,G,${pct},%,SOC`));
    }

    // XDR charger current
    if (s.chargerCurrent !== undefined) {
      sentences.push(generateChecksum(`$IIXDR,I,${s.chargerCurrent.toFixed(1)},A,CHG`));
    }

    // Write all generated sentences
    for (const sentence of sentences) {
      handleSentence(sentence);
    }
  }

  /**
   * Start SignalK delta input mode: subscribe to self paths via streambundle,
   * accumulate state, and periodically generate NMEA0183 sentences.
   * Also sets up hybrid AIS passthrough (raw VDM + SignalK vessels polling).
   */
  function startDeltaInput() {
    deltaState = {};
    const bus = app.streambundle;
    if (!bus) {
      app.error('SignalK streambundle not available — falling back to NMEA0183');
      app.on('nmea0183', handleSentence);
      unsubscribe = () => app.removeListener('nmea0183', handleSentence);
      return;
    }

    const pathMap = {
      'navigation.position':             v => { if (v) { deltaState.lat = v.latitude; deltaState.lon = v.longitude; } },
      'navigation.speedOverGround':       v => { deltaState.sog = v; },
      'navigation.courseOverGroundTrue':   v => { deltaState.cog = v; },
      'navigation.headingMagnetic':       v => { deltaState.headingMag = v; },
      'navigation.magneticVariation':     v => { deltaState.variation = v; },
      'environment.wind.speedTrue':       v => { deltaState.tws = v; },
      'environment.wind.angleTrueWater':  v => { deltaState.twa = v; },
      'environment.wind.speedApparent':   v => { deltaState.aws = v; },
      'environment.wind.angleApparent':   v => { deltaState.awa = v; },
      'environment.depth.belowTransducer':v => { deltaState.depth = v; },
      'steering.rudderAngle':             v => { deltaState.rudder = v; },
      'navigation.courseRhumbline.crossTrackError': v => { deltaState.xte = v; },
      'environment.outside.temperature':  v => { deltaState.airTemp = v; },
      'environment.water.temperature':    v => { deltaState.waterTemp = v; },
      'environment.outside.pressure':     v => { deltaState.pressure = v; },
      'navigation.speedThroughWater':     v => { deltaState.stw = v; },
      'navigation.gnss.satellites':       v => { deltaState.satellites = v; },
      'tanks.fuel.0.currentLevel':        v => { deltaState.fuelLevel = v; },
      'electrical.batteries.0.current':   v => { deltaState.batteryCurrent = v; },
      'electrical.batteries.0.capacity.stateOfCharge': v => { deltaState.soc = v; },
      'electrical.batteries.0.temperature': v => { deltaState.batteryTemp = v; },
      'electrical.chargers.0.current':    v => { deltaState.chargerCurrent = v; },
    };

    for (const [skPath, handler] of Object.entries(pathMap)) {
      try {
        const stream = bus.getSelfStream(skPath);
        if (stream) {
          deltaUnsubscribes.push(stream.onValue(v => {
            if (v !== null && v !== undefined) handler(v);
          }));
        }
      } catch (e) { app.debug(`Delta: could not subscribe to ${skPath}: ${e.message}`); }
    }

    // Subscribe to propulsion RPM (dynamic path)
    try {
      const propStream = bus.getSelfStream('propulsion.0.revolutions');
      if (propStream) {
        deltaUnsubscribes.push(propStream.onValue(v => {
          if (v !== null && v !== undefined) deltaState.rpm = v * 60; // Hz to RPM
        }));
      }
    } catch (e) { app.debug(`Delta: propulsion subscribe failed: ${e.message}`); }

    // Subscribe to battery voltage (dynamic path)
    try {
      const battStream = bus.getSelfStream('electrical.batteries.0.voltage');
      if (battStream) {
        deltaUnsubscribes.push(battStream.onValue(v => {
          if (v !== null && v !== undefined) deltaState.batteryVoltage = v;
        }));
      }
    } catch (e) { app.debug(`Delta: battery subscribe failed: ${e.message}`); }

    // Periodic sentence generation
    const intervalSec = config.deltaIntervalSec || 10;
    deltaInterval = setInterval(() => {
      if (deltaState.lat !== undefined) { // Only generate if we have position
        generateDeltaSentences();
      }
    }, intervalSec * 1000);

    // Hybrid: also capture raw AIS + DSC sentences (not available via delta stream)
    const aisPassthrough = function(s) {
      if (!s || typeof s !== 'string') return;
      const t = s.trim();
      if (t.startsWith('!AIVDM') || t.startsWith('!AIVDO') || t.startsWith('$CDDSC')) {
        handleSentence(s);
      }
    };
    app.on('nmea0183', aisPassthrough);
    deltaUnsubscribes.push(() => app.removeListener('nmea0183', aisPassthrough));

    // Subscribe to AIS vessel data from SignalK (for NMEA2000 boats without raw VDM)
    const aisVesselState = {}; // mmsi -> {lat, lon, sog, cog, lastSent}
    const aisInterval = Math.max((config.aisThrottleSec || 30), 10) * 1000;
    try {
      const vesselSub = app.streambundle.getAvailablePaths()
        .filter(p => p.startsWith('navigation.position') || p.startsWith('navigation.speedOverGround') || p.startsWith('navigation.courseOverGroundTrue'));

      // Use SignalK API for vessel positions if streambundle doesn't cover other vessels
      const aisCheckInterval = setInterval(() => {
        try {
          const vessels = app.getPath('/vessels');
          if (!vessels) return;
          const selfId = app.selfId;
          const now = Date.now();
          for (const [id, vessel] of Object.entries(vessels)) {
            if (id === selfId || id === 'self') continue;
            // Extract MMSI from URN
            const mmsiMatch = id.match(/urn:mrn:(?:imo:)?mmsi:(\d+)/);
            if (!mmsiMatch) continue;
            const mmsi = mmsiMatch[1];
            // Throttle per vessel
            const prev = aisVesselState[mmsi];
            if (prev && (now - prev.lastSent) < aisInterval) continue;
            // Get position
            const pos = vessel.navigation && vessel.navigation.position && vessel.navigation.position.value;
            if (!pos || !pos.latitude || !pos.longitude) continue;
            const sog = vessel.navigation && vessel.navigation.speedOverGround && vessel.navigation.speedOverGround.value;
            const cog = vessel.navigation && vessel.navigation.courseOverGroundTrue && vessel.navigation.courseOverGroundTrue.value;
            const sogKn = (sog !== null && sog !== undefined) ? (sog * 1.94384).toFixed(1) : '';
            const cogDeg = (cog !== null && cog !== undefined) ? (cog * 180 / Math.PI).toFixed(1) : '';
            // Generate $SKAIS sentence
            const sentence = generateChecksum(`$SKAIS,${mmsi},${latToNmea(pos.latitude)},${lonToNmea(pos.longitude)},${sogKn},${cogDeg}`);
            handleSentence(sentence);
            aisVesselState[mmsi] = { lastSent: now };
          }
        } catch (e) { /* vessels API not available yet */ }
      }, Math.max(aisInterval, 10000));
      deltaUnsubscribes.push(() => clearInterval(aisCheckInterval));
    } catch (e) { app.debug(`Delta: AIS vessel subscribe failed: ${e.message}`); }

    app.debug(`Delta input started: ${Object.keys(pathMap).length + 2} paths, interval ${intervalSec}s + AIS/DSC hybrid`);
    unsubscribe = stopDeltaInput;
  }

  function stopDeltaInput() {
    for (const unsub of deltaUnsubscribes) {
      try { if (typeof unsub === 'function') unsub(); }
      catch (e) {}
    }
    deltaUnsubscribes = [];
    if (deltaInterval) { clearInterval(deltaInterval); deltaInterval = null; }
    deltaState = {};
  }

  // ── Core logging ────────────────────────────────────────────────
  function getDateString() { return new Date().toISOString().split('T')[0]; }
  function getTimestamp() { return new Date().toISOString(); }
  function exType(s) { if (!s || s.length < 6) return 'UNKNOWN'; const m = s.trim().match(/^[!$]([A-Z]{2})([A-Z]{2,4})/); return m ? m[2] : 'UNKNOWN'; }
  function exFull(s) { if (!s || s.length < 6) return 'UNKNOWN'; const m = s.trim().match(/^[!$]([A-Z]{2,5})/); return m ? m[1] : 'UNKNOWN'; }

  function shouldLog(sentenceType) {
    if (config.logAllSentences) return true;
    if (config[`log_${sentenceType}`] === true) return true;
    if (config.logUnknownSentences && !(sentenceType in SENTENCE_TYPES)) return true;
    return false;
  }

  function extractMMSI(sentence) {
    try {
      const fields = sentence.split(',');
      if (fields.length < 7) return null;
      const fragNum = parseInt(fields[2], 10); if (fragNum !== 1) return null;
      const payload = fields[5]; if (!payload || payload.length < 7) return null;
      const bits = [];
      for (let i = 0; i < Math.min(payload.length, 7); i++) {
        let c = payload.charCodeAt(i) - 48; if (c > 40) c -= 8;
        for (let b = 5; b >= 0; b--) bits.push((c >> b) & 1);
      }
      if (bits.length < 38) return null;
      let mmsi = 0; for (let i = 8; i < 38; i++) mmsi = mmsi * 2 + bits[i];
      return mmsi > 0 ? String(mmsi) : null;
    } catch (e) { return null; }
  }

  function isThrottled(sentence, sentenceType) {
    const now = Date.now();
    if (sentenceType === 'VDM') {
      const interval = (config.aisThrottleSec || 0) * 1000;
      if (interval <= 0) return false;
      const mmsi = extractMMSI(sentence); if (!mmsi) return false;
      const last = aisLastSeen[mmsi] || 0;
      if (now - last < interval) { throttledCount++; return true; }
      aisLastSeen[mmsi] = now; return false;
    }
    if (config.gpsDedupRMC) {
      if (sentenceType === 'RMC') { hasRMC = true; return false; }
      if ((sentenceType === 'GGA' || sentenceType === 'GLL') && hasRMC) { dedupCount++; return true; }
      if (sentenceType === 'VDO' && hasRMC) {
        const sec = config.vdoHeartbeatSec !== undefined ? config.vdoHeartbeatSec : 180;
        if (sec <= 0) { dedupCount++; return true; }
        if (now - vdoLastSeen < sec * 1000) { dedupCount++; return true; }
        vdoLastSeen = now; return false;
      }
    }
    return false;
  }

  function getWriteStream() {
    const today = getDateString(); const maxBytes = (config.maxFileSizeMB || 0) * 1024 * 1024;
    let needNew = false;
    if (currentLogDate !== today) { needNew = true; currentFilePart = 0; }
    else if (maxBytes > 0 && currentFileSize >= maxBytes) { needNew = true; currentFilePart++; }
    if (needNew || !currentWriteStream) {
      if (currentWriteStream) { currentWriteStream.end(); currentWriteStream = null; }
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      currentLogDate = today;
      const suffix = currentFilePart > 0 ? `_part${currentFilePart}` : '';
      const fn = `nmea0183_${today}${suffix}.log`;
      const fp = path.join(logDir, fn);
      currentFileSize = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
      currentWriteStream = fs.createWriteStream(fp, { flags: 'a' });
      currentWriteStream.on('error', e => { app.error(`Log error: ${e.message}`); currentWriteStream = null; });
    }
    return currentWriteStream;
  }

  /**
   * Process a single NMEA0183 sentence: apply throttle/dedup filters,
   * write to log file with timestamp, and update sentence stats.
   * @param {string} s - Raw NMEA0183 sentence
   */
  function handleSentence(s) {
    if (!s || typeof s !== 'string') return;
    const sentenceType = exType(s); const fullId = exFull(s);
    sentenceStats[fullId] = (sentenceStats[fullId] || 0) + 1;
    if (!shouldLog(sentenceType)) return;
    if (isThrottled(s, sentenceType)) return;
    const stream = getWriteStream(); if (!stream) return;
    const line = config.includeTimestamp ? `${getTimestamp()} ${s.trim()}\n` : `${s.trim()}\n`;
    stream.write(line); currentFileSize += Buffer.byteLength(line);
    lastSentenceTime = Date.now();
  }

  // ── SignalK integration: publish deltas ─────────────────────────

  /**
   * Publish an event as a SignalK notification.
   * Path: notifications.plugins.nmea0183-logger.{type}
   * This allows other SignalK plugins, webapps, and KIP to react to events.
   */
  function publishNotification(event) {
    if (!event || !event.type) return;
    try {
      const notifPath = `notifications.plugins.nmea0183-logger.${event.type}`;
      const state = (event.type === 'dsc' || event.type === 'battery') ? 'alert' :
                    (event.type === 'engine') ? 'normal' : 'normal';
      app.handleMessage(plugin.id, {
        updates: [{
          values: [{
            path: notifPath,
            value: {
              state,
              method: ['visual'],
              message: event.detail || event.type,
              timestamp: event.time || new Date().toISOString()
            }
          }]
        }]
      });
    } catch (e) { app.debug(`Notification publish failed: ${e.message}`); }
  }

  /**
   * Publish trip statistics to the SignalK data model.
   * Updated periodically (every status interval).
   * Paths: navigation.trip.log (distance), propulsion.0.runTime (engine hours)
   */
  let lastTripPublish = 0;
  function publishTripStats() {
    const now = Date.now();
    if (now - lastTripPublish < 60000) return; // max once per minute
    lastTripPublish = now;
    try {
      const todayFn = 'nmea0183_' + getDateString() + '.log';
      const resolved = resolveLog(todayFn);
      if (!resolved) return;
      const st = getCachedStats(resolved.path);
      if (!st) return;
      const values = [];
      if (st.totalDistanceNm > 0) {
        values.push({ path: 'navigation.trip.log', value: st.totalDistanceNm * 1852 }); // meters
      }
      if (st.engineHours > 0) {
        values.push({ path: 'propulsion.0.runTime', value: st.engineHours * 3600 }); // seconds
      }
      if (st.checksumFails > 0) {
        values.push({ path: 'sensors.nmea0183.checksumErrors', value: st.checksumFails });
      }
      if (values.length) {
        app.handleMessage(plugin.id, { updates: [{ values }] });
      }
    } catch (e) { app.debug(`Trip stats publish failed: ${e.message}`); }
  }

  function updateStatus() {
    const e = Object.entries(sentenceStats).sort((a, b) => b[1] - a[1]);
    const mode = config.inputSource === 'signalk' ? 'SK' : '0183';
    if (!e.length) { app.setPluginStatus(`[${mode}] Listening...`); return; }
    const port = publicServer && publicServer.address() ? publicServer.address().port : '?';
    const sizeMB = (currentFileSize / 1048576).toFixed(1);
    const thr = throttledCount > 0 ? ` | thr:${throttledCount}` : '';
    const dup = dedupCount > 0 ? ` | dup:${dedupCount}` : '';
    const paths = config.inputSource === 'signalk' ? ` | ${Object.keys(deltaState).length} paths` : '';
    app.setPluginStatus(
      `[${mode}] :${port} | ${currentLogDate}${currentFilePart > 0 ? ' p' + currentFilePart : ''} ${sizeMB}MB${thr}${dup}${paths} | ` +
      e.slice(0, 8).map(([t, c]) => `${t}:${c}`).join(' ')
    );
    // Periodically publish trip stats to SignalK data model
    publishTripStats();
  }

  function validFn(fn) { fn = path.basename(fn); return (fn.startsWith('nmea0183_') && (fn.endsWith('.log') || fn.endsWith('.log.gz'))) ? fn : null; }

  /** Resolve log file path: checks .log first, then .log.gz. Returns {path, gz} or null. */
  function resolveLog(fn) {
    const base = fn.endsWith('.gz') ? fn.slice(0, -3) : fn;
    const fp = path.join(logDir, base);
    if (fs.existsSync(fp)) return { path: fp, gz: false, name: base };
    const gzp = fp + '.gz';
    if (fs.existsSync(gzp)) return { path: gzp, gz: true, name: base };
    return null;
  }

  /** Read log file content, transparently decompressing .gz files. */
  function readLogContent(fp) {
    if (fp.endsWith('.gz')) {
      return zlib.gunzipSync(fs.readFileSync(fp)).toString('utf8');
    }
    return fs.readFileSync(fp, 'utf8');
  }

  /** Compress old log files (older than N days). */
  function compressOldLogs() {
    const days = config.compressAfterDays || 7;
    if (days <= 0) return;
    const cutoff = Date.now() - days * 86400000;
    if (!logDir || !fs.existsSync(logDir)) return;
    const files = fs.readdirSync(logDir).filter(f => f.startsWith('nmea0183_') && f.endsWith('.log'));
    for (const fn of files) {
      // Don't compress today's active log
      if (currentLogDate && fn.includes(currentLogDate)) continue;
      const fp = path.join(logDir, fn);
      try {
        const stat = fs.statSync(fp);
        if (stat.mtime.getTime() < cutoff) {
          const content = fs.readFileSync(fp);
          fs.writeFileSync(fp + '.gz', zlib.gzipSync(content));
          fs.unlinkSync(fp);
          app.debug(`Compressed: ${fn} (${(stat.size/1048576).toFixed(1)}MB → ${(fs.statSync(fp+'.gz').size/1048576).toFixed(1)}MB)`);
        }
      } catch (e) { app.error(`Compress error ${fn}: ${e.message}`); }
    }
    // Auto-empty trash
    const trashDays = config.autoTrashDays !== undefined ? config.autoTrashDays : 30;
    if (trashDays > 0) {
      const trashCutoff = Date.now() - trashDays * 86400000;
      const trashFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.del'));
      for (const fn of trashFiles) {
        try {
          const stat = fs.statSync(path.join(logDir, fn));
          if (stat.mtime.getTime() < trashCutoff) {
            fs.unlinkSync(path.join(logDir, fn));
            app.debug(`Auto-trash removed: ${fn}`);
          }
        } catch (e) { app.debug(`Auto-trash error ${fn}: ${e.message}`); }
      }
    }
  }

  let cleanupInterval = null;
  let compressInterval = null;
  function cleanupThrottleMap() {
    const now = Date.now();
    const maxAge = Math.max((config.aisThrottleSec || 30) * 1000 * 10, 300000);
    for (const mmsi of Object.keys(aisLastSeen)) { if (now - aisLastSeen[mmsi] > maxAge) delete aisLastSeen[mmsi]; }
  }

  // ── Crew data helpers ────────────────────────────────────────────
  function crewPath() { return path.join(logDir, 'crew.json'); }
  function readCrew() {
    const fp = crewPath();
    if (fs.existsSync(fp)) {
      try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
      catch (e) { return { members: [] }; }
    }
    return { members: [] };
  }
  function writeCrew(data) {
    fs.writeFileSync(crewPath(), JSON.stringify(data, null, 2));
  }

  // ── Harbors database ─────────────────────────────────────────────
  // Used by auto-detection of arrival/departure events.
  // User can override with their own harbors.json in logDir.
  // Format: [{name, lat, lon}, ...]
  const DEFAULT_HARBORS = [
    // Nederland
    { name: 'Den Helder', lat: 52.9645, lon: 4.7600 },
    { name: 'Den Oever', lat: 52.9343, lon: 5.0356 },
    { name: 'Oudeschild (Texel)', lat: 53.0376, lon: 4.8520 },
    { name: 'Vlieland', lat: 53.2965, lon: 5.0900 },
    { name: 'West-Terschelling', lat: 53.3540, lon: 5.2200 },
    { name: 'Harlingen', lat: 53.1748, lon: 5.4153 },
    { name: 'Lauwersoog', lat: 53.4080, lon: 6.2050 },
    { name: 'Delfzijl', lat: 53.3300, lon: 6.9300 },
    { name: 'IJmuiden', lat: 52.4630, lon: 4.5750 },
    { name: 'Scheveningen', lat: 52.1010, lon: 4.2620 },
    { name: 'Hoek van Holland', lat: 51.9785, lon: 4.1230 },
    { name: 'Stellendam', lat: 51.8230, lon: 4.0420 },
    { name: 'Vlissingen', lat: 51.4416, lon: 3.5870 },
    { name: 'Breskens', lat: 51.4040, lon: 3.5570 },
    { name: 'Enkhuizen', lat: 52.7050, lon: 5.2950 },
    { name: 'Hoorn', lat: 52.6450, lon: 5.0610 },
    { name: 'Volendam', lat: 52.4970, lon: 5.0750 },
    { name: 'Marken', lat: 52.4570, lon: 5.0640 },
    { name: 'Edam', lat: 52.5130, lon: 5.0510 },
    { name: 'Monnickendam', lat: 52.4570, lon: 5.0420 },
    { name: 'Muiden', lat: 52.3340, lon: 5.0710 },
    { name: 'Lelystad', lat: 52.5180, lon: 5.4470 },
    { name: 'Stavoren', lat: 52.8835, lon: 5.3635 },
    { name: 'Hindeloopen', lat: 52.9420, lon: 5.4120 },
    { name: 'Workum', lat: 52.9810, lon: 5.4360 },
    { name: 'Makkum', lat: 53.0670, lon: 5.4000 },
    { name: 'Medemblik', lat: 52.7720, lon: 5.1080 },
    { name: 'Andijk', lat: 52.7460, lon: 5.1730 },
    { name: 'Schellinkhout', lat: 52.6620, lon: 5.1180 },
    // België
    { name: 'Nieuwpoort', lat: 51.1545, lon: 2.7350 },
    { name: 'Oostende', lat: 51.2330, lon: 2.9300 },
    { name: 'Zeebrugge', lat: 51.3380, lon: 3.2070 },
    // Duitsland (Noordzeekust)
    { name: 'Borkum', lat: 53.5640, lon: 6.7480 },
    { name: 'Norderney', lat: 53.7060, lon: 7.1640 },
    { name: 'Helgoland', lat: 54.1750, lon: 7.8970 },
    { name: 'Cuxhaven', lat: 53.8720, lon: 8.7060 },
    // United Kingdom (East coast)
    { name: 'Lowestoft', lat: 52.4720, lon: 1.7530 },
    { name: 'Harwich', lat: 51.9420, lon: 1.2810 },
    { name: 'Dover', lat: 51.1240, lon: 1.3260 }
  ];

  function harborsPath() { return path.join(logDir, 'harbors.json'); }
  function readHarbors() {
    const fp = harborsPath();
    if (fs.existsSync(fp)) {
      try {
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.harbors)) return data.harbors;
      } catch (e) { app.debug(`Harbors read failed: ${e.message}`); }
    }
    return DEFAULT_HARBORS;
  }

  // ── Report generator ───────────────────────────────────────────
  /**
   * Generate a markdown day report from parsed log stats.
   * Includes: summary, conditions (wind/depth), engine/fuel segments, events, active crew, notes.
   * @param {object} stats - Parsed log stats from getCachedStats()
   * @param {object} eng - Engine data from readEngine()
   * @returns {string} Markdown formatted report
   */
  function generateDayReport(stats, eng) {
    const fn = stats.filename || '';
    const date = fn.replace('nmea0183_', '').replace('.log', '');
    const lines = [];
    lines.push(`# ${config.displayTitle || 'Logboek'} — ${date}`);
    lines.push('');

    // Summary
    lines.push(`## ${t('reportSummary')}`);
    if (stats.startTime && stats.endTime) {
      const s = new Date(stats.startTime), e = new Date(stats.endTime);
      lines.push(`${t('duration')}: ${stats.durationHours ? stats.durationHours.toFixed(1) + 'h' : '—'} (${s.toISOString().substring(11, 16)} – ${e.toISOString().substring(11, 16)} UTC)`);
    }
    if (stats.totalDistanceNm) lines.push(`${t('distance')}: ${stats.totalDistanceNm} nm`);
    if (stats.sogAvgKn) lines.push(`${t('sogAvg')}: ${stats.sogAvgKn} kn (max ${stats.sogMaxKn || '—'} kn)`);
    lines.push('');

    // Conditions
    if (stats.twsAvgKn || stats.depthMinM) {
      lines.push(`## ${t('reportConditions')}`);
      if (stats.twsAvgKn) lines.push(`${t('wind')}: ${t('average')} ${stats.twsAvgKn} kn, max ${stats.twsMaxKn || '—'} kn`);
      if (stats.depthMinM !== null) lines.push(`${t('depth')}: ${stats.depthMinM}–${stats.depthMaxM} m (${t('depthAvg')} ${stats.depthAvgM} m)`);
      if (stats.shallowest) lines.push(`${t('shallowest')}: ${stats.shallowest.depth} m`);
      lines.push('');
    }

    // Engine & fuel
    if (stats.engineHours > 0 || stats.fuelSegments) {
      lines.push(`## ${t('reportEngine')}`);
      lines.push(`${t('hours')}: ${stats.engineHours ? stats.engineHours.toFixed(1) + 'h' : '—'}`);
      if (stats.fuelSegments) {
        const fs = stats.fuelSegments;
        lines.push(`${t('fuelMotorDist')}: ${fs.motorDistNm || 0} nm (${fs.motorPct || 0}%)`);
        lines.push(`${t('fuelSailDist')}: ${fs.sailDistNm || 0} nm (${100 - (fs.motorPct || 0)}%)`);
        if (fs.estimatedLiters) lines.push(`${t('fuelEstimate')}: ~${fs.estimatedLiters.toFixed(1)} L`);
      }
      lines.push('');
    }

    // Events
    if (stats.events && stats.events.length > 0) {
      lines.push(`## ${t('reportEvents')}`);
      for (const ev of stats.events) {
        const time = ev.time ? ev.time.substring(11, 16) : '??:??';
        lines.push(`- ${time} [${ev.type}] ${ev.detail}${ev.note ? ' — ' + ev.note : ''}`);
      }
      lines.push('');
    }

    // Crew (if any on this date)
    const crew = readCrew();
    const activeCrew = crew.members.filter(m => {
      if (!m.from) return true; // no date range = always active
      if (m.from > date) return false;
      if (m.to && m.to < date) return false;
      return true;
    });
    if (activeCrew.length) {
      lines.push(`## ${t('crewList')}`);
      for (const m of activeCrew) {
        lines.push(`- ${m.name} (${t('crewRole' + m.role.charAt(0).toUpperCase() + m.role.slice(1)) || m.role})${m.cert ? ' — ' + m.cert : ''}`);
      }
      lines.push('');
    }

    // Log note
    if (stats.logNote) {
      lines.push(`## ${t('logNote')}`);
      lines.push(stats.logNote);
      lines.push('');
    }

    return lines.join('\n');
  }

  // ── Manual events file helpers ──────────────────────────────────
  function eventsFilePath(logFn) {
    return path.join(logDir, logFn.replace('.log', '.events.json'));
  }
  function readEventsFile(logFn) {
    const fp = eventsFilePath(logFn);
    if (fs.existsSync(fp)) {
      try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
      catch (e) { return { manualEvents: [], notes: {} }; }
    }
    return { manualEvents: [], notes: {} };
  }
  function writeEventsFile(logFn, data) {
    const fp = eventsFilePath(logFn);
    try {
      fs.writeFileSync(fp, JSON.stringify(data, null, 2));
      app.debug(`Events written: ${fp}`);
    } catch (e) {
      app.error(`Failed to write events file ${fp}: ${e.message}`);
      throw e;
    }
  }

  // ── Voyages file helpers ────────────────────────────────────────
  function voyagesPath() { return path.join(logDir, 'voyages.json'); }
  function readVoyages() {
    const fp = voyagesPath();
    if (fs.existsSync(fp)) {
      try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
      catch (e) { return { voyages: [] }; }
    }
    return { voyages: [] };
  }
  function writeVoyages(data) {
    fs.writeFileSync(voyagesPath(), JSON.stringify(data, null, 2));
  }

  // ── Engine / fuel data helpers ────────────────────────────────
  function enginePath() { return path.join(logDir, 'engine.json'); }
  function readEngine() {
    const fp = enginePath();
    if (fs.existsSync(fp)) {
      try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
      catch (e) { return defaultEngine(); }
    }
    return defaultEngine();
  }
  function defaultEngine() {
    return {
      config: { tankCapacityLiters: 0, baseHours: 0, tankSensorPath: 'tanks.fuel.0.currentLevel' },
      fuelLog: [],
      maintenance: [],
      schedule: [
        { type: 'oil', intervalHours: 200, label: 'Oil + filters' },
        { type: 'gearbox', intervalHours: 500, label: 'Gearbox oil' },
        { type: 'impeller', intervalHours: 500, label: 'Impeller' },
        { type: 'fuel_filter', intervalHours: 400, label: 'Fuel filter' },
        { type: 'air_filter', intervalHours: 300, label: 'Air filter' },
        { type: 'zincs', intervalHours: 0, intervalMonths: 12, label: 'Anodes' },
        { type: 'antifouling', intervalHours: 0, intervalMonths: 24, label: 'Antifouling' }
      ]
    };
  }
  function writeEngine(data) {
    fs.writeFileSync(enginePath(), JSON.stringify(data, null, 2));
  }

  /**
   * Calculate total engine hours across all log files + base hours.
   * Result is cached with a 2-minute TTL to avoid re-scanning on every request.
   * @returns {number} Total engine hours (rounded to 0.01)
   */
  let _engineHoursCache = { value: null, time: 0 };
  function getTotalEngineHours() {
    const now = Date.now();
    if (_engineHoursCache.value !== null && (now - _engineHoursCache.time) < C.ENGINE_HOURS_TTL) {
      return _engineHoursCache.value;
    }
    const eng = readEngine();
    let total = eng.config.baseHours || 0;
    if (!logDir || !fs.existsSync(logDir)) return total;
    const files = fs.readdirSync(logDir)
      .filter(f => f.startsWith('nmea0183_') && (f.endsWith('.log') || f.endsWith('.log.gz')));
    const unique = [...new Set(files.map(f => f.endsWith('.gz') ? f.slice(0, -3) : f))];
    for (const fn of unique) {
      const resolved = resolveLog(fn);
      if (!resolved) continue;
      const st = getCachedStats(resolved.path);
      if (st && st.engineHours > 0) total += st.engineHours;
    }
    const result = Math.round(total * 100) / 100;
    _engineHoursCache = { value: result, time: now };
    return result;
  }

  // ── HTTP response helpers (consistent error handling) ──────────
  function jsonOk(res, data) { res.end(JSON.stringify(data)); }
  function jsonError(res, status, message) {
    res.writeHead(status);
    res.end(JSON.stringify({ error: message }));
  }

  /**
   * Set HTTP cache header for stats responses.
   * All stats responses are no-cache: the plugin's disk cache provides speed,
   * and manual events / notes can be added at any time, so browser caching
   * causes confusing UX where edits don't appear after save.
   * @param {http.ServerResponse} res
   * @param {string} fn - Log filename like "nmea0183_2026-03-28.log"
   */
  function setStatsCacheHeader(res, fn) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', c => { body += c; if (body.length > C.MAX_BODY_SIZE) { req.destroy(); reject(new Error('Too large')); } });
      req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Invalid JSON')); } });
      req.on('error', reject);
    });
  }

  // ── Stats cache: persistent disk + in-memory ────────────────────
  // Stats are written to .stats.json sidecar files next to each log.
  // On request: check disk cache first (survives restarts), then memory.
  // Only re-parse if log file mtime > cache file mtime.
  const statsCache = {};
  const STATS_CACHE_MAX = C.STATS_CACHE_MAX;
  let seasonCache = {}; // { year: { data, time } }
  const SEASON_CACHE_TTL = C.SEASON_CACHE_TTL; // 5 min

  function statsCachePath(fp) {
    // /path/to/nmea0183_2026-03-01.log → /path/to/nmea0183_2026-03-01.stats.json
    const base = fp.endsWith('.gz') ? fp.slice(0, -3) : fp;
    return base.replace('.log', '.stats.json');
  }

  /**
   * Get parsed stats for a log file, using three-layer cache:
   * 1. Memory cache (fastest, ~1ms)
   * 2. Disk cache .stats.json (survives restarts, ~5ms)
   * 3. Full parse (slowest, 100-500ms depending on file size)
   * @param {string} fp - Full file path to log file
   * @param {object} [opts] - {fullTrack: bool, includeAIS: bool}
   * @returns {object|null} Parsed stats
   */
  function getCachedStats(fp, opts) {
    let mtime;
    try { mtime = fs.statSync(fp).mtime.getTime(); } catch (e) { return null; }
    const isFullTrack = !!(opts && opts.fullTrack);
    const isAIS = !!(opts && opts.includeAIS);
    const memKey = fp + ':' + (isFullTrack ? 'full' : 'display') + ':' + (isAIS ? 'ais' : '');

    // For the live (today's) log, throttle re-parsing — file changes constantly
    // but stats don't need to be second-perfect. Re-parse at most every 30s.
    const isLiveLog = currentLogDate && fp.includes(currentLogDate);
    const LIVE_REPARSE_THROTTLE = 30000;

    // 1. Memory cache (fastest)
    const memCached = statsCache[memKey];
    if (memCached) {
      if (memCached.mtime === mtime) {
        return cloneStats(memCached.data);
      }
      // For live log, allow stale data within throttle window
      if (isLiveLog && memCached.parsedAt && (Date.now() - memCached.parsedAt) < LIVE_REPARSE_THROTTLE) {
        return cloneStats(memCached.data);
      }
    }

    // 2. Disk cache (survives restarts) — only for default opts, only for non-live logs
    if (!isFullTrack && !isAIS && !isLiveLog) {
      const diskPath = statsCachePath(fp);
      try {
        if (fs.existsSync(diskPath)) {
          const diskMtime = fs.statSync(diskPath).mtime.getTime();
          if (diskMtime >= mtime) {
            const data = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
            storeMemCache(memKey, mtime, data);
            return cloneStats(data);
          }
        }
      } catch (e) { /* corrupt cache, re-parse */ }
    }

    // 3. Parse fresh — inject harbors database for auto-detection
    const parseOpts = Object.assign({}, opts, { harbors: readHarbors() });
    const data = parseLogFile(fp, config, t, parseOpts);
    storeMemCache(memKey, mtime, data);

    // Write disk cache only for closed (non-live) logs
    if (!isFullTrack && !isAIS && !isLiveLog) {
      try {
        const diskData = Object.assign({}, data);
        delete diskData.aisVessels; // AIS tracks too large for disk
        fs.writeFileSync(statsCachePath(fp), JSON.stringify(diskData));
      } catch (e) { app.debug(`Stats cache write failed: ${e.message}`); }
    }

    return cloneStats(data);
  }

  function storeMemCache(key, mtime, data) {
    const keys = Object.keys(statsCache);
    if (keys.length >= STATS_CACHE_MAX) {
      // Remove oldest 20% when full
      const toRemove = keys.slice(0, Math.ceil(keys.length * 0.2));
      for (const k of toRemove) delete statsCache[k];
    }
    statsCache[key] = { mtime, data, parsedAt: Date.now() };
  }

  function cloneStats(data) {
    return Object.assign({}, data, {
      events: data.events ? data.events.map(e => Object.assign({}, e)) : [],
      enginePeriods: data.enginePeriods ? data.enginePeriods.map(p => Object.assign({}, p)) : [],
      apSegments: data.apSegments ? data.apSegments.map(s => Object.assign({}, s)) : undefined
    });
  }

  function invalidateCache(fp) {
    for (const key of Object.keys(statsCache)) {
      if (key.startsWith(fp + ':')) delete statsCache[key];
    }
    // Remove disk cache too
    try { const dp = statsCachePath(fp); if (fs.existsSync(dp)) fs.unlinkSync(dp); } catch (e) {}
    seasonCache = {};
  }

  // ── Merge manual events helper (DRY) ───────────────────────────
  function mergeManualEvents(st, baseFn) {
    const ef = readEventsFile(baseFn);
    if (ef.manualEvents.length) {
      st.events = st.events.concat(ef.manualEvents);
      st.events.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }
    if (Object.keys(ef.notes).length) {
      for (const ev of st.events) {
        const key = `${ev.type}:${ev.time}:${ev.detail||''}`;
        if (ef.notes[key]) ev.note = ef.notes[key];
      }
    }
    if (ef.logNote) st.logNote = ef.logNote;
    return st;
  }

  // ── Log date helper ────────────────────────────────────────────
  function setLogDate(st, fp) {
    if (st.startTime) {
      st.logDate = st.startTime.split('T')[0];
    } else {
      try { st.logDate = fs.statSync(fp).mtime.toISOString().split('T')[0]; }
      catch (e) { st.logDate = new Date().toISOString().split('T')[0]; }
    }
  }

  // ── Rate limiter (per-IP, API endpoints only) ───────────────────
  const rateLimitMap = {};
  const RATE_LIMIT_MAX = 30;       // max requests per window
  const RATE_LIMIT_WINDOW = 10000; // 10 second window
  /**
   * Per-IP rate limiter for the public API. Returns true if request should be blocked.
   * Allows 30 requests per 10-second window per IP address.
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @returns {boolean} true if rate limited (response already sent)
   */
  function rateLimit(req, res) {
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    if (!rateLimitMap[ip]) rateLimitMap[ip] = { count: 0, start: now };
    const rl = rateLimitMap[ip];
    if (now - rl.start > RATE_LIMIT_WINDOW) { rl.count = 0; rl.start = now; }
    rl.count++;
    if (rl.count > RATE_LIMIT_MAX) {
      res.writeHead(429);
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return true;
    }
    return false;
  }
  // Cleanup rate limit map periodically (piggyback on existing cleanup)
  const origCleanup = cleanupThrottleMap;
  cleanupThrottleMap = function() {
    origCleanup();
    const now = Date.now();
    for (const ip of Object.keys(rateLimitMap)) {
      if (now - rateLimitMap[ip].start > RATE_LIMIT_WINDOW * 2) delete rateLimitMap[ip];
    }
  };

  // ── Public API server ───────────────────────────────────────────
  function startPublicServer(port) {
    const handler = (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Vary', 'Accept-Encoding');
      if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
      const url = new URL(req.url, `http://${req.headers.host}`);
      const p = url.pathname;

      // Rate limit API calls (skip static files)
      if (p.startsWith('/api/') && rateLimit(req, res)) return;

      // Gzip wrapper: monkey-patch res.end for JSON responses on /api/* if client supports it.
      // Saves 5-10× on bandwidth for stats responses with track data.
      const acceptsGzip = (req.headers['accept-encoding'] || '').includes('gzip');
      if (acceptsGzip && p.startsWith('/api/') && req.method === 'GET') {
        const origEnd = res.end.bind(res);
        res.end = function(chunk, encoding) {
          // Only compress if response body is large enough to be worth it
          if (typeof chunk === 'string' && chunk.length > 1024 && !res.headersSent) {
            const gzipped = zlib.gzipSync(chunk);
            res.setHeader('Content-Encoding', 'gzip');
            res.setHeader('Content-Length', gzipped.length);
            return origEnd(gzipped);
          }
          return origEnd(chunk, encoding);
        };
      }

      app.debug(`${req.method} ${p}`);

      if (p === '/' || p === '/index.html' || p === '/app.html') {
        const htmlFile = path.join(__dirname, 'public', 'app.html');
        if (fs.existsSync(htmlFile)) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.writeHead(200);
          fs.createReadStream(htmlFile).pipe(res);
        } else { res.writeHead(404); res.end('app.html not found'); }
        return;
      }

      // Static PWA files
      const staticFiles = {
        '/manifest.json': { type: 'application/manifest+json', cache: 'public, max-age=86400' },
        '/sw.js':         { type: 'application/javascript', cache: 'no-cache' },
        '/icon.svg':      { type: 'image/svg+xml', cache: 'public, max-age=604800' },
        '/app.css':       { type: 'text/css; charset=utf-8', cache: 'no-cache, no-store, must-revalidate' },
        '/app.js':        { type: 'application/javascript; charset=utf-8', cache: 'no-cache, no-store, must-revalidate' },
        '/parse-worker.js': { type: 'application/javascript; charset=utf-8', cache: 'public, max-age=86400' }
      };
      if (staticFiles[p]) {
        const sf = path.join(__dirname, 'public', p.substring(1));
        if (fs.existsSync(sf)) {
          res.setHeader('Content-Type', staticFiles[p].type);
          res.setHeader('Cache-Control', staticFiles[p].cache);
          res.writeHead(200);
          fs.createReadStream(sf).pipe(res);
        } else { res.writeHead(404); res.end('Not found'); }
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      try {
        // Non-events API routes: GET only
        if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
          res.writeHead(405); res.end(JSON.stringify({error:'Method not allowed'})); return;
        }
        // Language endpoints
        if (p === '/api/lang') {
          const available = Object.entries(LANG).map(([code, l]) => ({ code, name: l._name }));
          res.end(JSON.stringify({ current: lang(), available })); return;
        }
        const langMatch = p.match(/^\/api\/lang\/([a-z]{2})$/);
        if (langMatch) {
          const code = langMatch[1];
          const dict = LANG[code];
          if (!dict) { res.writeHead(404); res.end(JSON.stringify({ error: 'Language not found' })); return; }
          res.end(JSON.stringify(dict)); return;
        }

        if (p === '/api/logs') {
          if (!logDir || !fs.existsSync(logDir)) { res.end('[]'); return; }
          const files = fs.readdirSync(logDir)
            .filter(f => f.startsWith('nmea0183_') && (f.endsWith('.log') || f.endsWith('.log.gz')))
            .sort().reverse().map(f => {
              const s = fs.statSync(path.join(logDir, f));
              const baseName = f.endsWith('.gz') ? f.slice(0, -3) : f;
              return {
                name: baseName,
                size: s.size,
                modified: s.mtime.toISOString(),
                date: baseName.replace('nmea0183_', '').replace('.log', '').replace(/_part\d+/, ''),
                compressed: f.endsWith('.gz')
              };
            })
            .filter((f, i, arr) => !arr.some((o, j) => j < i && o.name === f.name));
          // Flag duplicates (same date, different part files)
          const dateCounts = {};
          for (const f of files) { dateCounts[f.date] = (dateCounts[f.date] || 0) + 1; }
          for (const f of files) { if (dateCounts[f.date] > 1) f.duplicate = true; }
          res.end(JSON.stringify(files)); return;
        }
        if (p === '/api/stats') {
          // Storage usage
          let storageBytes = 0, logCount = 0, compressedCount = 0, trashCount = 0;
          if (logDir && fs.existsSync(logDir)) {
            for (const f of fs.readdirSync(logDir)) {
              try {
                const sz = fs.statSync(path.join(logDir, f)).size;
                storageBytes += sz;
                if (f.endsWith('.log') || f.endsWith('.log.gz')) logCount++;
                if (f.endsWith('.log.gz')) compressedCount++;
                if (f.endsWith('.del')) trashCount++;
              } catch (e) { /* stat error, skip */ }
            }
          }
          res.end(JSON.stringify({ logDirectory:logDir, language: lang(),
            displayTitle: config.displayTitle || 'NMEA0183 Logger',
            inputSource: config.inputSource || 'nmea0183',
            deltaPaths: config.inputSource === 'signalk' ? Object.keys(deltaState).length : undefined,
            currentLogFile:currentLogDate?`nmea0183_${currentLogDate}${currentFilePart>0?'_part'+currentFilePart:''}.log`:null,
            isLive: lastSentenceTime > 0 && (Date.now() - lastSentenceTime) < 60000,
            lastActivity: lastSentenceTime > 0 ? new Date(lastSentenceTime).toISOString() : null,
            currentFileSizeMB:Math.round(currentFileSize/1048576*100)/100,
            throttledSentences:throttledCount, dedupSentences:dedupCount,
            trackedMMSIs:Object.keys(aisLastSeen).length, sentenceStats,
            storage: { totalMB: Math.round(storageBytes/1048576*10)/10, logCount, compressedCount, trashCount }
          })); return;
        }

        // ── Season overview ──
        const seasonMatch = p.match(/^\/api\/season\/(\d{4})$/);
        if (seasonMatch) {
          const year = seasonMatch[1];
          // TTL cache for season stats
          const sc = seasonCache[year];
          if (sc && (Date.now() - sc.time) < SEASON_CACHE_TTL) {
            res.end(JSON.stringify(sc.data)); return;
          }
          if (!logDir || !fs.existsSync(logDir)) { res.end(JSON.stringify({})); return; }
          const files = fs.readdirSync(logDir)
            .filter(f => f.startsWith('nmea0183_' + year) && (f.endsWith('.log') || f.endsWith('.log.gz')))
            .sort();
          const unique = [...new Set(files.map(f => f.endsWith('.gz') ? f.slice(0, -3) : f))];
          let totalNm = 0, totalEngineH = 0, sailingDays = 0, totalDurationH = 0;
          for (const fn of unique) {
            const resolved = resolveLog(fn);
            if (!resolved) continue;
            const st = getCachedStats(resolved.path);
            if (st && st.totalDistanceNm > 0.5) {
              sailingDays++;
              totalNm += st.totalDistanceNm || 0;
              totalEngineH += st.engineHours || 0;
              totalDurationH += st.durationHours || 0;
            }
          }
          const result = {
            year, sailingDays, totalLogs: unique.length,
            totalDistanceNm: Math.round(totalNm * 100) / 100,
            totalEngineHours: Math.round(totalEngineH * 100) / 100,
            totalDurationHours: Math.round(totalDurationH * 100) / 100
          };
          seasonCache[year] = { data: result, time: Date.now() };
          res.end(JSON.stringify(result)); return;
        }

        // ── Voyages API ──
        if (p === '/api/voyages') {
          if (req.method === 'GET') {
            const vd = readVoyages();
            res.end(JSON.stringify(vd.voyages)); return;
          }
          if (req.method === 'POST') {
            readBody(req).then(body => {
              const vd = readVoyages();

              if (body.action === 'create') {
                const v = {
                  id: 'v_' + Date.now(),
                  name: String(body.name || 'Unnamed voyage').substring(0, 200),
                  logs: Array.isArray(body.logs) ? body.logs.filter(f => validFn(f)) : [],
                  note: body.note ? String(body.note).substring(0, 2000) : '',
                  created: new Date().toISOString()
                };
                vd.voyages.push(v);
                writeVoyages(vd);
                res.end(JSON.stringify({ ok: true, voyage: v }));
              } else if (body.action === 'update') {
                const v = vd.voyages.find(v => v.id === body.id);
                if (!v) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
                if (body.name !== undefined) v.name = String(body.name).substring(0, 200);
                if (body.logs !== undefined) v.logs = Array.isArray(body.logs) ? body.logs.filter(f => validFn(f)) : v.logs;
                if (body.note !== undefined) v.note = String(body.note).substring(0, 2000);
                writeVoyages(vd);
                res.end(JSON.stringify({ ok: true, voyage: v }));
              } else if (body.action === 'delete') {
                const idx = vd.voyages.findIndex(v => v.id === body.id);
                if (idx < 0) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
                vd.voyages.splice(idx, 1);
                writeVoyages(vd);
                res.end(JSON.stringify({ ok: true }));
              } else {
                res.writeHead(400); res.end(JSON.stringify({ error: 'Unknown action' }));
              }
            }).catch(err => { res.writeHead(400); res.end(JSON.stringify({ error: err.message })); });
            return;
          }
        }

        // Auto-voyage detection: group consecutive log days with < N hours gap
        if (p === '/api/voyages/auto-detect') {
          if (!logDir || !fs.existsSync(logDir)) { res.end('[]'); return; }
          const files = fs.readdirSync(logDir)
            .filter(f => f.startsWith('nmea0183_') && (f.endsWith('.log') || f.endsWith('.log.gz')))
            .sort();
          // Deduplicate
          const seen = new Set();
          const unique = files.filter(f => {
            const base = f.endsWith('.gz') ? f.slice(0, -3) : f;
            if (seen.has(base)) return false;
            seen.add(base);
            return true;
          }).map(f => f.endsWith('.gz') ? f.slice(0, -3) : f);

          // Get start/end times for each log (use cached stats when available)
          const logMeta = [];
          for (const fn of unique) {
            const resolved = resolveLog(fn);
            if (!resolved) continue;
            try {
              const st = getCachedStats(resolved.path);
              if (st.startTime) {
                logMeta.push({ name: fn, start: st.startTime, end: st.endTime || st.startTime });
              }
            } catch (e) { app.debug(`Voyage detect skip ${fn}: ${e.message}`); }
          }

          // Group: consecutive logs with < 24 hour gap between end of one and start of next
          const maxGapMs = 24 * 3600000;
          const groups = [];
          let current = null;
          for (const lm of logMeta) {
            if (!current) {
              current = { logs: [lm.name], start: lm.start, end: lm.end };
            } else {
              const gap = new Date(lm.start) - new Date(current.end);
              if (gap < maxGapMs) {
                current.logs.push(lm.name);
                current.end = lm.end;
              } else {
                if (current.logs.length > 1) groups.push(current);
                current = { logs: [lm.name], start: lm.start, end: lm.end };
              }
            }
          }
          if (current && current.logs.length > 1) groups.push(current);

          // Filter out groups that already exist as voyages
          const vd = readVoyages();
          const existingLogSets = vd.voyages.map(v => v.logs.join(','));
          const suggestions = groups.filter(g => !existingLogSets.includes(g.logs.join(',')))
            .map(g => ({
              logs: g.logs,
              start: g.start,
              end: g.end,
              days: g.logs.length,
              suggestedName: g.start.split('T')[0] + ' → ' + g.end.split('T')[0]
            }));

          res.end(JSON.stringify(suggestions)); return;
        }

        // ── Cache warm-up ──
        if (p === '/api/cache/warm') {
          if (req.method === 'POST') {
            if (!logDir || !fs.existsSync(logDir)) { res.end(JSON.stringify({ warmed: 0 })); return; }
            const files = fs.readdirSync(logDir)
              .filter(f => f.startsWith('nmea0183_') && (f.endsWith('.log') || f.endsWith('.log.gz')));
            const unique = [...new Set(files.map(f => f.endsWith('.gz') ? f.slice(0, -3) : f))];
            let warmed = 0, skipped = 0;
            for (const fn of unique) {
              const resolved = resolveLog(fn);
              if (!resolved) continue;
              // Check if disk cache exists and is fresh
              const diskPath = statsCachePath(resolved.path);
              try {
                if (fs.existsSync(diskPath) && fs.statSync(diskPath).mtime.getTime() >= fs.statSync(resolved.path).mtime.getTime()) {
                  skipped++; continue;
                }
              } catch (e) { /* cache check failed, will re-parse */ }
              getCachedStats(resolved.path); // triggers parse + disk write
              warmed++;
            }
            res.end(JSON.stringify({ warmed, skipped, total: unique.length })); return;
          }
        }

        // ── Trash API ──
        if (p === '/api/trash') {
          if (req.method === 'GET') {
            if (!logDir || !fs.existsSync(logDir)) { res.end('[]'); return; }
            const files = fs.readdirSync(logDir)
              .filter(f => f.startsWith('nmea0183_') && (f.endsWith('.log.del') || f.endsWith('.log.gz.del')))
              .sort().reverse().map(f => {
                const s = fs.statSync(path.join(logDir, f));
                const baseName = f.replace('.del', '');
                return { name: baseName, size: s.size, modified: s.mtime.toISOString(),
                  date: baseName.replace('nmea0183_', '').replace('.log.gz', '').replace('.log', '').replace(/_part\d+/, '') };
              });
            res.end(JSON.stringify(files)); return;
          }
          if (req.method === 'POST') {
            readBody(req).then(body => {
              if (body.action === 'restore') {
                const fn = validFn(body.name);
                if (!fn) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid' })); return; }
                const delPath = path.join(logDir, fn + '.del');
                const restorePath = path.join(logDir, fn);
                if (!fs.existsSync(delPath)) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
                try {
                  fs.renameSync(delPath, restorePath);
                  const efpDel = eventsFilePath(fn) + '.del';
                  if (fs.existsSync(efpDel)) fs.renameSync(efpDel, eventsFilePath(fn));
                  res.end(JSON.stringify({ ok: true, restored: fn }));
                } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
              } else if (body.action === 'empty') {
                try {
                  const dels = fs.readdirSync(logDir).filter(f => f.endsWith('.del'));
                  for (const f of dels) fs.unlinkSync(path.join(logDir, f));
                  res.end(JSON.stringify({ ok: true, removed: dels.length }));
                } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
              } else if (body.action === 'delete') {
                const fn = validFn(body.name);
                if (!fn) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid' })); return; }
                const delPath = path.join(logDir, fn + '.del');
                if (!fs.existsSync(delPath)) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
                try {
                  fs.unlinkSync(delPath);
                  const efpDel = eventsFilePath(fn) + '.del';
                  if (fs.existsSync(efpDel)) fs.unlinkSync(efpDel);
                  res.end(JSON.stringify({ ok: true, deleted: fn }));
                } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
              } else {
                res.writeHead(400); res.end(JSON.stringify({ error: 'Unknown action' }));
              }
            }).catch(err => { res.writeHead(400); res.end(JSON.stringify({ error: err.message })); });
            return;
          }
        }

        // ── Engine / Fuel API ──
        if (p === '/api/engine') {
          if (req.method === 'GET') {
            const eng = readEngine();
            eng.totalHours = getTotalEngineHours();
            // Live tank level from SignalK
            try {
              const tankPath = eng.config.tankSensorPath || 'tanks.fuel.0.currentLevel';
              const tankVal = app.getSelfPath(tankPath);
              eng.tankLevel = (tankVal && tankVal.value !== undefined) ? tankVal.value : null;
            } catch (e) { eng.tankLevel = null; }
            // Calculate fuel stats
            if (eng.fuelLog.length >= 2) {
              const fullTanks = eng.fuelLog.filter(f => f.fullTank);
              if (fullTanks.length >= 2) {
                let totalL = 0, totalH = 0;
                for (let i = 1; i < fullTanks.length; i++) {
                  totalL += fullTanks[i].liters || 0;
                  totalH += (fullTanks[i].hours || 0) - (fullTanks[i - 1].hours || 0);
                }
                eng.avgConsumption = totalH > 0 ? Math.round(totalL / totalH * 100) / 100 : null;
              }
            }
            if (!eng.avgConsumption && eng.fuelLog.length) {
              const totalL = eng.fuelLog.reduce((s, f) => s + (f.liters || 0), 0);
              const lastH = eng.fuelLog[eng.fuelLog.length - 1].hours || 0;
              const firstH = eng.fuelLog[0].hours || 0;
              const dH = lastH - firstH;
              eng.avgConsumption = dH > 0 ? Math.round(totalL / dH * 100) / 100 : null;
            }
            res.end(JSON.stringify(eng)); return;
          }
          if (req.method === 'POST') {
            readBody(req).then(body => {
              const eng = readEngine();

              if (body.action === 'config') {
                // Update config: {action:'config', tankCapacityLiters, baseHours, tankSensorPath}
                if (body.tankCapacityLiters !== undefined) eng.config.tankCapacityLiters = Number(body.tankCapacityLiters);
                if (body.baseHours !== undefined) eng.config.baseHours = Number(body.baseHours);
                if (body.tankSensorPath !== undefined) eng.config.tankSensorPath = String(body.tankSensorPath);
                writeEngine(eng);
                res.end(JSON.stringify({ ok: true }));

              } else if (body.action === 'addFuel') {
                // {action:'addFuel', date, hours, liters, pricePerLiter, totalCost, fullTank, note}
                eng.fuelLog.push({
                  id: 'f_' + Date.now(),
                  date: body.date || new Date().toISOString().split('T')[0],
                  hours: Number(body.hours) || 0,
                  liters: Number(body.liters) || 0,
                  pricePerLiter: body.pricePerLiter !== undefined ? Number(body.pricePerLiter) : null,
                  totalCost: body.totalCost !== undefined ? Number(body.totalCost) : null,
                  fullTank: !!body.fullTank,
                  note: body.note ? String(body.note).substring(0, 500) : ''
                });
                eng.fuelLog.sort((a, b) => (a.date + ':' + a.hours).localeCompare(b.date + ':' + b.hours));
                writeEngine(eng);
                res.end(JSON.stringify({ ok: true }));

              } else if (body.action === 'deleteFuel') {
                eng.fuelLog = eng.fuelLog.filter(f => f.id !== body.id);
                writeEngine(eng);
                res.end(JSON.stringify({ ok: true }));

              } else if (body.action === 'addMaintenance') {
                // {action:'addMaintenance', date, hours, type, note}
                eng.maintenance.push({
                  id: 'm_' + Date.now(),
                  date: body.date || new Date().toISOString().split('T')[0],
                  hours: Number(body.hours) || 0,
                  type: String(body.type || 'other'),
                  note: body.note ? String(body.note).substring(0, 500) : ''
                });
                eng.maintenance.sort((a, b) => b.date.localeCompare(a.date));
                writeEngine(eng);
                res.end(JSON.stringify({ ok: true }));

              } else if (body.action === 'deleteMaintenance') {
                eng.maintenance = eng.maintenance.filter(m => m.id !== body.id);
                writeEngine(eng);
                res.end(JSON.stringify({ ok: true }));

              } else if (body.action === 'updateFuel') {
                // {action:'updateFuel', id, date?, hours?, liters?, pricePerLiter?, totalCost?, fullTank?, note?}
                const item = eng.fuelLog.find(f => f.id === body.id);
                if (!item) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
                if (body.date !== undefined) item.date = body.date;
                if (body.hours !== undefined) item.hours = Number(body.hours);
                if (body.liters !== undefined) item.liters = Number(body.liters);
                if (body.pricePerLiter !== undefined) item.pricePerLiter = body.pricePerLiter !== null ? Number(body.pricePerLiter) : null;
                if (body.totalCost !== undefined) item.totalCost = body.totalCost !== null ? Number(body.totalCost) : null;
                if (body.fullTank !== undefined) item.fullTank = !!body.fullTank;
                if (body.note !== undefined) item.note = String(body.note).substring(0, 500);
                eng.fuelLog.sort((a, b) => (a.date + ':' + a.hours).localeCompare(b.date + ':' + b.hours));
                writeEngine(eng);
                res.end(JSON.stringify({ ok: true }));

              } else if (body.action === 'updateMaintenance') {
                // {action:'updateMaintenance', id, date?, hours?, type?, note?}
                const item = eng.maintenance.find(m => m.id === body.id);
                if (!item) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
                if (body.date !== undefined) item.date = body.date;
                if (body.hours !== undefined) item.hours = Number(body.hours);
                if (body.type !== undefined) item.type = String(body.type);
                if (body.note !== undefined) item.note = String(body.note).substring(0, 500);
                eng.maintenance.sort((a, b) => b.date.localeCompare(a.date));
                writeEngine(eng);
                res.end(JSON.stringify({ ok: true }));

              } else if (body.action === 'updateSchedule') {
                // {action:'updateSchedule', schedule: [{type,intervalHours,intervalMonths,label}]}
                eng.schedule = Array.isArray(body.schedule) ? body.schedule : eng.schedule;
                writeEngine(eng);
                res.end(JSON.stringify({ ok: true }));

              } else {
                res.writeHead(400); res.end(JSON.stringify({ error: 'Unknown action' }));
              }
            }).catch(err => { res.writeHead(400); res.end(JSON.stringify({ error: err.message })); });
            return;
          }
        }

        // ── Power / Electrical API ──
        if (p === '/api/power') {
          const paths = {
            'electrical.batteries.0.voltage': 'voltage',
            'electrical.batteries.0.current': 'current',
            'electrical.batteries.0.capacity.stateOfCharge': 'soc',
            'electrical.batteries.0.temperature': 'batteryTemp',
            'electrical.batteries.1.voltage': 'voltage2',
            'electrical.batteries.1.current': 'current2',
            'electrical.chargers.0.current': 'chargerCurrent',
            'electrical.alternators.0.current': 'alternatorCurrent',
            'electrical.solar.0.current': 'solarCurrent',
            'electrical.solar.0.voltage': 'solarVoltage'
          };
          const data = {};
          for (const [skPath, key] of Object.entries(paths)) {
            try {
              const val = app.getSelfPath(skPath);
              data[key] = (val && val.value !== undefined) ? val.value : null;
            } catch (e) { data[key] = null; }
          }
          // Convert units
          if (data.soc !== null) data.soc = Math.round(data.soc * 100);
          if (data.batteryTemp !== null) data.batteryTemp = Math.round((data.batteryTemp - 273.15) * 10) / 10;
          // Calculate power
          if (data.voltage !== null && data.current !== null) data.watts = Math.round(data.voltage * data.current);
          // Ah estimation from current day's log
          data.todayAh = null;
          try {
            const todayFn = 'nmea0183_' + getDateString() + '.log';
            const resolved = resolveLog(todayFn);
            if (resolved) {
              const st = getCachedStats(resolved.path);
              if (st && st.ahConsumed) data.todayAh = st.ahConsumed;
            }
          } catch (e) { app.debug(`Power Ah lookup: ${e.message}`); }
          res.end(JSON.stringify(data)); return;
        }

        // ── Crew API ──
        if (p === '/api/crew') {
          if (req.method === 'GET') {
            res.end(JSON.stringify(readCrew())); return;
          }
          if (req.method === 'POST') {
            readBody(req).then(body => {
              const crew = readCrew();
              if (body.action === 'add') {
                crew.members.push({
                  id: 'c_' + Date.now(),
                  name: String(body.name || '').substring(0, 200),
                  role: ['skipper', 'mate', 'crew', 'guest'].includes(body.role) ? body.role : 'crew',
                  cert: body.cert ? String(body.cert).substring(0, 500) : '',
                  from: body.from || '',
                  to: body.to || ''
                });
                writeCrew(crew);
                jsonOk(res, { ok: true });
              } else if (body.action === 'update') {
                const m = crew.members.find(x => x.id === body.id);
                if (!m) { jsonError(res, 404, 'Not found'); return; }
                if (body.name !== undefined) m.name = String(body.name).substring(0, 200);
                if (body.role !== undefined) m.role = body.role;
                if (body.cert !== undefined) m.cert = String(body.cert).substring(0, 500);
                if (body.from !== undefined) m.from = body.from;
                if (body.to !== undefined) m.to = body.to;
                writeCrew(crew);
                jsonOk(res, { ok: true });
              } else if (body.action === 'delete') {
                crew.members = crew.members.filter(x => x.id !== body.id);
                writeCrew(crew);
                jsonOk(res, { ok: true });
              } else {
                jsonError(res, 400, 'Unknown action');
              }
            }).catch(e => jsonError(res, 400, e.message));
            return;
          }
        }

        // ── Report API ──
        const reportMatch = p.match(/^\/api\/logs\/([^/]+)\/report$/);
        if (reportMatch) {
          const fn = validFn(reportMatch[1]);
          if (!fn) { jsonError(res, 400, 'Invalid'); return; }
          const resolved = resolveLog(fn);
          if (!resolved) { jsonError(res, 404, 'Not found'); return; }
          const st = getCachedStats(resolved.path);
          if (!st) { jsonError(res, 500, 'Parse failed'); return; }
          const baseFn = fn.endsWith('.gz') ? fn.slice(0, -3) : fn;
          st.filename = baseFn;
          setLogDate(st, resolved.path);
          mergeManualEvents(st, baseFn);
          // Attach avg consumption for fuel estimate
          try {
            const eng = readEngine();
            if (eng.avgConsumption && st.fuelSegments) {
              st.fuelSegments.estimatedLiters = st.engineHours * eng.avgConsumption;
            }
          } catch (e) { /* no engine data */ }
          const format = url.searchParams.get('format') || 'markdown';
          const md = generateDayReport(st, readEngine());
          if (format === 'json') {
            res.end(JSON.stringify({ markdown: md, stats: st })); return;
          }
          // Return markdown
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          res.end(md); return;
        }


        const voyageMatch = p.match(/^\/api\/voyages\/([^/]+?)(?:\/(stats|gpx|csv))?$/);
        if (voyageMatch) {
          const vid = voyageMatch[1];
          const vAction = voyageMatch[2];
          const vd = readVoyages();
          const voyage = vd.voyages.find(v => v.id === vid);
          if (!voyage) { res.writeHead(404); res.end(JSON.stringify({ error: 'Voyage not found' })); return; }

          // Parse all logs in this voyage (cached)
          const dayStats = [];
          const missingLogs = [];
          for (const logFn of voyage.logs) {
            const resolved2 = resolveLog(logFn);
            if (!resolved2) { missingLogs.push(logFn); continue; }
            const useFullTrack = vAction === 'gpx';
            const st = getCachedStats(resolved2.path, { fullTrack: useFullTrack });
            if (!st) { missingLogs.push(logFn); continue; }
            st.filename = logFn;
            setLogDate(st, resolved2.path);
            mergeManualEvents(st, logFn);
            dayStats.push(st);
          }

          // Build combined stats
          const combined = {
            id: voyage.id,
            name: voyage.name,
            note: voyage.note || '',
            days: dayStats.length,
            logs: voyage.logs,
            missingLogs: missingLogs.length ? missingLogs : undefined,
            // Combined track (all days concatenated)
            track: dayStats.flatMap(d => d.track || []),
            // Totals
            totalDistanceNm: Math.round(dayStats.reduce((s, d) => s + (d.totalDistanceNm || 0), 0) * 100) / 100,
            totalEngineHours: Math.round(dayStats.reduce((s, d) => s + (d.engineHours || 0), 0) * 100) / 100,
            totalEnginePeriods: dayStats.reduce((s, d) => s + (d.enginePeriods ? d.enginePeriods.length : 0), 0),
            startTime: dayStats.length ? dayStats[0].startTime : null,
            endTime: dayStats.length ? dayStats[dayStats.length - 1].endTime : null,
            durationHours: null,
            // Averages & maxes across all days
            sogAvgKn: null, sogMaxKn: null, twsAvgKn: null, twsMaxKn: null,
            // All events merged
            events: dayStats.flatMap(d => (d.events || []).map(ev =>
              Object.assign({}, ev, { logFile: d.filename, logDate: d.logDate })
            )).sort((a, b) => (a.time || '').localeCompare(b.time || '')),
            // Per-day breakdown
            perDay: dayStats.map(d => ({
              filename: d.filename, logDate: d.logDate,
              distanceNm: d.totalDistanceNm, durationHours: d.durationHours,
              sogAvgKn: d.sogAvgKn, sogMaxKn: d.sogMaxKn,
              twsAvgKn: d.twsAvgKn, twsMaxKn: d.twsMaxKn,
              engineHours: d.engineHours,
              eventCount: d.events ? d.events.length : 0,
              trackPoints: d.trackPoints
            }))
          };
          // Compute totals
          if (combined.startTime && combined.endTime) {
            combined.durationHours = Math.round((new Date(combined.endTime) - new Date(combined.startTime)) / 3600000 * 100) / 100;
          }
          // Weighted SOG avg, overall max
          const totalSogSamples = dayStats.reduce((s, d) => s + (d.sogSamples || 0), 0);
          if (totalSogSamples > 0) {
            combined.sogAvgKn = Math.round(dayStats.reduce((s, d) => s + (d.sogAvgKn || 0) * (d.sogSamples || 0), 0) / totalSogSamples * 100) / 100;
          }
          combined.sogMaxKn = dayStats.reduce((m, d) => Math.max(m, d.sogMaxKn || 0), 0) || null;
          const totalTwsSamples = dayStats.reduce((s, d) => s + (d.twsSamples || 0), 0);
          if (totalTwsSamples > 0) {
            combined.twsAvgKn = Math.round(dayStats.reduce((s, d) => s + (d.twsAvgKn || 0) * (d.twsSamples || 0), 0) / totalTwsSamples * 100) / 100;
          }
          combined.twsMaxKn = dayStats.reduce((m, d) => Math.max(m, d.twsMaxKn || 0), 0) || null;
          // Best day
          combined.bestDistance = combined.perDay.reduce((best, d) => (!best || (d.distanceNm || 0) > (best.distanceNm || 0)) ? d : best, null);
          combined.bestSpeed = combined.perDay.reduce((best, d) => (!best || (d.sogMaxKn || 0) > (best.sogMaxKn || 0)) ? d : best, null);

          // Depth aggregation across days
          const depthDays = dayStats.filter(d => d.depthSamples > 0);
          if (depthDays.length) {
            combined.depthMinM = Math.min(...depthDays.map(d => d.depthMinM));
            combined.depthMaxM = Math.max(...depthDays.map(d => d.depthMaxM));
            const totalDepthSamples = depthDays.reduce((s, d) => s + d.depthSamples, 0);
            combined.depthAvgM = Math.round(depthDays.reduce((s, d) => s + (d.depthAvgM || 0) * d.depthSamples, 0) / totalDepthSamples * 10) / 10;
            combined.depthSamples = totalDepthSamples;
            // Shallowest across all days
            let globalShallowest = null;
            for (const d of depthDays) {
              if (d.shallowest && (!globalShallowest || d.shallowest.depth < globalShallowest.depth)) globalShallowest = d.shallowest;
            }
            combined.shallowest = globalShallowest;
          }

          // Autopilot aggregation
          const hdgDays = dayStats.filter(d => d.hdgSamples > 0);
          const rsaDays = dayStats.filter(d => d.rsaSamples > 0);
          const xteDays = dayStats.filter(d => d.xteSamples > 0);
          if (rsaDays.length) {
            const totalRsa = rsaDays.reduce((s, d) => s + d.rsaSamples, 0);
            combined.rsaAvgDeg = Math.round(rsaDays.reduce((s, d) => s + (d.rsaAvgDeg || 0) * d.rsaSamples, 0) / totalRsa * 10) / 10;
            combined.rsaMaxDeg = Math.max(...rsaDays.map(d => d.rsaMaxDeg || 0));
            combined.rsaSamples = totalRsa;
          }
          if (xteDays.length) {
            const totalXte = xteDays.reduce((s, d) => s + d.xteSamples, 0);
            combined.xteAvgNm = Math.round(xteDays.reduce((s, d) => s + (d.xteAvgNm || 0) * d.xteSamples, 0) / totalXte * 100) / 100;
            combined.xteMaxNm = Math.max(...xteDays.map(d => d.xteMaxNm || 0));
            combined.xteSamples = totalXte;
          }
          const allApSegs = dayStats.flatMap(d => d.apSegments || []);
          if (allApSegs.length) combined.apSegments = allApSegs;

          if (!vAction || vAction === 'stats') {
            res.end(JSON.stringify(combined)); return;
          }
          if (vAction === 'gpx') {
            const wantAIS = url.searchParams.get('ais') === '1';
            // Re-parse with AIS if requested
            if (wantAIS) {
              const allAIS = {};
              for (const ds of dayStats) {
                const resolved3 = resolveLog(ds.filename);
                if (!resolved3) continue;
                const aisSt = getCachedStats(resolved3.path, { fullTrack: false, includeAIS: true });
                if (aisSt.aisVessels) {
                  for (const [mmsi, pts] of Object.entries(aisSt.aisVessels)) {
                    if (!allAIS[mmsi]) allAIS[mmsi] = [];
                    allAIS[mmsi] = allAIS[mmsi].concat(pts);
                  }
                }
              }
              combined.aisVessels = allAIS;
            }
            const gpx = toGPX(combined, { name: voyage.name, includeEvents: true, includeAIS: wantAIS, perDay: combined.perDay });
            res.writeHead(200, {
              'Content-Type': 'application/gpx+xml',
              'Content-Disposition': `attachment; filename="${voyage.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.gpx"`
            });
            res.end(gpx); return;
          }
          if (vAction === 'csv') {
            combined.filename = voyage.name;
            const csv = toCSV(combined);
            res.writeHead(200, {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="${voyage.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv"`
            });
            res.end(csv); return;
          }
        }
        const m = p.match(/^\/api\/logs\/([^/]+?)(?:\/(stats|download|weather|events|gpx|csv))?$/);
        if (m) {
          const fn = validFn(m[1]);
          if (!fn) { res.writeHead(400); res.end(JSON.stringify({error:'Invalid'})); return; }
          const baseFn = fn.endsWith('.gz') ? fn.slice(0, -3) : fn;
          const resolved = resolveLog(baseFn);
          if (!resolved) { res.writeHead(404); res.end(JSON.stringify({error:'Not found'})); return; }
          const fp = resolved.path;
          const action = m[2];

          // Soft-delete: rename .log to .log.del
          if (req.method === 'DELETE' && !action) {
            // Block deletion of the currently active log file
            if (currentLogDate && baseFn.includes(currentLogDate)) {
              res.writeHead(409); res.end(JSON.stringify({ error: 'Cannot delete the active log file' })); return;
            }
            // Block deletion if log is part of a voyage
            const vd = readVoyages();
            const inVoyages = vd.voyages.filter(v => v.logs.includes(baseFn));
            if (inVoyages.length) {
              const names = inVoyages.map(v => v.name).join(', ');
              res.writeHead(409); res.end(JSON.stringify({ error: 'Log is part of voyage: ' + names, voyages: inVoyages.map(v => v.name) })); return;
            }
            try {
              const delPath = fp + '.del';
              fs.renameSync(fp, delPath);
              // Also move events sidecar
              const efp = eventsFilePath(baseFn);
              if (fs.existsSync(efp)) fs.renameSync(efp, efp + '.del');
              invalidateCache(fp);
              res.end(JSON.stringify({ deleted: baseFn }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
            return;
          }

          if (action === 'gpx') {
            const wantAIS = url.searchParams.get('ais') === '1';
            const st = getCachedStats(fp, { fullTrack: true, includeAIS: wantAIS });
            mergeManualEvents(st, baseFn);
            st.filename = baseFn;
            const includeEvents = url.searchParams.get('events') !== '0';
            const gpxName = baseFn.replace('nmea0183_', '').replace('.log', '');
            const gpx = toGPX(st, { name: gpxName, includeEvents, includeAIS: wantAIS });
            const dlName = baseFn.replace('.log', '.gpx');
            res.writeHead(200, {
              'Content-Type': 'application/gpx+xml',
              'Content-Disposition': `attachment; filename="${dlName}"`
            });
            res.end(gpx); return;
          }

          if (action === 'csv') {
            const st = getCachedStats(fp);
            st.filename = baseFn;
            setLogDate(st, fp);
            mergeManualEvents(st, baseFn);
            const csv = toCSV(st);
            const dlName = baseFn.replace('.log', '.csv');
            res.writeHead(200, {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="${dlName}"`
            });
            res.end(csv); return;
          }

          if (action === 'stats') {
            const st = getCachedStats(fp);
            st.filename = baseFn;
            st.compressed = resolved.gz;
            setLogDate(st, fp);
            mergeManualEvents(st, baseFn);
            setStatsCacheHeader(res, baseFn);
            res.end(JSON.stringify(st)); return;
          }

          if (action === 'events') {
            if (req.method === 'GET') {
              const ef = readEventsFile(baseFn);
              res.end(JSON.stringify(ef)); return;
            }
            if (req.method === 'POST') {
              app.debug(`Events POST for ${fn}`);
              readBody(req).then(body => {
                app.debug(`Events body: ${JSON.stringify(body).substring(0, 200)}`);
                const ef = readEventsFile(baseFn);
                if (body.action === 'add') {
                  // Add manual event: {action:'add', type, detail, time?, note?}
                  const VALID_TYPES = ['hazard','sighting','vhf','note','custom'];
                  const evType = VALID_TYPES.includes(body.type) ? body.type : 'note';
                  const ev = {
                    type: evType,
                    time: body.time || new Date().toISOString(),
                    detail: String(body.detail || '').substring(0, 500),
                    manual: true
                  };
                  if (body.note) ev.note = String(body.note).substring(0, 1000);
                  ef.manualEvents.push(ev);
                  ef.manualEvents.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
                  writeEventsFile(baseFn, ef);
                  publishNotification(ev);
                  res.end(JSON.stringify({ ok: true, event: ev }));
                } else if (body.action === 'note') {
                  // Add/edit note on event: {action:'note', type, time, detail, note}
                  const key = `${body.type}:${body.time}:${body.detail||''}`;
                  if (body.note && body.note.trim()) {
                    ef.notes[key] = String(body.note).substring(0, 1000);
                  } else {
                    delete ef.notes[key];
                  }
                  writeEventsFile(baseFn, ef);
                  res.end(JSON.stringify({ ok: true, key }));
                } else if (body.action === 'delete') {
                  // Delete manual event: {action:'delete', type, time}
                  const idx = ef.manualEvents.findIndex(e => e.type === body.type && e.time === body.time);
                  if (idx >= 0) {
                    ef.manualEvents.splice(idx, 1);
                    writeEventsFile(baseFn, ef);
                    res.end(JSON.stringify({ ok: true, deleted: true }));
                  } else {
                    res.writeHead(404); res.end(JSON.stringify({ error: 'Event not found' }));
                  }
                } else if (body.action === 'lognote') {
                  // Day-log note: {action:'lognote', text}
                  if (body.text && body.text.trim()) {
                    ef.logNote = String(body.text).substring(0, 2000);
                  } else {
                    delete ef.logNote;
                  }
                  writeEventsFile(baseFn, ef);
                  res.end(JSON.stringify({ ok: true }));
                } else {
                  res.writeHead(400); res.end(JSON.stringify({ error: 'Unknown action' }));
                }
              }).catch(err => { app.error(`Events POST error: ${err.message}`); res.writeHead(400); res.end(JSON.stringify({ error: err.message })); });
              return;
            }
            res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return;
          }

          if (action === 'weather') {
            const st = getCachedStats(fp);
            if (!st.weatherIntervals || !st.weatherIntervals.length || !st.startTime) {
              res.end(JSON.stringify([])); return;
            }
            const dateStr = st.startTime.split('T')[0];
            fetchWeather(st.weatherIntervals, dateStr)
              .then(data => { res.end(JSON.stringify(data)); })
              .catch(err => { res.writeHead(500); res.end(JSON.stringify({error: err.message})); });
            return;
          }
          if (action === 'download') {
            if (resolved.gz) {
              // Decompress and serve
              const content = readLogContent(fp);
              res.writeHead(200, { 'Content-Type':'application/octet-stream', 'Content-Disposition':`attachment; filename="${baseFn}"`, 'Content-Length': Buffer.byteLength(content) });
              res.end(content); return;
            }
            const stat = fs.statSync(fp);
            res.writeHead(200, { 'Content-Type':'application/octet-stream', 'Content-Disposition':`attachment; filename="${baseFn}"`, 'Content-Length':stat.size });
            fs.createReadStream(fp).pipe(res); return;
          }
          const lines = parseInt(url.searchParams.get('lines')) || 0;
          const filter = url.searchParams.get('filter') || '';
          // Optimization: for .gz files with small line requests and no filter, use stats for line count
          let a, tot;
          if (resolved.gz && lines > 0 && !filter) {
            // Read last N lines — must decompress, but cache the result
            const memKey = fp + ':tail:' + lines;
            const mtime = fs.statSync(fp).mtime.getTime();
            const cached = statsCache[memKey];
            if (cached && cached.mtime === mtime) {
              a = cached.data.lines;
              tot = cached.data.tot;
            } else {
              const c = readLogContent(fp);
              const all = c.split('\n').filter(l => l.trim());
              tot = all.length;
              a = all.slice(-lines);
              storeMemCache(memKey, mtime, { lines: a, tot });
            }
          } else {
            const c = readLogContent(fp);
            a = c.split('\n').filter(l => l.trim()); tot = a.length;
            if (filter) { const fu = filter.toUpperCase(); a = a.filter(l => l.toUpperCase().includes(fu)); }
            if (lines > 0) a = a.slice(-lines);
          }
          res.end(JSON.stringify({ filename:baseFn, totalLines:tot, returnedLines:a.length, filter:filter||null, lines:a })); return;
        }
        res.writeHead(404); res.end(JSON.stringify({error:'Not found'}));
      } catch (err) { app.debug(`API error: ${err.message}`); jsonError(res, 500, err.message); }
    };

    publicServer = http.createServer(handler);
    publicServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') { app.error(`NMEA logger: port ${port} busy, trying ${port+1}`); publicServer.listen(port+1, '0.0.0.0'); }
      else { app.error(`NMEA logger API error: ${err.message}`); }
    });
    publicServer.listen(port, '0.0.0.0', () => {
      const actualPort = publicServer.address().port;
      app.debug(`NMEA logger public API on port ${actualPort}`);
      app.setPluginStatus(`Started. Public API on port ${actualPort}`);
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────
  plugin.start = function (o) {
    config = flattenConfig(o || {}); sentenceStats = {}; throttledCount = 0; dedupCount = 0;
    hasRMC = false; currentFilePart = 0; currentFileSize = 0;
    logDir = config.logDirectory || path.join(app.getDataDirPath(), 'nmea0183-logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    // Choose input source
    if (config.inputSource === 'signalk') {
      startDeltaInput();
      app.debug('Input source: SignalK delta stream');
    } else {
      app.on('nmea0183', handleSentence);
      unsubscribe = () => app.removeListener('nmea0183', handleSentence);
      app.debug('Input source: NMEA0183 direct');
    }

    statusInterval = setInterval(updateStatus, 10000);
    cleanupInterval = setInterval(cleanupThrottleMap, 60000);
    // Compress old logs on start and every 6 hours
    if ((config.compressAfterDays || 7) > 0) {
      setTimeout(compressOldLogs, 30000); // 30s after start
      compressInterval = setInterval(compressOldLogs, 6 * 3600000);
    }
    startPublicServer(config.apiPort || 3033);

    // Background pre-warming of stats cache (5-10 most recent logs)
    // Runs after startup is complete; uses setImmediate chain to yield between files.
    setTimeout(() => prewarmStatsCache(), 60000); // 1 min after start
  };

  /**
   * Background-warm the stats cache for recent logs without blocking the event loop.
   * Processes files one at a time with setImmediate between each, so HTTP requests
   * during pre-warming stay responsive.
   */
  function prewarmStatsCache() {
    if (!logDir || !fs.existsSync(logDir)) return;
    const files = fs.readdirSync(logDir)
      .filter(f => f.startsWith('nmea0183_') && (f.endsWith('.log') || f.endsWith('.log.gz')))
      .sort().reverse()
      .slice(0, 10); // Most recent 10 logs
    let warmed = 0, idx = 0;
    function next() {
      if (idx >= files.length) {
        if (warmed > 0) app.debug(`Pre-warmed stats cache: ${warmed} logs`);
        return;
      }
      const fn = files[idx++];
      const fp = path.join(logDir, fn);
      try {
        const isLive = currentLogDate && fp.includes(currentLogDate);
        if (isLive) { setImmediate(next); return; } // skip live log
        const cachePath = statsCachePath(fp);
        if (fs.existsSync(cachePath)) { setImmediate(next); return; } // already cached
        getCachedStats(fp);
        warmed++;
      } catch (e) { app.debug(`Pre-warm error ${fn}: ${e.message}`); }
      setImmediate(next); // yield to event loop between files
    }
    next();
  }
  plugin.stop = function () {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
    if (cleanupInterval) { clearInterval(cleanupInterval); cleanupInterval = null; }
    if (compressInterval) { clearInterval(compressInterval); compressInterval = null; }
    if (currentWriteStream) { currentWriteStream.end(); currentWriteStream = null; currentLogDate = null; }
    if (publicServer) { publicServer.close(); publicServer = null; }
    sentenceStats = {}; Object.keys(aisLastSeen).forEach(k => delete aisLastSeen[k]);
    Object.keys(statsCache).forEach(k => delete statsCache[k]);
  };

  plugin.registerWithRouter = function (router) {
    // Serve icon through SignalK's express router for admin UI
    router.get('/public/icon.svg', (req, res) => {
      const iconFile = path.join(__dirname, 'public', 'icon.svg');
      if (fs.existsSync(iconFile)) {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=604800');
        fs.createReadStream(iconFile).pipe(res);
      } else { res.status(404).end(); }
    });

    // Mirror read-only API endpoints through SignalK's authenticated router
    // These complement the public API on :3033 (which has no auth)
    router.get('/api/stats', (req, res) => {
      res.json({
        logDirectory: logDir,
        language: lang(),
        displayTitle: config.displayTitle || 'NMEA0183 Logger',
        inputSource: config.inputSource || 'nmea0183',
        currentLogFile: currentLogDate ? `nmea0183_${currentLogDate}${currentFilePart > 0 ? '_part' + currentFilePart : ''}.log` : null,
        isLive: lastSentenceTime > 0 && (Date.now() - lastSentenceTime) < C.LIVE_TIMEOUT_MS,
        lastActivity: lastSentenceTime > 0 ? new Date(lastSentenceTime).toISOString() : null
      });
    });

    router.get('/api/logs', (req, res) => {
      if (!logDir || !fs.existsSync(logDir)) { res.json([]); return; }
      const files = fs.readdirSync(logDir)
        .filter(f => f.startsWith('nmea0183_') && (f.endsWith('.log') || f.endsWith('.log.gz')))
        .sort().reverse().map(f => {
          const s = fs.statSync(path.join(logDir, f));
          const baseName = f.endsWith('.gz') ? f.slice(0, -3) : f;
          return { name: baseName, date: baseName.replace('nmea0183_', '').replace(/_part\d+/, '').replace('.log', ''), size: s.size, gz: f.endsWith('.gz') };
        });
      res.json(files);
    });

    router.get('/api/logs/:fn/stats', (req, res) => {
      const fn = validFn(req.params.fn);
      if (!fn) return res.status(400).json({ error: 'Invalid' });
      const resolved = resolveLog(fn);
      if (!resolved) return res.status(404).json({ error: 'Not found' });
      const st = getCachedStats(resolved.path);
      if (!st) return res.status(500).json({ error: 'Parse failed' });
      const baseFn = fn.endsWith('.gz') ? fn.slice(0, -3) : fn;
      st.filename = baseFn;
      setLogDate(st, resolved.path);
      mergeManualEvents(st, baseFn);
      res.json(st);
    });

    router.get('/api/engine', (req, res) => {
      const eng = readEngine();
      eng.totalHours = getTotalEngineHours();
      try {
        const tankPath = eng.config.tankSensorPath || 'tanks.fuel.0.currentLevel';
        const tankVal = app.getSelfPath(tankPath);
        eng.tankLevel = (tankVal && tankVal.value !== undefined) ? tankVal.value : null;
      } catch (e) { eng.tankLevel = null; }
      res.json(eng);
    });

    router.get('/api/power', (req, res) => {
      const paths = {
        'electrical.batteries.0.voltage': 'voltage',
        'electrical.batteries.0.current': 'current',
        'electrical.batteries.0.capacity.stateOfCharge': 'soc',
        'electrical.batteries.0.temperature': 'batteryTemp',
        'electrical.batteries.1.voltage': 'voltage2',
        'electrical.batteries.1.current': 'current2',
        'electrical.chargers.0.current': 'chargerCurrent',
        'electrical.alternators.0.current': 'alternatorCurrent',
        'electrical.solar.0.current': 'solarCurrent',
        'electrical.solar.0.voltage': 'solarVoltage'
      };
      const data = {};
      for (const [skPath, key] of Object.entries(paths)) {
        try { const val = app.getSelfPath(skPath); data[key] = (val && val.value !== undefined) ? val.value : null; }
        catch (e) { data[key] = null; }
      }
      if (data.soc !== null) data.soc = Math.round(data.soc * 100);
      if (data.batteryTemp !== null) data.batteryTemp = Math.round((data.batteryTemp - 273.15) * 10) / 10;
      if (data.voltage !== null && data.current !== null) data.watts = Math.round(data.voltage * data.current);
      res.json(data);
    });

    // Authenticated delete through SignalK router
    router.delete('/api/logs/:fn', (req, res) => {
      const fn = validFn(req.params.fn);
      if (!fn) return res.status(400).json({ error: 'Invalid' });
      const fp = path.join(logDir, fn);
      if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
      try { fs.unlinkSync(fp); res.json({ deleted: fn }); }
      catch (e) { res.status(500).json({ error: e.message }); }
    });
  };
  plugin.getOpenApi = () => ({});

  // ── Schema ──────────────────────────────────────────────────────

  /** Flatten nested config objects to flat keys for backward compat. */
  function flattenConfig(obj) {
    const flat = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        Object.assign(flat, flattenConfig(v));
      } else {
        flat[k] = v;
      }
    }
    return flat;
  }

  plugin.schema = function () {
    const sentenceGroups = {
      nav:['GGA','GLL','RMC','RMB','VTG','GSA','GSV','ZDA','GNS'],
      compass:['HDG','HDM','HDT'], wind:['MWV','MWD','VWR'],
      depth:['DBT','DBS','DBK','DPT'], speed:['VHW'],
      wpt:['APB','BOD','BWC','BWR','RTE','WPL','XTE','XDR'],
      ap:['RSA','RPM'], env:['MTW','MTA','MMB','MDA'],
      ais:['VDM','VDO'], misc:['TXT','TTM','TLL']
    };

    // Build sentence toggle properties per group
    function sentenceProps(types) {
      const props = {};
      for (const st of types) {
        props[`log_${st}`] = { type:'boolean', title:`${st} – ${SENTENCE_TYPES[st]}`, default:true };
      }
      return { type:'object', properties: props };
    }

    const langCodes = Object.keys(LANG);
    const langNames = langCodes.map(c => LANG[c]._name);

    return {
      type:'object', title:'NMEA0183 Logger',
      description:'Public API on separate port (default 3033). Delete requires SignalK login.',
      properties: {
        inputSource: { type:'string', title:'Input Source', description:'NMEA0183: log raw sentences. SignalK: log from SignalK data model (works with NMEA2000, etc.)', default:'nmea0183', enum:['nmea0183','signalk'], enumNames:['NMEA0183 (direct)','SignalK (universal)'] },
        deltaIntervalSec: { type:'number', title:'SignalK Sample Interval (sec)', description:'How often to write sentences from SignalK data. Only used in SignalK mode. Default: 10', default:10 },
        language: { type:'string', title:'Language', description:'UI and event language', default:'en', enum: langCodes, enumNames: langNames },
        displayTitle: { type:'string', title:'Display Title', description:'Shown in the header. Default: NMEA0183 Logger', default:'NMEA0183 Logger' },
        logDirectory: { type:'string', title:'Log Directory', description:'Leave empty for default.', default:'' },
        apiPort: { type:'number', title:'Public API Port', description:'Default: 3033', default:3033 },
        includeTimestamp: { type:'boolean', title:'Include ISO Timestamp', default:true },

        throttle: { type:'object', title:'Throttle & Dedup', properties: {
          aisThrottleSec: { type:'number', title:'AIS Throttle (VDM)', description:'Max 1 msg per MMSI per X sec. 0 = off. Default: 30', default:30 },
          gpsDedupRMC: { type:'boolean', title:'GPS Dedup: skip GGA/GLL when RMC available', description:'Also throttles VDO to heartbeat interval.', default:true },
          vdoHeartbeatSec: { type:'number', title:'VDO Heartbeat (sec)', description:'When dedup on: 1 VDO per X sec. 0 = skip all. Default: 180', default:180 }
        }},

        fileManagement: { type:'object', title:'File Management', properties: {
          maxFileSizeMB: { type:'number', title:'Max File Size (MB)', description:'New part file when exceeded. 0 = unlimited. Default: 50', default:50 },
          compressAfterDays: { type:'number', title:'Compress logs after (days)', description:'Gzip logs older than N days. 0 = disabled. Default: 7', default:7 },
          autoTrashDays: { type:'number', title:'Auto-empty trash after (days)', description:'Permanently delete trashed logs after N days. 0 = disabled. Default: 30', default:30 }
        }},

        events: { type:'object', title:'Events', properties: {
          evCourseEnabled: { type:'boolean', title:'Detect course changes', default:true },
          evCourseDeg: { type:'number', title:'Course change threshold (°)', description:'Default: 30', default:30 },
          evWindEnabled: { type:'boolean', title:'Detect wind speed changes', default:true },
          evWindKn: { type:'number', title:'Wind change threshold (kn)', description:'Default: 5', default:5 },
          evEngineEnabled: { type:'boolean', title:'Detect engine start/stop', default:true },
          evEngineRpmThreshold: { type:'number', title:'Engine RPM threshold', description:'RPM below this = engine off. Default: 100', default:100 },
          evBatteryEnabled: { type:'boolean', title:'Detect low battery voltage', default:true },
          evBatteryLowV: { type:'number', title:'Battery low voltage (V)', description:'Event when voltage drops below. Default: 12.0', default:12.0 }
        }},

        sentenceFilter: { type:'object', title:'Sentence Filter', properties: {
          logAllSentences: { type:'boolean', title:'Log ALL (override)', default:false },
          logUnknownSentences: { type:'boolean', title:'Log Unknown Types', default:true }
        }},

        sentencesNav:      Object.assign(sentenceProps(sentenceGroups.nav), { title:'Navigation' }),
        sentencesCompass:   Object.assign(sentenceProps(sentenceGroups.compass), { title:'Compass' }),
        sentencesWind:      Object.assign(sentenceProps(sentenceGroups.wind), { title:'Wind' }),
        sentencesDepth:     Object.assign(sentenceProps(sentenceGroups.depth), { title:'Depth' }),
        sentencesSpeed:     Object.assign(sentenceProps(sentenceGroups.speed), { title:'Speed' }),
        sentencesWptRoute:  Object.assign(sentenceProps([...sentenceGroups.wpt, ...sentenceGroups.ap]), { title:'WPT / Route / AP' }),
        sentencesEnv:       Object.assign(sentenceProps(sentenceGroups.env), { title:'Environment' }),
        sentencesAIS:       Object.assign(sentenceProps(sentenceGroups.ais), { title:'AIS' }),
        sentencesMisc:      Object.assign(sentenceProps(sentenceGroups.misc), { title:'Misc' })
      }
    };
  };

  return plugin;
};
