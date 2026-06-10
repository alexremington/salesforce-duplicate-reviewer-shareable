/*
 * Salesforce Duplicate Review is intentionally dependency-free: index.html loads
 * this file directly, so keep browser APIs plain and avoid build-step syntax.
 *
 * Runtime flow:
 * 1. JSON or CSV rows are ingested and mapped to a supported Salesforce object shape.
 * 2. buildGroups obtains a scoring context with prepared rows and account stats.
 * 3. Candidate buckets reduce pair comparisons before scoring.
 * 4. Group summaries use all pairwise scores, while render/export use originals.
 */

const IS_MATCHING_WORKER = typeof self !== "undefined" && self.__DUPLICATE_REVIEWER_MATCHING_WORKER__ === true;
const SHOULD_BOOT_UI = !IS_MATCHING_WORKER && typeof window !== "undefined" && typeof document !== "undefined";

const OBJECT_CONFIG = {
  contact: {
    label: "Contacts",
    singular: "Contact",
    displayFields: [
      "fullName",
      "firstName",
      "lastName",
      "company",
      "email",
      "leadSource",
      "ziPersonLinkedInUrl",
      "phone",
      "ziPhone",
      "mobile"
    ],
    fields: {
      recordId: ["id", "contact id", "salesforce id", "sf id"],
      fullName: ["full name", "fullname", "full_name", "contact name", "contactname", "name"],
      firstName: ["first name", "firstname", "first_name", "given name"],
      lastName: ["last name", "lastname", "last_name", "surname", "family name"],
      company: ["company", "account name", "account", "organization", "org"],
      email: ["email", "email address", "emailaddress", "e-mail"],
      leadSource: ["lead source", "leadsource", "lead_source", "source"],
      createdDate: ["created date", "createddate", "created", "created at", "created on", "create date"],
      ziPersonLinkedInUrl: [
        "zi person linkedin url",
        "zi person linkedin",
        "zoominfo person linkedin url",
        "zoominfo linkedin url",
        "person linkedin url",
        "linkedin url",
        "linkedin"
      ],
      phone: ["phone", "phone number", "business phone", "work phone"],
      ziPhone: [
        "zi phone",
        "zoominfo phone",
        "zi direct phone",
        "zoominfo direct phone",
        "zi person direct phone",
        "zipersondirectphonec"
      ],
      mobile: ["mobile", "mobile phone", "mobile number", "cell", "cell phone"],
      mirrorOf: [
        "mirror of",
        "mirrorof",
        "mirror of contact",
        "mirror of contact id",
        "mirror of record",
        "mirror_of__c",
        "entitled contact mirror of"
      ]
    }
  },
  account: {
    label: "Accounts",
    singular: "Account",
    displayFields: [
      "name",
      "website",
      "billingStreet",
      "billingCity",
      "billingState",
      "billingPostalCode",
      "billingCountry",
      "accountCurrency",
      "ultimateParentAccount"
    ],
    fields: {
      recordId: ["id", "account id", "salesforce id", "sf id"],
      name: ["name", "account", "account name", "accountname", "company", "organization"],
      website: ["website", "web site", "url", "domain"],
      billingStreet: ["billing street", "billingstreet", "billing address", "street"],
      billingCity: ["billing city", "billingcity", "city"],
      billingState: ["billing state/province", "billing state", "billingstate", "state", "province"],
      billingPostalCode: [
        "billing zip/postal code",
        "billing postal code",
        "billingpostcode",
        "billing zip",
        "postal code",
        "zip",
        "zip code"
      ],
      billingCountry: ["billing country", "billingcountry", "country"],
      accountCurrency: [
        "account currency",
        "currency",
        "currency iso code",
        "currencyisocode",
        "currency field",
        "pol currency field",
        "polcurrencyfieldc"
      ],
      ultimateParentAccount: [
        "ultimate parent account",
        "ultimate parent",
        "ultimate parent account name",
        "ultimate parent account id",
        "ultimate parent account c",
        "ultimate_parent_account__c",
        "ultimateparentaccount",
        "ultimateparentaccountc"
      ]
    }
  }
};

const FIELD_LABELS = {
  recordId: "Record ID",
  fullName: "Full Name",
  firstName: "First Name",
  lastName: "Last Name",
  company: "Company",
  email: "Email",
  leadSource: "Lead Source",
  createdDate: "Created Date",
  ziPersonLinkedInUrl: "ZI Person LinkedIn URL",
  phone: "Phone",
  ziPhone: "ZI Phone",
  mobile: "Mobile",
  mirrorOf: "Mirror of",
  name: "Name",
  website: "Website",
  billingStreet: "Billing Street",
  billingCity: "Billing City",
  billingState: "Billing State",
  billingPostalCode: "Billing Postal Code",
  billingCountry: "Billing Country",
  accountCurrency: "Account Currency",
  ultimateParentAccount: "Ultimate Parent Account"
};
const CONTACT_LEAD_SOURCE_FIELD = "leadSource";
const CONTACT_CREATED_DATE_FIELD = "createdDate";
const MERGE_FIELD_API_NAMES = {
  leadSource: "LeadSource"
};
const PREMERGE_FRESHNESS_FIELDS = [
  "fullName",
  "firstName",
  "lastName",
  "company",
  "email",
  "leadSource",
  "phone",
  "mobile"
];
const GROUP_FILTER_FIELD_TYPES = {
  recordId: "text",
  fullName: "text",
  firstName: "text",
  lastName: "text",
  company: "text",
  email: "text",
  leadSource: "text",
  createdDate: "date",
  ziPersonLinkedInUrl: "text",
  phone: "text",
  ziPhone: "text",
  mobile: "text",
  name: "text",
  website: "text",
  billingStreet: "text",
  billingCity: "text",
  billingState: "text",
  billingPostalCode: "text",
  billingCountry: "text",
  accountCurrency: "text",
  ultimateParentAccount: "text"
};
const GROUP_FILTER_OPERATORS = {
  text: [
    ["contains", "contains"],
    ["not_contains", "does not contain"],
    ["equals", "equals"],
    ["not_equals", "does not equal"],
    ["starts_with", "starts with"],
    ["ends_with", "ends with"],
    ["blank", "is blank"],
    ["not_blank", "is not blank"]
  ],
  number: [
    ["equals", "equals"],
    ["not_equals", "does not equal"],
    ["greater_or_equal", "at least"],
    ["less_or_equal", "at most"],
    ["greater_than", "greater than"],
    ["less_than", "less than"],
    ["between", "between"],
    ["blank", "is blank"],
    ["not_blank", "is not blank"]
  ],
  date: [
    ["equals", "on"],
    ["before", "before"],
    ["after", "after"],
    ["on_or_before", "on or before"],
    ["on_or_after", "on or after"],
    ["relative", "relative date"],
    ["blank", "is blank"],
    ["not_blank", "is not blank"]
  ],
  enum: [
    ["equals", "equals"],
    ["not_equals", "does not equal"]
  ]
};
const GROUP_FILTER_VALUELESS_OPERATORS = new Set(["blank", "not_blank"]);
const GROUP_FILTER_RELATIVE_DATES = [
  ["TODAY", "Today"],
  ["YESTERDAY", "Yesterday"],
  ["TOMORROW", "Tomorrow"],
  ["LAST_N_DAYS:7", "Last 7 days"],
  ["LAST_N_DAYS:30", "Last 30 days"],
  ["LAST_N_DAYS:60", "Last 60 days"],
  ["LAST_N_DAYS:90", "Last 90 days"],
  ["NEXT_N_DAYS:7", "Next 7 days"],
  ["NEXT_N_DAYS:30", "Next 30 days"],
  ["THIS_WEEK", "This week"],
  ["LAST_WEEK", "Last week"],
  ["NEXT_WEEK", "Next week"],
  ["THIS_MONTH", "This month"],
  ["LAST_MONTH", "Last month"],
  ["NEXT_MONTH", "Next month"],
  ["THIS_QUARTER", "This quarter"],
  ["LAST_QUARTER", "Last quarter"],
  ["NEXT_QUARTER", "Next quarter"],
  ["THIS_YEAR", "This year"],
  ["LAST_YEAR", "Last year"],
  ["NEXT_YEAR", "Next year"]
];
const GROUP_LABEL_STATUS_FILTERS = [
  ["unlabeled", "Unlabeled"],
  ["partial", "Partially labeled"],
  ["full", "Fully labeled"]
];
const GROUP_LABEL_STATUS_FILTER_VALUES = new Set(GROUP_LABEL_STATUS_FILTERS.map(([value]) => value));

const CONTACT_NAME_PREFIXES = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "mx",
  "dr",
  "prof",
  "rev",
  "hon",
  "honorable",
  "judge",
  "justice",
  "sen",
  "senator",
  "rep",
  "representative",
  "gov",
  "governor",
  "mayor",
  "amb",
  "ambassador",
  "president",
  "fr",
  "father",
  "rabbi",
  "imam",
  "capt",
  "captain",
  "lt",
  "col",
  "gen",
  "adm",
  "cmdr",
  "sgt",
  "the"
]);

const CONTACT_NAME_SUFFIXES = new Set([
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
  "esq",
  "esquire",
  "phd",
  "md",
  "jd",
  "dds",
  "dmd",
  "do",
  "dvm",
  "cpa",
  "mba",
  "rn",
  "pe"
]);

const CONTACT_NAME_PARTICLES = new Set([
  "da",
  "de",
  "del",
  "der",
  "di",
  "du",
  "la",
  "le",
  "st",
  "saint",
  "van",
  "von"
]);
const CONTACT_KNOWN_NICKNAME_GROUPS = [
  ["anthony", "tony"],
  ["bradley", "brad"],
  ["christienne", "christie", "chris"],
  ["christopher", "chris"],
  ["daniel", "dan"],
  ["david", "dave"],
  ["douglas", "doug"],
  ["edward", "ed", "eddie", "ted", "ned"],
  ["elizabeth", "beth", "betty", "eliza", "liz"],
  ["frances", "fran"],
  ["gerard", "gerry"],
  ["gregory", "greg"],
  ["james", "jim", "jimmy"],
  ["jeffrey", "jeff"],
  ["john", "jack"],
  ["joshua", "josh"],
  ["kenneth", "kenny"],
  ["katherine", "catherine", "cate", "kate", "katie", "kathy"],
  ["margaret", "maggie", "meg", "peg", "peggy"],
  ["martin", "marty"],
  ["nicolette", "nicole"],
  ["phillip", "phil"],
  ["richard", "rich", "rick", "dick"],
  ["robert", "rob", "bob", "bobby"],
  ["sandra", "sandy"],
  ["shulamit", "shula"],
  ["stephen", "steven", "steve"],
  ["william", "will", "bill", "billy"]
];
const CONTACT_KNOWN_NICKNAME_KEYS = new Set(
  CONTACT_KNOWN_NICKNAME_GROUPS.flatMap((group) => {
    const keys = [];
    group.forEach((left, leftIndex) => {
      group.slice(leftIndex + 1).forEach((right) => keys.push(symmetricPairKey(left, right)));
    });
    return keys;
  })
);

const MAX_DUPLICATE_BUCKET_SIZE = 75;
const MAX_CANDIDATE_PAIRS = 100000;
const MAX_HIGH_RECALL_CANDIDATE_PAIRS = 250000;
const CANDIDATE_ATTEMPT_LIMIT_FACTOR = 5;
const MATCHING_YIELD_INTERVAL_MS = 32;
const SCORING_CHUNK_SIZE = 1200;
const MATCHING_CACHE_MIN_THRESHOLD = 70;
const GROUP_ITEM_ESTIMATED_HEIGHT = 108;
const GROUP_LIST_OVERSCAN = 8;
const GROUP_LIST_VIRTUALIZATION_THRESHOLD = 60;
const DRAFT_GROUP_FILTER_ID = "__draft-filter";
const RECENT_FILE_LIMIT = 4;
const MAX_RECENT_FILE_CONTENT_BYTES = 20 * 1024 * 1024;
const REVIEW_STATE_LIMIT = 25;
const REVIEW_STATE_SAVE_DELAY_MS = 120;
const DATASET_KEY_SAMPLE_SIZE = 800;
const FILE_HISTORY_DB_NAME = "salesforce-duplicate-reviewer";
const FILE_HISTORY_DB_VERSION = 2;
const FILE_HISTORY_STORE = "recentFiles";
const REVIEW_STATE_STORE = "reviewStates";
const LATEST_STAGING_FILES_ENDPOINT = "/api/staging/latest-files";
const MATCHED_FIELD_THRESHOLD = 0.9;
const EXACT_HEADER_ONLY_ALIASES = new Set([
  "account",
  "currency",
  "name",
  "phone",
  "mobile",
  "cell",
  "url"
]);
const ACCOUNT_FIELD_WEIGHTS = {
  accountCurrency: 35,
  website: 25,
  billingStreet: 8,
  billingCity: 3,
  billingState: 2,
  billingPostalCode: 5,
  billingCountry: 2,
  ultimateParentAccount: 12,
  name: 8
};
const ACCOUNT_COMMON_POSITIVE_MIN_FACTORS = {
  accountCurrency: 0.15,
  billingCountry: 0.2,
  billingState: 0.25,
  billingCity: 0.45,
  ultimateParentAccount: 0.35,
  website: 0.45,
  billingPostalCode: 0.75,
  billingStreet: 0.85
};
const ACCOUNT_PARENT_BRANCH_DIVERGENCE_CAP = 78;
const CONTACT_FIELD_WEIGHTS = {
  nameSequence: 40,
  ziPersonLinkedInUrl: 25,
  phone: 18,
  email: 12,
  company: 10
};
const CONTACT_COMPANY_DIVERGENCE_THRESHOLD = 0.5;
const CONTACT_COMPANY_DIVERGENCE_CAP = 80;
const CONTACT_STRONG_IDENTITY_CONFLICT_CAP = 79;
const CONTACT_COMPANY_GEOGRAPHY_CONFLICT_CAP = 72;
const CONTACT_COMPANY_ALIGNMENT_THRESHOLD = 0.85;
const CONTACT_EMAIL_ORG_CORROBORATION_FLOOR = 88;
const CONTACT_CORROBORATED_EXACT_NAME_FLOOR = 86;
const CONTACT_SPARSE_EXACT_NAME_FLOOR = 86;
const CONTACT_EXACT_NAME_NEAR_COMPANY_CAP = 79;
const CONTACT_FIRST_NAME_COMPANY_DOMAIN_FLOOR = 86;
const CONTACT_SHORT_GIVEN_NAME_CONFLICT_CAP = 85;
const CONTACT_EMAIL_CONTEXT_CORROBORATION_MIN = 0.5;
const CONTACT_MIRROR_RELATIONSHIP_REASON = "Entitled Contact mirror";
const TRAINING_LABELS = {
  match: "Match",
  not_match: "Not Match",
  unsure: "Unsure"
};
const TRAINING_CONFIDENCE_LEVELS = ["high", "medium", "low"];
const TRAINING_PAIR_FIELDS = {
  contact: ["fullName", "company", "email", "leadSource", "ziPersonLinkedInUrl", "phone", "ziPhone", "mobile"],
  account: [
    "name",
    "accountCurrency",
    "website",
    "billingStreet",
    "billingCity",
    "billingPostalCode",
    "billingCountry",
    "ultimateParentAccount"
  ]
};
const ACCOUNT_CONTRADICTION_THRESHOLD = 0.5;
const ACCOUNT_EXACT_NAME_WEAK_WEBSITE_CAP = 85;
const ACCOUNT_UNCORROBORATED_NEAR_EXACT_NAME_CAP = 85;
const ACCOUNT_EXACT_DUPLICATE_FLOOR = 92;
const ACCOUNT_WEAK_WEBSITE_CONFLICT_MAX = 0.55;
const ACCOUNT_SCOPE_DIVERGENCE_CAP = 85;
const ACCOUNT_SCOPE_DIVERGENCE_TOKENS = new Set([
  "angeles",
  "authority",
  "broadband",
  "branch",
  "department",
  "brussels",
  "estate",
  "expressway",
  "foundation",
  "france",
  "group",
  "holdings",
  "los",
  "office",
  "president",
  "pty",
  "real",
  "retirement",
  "section",
  "strategies",
  "supply",
  "unit",
  "system"
]);
const CONTACT_CONTRADICTION_THRESHOLD = 0;
const RESOLUTION_RECORD_CONFIDENCE_BONUS = 8;
const ACCOUNT_BUCKET_TOKEN_LIMIT = 3;
const ACCOUNT_BUCKET_STOPWORDS = new Set([
  "association",
  "council",
  "department",
  "europe",
  "european",
  "foundation",
  "global",
  "government",
  "group",
  "international",
  "media",
  "office",
  "services"
]);
const ACCOUNT_NAME_DIVERGENCE_STOPWORDS = new Set([
  ...ACCOUNT_BUCKET_STOPWORDS,
  "and",
  "for",
  "of",
  "on"
]);
const ACCOUNT_BRANCH_TOKEN_STOPWORDS = new Set([
  ...ACCOUNT_NAME_DIVERGENCE_STOPWORDS,
  "department",
  "federal",
  "government",
  "office",
  "the",
  "u",
  "united",
  "us",
  "s",
  "states"
]);
const ENTITY_ANCHOR_STOPWORDS = new Set([
  ...ACCOUNT_NAME_DIVERGENCE_STOPWORDS,
  "administration",
  "administrators",
  "agency",
  "american",
  "association",
  "building",
  "capital",
  "college",
  "companies",
  "consulting",
  "council",
  "department",
  "development",
  "domestic",
  "foundation",
  "government",
  "insurance",
  "international",
  "london",
  "national",
  "office",
  "school",
  "schools",
  "society",
  "state",
  "surgeons",
  "university"
]);
const RELATED_EMAIL_DOMAIN_ROOT_MIN_LENGTH = 5;
const GENERIC_EMAIL_DOMAIN_ROOTS = new Set([
  "aol",
  "gmail",
  "hotmail",
  "icloud",
  "live",
  "me",
  "msn",
  "outlook",
  "protonmail",
  "yahoo"
]);
const GEOGRAPHIC_ENTITY_NAMES = [
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "district of columbia",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "west virginia",
  "wisconsin",
  "wyoming"
].map((name) => name.split(" "));

const SAMPLE_DATA = {
  contact: [
    {
      Id: "003-1001",
      "First Name": "Maya",
      "Last Name": "Rodriguez",
      Company: "Northstar Analytics",
      Email: "maya.rodriguez@northstar.com"
    },
    {
      Id: "003-1002",
      "First Name": "Maya",
      "Last Name": "Rodriquez",
      Company: "Northstar Analytics Inc.",
      Email: "maya.rodriguez@northstar.com"
    },
    {
      Id: "003-1003",
      "First Name": "John",
      "Last Name": "Pierce",
      Company: "CivicWire",
      Email: "jpierce@civicwire.io"
    },
    {
      Id: "003-1004",
      "First Name": "John",
      "Last Name": "Pierce",
      Company: "Civic Wire",
      Email: "john.pierce@civicwire.io"
    },
    {
      Id: "003-1005",
      "First Name": "Alana",
      "Last Name": "Kim",
      Company: "Bright Harbor",
      Email: "alana.kim@brightharbor.com"
    },
    {
      Id: "003-1006",
      "First Name": "Alan",
      "Last Name": "Kim",
      Company: "BrightHarbor",
      Email: "alan.kim@brightharbor.com"
    },
    {
      Id: "003-1007",
      "First Name": "Priya",
      "Last Name": "Nair",
      Company: "Summit Labs",
      Email: "priya.nair@summitlabs.com"
    }
  ],
  account: [
    {
      Id: "001-2001",
      Name: "Northstar Analytics Inc.",
      Website: "https://www.northstar.com",
      "Billing Street": "125 Market Street, Suite 400",
      "Billing City": "San Francisco",
      "Billing State": "CA",
      "Billing Postal Code": "94105",
      "Billing Country": "United States"
    },
    {
      Id: "001-2002",
      Name: "Northstar Analytics",
      Website: "northstar.com",
      "Billing Street": "125 Market St Ste 400",
      "Billing City": "San Francisco",
      "Billing State": "California",
      "Billing Postal Code": "94105",
      "Billing Country": "USA"
    },
    {
      Id: "001-2003",
      Name: "CivicWire LLC",
      Website: "https://civicwire.io",
      "Billing Street": "22 K Street NW",
      "Billing City": "Washington",
      "Billing State": "DC",
      "Billing Postal Code": "20001",
      "Billing Country": "United States"
    },
    {
      Id: "001-2004",
      Name: "Civic Wire",
      Website: "www.civicwire.io/",
      "Billing Street": "22 K St NW",
      "Billing City": "Washington",
      "Billing State": "District of Columbia",
      "Billing Postal Code": "20001",
      "Billing Country": "US"
    },
    {
      Id: "001-2005",
      Name: "Bright Harbor Media",
      Website: "brightharbor.media",
      "Billing Street": "45 Canal Road",
      "Billing City": "Boston",
      "Billing State": "MA",
      "Billing Postal Code": "02210",
      "Billing Country": "United States"
    },
    {
      Id: "001-2006",
      Name: "Bright Harbor Meda LLC",
      Website: "brightharbor.com",
      "Billing Street": "45 Canal Rd",
      "Billing City": "Boston",
      "Billing State": "Massachusetts",
      "Billing Postal Code": "02210",
      "Billing Country": "US"
    }
  ]
};

const state = {
  objectType: "contact",
  fileName: "",
  datasetSource: {
    endpoint: "",
    fileName: "",
    displayName: "",
    objectType: "contact",
    format: "",
    contractVersion: ""
  },
  datasetMetadata: {},
  datasetKey: "",
  reviewStateStatus: "",
  loadError: "",
  lastProcessingMode: "",
  loadingModal: {
    active: false,
    title: "",
    message: "",
    progress: 0
  },
  isLoadingFile: false,
  loadingFileName: "",
  headers: [],
  rows: [],
  mapping: {},
  groups: [],
  selectedGroupKey: "",
  decisions: new Map(),
  mergeResults: new Map(),
  trainingLabels: new Map(),
  trainingPairIndexes: new Map(),
  fieldResolutions: new Map(),
  separatedRecords: new Map(),
  threshold: 86,
  maxThreshold: 100,
  highRecallMode: true,
  sortDirection: "desc",
  reviewMode: "evaluate",
  trainingConfidence: "high",
  filters: [],
  filterLogicMode: "and",
  filterLogic: "",
  labelStatusFilters: new Set(),
  pendingLabelStatusFilters: new Set(),
  lastMatchingStats: null,
  recentFiles: []
};

let pendingCsvObjectType = "";
let scoringContextCache = null;
let matchingArtifactsCache = null;
let matchingArtifactsWarmCacheJob = null;
let reviewStateSaveTimer = 0;
let pendingReviewStateRecord = null;
let nextGroupFilterId = 1;
const mergeMasterSelections = new Map();
const mergePreviewStates = new Map();
const mergeInFlightGroupKeys = new Set();
const mergeReviewSession = {
  active: false,
  queueGroupKeys: [],
  submitting: false
};
let shortcutsReturnFocus = null;
// These caches are tied to immutable group arrays and are cleared on recompute.
let visibleGroupsCache = null;
let groupLookupCache = null;
let groupListRenderCache = null;
let detailRenderCache = "";
let groupListRenderFrame = 0;
let matchingWorkerRunner = null;

const els = {
  csvInput: document.getElementById("csvInput"),
  chooseCsvButton: document.getElementById("chooseCsvButton"),
  csvObjectMenu: document.getElementById("csvObjectMenu"),
  demoButton: document.getElementById("demoButton"),
  dropZone: document.getElementById("dropZone"),
  fileName: document.getElementById("fileName"),
  fileMeta: document.getElementById("fileMeta"),
  sourcePill: document.getElementById("sourcePill"),
  recentFileList: document.getElementById("recentFileList"),
  thresholdSlider: document.getElementById("thresholdSlider"),
  threshold: document.getElementById("threshold"),
  maxThreshold: document.getElementById("maxThreshold"),
  thresholdMinNumber: document.getElementById("thresholdMinNumber"),
  thresholdMaxNumber: document.getElementById("thresholdMaxNumber"),
  thresholdValue: document.getElementById("thresholdValue"),
  highRecallMode: document.getElementById("highRecallMode"),
  labelStatusFilter: document.getElementById("labelStatusFilter"),
  groupFilterBuilder: document.getElementById("groupFilterBuilder"),
  groupSortToggle: document.getElementById("groupSortToggle"),
  applyControlsButton: document.getElementById("applyControlsButton"),
  mappingPanel: document.getElementById("mappingPanel"),
  mappingGrid: document.getElementById("mappingGrid"),
  rerunButton: document.getElementById("rerunButton"),
  groupList: document.getElementById("groupList"),
  groupCount: document.getElementById("groupCount"),
  metrics: document.getElementById("metrics"),
  objectLabel: document.getElementById("objectLabel"),
  detailTitle: document.getElementById("detailTitle"),
  decisionStatus: document.getElementById("decisionStatus"),
  reviewModeButtons: [...document.querySelectorAll("[data-review-mode]")],
  detailSurface: document.getElementById("detailSurface"),
  previousGroupButton: document.getElementById("previousGroupButton"),
  nextGroupButton: document.getElementById("nextGroupButton"),
  groupNavigationStatus: document.getElementById("groupNavigationStatus"),
  duplicateButton: document.getElementById("duplicateButton"),
  notDuplicateButton: document.getElementById("notDuplicateButton"),
  exportButton: document.getElementById("exportButton"),
  exportMenuButton: document.getElementById("exportMenuButton"),
  exportMenu: document.getElementById("exportMenu"),
  datasetExportButton: document.getElementById("datasetExportButton"),
  workspaceExportButton: document.getElementById("workspaceExportButton"),
  trainingExportButton: document.getElementById("trainingExportButton"),
  codexTrainingButton: document.getElementById("codexTrainingButton"),
  workspaceImportButton: document.getElementById("workspaceImportButton"),
  trainingImportButton: document.getElementById("trainingImportButton"),
  workspaceImportInput: document.getElementById("workspaceImportInput"),
  trainingImportInput: document.getElementById("trainingImportInput"),
  shortcutsButton: document.getElementById("shortcutsButton"),
  shortcutsModal: document.getElementById("shortcutsModal"),
  shortcutsCloseButton: document.getElementById("shortcutsCloseButton"),
  loadingModal: document.getElementById("loadingModal"),
  loadingModalTitle: document.getElementById("loadingModalTitle"),
  loadingModalMessage: document.getElementById("loadingModalMessage"),
  loadingSplineStatus: document.getElementById("loadingSplineStatus"),
  loadingProgress: document.getElementById("loadingProgress"),
  loadingProgressBar: document.getElementById("loadingProgressBar")
};

if (SHOULD_BOOT_UI) {
els.chooseCsvButton.addEventListener("click", () => {
  setCsvObjectMenuOpen(els.csvObjectMenu.hidden);
});

els.exportMenuButton.addEventListener("click", () => {
  setExportMenuOpen(els.exportMenu.hidden);
});

els.reviewModeButtons.forEach((button) => {
  button.addEventListener("click", () => setReviewMode(button.dataset.reviewMode));
});

els.csvInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) loadFile(file, pendingCsvObjectType || state.objectType);
  pendingCsvObjectType = "";
});

els.csvObjectMenu.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-csv-object]");
  if (!button) return;

  openDatasetImport(button.dataset.csvObject);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest?.(".csv-picker")) setCsvObjectMenuOpen(false);
  if (!event.target.closest?.(".export-picker")) setExportMenuOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!els.shortcutsModal.hidden) {
      closeShortcutsModal();
      event.preventDefault();
      return;
    }
    setCsvObjectMenuOpen(false);
    setExportMenuOpen(false);
  }
  handleGroupNavigationKeyboardShortcut(event);
  handleTrainingKeyboardShortcut(event);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPendingReviewStateSave();
});

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPendingReviewStateSave);
}

els.demoButton.addEventListener("click", () => {
  loadDemoData();
});

async function loadDemoData() {
  showLoadingModal("Loading Demo Data", "Matching sample records.", 0);
  try {
    const rows = SAMPLE_DATA[state.objectType].map((row) => ({ ...row }));
    await ingestRows(rows, `Demo ${OBJECT_CONFIG[state.objectType].label}`, true);
  } finally {
    hideLoadingModal();
  }
}

els.threshold.addEventListener("input", () => syncThresholdInputs("min"));
els.maxThreshold.addEventListener("input", () => syncThresholdInputs("max"));
els.thresholdMinNumber.addEventListener("input", () => syncThresholdNumberInput("min-number"));
els.thresholdMaxNumber.addEventListener("input", () => syncThresholdNumberInput("max-number"));
els.thresholdMinNumber.addEventListener("change", () => syncThresholdInputs("min-number"));
els.thresholdMaxNumber.addEventListener("change", () => syncThresholdInputs("max-number"));
els.thresholdMinNumber.addEventListener("blur", () => syncThresholdInputs("min-number"));
els.thresholdMaxNumber.addEventListener("blur", () => syncThresholdInputs("max-number"));

els.groupSortToggle.addEventListener("click", toggleGroupSortDirection);
els.applyControlsButton.addEventListener("click", applyMatchControls);
els.labelStatusFilter.addEventListener("click", handleLabelStatusFilterClick);
els.labelStatusFilter.addEventListener("change", handleLabelStatusFilterChange);
els.groupFilterBuilder.addEventListener("click", handleGroupFilterClick);
els.groupFilterBuilder.addEventListener("change", handleGroupFilterChange);
els.groupFilterBuilder.addEventListener("input", handleGroupFilterInput);

els.rerunButton.addEventListener("click", () => {
  state.mapping = readMappingFromControls();
  recompute({ title: "Re-running Matches", message: "Matching records with the updated field mapping." });
});

els.duplicateButton.addEventListener("click", () => markDecision("duplicate"));
els.notDuplicateButton.addEventListener("click", () => markDecision("not-duplicate"));
els.datasetExportButton.addEventListener("click", () => {
  setExportMenuOpen(false);
  exportScoredDataset();
});
els.exportButton.addEventListener("click", () => {
  setExportMenuOpen(false);
  exportDecisions();
});
els.workspaceExportButton.addEventListener("click", () => {
  setExportMenuOpen(false);
  exportWorkspace();
});
els.trainingExportButton.addEventListener("click", () => {
  setExportMenuOpen(false);
  exportTrainingLabels();
});
els.codexTrainingButton.addEventListener("click", sendTrainingLabelsToCodex);
els.workspaceImportButton.addEventListener("click", () => {
  setCsvObjectMenuOpen(false);
  els.workspaceImportInput.value = "";
  els.workspaceImportInput.click();
});
els.trainingImportButton.addEventListener("click", () => {
  setCsvObjectMenuOpen(false);
  els.trainingImportInput.value = "";
  els.trainingImportInput.click();
});
els.workspaceImportInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) importWorkspace(file);
});
els.trainingImportInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) importTrainingLabels(file);
});
els.shortcutsButton.addEventListener("click", openShortcutsModal);
els.shortcutsCloseButton.addEventListener("click", closeShortcutsModal);
els.shortcutsModal.addEventListener("click", (event) => {
  if (event.target.closest?.("[data-shortcuts-close]")) closeShortcutsModal();
});
els.previousGroupButton.addEventListener("click", () => navigateGroup(-1));
els.nextGroupButton.addEventListener("click", () => navigateGroup(1));
els.groupList.addEventListener("click", (event) => {
  const opener = event.target.closest?.("[data-group-open-key]");
  if (!opener) return;
  selectGroup(opener.dataset.groupOpenKey);
});
els.groupList.addEventListener("scroll", () => {
  if (!els.groupList.classList.contains("is-virtualized")) return;
  if (groupListRenderFrame) return;

  groupListRenderFrame = requestAnimationFrame(() => {
    groupListRenderFrame = 0;
    renderGroups({ preserveScroll: true });
  });
});

els.detailSurface.addEventListener("change", (event) => {
  if (event.target.classList?.contains("field-resolution-select")) {
    setFieldResolution(event.target.dataset.groupKey, event.target.dataset.field, event.target.value);
    return;
  }
  if (event.target.classList?.contains("merge-master-radio")) {
    setMergeMasterSelection(event.target.dataset.groupKey, event.target.value);
    return;
  }
  if (event.target.classList?.contains("merge-field-radio")) {
    setMergeFieldResolution(event.target.dataset.groupKey, event.target.dataset.field, event.target.value);
    return;
  }
  if (event.target.classList?.contains("merge-master-select")) {
    setMergeMasterSelection(event.target.dataset.groupKey, event.target.value);
    return;
  }
  if (event.target.classList?.contains("training-confidence-select")) {
    setTrainingConfidence(event.target.value);
  }
});

els.detailSurface.addEventListener("input", (event) => {
});

els.detailSurface.addEventListener("click", (event) => {
  const emptyAction = event.target.closest?.("[data-empty-action]");
  if (emptyAction) {
    if (emptyAction.dataset.emptyAction === "choose-csv") {
      openDatasetImport(state.objectType);
      els.chooseCsvButton.focus();
    } else if (emptyAction.dataset.emptyAction === "demo-data") {
      loadDemoData();
    }
    return;
  }

  const labelButton = event.target.closest?.("[data-label-action]");
  if (labelButton) {
    handleTrainingLabelAction(labelButton.dataset.labelAction);
    return;
  }

  const mergeButton = event.target.closest?.("[data-merge-action]");
  if (mergeButton) {
    handleMergeAction(mergeButton);
    return;
  }

  const button = event.target.closest?.("[data-record-action]");
  if (!button) return;
  setRecordSeparated(
    button.dataset.groupKey,
    button.dataset.recordKey,
    button.dataset.recordAction === "separate"
  );
});

els.recentFileList.addEventListener("click", async (event) => {
  const button = event.target.closest?.("[data-file-id]");
  if (!button) return;
  await loadRecentFile(button.dataset.fileId);
});

["dragenter", "dragover"].forEach((eventName) => {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("is-dragging");
  });
});

els.dropZone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;
  if (file) loadFile(file);
});

setupCollapsiblePanels();
initializeFileHistory().finally(() => {
  loadFromUrlIfRequested();
});
render();
}

function setupCollapsiblePanels() {
  document.querySelectorAll("[data-collapsible-panel]").forEach((panel) => {
    const toggle = panel.querySelector("[data-collapse-toggle]");
    const body = document.getElementById(toggle?.getAttribute("aria-controls"));
    if (!toggle || !body) return;

    const defaultExpanded = panel.dataset.defaultExpanded === "true";
    setPanelExpanded(panel, toggle, body, defaultExpanded);

    toggle.addEventListener("click", () => {
      setPanelExpanded(panel, toggle, body, toggle.getAttribute("aria-expanded") !== "true");
    });
  });
}

function setPanelExpanded(panel, toggle, body, expanded) {
  panel.classList.toggle("is-collapsed", !expanded);
  toggle.setAttribute("aria-expanded", String(expanded));
  body.hidden = !expanded;
}

function setCsvObjectMenuOpen(isOpen) {
  els.csvObjectMenu.hidden = !isOpen;
  els.chooseCsvButton.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) setExportMenuOpen(false);
}

function openDatasetImport(objectType = state.objectType) {
  pendingCsvObjectType = normalizeObjectType(objectType, state.objectType);
  setCsvObjectMenuOpen(false);
  els.csvInput.value = "";
  els.csvInput.click();
}

function setExportMenuOpen(isOpen) {
  els.exportMenu.hidden = !isOpen;
  els.exportMenuButton.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) setCsvObjectMenuOpen(false);
}

function openShortcutsModal() {
  shortcutsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  els.shortcutsModal.hidden = false;
  document.body.classList.add("has-open-modal");
  els.shortcutsCloseButton.focus();
}

function closeShortcutsModal() {
  if (els.shortcutsModal.hidden) return;
  els.shortcutsModal.hidden = true;
  document.body.classList.remove("has-open-modal");
  shortcutsReturnFocus?.focus();
  shortcutsReturnFocus = null;
}

function loadFile(file, objectType = state.objectType) {
  beginFileLoad(file.name, objectType);
  const format = datasetFormatFromFileName(file.name);
  const reader = new FileReader();
  reader.onload = async () => {
    await nextPaint();
    try {
      showLoadingModal("Loading Dataset", `Parsing and matching ${file.name}.`);
      state.objectType = normalizeObjectType(objectType, state.objectType);
      await loadDatasetText(String(reader.result || ""), {
        fileName: file.name,
        objectType,
        format,
        size: file.size,
        saveRecent: true
      });
    } catch (error) {
      if (isAbortError(error)) return;
      state.loadError = error.message || "Dataset could not be loaded.";
      state.reviewStateStatus = state.loadError;
      endFileLoad();
      renderSource();
      renderDetail();
    } finally {
      hideLoadingModal();
    }
  };
  reader.onerror = () => {
    state.loadError = "Dataset could not be read.";
    state.reviewStateStatus = state.loadError;
    endFileLoad();
    hideLoadingModal();
    renderSource();
    renderDetail();
  };
  reader.readAsText(file);
}

function datasetFormatFromFileName(fileName = "") {
  return /\.json$/i.test(String(fileName || "")) ? "json" : "csv";
}

async function loadDatasetText(datasetText, {
  fileName,
  objectType = state.objectType,
  format = datasetFormatFromFileName(fileName),
  size = 0,
  saveRecent = false,
  displayName = "",
  endpoint = ""
} = {}) {
  state.objectType = normalizeObjectType(objectType, state.objectType);
  const result = await processMatchingJob({
    mode: "process-text",
    text: datasetText,
    format,
    fileName: fileName || datasetFileNameForFormat(format),
    objectType: state.objectType,
    threshold: state.threshold,
    highRecallMode: state.highRecallMode
  }, updateLoadingProgress);

  await applyProcessedDataset(result, { fromObjects: false });
  setLoadedDatasetSource({
    endpoint,
    fileName: result.fileName || fileName || datasetFileNameForFormat(format),
    displayName,
    objectType: normalizeObjectType(result.objectType || state.objectType),
    format: result.format || format,
    contractVersion: result.contractVersion || result.datasetMetadata?.contractVersion || "",
    metadata: extractDatasetMetadata(result)
  });
  if (saveRecent) {
    saveRecentFileInBackground({
      name: result.fileName || fileName || datasetFileNameForFormat(format),
      displayName,
      size: size || datasetText.length,
      objectType: normalizeObjectType(result.objectType || state.objectType),
      format: result.format || format,
      contractVersion: result.contractVersion || result.datasetMetadata?.contractVersion || "",
      content: endpoint ? "" : datasetText,
      endpoint
    });
  }
}

async function loadCsvText(csvText, { fileName, objectType = state.objectType, size = 0, saveRecent = false } = {}) {
  return loadDatasetText(csvText, {
    fileName: fileName || "CSV import",
    objectType,
    format: "csv",
    size,
    saveRecent
  });
}

function datasetFileNameForFormat(format) {
  return format === "json" ? "JSON import" : "CSV import";
}

async function loadFromUrlIfRequested() {
  const params = new URLSearchParams(window.location.search);
  const autoload = params.get("autoload") || params.get("source");
  const sources = {
    "staging-contacts": {
      endpoint: "/api/staging-contacts/latest.json",
      defaultObjectType: "contact",
      defaultFileName: "salesforce-report-latest.json",
      label: "Latest Contacts"
    },
    "staging-accounts": {
      endpoint: "/api/staging-accounts/latest.json",
      defaultObjectType: "account",
      defaultFileName: "salesforce-report-latest.json",
      label: "Latest Accounts"
    }
  };
  const source = sources[autoload];
  if (!source) return;

  const objectType = normalizeObjectType(params.get("object") || source.defaultObjectType, source.defaultObjectType);
  const fileName = params.get("name") || source.defaultFileName;

  beginFileLoad(fileName, objectType);
  try {
    showLoadingModal("Loading Dataset", `Fetching and matching ${fileName}.`);
    await nextPaint();
    const response = await fetch(source.endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error(`Dataset fetch failed: ${response.status}`);
    const datasetText = await response.text();
    await loadDatasetText(datasetText, {
      fileName,
      objectType,
      format: datasetFormatFromFileName(source.endpoint || fileName),
      size: datasetText.length,
      saveRecent: false,
      displayName: source.label,
      endpoint: source.endpoint
    });
    if (params.get("saveRecent") !== "0") {
      saveRecentFileInBackground({
        name: state.fileName || fileName,
        displayName: source.label,
        size: datasetText.length,
        objectType,
        format: datasetFormatFromFileName(source.endpoint || state.fileName || fileName),
        endpoint: source.endpoint
      });
    }
    if (params.get("notify") === "1") {
      notifyReviewReady(fileName, { sticky: params.get("sticky") === "1" }).catch(() => {});
    }
  } catch (error) {
    if (isAbortError(error)) return;
    state.loadError = error.message || "Dataset could not be loaded.";
    state.reviewStateStatus = state.loadError;
    endFileLoad();
    renderSource();
    renderDetail();
  } finally {
    hideLoadingModal();
  }
}

async function notifyReviewReady(fileName, { sticky = false } = {}) {
  await fetch("/api/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Duplicate Reviewer",
      message: `${fileName} is loaded and ready to review.`,
      sticky
    })
  });
}

function beginFileLoad(fileName, objectType = state.objectType) {
  flushPendingReviewStateSave();
  clearLoadedDatasetForPendingLoad();
  state.objectType = normalizeObjectType(objectType, state.objectType);
  state.isLoadingFile = true;
  state.loadingFileName = fileName || "";
  state.reviewStateStatus = "";
  state.loadError = "";
  showLoadingModal("Loading Dataset", `Reading ${fileName || "dataset"}.`);
  renderSource();
  renderDetail();
}

function clearLoadedDatasetForPendingLoad() {
  state.fileName = "";
  state.datasetSource = {
    endpoint: "",
    fileName: "",
    displayName: "",
    objectType: state.objectType,
    format: "",
    contractVersion: ""
  };
  state.datasetMetadata = {};
  state.lastProcessingMode = "";
  state.lastMatchingStats = null;
  state.headers = [];
  state.rows = [];
  state.mapping = {};
  state.groups = [];
  groupListRenderCache = null;
  detailRenderCache = "";
  state.selectedGroupKey = "";
  state.filters = [];
  state.filterLogic = "";
  state.filterLogicMode = "and";
  state.labelStatusFilters.clear();
  state.pendingLabelStatusFilters.clear();
  state.decisions.clear();
  state.mergeResults.clear();
  state.trainingLabels.clear();
  state.trainingPairIndexes.clear();
  state.fieldResolutions.clear();
  state.separatedRecords.clear();
  mergeMasterSelections.clear();
  mergePreviewStates.clear();
  mergeInFlightGroupKeys.clear();
  resetMergeReviewSession();
  scoringContextCache = null;
  matchingArtifactsCache = null;
  matchingArtifactsWarmCacheJob = null;
  groupLookupCache = null;
  visibleGroupsCache = null;
}

function endFileLoad() {
  state.isLoadingFile = false;
  state.loadingFileName = "";
}

function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function initializeFileHistory() {
  if (!isFileHistoryAvailable()) {
    renderRecentFiles("Recent files are unavailable in this browser");
    return;
  }

  try {
    await refreshRecentFiles();
  } catch {
    renderRecentFiles("Recent files could not be loaded");
    return;
  }

  try {
    await seedLatestStagingFiles();
  } catch (error) {
    console.warn("Latest exports could not be added to recent files", error);
  }
}

function isFileHistoryAvailable() {
  return typeof indexedDB !== "undefined";
}

function isServerBackedApp() {
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

async function seedLatestStagingFiles() {
  if (!isServerBackedApp()) return;

  const response = await fetch(LATEST_STAGING_FILES_ENDPOINT, { cache: "no-store" });
  if (!response.ok) return;

  const payload = await response.json();
  const files = Array.isArray(payload.files) ? payload.files : [];
  for (const file of files) {
    const endpoint = String(file.endpoint || "");
    const name = String(file.name || "");
    if (!endpoint || !name) continue;

    await saveRecentFile({
      name,
      displayName: String(file.label || file.displayName || name),
      size: Number(file.size) || 0,
      objectType: normalizeObjectType(file.objectType),
      format: datasetFormatFromFileName(name || endpoint),
      endpoint,
      updatedAt: Number(file.updatedAt) || Date.now()
    });
  }
}

async function loadRecentFile(fileId) {
  showLoadingModal("Loading Recent Dataset", "Reading saved file contents.");
  try {
    const record = await getRecentFile(fileId);
    if (!record) {
      renderRecentFiles("Recent file could not be found");
      await refreshRecentFiles();
      return;
    }

    const objectType = recentRecordObjectType(record, state.objectType);
    beginFileLoad(record.name, objectType);
    showLoadingModal("Loading Recent Dataset", `Parsing and matching ${record.name}.`);
    await nextPaint();
    const datasetText = await recentFileDatasetText(record);
    await loadDatasetText(datasetText, {
      fileName: record.name,
      objectType,
      format: record.format || datasetFormatFromFileName(record.name || record.endpoint),
      size: record.size || datasetText.length,
      saveRecent: false,
      displayName: record.displayName || record.name,
      endpoint: record.endpoint || ""
    });
    saveRecentFileInBackground({
      name: record.name,
      displayName: record.displayName || record.name,
      size: record.size || datasetText.length,
      objectType: normalizeObjectType(state.objectType),
      format: record.format || datasetFormatFromFileName(record.name || record.endpoint),
      contractVersion: record.contractVersion || "",
      content: record.content || "",
      endpoint: record.endpoint || ""
    });
  } catch (error) {
    if (isAbortError(error)) return;
    renderRecentFiles("Recent file could not be loaded");
  } finally {
    hideLoadingModal();
  }
}

async function recentFileDatasetText(record) {
  if (record.endpoint) {
    const response = await fetch(record.endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error(`Recent dataset fetch failed: ${response.status}`);
    return response.text();
  }

  return record.content || "";
}

function setLoadedDatasetSource({ endpoint = "", fileName = "", displayName = "", objectType = state.objectType, format = "", contractVersion = "", metadata = {} } = {}) {
  state.datasetSource = {
    endpoint: String(endpoint || ""),
    fileName: String(fileName || state.fileName || ""),
    displayName: String(displayName || fileName || state.fileName || ""),
    objectType: normalizeObjectType(objectType, state.objectType),
    format: String(format || datasetFormatFromFileName(fileName || endpoint || state.fileName)),
    contractVersion: String(contractVersion || metadata.contractVersion || state.datasetMetadata?.contractVersion || "")
  };
  state.datasetMetadata = sanitizeDatasetMetadata({
    ...(state.datasetMetadata || {}),
    ...metadata,
    contractVersion: state.datasetSource.contractVersion
  });
}

async function saveRecentFile(fileRecord) {
  if (!isFileHistoryAvailable()) return;
  const db = await openFileHistoryDb();
  const objectType = normalizeObjectType(fileRecord.objectType);
  const content = String(fileRecord.content || "");
  const endpoint = String(fileRecord.endpoint || "");
  const format = fileRecord.format || datasetFormatFromFileName(fileRecord.name || endpoint);
  const canStoreContent = !endpoint && content.length <= MAX_RECENT_FILE_CONTENT_BYTES;
  if (!endpoint && !canStoreContent) return;

  const record = {
    id: recentFileId(objectType, fileRecord.name),
    name: fileRecord.name,
    displayName: String(fileRecord.displayName || fileRecord.name),
    size: fileRecord.size || content.length,
    objectType,
    format,
    contractVersion: String(fileRecord.contractVersion || ""),
    content: canStoreContent ? content : "",
    endpoint,
    updatedAt: Number(fileRecord.updatedAt) || Date.now()
  };

  await putRecentFile(db, record);
  await trimRecentFiles(db);
  await refreshRecentFiles(db);
}

function saveRecentFileInBackground(fileRecord) {
  saveRecentFile(fileRecord).catch((error) => {
    console.warn("Recent file could not be saved", error);
  });
}

async function refreshRecentFiles(existingDb) {
  if (!isFileHistoryAvailable()) return;
  const db = existingDb || (await openFileHistoryDb());
  let records = await getAllRecentFiles(db);
  if (await compactOversizedRecentFiles(db, records)) {
    records = await getAllRecentFiles(db);
  }
  state.recentFiles = records
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, RECENT_FILE_LIMIT)
    .map(({ content, ...metadata }) => ({
      ...metadata,
      objectType: recentRecordObjectType(metadata)
    }));
  renderRecentFiles();
}

async function compactOversizedRecentFiles(db, records) {
  const oversizedRecords = records.filter((record) => {
    return String(record.content || "").length > MAX_RECENT_FILE_CONTENT_BYTES;
  });
  if (!oversizedRecords.length) return false;

  const transaction = db.transaction(FILE_HISTORY_STORE, "readwrite");
  const store = transaction.objectStore(FILE_HISTORY_STORE);

  oversizedRecords.forEach((record) => {
    const endpoint = record.endpoint || recentEndpointForName(record.name, record.objectType);
    if (endpoint) {
      store.put({
        ...record,
        content: "",
        endpoint,
        size: record.size || String(record.content || "").length
      });
    } else {
      store.delete(record.id);
    }
  });

  await transactionDone(transaction);
  return true;
}

function recentEndpointForName(name, objectType = "") {
  const normalizedName = String(name || "");
  if (normalizedName === "salesforce-report-latest.json") {
    return String(objectType || "").toLowerCase() === "account"
      ? "/api/staging-accounts/latest.json"
      : "/api/staging-contacts/latest.json";
  }
  if (normalizedName === "salesforce-report-latest.csv") {
    return String(objectType || "").toLowerCase() === "account"
      ? "/api/staging-accounts/latest.csv"
      : "/api/staging-contacts/latest.csv";
  }

  return {
    "salesforce-staging-contacts-latest.csv": "/api/staging-contacts/latest.csv",
    "salesforce-staging-accounts-latest.csv": "/api/staging-accounts/latest.csv",
    "salesforce-staging-contacts-latest.json": "/api/staging-contacts/latest.json",
    "salesforce-staging-accounts-latest.json": "/api/staging-accounts/latest.json"
  }[normalizedName] || "";
}

function renderRecentFiles(message = "") {
  if (!els.recentFileList) return;
  if (message) {
    els.recentFileList.innerHTML = `<div class="recent-empty">${escapeHtml(message)}</div>`;
    return;
  }

  if (!state.recentFiles.length) {
    els.recentFileList.innerHTML = `<div class="recent-empty">No recent files</div>`;
    return;
  }

  els.recentFileList.innerHTML = state.recentFiles
    .map(
      (file) => {
        const displayName = file.displayName || file.name;
        return `
        <button class="recent-file" type="button" data-file-id="${escapeHtml(file.id)}">
          <span class="recent-file-name">${escapeHtml(displayName)}</span>
          <span class="recent-file-meta">${escapeHtml(OBJECT_CONFIG[file.objectType]?.label || file.objectType)} · ${escapeHtml(formatFileSize(file.size))}</span>
        </button>
      `;
      }
    )
    .join("");
}

function openFileHistoryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FILE_HISTORY_DB_NAME, FILE_HISTORY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_HISTORY_STORE)) {
        db.createObjectStore(FILE_HISTORY_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(REVIEW_STATE_STORE)) {
        db.createObjectStore(REVIEW_STATE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getRecentFile(fileId) {
  return openFileHistoryDb().then((db) => {
    const transaction = db.transaction(FILE_HISTORY_STORE, "readonly");
    return requestToPromise(transaction.objectStore(FILE_HISTORY_STORE).get(fileId));
  });
}

function getAllRecentFiles(db) {
  const transaction = db.transaction(FILE_HISTORY_STORE, "readonly");
  return requestToPromise(transaction.objectStore(FILE_HISTORY_STORE).getAll());
}

function putRecentFile(db, record) {
  const transaction = db.transaction(FILE_HISTORY_STORE, "readwrite");
  transaction.objectStore(FILE_HISTORY_STORE).put(record);
  return transactionDone(transaction);
}

async function trimRecentFiles(db) {
  const records = await getAllRecentFiles(db);
  const staleRecords = records
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(RECENT_FILE_LIMIT);
  if (!staleRecords.length) return;

  const transaction = db.transaction(FILE_HISTORY_STORE, "readwrite");
  const store = transaction.objectStore(FILE_HISTORY_STORE);
  staleRecords.forEach((record) => store.delete(record.id));
  await transactionDone(transaction);
}

function getReviewState(datasetKey, existingDb = null) {
  return (existingDb ? Promise.resolve(existingDb) : openFileHistoryDb()).then((db) => {
    const transaction = db.transaction(REVIEW_STATE_STORE, "readonly");
    return requestToPromise(transaction.objectStore(REVIEW_STATE_STORE).get(datasetKey));
  });
}

function getAllReviewStates(db) {
  const transaction = db.transaction(REVIEW_STATE_STORE, "readonly");
  return requestToPromise(transaction.objectStore(REVIEW_STATE_STORE).getAll());
}

function putReviewState(db, record) {
  const transaction = db.transaction(REVIEW_STATE_STORE, "readwrite");
  transaction.objectStore(REVIEW_STATE_STORE).put(record);
  return transactionDone(transaction);
}

async function trimReviewStates(db) {
  const records = await getAllReviewStates(db);
  const staleRecords = records
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(REVIEW_STATE_LIMIT);
  if (!staleRecords.length) return;

  const transaction = db.transaction(REVIEW_STATE_STORE, "readwrite");
  const store = transaction.objectStore(REVIEW_STATE_STORE);
  staleRecords.forEach((record) => store.delete(record.id));
  await transactionDone(transaction);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function recentFileId(objectType, name) {
  return `${normalizeObjectType(objectType)}:${name}`;
}

function recentRecordObjectType(record, fallback = "contact") {
  return normalizeObjectType(record?.objectType, objectTypeFromRecentFileId(record?.id) || fallback);
}

function objectTypeFromRecentFileId(fileId) {
  const [objectType] = String(fileId || "").split(":");
  return OBJECT_CONFIG[objectType] ? objectType : "";
}

function formatFileSize(size) {
  if (!size) return "size unknown";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeObjectType(objectType, fallback = "contact") {
  return OBJECT_CONFIG[objectType] ? objectType : fallback;
}

function buildDatasetKey() {
  if (!state.rows.length) return "";
  let hash = 2166136261;
  hash = updateHash(hash, state.objectType);
  hash = updateHash(hash, normalizeText(state.fileName));
  hash = updateHash(hash, normalizeText(state.datasetSource?.contractVersion || state.datasetMetadata?.contractVersion || ""));
  hash = updateHash(hash, state.rows.length);
  state.headers.forEach((header) => {
    hash = updateHash(hash, normalizeHeader(header));
  });
  Object.keys(OBJECT_CONFIG[state.objectType].fields).forEach((field) => {
    hash = updateHash(hash, field);
    hash = updateHash(hash, normalizeHeader(state.mapping[field]));
  });
  datasetKeySampleIndexes(state.rows.length).forEach((index) => {
    const row = state.rows[index];
    hash = updateHash(hash, index);
    hash = updateHash(hash, recordKey(row));
    OBJECT_CONFIG[state.objectType].displayFields.forEach((field) => {
      hash = updateHash(hash, getDisplayFieldRawValue(row, field));
    });
  });
  return `${state.objectType}:${state.rows.length}:${hash.toString(36)}`;
}

function datasetKeySampleIndexes(rowCount) {
  if (rowCount <= DATASET_KEY_SAMPLE_SIZE) {
    return Array.from({ length: rowCount }, (_, index) => index);
  }

  const indexes = new Set();
  const edgeCount = Math.min(100, Math.floor(DATASET_KEY_SAMPLE_SIZE / 4));
  for (let index = 0; index < edgeCount; index += 1) {
    indexes.add(index);
    indexes.add(rowCount - 1 - index);
  }

  const remaining = DATASET_KEY_SAMPLE_SIZE - indexes.size;
  const step = (rowCount - 1) / Math.max(1, remaining - 1);
  for (let index = 0; index < remaining; index += 1) {
    indexes.add(Math.round(index * step));
  }

  return [...indexes].sort((left, right) => left - right);
}

function getDisplayFieldRawValue(row, field) {
  if (state.objectType === "contact" && field === "fullName") {
    return getValue(row, state.mapping.fullName) || [getValue(row, state.mapping.firstName), getValue(row, state.mapping.lastName)].join(" ");
  }
  return getValue(row, state.mapping[field]);
}

function updateHash(hash, value) {
  const text = String(value ?? "");
  let nextHash = hash >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    nextHash ^= text.charCodeAt(index);
    nextHash = Math.imul(nextHash, 16777619) >>> 0;
  }
  nextHash ^= 124;
  return Math.imul(nextHash, 16777619) >>> 0;
}

function scheduleReviewStateSave() {
  if (!state.datasetKey || !isFileHistoryAvailable()) return;
  pendingReviewStateRecord = serializeCurrentReviewState();
  if (reviewStateSaveTimer) clearTimeout(reviewStateSaveTimer);
  reviewStateSaveTimer = setTimeout(() => {
    reviewStateSaveTimer = 0;
    const record = pendingReviewStateRecord;
    pendingReviewStateRecord = null;
    saveReviewStateRecord(record);
  }, REVIEW_STATE_SAVE_DELAY_MS);
}

async function saveCurrentReviewState() {
  if (!state.datasetKey || !isFileHistoryAvailable()) return;
  return saveReviewStateRecord(serializeCurrentReviewState());
}

function flushPendingReviewStateSave() {
  if (!reviewStateSaveTimer || !pendingReviewStateRecord) return;
  clearTimeout(reviewStateSaveTimer);
  reviewStateSaveTimer = 0;
  const record = pendingReviewStateRecord;
  pendingReviewStateRecord = null;
  saveReviewStateRecord(record);
}

async function saveReviewStateRecord(record) {
  if (!record?.id || !isFileHistoryAvailable()) return;
  const datasetKey = record.id;

  try {
    const db = await openFileHistoryDb();
    await putReviewState(db, record);
    await trimReviewStates(db);
    if (state.datasetKey === datasetKey) {
      state.reviewStateStatus = "Review state saved";
      renderSource();
    }
  } catch {
    if (state.datasetKey === datasetKey) {
      state.reviewStateStatus = "Review state could not be saved";
      renderSource();
    }
  }
}

function serializeCurrentReviewState() {
  return {
    id: state.datasetKey,
    version: 1,
    kind: "workspace",
    workspaceVersion: 1,
    objectType: state.objectType,
    fileName: state.fileName,
    rowCount: state.rows.length,
    headers: [...state.headers],
    sourceDataset: { ...state.datasetSource },
    trainingLabels: [...state.trainingLabels.entries()],
    decisions: [...state.decisions.entries()],
    mergeResults: [...state.mergeResults.entries()],
    mergeMasterSelections: [...mergeMasterSelections.entries()],
    fieldResolutions: [...state.fieldResolutions.entries()],
    separatedRecords: [...state.separatedRecords.entries()].map(([groupKey, recordKeys]) => [
      groupKey,
      [...recordKeys]
    ]),
    savedAt: new Date().toISOString(),
    updatedAt: Date.now()
  };
}

async function restoreReviewStateForCurrentDataset() {
  if (!state.datasetKey || !isFileHistoryAvailable()) return;
  const datasetKey = state.datasetKey;
  if (state.loadingModal.active) {
    await updateLoadingProgress("Restoring saved review state.", 99);
  }

  try {
    const { record, migrated } = await findReviewStateForCurrentDataset(datasetKey);
    if (state.datasetKey !== datasetKey) return;
    if (!record) {
      state.reviewStateStatus = "";
      renderSource();
      return;
    }

    const counts = applySavedReviewState(record);
    state.reviewStateStatus = restoredReviewStateStatus(counts);
    visibleGroupsCache = null;
    ensureSelectedGroupVisible();
    render();
    if (migrated) saveCurrentReviewState();
  } catch {
    if (state.datasetKey === datasetKey) {
      state.reviewStateStatus = "Saved review state could not be loaded";
      renderSource();
    }
  }
}

async function findReviewStateForCurrentDataset(datasetKey) {
  const db = await openFileHistoryDb();
  const exactRecord = await getReviewState(datasetKey, db);
  if (exactRecord) {
    return {
      record: exactRecord,
      migrated: false
    };
  }

  const compatibleRecord = findCompatibleReviewState(await getAllReviewStates(db), datasetKey);
  return {
    record: compatibleRecord,
    migrated: Boolean(compatibleRecord)
  };
}

function findCompatibleReviewState(records, currentDatasetKey) {
  return records
    .filter((record) => record.id !== currentDatasetKey && isCompatibleReviewState(record))
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))[0] || null;
}

function isCompatibleReviewState(record) {
  if (!record || record.objectType !== state.objectType) return false;
  if (Number(record.rowCount) !== state.rows.length) return false;
  if (normalizeText(record.fileName) !== normalizeText(state.fileName)) return false;
  return headerSignature(record.headers || []) === headerSignature(state.headers);
}

function headerSignature(headers) {
  return headers.map(normalizeHeader).join("|");
}

function applySavedReviewState(record) {
  return {
    labels: restoreTrainingLabels(record.trainingLabels),
    decisions: restoreDecisions(record.decisions),
    mergeResults: restoreMergeResults(record.mergeResults),
    mergeMasterSelections: restoreMergeMasterSelections(record.mergeMasterSelections),
    fieldResolutions: restoreFieldResolutions(record.fieldResolutions),
    separatedRecords: restoreSeparatedRecords(record.separatedRecords)
  };
}

function restoreTrainingLabels(entries = []) {
  if (!entries.length) return 0;
  const validRecordKeys = new Set(state.rows.map(recordKey));
  let count = 0;

  entries.forEach((entry) => {
    const storedLabel = Array.isArray(entry) ? entry[1] : entry;
    if (!storedLabel || !Object.prototype.hasOwnProperty.call(TRAINING_LABELS, storedLabel.label)) return;

    const leftKey = String(storedLabel.leftKey || "");
    const rightKey = String(storedLabel.rightKey || "");
    if (!leftKey || !rightKey || leftKey === rightKey) return;
    if (!validRecordKeys.has(leftKey) || !validRecordKeys.has(rightKey)) return;

    const key = trainingPairKeyFromRecordKeys(leftKey, rightKey);
    state.trainingLabels.set(key, {
      objectType: state.objectType,
      fileName: state.fileName,
      groupKey: String(storedLabel.groupKey || ""),
      groupScore: Number(storedLabel.groupScore) || 0,
      minPairScore: Number(storedLabel.minPairScore) || 0,
      leftKey,
      rightKey,
      label: storedLabel.label,
      confidence: TRAINING_CONFIDENCE_LEVELS.includes(storedLabel.confidence)
        ? storedLabel.confidence
        : state.trainingConfidence,
      score: Number(storedLabel.score) || 0,
      createdAt: storedLabel.createdAt || new Date().toISOString(),
      updatedAt: storedLabel.updatedAt || storedLabel.createdAt || new Date().toISOString()
    });
    count += 1;
  });

  return count;
}

function restoreDecisions(entries = []) {
  if (!entries.length) return 0;
  const validGroupKeys = new Set(state.groups.map((group) => group.key));
  let count = 0;

  entries.forEach((entry) => {
    if (!Array.isArray(entry)) return;
    const [groupKey, decision] = entry;
    if (!validGroupKeys.has(groupKey)) return;
    if (decision !== "duplicate" && decision !== "not-duplicate") return;
    state.decisions.set(groupKey, decision);
    count += 1;
  });

  return count;
}

function restoreMergeResults(entries = []) {
  if (!entries.length) return 0;
  const validGroupKeys = new Set(state.groups.map((group) => group.key));
  let count = 0;

  entries.forEach((entry) => {
    if (!Array.isArray(entry)) return;
    const [groupKey, result] = entry;
    if (!validGroupKeys.has(groupKey) || !result || typeof result !== "object") return;
    if (!["success", "failed"].includes(result.status)) return;
    state.mergeResults.set(groupKey, sanitizeMergeResult(result));
    count += 1;
  });

  return count;
}

function restoreMergeMasterSelections(entries = []) {
  if (!entries.length) return 0;
  const groupsByKey = new Map(state.groups.map((group) => [group.key, group]));
  let count = 0;

  entries.forEach((entry) => {
    if (!Array.isArray(entry)) return;
    const [groupKey, value] = entry;
    const group = groupsByKey.get(groupKey);
    const id = normalizeSalesforceIdForMerge(value);
    if (!group || !id) return;

    const validIds = new Set(group.records.map((record) => normalizeSalesforceIdForMerge(salesforceId(record))).filter(Boolean));
    if (!validIds.has(id)) return;

    mergeMasterSelections.set(groupKey, id);
    count += 1;
  });

  return count;
}

function sanitizeMergeResult(result) {
  return {
    status: result.status,
    message: String(result.message || ""),
    objectType: String(result.objectType || state.objectType),
    groupKey: String(result.groupKey || ""),
    masterId: String(result.masterId || ""),
    mergedRecordIds: Array.isArray(result.mergedRecordIds) ? result.mergedRecordIds.map(String) : [],
    updatedRelatedIds: Array.isArray(result.updatedRelatedIds) ? result.updatedRelatedIds.map(String) : [],
    orgAlias: String(result.orgAlias || ""),
    instanceUrl: String(result.instanceUrl || ""),
    apiVersion: String(result.apiVersion || ""),
    mergedAt: String(result.mergedAt || result.at || ""),
    preMergeCheck: sanitizePreMergeCheck(result.preMergeCheck),
    recoverySnapshot: result.recoverySnapshot && typeof result.recoverySnapshot === "object" ? result.recoverySnapshot : null,
    mergeReport: sanitizeMergeReport(result.mergeReport)
  };
}

function sanitizePreMergeCheck(check) {
  if (!check || typeof check !== "object") return null;
  return {
    status: String(check.status || ""),
    checkedAt: String(check.checkedAt || ""),
    missingIds: Array.isArray(check.missingIds) ? check.missingIds.map(String) : [],
    deletedIds: Array.isArray(check.deletedIds) ? check.deletedIds.map(String) : [],
    changedFields: Array.isArray(check.changedFields)
      ? check.changedFields.map((change) => ({
          id: String(change.id || ""),
          recordName: String(change.recordName || ""),
          field: String(change.field || ""),
          label: String(change.label || ""),
          loadedValue: String(change.loadedValue ?? ""),
          currentValue: String(change.currentValue ?? "")
        }))
      : []
  };
}

function sanitizeMergeReport(report) {
  if (!report || typeof report !== "object") return null;
  return {
    generatedAt: String(report.generatedAt || ""),
    fileName: String(report.fileName || ""),
    latestFileName: String(report.latestFileName || ""),
    csvPath: String(report.csvPath || ""),
    latestCsvPath: String(report.latestCsvPath || ""),
    manifestPath: String(report.manifestPath || ""),
    latestManifestPath: String(report.latestManifestPath || ""),
    rowCount: Number(report.rowCount || 0),
    rows: Array.isArray(report.rows)
      ? report.rows.map((row) => (Array.isArray(row) ? row.map((value) => String(value ?? "")) : []))
      : []
  };
}

function restoreFieldResolutions(entries = []) {
  if (!entries.length) return 0;
  const validGroupKeys = new Set(state.groups.map((group) => group.key));
  const validFields = new Set(OBJECT_CONFIG[state.objectType].displayFields);
  let count = 0;

  entries.forEach((entry) => {
    if (!Array.isArray(entry)) return;
    const [groupKey, values] = entry;
    if (!validGroupKeys.has(groupKey) || !values || typeof values !== "object") return;

    const restoredValues = {};
    Object.entries(values).forEach(([field, value]) => {
      if (validFields.has(field)) restoredValues[field] = String(value ?? "");
    });
    if (!Object.keys(restoredValues).length) return;

    state.fieldResolutions.set(groupKey, restoredValues);
    count += 1;
  });

  return count;
}

function restoreSeparatedRecords(entries = []) {
  if (!entries.length) return 0;
  const groupsByKey = new Map(state.groups.map((group) => [group.key, group]));
  let count = 0;

  entries.forEach((entry) => {
    if (!Array.isArray(entry)) return;
    const [groupKey, recordKeys] = entry;
    const group = groupsByKey.get(groupKey);
    if (!group || !Array.isArray(recordKeys)) return;

    const validRecordKeys = new Set(group.records.map(recordKey));
    const restoredKeys = new Set(recordKeys.filter((key) => validRecordKeys.has(key)));
    if (!restoredKeys.size) return;

    state.separatedRecords.set(groupKey, restoredKeys);
    count += restoredKeys.size;
  });

  return count;
}

function restoredReviewStateStatus(counts) {
  const parts = [];
  if (counts.labels) parts.push(`${formatNumber(counts.labels)} ${counts.labels === 1 ? "label" : "labels"}`);
  if (counts.decisions) {
    parts.push(`${formatNumber(counts.decisions)} ${counts.decisions === 1 ? "decision" : "decisions"}`);
  }
  if (counts.mergeResults) {
    parts.push(`${formatNumber(counts.mergeResults)} merge ${counts.mergeResults === 1 ? "result" : "results"}`);
  }
  if (counts.mergeMasterSelections) {
    parts.push(`${formatNumber(counts.mergeMasterSelections)} merge ${counts.mergeMasterSelections === 1 ? "master" : "masters"}`);
  }
  if (counts.fieldResolutions) {
    parts.push(`${formatNumber(counts.fieldResolutions)} field ${counts.fieldResolutions === 1 ? "choice" : "choices"}`);
  }
  if (counts.separatedRecords) {
    parts.push(`${formatNumber(counts.separatedRecords)} separated ${counts.separatedRecords === 1 ? "record" : "records"}`);
  }
  return parts.length ? `Restored ${parts.join(", ")}` : "";
}

async function ingestRows(rows, fileName, fromObjects, knownHeaders) {
  stageRowsForReview({
    rows,
    fileName,
    fromObjects,
    headers: knownHeaders,
    objectType: state.objectType
  });
  await recompute({ title: "Matching Records", message: "Preparing records for matching." });
  return fromObjects ? Promise.resolve() : restoreReviewStateForCurrentDataset();
}

async function applyProcessedDataset(result, { fromObjects = false } = {}) {
  state.lastProcessingMode = result.processingMode || "";
  state.lastMatchingStats = result.matchingStats || null;
  stageRowsForReview({
    rows: result.rows || [],
    fileName: result.fileName || datasetFileNameForFormat(result.format),
    fromObjects,
    headers: result.headers,
    mapping: result.mapping,
    objectType: result.objectType,
    metadata: extractDatasetMetadata(result)
  });
  await updateLoadingProgress("Rendering duplicate groups.", 98);
  applyComputedGroups(result.groups || [], result.matchingStats || null);
  scheduleMatchingArtifactsWarmCache();
  if (result.matchingArtifacts) cacheMatchingArtifacts(result.matchingArtifacts);
  await updateLoadingProgress("Ready.", 100);
  return fromObjects ? Promise.resolve() : restoreReviewStateForCurrentDataset();
}

function stageRowsForReview({ rows, fileName, fromObjects, headers, mapping, objectType, metadata = {} }) {
  flushPendingReviewStateSave();
  endFileLoad();
  state.objectType = normalizeObjectType(objectType, state.objectType);
  state.fileName = fileName;
  state.datasetMetadata = sanitizeDatasetMetadata(metadata);
  state.rows = Array.isArray(rows) ? rows : [];
  state.rows.forEach((row, index) => {
    row.__rowIndex = index;
  });
  state.headers = Array.isArray(headers) && headers.length ? headers : inferHeaders(state.rows);
  state.mapping = mapping || autoMapHeaders(state.headers, OBJECT_CONFIG[state.objectType].fields);
  pruneGroupFiltersForCurrentFields();
  state.datasetKey = fromObjects ? "" : buildDatasetKey();
  state.reviewStateStatus = state.datasetKey && isFileHistoryAvailable() ? "Checking saved review state..." : "";
  state.selectedGroupKey = "";
  state.trainingLabels.clear();
  state.trainingPairIndexes.clear();
  state.lastMatchingStats = null;
  matchingArtifactsCache = null;
  matchingArtifactsWarmCacheJob = null;
  mergeMasterSelections.clear();
  mergePreviewStates.clear();
  mergeInFlightGroupKeys.clear();
  resetMergeReviewSession();
  if (!fromObjects) {
    state.decisions.clear();
    state.mergeResults.clear();
    state.fieldResolutions.clear();
    state.separatedRecords.clear();
  }
}

async function recompute({ title = "Matching Records", message = "Preparing records for matching." } = {}) {
  const shouldOwnModal = !state.loadingModal.active;
  if (shouldOwnModal) {
    showLoadingModal(title, message, 0);
    await nextPaint();
  }

  try {
    const result = await processMatchingJob({
      mode: "recompute",
      rows: state.rows,
      objectType: state.objectType,
      headers: state.headers,
      mapping: state.mapping,
      threshold: state.threshold,
      highRecallMode: state.highRecallMode
    }, updateLoadingProgress);
    state.lastProcessingMode = result.processingMode || "";
    state.lastMatchingStats = result.matchingStats || null;
    await updateLoadingProgress("Rendering duplicate groups.", 98);
    applyComputedGroups(result.groups || [], result.matchingStats || null);
    scheduleMatchingArtifactsWarmCache();
    if (result.matchingArtifacts) cacheMatchingArtifacts(result.matchingArtifacts);
    await updateLoadingProgress("Ready.", 100);
  } catch (error) {
    if (!isAbortError(error)) throw error;
  } finally {
    if (shouldOwnModal) hideLoadingModal();
  }
}

function applyComputedGroups(groups, matchingStats = null) {
  state.groups = Array.isArray(groups) ? groups : [];
  state.lastMatchingStats = matchingStats || state.lastMatchingStats;
  groupLookupCache = null;
  groupListRenderCache = null;
  detailRenderCache = "";
  if (!state.groups.some((group) => group.key === state.selectedGroupKey)) {
    state.selectedGroupKey = state.groups[0]?.key || "";
  }
  pruneFieldResolutions();
  pruneSeparatedRecords();
  visibleGroupsCache = null;
  ensureSelectedGroupVisible();
  render();
}

function cacheMatchingArtifacts(artifacts, groups = []) {
  if (!artifacts || !Array.isArray(artifacts.preparedRows) || !Array.isArray(artifacts.pairScores)) {
    matchingArtifactsCache = null;
    return;
  }

  matchingArtifactsCache = {
    rows: state.rows,
    objectType: normalizeObjectType(artifacts.objectType || state.objectType, state.objectType),
    mappingSignature: mappingSignature(artifacts.mapping || state.mapping),
    highRecallMode: Boolean(artifacts.highRecallMode),
    thresholdFloor: Number(artifacts.thresholdFloor) || MATCHING_CACHE_MIN_THRESHOLD,
    preparedRows: artifacts.preparedRows,
    fieldStats: artifacts.fieldStats || null,
    pairScores: artifacts.pairScores,
    matchingStats: artifacts.matchingStats || null,
    groups: Array.isArray(groups) ? groups : []
  };
  scheduleMatchingArtifactsWarmCache();
}

function scheduleMatchingArtifactsWarmCache() {
  if (!canUseMatchingWorker()) return;
  if (matchingArtifactsCache && matchingArtifactsCache.thresholdFloor <= MATCHING_CACHE_MIN_THRESHOLD) return;
  if (state.threshold <= MATCHING_CACHE_MIN_THRESHOLD) return;
  if (matchingArtifactsWarmCacheJob) return;

  const rows = state.rows;
  const objectType = state.objectType;
  const mapping = state.mapping;
  const headers = state.headers;
  const highRecallMode = state.highRecallMode;
  const mappingKey = mappingSignature(mapping);

  const warmCacheJob = processMatchingJob({
    mode: "recompute",
    rows,
    objectType,
    headers,
    mapping,
    threshold: state.threshold,
    highRecallMode,
    artifactThreshold: MATCHING_CACHE_MIN_THRESHOLD,
    includeMatchingArtifacts: true
  }, async () => {})
    .then((result) => {
      if (
        state.rows === rows &&
        state.objectType === objectType &&
        state.highRecallMode === highRecallMode &&
        mappingSignature(state.mapping) === mappingKey
      ) {
        if (result.matchingArtifacts) cacheMatchingArtifacts(result.matchingArtifacts, result.groups || []);
      }
    })
    .catch((error) => {
      if (!isAbortError(error)) {
        console.warn("Background matching cache warmup failed", error);
      }
    })
    .finally(() => {
      if (matchingArtifactsWarmCacheJob === warmCacheJob) {
        matchingArtifactsWarmCacheJob = null;
      }
    });
  matchingArtifactsWarmCacheJob = warmCacheJob;
}

async function rebuildMatchesFromCachedArtifacts({ title = "Matching Records", message = "Rebuilding cached matches." } = {}) {
  if (!matchingArtifactsCache) {
    return recompute({ title, message });
  }

  const shouldOwnModal = !state.loadingModal.active;
  if (shouldOwnModal) {
    showLoadingModal(title, message, 0);
    await nextPaint();
  }

  try {
    const result = await rebuildGroupsFromMatchingArtifacts(matchingArtifactsCache, state.threshold, updateLoadingProgress);
    state.lastProcessingMode = result.processingMode || "";
    state.lastMatchingStats = result.matchingStats || null;
    await updateLoadingProgress("Rendering duplicate groups.", 98);
    applyComputedGroups(result.groups || [], result.matchingStats || null);
    await updateLoadingProgress("Ready.", 100);
  } catch (error) {
    if (!isAbortError(error)) throw error;
  } finally {
    if (shouldOwnModal) hideLoadingModal();
  }
}

function processMatchingJob(payload, progress = async () => {}) {
  if (canUseMatchingWorker()) {
    return processMatchingJobInWorker(payload, progress);
  }
  return processMatchingJobOnMain(payload, progress);
}

function canUseMatchingWorker() {
  return !IS_MATCHING_WORKER &&
    typeof Worker !== "undefined" &&
    isServerBackedApp() &&
    typeof globalThis.ManagedWorkerClient?.createJobRunner === "function";
}

function processMatchingJobInWorker(payload, progress = async () => {}) {
  if (!matchingWorkerRunner) {
    matchingWorkerRunner = globalThis.ManagedWorkerClient.createJobRunner({
      workerUrl: "matching-worker.js",
      resultMode: "worker",
      canUseWorker: canUseMatchingWorker,
      fallback: processMatchingJobOnMain,
      onFallback(error) {
        if (!isAbortError(error)) {
          console.warn("Matching worker failed; falling back to main thread.", error);
        }
      }
    });
  }

  return matchingWorkerRunner.run(payload, { progress });
}

async function processMatchingJobOnMain(payload, progress = async () => {}) {
  if (payload.mode === "process-text") {
    const format = payload.format || datasetFormatFromFileName(payload.fileName);
    await progress(format === "json" ? "Parsing JSON dataset." : "Parsing CSV.", 4);
    const dataset = parseDatasetText(payload.text || "", {
      format,
      fileName: payload.fileName,
      objectType: payload.objectType
    });
    const rows = dataset.rows || [];
    rows.forEach((row, index) => {
      row.__rowIndex = index;
    });
    const headers = dataset.headers?.length ? dataset.headers : inferHeaders(rows);
    const mapping = dataset.mapping || autoMapHeaders(headers, OBJECT_CONFIG[dataset.objectType].fields);
    stageMatchingContext(rows, dataset.objectType, headers, mapping);
    await progress("Matching records.", 7);
    const { groups, matchingStats, matchingArtifacts } = await buildGroupsAsync(
      rows,
      dataset.objectType,
      mapping,
      payload.threshold,
      payload.highRecallMode,
      progress,
      Number.isFinite(Number(payload.artifactThreshold)) ? Number(payload.artifactThreshold) : payload.threshold,
      Boolean(payload.includeMatchingArtifacts)
    );
    return {
      ...dataset,
      rows,
      headers,
      mapping,
      groups,
      matchingStats,
      matchingArtifacts,
      processingMode: "main"
    };
  }

  if (payload.mode === "recompute") {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    rows.forEach((row, index) => {
      row.__rowIndex = index;
    });
    const objectType = normalizeObjectType(payload.objectType, state.objectType);
    const mapping = payload.mapping || {};
    stageMatchingContext(rows, objectType, payload.headers || inferHeaders(rows), mapping);
    const { groups, matchingStats, matchingArtifacts } = await buildGroupsAsync(
      rows,
      objectType,
      mapping,
      payload.threshold,
      payload.highRecallMode,
      progress,
      Number.isFinite(Number(payload.artifactThreshold)) ? Number(payload.artifactThreshold) : payload.threshold,
      Boolean(payload.includeMatchingArtifacts)
    );
    return { groups, matchingStats, matchingArtifacts, processingMode: "main" };
  }

  throw new Error(`Unsupported matching job: ${payload.mode || "unknown"}`);
}

function stageMatchingContext(rows, objectType, headers, mapping) {
  state.objectType = normalizeObjectType(objectType, state.objectType);
  state.rows = rows;
  state.headers = headers || [];
  state.mapping = mapping || {};
}

function createAbortError(message) {
  try {
    return new DOMException(message, "AbortError");
  } catch {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
  }
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

async function applyMatchControls() {
  if (!state.rows.length) return;
  syncThresholdInputs();
  const nextThreshold = Number(els.threshold.value);
  const nextMaxThreshold = Number(els.maxThreshold.value);
  const nextHighRecallMode = !els.highRecallMode.checked;
  const thresholdChanged = nextThreshold !== state.threshold;
  const highRecallChanged = nextHighRecallMode !== state.highRecallMode;
  const canReuseMatchingArtifacts =
    Boolean(matchingArtifactsCache) &&
    matchingArtifactsCache.rows === state.rows &&
    matchingArtifactsCache.objectType === state.objectType &&
    matchingArtifactsCache.mappingSignature === mappingSignature(state.mapping) &&
    matchingArtifactsCache.highRecallMode === nextHighRecallMode &&
    nextThreshold >= matchingArtifactsCache.thresholdFloor;

  state.threshold = nextThreshold;
  state.maxThreshold = nextMaxThreshold;
  state.highRecallMode = nextHighRecallMode;
  if (thresholdChanged || highRecallChanged) {
    if (thresholdChanged && !highRecallChanged && canReuseMatchingArtifacts) {
      await rebuildMatchesFromCachedArtifacts({ title: "Updating Matches", message: "Reusing prepared records and cached pair scores." });
      return;
    }
    await recompute({ title: "Updating Matches", message: "Rebuilding candidate matches." });
  } else {
    visibleGroupsCache = null;
    ensureSelectedGroupVisible();
    renderGroups();
    renderDetail();
  }
}

function toggleGroupSortDirection() {
  state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  visibleGroupsCache = null;
  selectFirstVisibleGroup();
  renderGroups();
  renderDetail();
}

function ensureSelectedGroupVisible() {
  const groups = filteredGroups();
  if (groups.some((group) => group.key === state.selectedGroupKey)) return;
  state.selectedGroupKey = groups[0]?.key || "";
}

function selectFirstVisibleGroup() {
  state.selectedGroupKey = filteredGroups()[0]?.key || "";
}

function syncThresholdInputs(changed = "") {
  const bounds = thresholdBounds();
  let minScore = changed === "min-number"
    ? readThresholdNumber(els.thresholdMinNumber, els.threshold.value)
    : readThresholdNumber(els.threshold, state.threshold);
  let maxScore = changed === "max-number"
    ? readThresholdNumber(els.thresholdMaxNumber, els.maxThreshold.value)
    : readThresholdNumber(els.maxThreshold, state.maxThreshold);

  minScore = clampThresholdScore(minScore, bounds);
  maxScore = clampThresholdScore(maxScore, bounds);

  if (changed === "min" && minScore > maxScore) {
    minScore = maxScore;
  } else if (changed === "min-number" && minScore > maxScore) {
    minScore = maxScore;
  } else if (changed === "max" && maxScore < minScore) {
    maxScore = minScore;
  } else if (changed === "max-number" && maxScore < minScore) {
    maxScore = minScore;
  } else if (minScore > maxScore) {
    minScore = maxScore;
  }

  els.threshold.value = String(minScore);
  els.maxThreshold.value = String(maxScore);
  els.thresholdMinNumber.value = String(minScore);
  els.thresholdMaxNumber.value = String(maxScore);
  syncThresholdSliderFill(minScore, maxScore, bounds);
  els.thresholdValue.textContent = thresholdRangeLabel(minScore, maxScore);
}

function thresholdRangeLabel(minScore = state.threshold, maxScore = state.maxThreshold) {
  return Number(minScore) === Number(maxScore) ? String(minScore) : `${minScore}-${maxScore}`;
}

function thresholdBounds() {
  return {
    min: Number(els.threshold.min) || 0,
    max: Number(els.threshold.max) || 100
  };
}

function readThresholdNumber(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) ? Math.round(value) : Number(fallback);
}

function syncThresholdNumberInput(changed) {
  const input = changed === "min-number" ? els.thresholdMinNumber : els.thresholdMaxNumber;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  const bounds = thresholdBounds();
  if (value < bounds.min) return;
  syncThresholdInputs(changed);
}

function clampThresholdScore(value, { min, max }) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function syncThresholdSliderFill(minScore, maxScore, { min, max } = thresholdBounds()) {
  const range = max - min || 1;
  const minPercent = ((minScore - min) / range) * 100;
  const maxPercent = ((maxScore - min) / range) * 100;
  els.thresholdSlider?.style.setProperty("--threshold-min-pct", `${minPercent}%`);
  els.thresholdSlider?.style.setProperty("--threshold-max-pct", `${maxPercent}%`);
}

function parseDatasetText(text, { format = "csv", fileName = "", objectType = state.objectType } = {}) {
  if (format === "json") {
    return normalizeReviewDatasetPayload(JSON.parse(String(text || "")), { fileName, objectType });
  }

  const parsed = parseCsv(text);
  return {
    format: "csv",
    fileName: fileName || "CSV import",
    objectType: normalizeObjectType(objectType, state.objectType),
    headers: parsed.headers,
    rows: parsed.rows
  };
}

function normalizeReviewDatasetPayload(payload, { fileName = "", objectType = state.objectType } = {}) {
  if (!payload || typeof payload !== "object") {
    throw new Error("JSON dataset must be an object.");
  }

  const normalizedObjectType = normalizeObjectType(
    payload.objectType || payload.source?.objectType || objectType,
    normalizeObjectType(objectType, state.objectType)
  );
  const normalizedFileName = String(payload.fileName || payload.source?.name || fileName || "JSON import");

  if (Array.isArray(payload.records)) {
    const rows = payload.records.map(normalizeJsonRecord);
    const metadata = sanitizeDatasetMetadata({
      schema: String(payload.schema || ""),
      schemaVersion: Number(payload.schemaVersion) || 0,
      contractVersion: String(payload.contractVersion || payload.source?.contractVersion || ""),
      rollbackInventory: Array.isArray(payload.rollbackInventory) ? payload.rollbackInventory : [],
      source: payload.source && typeof payload.source === "object" && !Array.isArray(payload.source) ? { ...payload.source } : {},
      fields: Array.isArray(payload.fields) ? payload.fields.map((field) => ({ ...field })) : []
    });
    return {
      format: "json",
      fileName: normalizedFileName,
      objectType: normalizedObjectType,
      headers: datasetHeadersFromJsonPayload(payload, rows),
      rows,
      ...metadata
    };
  }

  if (Array.isArray(payload.columns) && Array.isArray(payload.rows)) {
    const headers = payload.columns.map((header) => String(header || ""));
    return {
      format: "json",
      fileName: normalizedFileName,
      objectType: normalizedObjectType,
      headers,
      rows: payload.rows.map((row) => rowArrayToObject(headers, row)),
      ...sanitizeDatasetMetadata({
        schema: String(payload.schema || ""),
        schemaVersion: Number(payload.schemaVersion) || 0,
        contractVersion: String(payload.contractVersion || payload.source?.contractVersion || ""),
        rollbackInventory: Array.isArray(payload.rollbackInventory) ? payload.rollbackInventory : [],
        source: payload.source && typeof payload.source === "object" && !Array.isArray(payload.source) ? { ...payload.source } : {},
        fields: Array.isArray(payload.fields) ? payload.fields.map((field) => ({ ...field })) : []
      })
    };
  }

  const records = Array.isArray(payload.result?.records)
    ? payload.result.records
    : null;
  if (records) {
    const rows = records.map(normalizeJsonRecord);
    return {
      format: "json",
      fileName: normalizedFileName,
      objectType: normalizedObjectType,
      headers: datasetHeadersFromJsonPayload(payload, rows),
      rows,
      ...sanitizeDatasetMetadata({
        schema: String(payload.schema || ""),
        schemaVersion: Number(payload.schemaVersion) || 0,
        contractVersion: String(payload.contractVersion || payload.source?.contractVersion || ""),
        rollbackInventory: Array.isArray(payload.rollbackInventory) ? payload.rollbackInventory : [],
        source: payload.source && typeof payload.source === "object" && !Array.isArray(payload.source) ? { ...payload.source } : {},
        fields: Array.isArray(payload.fields) ? payload.fields.map((field) => ({ ...field })) : []
      })
    };
  }

  throw new Error("JSON dataset must include either records or columns and rows.");
}

function rowArrayToObject(headers, row) {
  const values = Array.isArray(row) ? row : [];
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}

function normalizeJsonRecord(record) {
  if (!record || typeof record !== "object") return {};
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => key !== "attributes")
      .map(([key, value]) => [key, normalizeJsonCell(value)])
  );
}

function normalizeJsonCell(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function datasetHeadersFromJsonPayload(payload, rows) {
  const fieldHeaders = Array.isArray(payload.fields)
    ? payload.fields
        .map((field) => String(field?.apiName || field?.name || field?.label || ""))
        .filter(Boolean)
    : [];
  const inferredHeaders = inferHeaders(rows);
  return [...new Set([...fieldHeaders, ...inferredHeaders])];
}

function extractDatasetMetadata(result = {}) {
  return sanitizeDatasetMetadata({
    schema: String(result.schema || ""),
    schemaVersion: Number(result.schemaVersion) || 0,
    contractVersion: String(result.contractVersion || result.source?.contractVersion || ""),
    rollbackInventory: Array.isArray(result.rollbackInventory) ? result.rollbackInventory : [],
    source: result.source && typeof result.source === "object" && !Array.isArray(result.source) ? { ...result.source } : {},
    fields: Array.isArray(result.fields) ? result.fields.map((field) => ({ ...field })) : []
  });
}

function sanitizeDatasetMetadata(metadata = {}) {
  const source = metadata.source && typeof metadata.source === "object" && !Array.isArray(metadata.source)
    ? {
        system: String(metadata.source.system || ""),
        name: String(metadata.source.name || ""),
        format: String(metadata.source.format || ""),
        query: String(metadata.source.query || ""),
        operation: String(metadata.source.operation || ""),
        totalSize: Number(metadata.source.totalSize) || 0,
        contractVersion: String(metadata.source.contractVersion || "")
      }
    : {};

  return {
    schema: String(metadata.schema || ""),
    schemaVersion: Number(metadata.schemaVersion) || 0,
    contractVersion: String(metadata.contractVersion || ""),
    rollbackInventory: Array.isArray(metadata.rollbackInventory) ? metadata.rollbackInventory : [],
    source,
    fields: Array.isArray(metadata.fields) ? metadata.fields.map((field) => ({ ...field })) : []
  };
}

function parseCsv(csvText) {
  const rows = [];
  let record = [];
  let cell = "";
  let headers = null;
  let insideQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (char === '"' && insideQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      record.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      headers = pushCsvRecord(rows, headers, record, cell);
      record = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length || record.length) {
    headers = pushCsvRecord(rows, headers, record, cell);
  }

  return { headers: headers || [], rows };
}

function pushCsvRecord(rows, headers, record, cell) {
  record.push(cell);
  if (!record.some((value) => value.trim().length > 0)) return headers;

  if (!headers) {
    return record.map((header) => header.replace(/^\uFEFF/, "").trim());
  }

  const row = {};
  headers.forEach((header, index) => {
    row[header] = record[index] ?? "";
  });
  rows.push(row);
  return headers;
}

function inferHeaders(rows) {
  const headerSet = new Set();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!key.startsWith("__")) headerSet.add(key);
    });
  });
  return [...headerSet];
}

function autoMapHeaders(headers, fields) {
  const normalizedHeaders = headers.map((header) => ({
    original: header,
    normalized: normalizeHeader(header)
  }));
  const assignedHeaders = new Set();
  const mapping = {};

  Object.entries(fields).forEach(([field, aliases]) => {
    const normalizedAliases = aliases.map(normalizeHeader).filter(Boolean);
    const match =
      findDirectHeaderMatch(normalizedHeaders, normalizedAliases, assignedHeaders) ||
      findContainsHeaderMatch(normalizedHeaders, normalizedAliases, assignedHeaders);

    if (match) assignedHeaders.add(match.original);
    mapping[field] = match?.original || "";
  });

  return mapping;
}

function findDirectHeaderMatch(headers, aliases, assignedHeaders) {
  for (const alias of aliases) {
    const match = headers.find((header) => !assignedHeaders.has(header.original) && header.normalized === alias);
    if (match) return match;
  }
  return null;
}

function findContainsHeaderMatch(headers, aliases, assignedHeaders) {
  for (const alias of aliases) {
    const match = headers.find((header) => {
      if (assignedHeaders.has(header.original)) return false;
      return isHeaderContainsMatch(header.normalized, alias);
    });
    if (match) return match;
  }
  return null;
}

function isHeaderContainsMatch(header, alias) {
  if (alias.length < 5 || header.length < 5 || EXACT_HEADER_ONLY_ALIASES.has(alias)) return false;
  return header.includes(alias);
}

function readMappingFromControls() {
  const mapping = {};
  els.mappingGrid.querySelectorAll("select").forEach((select) => {
    mapping[select.dataset.field] = select.value;
  });
  return mapping;
}

/**
 * Build duplicate review groups from original dataset rows.
 *
 * The expensive normalization work happens once in prepareRowsAsync(). Candidate
 * buckets then decide which row pairs are worth scoring, which keeps large CSVs
 * away from all-pairs comparison in normal cases.
 */
async function buildGroupsAsync(
  rows,
  objectType,
  mapping,
  threshold,
  highRecallMode = false,
  progress = async () => {},
  artifactThreshold = threshold,
  includeMatchingArtifacts = false
) {
  const startedAt = performance.now();
  if (!rows.length) {
    await progress("No records to match.", 100);
    return {
      groups: [],
      matchingStats: {
        objectType,
        rowCount: 0,
        threshold,
        highRecallMode,
        elapsedMs: 0,
        candidatePairs: 0,
        candidateAttempts: 0,
        scoredPairs: 0,
        retainedPairs: 0,
        resultGroups: 0
      }
    };
  }

  await progress("Preparing records.", 8);
  const { preparedRows, fieldStats, scorer } = await getScoringContextAsync(rows, objectType, mapping, progress);

  await progress("Finding candidate pairs.", 22);
  const pairKeys = objectType === "contact"
    ? await getContactCandidatePairsAsync(preparedRows, highRecallMode, candidatePairLimit(highRecallMode), artifactThreshold, progress)
    : await getAccountCandidatePairsAsync(preparedRows, highRecallMode, candidatePairLimit(highRecallMode), artifactThreshold, progress);

  await progress(`Scoring ${formatNumber(pairKeys.size)} candidate pairs.`, 44);
  const pairs = await scoreCandidatePairsAsync(pairKeys, preparedRows, scorer, artifactThreshold, progress);
  const currentPairs = pairs.filter((pair) => pair.value >= threshold);

  await progress("Building match groups.", 82);
  const mirrorConflicts = objectType === "contact" ? buildContactMirrorConflictMap(preparedRows) : null;
  const groupsByRoot = collectPairGroups(currentPairs, rows.length, mirrorConflicts);
  await yieldToBrowser();

  const groups = [...groupsByRoot.values()]
    .map((group) => summarizeGroup(group, preparedRows, scorer))
    .filter((group) => group.score >= threshold)
    .sort(compareGroups)
    .map((group, index) => ({ ...group, id: index + 1 }));

  await progress("Rendering duplicate groups.", 96);
  return {
    groups,
    matchingStats: {
      objectType,
      rowCount: rows.length,
      threshold,
      cacheThreshold: artifactThreshold,
      highRecallMode,
      elapsedMs: Math.round(performance.now() - startedAt),
      candidatePairs: pairKeys.size,
      candidateAttempts: pairKeys.searchStats?.attempts || 0,
      candidateAttemptCapHit: Boolean(pairKeys.searchStats?.attemptCapHit),
      bucketCount: pairKeys.bucketStats?.bucketCount || 0,
      maxBucketSize: pairKeys.bucketStats?.maxBucketSize || 0,
      oversizedBucketCount: pairKeys.bucketStats?.oversizedBucketCount || 0,
      scoredPairs: pairs.scoreStats?.scoredPairs || pairKeys.size,
      retainedPairs: currentPairs.length,
      resultGroups: groups.length
    },
    ...(includeMatchingArtifacts
      ? {
          matchingArtifacts: {
            objectType,
            mapping,
            highRecallMode,
            thresholdFloor: artifactThreshold,
            preparedRows,
            fieldStats,
            pairScores: pairs.map(serializePairScore),
            matchingStats: {
              objectType,
              rowCount: rows.length,
              threshold,
              cacheThreshold: artifactThreshold,
              highRecallMode,
              elapsedMs: Math.round(performance.now() - startedAt),
              candidatePairs: pairKeys.size,
              candidateAttempts: pairKeys.searchStats?.attempts || 0,
              candidateAttemptCapHit: Boolean(pairKeys.searchStats?.attemptCapHit),
              bucketCount: pairKeys.bucketStats?.bucketCount || 0,
              maxBucketSize: pairKeys.bucketStats?.maxBucketSize || 0,
              oversizedBucketCount: pairKeys.bucketStats?.oversizedBucketCount || 0,
              scoredPairs: pairs.scoreStats?.scoredPairs || pairKeys.size,
              retainedPairs: currentPairs.length,
              resultGroups: groups.length
            }
          }
        }
      : {})
  };
}

function getScoringContext(rows, objectType, mapping) {
  if (
    scoringContextCache &&
    scoringContextCache.rows === rows &&
    scoringContextCache.objectType === objectType &&
    scoringContextCache.mapping === mapping
  ) {
    return scoringContextCache;
  }

  const preparedRows = prepareRows(rows, objectType, mapping);
  const fieldStats = buildFieldStats(preparedRows, objectType);
  const mirrorConflicts = objectType === "contact" ? buildContactMirrorConflictMap(preparedRows) : null;
  const scorer = createPairScorer(objectType, fieldStats);
  scoringContextCache = {
    rows,
    objectType,
    mapping,
    preparedRows,
    fieldStats,
    mirrorConflicts,
    scorer
  };
  return scoringContextCache;
}

async function getScoringContextAsync(rows, objectType, mapping, progress = async () => {}) {
  if (
    scoringContextCache &&
    scoringContextCache.rows === rows &&
    scoringContextCache.objectType === objectType &&
    scoringContextCache.mapping === mapping
  ) {
    return scoringContextCache;
  }

  const preparedRows = await prepareRowsAsync(rows, objectType, mapping, progress);
  const fieldStats = await buildFieldStatsAsync(preparedRows, objectType, progress);
  const mirrorConflicts = objectType === "contact" ? buildContactMirrorConflictMap(preparedRows) : null;
  const scorer = createPairScorer(objectType, fieldStats);
  scoringContextCache = {
    rows,
    objectType,
    mapping,
    preparedRows,
    fieldStats,
    mirrorConflicts,
    scorer
  };
  return scoringContextCache;
}

function createPairScorer(objectType, fieldStats = null) {
  if (objectType === "contact") {
    const cache = createContactScoreCache();
    return (left, right) => scoreContactPair(left, right, cache);
  }
  return (left, right) => scoreAccountPair(left, right, fieldStats);
}

function createContactScoreCache() {
  return {
    nameSequences: new Map(),
    companies: new Map(),
    companyGeographyConflicts: new Map(),
    emailOrgCorroborations: new Map()
  };
}

function serializePairScore(pair) {
  return {
    key: pair.key || symmetricPairKey(recordKey(pair.left), recordKey(pair.right)),
    leftIndex: pair.left.__rowIndex,
    rightIndex: pair.right.__rowIndex,
    value: pair.value,
    fieldMatchRatio: pair.fieldMatchRatio || 0,
    type: pair.type || "",
    reasons: Array.isArray(pair.reasons) ? [...pair.reasons] : [],
    fieldScores: pair.fieldScores ? { ...pair.fieldScores } : {}
  };
}

function inflatePairScore(pairScore, preparedRows) {
  const left = preparedRows[pairScore.leftIndex];
  const right = preparedRows[pairScore.rightIndex];
  if (!left || !right) return null;
  return {
    key: pairScore.key,
    left,
    right,
    value: pairScore.value,
    fieldMatchRatio: pairScore.fieldMatchRatio || 0,
    type: pairScore.type || "",
    reasons: Array.isArray(pairScore.reasons) ? [...pairScore.reasons] : [],
    fieldScores: pairScore.fieldScores ? { ...pairScore.fieldScores } : {}
  };
}

async function scoreCandidatePairsAsync(pairKeys, preparedRows, scorer, threshold, progress = async () => {}) {
  const keys = [...pairKeys];
  const pairs = [];
  const total = Math.max(keys.length, 1);
  let lastYield = performance.now();

  for (let index = 0; index < keys.length; index += 1) {
    const [leftIndex, rightIndex] = keys[index].split("|").map(Number);
    const score = scorePreparedPair(preparedRows[leftIndex], preparedRows[rightIndex], scorer);
    if (score.value >= threshold) pairs.push(score);

    const shouldYield = (index + 1) % SCORING_CHUNK_SIZE === 0 || performance.now() - lastYield >= MATCHING_YIELD_INTERVAL_MS;
    if (shouldYield) {
      const percent = 44 + ((index + 1) / total) * 34;
      await progress(`Scoring candidate pairs (${formatNumber(index + 1)} of ${formatNumber(keys.length)}).`, percent);
      lastYield = performance.now();
    }
  }

  await progress("Sorting scored pairs.", 78);
  pairs.sort((a, b) => b.value - a.value || b.fieldMatchRatio - a.fieldMatchRatio);
  pairs.scoreStats = {
    scoredPairs: keys.length,
    retainedPairs: pairs.length
  };
  return pairs;
}

function isMatchingArtifactsCacheValid(cache, rows, objectType, mapping, highRecallMode) {
  return Boolean(cache)
    && cache.rows === rows
    && cache.objectType === objectType
    && cache.mappingSignature === mappingSignature(mapping)
    && cache.highRecallMode === highRecallMode;
}

function mappingSignature(mapping) {
  return JSON.stringify(
    Object.entries(mapping || {})
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
  );
}

async function rebuildGroupsFromMatchingArtifacts(cache, threshold, progress = async () => {}) {
  if (!isMatchingArtifactsCacheValid(cache, state.rows, state.objectType, state.mapping, state.highRecallMode)) {
    return buildGroupsAsync(state.rows, state.objectType, state.mapping, threshold, state.highRecallMode, progress);
  }

  const startedAt = performance.now();
  await progress("Reusing prepared records.", 8);

  const preparedRows = cache.preparedRows;
  const scorer = createPairScorer(cache.objectType || state.objectType, cache.fieldStats);

  await progress("Reusing cached pair scores.", 44);
  const pairs = cache.pairScores
    .map((pairScore) => inflatePairScore(pairScore, preparedRows))
    .filter(Boolean);
  const currentPairs = pairs.filter((pair) => pair.value >= threshold);

  await progress("Building match groups.", 82);
  const mirrorConflicts = cache.objectType === "contact" ? buildContactMirrorConflictMap(preparedRows) : null;
  const groupsByRoot = collectPairGroups(currentPairs, state.rows.length, mirrorConflicts);
  await yieldToBrowser();

  const groups = [...groupsByRoot.values()]
    .map((group) => summarizeGroup(group, preparedRows, scorer))
    .filter((group) => group.score >= threshold)
    .sort(compareGroups)
    .map((group, index) => ({ ...group, id: index + 1 }));

  const visibleGroups = groups.length || !Array.isArray(cache.groups) || !cache.groups.length
    ? groups
    : cache.groups
        .filter((group) => group.score >= threshold && group.score <= state.maxThreshold)
        .map((group, index) => ({ ...group, id: index + 1 }));

  await progress("Rendering duplicate groups.", 96);
  return {
    groups: visibleGroups,
    matchingStats: {
      ...(cache.matchingStats || {}),
      objectType: state.objectType,
      rowCount: state.rows.length,
      threshold,
      cacheThreshold: cache.thresholdFloor || MATCHING_CACHE_MIN_THRESHOLD,
      highRecallMode: state.highRecallMode,
      elapsedMs: Math.round(performance.now() - startedAt),
      retainedPairs: currentPairs.length,
      resultGroups: visibleGroups.length
    },
    processingMode: "cache"
  };
}

function collectPairGroups(pairs, rowCount, conflictMap = null) {
  const uf = new UnionFind(rowCount);
  const membersByRoot = new Map(Array.from({ length: rowCount }, (_, index) => [index, new Set([index])]));

  pairs.forEach((pair) => {
    const leftIndex = pair.left.__rowIndex;
    const rightIndex = pair.right.__rowIndex;
    const leftRoot = uf.find(leftIndex);
    const rightRoot = uf.find(rightIndex);
    if (leftRoot === rightRoot) return;
    if (conflictMap && rootsHaveConflict(leftRoot, rightRoot, membersByRoot, conflictMap)) return;
    uf.union(leftRoot, rightRoot);
    const mergedRoot = uf.find(leftRoot);
    const retainedRoot = mergedRoot === leftRoot ? rightRoot : leftRoot;
    mergeRootMembers(membersByRoot, mergedRoot, retainedRoot);
  });

  const groupsByRoot = new Map();
  pairs.forEach((pair) => {
    const root = uf.find(pair.left.__rowIndex);
    if (!groupsByRoot.has(root)) {
      groupsByRoot.set(root, {
        records: new Map(),
        pairs: []
      });
    }
    const group = groupsByRoot.get(root);
    group.records.set(pair.left.__rowIndex, pair.left);
    group.records.set(pair.right.__rowIndex, pair.right);
    group.pairs.push(pair);
  });

  return groupsByRoot;
}

function buildContactMirrorConflictMap(preparedRows) {
  const rowsByReferenceKey = new Map();
  const conflictsByIndex = new Map();

  preparedRows.forEach((row, index) => {
    addIndexToKeyMap(rowsByReferenceKey, row.recordIdKey, index);
    addIndexToKeyMap(rowsByReferenceKey, row.recordNameKey, index);
  });

  preparedRows.forEach((row, index) => {
    const referenceKey = row.mirrorOfKey;
    if (!referenceKey) return;
    const targetIndexes = rowsByReferenceKey.get(referenceKey);
    if (!targetIndexes?.size) return;
    targetIndexes.forEach((targetIndex) => {
      if (targetIndex === index) return;
      addConflictIndex(conflictsByIndex, index, targetIndex);
      addConflictIndex(conflictsByIndex, targetIndex, index);
    });
  });

  return conflictsByIndex;
}

function addIndexToKeyMap(map, key, index) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(index);
}

function addConflictIndex(map, index, conflictIndex) {
  if (!map.has(index)) map.set(index, new Set());
  map.get(index).add(conflictIndex);
}

function rootsHaveConflict(leftRoot, rightRoot, membersByRoot, conflictMap) {
  const leftMembers = membersByRoot.get(leftRoot) || new Set();
  const rightMembers = membersByRoot.get(rightRoot) || new Set();
  const smallerMembers = leftMembers.size <= rightMembers.size ? leftMembers : rightMembers;
  const largerMembers = smallerMembers === leftMembers ? rightMembers : leftMembers;

  for (const memberIndex of smallerMembers) {
    const conflicts = conflictMap.get(memberIndex);
    if (!conflicts?.size) continue;
    for (const conflictIndex of conflicts) {
      if (largerMembers.has(conflictIndex)) return true;
    }
  }

  return false;
}

function mergeRootMembers(membersByRoot, mergedRoot, retainedRoot) {
  const mergedMembers = membersByRoot.get(mergedRoot) || new Set([mergedRoot]);
  const retainedMembers = membersByRoot.get(retainedRoot) || new Set([retainedRoot]);
  retainedMembers.forEach((member) => mergedMembers.add(member));
  membersByRoot.set(mergedRoot, mergedMembers);
  membersByRoot.set(retainedRoot, mergedMembers);
}

function summarizeGroup(group, preparedRows, scorer) {
  const records = [...group.records.values()].sort((a, b) => a.__rowIndex - b.__rowIndex);
  const allPairScores = scoreGroupRecordPairs(records, preparedRows, scorer);
  const pairStats = summarizePairScores(allPairScores);
  const exact = group.pairs.some((pair) => pair.type === "exact");
  const reasons = [...new Set(group.pairs.flatMap((pair) => pair.reasons))].slice(0, 5);

  return {
    id: 0,
    key: records.map(recordKey).sort().join("|"),
    records,
    pairs: group.pairs,
    bestPair: group.pairs[0],
    score: Math.round(pairStats.averageScore),
    minPairScore: Math.round(pairStats.minScore),
    matchedFieldPercent: Math.round(pairStats.averageFieldMatchRatio * 100),
    type: exact ? "exact" : "near",
    reasons
  };
}

function scoreGroupRecordPairs(records, preparedRows, scorer) {
  const scores = [];
  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      const leftRow = preparedRows[records[left].__rowIndex];
      const rightRow = preparedRows[records[right].__rowIndex];
      scores.push(scorePreparedPair(leftRow, rightRow, scorer));
    }
  }
  return scores;
}

function scorePreparedPair(left, right, scorer) {
  const score = scorer(left, right);
  score.fieldMatchRatio = matchedFieldRatio(score.fieldScores);
  return score;
}

function summarizePairScores(scores) {
  if (!scores.length) {
    return {
      averageScore: 0,
      minScore: 0,
      averageFieldMatchRatio: 0
    };
  }

  return {
    averageScore: scores.reduce((total, score) => total + score.value, 0) / scores.length,
    minScore: Math.min(...scores.map((score) => score.value)),
    averageFieldMatchRatio: scores.reduce((total, score) => total + (score.fieldMatchRatio || 0), 0) / scores.length
  };
}

function prepareRows(rows, objectType, mapping) {
  const prepare = objectType === "contact" ? prepareContactRow : prepareAccountRow;
  const cache = createPrepareCache();
  return rows.map((row, index) => prepare(row, mapping, index, cache));
}

async function prepareRowsAsync(rows, objectType, mapping, progress = async () => {}) {
  const prepare = objectType === "contact" ? prepareContactRow : prepareAccountRow;
  const cache = createPrepareCache();
  const preparedRows = [];
  const total = Math.max(rows.length, 1);
  let lastYield = performance.now();

  for (let index = 0; index < rows.length; index += 1) {
    preparedRows.push(prepare(rows[index], mapping, index, cache));
    if (index % SCORING_CHUNK_SIZE === 0 || performance.now() - lastYield >= MATCHING_YIELD_INTERVAL_MS) {
      const percent = 8 + ((index + 1) / total) * 8;
      await progress(`Preparing records (${formatNumber(index + 1)} of ${formatNumber(rows.length)}).`, percent);
      lastYield = performance.now();
    }
  }

  return preparedRows;
}

function createPrepareCache() {
  return {
    contactNames: new Map(),
    companies: new Map(),
    websites: new Map(),
    text: new Map(),
    addresses: new Map(),
    states: new Map(),
    postalCodes: new Map(),
    countries: new Map(),
    linkedIn: new Map(),
    phones: new Map()
  };
}

function buildFieldStats(preparedRows, objectType) {
  if (objectType !== "account") return null;
  const fields = Object.keys(ACCOUNT_FIELD_WEIGHTS).filter((field) => field !== "name");
  const stats = {
    rowCount: preparedRows.length,
    fields: Object.fromEntries(fields.map((field) => [field, new Map()]))
  };

  preparedRows.forEach((row) => {
    fields.forEach((field) => {
      const value = row[field];
      if (!value) return;
      const fieldCounts = stats.fields[field];
      fieldCounts.set(value, (fieldCounts.get(value) || 0) + 1);
    });
  });

  return stats;
}

async function buildFieldStatsAsync(preparedRows, objectType, progress = async () => {}) {
  if (objectType !== "account") return null;
  const fields = Object.keys(ACCOUNT_FIELD_WEIGHTS).filter((field) => field !== "name");
  const stats = {
    rowCount: preparedRows.length,
    fields: Object.fromEntries(fields.map((field) => [field, new Map()]))
  };
  const total = Math.max(preparedRows.length, 1);
  let lastYield = performance.now();

  for (let index = 0; index < preparedRows.length; index += 1) {
    const row = preparedRows[index];
    fields.forEach((field) => {
      const value = row[field];
      if (!value) return;
      const fieldCounts = stats.fields[field];
      fieldCounts.set(value, (fieldCounts.get(value) || 0) + 1);
    });
    if (index % SCORING_CHUNK_SIZE === 0 || performance.now() - lastYield >= MATCHING_YIELD_INTERVAL_MS) {
      const percent = 16 + ((index + 1) / total) * 4;
      await progress(`Preparing account field statistics (${formatNumber(index + 1)} of ${formatNumber(preparedRows.length)}).`, percent);
      lastYield = performance.now();
    }
  }

  return stats;
}

function prepareContactRow(row, mapping, index, cache) {
  const name = getContactNameParts(row, mapping, cache);
  const email = normalizeEmail(getValue(row, mapping.email));
  const phone = cachedTransform(cache.phones, getValue(row, mapping.phone), normalizePhone);
  const ziPhone = cachedTransform(cache.phones, getValue(row, mapping.ziPhone), normalizePhone);
  const mobile = cachedTransform(cache.phones, getValue(row, mapping.mobile), normalizePhone);
  const recordIdKey = normalizeContactReferenceKey(getValue(row, mapping.recordId));
  const recordNameKey = normalizeContactReferenceKey(name.fullName || [name.firstName, name.lastName].filter(Boolean).join(" "));
  const mirrorOfKey = normalizeContactReferenceKey(getValue(row, mapping.mirrorOf));
  const phones = [phone, ziPhone, mobile].filter((value, phoneIndex, values) => {
    return value && values.indexOf(value) === phoneIndex;
  });

  return {
    row,
    index,
    firstName: name.firstName,
    lastName: name.lastName,
    explicitFirstName: name.explicitFirstName,
    explicitLastName: name.explicitLastName,
    fullName: name.fullName,
    nameElements: name.nameElements,
    recordIdKey,
    recordNameKey,
    mirrorOfKey,
    company: cachedTransform(cache.companies, getValue(row, mapping.company), normalizeCompany),
    email,
    domain: emailDomain(email),
    linkedIn: cachedTransform(cache.linkedIn, getValue(row, mapping.ziPersonLinkedInUrl), normalizeLinkedInUrl),
    phone,
    ziPhone,
    mobile,
    phones
  };
}

function normalizeContactReferenceKey(value) {
  const id = normalizeSalesforceIdForMerge(value);
  if (id) return `id:${id.toLowerCase()}`;
  const text = normalizeResolutionValue(value);
  return text ? `name:${text}` : "";
}

function prepareAccountRow(row, mapping, index, cache) {
  const rawName = getValue(row, mapping.name);
  const name = cachedTransform(cache.companies, rawName, normalizeCompany);
  const billingStreet = cachedTransform(cache.addresses, getValue(row, mapping.billingStreet), normalizeAddress);
  const billingCity = cachedTransform(cache.text, getValue(row, mapping.billingCity), normalizeText);
  const billingState = cachedTransform(cache.states, getValue(row, mapping.billingState), normalizeState);
  const billingPostalCode = cachedTransform(cache.postalCodes, getValue(row, mapping.billingPostalCode), normalizePostalCode);
  const billingPostalPrefix = billingPostalCode.slice(0, 5);
  const billingCountry = cachedTransform(cache.countries, getValue(row, mapping.billingCountry), normalizeCountry);
  const ultimateParentAccount = cachedTransform(
    cache.companies,
    getValue(row, mapping.ultimateParentAccount),
    normalizeCompany
  );

  return {
    row,
    index,
    name,
    hasStatusMarker: hasCompanyStatusMarker(rawName),
    nameTokens: significantBucketTokens(name),
    website: cachedTransform(cache.websites, getValue(row, mapping.website), normalizeWebsite),
    billingStreet,
    billingCity,
    billingState,
    billingPostalCode,
    billingPostalPrefix,
    billingCountry,
    address: [billingStreet, billingCity, billingState, billingPostalPrefix, billingCountry].filter(Boolean).join(" "),
    firstToken: name.split(" ")[0] || "",
    accountCurrency: normalizeText(getValue(row, mapping.accountCurrency)),
    ultimateParentAccount,
    ultimateParentTokens: significantBucketTokens(ultimateParentAccount)
  };
}

function cachedTransform(cache, value, transform) {
  const key = String(value || "");
  if (cache.has(key)) return cache.get(key);
  const result = transform(key);
  cache.set(key, result);
  return result;
}

function compareGroups(left, right) {
  return (
    right.score - left.score ||
    right.matchedFieldPercent - left.matchedFieldPercent ||
    right.minPairScore - left.minPairScore ||
    right.records.length - left.records.length ||
    left.key.localeCompare(right.key)
  );
}

function matchedFieldRatio(fieldScores) {
  const scores = Object.values(fieldScores || {}).filter((score) => score != null);
  if (!scores.length) return 0;
  return scores.filter((score) => score >= MATCHED_FIELD_THRESHOLD).length / scores.length;
}

async function getContactCandidatePairsAsync(
  rows,
  highRecallMode = false,
  maxCandidatePairs = candidatePairLimit(highRecallMode),
  threshold = state.threshold,
  progress = async () => {}
) {
  const buckets = new Map();
  const total = Math.max(rows.length, 1);
  let lastYield = performance.now();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const { index, firstName, lastName, company, email, domain, linkedIn, phones } = row;

    addBucket(buckets, `email:${email}`, index, email);
    addBucket(buckets, `linkedin:${linkedIn}`, index, linkedIn);
    phones.forEach((phone) => addBucket(buckets, `phone:${phone}`, index, phone));
    addBucket(buckets, `name-company:${firstName}|${lastName}|${company}`, index, firstName && lastName && company);
    addBucket(buckets, `last-first:${lastName}|${firstName.slice(0, 1)}`, index, lastName && firstName);
    addBucket(buckets, `company-last:${company}|${lastName}`, index, company && lastName);
    addBucket(buckets, `domain-last:${domain}|${lastName}`, index, domain && lastName);
    if (rowIndex % SCORING_CHUNK_SIZE === 0 || performance.now() - lastYield >= MATCHING_YIELD_INTERVAL_MS) {
      const percent = 22 + ((rowIndex + 1) / total) * 5;
      await progress(`Building candidate buckets (${formatNumber(rowIndex + 1)} of ${formatNumber(rows.length)}).`, percent);
      lastYield = performance.now();
    }
  }

  await progress(`Scanning ${formatNumber(buckets.size)} candidate buckets.`, 28);
  return pairsFromBucketsAsync(
    buckets,
    rows,
    rows.length <= 300 ? rows.length : 0,
    highRecallMode ? contactHighRecallBucketKeys : null,
    maxCandidatePairs,
    contactCandidatePairFilter(threshold),
    progress
  );
}

async function getAccountCandidatePairsAsync(
  rows,
  highRecallMode = false,
  maxCandidatePairs = candidatePairLimit(highRecallMode),
  threshold = state.threshold,
  progress = async () => {}
) {
  const buckets = new Map();
  const total = Math.max(rows.length, 1);
  let lastYield = performance.now();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const {
      index,
      name,
      website,
      address,
      billingCity,
      billingState,
      billingPostalPrefix,
      firstToken,
      ultimateParentAccount
    } = row;

    addBucket(buckets, `website:${website}`, index, website);
    addBucket(buckets, `name-prefix:${name.slice(0, 8)}`, index, name.length >= 4);
    addBucket(buckets, `postal-token:${billingPostalPrefix}|${firstToken}`, index, billingPostalPrefix && firstToken);
    addBucket(buckets, `city-state-token:${billingCity}|${billingState}|${firstToken}`, index, billingCity && billingState && firstToken);
    addBucket(buckets, `address:${address.slice(0, 18)}`, index, address.length >= 8);
    addBucket(buckets, `ultimate-parent-token:${ultimateParentAccount}|${firstToken}`, index, ultimateParentAccount && firstToken);
    if (highRecallMode) {
      accountHighRecallBucketKeys(row).forEach((key) => addBucket(buckets, key, index, key));
    }
    if (rowIndex % SCORING_CHUNK_SIZE === 0 || performance.now() - lastYield >= MATCHING_YIELD_INTERVAL_MS) {
      const percent = 22 + ((rowIndex + 1) / total) * 5;
      await progress(`Building candidate buckets (${formatNumber(rowIndex + 1)} of ${formatNumber(rows.length)}).`, percent);
      lastYield = performance.now();
    }
  }

  await progress(`Scanning ${formatNumber(buckets.size)} candidate buckets.`, 28);
  return pairsFromBucketsAsync(
    buckets,
    rows,
    rows.length <= 300 ? rows.length : 0,
    highRecallMode ? accountHighRecallBucketKeys : null,
    maxCandidatePairs,
    accountCandidatePairFilter(threshold),
    progress
  );
}

function candidatePairLimit(highRecallMode) {
  return highRecallMode ? MAX_HIGH_RECALL_CANDIDATE_PAIRS : MAX_CANDIDATE_PAIRS;
}

function accountCandidatePairFilter(threshold) {
  const minimumScore = Number(threshold);
  if (!Number.isFinite(minimumScore) || minimumScore <= 0) return null;
  return (left, right) => accountCandidateCanReachThreshold(left, right, minimumScore);
}

function contactCandidatePairFilter(threshold) {
  const minimumScore = Number(threshold);
  if (!Number.isFinite(minimumScore) || minimumScore <= 0) return null;
  return (left, right) => contactCandidateCanReachThreshold(left, right, minimumScore);
}

function contactCandidateCanReachThreshold(left, right, minimumScore) {
  if (hasSharedExactContactIdentifier(left, right)) return true;
  if (
    minimumScore <= CONTACT_FIRST_NAME_COMPANY_DOMAIN_FLOOR &&
    hasContactFirstNameCompanyDomainCandidateCorroboration(left, right)
  ) {
    return true;
  }
  if (left.lastName && right.lastName && nameSimilarity(left.lastName, right.lastName) < 0.72) return false;
  return true;
}

function hasContactFirstNameCompanyDomainCandidateCorroboration(left, right) {
  const sameEmailDomain = Boolean(left.domain && left.domain === right.domain);
  const companySimilarity = comparableScore(left.company, right.company, contactCompanySimilarity);
  return hasContactFirstNameCompanyDomainCorroboration(left, right, companySimilarity, sameEmailDomain);
}

function hasSharedExactContactIdentifier(left, right) {
  if (left.email && left.email === right.email) return true;
  if (left.linkedIn && left.linkedIn === right.linkedIn) return true;
  if (!left.phones?.length || !right.phones?.length) return false;
  const rightPhones = new Set(right.phones);
  return left.phones.some((phone) => rightPhones.has(phone));
}

function accountCandidateCanReachThreshold(left, right, threshold) {
  return accountCandidateUpperBoundScore(left, right) >= threshold;
}

/**
 * Fast pre-score pruning for account candidates.
 *
 * The returned value is an optimistic score: expensive or noisy address fields
 * are allowed to be perfect unless an exact field already proves a conflict.
 * That makes the filter conservative while still removing obvious non-matches
 * such as different currencies, unrelated websites, conflicting postal codes,
 * and geographic/short/numeric account-name conflicts before they consume the
 * pair cap.
 */
function accountCandidateUpperBoundScore(left, right) {
  const fieldScores = {
    name: candidateEntityNameUpperBoundScore(left.name, right.name),
    website: candidateComparableScore(left.website, right.website, websiteScore),
    billingStreet: candidateOptimisticScore(left.billingStreet, right.billingStreet),
    billingCity: candidateOptimisticScore(left.billingCity, right.billingCity),
    billingState: candidateComparableScore(left.billingState, right.billingState, exactValueScore),
    billingPostalCode: candidateComparableScore(left.billingPostalCode, right.billingPostalCode, exactValueScore),
    billingCountry: candidateComparableScore(left.billingCountry, right.billingCountry, exactValueScore),
    accountCurrency: candidateComparableScore(left.accountCurrency, right.accountCurrency, exactValueScore),
    ultimateParentAccount: candidateEntityNameUpperBoundScore(left.ultimateParentAccount, right.ultimateParentAccount)
  };
  const comparableFields = comparableWeightedFields(fieldScores, ACCOUNT_FIELD_WEIGHTS);
  if (!comparableFields.length) return 0;

  const optimisticScore = weightedFieldScore(comparableFields, ACCOUNT_FIELD_WEIGHTS);
  const penalizedScore = applyContradictionPenalty(
    optimisticScore,
    comparableFields,
    ACCOUNT_FIELD_WEIGHTS,
    ACCOUNT_CONTRADICTION_THRESHOLD
  );
  const caps = [];
  if (shouldApplyAccountParentBranchDivergenceCap(fieldScores, left, right)) {
    caps.push(ACCOUNT_PARENT_BRANCH_DIVERGENCE_CAP);
  }
  if (hasAccountScopeDivergence(fieldScores, left, right)) {
    caps.push(ACCOUNT_SCOPE_DIVERGENCE_CAP);
  }
  if (hasAccountExactNameWeakWebsiteConflict(fieldScores, left, right)) {
    caps.push(ACCOUNT_EXACT_NAME_WEAK_WEBSITE_CAP);
  }
  return caps.length ? Math.min(penalizedScore, ...caps) : penalizedScore;
}

function candidateComparableScore(leftValue, rightValue, scorer) {
  if (!leftValue || !rightValue) return null;
  return scorer(leftValue, rightValue);
}

function candidateEntityNameUpperBoundScore(leftValue, rightValue) {
  if (!leftValue || !rightValue) return null;
  if (leftValue === rightValue) return 1;
  const conflict = significantEntityNameTokenConflict(leftValue, rightValue);
  if (conflict === "geographic") return 0.15;
  if (conflict === "numeric") return 0.25;
  if (conflict === "short") return 0.45;
  return 1;
}

function candidateOptimisticScore(leftValue, rightValue) {
  if (!leftValue || !rightValue) return null;
  return 1;
}

function accountHighRecallBucketKeys(row) {
  const keys = [];
  addBucketKey(keys, `website-country:${row.website}|${row.billingCountry}`, row.website && row.billingCountry);
  addBucketKey(keys, `website-postal:${row.website}|${row.billingPostalPrefix}`, row.website && row.billingPostalPrefix);
  addBucketKey(keys, `country-postal:${row.billingCountry}|${row.billingPostalPrefix}`, row.billingCountry && row.billingPostalPrefix);
  addBucketKey(keys, `parent-country:${row.ultimateParentAccount}|${row.billingCountry}`, row.ultimateParentAccount && row.billingCountry);
  addBucketKey(keys, `parent-postal:${row.ultimateParentAccount}|${row.billingPostalPrefix}`, row.ultimateParentAccount && row.billingPostalPrefix);

  row.nameTokens.forEach((token) => {
    addBucketKey(keys, `name-token-country:${token}|${row.billingCountry}`, token && row.billingCountry);
    addBucketKey(keys, `name-token-postal:${token}|${row.billingPostalPrefix}`, token && row.billingPostalPrefix);
    addBucketKey(keys, `name-token-city:${token}|${row.billingCity}|${row.billingCountry}`, token && row.billingCity && row.billingCountry);
    addBucketKey(keys, `website-name-token:${row.website}|${token}`, row.website && token);
  });

  row.ultimateParentTokens.forEach((token) => {
    addBucketKey(keys, `parent-token-country:${token}|${row.billingCountry}`, token && row.billingCountry);
    addBucketKey(keys, `parent-token-postal:${token}|${row.billingPostalPrefix}`, token && row.billingPostalPrefix);
  });

  return keys;
}

function contactHighRecallBucketKeys(row) {
  const keys = [];
  addBucketKey(keys, `company-domain:${row.company}|${row.domain}`, row.company && row.domain);
  addBucketKey(keys, `company-first:${row.company}|${row.firstName}`, row.company && row.firstName);
  addBucketKey(keys, `domain-first-last-initial:${row.domain}|${row.firstName}|${row.lastName.slice(0, 1)}`, row.domain && row.firstName && row.lastName);
  return keys;
}

function addBucketKey(keys, key, isValid) {
  if (isValid) keys.push(key);
}

function addBucket(buckets, key, index, isValid) {
  if (!isValid) return;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(index);
}

async function pairsFromBucketsAsync(
  buckets,
  rows,
  exhaustiveSize,
  splitKeyFn = null,
  maxCandidatePairs = MAX_CANDIDATE_PAIRS,
  candidateFilter = null,
  progress = async () => {}
) {
  const pairs = new Set();
  const searchState = createCandidateSearchState(maxCandidatePairs, candidateFilter);
  const bucketStats = summarizeCandidateBuckets(buckets);
  const sortedBuckets = sortedCandidateBuckets(buckets);
  const totalBuckets = Math.max(sortedBuckets.length, 1);
  let lastYield = performance.now();

  const pulse = async (bucketIndex) => {
    if (performance.now() - lastYield < MATCHING_YIELD_INTERVAL_MS) return;
    const percent = 28 + (bucketIndex / totalBuckets) * 12;
    await progress(`Finding candidate pairs (${formatNumber(pairs.size)} found).`, percent);
    lastYield = performance.now();
  };

  for (let bucketIndex = 0; bucketIndex < sortedBuckets.length; bucketIndex += 1) {
    await addPairsFromCandidateIndexesAsync(
      sortedBuckets[bucketIndex],
      pairs,
      rows,
      splitKeyFn,
      maxCandidatePairs,
      candidateFilter,
      searchState,
      () => pulse(bucketIndex + 1)
    );
    if (pairs.size >= maxCandidatePairs || searchState.stopped) {
      await progress(`Found ${formatNumber(pairs.size)} candidate pairs.`, 42);
      return finishCandidatePairs(pairs, searchState, bucketStats);
    }
    await pulse(bucketIndex + 1);
  }

  if (exhaustiveSize) {
    const exhaustiveTotal = Math.max(candidatePairEstimate(exhaustiveSize), 1);
    let attempts = 0;
    for (let left = 0; left < exhaustiveSize; left += 1) {
      for (let right = left + 1; right < exhaustiveSize; right += 1) {
        attempts += 1;
        addCandidatePair(left, right, pairs, rows, maxCandidatePairs, candidateFilter, searchState);
        if (pairs.size >= maxCandidatePairs || searchState.stopped) {
          await progress(`Found ${formatNumber(pairs.size)} candidate pairs.`, 42);
          return finishCandidatePairs(pairs, searchState, bucketStats);
        }
        if (performance.now() - lastYield >= MATCHING_YIELD_INTERVAL_MS) {
          const percent = 40 + (attempts / exhaustiveTotal) * 3;
          await progress(`Checking small-dataset candidates (${formatNumber(pairs.size)} found).`, percent);
          lastYield = performance.now();
        }
      }
    }
  }

  await progress(`Found ${formatNumber(pairs.size)} candidate pairs.`, 42);
  return finishCandidatePairs(pairs, searchState, bucketStats);
}

function createCandidateSearchState(maxCandidatePairs, candidateFilter) {
  return {
    attempts: 0,
    stopped: false,
    seenPairKeys: new Set(),
    maxAttempts: candidateFilter ? maxCandidatePairs * CANDIDATE_ATTEMPT_LIMIT_FACTOR : Infinity
  };
}

function finishCandidatePairs(pairs, searchState, bucketStats = null) {
  pairs.searchStats = {
    attempts: searchState.attempts,
    attemptCapHit: searchState.stopped
  };
  pairs.bucketStats = bucketStats;
  return pairs;
}

function summarizeCandidateBuckets(buckets) {
  let maxBucketSize = 0;
  let oversizedBucketCount = 0;
  for (const indexes of buckets.values()) {
    maxBucketSize = Math.max(maxBucketSize, indexes.length);
    if (indexes.length > MAX_DUPLICATE_BUCKET_SIZE) oversizedBucketCount += 1;
  }
  return {
    bucketCount: buckets.size,
    maxBucketSize,
    oversizedBucketCount
  };
}

function sortedCandidateBuckets(buckets) {
  return [...buckets.values()].sort((left, right) => {
    return candidatePairEstimate(left.length) - candidatePairEstimate(right.length) || left.length - right.length;
  });
}

function candidatePairEstimate(size) {
  return (size * (size - 1)) / 2;
}

async function addPairsFromCandidateIndexesAsync(
  indexes,
  pairs,
  rows,
  splitKeyFn,
  maxCandidatePairs,
  candidateFilter,
  searchState,
  pulse
) {
  if (indexes.length <= MAX_DUPLICATE_BUCKET_SIZE) {
    await addPairCombinationsAsync(indexes, pairs, rows, maxCandidatePairs, candidateFilter, searchState, pulse);
    return;
  }
  if (!splitKeyFn) return;

  const splitBuckets = new Map();
  indexes.forEach((index) => {
    splitKeyFn(rows[index]).forEach((key) => addBucket(splitBuckets, key, index, key));
  });

  for (const splitIndexes of splitBuckets.values()) {
    if (splitIndexes.length < 2 || splitIndexes.length > MAX_DUPLICATE_BUCKET_SIZE) continue;
    await addPairCombinationsAsync(splitIndexes, pairs, rows, maxCandidatePairs, candidateFilter, searchState, pulse);
    if (pairs.size >= maxCandidatePairs || searchState.stopped) return;
  }
}

async function addPairCombinationsAsync(indexes, pairs, rows, maxCandidatePairs, candidateFilter, searchState, pulse) {
  let attempts = 0;
  for (let left = 0; left < indexes.length; left += 1) {
    for (let right = left + 1; right < indexes.length; right += 1) {
      attempts += 1;
      addCandidatePair(indexes[left], indexes[right], pairs, rows, maxCandidatePairs, candidateFilter, searchState);
      if (pairs.size >= maxCandidatePairs || searchState.stopped) return;
      if (attempts % SCORING_CHUNK_SIZE === 0) await pulse();
    }
  }
}

function addCandidatePair(leftIndex, rightIndex, pairs, rows, maxCandidatePairs, candidateFilter, searchState) {
  const key = pairKey(leftIndex, rightIndex);
  if (searchState.seenPairKeys.has(key)) return;
  searchState.seenPairKeys.add(key);
  if (searchState.attempts >= searchState.maxAttempts) {
    searchState.stopped = true;
    return true;
  }
  searchState.attempts += 1;
  if (candidateFilter && !candidateFilter(rows[leftIndex], rows[rightIndex])) return;
  pairs.add(key);
  return pairs.size >= maxCandidatePairs;
}

function pairKey(left, right) {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function scoreContactPair(left, right, cache = null) {
  if (hasMirrorContactRelationship(left, right)) {
    return {
      left: left.row,
      right: right.row,
      value: 0,
      type: "near",
      reasons: [CONTACT_MIRROR_RELATIONSHIP_REASON],
      fieldScores: {
        fullName: null,
        firstName: null,
        lastName: null,
        company: null,
        email: null,
        ziPersonLinkedInUrl: null,
        phone: null,
        ziPhone: null,
        mobile: null
      }
    };
  }

  const firstSimilarity = comparableScore(left.explicitFirstName, right.explicitFirstName, nameSimilarity);
  const lastSimilarity = comparableScore(left.explicitLastName, right.explicitLastName, nameSimilarity);
  const fullNameSimilarity = cachedContactFullNameScore(left, right, cache?.nameSequences);
  const companySimilarity = comparableCachedScore(left.company, right.company, contactCompanySimilarity, cache?.companies);
  const emailSimilarity = comparableScore(left.email, right.email, emailScore);
  const exactEmail = Boolean(left.email && right.email && left.email === right.email);
  const emailOrgCorroboration = cachedPairBoolean(
    cache?.emailOrgCorroborations,
    left.email,
    right.email,
    hasContactEmailOrgCorroboration
  );
  const linkedInSimilarity = comparableScore(left.linkedIn, right.linkedIn, linkedInScore);
  const phoneSimilarity = comparableScore(left.phone, right.phone, phoneScore);
  const ziPhoneSimilarity = comparableScore(left.ziPhone, right.ziPhone, phoneScore);
  const mobileSimilarity = comparableScore(left.mobile, right.mobile, phoneScore);
  const bestPhoneSimilarity = bestContactPhoneScore(left, right);
  const exactLinkedIn = Boolean(left.linkedIn && right.linkedIn && left.linkedIn === right.linkedIn);
  const exactAnyPhone = bestPhoneSimilarity === 1;
  const exactFullName = fullNameSimilarity === 1;
  const companyConflict = hasContactCompanyConflict(left, right, companySimilarity);
  const strongIdentityCorroboration = hasStrongContactIdentityCorroboration(
    exactEmail,
    exactLinkedIn,
    emailSimilarity,
    linkedInSimilarity
  );
  const companyGeographyConflict =
    companySimilarity != null &&
    companySimilarity < 1 &&
    cachedPairBoolean(cache?.companyGeographyConflicts, left.company, right.company, hasGeographicEntityConflict);
  const sameEmailDomain = Boolean(!exactEmail && left.domain && left.domain === right.domain);
  const companyDivergenceWithoutCorroboration =
    (fullNameSimilarity || 0) >= 0.98 &&
    (companySimilarity || 0) < CONTACT_COMPANY_DIVERGENCE_THRESHOLD &&
    !strongIdentityCorroboration;
  const strongCompanyCorroboration =
    exactEmail ||
    sameEmailDomain ||
    emailOrgCorroboration ||
    (companySimilarity || 0) >= CONTACT_COMPANY_ALIGNMENT_THRESHOLD;
  const exactIdentityCompanyConflict =
    exactFullName &&
    companyConflict &&
    (exactLinkedIn || exactAnyPhone) &&
    !strongCompanyCorroboration;
  const exactNameCompany =
    Boolean(left.fullName && right.fullName && left.company && right.company) &&
    exactFullName &&
    companySimilarity === 1;
  const givenNameConflict = hasContactGivenNameConflict(
    left,
    right,
    exactEmail,
    exactLinkedIn,
    exactAnyPhone
  );
  const weightedValue = scoreWeightedFields(
    {
      nameSequence: fullNameSimilarity,
      ziPersonLinkedInUrl: linkedInSimilarity,
      phone: bestPhoneSimilarity,
      email: emailSimilarity,
      company: companySimilarity
    },
    CONTACT_FIELD_WEIGHTS,
    CONTACT_CONTRADICTION_THRESHOLD
  );
  let value = weightedValue;
  if (companyGeographyConflict) {
    value = Math.min(value, CONTACT_COMPANY_GEOGRAPHY_CONFLICT_CAP);
  } else {
    if (companyDivergenceWithoutCorroboration) {
      value = Math.min(value, CONTACT_COMPANY_DIVERGENCE_CAP);
    }
    if (exactIdentityCompanyConflict) {
      value = Math.min(value, CONTACT_STRONG_IDENTITY_CONFLICT_CAP);
    }
    if ((fullNameSimilarity || 0) >= 0.98 && emailOrgCorroboration) {
      value = Math.max(value, CONTACT_EMAIL_ORG_CORROBORATION_FLOOR);
    }
    if (hasCorroboratedExactContactName(exactFullName, left, right, companySimilarity, emailSimilarity, sameEmailDomain, emailOrgCorroboration)) {
      value = Math.max(value, CONTACT_CORROBORATED_EXACT_NAME_FLOOR);
    }
    if (exactFullName && (companySimilarity || 0) === 0 && !strongIdentityCorroboration) {
      value = Math.max(value, CONTACT_SPARSE_EXACT_NAME_FLOOR);
    }
    if (
      exactFullName &&
      (companySimilarity || 0) >= 0.86 &&
      (companySimilarity || 0) < 0.9 &&
      (emailSimilarity || 0) < 0.2 &&
      !strongIdentityCorroboration &&
      !sameEmailDomain &&
      !emailOrgCorroboration
    ) {
      value = Math.min(value, CONTACT_EXACT_NAME_NEAR_COMPANY_CAP);
    }
    if (hasContactFirstNameCompanyDomainCorroboration(left, right, companySimilarity, sameEmailDomain)) {
      value = Math.max(value, CONTACT_FIRST_NAME_COMPANY_DOMAIN_FLOOR);
    }
  }
  if (exactFullName && exactAnyPhone && companyConflict && !strongIdentityCorroboration) {
    value = Math.min(value, CONTACT_COMPANY_DIVERGENCE_CAP);
  }
  if (givenNameConflict) {
    value = Math.min(value, CONTACT_SHORT_GIVEN_NAME_CONFLICT_CAP);
  }

  const reasons = [];
  if (exactEmail) reasons.push("Exact email");
  if (exactLinkedIn) reasons.push("Exact LinkedIn URL");
  if (exactAnyPhone) reasons.push("Exact phone");
  if (exactNameCompany) reasons.push("Exact name + company");
  if (sameEmailDomain) {
    reasons.push("Same email domain");
  } else if (!exactEmail && emailOrgCorroboration) {
    reasons.push("Related email domain");
  }
  if (fullNameSimilarity >= 0.9 && fullNameSimilarity < 1) reasons.push("Near-exact full name");
  if ((firstSimilarity || 0) >= 0.88 && (lastSimilarity || 0) >= 0.9) reasons.push("Near-exact name");
  if ((companySimilarity || 0) >= 0.86 && companySimilarity < 1) reasons.push("Near-exact company");
  if (companyGeographyConflict) reasons.push("Conflicting geographic company names");
  if (companyDivergenceWithoutCorroboration) reasons.push("Different company without corroborating contact data");
  if (exactIdentityCompanyConflict) reasons.push("Exact contact data with conflicting company");
  if (givenNameConflict) reasons.push("Conflicting first names");

  return {
    left: left.row,
    right: right.row,
    value: clampScore(value),
    type: !companyGeographyConflict && (exactEmail || exactLinkedIn || exactAnyPhone || exactNameCompany) ? "exact" : "near",
    reasons: reasons.length ? reasons : ["Weighted field similarity"],
    fieldScores: {
      fullName: fullNameSimilarity,
      firstName: firstSimilarity,
      lastName: lastSimilarity,
      company: companySimilarity,
      email: emailSimilarity,
      ziPersonLinkedInUrl: linkedInSimilarity,
      phone: phoneSimilarity,
      ziPhone: ziPhoneSimilarity,
      mobile: mobileSimilarity
    }
  };
}

function hasMirrorContactRelationship(left, right) {
  return referenceMatchesRecord(left.mirrorOfKey, right.recordIdKey, right.recordNameKey) ||
    referenceMatchesRecord(right.mirrorOfKey, left.recordIdKey, left.recordNameKey);
}

function referenceMatchesRecord(referenceKey, recordIdKey, recordNameKey) {
  if (!referenceKey) return false;
  return referenceKey === recordIdKey || referenceKey === recordNameKey;
}

function hasContactCompanyConflict(left, right, companySimilarity) {
  return Boolean(left.company && right.company && (companySimilarity || 0) < CONTACT_COMPANY_DIVERGENCE_THRESHOLD);
}

function hasStrongContactIdentityCorroboration(exactEmail, exactLinkedIn, emailSimilarity, linkedInSimilarity) {
  if (exactEmail || exactLinkedIn) return true;
  if ((linkedInSimilarity || 0) >= MATCHED_FIELD_THRESHOLD) return true;
  return (emailSimilarity || 0) >= CONTACT_EMAIL_CONTEXT_CORROBORATION_MIN;
}

function hasCorroboratedExactContactName(exactFullName, left, right, companySimilarity, emailSimilarity, sameEmailDomain, emailOrgCorroboration) {
  if (!exactFullName) return false;
  if ((companySimilarity || 0) >= 1) return true;

  const companyConflict = hasContactCompanyConflict(left, right, companySimilarity);
  if ((companySimilarity || 0) >= CONTACT_COMPANY_ALIGNMENT_THRESHOLD && hasSharedDistinctiveEntityAnchor(left.company, right.company)) {
    return true;
  }
  if (!companyConflict && (sameEmailDomain || emailOrgCorroboration)) return true;

  const missingCompanyContext = !left.company || !right.company;
  return missingCompanyContext && (emailSimilarity || 0) >= 0.15;
}

function hasContactFirstNameCompanyDomainCorroboration(left, right, companySimilarity, sameEmailDomain) {
  if ((companySimilarity || 0) < 1 || !sameEmailDomain || isGenericEmailDomain(left.domain)) return false;
  const leftGivenName = contactPrimaryGivenName(left);
  const rightGivenName = contactPrimaryGivenName(right);
  return Boolean(leftGivenName && leftGivenName === rightGivenName && left.lastName && right.lastName);
}

function hasContactGivenNameConflict(left, right, exactEmail, exactLinkedIn, exactAnyPhone) {
  if (exactEmail || exactLinkedIn || exactAnyPhone) return false;
  const leftGivenName = contactPrimaryGivenName(left);
  const rightGivenName = contactPrimaryGivenName(right);
  if (!leftGivenName || !rightGivenName || !left.lastName || left.lastName !== right.lastName) return false;
  if (contactGivenNameSimilarity(leftGivenName, rightGivenName) >= 0.6) return false;
  return true;
}

function contactFullNameSimilarity(left, right) {
  const baseScore = nameElementSequenceScore(left.nameElements, right.nameElements);
  const leftGivenName = contactPrimaryGivenName(left);
  const rightGivenName = contactPrimaryGivenName(right);
  if (!leftGivenName || !rightGivenName || !left.lastName || !right.lastName) return baseScore;

  const familyScore = nameSimilarity(left.lastName, right.lastName);
  if (familyScore < 0.9) return baseScore;

  const givenScore = contactGivenNameSimilarity(leftGivenName, rightGivenName);
  if (givenScore < 0.6) return Math.min(baseScore, 0.55);

  const structuredScore = givenScore * 0.7 + familyScore * 0.3;
  return Math.max(baseScore, structuredScore);
}

function contactPrimaryGivenName(row) {
  if (!isNameInitial(row.firstName)) return row.firstName;
  return row.nameElements.find((token) => token !== row.firstName && token !== row.lastName && !isNameInitial(token)) || row.firstName;
}

function contactGivenNameSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (areKnownContactNicknames(left, right)) return 1;

  const leftKey = contactGivenNamePhoneticKey(left);
  const rightKey = contactGivenNamePhoneticKey(right);
  if (!leftKey || !rightKey) return 0;
  if (leftKey === rightKey) return 0.96;
  if (haveSameContactInitialMorpheme(leftKey, rightKey)) return 0.92;
  return 0;
}

function areKnownContactNicknames(left, right) {
  return CONTACT_KNOWN_NICKNAME_KEYS.has(symmetricPairKey(left, right));
}

function haveSameContactInitialMorpheme(leftKey, rightKey) {
  const leftMorpheme = contactInitialMorphemeKey(leftKey);
  const rightMorpheme = contactInitialMorphemeKey(rightKey);
  return Boolean(leftMorpheme && leftMorpheme === rightMorpheme);
}

function contactInitialMorphemeKey(phoneticName) {
  return phoneticName.slice(0, 3);
}

function contactGivenNamePhoneticKey(value) {
  return normalizeName(value)
    .replace(/[^a-z]/g, "")
    .replace(/^kn/, "n")
    .replace(/^wr/, "r")
    .replace(/^x/, "z")
    .replace(/^ch(?=r)/, "kr")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/qu/g, "kw")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/(.)\1+/g, "$1");
}

function isGenericEmailDomain(domain) {
  return isGenericEmailDomainRoot(emailDomainRoot(domain));
}

function hasContactEmailOrgCorroboration(leftEmail, rightEmail) {
  if (!leftEmail || !rightEmail) return false;
  const leftDomain = emailDomain(leftEmail);
  const rightDomain = emailDomain(rightEmail);
  return areCorroboratingEmailDomains(leftDomain, rightDomain);
}

function contactCompanySimilarity(left, right) {
  if (left === right) return 1;
  const baseScore = entityNameSimilarity(left, right);
  if (significantEntityNameTokenConflict(left, right)) return baseScore;
  if (hasSharedDistinctiveEntityAnchor(left, right)) return Math.max(baseScore, 0.92);
  return baseScore;
}

function scoreAccountPair(left, right, fieldStats = null) {
  const fieldScores = {
    name: comparableScore(left.name, right.name, entityNameSimilarity),
    website: comparableScore(left.website, right.website, websiteScore),
    billingStreet: comparableScore(left.billingStreet, right.billingStreet, stringSimilarity),
    billingCity: comparableScore(left.billingCity, right.billingCity, stringSimilarity),
    billingState: comparableScore(left.billingState, right.billingState, exactValueScore),
    billingPostalCode: comparableScore(left.billingPostalCode, right.billingPostalCode, exactValueScore),
    billingCountry: comparableScore(left.billingCountry, right.billingCountry, exactValueScore),
    accountCurrency: comparableScore(left.accountCurrency, right.accountCurrency, exactValueScore),
    ultimateParentAccount: comparableScore(left.ultimateParentAccount, right.ultimateParentAccount, entityNameSimilarity)
  };
  const scoreResult = scoreAccountFields(fieldScores, left, right, fieldStats);
  const value = scoreResult.value;
  const exactWebsite = fieldScores.website === 1;
  const exactName = fieldScores.name === 1;
  const exactBillingAddress = comparableBillingAddressFields().some((field) => fieldScores[field] != null)
    ? comparableBillingAddressFields().every((field) => fieldScores[field] == null || fieldScores[field] === 1)
    : false;
  const exactUltimateParent = fieldScores.ultimateParentAccount === 1;
  const nearBillingAddress = billingAddressScore(fieldScores) >= 0.82;

  const reasons = [];
  if (exactWebsite) reasons.push("Exact website");
  if (exactName) reasons.push("Exact account name");
  if (exactName && exactBillingAddress) reasons.push("Exact name + billing address");
  if (exactUltimateParent) reasons.push("Same ultimate parent account");
  if (fieldScores.name >= 0.88 && !exactName) reasons.push("Near-exact account name");
  if (nearBillingAddress && !exactBillingAddress) reasons.push("Near-exact billing address");
  if (scoreResult.commonEvidenceDiscounted) reasons.push("Common shared fields discounted");
  if (scoreResult.nameDivergenceCapApplied) reasons.push("Distinct account name signals");
  if (scoreResult.parentBranchDivergenceCapApplied) reasons.push("Different branch or department under parent");
  if (scoreResult.scopeDivergenceCapApplied) reasons.push("Different account scope");
  if (scoreResult.exactNameWeakWebsiteCapApplied) reasons.push("Exact name with conflicting website");
  if (scoreResult.uncorroboratedNearExactNameCapApplied) reasons.push("Near-exact name without corroboration");
  if (scoreResult.exactDuplicateFloorApplied) reasons.push("Exact duplicate corroboration");

  return {
    left: left.row,
    right: right.row,
    value: clampScore(value),
    type: value >= 98 || (exactName && (exactWebsite || exactBillingAddress)) ? "exact" : "near",
    reasons: reasons.length ? reasons : ["Weighted field similarity"],
    fieldScores
  };
}

function comparableScore(leftValue, rightValue, scorer) {
  if (!leftValue || !rightValue) return null;
  return scorer(leftValue, rightValue);
}

function comparableCachedScore(leftValue, rightValue, scorer, cache) {
  if (!leftValue || !rightValue) return null;
  if (!cache) return scorer(leftValue, rightValue);
  const key = symmetricPairKey(leftValue, rightValue);
  if (cache.has(key)) return cache.get(key);
  const score = scorer(leftValue, rightValue);
  cache.set(key, score);
  return score;
}

function cachedNameElementScore(leftElements, rightElements, cache) {
  if (!leftElements?.length || !rightElements?.length) return null;
  if (!cache) return nameElementSequenceScore(leftElements, rightElements);
  const leftKey = leftElements.join("\u001f");
  const rightKey = rightElements.join("\u001f");
  const key = symmetricPairKey(leftKey, rightKey);
  if (cache.has(key)) return cache.get(key);
  const score = nameElementSequenceScore(leftElements, rightElements);
  cache.set(key, score);
  return score;
}

function cachedContactFullNameScore(left, right, cache) {
  if (!left.nameElements?.length || !right.nameElements?.length) return null;
  if (!cache) return contactFullNameSimilarity(left, right);
  const leftKey = [left.firstName, left.lastName, ...left.nameElements].join("\u001f");
  const rightKey = [right.firstName, right.lastName, ...right.nameElements].join("\u001f");
  const key = symmetricPairKey(leftKey, rightKey);
  if (cache.has(key)) return cache.get(key);
  const score = contactFullNameSimilarity(left, right);
  cache.set(key, score);
  return score;
}

function cachedPairBoolean(cache, leftValue, rightValue, predicate) {
  if (!leftValue || !rightValue) return false;
  if (!cache) return predicate(leftValue, rightValue);
  const key = symmetricPairKey(leftValue, rightValue);
  if (cache.has(key)) return cache.get(key);
  const result = predicate(leftValue, rightValue);
  cache.set(key, result);
  return result;
}

function symmetricPairKey(leftValue, rightValue) {
  const left = String(leftValue || "");
  const right = String(rightValue || "");
  return left <= right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function bestContactPhoneScore(left, right) {
  if (!left.phones.length || !right.phones.length) return null;
  let bestScore = 0;
  left.phones.forEach((leftPhone) => {
    right.phones.forEach((rightPhone) => {
      bestScore = Math.max(bestScore, phoneScore(leftPhone, rightPhone) || 0);
    });
  });
  return bestScore;
}

function scoreAccountFields(fieldScores, left, right, fieldStats) {
  const comparableFields = comparableWeightedFields(fieldScores, ACCOUNT_FIELD_WEIGHTS);
  if (!comparableFields.length) {
    return {
      value: 0,
      commonEvidenceDiscounted: false,
      nameDivergenceCapApplied: false,
      parentBranchDivergenceCapApplied: false,
      scopeDivergenceCapApplied: false,
      exactNameWeakWebsiteCapApplied: false,
      uncorroboratedNearExactNameCapApplied: false,
      exactDuplicateFloorApplied: false
    };
  }

  let commonEvidenceDiscounted = false;
  const baseScore = weightedFieldScore(comparableFields, ACCOUNT_FIELD_WEIGHTS, ([field, score]) => {
    const factor = accountPositiveEvidenceFactor(field, score, left, right, fieldStats, fieldScores);
    if (factor < 1) commonEvidenceDiscounted = true;
    return factor;
  });
  const penalizedScore = applyContradictionPenalty(
    baseScore,
    comparableFields,
    ACCOUNT_FIELD_WEIGHTS,
    ACCOUNT_CONTRADICTION_THRESHOLD
  );
  const cappedScore = applyAccountNameDivergenceCap(penalizedScore, fieldScores, left, right);
  const corroborationCap = applyAccountNearExactNameCorroborationCap(cappedScore.value, fieldScores, left, right);
  const exactDuplicateFloor = applyAccountExactDuplicateFloor(corroborationCap.value, fieldScores, left, right);

  return {
    value: exactDuplicateFloor.value,
    commonEvidenceDiscounted,
    nameDivergenceCapApplied: cappedScore.nameDivergenceApplied,
    parentBranchDivergenceCapApplied: cappedScore.parentBranchApplied,
    scopeDivergenceCapApplied: cappedScore.scopeDivergenceApplied,
    exactNameWeakWebsiteCapApplied: cappedScore.exactNameWeakWebsiteApplied,
    uncorroboratedNearExactNameCapApplied: corroborationCap.applied,
    exactDuplicateFloorApplied: exactDuplicateFloor.applied
  };
}

function accountPositiveEvidenceFactor(field, score, left, right, fieldStats, fieldScores) {
  if (!fieldStats || field === "name" || score < MATCHED_FIELD_THRESHOLD) return 1;
  if ((fieldScores.name ?? 1) >= 0.92) return 1;
  const minFactor = ACCOUNT_COMMON_POSITIVE_MIN_FACTORS[field];
  if (minFactor == null) return 1;

  const value = left[field] && left[field] === right[field] ? left[field] : "";
  if (!value) return 1;
  const count = fieldStats.fields[field]?.get(value) || 0;
  if (count <= 2) return 1;

  return Math.max(minFactor, 1 / Math.sqrt(count - 1));
}

function applyAccountNameDivergenceCap(value, fieldScores, left, right) {
  const nameScore = fieldScores.name;
  const caps = [];
  let nameDivergenceApplied = false;
  let parentBranchApplied = false;
  let scopeDivergenceApplied = false;
  let exactNameWeakWebsiteApplied = false;

  if (nameScore != null && nameScore < 1 && hasEntityNameDivergence(left.name, right.name)) {
    caps.push(accountNameDivergenceCap(nameScore));
    nameDivergenceApplied = true;
  }

  if (nameScore !== 1 && shouldApplyAccountParentBranchDivergenceCap(fieldScores, left, right)) {
    caps.push(ACCOUNT_PARENT_BRANCH_DIVERGENCE_CAP);
    parentBranchApplied = true;
  }

  if (hasAccountScopeDivergence(fieldScores, left, right)) {
    caps.push(ACCOUNT_SCOPE_DIVERGENCE_CAP);
    scopeDivergenceApplied = true;
  }

  if (hasAccountExactNameWeakWebsiteConflict(fieldScores, left, right)) {
    caps.push(ACCOUNT_EXACT_NAME_WEAK_WEBSITE_CAP);
    exactNameWeakWebsiteApplied = true;
  }

  if (!caps.length) {
    return {
      value,
      nameDivergenceApplied: false,
      parentBranchApplied: false,
      scopeDivergenceApplied: false,
      exactNameWeakWebsiteApplied: false
    };
  }

  const cap = Math.min(...caps);
  return {
    value: Math.min(value, cap),
    nameDivergenceApplied: nameDivergenceApplied && value > cap,
    parentBranchApplied: parentBranchApplied && value > cap,
    scopeDivergenceApplied: scopeDivergenceApplied && value > cap,
    exactNameWeakWebsiteApplied: exactNameWeakWebsiteApplied && value > cap
  };
}

function accountNameDivergenceCap(nameScore) {
  if (nameScore < 0.7) return 80;
  if (nameScore < 0.82) return 83;
  if (nameScore < 0.9) return 85;
  return 92;
}

function shouldApplyAccountParentBranchDivergenceCap(fieldScores, left, right) {
  if (!hasAccountParentBranchDivergence(left, right)) return false;
  if (fieldScores.website === 1 && (fieldScores.name || 0) >= 0.9) return false;
  return true;
}

function hasAccountScopeDivergence(fieldScores, left, right) {
  const nameScore = fieldScores.name;
  if (nameScore == null || nameScore < 0.9 || nameScore >= 1) return false;
  if (left.hasStatusMarker || right.hasStatusMarker) return false;
  if (!hasEntityTokenContainment(left.name, right.name)) return false;
  if (hasStrongAccountIdentityCorroboration(fieldScores, left, right)) return false;

  return hasAccountScopeDivergenceSignal(left, right);
}

function hasStrongAccountIdentityCorroboration(fieldScores, left, right) {
  if (fieldScores.website === 1 && !hasAccountScopeDivergenceSignal(left, right)) return true;
  return fieldScores.ultimateParentAccount === 1 && hasDifferentUltimateParent(left) && hasDifferentUltimateParent(right);
}

function hasAccountScopeDivergenceSignal(left, right) {
  return (
    accountScopeSpecificTokens(left.name, right.name).some(isAccountScopeDivergenceToken) ||
    accountScopeSpecificTokens(right.name, left.name).some(isAccountScopeDivergenceToken)
  );
}

function hasAccountExactNameWeakWebsiteConflict(fieldScores, left, right) {
  if (fieldScores.name !== 1) return false;
  if (fieldScores.website == null || fieldScores.website > ACCOUNT_WEAK_WEBSITE_CONFLICT_MAX) return false;
  if (hasStrongExactNameCorroboration(fieldScores, left, right)) return false;
  return true;
}

function hasStrongExactNameCorroboration(fieldScores, left, right) {
  return hasStrongAccountCorroboration(fieldScores, left, right);
}

function hasStrongAccountCorroboration(fieldScores, left, right) {
  if (left.hasStatusMarker || right.hasStatusMarker) return true;
  if ((fieldScores.website || 0) >= MATCHED_FIELD_THRESHOLD) return true;
  if (fieldScores.billingPostalCode === 1 && fieldScores.billingCountry === 1) return true;
  if (fieldScores.billingCity === 1 && fieldScores.billingCountry === 1) return true;
  if (fieldScores.billingStreet === 1 && (fieldScores.billingCity === 1 || fieldScores.billingPostalCode === 1)) return true;
  if (fieldScores.billingStreet === 1 && fieldScores.billingCountry === 1 && accountNameTokenCount(left, right) >= 4) {
    return true;
  }
  return fieldScores.ultimateParentAccount === 1 && hasDifferentUltimateParent(left) && hasDifferentUltimateParent(right);
}

function applyAccountNearExactNameCorroborationCap(value, fieldScores, left, right) {
  const nameScore = fieldScores.name;
  if (nameScore == null || nameScore < 0.9 || nameScore >= 1) {
    return {
      value,
      applied: false
    };
  }

  if (hasStrongAccountCorroboration(fieldScores, left, right)) {
    return {
      value,
      applied: false
    };
  }

  if (hasSharedDistinctiveEntityAnchor(left.name, right.name)) {
    return {
      value,
      applied: false
    };
  }

  const cap = accountNearExactNameUncorroboratedCap(nameScore);
  return {
    value: Math.min(value, cap),
    applied: value > cap
  };
}

function applyAccountExactDuplicateFloor(value, fieldScores, left, right) {
  if (!hasStrongExactAccountDuplicateCorroboration(fieldScores, left, right)) {
    return {
      value,
      applied: false
    };
  }

  return {
    value: Math.max(value, ACCOUNT_EXACT_DUPLICATE_FLOOR),
    applied: value < ACCOUNT_EXACT_DUPLICATE_FLOOR
  };
}

function hasStrongExactAccountDuplicateCorroboration(fieldScores, left, right) {
  if (fieldScores.name !== 1) return false;
  if (fieldScores.website === 1) return true;
  if (fieldScores.ultimateParentAccount === 1) return true;
  if (hasStrongExactBillingAddress(fieldScores)) return true;
  return left.hasStatusMarker || right.hasStatusMarker;
}

function hasStrongExactBillingAddress(fieldScores) {
  const exactStreet = fieldScores.billingStreet === 1;
  const exactCity = fieldScores.billingCity === 1;
  const exactPostal = fieldScores.billingPostalCode === 1;
  const exactCountry = fieldScores.billingCountry === 1;

  if (exactStreet && (exactCity || exactPostal || exactCountry)) return true;
  if (exactPostal && exactCountry && exactCity) return true;
  return false;
}

function accountNearExactNameUncorroboratedCap(nameScore) {
  if (nameScore < 0.92) return 83;
  if (nameScore < 0.97) return ACCOUNT_UNCORROBORATED_NEAR_EXACT_NAME_CAP;
  return 86;
}

function accountNameTokenCount(left, right) {
  return Math.max(entityNameTokens(left.name).length, entityNameTokens(right.name).length);
}

function accountScopeSpecificTokens(value, otherValue) {
  const otherTokens = new Set(entityNameTokens(otherValue));
  return entityNameTokens(value).filter((token, index, tokens) => {
    return !otherTokens.has(token) && tokens.indexOf(token) === index;
  });
}

function isAccountScopeDivergenceToken(token) {
  return ACCOUNT_SCOPE_DIVERGENCE_TOKENS.has(token);
}

function hasAccountParentBranchDivergence(left, right) {
  if (!hasUltimateParentBranchContext(left, right)) return false;

  const leftBranchTokens = accountBranchSpecificTokens(left, right);
  const rightBranchTokens = accountBranchSpecificTokens(right, left);
  if (!leftBranchTokens.length && !rightBranchTokens.length) return false;
  if (leftBranchTokens.length && rightBranchTokens.length && setsHaveSameValues(leftBranchTokens, rightBranchTokens)) {
    return false;
  }
  return true;
}

function hasUltimateParentBranchContext(left, right) {
  const leftHasDifferentParent = hasDifferentUltimateParent(left);
  const rightHasDifferentParent = hasDifferentUltimateParent(right);
  if (!leftHasDifferentParent && !rightHasDifferentParent) return false;

  const parents = [left.ultimateParentAccount, right.ultimateParentAccount].filter(Boolean);
  if (!parents.length) return false;
  if (left.ultimateParentAccount && right.ultimateParentAccount && entityNameSimilarity(left.ultimateParentAccount, right.ultimateParentAccount) >= 0.9) {
    return true;
  }

  return parents.some((parent) => {
    return entityNameSimilarity(parent, left.name) >= 0.88 || entityNameSimilarity(parent, right.name) >= 0.88;
  });
}

function hasDifferentUltimateParent(row) {
  return Boolean(row.ultimateParentAccount && row.name && entityNameSimilarity(row.name, row.ultimateParentAccount) < 0.98);
}

function accountBranchSpecificTokens(row, otherRow) {
  const ownTokens = accountBranchCandidateTokens(row.name);
  const otherTokens = accountBranchCandidateTokens(otherRow.name);
  const contextTokens = new Set([
    ...entityNameTokens(row.ultimateParentAccount),
    ...entityNameTokens(otherRow.ultimateParentAccount),
    ...ownTokens.filter((token) => otherTokens.includes(token))
  ]);

  return ownTokens.filter((token, index, tokens) => {
    return !contextTokens.has(token) && tokens.indexOf(token) === index;
  });
}

function accountBranchCandidateTokens(value) {
  return entityNameTokens(value).filter((token) => {
    return token.length >= 3 && !isNumericToken(token) && !ACCOUNT_BRANCH_TOKEN_STOPWORDS.has(token);
  });
}

function scoreWeightedFields(fieldScores, fieldWeights, contradictionThreshold) {
  const comparableFields = comparableWeightedFields(fieldScores, fieldWeights);
  if (!comparableFields.length) return 0;

  const baseScore = weightedFieldScore(comparableFields, fieldWeights);
  return applyContradictionPenalty(baseScore, comparableFields, fieldWeights, contradictionThreshold);
}

function comparableWeightedFields(fieldScores, fieldWeights) {
  return Object.entries(fieldScores).filter(([field, score]) => {
    return score != null && fieldWeights[field];
  });
}

function weightedFieldScore(comparableFields, fieldWeights, evidenceFactor = () => 1) {
  const totalWeight = totalComparableWeight(comparableFields, fieldWeights);
  const weightedScore = comparableFields.reduce((total, [field, score]) => {
    return total + score * fieldWeights[field] * evidenceFactor([field, score]);
  }, 0);
  return (weightedScore / totalWeight) * 100;
}

function applyContradictionPenalty(baseScore, comparableFields, fieldWeights, contradictionThreshold) {
  const ratio = contradictionWeightRatio(comparableFields, fieldWeights, contradictionThreshold);
  return baseScore * Math.pow(1 - ratio, 2);
}

function contradictionWeightRatio(comparableFields, fieldWeights, contradictionThreshold) {
  const totalWeight = totalComparableWeight(comparableFields, fieldWeights);
  const contradictionWeight = comparableFields.reduce((total, [field, score]) => {
    return score < contradictionThreshold ? total + fieldWeights[field] : total;
  }, 0);
  return contradictionWeight / totalWeight;
}

function totalComparableWeight(comparableFields, fieldWeights) {
  return comparableFields.reduce((total, [field]) => total + fieldWeights[field], 0);
}

function comparableBillingAddressFields() {
  return ["billingStreet", "billingCity", "billingState", "billingPostalCode", "billingCountry"];
}

function billingAddressScore(fieldScores) {
  const fields = comparableBillingAddressFields().filter((field) => fieldScores[field] != null);
  if (!fields.length) return 0;
  const totalWeight = fields.reduce((total, field) => total + ACCOUNT_FIELD_WEIGHTS[field], 0);
  return fields.reduce((total, field) => total + fieldScores[field] * ACCOUNT_FIELD_WEIGHTS[field], 0) / totalWeight;
}

function getContactNameParts(row, mapping, cache = null) {
  const rawFullName = getValue(row, mapping.fullName);
  const rawFirstName = getValue(row, mapping.firstName);
  const rawLastName = getValue(row, mapping.lastName);
  const cacheKey = `${rawFullName}\u0000${rawFirstName}\u0000${rawLastName}`;
  if (cache?.contactNames.has(cacheKey)) return cache.contactNames.get(cacheKey);

  const parsedFullName = parsePersonName(rawFullName);
  const explicitFirstName = normalizeGivenName(rawFirstName);
  const explicitLastName = normalizeFamilyName(rawLastName);
  const firstName = explicitFirstName || parsedFullName.firstName;
  const lastName = explicitLastName || parsedFullName.lastName;
  const fullName = parsedFullName.fullName || [firstName, lastName].filter(Boolean).join(" ");
  const nameElements = parsedFullName.nameElements.length ? parsedFullName.nameElements : [firstName, lastName].filter(Boolean);

  const result = {
    firstName,
    lastName,
    explicitFirstName,
    explicitLastName,
    fullName,
    nameElements,
    prefixes: parsedFullName.prefixes,
    suffixes: parsedFullName.suffixes
  };
  if (cache) cache.contactNames.set(cacheKey, result);
  return result;
}

function parsePersonName(value) {
  const empty = {
    firstName: "",
    middleNames: [],
    lastName: "",
    fullName: "",
    nameElements: [],
    prefixes: [],
    suffixes: []
  };
  const raw = String(value || "").trim();
  if (!raw) return empty;

  const withoutParentheticals = raw.replace(/\([^)]*\)/g, " ");
  const commaParts = withoutParentheticals
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  let tokens = nameTokens(withoutParentheticals);
  if (commaParts.length > 1) {
    const beforeComma = stripNameDecorators(nameTokens(commaParts[0]));
    const afterComma = stripNameDecorators(nameTokens(commaParts.slice(1).join(" ")));
    if (beforeComma.core.length === 1 && afterComma.core.length > 0) {
      tokens = [...afterComma.core, ...beforeComma.core, ...beforeComma.suffixes, ...afterComma.suffixes];
    }
  }

  const stripped = stripNameDecorators(tokens);
  if (!stripped.core.length) return { ...empty, prefixes: stripped.prefixes, suffixes: stripped.suffixes };

  const core = stripped.core;
  const lastNameStart = findLastNameStart(core);
  const firstName = core[0] || "";
  const lastName = core.length > 1 ? core.slice(lastNameStart).join(" ") : "";
  const middleNames = core.slice(1, lastNameStart);

  return {
    firstName,
    middleNames,
    lastName,
    fullName: core.join(" "),
    nameElements: core,
    prefixes: stripped.prefixes,
    suffixes: stripped.suffixes
  };
}

function stripNameDecorators(tokens) {
  const core = tokens.filter(Boolean);
  const prefixes = [];
  const suffixes = [];

  while (core.length && CONTACT_NAME_PREFIXES.has(core[0])) {
    prefixes.push(core.shift());
  }

  while (core.length && CONTACT_NAME_SUFFIXES.has(core[core.length - 1])) {
    suffixes.unshift(core.pop());
  }

  return { core, prefixes, suffixes };
}

function findLastNameStart(tokens) {
  let start = tokens.length - 1;
  while (start > 1 && CONTACT_NAME_PARTICLES.has(tokens[start - 1])) {
    start -= 1;
  }
  return start;
}

function normalizeGivenName(value) {
  return stripNameDecorators(nameTokens(value)).core.join(" ");
}

function normalizeFamilyName(value) {
  return stripNameDecorators(nameTokens(value)).core.join(" ");
}

function nameTokens(value) {
  return normalizePersonNameText(compactNameCredentials(value)).split(" ").filter(Boolean);
}

function compactNameCredentials(value) {
  return String(value || "")
    .replace(/\bph\.?\s*d\.?\b/gi, " phd ")
    .replace(/\bm\.?\s*d\.?\b/gi, " md ")
    .replace(/\bj\.?\s*d\.?\b/gi, " jd ")
    .replace(/\bd\.?\s*d\.?\s*s\.?\b/gi, " dds ")
    .replace(/\bd\.?\s*m\.?\s*d\.?\b/gi, " dmd ");
}

function normalizePersonNameText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/(^|[^a-z0-9'-])['-]+|['-]+($|[^a-z0-9'-])/g, " ")
    .replace(/[^a-z0-9'-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getValue(row, header) {
  if (!header) return "";
  const value = row[header];
  return value == null ? "" : String(value).trim();
}

function recordKey(row) {
  const mapping = state.mapping;
  return getValue(row, mapping.recordId) || `row-${row.__rowIndex + 1}`;
}

function displayName(row) {
  if (state.objectType === "contact") {
    const rawFullName = getValue(row, state.mapping.fullName);
    const { firstName, lastName } = getContactNameParts(row, state.mapping);
    const parsedName = toDisplayName([firstName, lastName].filter(Boolean).join(" "));
    return rawFullName || parsedName || getValue(row, state.mapping.email) || `Row ${row.__rowIndex + 1}`;
  }
  return getValue(row, state.mapping.name) || getValue(row, state.mapping.website) || `Row ${row.__rowIndex + 1}`;
}

function displaySubtitle(row) {
  if (state.objectType === "contact") {
    return [getValue(row, state.mapping.company), getValue(row, state.mapping.email)].filter(Boolean).join(" · ");
  }
  return [getValue(row, state.mapping.website), accountAddress(row, state.mapping)].filter(Boolean).join(" · ");
}

function accountAddress(row, mapping) {
  return [
    getValue(row, mapping.billingStreet),
    getValue(row, mapping.billingCity),
    getValue(row, mapping.billingState),
    getValue(row, mapping.billingPostalCode),
    getValue(row, mapping.billingCountry)
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeName(value) {
  return normalizePersonNameText(value).replace(/\b(jr|sr|ii|iii|iv)\b/g, "").trim();
}

function normalizeCompany(value) {
  return stripCompanyStatusMarkers(normalizeText(value))
    .replace(
      /\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|plc|llp|lp|the)\b/g,
      ""
    )
    .trim()
    .replace(/\s+/g, " ");
}

function stripCompanyStatusMarkers(value) {
  return String(value || "")
    .replace(/\b(do not use|donotuse|inactive|obsolete|deprecated|duplicate|dupe)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function hasCompanyStatusMarker(value) {
  return /(^|[^a-z0-9])(do[^a-z0-9]*not[^a-z0-9]*use|donotuse|inactive|obsolete|deprecated|duplicate|dupe)(?=$|[^a-z0-9])/i.test(
    String(value || "")
  );
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function emailDomain(email) {
  return email.includes("@") ? email.split("@").pop() : "";
}

function normalizeWebsite(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    return url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  } catch {
    return raw
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .trim();
  }
}

function normalizeLinkedInUrl(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    if (!host.includes("linkedin.com")) return `${host}${path}`;
    const parts = path.split("/").filter(Boolean);
    const profileIndex = parts.findIndex((part) => ["in", "pub"].includes(part));
    return profileIndex >= 0 && parts[profileIndex + 1]
      ? `linkedin.com/${parts[profileIndex]}/${parts[profileIndex + 1]}`
      : `${host}${path}`;
  } catch {
    return raw
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  }
}

function normalizePhone(value) {
  const digits = onlyDigits(value);
  if (digits.length < 7) return "";
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

function normalizeAddress(value) {
  return normalizeText(value)
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\broad\b/g, "rd")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\bsuite\b/g, "ste")
    .replace(/\bapartment\b/g, "apt")
    .replace(/\bunit\b/g, "ste")
    .replace(/\bnorth\b/g, "n")
    .replace(/\bsouth\b/g, "s")
    .replace(/\beast\b/g, "e")
    .replace(/\bwest\b/g, "w")
    .trim();
}

function normalizeState(value) {
  const stateValue = normalizeText(value);
  const states = {
    california: "ca",
    "district of columbia": "dc",
    massachusetts: "ma",
    "new york": "ny",
    texas: "tx",
    virginia: "va"
  };
  return states[stateValue] || stateValue;
}

function normalizeCountry(value) {
  const country = normalizeText(value);
  if (["united states", "united states of america", "usa"].includes(country)) return "us";
  if (["united kingdom", "great britain", "uk"].includes(country)) return "gb";
  return country;
}

function normalizePostalCode(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function significantBucketTokens(value) {
  const seen = new Set();
  return String(value || "")
    .split(" ")
    .filter((token) => {
      const isUseful = token.length >= 4 && !ACCOUNT_BUCKET_STOPWORDS.has(token) && !seen.has(token);
      if (isUseful) seen.add(token);
      return isUseful;
    })
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .slice(0, ACCOUNT_BUCKET_TOKEN_LIMIT);
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function emailScore(leftEmail, rightEmail) {
  if (!leftEmail || !rightEmail) return 0;
  if (leftEmail === rightEmail) return 1;
  const leftDomain = emailDomain(leftEmail);
  const rightDomain = emailDomain(rightEmail);
  const addressSimilarity = stringSimilarity(leftEmail, rightEmail);
  if (addressSimilarity >= 0.94) return 0.92;
  if (leftDomain && leftDomain === rightDomain) return Math.max(0.35, addressSimilarity * 0.65);
  if (areCorroboratingEmailDomains(leftDomain, rightDomain)) return Math.max(0.55, addressSimilarity * 0.65);
  return addressSimilarity >= 0.9 ? 0.55 : addressSimilarity * 0.25;
}

function areCorroboratingEmailDomains(leftDomain, rightDomain) {
  if (!leftDomain || !rightDomain) return false;
  if (leftDomain === rightDomain) return !isGenericEmailDomainRoot(emailDomainRoot(leftDomain));
  if (hasEmailDomainContainment(leftDomain, rightDomain)) return true;
  return hasRelatedEmailDomainRoot(leftDomain, rightDomain);
}

function hasEmailDomainContainment(leftDomain, rightDomain) {
  const leftRoot = emailDomainRoot(leftDomain);
  const rightRoot = emailDomainRoot(rightDomain);
  if (!leftRoot || !rightRoot || isGenericEmailDomainRoot(leftRoot) || isGenericEmailDomainRoot(rightRoot)) return false;
  return leftDomain.endsWith(`.${rightDomain}`) || rightDomain.endsWith(`.${leftDomain}`);
}

function hasRelatedEmailDomainRoot(leftDomain, rightDomain) {
  const leftRoot = emailDomainRoot(leftDomain);
  const rightRoot = emailDomainRoot(rightDomain);
  if (!leftRoot || !rightRoot || isGenericEmailDomainRoot(leftRoot) || isGenericEmailDomainRoot(rightRoot)) return false;
  if (leftRoot === rightRoot) return leftRoot.length >= RELATED_EMAIL_DOMAIN_ROOT_MIN_LENGTH;
  const shorter = leftRoot.length <= rightRoot.length ? leftRoot : rightRoot;
  const longer = leftRoot.length > rightRoot.length ? leftRoot : rightRoot;
  return shorter.length >= RELATED_EMAIL_DOMAIN_ROOT_MIN_LENGTH && longer.startsWith(shorter);
}

function isGenericEmailDomainRoot(root) {
  return GENERIC_EMAIL_DOMAIN_ROOTS.has(root);
}

function emailDomainRoot(domain) {
  return String(domain || "")
    .split(".")
    .find(Boolean)
    ?.replace(/[^a-z0-9]/g, "") || "";
}

function linkedInScore(leftUrl, rightUrl) {
  if (!leftUrl && !rightUrl) return null;
  if (!leftUrl || !rightUrl) return 0;
  if (leftUrl === rightUrl) return 1;
  const similarity = stringSimilarity(leftUrl, rightUrl);
  return similarity >= 0.9 ? similarity : 0;
}

function phoneScore(leftPhone, rightPhone) {
  if (!leftPhone && !rightPhone) return null;
  if (!leftPhone || !rightPhone) return 0;
  if (leftPhone === rightPhone) return 1;
  const similarity = stringSimilarity(leftPhone, rightPhone);
  return similarity >= 0.92 ? 0.9 : 0;
}

function exactValueScore(leftValue, rightValue) {
  if (!leftValue && !rightValue) return null;
  if (!leftValue || !rightValue) return 0;
  return leftValue === rightValue ? 1 : 0;
}

function websiteScore(leftWebsite, rightWebsite) {
  if (!leftWebsite || !rightWebsite) return 0;
  if (leftWebsite === rightWebsite) return 1;
  if (hasWebsiteHostContainment(leftWebsite, rightWebsite)) return 0.95;
  return stringSimilarity(leftWebsite, rightWebsite);
}

function hasWebsiteHostContainment(leftWebsite, rightWebsite) {
  return leftWebsite.endsWith(`.${rightWebsite}`) || rightWebsite.endsWith(`.${leftWebsite}`);
}

function comparableNameElementScore(leftElements, rightElements) {
  if (!leftElements?.length || !rightElements?.length) return null;
  return nameElementSequenceScore(leftElements, rightElements);
}

function nameElementSequenceScore(leftElements, rightElements) {
  if (sameNameElementSequence(leftElements, rightElements)) return 1;
  if (isOrderedNameSubsequence(leftElements, rightElements) || isOrderedNameSubsequence(rightElements, leftElements)) {
    return 1;
  }

  const orderedOverlap = orderedNameOverlapScore(leftElements, rightElements);
  const joinedSimilarity = nameSimilarity(leftElements.join(" "), rightElements.join(" "));
  return Math.max(orderedOverlap, joinedSimilarity);
}

function sameNameElementSequence(leftElements, rightElements) {
  return leftElements.length === rightElements.length && leftElements.every((token, index) => token === rightElements[index]);
}

function isOrderedNameSubsequence(candidateElements, containerElements) {
  let candidateIndex = 0;
  for (const containerElement of containerElements) {
    if (nameElementsCompatible(candidateElements[candidateIndex], containerElement)) candidateIndex += 1;
    if (candidateIndex === candidateElements.length) return true;
  }
  return false;
}

function orderedNameOverlapScore(leftElements, rightElements) {
  const overlap = orderedNameOverlapLength(leftElements, rightElements);
  return overlap / Math.max(leftElements.length, rightElements.length);
}

function orderedNameOverlapLength(leftElements, rightElements) {
  let previous = new Array(rightElements.length + 1).fill(0);
  let current = new Array(rightElements.length + 1);

  for (let leftIndex = 1; leftIndex <= leftElements.length; leftIndex += 1) {
    current[0] = 0;
    for (let rightIndex = 1; rightIndex <= rightElements.length; rightIndex += 1) {
      if (nameElementsCompatible(leftElements[leftIndex - 1], rightElements[rightIndex - 1])) {
        current[rightIndex] = previous[rightIndex - 1] + 1;
      } else {
        current[rightIndex] = Math.max(current[rightIndex - 1], previous[rightIndex]);
      }
    }
    [previous, current] = [current, previous];
  }

  return previous[rightElements.length];
}

function nameElementsCompatible(leftElement, rightElement) {
  if (!leftElement || !rightElement) return false;
  if (leftElement === rightElement) return true;
  if (areKnownContactNicknames(leftElement, rightElement)) return true;
  if (isNameInitial(leftElement)) return rightElement.startsWith(leftElement);
  if (isNameInitial(rightElement)) return leftElement.startsWith(rightElement);
  return false;
}

function isNameInitial(token) {
  return /^[a-z]$/.test(token);
}

function entityNameSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const baseScore = stringSimilarity(left, right);
  const conflict = significantEntityNameTokenConflict(left, right);
  if (conflict === "geographic") return Math.min(baseScore, 0.15);
  if (conflict === "numeric") return Math.min(baseScore, 0.25);
  if (conflict === "short") return Math.min(baseScore, 0.45);
  if (hasEntityTokenContainment(left, right)) return Math.max(baseScore, 0.95);
  return baseScore;
}

function hasEntityTokenContainment(left, right) {
  const leftTokens = entityNameTokens(left);
  const rightTokens = entityNameTokens(right);
  if (Math.min(leftTokens.length, rightTokens.length) < 2) return false;
  return isExactOrderedSubsequence(leftTokens, rightTokens) || isExactOrderedSubsequence(rightTokens, leftTokens);
}

function isExactOrderedSubsequence(candidateTokens, containerTokens) {
  let candidateIndex = 0;
  for (const token of containerTokens) {
    if (candidateTokens[candidateIndex] === token) candidateIndex += 1;
    if (candidateIndex === candidateTokens.length) return true;
  }
  return false;
}

function significantEntityNameTokenConflict(left, right) {
  if (!left || !right || left === right) return "";
  const leftTokens = entityNameTokens(left);
  const rightTokens = entityNameTokens(right);
  if (!hasSharedEntityNameContext(leftTokens, rightTokens)) return "";
  if (hasGeographicEntityConflict(left, right)) return "geographic";
  if (hasNumericTokenConflict(leftTokens, rightTokens)) return "numeric";
  if (hasShortTokenConflict(leftTokens, rightTokens)) return "short";
  return "";
}

function entityNameTokens(value) {
  return String(value || "").split(" ").filter(Boolean);
}

function hasSharedDistinctiveEntityAnchor(left, right) {
  const leftAnchors = distinctiveEntityAnchorTokens(left);
  const rightAnchors = new Set(distinctiveEntityAnchorTokens(right));
  return leftAnchors.some((token) => rightAnchors.has(token));
}

function distinctiveEntityAnchorTokens(value) {
  return entityNameTokens(value).filter((token) => {
    return token.length >= 5 && !ENTITY_ANCHOR_STOPWORDS.has(token) && !isGeographicEntityAnchorToken(token) && !isNumericToken(token);
  });
}

function isGeographicEntityAnchorToken(token) {
  return GEOGRAPHIC_ENTITY_NAMES.some((nameTokens) => nameTokens.length === 1 && nameTokens[0] === token);
}

function hasGeographicEntityConflict(left, right) {
  if (!left || !right || left === right) return false;
  const leftGeographies = geographicEntityNames(left);
  const rightGeographies = geographicEntityNames(right);
  if (!leftGeographies.length || !rightGeographies.length) return false;
  return !setsHaveSameValues(leftGeographies, rightGeographies);
}

function geographicEntityNames(value) {
  const tokens = entityNameTokens(value);
  return GEOGRAPHIC_ENTITY_NAMES.filter((nameTokens) => hasTokenSequence(tokens, nameTokens)).map((tokens) => tokens.join(" "));
}

function hasTokenSequence(tokens, sequence) {
  if (!tokens.length || !sequence.length || sequence.length > tokens.length) return false;
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((token, offset) => tokens[index + offset] === token)) return true;
  }
  return false;
}

function hasEntityNameDivergence(left, right) {
  const leftTokens = distinctiveEntityNameTokens(left);
  const rightTokens = distinctiveEntityNameTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token));
  if (!shared.length) return false;

  const leftOnly = leftTokens.filter((token) => !rightSet.has(token));
  const rightOnly = rightTokens.filter((token) => !leftSet.has(token));
  return leftOnly.some(isDistinctiveEntityNameToken) && rightOnly.some(isDistinctiveEntityNameToken);
}

function distinctiveEntityNameTokens(value) {
  return entityNameTokens(value).filter((token) => {
    return !ACCOUNT_NAME_DIVERGENCE_STOPWORDS.has(token);
  });
}

function isDistinctiveEntityNameToken(token) {
  return token.length >= 3 || isNumericToken(token);
}

function hasSharedEntityNameContext(leftTokens, rightTokens) {
  const rightTokenSet = new Set(rightTokens);
  return leftTokens.some((token) => token.length > 3 && !isNumericToken(token) && rightTokenSet.has(token));
}

function hasNumericTokenConflict(leftTokens, rightTokens) {
  const leftNumeric = leftTokens.filter(isNumericToken);
  const rightNumeric = rightTokens.filter(isNumericToken);
  return Boolean(leftNumeric.length && rightNumeric.length && !setsHaveSameValues(leftNumeric, rightNumeric));
}

function hasShortTokenConflict(leftTokens, rightTokens) {
  const leftShort = leftTokens.filter(isShortNonNumericToken);
  const rightShort = rightTokens.filter(isShortNonNumericToken);
  if (!leftShort.length || !rightShort.length) return false;

  const unmatchedLeft = leftShort.filter((token) => !rightShort.includes(token));
  const unmatchedRight = rightShort.filter((token) => !leftShort.includes(token));
  return Boolean(unmatchedLeft.length && unmatchedRight.length);
}

function isShortNonNumericToken(token) {
  return token.length <= 3 && !isNumericToken(token);
}

function isNumericToken(token) {
  return /^\d+$/.test(token);
}

function setsHaveSameValues(leftValues, rightValues) {
  const left = new Set(leftValues);
  const right = new Set(rightValues);
  if (left.size !== right.size) return false;
  return [...left].every((value) => right.has(value));
}

function nameSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const strict = stringSimilarity(left, right);
  const relaxedLeft = relaxNamePunctuation(left);
  const relaxedRight = relaxNamePunctuation(right);
  const relaxed = relaxedLeft === relaxedRight ? 1 : stringSimilarity(relaxedLeft, relaxedRight);

  // Punctuation-relaxed names can be strong near matches, but not literal exact matches.
  return Math.max(strict, Math.min(0.96, relaxed));
}

function relaxNamePunctuation(value) {
  return String(value || "")
    .replace(/[-']/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stringSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const primary = 1 - levenshtein(left, right) / Math.max(left.length, right.length);
  const token = tokenSimilarity(left, right);
  return Math.max(primary, token);
}

function tokenSimilarity(left, right) {
  const leftTokens = left.split(" ").filter(Boolean).sort().join(" ");
  const rightTokens = right.split(" ").filter(Boolean).sort().join(" ");
  if (!leftTokens || !rightTokens) return 0;
  if (leftTokens === rightTokens) return 1;
  return 1 - levenshtein(leftTokens, rightTokens) / Math.max(leftTokens.length, rightTokens.length);
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function clampScore(value) {
  return Math.max(0, Math.min(100, value));
}

function render() {
  renderSource();
  renderMapping();
  renderMetrics();
  renderDatasetExportButton();
  renderTrainingExportButton();
  renderGroups();
  renderDetail();
  renderLoadingModal();
}

function showLoadingModal(title, message, progress = 0) {
  state.loadingModal = {
    active: true,
    title,
    message,
    progress
  };
  renderLoadingModal();
}

function hideLoadingModal() {
  state.loadingModal = {
    active: false,
    title: "",
    message: "",
    progress: 0
  };
  renderLoadingModal();
}

async function updateLoadingProgress(message, progress) {
  if (!state.loadingModal.active) return;
  state.loadingModal = {
    ...state.loadingModal,
    message: message || state.loadingModal.message,
    progress: clampProgress(progress)
  };
  renderLoadingModal();
  await yieldToBrowser();
}

function renderLoadingModal() {
  if (!els.loadingModal) return;
  const { active, title, message, progress } = state.loadingModal;
  els.loadingModal.hidden = !active;
  els.loadingModal.setAttribute("aria-busy", active ? "true" : "false");
  els.loadingModalTitle.textContent = title || "Loading";
  els.loadingModalMessage.textContent = message || "Preparing records.";
  const progressValue = clampProgress(progress);
  els.loadingProgress?.setAttribute("aria-valuenow", String(Math.round(progressValue)));
  els.loadingProgressBar?.style.setProperty("--loading-progress", `${progressValue}%`);
  if (els.loadingSplineStatus) {
    els.loadingSplineStatus.textContent = loadingProgressStatusText(message, progressValue);
  }
}

function clampProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function loadingProgressStatusText(message, progressValue) {
  const progress = clampProgress(progressValue);
  const normalizedMessage = String(message || "").trim();
  const step = loadingProgressStatusStep(normalizedMessage, progress);
  if (step.type === "spline") return loadingSplineStatusText(progress);
  const steps = loadingProgressStatusSteps();
  const stepNumber = steps.indexOf(step) + 1;
  return `${step.label}: stage ${formatNumber(stepNumber)}/${formatNumber(steps.length)} - ${Math.round(progress)}%`;
}

function loadingProgressStatusStep(message, progressValue) {
  const progress = clampProgress(progressValue);
  const steps = loadingProgressStatusSteps();
  if (shouldShowSplineInterlude(message, progress)) {
    return steps.find((step) => step.type === "spline");
  }

  const matchedStep = steps.find((step) => step.pattern?.test(message));
  if (matchedStep) return matchedStep;

  const stepIndex = Math.min(
    steps.length - 1,
    Math.floor((progress / 100) * steps.length)
  );
  return steps[stepIndex];
}

function loadingProgressStatusSteps() {
  if (loadingProgressStatusSteps.steps) return loadingProgressStatusSteps.steps;
  loadingProgressStatusSteps.steps = [
    { label: "Reading dataset", pattern: /\b(reading|fetching|parsing|csv|json|dataset)\b/i },
    { label: "Preparing records", pattern: /\b(preparing records|matching records|sample records)\b/i },
    { label: "Checking field statistics", pattern: /\b(field statistics|field mapping)\b/i },
    { label: "Building candidate buckets", pattern: /\b(building candidate buckets|scanning)\b/i },
    { label: "Reticulating splines", type: "spline" },
    { label: "Finding candidate pairs", pattern: /\b(finding candidate pairs|found [\d,]+ candidate pairs|checking small-dataset candidates)\b/i },
    { label: "Scoring candidate pairs", pattern: /\bscoring\b/i },
    { label: "Sorting scored pairs", pattern: /\b(sorting scored pairs)\b/i },
    { label: "Building match groups", pattern: /\b(building match groups)\b/i },
    { label: "Rendering duplicate groups", pattern: /\b(rendering|ready)\b/i },
    { label: "Restoring review state", pattern: /\b(restoring saved review state)\b/i }
  ];
  return loadingProgressStatusSteps.steps;
}

function shouldShowSplineInterlude(message, progressValue) {
  if (progressValue < 48 || progressValue > 62) return false;
  return !/\b(reading|fetching|parsing|rendering|ready|restoring)\b/i.test(message);
}

function loadingSplineStatusText(progressValue) {
  const total = 713;
  const reticulated = Math.min(total, Math.round((progressValue / 100) * total));
  const sector = 1084 + Math.round(progressValue * 6.17);
  return `Reticulating splines: ${formatNumber(reticulated)}/${formatNumber(total)} - sector ${formatNumber(sector)}`;
}

function renderSource() {
  const config = OBJECT_CONFIG[state.objectType];
  els.objectLabel.textContent = config.label;
  els.threshold.value = state.threshold;
  els.maxThreshold.value = state.maxThreshold;
  els.thresholdMinNumber.value = state.threshold;
  els.thresholdMaxNumber.value = state.maxThreshold;
  syncThresholdSliderFill(state.threshold, state.maxThreshold);
  els.thresholdValue.textContent = thresholdRangeLabel();
  els.highRecallMode.checked = !state.highRecallMode;
  const datasetLoaded = Boolean(state.rows.length);
  [
    els.threshold,
    els.maxThreshold,
    els.thresholdMinNumber,
    els.thresholdMaxNumber,
    els.highRecallMode,
    els.applyControlsButton
  ].forEach((control) => {
    control.disabled = !datasetLoaded;
  });
  renderLabelStatusFilterHost();
  renderFilterBuilder();
  els.fileName.textContent = state.loadingFileName || state.fileName || "Dataset import";
  els.fileMeta.textContent = sourceMetaText(config);
  els.sourcePill.textContent = state.isLoadingFile ? "Loading" : state.rows.length ? "Loaded" : "No file";
  els.sourcePill.dataset.lastProcessingMode = state.lastProcessingMode || "";
  els.sourcePill.dataset.groupCount = String(state.groups.length || 0);
  els.sourcePill.dataset.resultGroups = String(state.lastMatchingStats?.resultGroups || 0);
  if (state.loadError && !state.isLoadingFile) els.sourcePill.textContent = "Error";
  els.sourcePill.classList.toggle("is-loaded", Boolean(state.rows.length) && !state.isLoadingFile);
  els.sourcePill.classList.toggle("is-loading", state.isLoadingFile);
  els.sourcePill.classList.toggle("is-error", Boolean(state.loadError) && !state.isLoadingFile);
  els.dropZone.classList.toggle("is-loading", state.isLoadingFile);
}

function sourceMetaText(config) {
  if (state.isLoadingFile) return `Loading ${config.label.toLowerCase()}...`;
  if (state.loadError) return state.loadError;
  const baseText = state.rows.length
    ? `${formatNumber(state.rows.length)} ${config.label.toLowerCase()} loaded`
    : "No records loaded";
  return state.reviewStateStatus ? `${baseText} · ${state.reviewStateStatus}` : baseText;
}

function renderMapping() {
  const config = OBJECT_CONFIG[state.objectType];
  els.mappingPanel.hidden = !state.headers.length;
  els.mappingGrid.innerHTML = "";

  if (!state.headers.length) return;

  Object.keys(config.fields).forEach((field) => {
    const wrapper = document.createElement("div");
    wrapper.className = "mapping-field";

    const label = document.createElement("label");
    label.textContent = FIELD_LABELS[field] || field;
    label.htmlFor = `map-${field}`;

    const select = document.createElement("select");
    select.id = `map-${field}`;
    select.dataset.field = field;

    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Not mapped";
    select.append(blank);

    state.headers.forEach((header) => {
      const option = document.createElement("option");
      option.value = header;
      option.textContent = header;
      option.selected = state.mapping[field] === header;
      select.append(option);
    });

    wrapper.append(label, select);
    els.mappingGrid.append(wrapper);
  });
}

function renderMetrics() {
  const reviewedCount = state.decisions.size;
  const reviewedPercent = state.groups.length ? Math.round((reviewedCount / state.groups.length) * 100) : 0;
  const metrics = [
    ["records", "Total Records", state.rows.length],
    ["groups", "Match Groups", state.groups.length],
    ["reviewed", "Reviewed", `${reviewedPercent}%`]
  ];

  els.metrics.innerHTML = metrics
    .map(
      ([key, label, value]) => `
        <div class="report-stat" data-summary-metric="${escapeHtml(key)}">
          <span class="report-stat-label">${escapeHtml(label)}</span>
          <strong class="report-stat-value">${typeof value === "number" ? formatNumber(value) : escapeHtml(value)}</strong>
        </div>
      `
    )
    .join("");
}

function renderTrainingExportButton() {
  const labelCount = trainingLabelCount();
  const separatedCount = separatedRecordTrainingCount();
  const hasTrainingSignal = labelCount > 0 || separatedCount > 0;
  const hasWorkspace = Boolean(state.datasetKey);
  els.workspaceExportButton.disabled = !hasWorkspace;
  els.workspaceExportButton.textContent = "Workspace";
  els.workspaceExportButton.setAttribute(
    "aria-label",
    hasWorkspace ? "Export workspace" : "Export workspace"
  );
  els.workspaceExportButton.classList.toggle("is-active", hasWorkspace);
  els.trainingExportButton.disabled = !labelCount;
  els.trainingExportButton.textContent = "Labels";
  els.trainingExportButton.setAttribute(
    "aria-label",
    labelCount ? `Export labels (${formatNumber(labelCount)})` : "Export labels"
  );
  els.trainingExportButton.classList.toggle("is-active", labelCount > 0);
  els.codexTrainingButton.disabled = !hasTrainingSignal;
  els.codexTrainingButton.textContent = "Send to Codex";
  const codexTrainingSummary = [
    labelCount ? `${formatNumber(labelCount)} ${labelCount === 1 ? "label" : "labels"}` : "",
    separatedCount
      ? `${formatNumber(separatedCount)} separated ${separatedCount === 1 ? "record" : "records"}`
      : ""
  ]
    .filter(Boolean)
    .join(" and ");
  els.codexTrainingButton.setAttribute(
    "aria-label",
    codexTrainingSummary ? `Send ${codexTrainingSummary} to Codex` : "Send to Codex"
  );
  els.codexTrainingButton.classList.toggle("is-active", hasTrainingSignal);
  els.workspaceImportButton.disabled = !hasWorkspace;
  els.trainingImportButton.disabled = !state.rows.length;
  updateExportMenuButtonState();
}

function renderDatasetExportButton() {
  const loadedCount = state.rows.length;
  els.datasetExportButton.disabled = !loadedCount;
  els.datasetExportButton.textContent = "Dataset + Scores";
  els.datasetExportButton.setAttribute(
    "aria-label",
    loadedCount ? `Export dataset with scores (${formatNumber(loadedCount)} records)` : "Export dataset with scores"
  );
  els.datasetExportButton.classList.toggle("is-active", loadedCount > 0);
  updateExportMenuButtonState();
}

function updateExportMenuButtonState() {
  const hasExports =
    !els.datasetExportButton.disabled ||
    !els.workspaceExportButton.disabled ||
    !els.exportButton.disabled ||
    !els.trainingExportButton.disabled;
  els.exportMenuButton.classList.toggle("is-active", hasExports);
}

function renderGroups(options = {}) {
  const filtered = filteredGroups();
  els.groupCount.textContent = formatNumber(filtered.length);
  renderGroupSortToggle();

  if (!state.rows.length) {
    els.groupList.classList.remove("is-virtualized");
    groupListRenderCache = null;
    els.groupList.innerHTML = `<div class="empty-row">No records loaded</div>`;
    return;
  }

  if (!filtered.length) {
    els.groupList.classList.remove("is-virtualized");
    groupListRenderCache = null;
    els.groupList.innerHTML = `<div class="empty-row">No matching groups</div>`;
    return;
  }

  if (filtered.length > GROUP_LIST_VIRTUALIZATION_THRESHOLD) {
    renderVirtualGroupList(filtered, options);
    return;
  }

  renderPlainGroupList(filtered);
}

function renderPlainGroupList(groups) {
  const signature = `plain:${groupRenderStateSignature(groups)}`;
  if (groupListRenderCache?.signature === signature) {
    renderGroupSelection();
    return;
  }
  els.groupList.classList.remove("is-virtualized");
  els.groupList.innerHTML = groups.map(renderGroupItem).join("");
  groupListRenderCache = { signature };
}

function renderVirtualGroupList(groups, { preserveScroll = false } = {}) {
  const scrollTop = preserveScroll ? els.groupList.scrollTop : selectedGroupScrollTop(groups, els.groupList.scrollTop);
  const viewportHeight = Math.max(els.groupList.clientHeight || 0, GROUP_ITEM_ESTIMATED_HEIGHT * 4);
  const start = Math.max(0, Math.floor(scrollTop / GROUP_ITEM_ESTIMATED_HEIGHT) - GROUP_LIST_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / GROUP_ITEM_ESTIMATED_HEIGHT) + GROUP_LIST_OVERSCAN * 2;
  const end = Math.min(groups.length, start + visibleCount);
  const offsetTop = start * GROUP_ITEM_ESTIMATED_HEIGHT;
  const totalHeight = groups.length * GROUP_ITEM_ESTIMATED_HEIGHT;
  const visibleGroups = groups.slice(start, end);
  const signature = [
    "virtual",
    start,
    end,
    groups.length,
    totalHeight,
    groupRenderStateSignature(visibleGroups)
  ].join(":");

  if (groupListRenderCache?.signature === signature) {
    els.groupList.scrollTop = scrollTop;
    renderGroupSelection();
    return;
  }

  els.groupList.classList.add("is-virtualized");
  els.groupList.innerHTML = `
    <div class="group-list-spacer" style="height: ${totalHeight}px;">
      <div class="group-list-window" style="transform: translateY(${offsetTop}px);">
        ${visibleGroups.map(renderGroupItem).join("")}
      </div>
    </div>
  `;
  els.groupList.scrollTop = scrollTop;
  groupListRenderCache = { signature };
}

function groupRenderStateSignature(groups) {
  return groups.map((group) => {
    const labelStatus = groupTrainingLabelStatus(group);
    const separatedCount = getSeparatedGroupRecords(group).length;
    const decision = state.decisions.get(group.key) || "";
    return [
      group.key,
      group.score,
      group.minPairScore,
      group.matchedFieldPercent,
      group.records.length,
      labelStatus.status,
      labelStatus.labeledCount,
      separatedCount,
      decision
    ].join(",");
  }).join("|");
}

function selectedGroupScrollTop(groups, fallbackScrollTop) {
  const selectedIndex = groups.findIndex((group) => group.key === state.selectedGroupKey);
  if (selectedIndex < 0) return fallbackScrollTop || 0;

  const selectedTop = selectedIndex * GROUP_ITEM_ESTIMATED_HEIGHT;
  const selectedBottom = selectedTop + GROUP_ITEM_ESTIMATED_HEIGHT;
  const viewportTop = fallbackScrollTop || 0;
  const viewportBottom = viewportTop + (els.groupList.clientHeight || GROUP_ITEM_ESTIMATED_HEIGHT * 4);

  if (selectedTop < viewportTop) return selectedTop;
  if (selectedBottom > viewportBottom) return Math.max(0, selectedBottom - (els.groupList.clientHeight || GROUP_ITEM_ESTIMATED_HEIGHT * 4));
  return viewportTop;
}

function renderGroupSortToggle() {
  const isAscending = state.sortDirection === "asc";
  const label = isAscending
    ? "Sorted ascending. Click to sort descending."
    : "Sorted descending. Click to sort ascending.";
  els.groupSortToggle.classList.toggle("is-ascending", isAscending);
  els.groupSortToggle.setAttribute("aria-pressed", isAscending ? "true" : "false");
  els.groupSortToggle.setAttribute("aria-label", label);
  els.groupSortToggle.setAttribute("title", label);
}

function renderGroupItem(group) {
  const activeRecords = getActiveGroupRecords(group);
  const separatedRecords = getSeparatedGroupRecords(group);
  const decision = state.decisions.get(group.key);
  const labelStatus = groupTrainingLabelStatus(group);
  const groupClasses = [
    "group-item",
    group.key === state.selectedGroupKey ? "is-selected" : "",
    labelStatus.className
  ]
    .filter(Boolean)
    .join(" ");
  const secondaryTitle = activeRecords.slice(1).map(displayName).join(" / ") || `${formatNumber(activeRecords.length)} active records`;
  const reason = `${group.matchedFieldPercent}% fields matched · min pair ${group.minPairScore} · ${
    separatedRecords.length ? `${separatedRecords.length} separated` : group.reasons[0] || "Potential duplicate"
  }`;

  return `
    <article
      class="${groupClasses}"
      data-group-key="${escapeHtml(group.key)}"
      data-label-status="${escapeHtml(labelStatus.status)}"
      title="${escapeHtml(labelStatus.label)}"
    >
      <button class="group-item-main" type="button" data-group-open-key="${escapeHtml(group.key)}">
        <div class="group-item-top">
          <div class="group-title">
            <strong>${escapeHtml(displayName(activeRecords[0] || group.records[0]))}</strong>
            <span>${escapeHtml(secondaryTitle)}</span>
          </div>
          <span class="group-status-cluster">
            ${renderGroupLabelIndicator(labelStatus)}
            <span class="match-pill ${group.type}">${group.score}</span>
          </span>
        </div>
        <div class="group-item-bottom">
          <span class="group-reason">${escapeHtml(reason)}</span>
          ${decision ? `<span class="decision-pill ${decision}">${decisionLabel(decision)}</span>` : `<span class="match-pill ${group.type}">${group.type}</span>`}
        </div>
      </button>
    </article>
  `;
}

function groupTrainingLabelStatus(group) {
  const pairs = getActiveGroupRecordPairs(group);
  const totalCount = pairs.length;
  const labeledCount = pairs.filter((pair) => state.trainingLabels.has(pair.key)).length;

  if (!totalCount || !labeledCount) {
    return {
      status: "unlabeled",
      className: "",
      labeledCount,
      totalCount,
      label: "No calibration labels"
    };
  }

  if (labeledCount === totalCount) {
    return {
      status: "full",
      className: "is-label-full",
      labeledCount,
      totalCount,
      label: `Fully labeled: ${formatNumber(labeledCount)} of ${formatNumber(totalCount)} pairs`
    };
  }

  return {
    status: "partial",
    className: "is-label-partial",
    labeledCount,
    totalCount,
    label: `Partially labeled: ${formatNumber(labeledCount)} of ${formatNumber(totalCount)} pairs`
  };
}

function renderGroupLabelIndicator(labelStatus) {
  if (labelStatus.status === "unlabeled") return "";
  return `<span class="label-status-indicator ${labelStatus.status}" aria-label="${escapeHtml(labelStatus.label)}"></span>`;
}

function selectGroup(groupKey) {
  if (!groupKey || groupKey === state.selectedGroupKey) return;
  if (mergeReviewSession.active && !mergeReviewSession.queueGroupKeys.includes(groupKey)) return;
  state.selectedGroupKey = groupKey;
  if (els.groupList.querySelector(`[data-group-key="${cssEscape(groupKey)}"]`)) {
    renderGroupSelection({ scrollSelectedIntoView: true });
  } else {
    renderGroups();
  }
  renderDetail();
}

function renderGroupSelection({ scrollSelectedIntoView = false } = {}) {
  els.groupList.querySelectorAll(".group-item").forEach((item) => {
    const selected = item.dataset.groupKey === state.selectedGroupKey;
    item.classList.toggle("is-selected", selected);
    if (selected && scrollSelectedIntoView) item.scrollIntoView({ block: "nearest" });
  });
}

function renderFilterBuilder() {
  if (!els.groupFilterBuilder) return;

  const recordFiltersDisabled = !canUseRecordFieldFilters();
  const displayFilters = state.filters.length ? state.filters : [createGroupFilterDraft()];
  const hasMultipleFilters = displayFilters.length > 1;
  const filterLogicError = recordFiltersDisabled ? "" : groupFilterLogicError();
  const activeEntries = recordFiltersDisabled ? [] : activeGroupFilterEntries();
  els.groupFilterBuilder.classList.toggle("is-disabled", recordFiltersDisabled);
  els.groupFilterBuilder.setAttribute("aria-disabled", recordFiltersDisabled ? "true" : "false");
  els.groupFilterBuilder.innerHTML = `
    <div class="filter-builder-title">
      <strong>Filters</strong>
      <button class="icon-button filter-icon-button" type="button" data-filter-add aria-label="Add filter" title="Add filter" ${recordFiltersDisabled ? "disabled" : ""}>
        ${filterPlusIcon()}
      </button>
    </div>
    ${hasMultipleFilters ? renderFilterLogicControl(activeEntries, recordFiltersDisabled) : ""}
    <div class="filter-list">${displayFilters.map((filter, index) => {
      return renderFilterRow(filter, index, recordFiltersDisabled, {
        showIndex: hasMultipleFilters,
        showRemove: filter.id !== DRAFT_GROUP_FILTER_ID
      });
    }).join("")}</div>
    ${filterLogicError ? `<p class="filter-error">${escapeHtml(filterLogicError)}</p>` : ""}
  `;
}

function renderLabelStatusFilterHost() {
  if (!els.labelStatusFilter) return;
  els.labelStatusFilter.innerHTML = renderLabelStatusFilter(!canUseMatchFilters());
}

function renderLabelStatusFilter(disabled = false) {
  const disabledAttribute = disabled ? "disabled" : "";
  const applyDisabled = disabled || !labelStatusFiltersChanged() ? "disabled" : "";
  return `
    <fieldset class="label-status-filter" ${disabled ? "disabled" : ""}>
      <legend>Label status</legend>
      ${GROUP_LABEL_STATUS_FILTERS
        .map(([value, label]) => `
          <label class="label-status-option">
            <input
              type="checkbox"
              value="${escapeHtml(value)}"
              data-label-status-filter
              ${state.pendingLabelStatusFilters.has(value) ? "checked" : ""}
            />
            <span>${escapeHtml(label)}</span>
          </label>
        `)
        .join("")}
      <div class="label-status-filter-footer">
        <button class="mini-button" type="button" data-label-status-apply ${disabledAttribute || applyDisabled}>Apply</button>
      </div>
    </fieldset>
  `;
}

function renderFilterLogicControl(activeEntries, disabled = false) {
  const defaultLogic = defaultGroupFilterLogic(activeEntries);
  const mode = groupFilterLogicMode();
  const customValue = state.filterLogic || defaultLogic;
  const disabledAttribute = disabled ? "disabled" : "";
  return `
    <div class="filter-logic-control">
      <span>Include records matching</span>
      <div class="filter-logic-row">
        <label class="visually-hidden" for="filterLogicMode">Filter logic</label>
        <select id="filterLogicMode" class="filter-logic-mode-select" ${disabledAttribute}>
          <option value="and" ${mode === "and" ? "selected" : ""}>All filters (AND)</option>
          <option value="custom" ${mode === "custom" ? "selected" : ""}>Custom logic</option>
        </select>
        ${mode === "custom"
          ? `<input
              class="filter-logic-input"
              type="text"
              value="${escapeHtml(customValue)}"
              placeholder="${escapeHtml(defaultLogic || "1 AND 2")}"
              spellcheck="false"
              autocomplete="off"
              aria-label="Custom filter logic"
              ${disabledAttribute}
            />`
          : ""}
      </div>
    </div>
  `;
}

function renderFilterRow(filter, index, disabled = false, { showIndex = true, showRemove = true } = {}) {
  const normalized = normalizeGroupFilter(filter);
  const meta = groupFilterMeta(normalized.field);
  const disabledAttribute = disabled ? "disabled" : "";
  const isDraft = normalized.id === DRAFT_GROUP_FILTER_ID;
  const rowClasses = ["filter-row"];
  if (!showIndex) rowClasses.push("is-single");
  if (isDraft) rowClasses.push("is-draft");
  return `
    <div class="${rowClasses.join(" ")}" data-filter-id="${escapeHtml(normalized.id)}">
      ${showIndex ? `<span class="filter-index">${index + 1}</span>` : ""}
      <div class="filter-row-controls">
        <label class="visually-hidden" for="filter-field-${escapeHtml(normalized.id)}">Filter field</label>
        <select id="filter-field-${escapeHtml(normalized.id)}" class="filter-field-select" data-filter-control="field" ${disabledAttribute}>
          ${renderFilterFieldOptions(normalized.field)}
        </select>
        <label class="visually-hidden" for="filter-operator-${escapeHtml(normalized.id)}">Filter operator</label>
        <select id="filter-operator-${escapeHtml(normalized.id)}" class="filter-operator-select" data-filter-control="operator" ${disabledAttribute}>
          ${renderFilterOperatorOptions(meta.type, normalized.operator)}
        </select>
        ${renderFilterValueControl(normalized, meta, disabled)}
      </div>
      ${showRemove ? `
        <button class="icon-button filter-icon-button" type="button" data-filter-remove aria-label="Remove filter ${index + 1}" title="Remove filter" ${disabledAttribute}>
          ${filterTrashIcon()}
        </button>
      ` : ""}
    </div>
  `;
}

function renderFilterFieldOptions(selectedField) {
  return filterFieldOptions()
    .map((option) => {
      return `<option value="${escapeHtml(option.value)}" ${option.value === selectedField ? "selected" : ""}>${escapeHtml(option.label)}</option>`;
    })
    .join("");
}

function renderFilterOperatorOptions(type, selectedOperator) {
  return groupFilterOperatorsForType(type)
    .map(([value, label]) => {
      return `<option value="${escapeHtml(value)}" ${value === selectedOperator ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function renderFilterValueControl(filter, meta, disabled = false) {
  const disabledAttribute = disabled ? "disabled" : "";
  if (GROUP_FILTER_VALUELESS_OPERATORS.has(filter.operator)) {
    return '<span class="filter-value-placeholder" aria-hidden="true"></span>';
  }

  if (meta.type === "enum") {
    const values = meta.values || [];
    return `
      <label class="visually-hidden" for="filter-value-${escapeHtml(filter.id)}">Filter value</label>
      <select id="filter-value-${escapeHtml(filter.id)}" class="filter-value-control" data-filter-control="value" ${disabledAttribute}>
        ${values
          .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === filter.value ? "selected" : ""}>${escapeHtml(label)}</option>`)
          .join("")}
      </select>
    `;
  }

  if (meta.type === "date" && filter.operator === "relative") {
    const selectedValue = filter.value || "TODAY";
    return `
      <label class="visually-hidden" for="filter-value-${escapeHtml(filter.id)}">Relative date</label>
      <select id="filter-value-${escapeHtml(filter.id)}" class="filter-value-control" data-filter-control="value" ${disabledAttribute}>
        ${GROUP_FILTER_RELATIVE_DATES
          .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(label)}</option>`)
          .join("")}
      </select>
    `;
  }

  const inputType = meta.type === "number" ? "number" : meta.type === "date" ? "date" : "text";
  const value2 = filter.operator === "between"
    ? `
      <label class="visually-hidden" for="filter-value2-${escapeHtml(filter.id)}">Second filter value</label>
      <input
        id="filter-value2-${escapeHtml(filter.id)}"
        class="filter-value-control"
        data-filter-control="value2"
        type="${inputType}"
        value="${escapeHtml(filter.value2 || "")}"
        placeholder="Max"
        ${disabledAttribute}
      />
    `
    : "";
  return `
    <label class="visually-hidden" for="filter-value-${escapeHtml(filter.id)}">Filter value</label>
    <input
      id="filter-value-${escapeHtml(filter.id)}"
      class="filter-value-control"
      data-filter-control="value"
      type="${inputType}"
      value="${escapeHtml(filter.value || "")}"
      placeholder="${filter.operator === "between" ? "Min" : "Value"}"
      ${disabledAttribute}
    />
    ${value2}
  `;
}

function handleGroupFilterClick(event) {
  if (!canUseRecordFieldFilters()) return;
  if (event.target.closest?.("[data-filter-add]")) {
    const filter = createGroupFilter();
    if (!filter) return;
    if (!state.filters.length) {
      const secondFilter = createGroupFilter();
      state.filters.push(filter);
      if (secondFilter) state.filters.push(secondFilter);
    } else {
      state.filters.push(filter);
    }
    visibleGroupsCache = null;
    renderFilterBuilder();
    return;
  }

  const removeButton = event.target.closest?.("[data-filter-remove]");
  if (!removeButton) return;

  const filterId = removeButton.closest("[data-filter-id]")?.dataset.filterId;
  state.filters = state.filters.filter((filter) => filter.id !== filterId);
  if (!state.filters.length) {
    state.filterLogic = "";
    state.filterLogicMode = "and";
  }
  visibleGroupsCache = null;
  renderFilterBuilder();
}

function handleLabelStatusFilterClick(event) {
  if (!event.target.closest?.("[data-label-status-apply]") || !canUseMatchFilters()) return;
  applyLabelStatusFilters();
}

function handleLabelStatusFilterChange(event) {
  const labelStatusControl = event.target.closest?.("[data-label-status-filter]");
  if (!labelStatusControl || !canUseMatchFilters()) return;
  updatePendingLabelStatusFilter(labelStatusControl);
}

function handleGroupFilterChange(event) {
  if (!canUseRecordFieldFilters()) return;
  if (event.target.classList?.contains("filter-logic-mode-select")) {
    state.filterLogicMode = event.target.value === "custom" ? "custom" : "and";
    visibleGroupsCache = null;
    renderFilterBuilder();
    return;
  }

  const control = event.target.closest?.("[data-filter-control]");
  if (!control) return;
  const controlType = control.dataset.filterControl;
  updateGroupFilterFromControl(control, { rerender: controlType === "field" || controlType === "operator" });
}

function handleGroupFilterInput(event) {
  if (!canUseRecordFieldFilters()) return;
  if (event.target.classList?.contains("filter-logic-input")) {
    state.filterLogic = event.target.value.trim();
    visibleGroupsCache = null;
    return;
  }

  const control = event.target.closest?.("[data-filter-control]");
  if (!control) return;
  updateGroupFilterFromControl(control, { rerender: false });
}

function updatePendingLabelStatusFilter(control) {
  const value = control.value;
  if (!GROUP_LABEL_STATUS_FILTER_VALUES.has(value)) return;
  if (control.checked) {
    state.pendingLabelStatusFilters.add(value);
  } else {
    state.pendingLabelStatusFilters.delete(value);
  }
  updateLabelStatusApplyButton();
}

function updateLabelStatusApplyButton() {
  const applyButton = els.labelStatusFilter?.querySelector("[data-label-status-apply]");
  if (!applyButton) return;
  applyButton.disabled = !canUseMatchFilters() || !labelStatusFiltersChanged();
}

function applyLabelStatusFilters() {
  if (!canUseMatchFilters()) return;
  state.labelStatusFilters = new Set([...state.pendingLabelStatusFilters]);
  visibleGroupsCache = null;
  ensureSelectedGroupVisible();
  renderGroups();
  renderDetail();
  renderLabelStatusFilterHost();
}

function labelStatusFiltersChanged() {
  return !setsEqual(state.labelStatusFilters, state.pendingLabelStatusFilters);
}

function setsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function updateGroupFilterFromControl(control, { rerender = false } = {}) {
  const filter = resolveEditableGroupFilter(control);
  if (!filter) return;

  const controlType = control.dataset.filterControl;
  if (controlType === "field") {
    filter.field = control.value;
    filter.operator = defaultGroupFilterOperator(groupFilterType(filter.field));
    filter.value = defaultGroupFilterValue(filter.field, filter.operator);
    filter.value2 = "";
    rerender = true;
  } else if (controlType === "operator") {
    filter.operator = control.value;
    filter.value = defaultGroupFilterValue(filter.field, filter.operator);
    filter.value2 = "";
    rerender = true;
  } else if (controlType === "value") {
    filter.value = control.value;
  } else if (controlType === "value2") {
    filter.value2 = control.value;
  }

  visibleGroupsCache = null;
  if (rerender) renderFilterBuilder();
}

function resolveEditableGroupFilter(control) {
  const row = control.closest("[data-filter-id]");
  const filterId = row?.dataset.filterId;
  let filter = state.filters.find((item) => item.id === filterId);
  if (filter || filterId !== DRAFT_GROUP_FILTER_ID) return filter || null;

  filter = createGroupFilter();
  if (!filter) return null;
  state.filters.push(filter);
  row.dataset.filterId = filter.id;
  return filter;
}

function createGroupFilter() {
  const field = defaultGroupFilterField();
  if (!field) return null;
  const operator = defaultGroupFilterOperator(groupFilterType(field));
  return {
    id: String(nextGroupFilterId++),
    field,
    operator,
    value: defaultGroupFilterValue(field, operator),
    value2: ""
  };
}

function createGroupFilterDraft() {
  const field = defaultGroupFilterField();
  const type = field ? groupFilterType(field) : "text";
  const operator = defaultGroupFilterOperator(type);
  return {
    id: DRAFT_GROUP_FILTER_ID,
    field,
    operator,
    value: "",
    value2: ""
  };
}

function normalizeGroupFilter(filter) {
  const field = filter.field || defaultGroupFilterField();
  const operator = groupFilterOperatorIsValid(field, filter.operator)
    ? filter.operator
    : defaultGroupFilterOperator(groupFilterType(field));
  return {
    id: String(filter.id || nextGroupFilterId++),
    field,
    operator,
    value: String(filter.value ?? defaultGroupFilterValue(field, operator)),
    value2: String(filter.value2 ?? "")
  };
}

function pruneGroupFiltersForCurrentFields() {
  if (!state.filters.length) return;

  const validFields = new Set(filterFieldOptions().map((option) => option.value));
  const originalCount = state.filters.length;
  state.filters = state.filters
    .filter((filter) => validFields.has(filter.field))
    .map((filter) => normalizeGroupFilter(filter));
  if (state.filters.length !== originalCount && !state.filters.length) {
    state.filterLogic = "";
    state.filterLogicMode = "and";
  }
}

function filterFieldOptions() {
  const mappedFields = Object.keys(OBJECT_CONFIG[state.objectType].fields)
    .filter(fieldAvailableForFiltering)
    .map((field) => ({
      value: field,
      label: FIELD_LABELS[field] || field,
      type: GROUP_FILTER_FIELD_TYPES[field] || "text",
      scope: "record"
    }));

  return [...mappedFields, ...rawHeaderFilterOptions()];
}

function rawHeaderFilterOptions() {
  const mappedHeaders = new Set(Object.values(state.mapping || {}).filter(Boolean));
  return state.headers
    .filter((header) => !mappedHeaders.has(header))
    .map((header) => ({
      value: rawHeaderFilterField(header),
      label: header,
      type: inferRawHeaderFilterType(header),
      scope: "record",
      header
    }));
}

function fieldAvailableForFiltering(field) {
  if (field === "fullName") return Boolean(state.mapping.fullName || state.mapping.firstName || state.mapping.lastName);
  return Boolean(state.mapping[field]);
}

function defaultGroupFilterField() {
  return filterFieldOptions()[0]?.value || "";
}

function groupFilterMeta(field) {
  return filterFieldOptions().find((option) => option.value === field) || filterFieldOptions()[0] || {
    value: "",
    label: "Record field",
    type: "text",
    scope: "record"
  };
}

function canUseMatchFilters() {
  return Boolean(state.rows.length);
}

function canUseRecordFieldFilters() {
  return Boolean(canUseMatchFilters() && filterFieldOptions().length);
}

function groupFilterType(field) {
  return groupFilterMeta(field).type || "text";
}

function groupFilterOperatorsForType(type) {
  return GROUP_FILTER_OPERATORS[type] || GROUP_FILTER_OPERATORS.text;
}

function defaultGroupFilterOperator(type) {
  return groupFilterOperatorsForType(type)[0][0];
}

function groupFilterOperatorIsValid(field, operator) {
  return groupFilterOperatorsForType(groupFilterType(field)).some(([value]) => value === operator);
}

function defaultGroupFilterValue(field, operator) {
  const meta = groupFilterMeta(field);
  if (GROUP_FILTER_VALUELESS_OPERATORS.has(operator)) return "";
  if (meta.type === "enum") return meta.values?.[0]?.[0] || "";
  if (meta.type === "date" && operator === "relative") return "TODAY";
  return "";
}

function rawHeaderFilterField(header) {
  return `raw:${encodeURIComponent(header)}`;
}

function rawHeaderFromFilterField(field) {
  return decodeURIComponent(String(field || "").slice(4));
}

function inferRawHeaderFilterType(header) {
  const normalizedHeader = normalizeHeader(header);
  if (/\b(date|time|created|updated|modified)\b/.test(normalizedHeader)) return "date";

  const values = state.rows
    .slice(0, 80)
    .map((row) => String(getValue(row, header) || "").trim())
    .filter(Boolean);
  if (!values.length) return "text";

  const dateCount = values.filter(isLikelyDateFilterValue).length;
  if (dateCount >= Math.max(3, values.length * 0.7)) return "date";

  const numberCount = values.filter((value) => Number.isFinite(parseFilterNumber(value))).length;
  return numberCount >= Math.max(3, values.length * 0.8) ? "number" : "text";
}

function isLikelyDateFilterValue(value) {
  const text = String(value || "").trim();
  if (!text || !/[/-]|\d{4}/.test(text)) return false;
  return Number.isFinite(Date.parse(text));
}

function groupFiltersSignature() {
  return JSON.stringify({
    filters: state.filters.map((filter) => normalizeGroupFilter(filter)),
    logicMode: groupFilterLogicMode(),
    logic: state.filterLogic,
    labelStatus: [...state.labelStatusFilters].sort()
  });
}

function activeGroupFilterEntries() {
  return state.filters
    .map((filter, index) => ({
      filter: normalizeGroupFilter(filter),
      number: index + 1
    }))
    .filter(({ filter }) => groupFilterIsComplete(filter))
    .map((entry) => ({
      ...entry,
      meta: groupFilterMeta(entry.filter.field)
    }));
}

function groupFilterIsComplete(filter) {
  if (GROUP_FILTER_VALUELESS_OPERATORS.has(filter.operator)) return true;
  if (groupFilterMeta(filter.field).type === "enum") return Boolean(filter.value);
  if (filter.operator === "between") return String(filter.value || "").trim() && String(filter.value2 || "").trim();
  return Boolean(String(filter.value || "").trim());
}

function defaultGroupFilterLogic(entries = activeGroupFilterEntries()) {
  return entries.map(({ number }) => number).join(" AND ");
}

function groupFilterLogicError() {
  if (groupFilterLogicMode() !== "custom") return "";
  return compileGroupFilterLogic(filterLogicExpressionForMode(activeGroupFilterEntries()), state.filters.length).error;
}

function groupFilterLogicMode() {
  return state.filterLogicMode === "custom" ? "custom" : "and";
}

function filterLogicExpressionForMode(entries = activeGroupFilterEntries()) {
  const mode = groupFilterLogicMode();
  if (mode === "custom") return state.filterLogic || defaultGroupFilterLogic(entries);
  return defaultGroupFilterLogic(entries);
}

function activeLabelStatusFilters() {
  const selected = new Set([...state.labelStatusFilters].filter((value) => GROUP_LABEL_STATUS_FILTER_VALUES.has(value)));
  return selected.size && selected.size < GROUP_LABEL_STATUS_FILTERS.length ? selected : new Set();
}

function compileGroupFilterLogic(logicText, filterCount, defaultNumbers = []) {
  const expression = String(logicText || "").trim() || defaultNumbers.join(" AND ");
  if (!expression) return { error: "", evaluate: () => true };

  const tokens = tokenizeGroupFilterLogic(expression);
  if (tokens.error) return { error: tokens.error, evaluate: () => false };

  let index = 0;
  const parseExpression = () => {
    let node = parseTerm();
    while (!node.error && tokens[index]?.type === "OR") {
      index += 1;
      const right = parseTerm();
      node = right.error ? right : { type: "OR", left: node, right };
    }
    return node;
  };
  const parseTerm = () => {
    let node = parseFactor();
    while (!node.error && tokens[index]?.type === "AND") {
      index += 1;
      const right = parseFactor();
      node = right.error ? right : { type: "AND", left: node, right };
    }
    return node;
  };
  const parseFactor = () => {
    const token = tokens[index];
    if (!token) return { error: "Filter logic is incomplete." };
    if (token.type === "NUMBER") {
      index += 1;
      if (token.value < 1 || token.value > filterCount) return { error: `Filter ${token.value} does not exist.` };
      return { type: "FILTER", value: token.value };
    }
    if (token.type === "(") {
      index += 1;
      const node = parseExpression();
      if (node.error) return node;
      if (tokens[index]?.type !== ")") return { error: "Filter logic is missing a closing parenthesis." };
      index += 1;
      return node;
    }
    return { error: "Filter logic needs filter numbers, AND, OR, and parentheses." };
  };

  const ast = parseExpression();
  if (ast.error) return { error: ast.error, evaluate: () => false };
  if (index < tokens.length) {
    return { error: "Filter logic has extra text after the expression.", evaluate: () => false };
  }

  return {
    error: "",
    evaluate: (lookup) => evaluateGroupFilterAst(ast, lookup)
  };
}

function tokenizeGroupFilterLogic(expression) {
  const tokens = [];
  let position = 0;
  while (position < expression.length) {
    const remainder = expression.slice(position);
    const whitespace = /^\s+/.exec(remainder);
    if (whitespace) {
      position += whitespace[0].length;
      continue;
    }

    const match = /^(AND|OR|\d+|\(|\))/i.exec(remainder);
    if (!match) return { error: "Filter logic needs filter numbers, AND, OR, and parentheses." };

    const raw = match[1].toUpperCase();
    if (raw === "AND" || raw === "OR" || raw === "(" || raw === ")") {
      tokens.push({ type: raw });
    } else {
      tokens.push({ type: "NUMBER", value: Number(raw) });
    }
    position += match[0].length;
  }
  return tokens;
}

function evaluateGroupFilterAst(node, lookup) {
  if (node.type === "FILTER") return Boolean(lookup(node.value));
  if (node.type === "AND") return evaluateGroupFilterAst(node.left, lookup) && evaluateGroupFilterAst(node.right, lookup);
  if (node.type === "OR") return evaluateGroupFilterAst(node.left, lookup) || evaluateGroupFilterAst(node.right, lookup);
  return false;
}

function groupMatchesFilters(group, activeEntries, logic) {
  if (!activeEntries.length) return true;
  return group.records.some((record) => {
    const results = new Array(state.filters.length + 1);
    for (const entry of activeEntries) {
      results[entry.number] = groupFilterMatchesRecord(group, record, entry.filter, entry.meta);
    }
    return logic.evaluate((number) => Boolean(results[number]));
  });
}

function groupFilterMatchesRecord(group, record, filter, meta = null) {
  const resolvedMeta = meta || groupFilterMeta(filter.field);
  const rawValue = groupFilterRawValue(group, record, filter.field, resolvedMeta);
  return filterValueMatches(rawValue, filter, resolvedMeta);
}

function groupFilterRawValue(group, record, field, meta) {
  if (String(field || "").startsWith("raw:")) return getValue(record, rawHeaderFromFilterField(field));
  if (meta.scope === "record") return getDisplayFieldValue(record, field);
  return "";
}

function filterValueMatches(rawValue, filter, meta) {
  const text = String(rawValue ?? "").trim();
  const operator = filter.operator;
  if (operator === "blank") return !text;
  if (operator === "not_blank") return Boolean(text);

  if (meta.type === "number") return numberFilterMatches(text, filter);
  if (meta.type === "date") return dateFilterMatches(text, filter);
  return textFilterMatches(text, filter, meta.type);
}

function textFilterMatches(text, filter) {
  const left = normalizeText(text);
  const right = normalizeText(filter.value);
  if (!right && filter.operator !== "not_equals") return false;

  if (filter.operator === "contains") return left.includes(right);
  if (filter.operator === "not_contains") return !left.includes(right);
  if (filter.operator === "equals") return left === right;
  if (filter.operator === "not_equals") return left !== right;
  if (filter.operator === "starts_with") return left.startsWith(right);
  if (filter.operator === "ends_with") return left.endsWith(right);
  return false;
}

function numberFilterMatches(text, filter) {
  const left = parseFilterNumber(text);
  const right = parseFilterNumber(filter.value);
  const right2 = parseFilterNumber(filter.value2);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;

  if (filter.operator === "equals") return left === right;
  if (filter.operator === "not_equals") return left !== right;
  if (filter.operator === "greater_or_equal") return left >= right;
  if (filter.operator === "less_or_equal") return left <= right;
  if (filter.operator === "greater_than") return left > right;
  if (filter.operator === "less_than") return left < right;
  if (filter.operator === "between") {
    if (!Number.isFinite(right2)) return false;
    return left >= Math.min(right, right2) && left <= Math.max(right, right2);
  }
  return false;
}

function parseFilterNumber(value) {
  const text = String(value ?? "").replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (!text) return NaN;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function dateFilterMatches(text, filter) {
  const left = parseFilterDate(text);
  if (!Number.isFinite(left)) return false;

  if (filter.operator === "relative") {
    const range = salesforceRelativeDateRange(filter.value || "TODAY");
    return range ? left >= range.start && left <= range.end : false;
  }

  const right = parseFilterDate(filter.value);
  if (!Number.isFinite(right)) return false;
  if (filter.operator === "equals") return left === right;
  if (filter.operator === "before") return left < right;
  if (filter.operator === "after") return left > right;
  if (filter.operator === "on_or_before") return left <= right;
  if (filter.operator === "on_or_after") return left >= right;
  return false;
}

function parseFilterDate(value) {
  const text = String(value || "").trim();
  if (!text) return NaN;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    return startOfFilterDay(new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return NaN;
  return startOfFilterDay(new Date(parsed));
}

function salesforceRelativeDateRange(literal) {
  const value = String(literal || "").trim().toUpperCase();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (value === "TODAY") return dayRange(today);
  if (value === "YESTERDAY") return dayRange(addFilterDays(today, -1));
  if (value === "TOMORROW") return dayRange(addFilterDays(today, 1));

  const lastDays = /^LAST_N_DAYS:(\d+)$/.exec(value);
  if (lastDays) {
    return {
      start: startOfFilterDay(addFilterDays(today, -Number(lastDays[1]))),
      end: endOfFilterDay(today)
    };
  }

  const nextDays = /^NEXT_N_DAYS:(\d+)$/.exec(value);
  if (nextDays) {
    return {
      start: startOfFilterDay(today),
      end: endOfFilterDay(addFilterDays(today, Number(nextDays[1])))
    };
  }

  if (value.endsWith("_WEEK")) return relativePeriodRange(today, value, startOfFilterWeek, addFilterWeeks);
  if (value.endsWith("_MONTH")) return relativePeriodRange(today, value, startOfFilterMonth, addFilterMonths);
  if (value.endsWith("_QUARTER")) return relativePeriodRange(today, value, startOfFilterQuarter, addFilterQuarters);
  if (value.endsWith("_YEAR")) return relativePeriodRange(today, value, startOfFilterYear, addFilterYears);
  return null;
}

function relativePeriodRange(today, literal, startFn, addFn) {
  const offset = literal.startsWith("LAST_") ? -1 : literal.startsWith("NEXT_") ? 1 : 0;
  const start = addFn(startFn(today), offset);
  const nextStart = addFn(start, 1);
  return {
    start: startOfFilterDay(start),
    end: endOfFilterDay(addFilterDays(nextStart, -1))
  };
}

function dayRange(date) {
  return {
    start: startOfFilterDay(date),
    end: endOfFilterDay(date)
  };
}

function startOfFilterDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function endOfFilterDay(date) {
  return startOfFilterDay(date) + 24 * 60 * 60 * 1000 - 1;
}

function addFilterDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addFilterWeeks(date, weeks) {
  return addFilterDays(date, weeks * 7);
}

function addFilterMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function addFilterQuarters(date, quarters) {
  return new Date(date.getFullYear(), date.getMonth() + quarters * 3, 1);
}

function addFilterYears(date, years) {
  return new Date(date.getFullYear() + years, 0, 1);
}

function startOfFilterWeek(date) {
  return addFilterDays(date, -date.getDay());
}

function startOfFilterMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfFilterQuarter(date) {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
}

function startOfFilterYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

function filterPlusIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>';
}

function filterTrashIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 14h10l1-14" /><path d="M9 7V4h6v3" /></svg>';
}

function navigateGroup(direction) {
  const groups = filteredGroups();
  if (!groups.length) return;

  const currentIndex = groups.findIndex((group) => group.key === state.selectedGroupKey);
  const fallbackIndex = direction > 0 ? -1 : groups.length;
  const nextIndex = Math.max(0, Math.min(groups.length - 1, (currentIndex === -1 ? fallbackIndex : currentIndex) + direction));
  selectGroup(groups[nextIndex].key);
}

function canNavigateGroup(direction) {
  const groups = filteredGroups();
  if (!groups.length) return false;

  const currentIndex = groups.findIndex((group) => group.key === state.selectedGroupKey);
  if (currentIndex === -1) return true;
  return direction > 0 ? currentIndex < groups.length - 1 : currentIndex > 0;
}

function pruneFieldResolutions() {
  const groupKeys = new Set(state.groups.map((group) => group.key));
  [...state.fieldResolutions.keys()].forEach((groupKey) => {
    if (!groupKeys.has(groupKey)) state.fieldResolutions.delete(groupKey);
  });
}

function pruneSeparatedRecords() {
  const groupsByKey = new Map(state.groups.map((group) => [group.key, group]));
  [...state.separatedRecords.entries()].forEach(([groupKey, recordKeys]) => {
    const group = groupsByKey.get(groupKey);
    if (!group) {
      state.separatedRecords.delete(groupKey);
      return;
    }
    const validRecordKeys = new Set(group.records.map(recordKey));
    [...recordKeys].forEach((key) => {
      if (!validRecordKeys.has(key)) recordKeys.delete(key);
    });
    if (!recordKeys.size) state.separatedRecords.delete(groupKey);
  });
}

function filteredGroups() {
  if (
    visibleGroupsCache &&
    visibleGroupsCache.groups === state.groups &&
    visibleGroupsCache.filterSignature === groupFiltersSignature() &&
    visibleGroupsCache.sortDirection === state.sortDirection &&
    visibleGroupsCache.maxThreshold === state.maxThreshold &&
    visibleGroupsCache.trainingLabelCount === state.trainingLabels.size &&
    visibleGroupsCache.decisionCount === state.decisions.size &&
    visibleGroupsCache.objectType === state.objectType &&
    visibleGroupsCache.mapping === state.mapping
  ) {
    return visibleGroupsCache.value;
  }

  const value = getFilteredGroups();
  visibleGroupsCache = {
    groups: state.groups,
    filterSignature: groupFiltersSignature(),
    sortDirection: state.sortDirection,
    maxThreshold: state.maxThreshold,
    trainingLabelCount: state.trainingLabels.size,
    decisionCount: state.decisions.size,
    objectType: state.objectType,
    mapping: state.mapping,
    value
  };
  return value;
}

function getFilteredGroups() {
  const activeEntries = activeGroupFilterEntries();
  const filterLogic = compileGroupFilterLogic(filterLogicExpressionForMode(activeEntries), state.filters.length);
  const labelStatusFilters = activeLabelStatusFilters();
  const filtered = state.groups.filter((group) => {
    if (group.score > state.maxThreshold) return false;
    if (labelStatusFilters.size && !labelStatusFilters.has(groupTrainingLabelStatus(group).status)) return false;
    if (!activeEntries.length) return true;
    if (filterLogic.error) return false;
    return groupMatchesFilters(group, activeEntries, filterLogic);
  });
  return state.sortDirection === "asc" ? [...filtered].reverse() : filtered;
}

function findGroupByKey(groupKey) {
  if (!groupKey) return null;
  if (!groupLookupCache || groupLookupCache.groups !== state.groups) {
    groupLookupCache = {
      groups: state.groups,
      value: new Map(state.groups.map((group) => [group.key, group]))
    };
  }
  return groupLookupCache.value.get(groupKey) || null;
}

function renderDetail() {
  if (state.objectType === "account" && state.reviewMode === "merge") {
    state.reviewMode = "evaluate";
  }
  updateReviewModeControls();

  const group = findGroupByKey(state.selectedGroupKey);
  const hasGroup = Boolean(group);
  const activeRecords = group ? getActiveGroupRecords(group) : [];
  const separatedRecords = group ? getSeparatedGroupRecords(group) : [];
  const currentDecision = group ? state.decisions.get(group.key) || "" : "";
  const detailSignature = detailRenderSignature({
    group,
    activeRecords,
    separatedRecords,
    currentDecision
  });
  updateNavigationControls();
  els.duplicateButton.disabled = !hasGroup || activeRecords.length < 2;
  els.notDuplicateButton.disabled = !hasGroup;
  const exportableCount = duplicateDecisionCount();
  els.exportButton.disabled = !exportableCount;
  els.duplicateButton.classList.toggle("is-active", currentDecision === "duplicate");
  els.notDuplicateButton.classList.toggle("is-active", currentDecision === "not-duplicate");
  els.duplicateButton.setAttribute("aria-pressed", currentDecision === "duplicate" ? "true" : "false");
  els.notDuplicateButton.setAttribute("aria-pressed", currentDecision === "not-duplicate" ? "true" : "false");
  els.exportButton.textContent = "Decisions";
  els.exportButton.setAttribute(
    "aria-label",
    exportableCount ? `Export decisions (${formatNumber(exportableCount)})` : "Export decisions"
  );
  els.exportButton.classList.toggle("is-active", exportableCount > 0);
  updateExportMenuButtonState();
  els.decisionStatus.textContent = hasGroup
    ? currentDecision
      ? `Duplicate decision: ${decisionLabel(currentDecision)}`
      : "Duplicate decision not set"
    : "No judgment selected";
  els.decisionStatus.className = `decision-status ${currentDecision}`;

  if (detailRenderCache === detailSignature) return;
  detailRenderCache = detailSignature;

  if (state.isLoadingFile) {
    els.detailTitle.textContent = "Loading Dataset";
    els.detailSurface.innerHTML = `
      <div class="empty-state loading-state">
        <div class="loading-spinner" aria-hidden="true"></div>
        <strong>Loading ${escapeHtml(state.loadingFileName || "dataset")}</strong>
        <span>Parsing records and calculating match groups.</span>
      </div>
    `;
    return;
  }

  if (!hasGroup) {
    els.detailTitle.textContent = state.loadError ? "Import failed" : state.rows.length ? "No group selected" : "Load a Salesforce export";
    els.detailSurface.innerHTML = `
      <div class="empty-state ${state.loadError ? "error-state" : ""}">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            ${state.loadError
              ? '<path d="M12 8v5M12 17h.01" /><path d="M10.3 3.9 2.7 17.1A2 2 0 0 0 4.4 20h15.2a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z" />'
              : '<path d="M8 7h8M8 12h8M8 17h5" /><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />'}
          </svg>
        </div>
        <strong>${state.loadError ? "Dataset could not be loaded" : state.rows.length ? "No duplicate groups" : "No duplicate groups yet"}</strong>
        <span>${state.loadError ? escapeHtml(state.loadError) : state.rows.length ? "Adjust the thresholds or mapping." : "Choose a CSV or JSON file, or load demo data."}</span>
        <div class="empty-actions">
          <button class="button button-primary" type="button" data-empty-action="choose-csv">Import</button>
          <button class="button button-secondary" type="button" data-empty-action="demo-data">Load Demo</button>
        </div>
      </div>
    `;
    return;
  }

  const bestPair = group.bestPair;
  els.detailTitle.textContent = `${OBJECT_CONFIG[state.objectType].singular} group ${group.id}`;
  els.detailSurface.innerHTML = `
    <div class="detail-layout">
      ${renderPairSummary(group, currentDecision)}
      ${state.reviewMode === "merge"
        ? renderMergeWorkspace(group, activeRecords, separatedRecords, currentDecision)
        : renderEvaluateWorkspace(group, bestPair, activeRecords, separatedRecords)}
    </div>
  `;
}

function detailRenderSignature({ group, activeRecords, separatedRecords, currentDecision }) {
  if (state.isLoadingFile) {
    return [
      "loading",
      state.loadingFileName,
      state.objectType,
      state.reviewMode
    ].join("|");
  }
  if (!group) {
    return [
      "empty",
      state.loadError || "",
      state.rows.length,
      state.objectType,
      state.reviewMode
    ].join("|");
  }

  const groupKey = group.key;
  const fieldResolutions = state.fieldResolutions.get(groupKey) || {};
  const mergeResult = state.mergeResults.get(groupKey) || null;
  const separatedKeys = [...(state.separatedRecords.get(groupKey) || [])].sort();
  const trainingContext = state.reviewMode === "evaluate" ? getTrainingPairContext(group) : null;
  const trainingLabel = trainingContext ? state.trainingLabels.get(trainingContext.pair.key) : null;
  return JSON.stringify({
    mode: state.reviewMode,
    objectType: state.objectType,
    groupKey,
    decision: currentDecision,
    activeRecordKeys: activeRecords.map(recordKey),
    separatedRecordKeys: separatedRecords.map(recordKey),
    separatedKeys,
    fieldResolutions,
    mergeMaster: mergeMasterSelections.get(groupKey) || "",
    mergeReviewActive: mergeReviewSession.active,
    mergeReviewSubmitting: mergeReviewSession.submitting,
    mergeReviewQueueGroupKeys: mergeReviewSession.queueGroupKeys,
    mergePreviewMasterId: mergePreviewStates.get(groupKey)?.masterId || "",
    mergePreviewMergeIds: mergePreviewStates.get(groupKey)?.mergeIds || [],
    mergePreviewWritebacks: mergePreviewStates.get(groupKey)?.salesforceWritebackCount || 0,
    mergeInFlight: mergeInFlightGroupKeys.has(groupKey),
    mergeResultStatus: mergeResult?.status || "",
    mergeResultMessage: mergeResult?.message || "",
    trainingPairIndex: state.trainingPairIndexes.get(groupKey) || 0,
    trainingPairKey: trainingContext?.pair.key || "",
    trainingPairLabel: trainingLabel?.label || "",
    trainingPairConfidence: trainingLabel?.confidence || state.trainingConfidence,
    trainingConfidence: state.trainingConfidence,
    trainingLabelCount: state.trainingLabels.size
  });
}

function setReviewMode(mode) {
  const nextMode = mode === "merge" ? "merge" : "evaluate";
  if (nextMode === "merge" && state.objectType === "account") return;
  if (state.reviewMode === nextMode) return;
  state.reviewMode = nextMode;
  renderDetail();
}

function updateReviewModeControls() {
  els.reviewModeButtons.forEach((button) => {
    const mode = button.dataset.reviewMode === "merge" ? "merge" : "evaluate";
    const active = state.reviewMode === mode;
    const disabled = mode === "merge" && state.objectType === "account";
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.disabled = disabled;
    button.title = disabled
      ? "Account merge is disabled. Accounts can still be evaluated."
      : mode === "merge"
        ? "Prepare and run Contact merges."
        : "Evaluate model output and label pairs.";
  });
}

function renderPairSummary(group, currentDecision) {
  return `
    <div class="pair-summary">
      <div>
        <strong>${group.score} match score</strong>
        <div class="match-meta">${group.matchedFieldPercent}% fields matched · min pair ${group.minPairScore}</div>
        <div class="reason-list">
          ${group.reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join("")}
        </div>
      </div>
      <div class="pair-summary-pills">
        ${renderDecisionBadge(currentDecision, "detail-decision-pill")}
        <span class="match-pill ${group.type}">${group.type}</span>
      </div>
    </div>
  `;
}

function renderEvaluateWorkspace(group, bestPair, activeRecords, separatedRecords) {
  return `
    ${renderTrainingLabeler(group)}
    <div class="record-strip">
      ${activeRecords.map((record) => renderRecordCard(record, group, false, activeRecords.length)).join("")}
    </div>
    ${separatedRecords.length ? renderSeparatedRecords(group, separatedRecords) : ""}
    <div class="comparison-table-wrap">
      ${renderComparisonTable(group, bestPair)}
    </div>
  `;
}

function renderMergeWorkspace(group, activeRecords, separatedRecords, currentDecision) {
  const result = state.mergeResults.get(group.key) || null;
  return `
    ${result?.status === "success"
      ? renderMergeSuccessPanel(group, result)
      : mergeReviewSession.active
        ? renderMergeReviewPanel(group)
        : renderSalesforceMergePanel(group, activeRecords, currentDecision)}
    ${result?.status === "success" ? "" : separatedRecords.length ? renderSeparatedRecords(group, separatedRecords) : ""}
  `;
}

function updateNavigationControls() {
  const groups = filteredGroups();
  const currentIndex = groups.findIndex((group) => group.key === state.selectedGroupKey);
  const hasVisibleGroup = currentIndex >= 0;

  els.previousGroupButton.disabled = !groups.length || (hasVisibleGroup && currentIndex === 0);
  els.nextGroupButton.disabled = !groups.length || (hasVisibleGroup && currentIndex === groups.length - 1);
  els.groupNavigationStatus.textContent = hasVisibleGroup
    ? `${formatNumber(currentIndex + 1)} of ${formatNumber(groups.length)}`
    : `0 of ${formatNumber(groups.length)}`;
}

function renderTrainingLabeler(group) {
  const context = getTrainingPairContext(group);
  if (!context) return "";

  const { pairs, index, pair } = context;
  const label = state.trainingLabels.get(pair.key);
  const labeledCount = pairs.filter((item) => state.trainingLabels.has(item.key)).length;
  const pairScore = scoreOriginalRecordPair(pair.left, pair.right);
  const currentLabel = label?.label || "";

  return `
    <section class="training-labeler" aria-label="Calibration labels">
      <div class="training-labeler-header">
        <div class="training-labeler-title">
          <span>Calibration label</span>
          <strong>Pair ${formatNumber(index + 1)} of ${formatNumber(pairs.length)}</strong>
          <em>${formatNumber(labeledCount)} labeled</em>
        </div>
        <div class="training-labeler-tools">
          <span class="match-pill ${pairScore.type}">${Math.round(pairScore.value)}</span>
          <label class="confidence-control">
            <span>Confidence</span>
            <select class="training-confidence-select">
              ${TRAINING_CONFIDENCE_LEVELS.map((confidence) => {
                const selected = confidence === state.trainingConfidence ? "selected" : "";
                return `<option value="${confidence}" ${selected}>${capitalize(confidence)}</option>`;
              }).join("")}
            </select>
          </label>
        </div>
      </div>
      <div class="training-pair-grid">
        ${renderTrainingPairCard(pair.left, "Left record")}
        ${renderTrainingPairCard(pair.right, "Right record")}
      </div>
      <div class="training-actions">
        <button class="mini-button" type="button" data-label-action="previous-pair" ${pairs.length < 2 ? "disabled" : ""}>Previous Pair</button>
        ${Object.entries(TRAINING_LABELS)
          .map(([value, labelText]) => {
            const active = currentLabel === value ? "is-active" : "";
            return `
              <button
                class="mini-button training-label-button ${value} ${active}"
                type="button"
                data-label-action="${value}"
                aria-pressed="${currentLabel === value ? "true" : "false"}"
              >${escapeHtml(labelText)}</button>
            `;
          })
          .join("")}
        <button class="mini-button" type="button" data-label-action="next-pair" ${pairs.length < 2 ? "disabled" : ""}>Next Pair</button>
      </div>
    </section>
  `;
}

function renderTrainingPairCard(record, title) {
  const fields = TRAINING_PAIR_FIELDS[state.objectType] || OBJECT_CONFIG[state.objectType].displayFields;
  return `
    <article class="training-pair-card">
      <div class="training-pair-card-title">
        <span>${escapeHtml(title)}</span>
        <strong>${escapeHtml(displayName(record))}</strong>
        <em>${escapeHtml(recordKey(record))}</em>
      </div>
      <dl>
        ${fields
          .map((field) => {
            return `
              <div>
                <dt>${escapeHtml(FIELD_LABELS[field] || field)}</dt>
                <dd>${escapeHtml(getDisplayFieldValue(record, field) || "—")}</dd>
              </div>
            `;
          })
          .join("")}
      </dl>
    </article>
  `;
}

function renderSalesforceMergePanel(group, activeRecords, currentDecision) {
  if (state.objectType !== "contact") return renderAccountMergeDisabledPanel();

  const mergeState = getMergeState(group, activeRecords, currentDecision);
  const result = state.mergeResults.get(group.key);
  const resolutionContext = createFieldResolutionContext(group, activeRecords);
  const overrideCount = countMergeFieldOverrides(group, activeRecords, mergeState, resolutionContext);
  const queueGroups = getMergeReviewQueueCandidates();
  const queueReadyCount = queueGroups.length;
  const queueCurrentIndex = queueGroups.findIndex((candidate) => candidate.key === group.key);
  const queueSummary = queueReadyCount
    ? queueReadyCount === 1
      ? "1 merge group is ready for read-only review."
      : `${formatNumber(queueReadyCount)} merge groups are ready for read-only review.`
    : "Mark duplicate groups ready before starting the read-only review step.";
  const reviewButtonLabel = queueReadyCount > 1
    ? `Review ${formatNumber(queueReadyCount)} groups before confirming`
    : "Review before confirming";

  return `
    <section class="salesforce-merge-panel ${escapeHtml(mergeState.statusClass)}" aria-label="Salesforce merge">
      <div class="salesforce-merge-header">
        <div>
          <span>Contact merge</span>
          <strong>${escapeHtml(mergeState.title)}</strong>
          <em>${escapeHtml(mergeState.description)}</em>
        </div>
        <span class="merge-status-pill ${escapeHtml(mergeState.statusClass)}">${escapeHtml(mergeState.statusLabel)}</span>
      </div>
      <div class="merge-readiness-grid">
        <div class="merge-readiness-card">
          <span>Master baseline</span>
          <strong>${escapeHtml(mergeState.selectedRecord ? displayName(mergeState.selectedRecord) : "No master selected")}</strong>
          <em>${escapeHtml(mergeState.selectedId || "Choose a Contact master")}</em>
        </div>
        <div class="merge-readiness-card">
          <span>Field overrides</span>
          <strong>${formatNumber(overrideCount)}</strong>
          <em>${overrideCount === 1 ? "field differs from the master" : "fields differ from the master"}</em>
        </div>
        <div class="merge-readiness-card">
          <span>Duplicates</span>
          <strong>${formatNumber(mergeState.mergeRecords.length)}</strong>
          <em>will merge into the master</em>
        </div>
      </div>
      ${renderMergeMatrix(group, activeRecords, mergeState, resolutionContext)}
      <div class="merge-preview">
        <span>Duplicate Contacts to merge into master</span>
        <div class="merge-id-list">
          ${mergeState.mergeRecords.length
            ? mergeState.mergeRecords.map(renderMergeRecordChip).join("")
            : '<em class="merge-empty">No duplicate Contacts selected</em>'}
        </div>
      </div>
      <div class="merge-queue-summary">
        <div class="merge-queue-summary-copy">
          <strong>Next step: review before confirming</strong>
          <span>${escapeHtml(queueSummary)}</span>
          <em>${queueCurrentIndex >= 0
            ? `Current group is ${formatNumber(queueCurrentIndex + 1)} of ${formatNumber(queueReadyCount)} in the queued merge set.`
            : "Only groups marked Duplicate and ready for Salesforce merge enter the queued review set."
          }</em>
        </div>
        <div class="merge-queue-summary-count">
          <span>Queued groups</span>
          <strong>${formatNumber(queueReadyCount)}</strong>
        </div>
      </div>
      <p class="merge-warning">
        Salesforce merge keeps the selected master Contact and reparents related records from duplicate Contacts. Lead Source changes still apply as Salesforce write-backs; other field choices remain review-only and will be shown in the read-only confirmation preview.
      </p>
      ${mergeState.invalidRecords.length ? renderMissingContactIdNotice(group, mergeState) : ""}
      ${result ? renderMergeResult(result) : ""}
      <div class="merge-actions">
        <button
          class="button button-primary merge-submit-button"
          type="button"
          data-merge-action="merge"
          data-group-key="${escapeHtml(group.key)}"
          ${mergeState.canSubmit && queueReadyCount ? "" : "disabled"}
        >${escapeHtml(reviewButtonLabel)}</button>
      </div>
    </section>
  `;
}

function renderMergeReviewPanel(group) {
  const previewState = mergePreviewStates.get(group.key) || null;
  const queueGroups = getMergeReviewQueueGroups();
  const currentIndex = queueGroups.findIndex((candidate) => candidate.key === group.key);
  const currentNumber = currentIndex >= 0 ? currentIndex + 1 : 0;
  const activePreviewState = previewState || mergePreviewStates.get(queueGroups[0]?.key) || null;
  const currentGroupLabel = currentNumber
    ? `Contact group ${group.id}`
    : "Queued merge review";
  const reviewCount = queueGroups.length;

  if (!activePreviewState) {
    return `
      <section class="salesforce-merge-panel blocked" aria-label="Review before confirming">
        <div class="salesforce-merge-header">
          <div>
            <span>Review before confirming</span>
            <strong>No queued merge previews are available</strong>
            <em>Return to Contact merge setup, then refresh the review queue.</em>
          </div>
          <span class="merge-status-pill blocked">Needs setup</span>
        </div>
        <div class="merge-actions">
          <button class="button button-secondary" type="button" data-merge-action="cancel-batch-review">Cancel</button>
        </div>
      </section>
    `;
  }

  return `
    <section class="salesforce-merge-panel ready merge-review-panel" aria-label="Review before confirming">
      <div class="salesforce-merge-header">
        <div>
          <span>Review before confirming</span>
          <strong>Read-only merged Contact previews for the queued merge set</strong>
          <em>Use the left rail or the inline Previous and Next controls to inspect each resulting merged Contact before sending the queued Salesforce merges.</em>
        </div>
        <span class="merge-status-pill ready">${mergeReviewSession.submitting ? "Merging" : "Fresh"}</span>
      </div>
      <div class="merge-review-summary">
        <div class="merge-readiness-card">
          <span>Queued merge groups</span>
          <strong>${formatNumber(reviewCount)}</strong>
          <em>${reviewCount === 1 ? "group ready" : "groups ready"}</em>
        </div>
        <div class="merge-readiness-card">
          <span>Current preview</span>
          <strong>${formatNumber(currentNumber)} of ${formatNumber(reviewCount)}</strong>
          <em>${escapeHtml(currentGroupLabel)}</em>
        </div>
        <div class="merge-readiness-card">
          <span>Overall confirmation</span>
          <strong>Affects ${formatNumber(reviewCount)}</strong>
          <em>${reviewCount === 1 ? "Salesforce merge" : "Salesforce merges"}</em>
        </div>
      </div>
      <div class="merge-review-nav">
        <div class="merge-review-nav-buttons">
          <button
            class="button button-secondary merge-review-previous-button"
            type="button"
            data-merge-action="previous-review-group"
            ${currentIndex <= 0 ? "disabled" : ""}
          >Previous</button>
          <button
            class="button button-primary merge-review-next-button"
            type="button"
            data-merge-action="next-review-group"
            ${currentIndex === -1 || currentIndex >= reviewCount - 1 ? "disabled" : ""}
          >Next</button>
        </div>
        <div class="merge-review-nav-status">
          <span>Currently reviewing</span>
          <strong>${escapeHtml(currentGroupLabel)}</strong>
        </div>
      </div>
      ${renderMergeConfirmationPreview(activePreviewState)}
      <div class="merge-review-footer">
        <p class="merge-warning">
          These previews are read-only. To change a master choice or retained field value, cancel review and return to Contact merge setup. No Salesforce merge request is sent until you confirm the full queued set.
        </p>
        <div class="merge-actions">
          <button
            class="button button-secondary merge-cancel-preview-button"
            type="button"
            data-merge-action="cancel-batch-review"
            ${mergeReviewSession.submitting ? "disabled" : ""}
          >Cancel</button>
          <button
            class="button button-primary merge-confirm-preview-button"
            type="button"
            data-merge-action="confirm-merge"
            ${mergeReviewSession.submitting ? "disabled" : ""}
          >${mergeReviewSession.submitting ? "Confirming..." : `Confirm ${reviewCount === 1 ? "merge" : "all merges"}`}</button>
        </div>
      </div>
    </section>
  `;
}

function renderMergeConfirmationPreview(previewState) {
  return `
    <section class="merge-confirmation-preview" aria-label="Merge confirmation preview">
      <div class="merge-confirmation-header">
        <div>
          <span>Review before confirming</span>
          <strong>Review the surviving Contact before sending the Salesforce merge</strong>
        </div>
      </div>
      <dl class="merge-confirmation-meta">
        <div>
          <dt>Surviving master</dt>
          <dd>${escapeHtml(previewState.masterName || "Unnamed Contact")} <span>${escapeHtml(previewState.masterId)}</span></dd>
        </div>
        <div>
          <dt>Duplicate Contacts removed</dt>
          <dd>${formatNumber(previewState.mergeIds.length)}</dd>
        </div>
        <div>
          <dt>Salesforce field write-backs</dt>
          <dd>${formatNumber(previewState.salesforceWritebackCount)}</dd>
        </div>
      </dl>
      <div class="merge-preview merge-preview-list">
        <span>Duplicate Contacts that will merge into the master</span>
        <div class="merge-id-list merge-id-list-plain">
          ${previewState.mergeRecordChips.length
            ? previewState.mergeRecordChips.map((chip) => renderMergePreviewChip(chip)).join("")
            : '<em class="merge-empty">No duplicate Contacts selected</em>'}
        </div>
      </div>
      <div class="merge-confirmation-fields" aria-label="Resulting Contact fields">
        <table class="merge-preview-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Surviving value</th>
              <th>Merge effect</th>
            </tr>
          </thead>
          <tbody>
            ${previewState.previewFields.map((field) => renderMergePreviewFieldRow(field)).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderMergePreviewChip(chip) {
  return `
    <div class="merge-preview-list-item">
      <strong>${escapeHtml(chip.name || "Unnamed record")}</strong>
      <span>${escapeHtml(chip.id || "")}</span>
    </div>
  `;
}

function renderMergePreviewFieldRow(field) {
  const effectText = field.kind === "review-only"
    ? `Review only: ${field.reviewOnlyValue || "—"}`
    : field.kindLabel;
  return `
    <tr class="merge-preview-row ${escapeHtml(field.kind)}" data-merge-preview-kind="${escapeHtml(field.kind)}">
      <th scope="row">${escapeHtml(field.label)}</th>
      <td>${escapeHtml(field.resultValue || "—")}</td>
      <td>${escapeHtml(effectText)}</td>
    </tr>
  `;
}

function renderAccountMergeDisabledPanel() {
  return `
    <section class="salesforce-merge-panel blocked" aria-label="Account merge disabled">
      <div class="salesforce-merge-header">
        <div>
          <span>Account merge disabled</span>
          <strong>Accounts stay in Evaluate mode</strong>
          <em>Account merges are intentionally blocked because downstream Finance dependencies require separate business logic.</em>
        </div>
        <span class="merge-status-pill blocked">Disabled</span>
      </div>
      <p class="merge-warning">
        You can still score Account matches, mark groups Duplicate or Not Duplicate, label pairs, and export review decisions.
      </p>
    </section>
  `;
}

function getMergeState(group, activeRecords, currentDecision) {
  const acceptedValues = getAcceptedFieldValues(group);
  const recommendedRecord = selectCanonicalRecord(group, acceptedValues);
  const recommendedId = normalizeSalesforceIdForMerge(salesforceId(recommendedRecord));
  const activeRecordsWithIds = activeRecords.map((record) => ({
    record,
    id: normalizeSalesforceIdForMerge(salesforceId(record))
  }));
  const validIds = new Set(activeRecordsWithIds.map(({ id }) => id).filter(Boolean));
  const selectedId = validIds.has(mergeMasterSelections.get(group.key))
    ? mergeMasterSelections.get(group.key)
    : recommendedId || activeRecordsWithIds.find(({ id }) => id)?.id || "";
  const selectedRecord = activeRecordsWithIds.find(({ id }) => id === selectedId)?.record || null;
  const expectedPrefix = "003";
  const invalidRecords = activeRecordsWithIds.filter(({ id }) => !id || !id.startsWith(expectedPrefix));
  const mergeRecords = activeRecordsWithIds.filter(({ id }) => id && id !== selectedId);
  const result = state.mergeResults.get(group.key);
  const inFlight = mergeInFlightGroupKeys.has(group.key);
  const alreadyMerged = result?.status === "success";
  const blockedReason = mergeBlockedReason({
    activeRecords,
    currentDecision,
    selectedId,
    invalidRecords,
    mergeRecords,
    alreadyMerged
  });
  const missingContactIdRefreshSource = resolveContactsRefreshSource({ allowLatestContactsFallback: true });
  const canRefreshMissingContactIds = invalidRecords.length > 0 && Boolean(missingContactIdRefreshSource);

  return {
    acceptedValues,
    recommendedId,
    selectedId,
    selectedRecord,
    mergeRecords,
    invalidRecords,
    canRefreshMissingContactIds,
    missingContactIdRefreshUsesFallback: Boolean(missingContactIdRefreshSource?.isLatestContactsFallback),
    inFlight,
    locked: inFlight || alreadyMerged,
    canSubmit: !blockedReason && !inFlight,
    buttonLabel: inFlight ? "Merging..." : alreadyMerged ? "Merged" : "Merge in Salesforce",
    title: alreadyMerged
      ? `Merged into ${result.masterId || selectedId}`
      : `${formatNumber(activeRecords.length)} ${activeRecords.length === 1 ? "Contact" : "Contacts"}: 1 master, ${formatNumber(mergeRecords.length)} ${mergeRecords.length === 1 ? "duplicate" : "duplicates"}`,
    description: blockedReason || "Mark this group Duplicate, choose a master Contact, review field overrides, then review before confirming.",
    statusClass: mergeStatusClass(result, blockedReason, inFlight),
    statusLabel: mergeStatusLabel(result, blockedReason, inFlight)
  };
}

function mergeBlockedReason({ activeRecords, currentDecision, selectedId, invalidRecords, mergeRecords, alreadyMerged }) {
  if (alreadyMerged) return "";
  if (state.objectType !== "contact") return "Only Contact merge is available in this app.";
  if (activeRecords.length < 2) return "At least two active records are required.";
  if (currentDecision !== "duplicate") return "Mark this group Duplicate before merging.";
  if (invalidRecords.length) return missingContactIdMergeMessage(invalidRecords.length);
  if (!selectedId) return "Choose a master Contact with a valid Salesforce ID.";
  if (!mergeRecords.length) return "There are no duplicate Contacts to merge into the master.";
  if (mergeRecords.length > 20) return "Split this group first; one merge action supports up to 20 duplicate records.";
  return "";
}

function missingContactIdMergeMessage(missingCount = 0) {
  const count = Number(missingCount) || 0;
  const prefix = count
    ? `${formatNumber(count)} active ${count === 1 ? "Contact is" : "Contacts are"} missing valid Salesforce Contact IDs.`
    : "Valid Salesforce Contact IDs are missing.";
  return `${prefix} Contact IDs are required before any merge can be sent to Salesforce. Re-pull the Contacts export with the Id field included before merging.`;
}

function renderMissingContactIdNotice(group, mergeState) {
  return `
    <div class="merge-repair-notice">
      <div>
        <strong>Contact IDs required</strong>
        <span>${escapeHtml(missingContactIdMergeMessage(mergeState.invalidRecords.length))}</span>
        <em>${escapeHtml(mergeState.canRefreshMissingContactIds
          ? mergeState.missingContactIdRefreshUsesFallback
            ? "The loaded file cannot be refreshed directly, but the app can load the standard Latest Contacts pull with Id included."
            : "The standard latest Contacts pull includes Id, so the app can refresh this dataset automatically."
          : "This loaded dataset cannot be refreshed automatically. Re-run the Contacts pull/export with Id included, then import it again."
        )}</em>
      </div>
      ${mergeState.canRefreshMissingContactIds ? `
        <button
          class="button button-secondary merge-refresh-contact-ids-button"
          type="button"
          data-merge-action="refresh-contact-ids"
          data-group-key="${escapeHtml(group.key)}"
        >${mergeState.missingContactIdRefreshUsesFallback ? "Load Latest Contacts" : "Refresh Contacts"}</button>
      ` : ""}
    </div>
  `;
}

function mergeStatusClass(result, blockedReason, inFlight) {
  if (inFlight) return "in-progress";
  if (result?.status === "success") return "success";
  if (result?.status === "failed") return "failed";
  return blockedReason ? "blocked" : "ready";
}

function mergeStatusLabel(result, blockedReason, inFlight) {
  if (inFlight) return "Merging";
  if (result?.status === "success") return "Merged";
  if (result?.status === "failed") return "Failed";
  return blockedReason ? "Needs setup" : "Ready";
}

function renderMergeRecordChip({ record, id }) {
  return `
    <span class="merge-id-chip">
      <strong>${escapeHtml(displayName(record) || "Unnamed record")}</strong>
      <em>${escapeHtml(id)}</em>
    </span>
  `;
}

function renderMergeMatrix(group, records, mergeState, resolutionContext) {
  const fields = OBJECT_CONFIG[state.objectType].displayFields;
  return `
    <div class="merge-matrix-wrap">
      <table class="merge-matrix">
        <thead>
          <tr>
            <th>Field</th>
            ${records.map((record) => renderMergeRecordHeader(group, record, mergeState)).join("")}
          </tr>
        </thead>
        <tbody>
          ${fields.map((field) => renderMergeMatrixRow(group, field, records, mergeState, resolutionContext)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMergeRecordHeader(group, record, mergeState) {
  const id = normalizeSalesforceIdForMerge(salesforceId(record));
  const checked = id && id === mergeState.selectedId ? "checked" : "";
  const disabled = mergeState.locked || !id || !id.startsWith("003") ? "disabled" : "";
  const recommended = id && id === mergeState.recommendedId ? " · recommended" : "";
  return `
    <th>
      <label class="merge-master-choice">
        <input
          class="merge-master-radio"
          type="radio"
          name="merge-master-${escapeHtml(group.key)}"
          value="${escapeHtml(id)}"
          data-group-key="${escapeHtml(group.key)}"
          ${checked}
          ${disabled}
        />
        <span>Master</span>
      </label>
      <strong>${escapeHtml(displayName(record) || "Unnamed Contact")}</strong>
      <em>${escapeHtml(id || "missing Contact ID")}${escapeHtml(recommended)}</em>
    </th>
  `;
}

function renderMergeMatrixRow(group, field, records, mergeState, resolutionContext) {
  const resolution = getFieldResolution(group, field, resolutionContext);
  const masterValue = mergeState.selectedRecord ? getDisplayFieldValue(mergeState.selectedRecord, field) : "";
  const selectedIndex = selectedMergeFieldRecordIndex(records, field, resolution.acceptedValue);
  const explicit = hasExplicitFieldResolution(group.key, field);
  const overridden = isMergeFieldOverride({ resolution, explicit, masterValue });
  const rowClass = [
    resolution.hasDiscrepancy ? "has-discrepancy" : "",
    overridden ? "has-override" : "",
    resolution.hardRule ? "has-hard-rule" : ""
  ].filter(Boolean).join(" ");

  return `
    <tr class="${rowClass}">
      <td class="merge-field-name">
        <strong>${escapeHtml(FIELD_LABELS[field] || field)}</strong>
        <span>${escapeHtml(mergeFieldStatusLabel({ resolution, explicit, overridden, masterValue }))}</span>
      </td>
      ${records.map((record, index) => renderMergeFieldCell(group, field, record, index, selectedIndex, mergeState, resolution)).join("")}
    </tr>
  `;
}

function renderMergeFieldCell(group, field, record, index, selectedIndex, mergeState, resolution) {
  const value = String(getDisplayFieldValue(record, field) || "").trim();
  const checked = selectedIndex === index ? "checked" : "";
  const disabled = mergeState.locked || resolution.hardRule || !resolution.hasValues ? "disabled" : "";
  const isBlank = value ? "" : "is-blank";
  const isSelected = checked ? "is-selected" : "";
  return `
    <td>
      <label class="merge-field-choice ${isSelected} ${isBlank}">
        <input
          class="merge-field-radio"
          type="radio"
          name="merge-field-${escapeHtml(group.key)}-${escapeHtml(field)}"
          value="${escapeHtml(value)}"
          data-group-key="${escapeHtml(group.key)}"
          data-field="${escapeHtml(field)}"
          ${checked}
          ${disabled}
        />
        <span>${escapeHtml(value || "—")}</span>
      </label>
    </td>
  `;
}

function selectedMergeFieldRecordIndex(records, field, acceptedValue) {
  const accepted = normalizeResolutionValue(acceptedValue);
  return Math.max(0, records.findIndex((record) => normalizeResolutionValue(getDisplayFieldValue(record, field)) === accepted));
}

function mergeFieldStatusLabel({ resolution, explicit, overridden, masterValue }) {
  if (resolution.hardRule) return resolution.hardRule.label;
  if (!resolution.hasValues) return "No value";
  if (!resolution.hasDiscrepancy) return "Same value";
  if (overridden) return "Override";
  if (explicit) return "Master value";
  if (masterValue) return "From master";
  return "Suggested";
}

function countMergeFieldOverrides(group, records, mergeState, resolutionContext) {
  if (!mergeState.selectedRecord) return 0;
  return OBJECT_CONFIG[state.objectType].displayFields.filter((field) => {
    const resolution = getFieldResolution(group, field, resolutionContext);
    const masterValue = getDisplayFieldValue(mergeState.selectedRecord, field);
    return isMergeFieldOverride({
      resolution,
      explicit: hasExplicitFieldResolution(group.key, field),
      masterValue
    });
  }).length;
}

function isMergeFieldOverride({ resolution, explicit, masterValue }) {
  if (!explicit && !resolution.hardRule) return false;
  return normalizeResolutionValue(resolution.acceptedValue) !== normalizeResolutionValue(masterValue);
}

function renderMergeResult(result) {
  const mergedIds = Array.isArray(result.mergedRecordIds) ? result.mergedRecordIds : [];
  const relatedCount = Array.isArray(result.updatedRelatedIds) ? result.updatedRelatedIds.length : 0;
  const when = result.mergedAt ? new Date(result.mergedAt).toLocaleString() : "";
  const report = result.mergeReport;
  const message = result.status === "success"
    ? `Merged ${formatNumber(mergedIds.length)} ${mergedIds.length === 1 ? "record" : "records"}${relatedCount ? ` and updated ${formatNumber(relatedCount)} related ${relatedCount === 1 ? "record" : "records"}` : ""}.`
    : result.message || "Salesforce merge failed.";
  const canRefresh = canOfferPreMergeDatasetRefresh(result);
  return `
    <div class="merge-result ${escapeHtml(result.status || "")}" data-group-key="${escapeHtml(result.groupKey || "")}">
      <strong>${escapeHtml(result.status === "success" ? "Last merge succeeded" : "Last merge failed")}</strong>
      <span>${escapeHtml(message)}</span>
      ${when ? `<em>${escapeHtml(when)}</em>` : ""}
      ${report && Array.isArray(report.rows) && report.rows.length ? `
        <div class="merge-result-actions">
          <button
            class="button button-secondary merge-report-download-button"
            type="button"
            data-merge-action="download-merge-report"
            data-group-key="${escapeHtml(result.groupKey || "")}"
          >Download CSV report</button>
        </div>
      ` : ""}
      ${canRefresh ? `
        <div class="merge-result-actions">
          <button
            class="button button-secondary merge-refresh-stale-data-button"
            type="button"
            data-merge-action="refresh-stale-data"
          >Refresh Contacts</button>
        </div>
      ` : ""}
    </div>
  `;
}

function renderMergeSuccessPanel(group, result) {
  const mergedIds = Array.isArray(result.mergedRecordIds) ? result.mergedRecordIds : [];
  const relatedCount = Array.isArray(result.updatedRelatedIds) ? result.updatedRelatedIds.length : 0;
  const when = result.mergedAt ? new Date(result.mergedAt).toLocaleString() : "";
  const report = result.mergeReport;
  const message = `Merged ${formatNumber(mergedIds.length)} ${mergedIds.length === 1 ? "record" : "records"}${relatedCount ? ` and updated ${formatNumber(relatedCount)} related ${relatedCount === 1 ? "record" : "records"}` : ""}.`;
  return `
    <section class="salesforce-merge-panel success merge-success-panel" aria-label="Merge success">
      <div class="salesforce-merge-header">
        <div>
          <span>Merge complete</span>
          <strong>Last merge succeeded</strong>
          <em>${escapeHtml(message)}</em>
        </div>
        <span class="merge-status-pill success">Success</span>
      </div>
      <div class="merge-confirmation-summary">
        <div class="merge-readiness-card">
          <span>Merged records</span>
          <strong>${formatNumber(mergedIds.length)}</strong>
          <em>${mergedIds.length === 1 ? "record merged into the master" : "records merged into the master"}</em>
        </div>
        <div class="merge-readiness-card">
          <span>Related records</span>
          <strong>${formatNumber(relatedCount)}</strong>
          <em>${relatedCount === 1 ? "related record updated" : "related records updated"}</em>
        </div>
        <div class="merge-readiness-card">
          <span>Completed</span>
          <strong>${when ? "Yes" : "Recorded"}</strong>
          <em>${escapeHtml(when || "Merge completion was recorded.")}</em>
        </div>
      </div>
      ${report && Array.isArray(report.rows) && report.rows.length ? `
        <div class="merge-result ${escapeHtml(result.status || "")}" data-group-key="${escapeHtml(result.groupKey || "")}">
          <span>${escapeHtml(message)}</span>
          ${when ? `<em>${escapeHtml(when)}</em>` : ""}
          <div class="merge-result-actions">
            <button
              class="button button-secondary merge-report-download-button"
              type="button"
              data-merge-action="download-merge-report"
              data-group-key="${escapeHtml(result.groupKey || "")}"
            >Download CSV report</button>
          </div>
        </div>
      ` : ""}
    </section>
  `;
}

function canOfferPreMergeDatasetRefresh(result) {
  if (!result || result.status !== "failed" || !canRefreshLoadedDatasetFromSource()) return false;
  if (hasStalePreMergeCheck(result.preMergeCheck)) return true;
  return isPreMergeFreshnessFailureMessage(result.message);
}

function downloadMergeReport(button) {
  const groupKey = button.dataset.groupKey || "";
  const result = state.mergeResults.get(groupKey);
  const report = result?.mergeReport;
  if (!report || !Array.isArray(report.rows) || !report.rows.length) {
    window.alert("No CSV report is available for this merge yet.");
    return;
  }

  downloadCsv(report.fileName || `${state.objectType}-merge-report.csv`, report.rows);
}

function hasStalePreMergeCheck(check) {
  return Boolean(check && check.status && check.status !== "fresh");
}

function getMergeReviewQueueCandidates() {
  if (state.objectType !== "contact") return [];
  return filteredGroups().filter((group) => {
    const activeRecords = getActiveGroupRecords(group);
    const currentDecision = state.decisions.get(group.key) || "";
    const mergeState = getMergeState(group, activeRecords, currentDecision);
    return mergeState.canSubmit;
  });
}

function getMergeReviewQueueGroups() {
  if (!mergeReviewSession.active) return [];
  return mergeReviewSession.queueGroupKeys
    .map((groupKey) => findGroupByKey(groupKey))
    .filter(Boolean);
}

function resetMergeReviewSession() {
  mergeReviewSession.active = false;
  mergeReviewSession.queueGroupKeys = [];
  mergeReviewSession.submitting = false;
}

function clearMergePreviewState(groupKey) {
  const shouldResetReview = !groupKey
    || !mergeReviewSession.active
    || mergeReviewSession.queueGroupKeys.includes(groupKey);
  if (shouldResetReview) {
    resetMergeReviewSession();
    mergePreviewStates.clear();
    return;
  }
  mergePreviewStates.delete(groupKey);
}

function navigateMergeReview(direction) {
  const queueGroupKeys = mergeReviewSession.queueGroupKeys;
  if (!mergeReviewSession.active || !queueGroupKeys.length) return;
  const currentIndex = queueGroupKeys.indexOf(state.selectedGroupKey);
  const fallbackIndex = direction > 0 ? -1 : queueGroupKeys.length;
  const nextIndex = Math.max(
    0,
    Math.min(queueGroupKeys.length - 1, (currentIndex === -1 ? fallbackIndex : currentIndex) + direction)
  );
  selectGroup(queueGroupKeys[nextIndex]);
}

async function startMergeReviewSession(preferredGroupKey = "") {
  const queueGroups = getMergeReviewQueueCandidates();
  if (!queueGroups.length) {
    window.alert("No duplicate Contact groups are ready for merge review.");
    return;
  }

  let refreshAfterStaleCheck = false;
  let reviewAborted = false;
  let currentGroup = null;
  mergePreviewStates.clear();
  queueGroups.forEach((group) => mergeInFlightGroupKeys.add(group.key));
  renderGroups({ preserveScroll: true });
  renderDetail();

  try {
    for (const group of queueGroups) {
      currentGroup = group;
      const activeRecords = getActiveGroupRecords(group);
      const mergeState = getMergeState(group, activeRecords, state.decisions.get(group.key) || "");
      const mergeIds = mergeState.mergeRecords.map(({ id }) => id);
      const masterFieldPayload = buildSalesforceMergeMasterFieldPayload(group, mergeState);
      const preMergeRecords = buildSalesforcePreMergeRecords(activeRecords);
      const preMergeCheck = await checkSalesforcePreMergeFreshness({
        groupKey: group.key,
        mergeState,
        mergeIds,
        records: preMergeRecords
      });

      if (preMergeCheck.status !== "fresh") {
        const message = preMergeFreshnessSummary(preMergeCheck);
        state.mergeResults.set(
          group.key,
          sanitizeMergeResult({
            status: "failed",
            objectType: state.objectType,
            masterId: mergeState.selectedId,
            mergedRecordIds: mergeIds,
            message,
            preMergeCheck,
            mergedAt: new Date().toISOString()
          })
        );
        state.selectedGroupKey = group.key;
        refreshAfterStaleCheck = confirmPreMergeDatasetRefresh(preMergeCheck);
        resetMergeReviewSession();
        mergePreviewStates.clear();
        reviewAborted = true;
        break;
      }

      mergePreviewStates.set(group.key, buildMergePreviewState({
        group,
        activeRecords,
        mergeState,
        mergeIds,
        preMergeRecords,
        masterFieldPayload,
        preMergeCheck
      }));
    }

    if (!reviewAborted) {
      mergeReviewSession.active = true;
      mergeReviewSession.queueGroupKeys = queueGroups.map((group) => group.key);
      mergeReviewSession.submitting = false;
      const preferredGroup = mergeReviewSession.queueGroupKeys.includes(preferredGroupKey)
        ? preferredGroupKey
        : mergeReviewSession.queueGroupKeys[0];
      if (preferredGroup) state.selectedGroupKey = preferredGroup;
    }
  } catch (error) {
    const preMergeCheck = sanitizePreMergeCheck(error.preMergeCheck);
    const message = hasStalePreMergeCheck(preMergeCheck)
      ? preMergeFreshnessSummary(preMergeCheck)
      : error.message || "Salesforce merge failed.";
    const activeGroupKey = currentGroup?.key || preferredGroupKey || queueGroups[0]?.key || "";
    if (activeGroupKey) {
      state.mergeResults.set(
        activeGroupKey,
        sanitizeMergeResult({
          status: "failed",
          objectType: state.objectType,
          masterId: mergePreviewStates.get(activeGroupKey)?.masterId || "",
          mergedRecordIds: mergePreviewStates.get(activeGroupKey)?.mergeIds || [],
          message,
          preMergeCheck,
          mergedAt: new Date().toISOString()
        })
      );
      state.selectedGroupKey = activeGroupKey;
    }
    resetMergeReviewSession();
    mergePreviewStates.clear();
    if (canOfferPreMergeDatasetRefresh({ status: "failed", message, preMergeCheck })) {
      refreshAfterStaleCheck = confirmPreMergeDatasetRefreshFromMessage(message);
    }
  } finally {
    queueGroups.forEach((group) => mergeInFlightGroupKeys.delete(group.key));
    scheduleReviewStateSave();
    renderGroups();
    renderDetail();
  }

  if (refreshAfterStaleCheck) {
    await refreshLoadedDatasetFromSource();
  }
}

async function handleConfirmedMerge(button) {
  const queueGroupKeys = [...mergeReviewSession.queueGroupKeys];
  if (!queueGroupKeys.length || mergeReviewSession.submitting) return;
  let refreshAfterStaleCheck = false;
  mergeReviewSession.submitting = true;
  queueGroupKeys.forEach((groupKey) => mergeInFlightGroupKeys.add(groupKey));
  renderDetail();

  try {
    for (const groupKey of queueGroupKeys) {
      const previewState = mergePreviewStates.get(groupKey);
      if (!previewState) continue;

      state.selectedGroupKey = groupKey;
      renderGroups({ preserveScroll: true });
      renderDetail();

      const response = await fetch("/api/salesforce/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectType: state.objectType,
          groupKey,
          masterId: previewState.masterId,
          mergeIds: previewState.mergeIds,
          records: previewState.records,
          ...previewState.masterFieldPayload
        })
      });
      const payload = await readApiJson(response);
      if (!response.ok) throw createApiError(payload, "Salesforce merge failed.");

      state.mergeResults.set(groupKey, sanitizeMergeResult({ ...payload, status: "success" }));
      state.decisions.set(groupKey, "duplicate");
    }
    clearMergePreviewState();
  } catch (error) {
    const preMergeCheck = sanitizePreMergeCheck(error.preMergeCheck);
    const message = hasStalePreMergeCheck(preMergeCheck)
      ? preMergeFreshnessSummary(preMergeCheck)
      : error.message || "Salesforce merge failed.";
    const activeGroupKey = state.selectedGroupKey;
    const previewState = mergePreviewStates.get(activeGroupKey);
    state.mergeResults.set(
      activeGroupKey,
      sanitizeMergeResult({
        status: "failed",
        objectType: state.objectType,
        masterId: previewState?.masterId || "",
        mergedRecordIds: previewState?.mergeIds || [],
        message,
        preMergeCheck,
        mergedAt: new Date().toISOString()
      })
    );
    clearMergePreviewState(activeGroupKey);
    if (canOfferPreMergeDatasetRefresh({ status: "failed", message, preMergeCheck })) {
      refreshAfterStaleCheck = confirmPreMergeDatasetRefreshFromMessage(message);
    }
  } finally {
    mergeReviewSession.submitting = false;
    queueGroupKeys.forEach((groupKey) => mergeInFlightGroupKeys.delete(groupKey));
    scheduleReviewStateSave();
    renderGroups();
    renderDetail();
  }

  if (refreshAfterStaleCheck) {
    await refreshLoadedDatasetFromSource();
  }
}

function isPreMergeFreshnessFailureMessage(message) {
  return /pre-merge freshness check failed/i.test(String(message || ""));
}

function getTrainingPairContext(group = getSelectedGroup()) {
  if (!group) return null;
  const pairs = getActiveGroupRecordPairs(group);
  if (!pairs.length) return null;
  const index = normalizeTrainingPairIndex(group.key, pairs);
  return {
    group,
    pairs,
    index,
    pair: pairs[index]
  };
}

function getActiveGroupRecordPairs(group) {
  const records = getActiveGroupRecords(group);
  const pairs = [];
  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      pairs.push({
        left: records[left],
        right: records[right],
        key: trainingPairKey(records[left], records[right])
      });
    }
  }
  return pairs;
}

function normalizeTrainingPairIndex(groupKey, pairs) {
  const storedIndex = state.trainingPairIndexes.get(groupKey) || 0;
  const index = Math.max(0, Math.min(pairs.length - 1, storedIndex));
  state.trainingPairIndexes.set(groupKey, index);
  return index;
}

function trainingPairKey(left, right) {
  return trainingPairKeyFromRecordKeys(recordKey(left), recordKey(right));
}

function trainingPairKeyFromRecordKeys(leftKey, rightKey) {
  const keys = [leftKey, rightKey].sort();
  return JSON.stringify([state.objectType, ...keys]);
}

function handleTrainingLabelAction(action) {
  if (Object.prototype.hasOwnProperty.call(TRAINING_LABELS, action)) {
    labelCurrentTrainingPair(action);
    return;
  }
  if (action === "previous-pair") {
    moveTrainingPair(-1);
    return;
  }
  if (action === "next-pair") {
    moveTrainingPair(1);
  }
}

function handleTrainingKeyboardShortcut(event) {
  if (event.defaultPrevented || isTypingTarget(event.target)) return;
  if (state.reviewMode !== "evaluate") return;

  const key = event.key.toLowerCase();
  const actions = {
    m: "match",
    n: "not_match",
    u: "unsure",
    arrowleft: "previous-pair",
    arrowright: "next-pair"
  };
  const action = actions[key];
  if (!action) return;
  if (!getTrainingPairContext()) return;

  event.preventDefault();
  handleTrainingLabelAction(action);
}

function handleGroupNavigationKeyboardShortcut(event) {
  if (event.defaultPrevented || isKeyboardActivationTarget(event.target)) return;
  if (event.key !== "Enter" || event.altKey || event.ctrlKey || event.metaKey) return;
  if (state.isLoadingFile || !els.csvObjectMenu.hidden) return;
  const direction = event.shiftKey ? -1 : 1;
  if (!canNavigateGroup(direction)) return;

  event.preventDefault();
  navigateGroup(direction);
}

function isTypingTarget(target) {
  const tagName = target?.tagName?.toLowerCase();
  return target?.isContentEditable || ["input", "select", "textarea"].includes(tagName);
}

function isKeyboardActivationTarget(target) {
  const tagName = target?.tagName?.toLowerCase();
  return isTypingTarget(target) || ["a", "button"].includes(tagName) || Boolean(target?.closest?.("a, button"));
}

function labelCurrentTrainingPair(label) {
  const context = getTrainingPairContext();
  if (!context) return;

  const now = new Date().toISOString();
  const { group, pair } = context;
  const existing = state.trainingLabels.get(pair.key);
  const pairScore = scoreOriginalRecordPair(pair.left, pair.right);
  state.trainingLabels.set(pair.key, {
    objectType: state.objectType,
    fileName: state.fileName,
    groupKey: group.key,
    groupScore: group.score,
    minPairScore: group.minPairScore,
    leftKey: recordKey(pair.left),
    rightKey: recordKey(pair.right),
    label,
    confidence: state.trainingConfidence,
    score: pairScore.value,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  });

  moveTrainingPair(1, true);
  visibleGroupsCache = null;
  scheduleReviewStateSave();
  renderTrainingExportButton();
  renderGroups();
  renderDetail();
}

function moveTrainingPair(direction, preferUnlabeled = false) {
  const context = getTrainingPairContext();
  if (!context) return;
  const { group, pairs, index } = context;

  if (preferUnlabeled) {
    for (let offset = 1; offset <= pairs.length; offset += 1) {
      const nextIndex = (index + offset) % pairs.length;
      if (!state.trainingLabels.has(pairs[nextIndex].key)) {
        state.trainingPairIndexes.set(group.key, nextIndex);
        return;
      }
    }
  }

  state.trainingPairIndexes.set(group.key, wrapIndex(index + direction, pairs.length));
  renderDetail();
}

function setTrainingConfidence(value) {
  if (!TRAINING_CONFIDENCE_LEVELS.includes(value)) return;
  state.trainingConfidence = value;

  const context = getTrainingPairContext();
  const currentLabel = context ? state.trainingLabels.get(context.pair.key) : null;
  if (currentLabel) {
    currentLabel.confidence = value;
    currentLabel.updatedAt = new Date().toISOString();
    state.trainingLabels.set(context.pair.key, currentLabel);
    scheduleReviewStateSave();
  }
}

function scoreOriginalRecordPair(leftRecord, rightRecord) {
  const context = getScoringContext(state.rows, state.objectType, state.mapping);
  const left = context.preparedRows[leftRecord.__rowIndex] || prepareRows([leftRecord], state.objectType, state.mapping)[0];
  const right = context.preparedRows[rightRecord.__rowIndex] || prepareRows([rightRecord], state.objectType, state.mapping)[0];
  return scorePreparedPair(left, right, context.scorer);
}

function getSelectedGroup() {
  return findGroupByKey(state.selectedGroupKey);
}

function trainingLabelCount() {
  return state.trainingLabels.size;
}

function separatedRecordTrainingCount() {
  let count = 0;
  state.separatedRecords.forEach((recordKeys) => {
    count += recordKeys?.size || 0;
  });
  return count;
}

function wrapIndex(index, length) {
  if (!length) return 0;
  return ((index % length) + length) % length;
}

function renderSeparatedRecords(group, records) {
  return `
    <div class="separated-records">
      <div class="separated-title">Separated records</div>
      <div class="record-strip separated-strip">
        ${records.map((record) => renderRecordCard(record, group, true, records.length)).join("")}
      </div>
    </div>
  `;
}

function renderRecordCard(record, group, isSeparated = false, activeCount = 0) {
  const currentDecision = state.decisions.get(group.key) || "";
  return `
    <article class="record-card ${isSeparated ? "is-separated" : ""}">
      <div class="record-card-status">
        ${renderDecisionBadge(currentDecision, "record-decision-badge")}
        ${isSeparated ? '<span class="record-separation-badge">Separated</span>' : ""}
      </div>
      <div class="record-card-main">
        <strong>${escapeHtml(displayName(record))}</strong>
        <span>${escapeHtml(recordKey(record))}</span>
        <span>${escapeHtml(displaySubtitle(record) || "No secondary fields")}</span>
      </div>
      <div class="record-card-actions">
        <button
          class="mini-button"
          type="button"
          data-record-action="${isSeparated ? "restore" : "separate"}"
          data-group-key="${escapeHtml(group.key)}"
          data-record-key="${escapeHtml(recordKey(record))}"
          ${!isSeparated && activeCount <= 1 ? "disabled" : ""}
        >${isSeparated ? "Restore" : "Separate"}</button>
      </div>
    </article>
  `;
}

function renderDecisionBadge(decision, className = "decision-badge") {
  const status = decision || "no-decision";
  const label = decision ? decisionLabel(decision) : "No decision";
  return `<span class="${className} ${status}" aria-label="Duplicate decision: ${escapeHtml(label)}">${escapeHtml(label)}</span>`;
}

function renderComparisonTable(group, bestPair) {
  const fields = OBJECT_CONFIG[state.objectType].displayFields;
  const records = getActiveGroupRecords(group);
  const resolutionContext = createFieldResolutionContext(group, records);
  return `
    <table class="comparison-table">
      <thead>
        <tr>
          <th>Field</th>
          ${records.map((record) => `<th>${escapeHtml(recordKey(record))}</th>`).join("")}
          <th>Best pair</th>
          <th>Accepted value</th>
        </tr>
      </thead>
      <tbody>
        ${fields.map((field) => renderFieldRow(group, field, bestPair, records, resolutionContext)).join("")}
      </tbody>
    </table>
  `;
}

function renderFieldRow(group, field, bestPair, records, resolutionContext) {
  const similarity = bestPair.fieldScores[field] ?? 0;
  const resolution = getFieldResolution(group, field, resolutionContext);
  return `
    <tr class="${resolution.hasDiscrepancy ? "has-discrepancy" : ""}">
      <td class="field-name">${escapeHtml(FIELD_LABELS[field] || field)}</td>
      ${records
        .map((record) => {
          const value = getDisplayFieldValue(record, field);
          return `<td class="field-value">${escapeHtml(value || "—")}</td>`;
        })
        .join("")}
      <td>
        <div class="similarity-bar" aria-label="${Math.round(similarity * 100)} percent similar">
          <span style="--similarity: ${Math.round(similarity * 100)}%"></span>
        </div>
      </td>
      <td class="accepted-value-cell">
        ${renderFieldResolutionControl(group, field, resolution)}
      </td>
    </tr>
  `;
}

function renderFieldResolutionControl(group, field, resolution) {
  if (!resolution.hasValues) return `<span class="accepted-static">—</span>`;
  if (!resolution.hasDiscrepancy) {
    return `<span class="accepted-static">${escapeHtml(resolution.acceptedValue || "—")}</span>`;
  }

  return `
    <label class="resolution-control">
      <span>${resolution.acceptedValue === resolution.suggestedValue ? "Suggested default" : "Override"}</span>
      <select class="field-resolution-select" data-group-key="${escapeHtml(group.key)}" data-field="${escapeHtml(field)}">
        ${resolution.options
          .map((option) => {
            const selected = option.value === resolution.acceptedValue ? "selected" : "";
            const label = option.value || "(blank)";
            const suffix = option.value === resolution.suggestedValue ? " (suggested)" : "";
            return `<option value="${escapeHtml(option.value)}" ${selected}>${escapeHtml(label + suffix)}</option>`;
          })
          .join("")}
      </select>
    </label>
  `;
}

function getDisplayFieldValue(record, field) {
  if (state.objectType === "contact") {
    const parts = getContactNameParts(record, state.mapping);
    if (field === "fullName") {
      return getValue(record, state.mapping.fullName) || toDisplayName(parts.fullName);
    }
    if (field === "firstName") {
      const rawFirstName = getValue(record, state.mapping.firstName);
      return normalizeGivenName(rawFirstName) ? rawFirstName : "";
    }
    if (field === "lastName") {
      const rawLastName = getValue(record, state.mapping.lastName);
      return normalizeFamilyName(rawLastName) ? rawLastName : "";
    }
  }
  return getValue(record, state.mapping[field]);
}

function getSeparatedRecordKeySet(group) {
  return state.separatedRecords.get(group.key) || new Set();
}

function getActiveGroupRecords(group) {
  const separatedKeys = getSeparatedRecordKeySet(group);
  return group.records.filter((record) => !separatedKeys.has(recordKey(record)));
}

function getSeparatedGroupRecords(group) {
  const separatedKeys = getSeparatedRecordKeySet(group);
  return group.records.filter((record) => separatedKeys.has(recordKey(record)));
}

function setRecordSeparated(groupKey, key, separated) {
  if (!groupKey || !key) return;
  const group = findGroupByKey(groupKey);
  if (!group) return;

  const recordKeys = new Set(state.separatedRecords.get(groupKey) || []);
  if (separated) {
    recordKeys.add(key);
  } else {
    recordKeys.delete(key);
  }

  if (recordKeys.size) {
    state.separatedRecords.set(groupKey, recordKeys);
  } else {
    state.separatedRecords.delete(groupKey);
  }

  clearMergePreviewState(groupKey);
  visibleGroupsCache = null;
  ensureSelectedGroupVisible();
  renderGroups();
  renderDetail();
  scheduleReviewStateSave();
}

function setMergeMasterSelection(groupKey, value) {
  if (!groupKey) return;
  const id = normalizeSalesforceIdForMerge(value);
  if (id) {
    mergeMasterSelections.set(groupKey, id);
  } else {
    mergeMasterSelections.delete(groupKey);
  }
  clearMergePreviewState(groupKey);
  renderDetail();
  scheduleReviewStateSave();
}

async function handleMergeAction(button) {
  if (button.dataset.mergeAction === "refresh-contact-ids") {
    await handleMissingContactIdRefresh(button);
    return;
  }
  if (button.dataset.mergeAction === "refresh-stale-data") {
    await handleStalePreMergeRefresh(button);
    return;
  }
  if (button.dataset.mergeAction === "cancel-batch-review") {
    clearMergePreviewState(button.dataset.groupKey || state.selectedGroupKey);
    renderDetail();
    return;
  }
  if (button.dataset.mergeAction === "previous-review-group") {
    navigateMergeReview(-1);
    return;
  }
  if (button.dataset.mergeAction === "next-review-group") {
    navigateMergeReview(1);
    return;
  }
  if (button.dataset.mergeAction === "confirm-merge") {
    await handleConfirmedMerge(button);
    return;
  }
  if (button.dataset.mergeAction === "download-merge-report") {
    downloadMergeReport(button);
    return;
  }
  if (button.dataset.mergeAction !== "merge") return;
  const groupKey = button.dataset.groupKey;
  const group = findGroupByKey(groupKey);
  if (!group || mergeInFlightGroupKeys.has(groupKey) || mergeReviewSession.submitting) return;

  const activeRecords = getActiveGroupRecords(group);
  const mergeState = getMergeState(group, activeRecords, state.decisions.get(group.key) || "");
  if (!mergeState.canSubmit) {
    window.alert(mergeState.description || "This group is not ready to merge.");
    return;
  }
  await startMergeReviewSession(groupKey);
}

async function handleMissingContactIdRefresh(button) {
  const groupKey = button.dataset.groupKey;
  const group = findGroupByKey(groupKey);
  if (!group) return;

  const activeRecords = getActiveGroupRecords(group);
  const mergeState = getMergeState(group, activeRecords, state.decisions.get(group.key) || "");
  const message = missingContactIdMergeMessage(mergeState.invalidRecords.length);
  const refreshSource = resolveContactsRefreshSource({ allowLatestContactsFallback: true });
  if (!refreshSource) {
    window.alert(`${message}\n\nThis dataset was loaded from a local file or an unknown source, so the app cannot re-pull it automatically. Re-run the Contacts pull/export with the Id field included, then import the fresh file.`);
    return;
  }

  const sourceLabel = refreshSource.displayName || refreshSource.fileName || "Latest Contacts";
  const confirmed = window.confirm(`${message}\n\n${refreshSource.isLatestContactsFallback ? "Load" : "Refresh"} ${sourceLabel} from Salesforce now?`);
  if (!confirmed) return;

  await refreshLoadedDatasetFromSource({
    source: refreshSource,
    title: "Refreshing Contacts",
    startMessage: `${refreshSource.isLatestContactsFallback ? "Loading" : "Fetching"} ${sourceLabel} with Contact IDs included.`,
    matchMessage: `Matching refreshed ${sourceLabel}.`
  });
}

async function handleStalePreMergeRefresh(button) {
  const message = button.closest(".merge-result")?.querySelector("span")?.textContent?.trim()
    || "Pre-merge freshness check failed. Salesforce has changed since this dataset was loaded.";
  const confirmed = confirmPreMergeDatasetRefreshFromMessage(message);
  if (!confirmed) return;
  await refreshLoadedDatasetFromSource();
}

async function checkSalesforcePreMergeFreshness({ groupKey, mergeState, mergeIds, records }) {
  const response = await fetch("/api/salesforce/premerge-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      objectType: state.objectType,
      groupKey,
      masterId: mergeState.selectedId,
      mergeIds,
      records
    })
  });
  const payload = await readApiJson(response);
  if (!response.ok) throw createApiError(payload, "Pre-merge freshness check failed.");
  return payload;
}

function buildSalesforcePreMergeRecords(records) {
  return records
    .map((record) => {
      const id = normalizeSalesforceIdForMerge(salesforceId(record));
      if (!id) return null;
      const fields = {};
      PREMERGE_FRESHNESS_FIELDS.forEach((field) => {
        if (!shouldIncludeSalesforcePreMergeField(field)) return;
        fields[field] = String(getDisplayFieldValue(record, field) || "");
      });
      return {
        id,
        name: displayName(record),
        rowIndex: Number.isFinite(record.__rowIndex) ? record.__rowIndex : null,
        fields,
        sourceRow: buildSalesforcePreMergeSourceRow(record)
      };
    })
    .filter(Boolean);
}

function buildMergePreviewState({ group, activeRecords, mergeState, mergeIds, preMergeRecords, masterFieldPayload, preMergeCheck }) {
  const resolutionContext = createFieldResolutionContext(group, activeRecords);
  const previewFields = OBJECT_CONFIG[state.objectType].displayFields.map((field) => {
    const resolution = getFieldResolution(group, field, resolutionContext);
    const masterValue = String(getDisplayFieldValue(mergeState.selectedRecord, field) || "");
    const reviewOnlyValue = resolution.acceptedValue != null && normalizeResolutionValue(resolution.acceptedValue) !== normalizeResolutionValue(masterValue)
      ? resolution.acceptedValue
      : "";
    return {
      field,
      label: FIELD_LABELS[field] || field,
      kind: reviewOnlyValue ? "review-only" : "master-kept",
      kindLabel: reviewOnlyValue ? "Review only" : "Master kept",
      resultValue: masterValue,
      reviewOnlyValue
    };
  });

  return {
    groupKey: group.key,
    masterId: mergeState.selectedId,
    masterName: displayName(mergeState.selectedRecord),
    mergeIds: [...mergeIds],
    mergeRecordChips: mergeState.mergeRecords.map(({ record, id }) => ({
      name: displayName(record),
      id
    })),
    records: preMergeRecords,
    masterFieldPayload,
    preMergeCheck: sanitizePreMergeCheck(preMergeCheck),
    previewFields,
    salesforceWritebackCount: previewFields.filter((field) => field.kind === "salesforce-writeback").length
  };
}

function buildSalesforcePreMergeSourceRow(record) {
  const source = record?.row && typeof record.row === "object" ? record.row : record;
  return Object.fromEntries(
    Object.entries(source || {})
      .filter(([key]) => !String(key || "").startsWith("__"))
      .map(([key, value]) => [key, value == null ? "" : String(value)])
  );
}

function shouldIncludeSalesforcePreMergeField(field) {
  if (field === "fullName") return Boolean(state.mapping.fullName || state.mapping.firstName || state.mapping.lastName);
  return Boolean(state.mapping[field]);
}

function confirmPreMergeDatasetRefresh(check) {
  return confirmPreMergeDatasetRefreshFromMessage(preMergeFreshnessSummary(check));
}

function confirmPreMergeDatasetRefreshFromMessage(message) {
  const refreshSource = resolveContactsRefreshSource();
  if (!refreshSource) {
    window.alert(
      `${message}\n\nThis dataset was loaded from a local file or an unknown source, so the app cannot refresh it automatically. Load a fresh Contacts export before merging.`
    );
    return false;
  }

  const sourceLabel = refreshSource.displayName || refreshSource.fileName || state.fileName || "the current Contacts dataset";
  return window.confirm(`${message}\n\nRefresh ${sourceLabel} from Salesforce now?`);
}

function canRefreshLoadedDatasetFromSource(options = {}) {
  return Boolean(resolveContactsRefreshSource(options));
}

function resolveContactsRefreshSource({ allowLatestContactsFallback = false } = {}) {
  if (state.objectType !== "contact" || !isServerBackedApp()) return null;
  if (state.datasetSource?.endpoint) {
    return {
      ...state.datasetSource,
      isLatestContactsFallback: false
    };
  }
  if (!allowLatestContactsFallback) return null;

  const latestContacts = latestContactsSourceFromRecentFiles() || defaultLatestContactsSource();
  return {
    ...latestContacts,
    isLatestContactsFallback: true
  };
}

function latestContactsSourceFromRecentFiles() {
  const recent = (state.recentFiles || [])
    .filter((record) => {
      if (!record?.endpoint || normalizeObjectType(record.objectType) !== "contact") return false;
      const text = `${record.endpoint} ${record.displayName || ""} ${record.name || ""}`.toLowerCase();
      return text.includes("staging-contacts") || text.includes("latest contacts");
    })
    .sort((left, right) => {
      const leftJson = String(left.format || left.name || left.endpoint || "").toLowerCase().endsWith(".json") || String(left.format || "").toLowerCase() === "json";
      const rightJson = String(right.format || right.name || right.endpoint || "").toLowerCase().endsWith(".json") || String(right.format || "").toLowerCase() === "json";
      if (leftJson !== rightJson) return leftJson ? -1 : 1;
      return (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0);
    })[0];
  if (!recent) return null;

  return {
    endpoint: String(recent.endpoint || ""),
    fileName: String(recent.name || "salesforce-report-latest.json"),
    displayName: String(recent.displayName || recent.name || "Latest Contacts"),
    objectType: "contact",
    format: String(recent.format || datasetFormatFromFileName(recent.name || recent.endpoint || "salesforce-report-latest.json")),
    contractVersion: String(recent.contractVersion || "")
  };
}

function defaultLatestContactsSource() {
  return {
    endpoint: "/api/staging-contacts/latest.json",
    fileName: "salesforce-report-latest.json",
    displayName: "Latest Contacts",
    objectType: "contact",
    format: "json",
    contractVersion: ""
  };
}

async function refreshLoadedDatasetFromSource(options = {}) {
  const source = { ...(options.source || state.datasetSource || {}) };
  if (!source.endpoint || !isServerBackedApp()) {
    window.alert("Automatic refresh is unavailable for this loaded dataset.");
    return;
  }

  const objectType = normalizeObjectType(source.objectType, state.objectType);
  const fileName = source.fileName || state.fileName || "salesforce-report-latest.json";
  const displayName = source.displayName || fileName;
  const format = source.format || datasetFormatFromFileName(source.endpoint || fileName);
  let loadStarted = false;
  const title = options.title || "Refreshing Contacts";
  const startMessage = options.startMessage || `Fetching ${displayName} from Salesforce.`;
  const matchMessage = options.matchMessage || `Matching ${displayName}.`;

  showLoadingModal(title, startMessage, 0);
  try {
    await nextPaint();
    const response = await fetch(source.endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error(`Dataset refresh failed: ${response.status}`);
    const datasetText = await response.text();
    loadStarted = true;
    beginFileLoad(fileName, objectType);
    showLoadingModal(title, matchMessage, 0);
    await loadDatasetText(datasetText, {
      fileName,
      objectType,
      format,
      size: datasetText.length,
      saveRecent: true,
      displayName,
      endpoint: source.endpoint
    });
    if (!state.reviewStateStatus) state.reviewStateStatus = "Dataset refreshed";
    renderSource();
  } catch (error) {
    if (isAbortError(error)) return;
    state.reviewStateStatus = error.message || "Dataset refresh failed";
    if (loadStarted) {
      state.loadError = state.reviewStateStatus;
      endFileLoad();
      renderDetail();
    }
    renderSource();
    window.alert(
      loadStarted
        ? `${state.reviewStateStatus}. Load a fresh Contacts export before merging.`
        : `${state.reviewStateStatus}. The current loaded data was left in place.`
    );
  } finally {
    hideLoadingModal();
  }
}

function preMergeFreshnessSummary(check) {
  const missingCount = Array.isArray(check?.missingIds) ? check.missingIds.length : 0;
  const deletedCount = Array.isArray(check?.deletedIds) ? check.deletedIds.length : 0;
  const changedFields = Array.isArray(check?.changedFields) ? check.changedFields : [];
  const parts = [];
  if (missingCount) parts.push(`${missingCount} missing`);
  if (deletedCount) parts.push(`${deletedCount} deleted`);
  if (changedFields.length) parts.push(`${changedFields.length} changed field${changedFields.length === 1 ? "" : "s"}`);
  const examples = changedFields.slice(0, 3).map(formatPreMergeFieldChange).filter(Boolean);
  const suffix = examples.length ? `\n\nExamples:\n${examples.join("\n")}` : "";
  return `Pre-merge freshness check failed (${parts.join(", ") || "stale data"}). Salesforce has changed since this dataset was loaded.${suffix}`;
}

function formatPreMergeFieldChange(change) {
  if (!change || typeof change !== "object") return "";
  const label = change.label || FIELD_LABELS[change.field] || change.field || "Field";
  const recordName = change.recordName || change.id || "Record";
  const loaded = String(change.loadedValue || "").trim() || "(blank)";
  const current = String(change.currentValue || "").trim() || "(blank)";
  return `- ${recordName}: ${label} changed from "${loaded}" to "${current}"`;
}

function buildSalesforceMergeMasterFieldPayload(group, mergeState) {
  if (state.objectType !== "contact" || !mergeState.selectedRecord) return {};

  const resolutionContext = createFieldResolutionContext(group);
  const resolution = getFieldResolution(group, CONTACT_LEAD_SOURCE_FIELD, resolutionContext);
  if (!resolution.hardRule) return {};

  const apiName = MERGE_FIELD_API_NAMES[CONTACT_LEAD_SOURCE_FIELD];
  const acceptedValue = String(resolution.acceptedValue || "").trim();
  const masterValue = String(getDisplayFieldValue(mergeState.selectedRecord, CONTACT_LEAD_SOURCE_FIELD) || "").trim();
  if (normalizeResolutionValue(acceptedValue) === normalizeResolutionValue(masterValue)) return {};

  return acceptedValue
    ? { masterFields: { [apiName]: acceptedValue } }
    : { masterFieldsToNull: [apiName] };
}

async function readApiJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function createApiError(payload, fallbackMessage) {
  const apiError = payload?.error && typeof payload.error === "object" ? payload.error : {};
  const error = new Error(apiError.message || fallbackMessage);
  const preMergeCheck = apiError.preMergeCheck || apiError.details?.preMergeCheck || payload?.preMergeCheck || null;
  if (preMergeCheck) error.preMergeCheck = sanitizePreMergeCheck(preMergeCheck);
  return error;
}

function getFieldResolution(group, field, resolutionContext = null) {
  const context = resolutionContext || createFieldResolutionContext(group);
  const options = context.optionsByField.get(field) || [];
  const nonBlankOptions = options.filter((option) => option.value);
  const hasValues = nonBlankOptions.length > 0;
  const hasDiscrepancy = nonBlankOptions.length > 1 || (nonBlankOptions.length === 1 && options.length > 1);
  const recordScores = hasValues ? context.recordScoresByField.get(field) : null;
  const suggestedValue = hasValues ? suggestAcceptedValue(options, field, recordScores) : "";
  const selectedValues = state.fieldResolutions.get(group.key) || {};
  const hasSelectedValue = Object.prototype.hasOwnProperty.call(selectedValues, field);
  const selectedValue = selectedValues[field];
  const optionValues = new Set(options.map((option) => option.value));
  const hardRule = getMergeFieldHardRule(group, field, context.activeRecords, optionValues);
  const masterDefaultValue = getExplicitMergeMasterFieldValue(group, field, context.activeRecords, optionValues);
  const acceptedValue =
    hardRule
      ? hardRule.acceptedValue
      : hasSelectedValue && optionValues.has(selectedValue)
      ? selectedValue
      : masterDefaultValue != null
        ? masterDefaultValue
        : suggestedValue;

  return {
    options,
    hasValues,
    hasDiscrepancy,
    suggestedValue,
    acceptedValue,
    hasExplicitResolution: !hardRule && hasSelectedValue && optionValues.has(selectedValue),
    masterDefaultValue,
    hardRule
  };
}

function createFieldResolutionContext(group, activeRecords = getActiveGroupRecords(group)) {
  const fields = OBJECT_CONFIG[state.objectType].displayFields;
  const optionsByField = new Map(fields.map((field) => [field, uniqueFieldOptions(activeRecords, field)]));
  const baselineValues = buildBaselineAcceptedValues(group, fields, optionsByField, activeRecords);
  const recordScoresByField = new Map(
    fields.map((field) => [field, buildResolutionRecordScores(activeRecords, fields, baselineValues, field)])
  );

  return {
    activeRecords,
    optionsByField,
    baselineValues,
    recordScoresByField
  };
}

function getExplicitMergeMasterFieldValue(group, field, activeRecords, optionValues) {
  const selectedMasterId = mergeMasterSelections.get(group.key);
  if (!selectedMasterId) return null;

  const masterRecord = activeRecords.find((record) => normalizeSalesforceIdForMerge(salesforceId(record)) === selectedMasterId);
  if (!masterRecord) return null;

  const value = String(getDisplayFieldValue(masterRecord, field) || "").trim();
  return optionValues.has(value) ? value : null;
}

function uniqueFieldOptions(records, field) {
  const seen = new Map();
  records.forEach((record) => {
    const value = getDisplayFieldValue(record, field);
    const displayValue = String(value || "").trim();
    const key = normalizeResolutionValue(displayValue);
    if (!seen.has(key)) {
      seen.set(key, {
        value: displayValue,
        count: 0,
        records: []
      });
    }
    const option = seen.get(key);
    option.count += 1;
    option.records.push(record);
  });
  return [...seen.values()];
}

function buildBaselineAcceptedValues(group, fields, optionsByField, activeRecords) {
  const baselineValues = new Map();
  const selectedValues = state.fieldResolutions.get(group.key) || {};

  fields.forEach((field) => {
    const options = optionsByField.get(field) || [];
    const optionValues = new Set(options.map((option) => option.value));
    const selectedValue = selectedValues[field];
    const hardRule = getMergeFieldHardRule(group, field, activeRecords, optionValues);
    const acceptedValue =
      hardRule
        ? hardRule.acceptedValue
        : selectedValue != null && optionValues.has(selectedValue)
          ? selectedValue
          : suggestAcceptedValue(options, field);
    baselineValues.set(field, acceptedValue);
  });

  return baselineValues;
}

function getMergeFieldHardRule(group, field, activeRecords, optionValues) {
  if (state.objectType !== "contact" || field !== CONTACT_LEAD_SOURCE_FIELD) return null;
  if (!state.mapping[CONTACT_LEAD_SOURCE_FIELD] || !state.mapping[CONTACT_CREATED_DATE_FIELD]) return null;

  const oldestRecord = oldestCreatedRecord(activeRecords);
  if (!oldestRecord) return null;

  const acceptedValue = String(getDisplayFieldValue(oldestRecord, CONTACT_LEAD_SOURCE_FIELD) || "").trim();
  if (!optionValues.has(acceptedValue)) return null;

  const dateValue = getDisplayFieldValue(oldestRecord, CONTACT_CREATED_DATE_FIELD);
  const dateLabel = formatCreatedDateForRule(dateValue);
  return {
    type: "oldest-created-lead-source",
    field,
    acceptedValue,
    record: oldestRecord,
    recordKey: recordKey(oldestRecord),
    label: "Oldest record rule",
    description: `Lead Source is locked to the oldest created Contact${dateLabel ? ` (${dateLabel})` : ""}.`
  };
}

function oldestCreatedRecord(records) {
  const candidates = records
    .map((record) => ({
      record,
      createdTime: parseCreatedTime(getDisplayFieldValue(record, CONTACT_CREATED_DATE_FIELD))
    }))
    .filter((candidate) => Number.isFinite(candidate.createdTime));

  if (!candidates.length) return null;

  return candidates.sort((left, right) => {
    const timeDiff = left.createdTime - right.createdTime;
    if (timeDiff !== 0) return timeDiff;
    return (left.record.__rowIndex ?? 0) - (right.record.__rowIndex ?? 0);
  })[0].record;
}

function parseCreatedTime(value) {
  const text = String(value || "").trim();
  if (!text) return NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatCreatedDateForRule(value) {
  const parsed = parseCreatedTime(value);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toLocaleDateString();
}

function buildResolutionRecordScores(records, fields, baselineValues, targetField) {
  const scores = new Map(records.map((record) => [record, 0]));

  fields.forEach((field) => {
    if (field === targetField) return;
    const acceptedValue = baselineValues.get(field);
    if (!acceptedValue || isBadResolutionValue(normalizeResolutionValue(acceptedValue))) return;

    records.forEach((record) => {
      if (!fieldValueMatchesAccepted(record, field, acceptedValue)) return;
      scores.set(record, scores.get(record) + 1);
    });
  });

  return scores;
}

function suggestAcceptedValue(options, field, recordScores = null) {
  return [...options]
    .sort((left, right) => {
      const scoreDiff =
        scoreResolutionOption(right, field, recordScores) - scoreResolutionOption(left, field, recordScores);
      if (scoreDiff !== 0) return scoreDiff;
      return left.value.localeCompare(right.value);
    })[0]?.value || "";
}

function scoreResolutionOption(option, field, recordScores = null) {
  const value = option.value;
  const normalized = normalizeResolutionValue(value);
  let score = option.count * 25;

  if (value) score += 50;
  if (value) score += resolutionRecordConfidenceBonus(option, recordScores);
  if (field === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) score += 20;
  if (field === "website" && normalizeWebsite(value)) score += 20;
  if (field === "billingPostalCode" && onlyDigits(value).length >= 5) score += 16;
  if (field === "fullName" || field === "firstName" || field === "lastName") score += Math.min(normalized.length, 30) / 6;
  if (isBadResolutionValue(normalized)) score -= 500;
  if (!value) score -= 200;

  return score;
}

function resolutionRecordConfidenceBonus(option, recordScores) {
  if (!recordScores || !option.records?.length) return 0;
  const bestRecordScore = Math.max(...option.records.map((record) => recordScores.get(record) || 0));
  return bestRecordScore * RESOLUTION_RECORD_CONFIDENCE_BONUS;
}

function isBadResolutionValue(normalized) {
  return /\b(do not use|donotuse|inactive|old|obsolete|deprecated|duplicate|dupe|test|unknown|n a|na|none|null)\b/.test(
    normalized
  );
}

function normalizeResolutionValue(value) {
  return normalizeText(String(value || "").replace(/do[-_\s]*not[-_\s]*use/gi, "do not use"));
}

function setFieldResolution(groupKey, field, value) {
  if (!groupKey || !field) return;
  const current = state.fieldResolutions.get(groupKey) || {};
  current[field] = value;
  state.fieldResolutions.set(groupKey, current);
  renderDetail();
  scheduleReviewStateSave();
}

function setMergeFieldResolution(groupKey, field, value) {
  if (!groupKey || !field) return;

  const group = findGroupByKey(groupKey);
  const resolution = group ? getFieldResolution(group, field) : null;
  if (resolution?.hardRule) {
    renderDetail();
    return;
  }

  const masterRecord = group ? getExplicitMergeMasterRecord(group) : null;
  const masterValue = masterRecord ? String(getDisplayFieldValue(masterRecord, field) || "").trim() : null;

  if (masterValue != null && normalizeResolutionValue(value) === normalizeResolutionValue(masterValue)) {
    clearFieldResolution(groupKey, field);
  } else {
    setFieldResolution(groupKey, field, value);
  }
}

function clearFieldResolution(groupKey, field) {
  const current = state.fieldResolutions.get(groupKey);
  if (!current || !Object.prototype.hasOwnProperty.call(current, field)) {
    renderDetail();
    return;
  }

  delete current[field];
  if (Object.keys(current).length) {
    state.fieldResolutions.set(groupKey, current);
  } else {
    state.fieldResolutions.delete(groupKey);
  }
  renderDetail();
  scheduleReviewStateSave();
}

function hasExplicitFieldResolution(groupKey, field) {
  return Object.prototype.hasOwnProperty.call(state.fieldResolutions.get(groupKey) || {}, field);
}

function getExplicitMergeMasterRecord(group) {
  const selectedMasterId = mergeMasterSelections.get(group.key);
  if (!selectedMasterId) return null;
  return getActiveGroupRecords(group).find((record) => normalizeSalesforceIdForMerge(salesforceId(record)) === selectedMasterId) || null;
}

function getAcceptedFieldValues(group) {
  const acceptedFields = {};
  const resolutionContext = createFieldResolutionContext(group);
  OBJECT_CONFIG[state.objectType].displayFields.forEach((field) => {
    const resolution = getFieldResolution(group, field, resolutionContext);
    acceptedFields[field] = resolution.acceptedValue;
  });
  return acceptedFields;
}

function getPrimaryNameField() {
  return state.objectType === "contact" ? "fullName" : "name";
}

function duplicateDecisionCount() {
  return [...state.decisions.values()].filter((decision) => decision === "duplicate").length;
}

function markDecision(decision) {
  if (!state.selectedGroupKey) return;
  state.decisions.set(state.selectedGroupKey, decision);
  visibleGroupsCache = null;
  ensureSelectedGroupVisible();
  renderGroups();
  renderDetail();
  scheduleReviewStateSave();
}

function exportDecisions() {
  const fields = OBJECT_CONFIG[state.objectType].displayFields;
  const rows = [
    [
      "Group Name",
      "Salesforce ID",
      ...fields.flatMap((field) => {
        const label = FIELD_LABELS[field] || field;
        return [`${label} - Record`, `${label} - Accepted Value`];
      }),
      "Duplicate Salesforce IDs"
    ]
  ];

  state.groups.forEach((group) => {
    const decision = state.decisions.get(group.key);
    if (decision !== "duplicate") return;
    const activeRecords = getActiveGroupRecords(group);
    if (activeRecords.length < 2) return;
    const acceptedValues = getAcceptedFieldValues(group);
    const canonicalRecord = selectCanonicalRecord(group, acceptedValues);
    const duplicateIds = activeRecords
      .filter((record) => record !== canonicalRecord)
      .map(salesforceId)
      .filter(Boolean);

    rows.push([
      acceptedValues[getPrimaryNameField()] || "",
      salesforceId(canonicalRecord),
      ...fields.flatMap((field) => [getDisplayFieldValue(canonicalRecord, field), acceptedValues[field] || ""]),
      duplicateIds.join("; ")
    ]);
  });

  downloadCsv(`${state.objectType}-duplicate-decisions.csv`, rows);
}

function exportScoredDataset() {
  if (!state.rows.length) return;
  downloadCsv(`${state.objectType}-dataset-with-scores.csv`, buildScoredDatasetRows());
}

function exportTrainingLabels() {
  if (!state.trainingLabels.size) return;
  downloadCsv(`${state.objectType}-training-labels.csv`, buildTrainingLabelRows());
}

function buildScoredDatasetRows() {
  const headers = Array.isArray(state.headers) && state.headers.length ? [...state.headers] : inferHeaders(state.rows);
  const exportHeaders = [...headers];
  if (!exportHeaders.includes("group")) exportHeaders.push("group");
  if (!exportHeaders.includes("score")) exportHeaders.push("score");

  const groupByRowIndex = new Map();
  state.groups.forEach((group) => {
    group.records.forEach((record) => {
      groupByRowIndex.set(record.__rowIndex, group);
    });
  });

  const rows = [exportHeaders];
  state.rows.forEach((record) => {
    const group = groupByRowIndex.get(record.__rowIndex) || null;
    rows.push(
      exportHeaders.map((header) => {
        if (header === "group") return group ? group.id : "";
        if (header === "score") return group ? group.score : "";
        return record[header] ?? "";
      })
    );
  });

  return rows;
}

function exportWorkspace() {
  if (!state.datasetKey) return;
  downloadJson(`${state.objectType}-workspace.json`, serializeWorkspaceRecord());
}

function serializeWorkspaceRecord() {
  return serializeCurrentReviewState();
}

function buildTrainingLabelRows() {
  const groupsByKey = new Map(state.groups.map((group) => [group.key, group]));
  const recordsByKey = new Map(state.rows.map((record) => [recordKey(record), record]));
  const rows = [
    [
      "object_type",
      "file_name",
      "group_key",
      "group_score",
      "min_pair_score",
      "left_salesforce_id",
      "right_salesforce_id",
      "left_record_key",
      "right_record_key",
      "left_name",
      "right_name",
      "pair_score",
      "label",
      "confidence",
      "reasons",
      "field_scores_json",
      "created_at",
      "updated_at"
    ]
  ];

  [...state.trainingLabels.values()]
    .sort(compareTrainingLabels)
    .forEach((label) => {
      const leftRecord = recordsByKey.get(label.leftKey);
      const rightRecord = recordsByKey.get(label.rightKey);
      const group = groupsByKey.get(label.groupKey);
      const score = leftRecord && rightRecord ? scoreOriginalRecordPair(leftRecord, rightRecord) : null;

      rows.push([
        label.objectType,
        label.fileName,
        label.groupKey,
        group?.score ?? label.groupScore,
        group?.minPairScore ?? label.minPairScore,
        leftRecord ? salesforceId(leftRecord) : "",
        rightRecord ? salesforceId(rightRecord) : "",
        label.leftKey,
        label.rightKey,
        leftRecord ? displayName(leftRecord) : "",
        rightRecord ? displayName(rightRecord) : "",
        score ? Math.round(score.value) : Math.round(label.score),
        label.label,
        label.confidence,
        score ? score.reasons.join("; ") : "",
        score ? JSON.stringify(score.fieldScores) : "",
        label.createdAt,
        label.updatedAt
      ]);
    });

  return rows;
}

function buildSeparatedRecordTrainingRows() {
  const groupsByKey = new Map(state.groups.map((group) => [group.key, group]));
  const rows = [];

  [...state.separatedRecords.entries()]
    .sort(([leftGroupKey], [rightGroupKey]) => leftGroupKey.localeCompare(rightGroupKey))
    .forEach(([groupKey, separatedKeys]) => {
      const group = groupsByKey.get(groupKey);
      if (!group || !separatedKeys?.size) return;

      const separatedKeySet = new Set(separatedKeys);
      const activeRecords = group.records.filter((record) => !separatedKeySet.has(recordKey(record)));
      const activeGroupSalesforceIds = activeRecords.map((record) => salesforceId(record)).filter(Boolean);
      const activeGroupRecordKeys = activeRecords.map(recordKey);
      const activeGroupNames = activeRecords.map(displayName).filter(Boolean);

      group.records
        .filter((record) => separatedKeySet.has(recordKey(record)))
        .sort((left, right) => displayName(left).localeCompare(displayName(right)))
        .forEach((record) => {
          rows.push({
            objectType: state.objectType,
            fileName: state.fileName || "",
            groupKey,
            groupScore: group.score ?? "",
            minPairScore: group.minPairScore ?? "",
            separatedSalesforceId: salesforceId(record),
            separatedRecordKey: recordKey(record),
            separatedName: displayName(record),
            activeGroupSalesforceIds,
            activeGroupRecordKeys,
            activeGroupNames
          });
        });
    });

  return rows;
}

async function sendTrainingLabelsToCodex() {
  const labelCount = trainingLabelCount();
  const separatedCount = separatedRecordTrainingCount();
  if (!labelCount && !separatedCount) return;

  els.codexTrainingButton.disabled = true;
  els.codexTrainingButton.textContent = "Sending...";

  try {
    const response = await fetch("/api/codex/training-labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objectType: state.objectType,
        fileName: state.fileName,
        datasetKey: state.datasetKey,
        sourceDataset: state.datasetSource,
        rowCount: state.rows.length,
        groupCount: state.groups.length,
        labelCount,
        separationCount: separatedCount,
        requestedAction:
          "Read the latest training-label CSV, separated-record JSON, and source dataset metadata. Use the source dataset endpoint or file described in the request; do not assume the source JSON lives in the repo root. Compare the user's labels and manual separations against the app's current scoring output, then improve the matching/scoring logic safely.",
        openCodexSession: true,
        rows: buildTrainingLabelRows(),
        separatedRows: buildSeparatedRecordTrainingRows()
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "Labels could not be sent to Codex.");

    const trainingSummary = [
      result.labelCount ? `${formatNumber(result.labelCount)} ${result.labelCount === 1 ? "label" : "labels"}` : "",
      result.separationCount
        ? `${formatNumber(result.separationCount)} separated ${result.separationCount === 1 ? "record" : "records"}`
        : ""
    ]
      .filter(Boolean)
      .join(" and ");
    state.reviewStateStatus = result.codexSessionLaunched
      ? `Opened Codex review session for ${trainingSummary}`
      : result.codexSessionError
        ? `Created Codex request, but Terminal could not open`
        : `Created Codex review request for ${trainingSummary}`;
    renderSource();
  } catch {
    state.reviewStateStatus = "Codex review request could not be created";
    renderSource();
  } finally {
    renderTrainingExportButton();
  }
}

function importTrainingLabels(file) {
  if (!state.rows.length) {
    state.reviewStateStatus = "Load a dataset before importing labels";
    renderSource();
    return;
  }

  showLoadingModal("Importing Labels", `Reading ${file.name}.`);
  const reader = new FileReader();
  reader.onload = async () => {
    await nextPaint();
    try {
      showLoadingModal("Importing Labels", "Matching labels to the loaded dataset.");
      await nextPaint();
      const parsed = parseCsv(String(reader.result || ""));
      const result = importTrainingLabelRows(parsed.rows);
      state.reviewStateStatus = trainingLabelImportStatus(result);
      visibleGroupsCache = null;
      ensureSelectedGroupVisible();
      renderSource();
      renderTrainingExportButton();
      renderGroups();
      renderDetail();
      if (result.imported) scheduleReviewStateSave();
    } catch {
      state.reviewStateStatus = "Labels could not be imported";
      renderSource();
    } finally {
      hideLoadingModal();
    }
  };
  reader.onerror = () => {
    state.reviewStateStatus = "Labels could not be imported";
    hideLoadingModal();
    renderSource();
  };
  reader.readAsText(file);
}

function importWorkspace(file) {
  if (!state.datasetKey) {
    state.reviewStateStatus = "Load a file-based dataset before importing a workspace";
    renderSource();
    return;
  }

  showLoadingModal("Importing Workspace", `Reading ${file.name}.`);
  const reader = new FileReader();
  reader.onload = async () => {
    await nextPaint();
    try {
      showLoadingModal("Importing Workspace", "Matching workspace data to the loaded dataset.");
      await nextPaint();
      const parsed = JSON.parse(String(reader.result || ""));
      const workspaceRecord = normalizeWorkspaceImportRecord(parsed);
      if (!workspaceRecord || (!isCompatibleReviewState(workspaceRecord) && workspaceRecord.id !== state.datasetKey)) {
        throw new Error("Workspace could not be matched to the loaded dataset.");
      }
      const result = workspaceRecord ? applySavedReviewState(workspaceRecord) : null;
      if (!result) throw new Error("Workspace could not be matched to the loaded dataset.");
      state.reviewStateStatus = workspaceImportStatus(result);
      visibleGroupsCache = null;
      ensureSelectedGroupVisible();
      renderSource();
      renderTrainingExportButton();
      renderGroups();
      renderDetail();
      if (Object.values(result).some((value) => Number(value) > 0)) scheduleReviewStateSave();
    } catch {
      state.reviewStateStatus = "Workspace could not be imported";
      renderSource();
    } finally {
      hideLoadingModal();
    }
  };
  reader.onerror = () => {
    state.reviewStateStatus = "Workspace could not be imported";
    hideLoadingModal();
    renderSource();
  };
  reader.readAsText(file);
}

function normalizeWorkspaceImportRecord(data) {
  if (!data || typeof data !== "object") return null;
  if (data.reviewState && typeof data.reviewState === "object") return data.reviewState;
  if (data.workspace && typeof data.workspace === "object") return data.workspace;
  if (Array.isArray(data.trainingLabels) || Array.isArray(data.decisions)) return data;
  return null;
}

function workspaceImportStatus(counts = {}) {
  const parts = [];
  if (counts.labels) parts.push(`${formatNumber(counts.labels)} ${counts.labels === 1 ? "label" : "labels"}`);
  if (counts.decisions) parts.push(`${formatNumber(counts.decisions)} ${counts.decisions === 1 ? "decision" : "decisions"}`);
  if (counts.mergeResults) parts.push(`${formatNumber(counts.mergeResults)} merge ${counts.mergeResults === 1 ? "result" : "results"}`);
  if (counts.mergeMasterSelections) parts.push(`${formatNumber(counts.mergeMasterSelections)} merge ${counts.mergeMasterSelections === 1 ? "master" : "masters"}`);
  if (counts.fieldResolutions) parts.push(`${formatNumber(counts.fieldResolutions)} field ${counts.fieldResolutions === 1 ? "choice" : "choices"}`);
  if (counts.separatedRecords) parts.push(`${formatNumber(counts.separatedRecords)} separated ${counts.separatedRecords === 1 ? "record" : "records"}`);
  return parts.length ? `Imported workspace with ${parts.join(", ")}` : "Imported workspace";
}

function importTrainingLabelRows(rows) {
  const index = buildSourceRecordKeyIndex();
  let imported = 0;
  let skipped = 0;
  let wrongObject = 0;

  rows.forEach((row) => {
    const labelObjectType = normalizeObjectType(row.object_type || state.objectType, "");
    if (labelObjectType && labelObjectType !== state.objectType) {
      wrongObject += 1;
      return;
    }

    const label = row.label;
    const leftKey = resolveImportedRecordKey(row.left_salesforce_id, row.left_record_key, index);
    const rightKey = resolveImportedRecordKey(row.right_salesforce_id, row.right_record_key, index);
    if (!Object.prototype.hasOwnProperty.call(TRAINING_LABELS, label) || !leftKey || !rightKey || leftKey === rightKey) {
      skipped += 1;
      return;
    }

    const pairKey = trainingPairKeyFromRecordKeys(leftKey, rightKey);
    const existing = state.trainingLabels.get(pairKey);
    const now = new Date().toISOString();
    state.trainingLabels.set(pairKey, {
      objectType: state.objectType,
      fileName: state.fileName,
      groupKey: findGroupKeyForRecordPair(leftKey, rightKey) || row.group_key || "",
      groupScore: Number(row.group_score) || 0,
      minPairScore: Number(row.min_pair_score) || 0,
      leftKey,
      rightKey,
      label,
      confidence: TRAINING_CONFIDENCE_LEVELS.includes(row.confidence) ? row.confidence : state.trainingConfidence,
      score: Number(row.pair_score) || 0,
      createdAt: existing?.createdAt || row.created_at || now,
      updatedAt: row.updated_at || now
    });
    imported += 1;
  });

  return {
    rows: rows.length,
    imported,
    skipped,
    wrongObject
  };
}

function buildSourceRecordKeyIndex() {
  const recordKeys = new Set();
  const keysBySalesforceId = new Map();

  state.rows.forEach((row) => {
    const key = recordKey(row);
    recordKeys.add(key);
    const id = salesforceId(row);
    if (id && !keysBySalesforceId.has(id)) keysBySalesforceId.set(id, key);
  });

  return {
    recordKeys,
    keysBySalesforceId
  };
}

function resolveImportedRecordKey(salesforceIdValue, recordKeyValue, index) {
  const id = String(salesforceIdValue || "").trim();
  if (id && index.keysBySalesforceId.has(id)) return index.keysBySalesforceId.get(id);

  const key = String(recordKeyValue || "").trim();
  return index.recordKeys.has(key) ? key : "";
}

function findGroupKeyForRecordPair(leftKey, rightKey) {
  for (const group of state.groups) {
    const keys = new Set(group.records.map(recordKey));
    if (keys.has(leftKey) && keys.has(rightKey)) return group.key;
  }
  return "";
}

function trainingLabelImportStatus(result) {
  if (!result.rows) return "No labels found in import";
  const parts = [`Imported ${formatNumber(result.imported)} ${result.imported === 1 ? "label" : "labels"}`];
  if (result.skipped) parts.push(`${formatNumber(result.skipped)} skipped`);
  if (result.wrongObject) parts.push(`${formatNumber(result.wrongObject)} wrong object`);
  return parts.join(", ");
}

function compareTrainingLabels(left, right) {
  return (
    left.objectType.localeCompare(right.objectType) ||
    left.groupKey.localeCompare(right.groupKey) ||
    left.leftKey.localeCompare(right.leftKey) ||
    left.rightKey.localeCompare(right.rightKey)
  );
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadJson(filename, data) {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function selectCanonicalRecord(group, acceptedValues) {
  return [...getActiveGroupRecords(group)].sort((left, right) => {
    const acceptedDiff = countAcceptedValueMatches(right, acceptedValues) - countAcceptedValueMatches(left, acceptedValues);
    if (acceptedDiff !== 0) return acceptedDiff;

    const populatedDiff = countPopulatedDisplayFields(right) - countPopulatedDisplayFields(left);
    if (populatedDiff !== 0) return populatedDiff;

    return recordKey(left).localeCompare(recordKey(right));
  })[0];
}

function countAcceptedValueMatches(record, acceptedValues) {
  return OBJECT_CONFIG[state.objectType].displayFields.reduce((count, field) => {
    const acceptedValue = acceptedValues[field];
    if (!acceptedValue) return count;
    return fieldValueMatchesAccepted(record, field, acceptedValue) ? count + 1 : count;
  }, 0);
}

function countPopulatedDisplayFields(record) {
  return OBJECT_CONFIG[state.objectType].displayFields.reduce((count, field) => {
    return getDisplayFieldValue(record, field) ? count + 1 : count;
  }, 0);
}

function fieldValueMatchesAccepted(record, field, acceptedValue) {
  return normalizeResolutionValue(getDisplayFieldValue(record, field)) === normalizeResolutionValue(acceptedValue);
}

function salesforceId(record) {
  return getValue(record, state.mapping.recordId);
}

function normalizeSalesforceIdForMerge(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(id) ? id : "";
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function decisionLabel(decision) {
  return decision === "not-duplicate" ? "Not Duplicate" : "Duplicate";
}

function toDisplayName(value) {
  return String(value || "")
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function capitalize(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value ?? ""));
  return String(value ?? "").replace(/["\\\]\[]/g, "\\$&");
}

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array.from({ length: size }, () => 0);
  }

  find(value) {
    if (this.parent[value] !== value) this.parent[value] = this.find(this.parent[value]);
    return this.parent[value];
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    if (this.rank[leftRoot] < this.rank[rightRoot]) {
      this.parent[leftRoot] = rightRoot;
    } else if (this.rank[leftRoot] > this.rank[rightRoot]) {
      this.parent[rightRoot] = leftRoot;
    } else {
      this.parent[rightRoot] = leftRoot;
      this.rank[leftRoot] += 1;
    }
  }
}
