import { supabase, getUserProfile } from "../js/api.js";
import { navigate } from "../js/router.js";
import { renderDashboardShell, renderDashboardPageHeading, getActiveListLimit } from "./dashboard.js";
import { toast } from "../js/ui.js";
import {
  validateImageFile,
  optimizeVehicleImage
} from "../js/fileValidation.js";
import {
  getMakes,
  getModels,
  getVariants,
  getHufaCatalogYears,
  getHufaCatalogVariants,
  isHufaCatalogAvailable,
  getBodyTypes,
  getFuelTypes,
  getTransmissionTypes,
  getDriveTypes,
  getColours,
  getConditions,
  getCommercialCategories,
  getFeatures,
  getProvinces,
  getCities,
  getBatteryCapacities,
  getBatteryRanges,
  getChargingTimes,
  getEngineCapacities
} from "../js/catalog.js";

import {
  saveDraft as saveUploadDraftRecord,
  loadDraft as loadUploadDraftRecord,
  clearDraft as clearUploadDraftRecord
} from "../js/draftStore.js";

/* PHASE 4 — dedicated IndexedDB image-draft store (Upload
Vehicle create mode only). Kept separate from the Phase 2
sessionStorage text draft: image bytes can never enter
draftStore. All operations are fail-safe and silent. */
import {
  saveUploadVehicleImageDraft,
  loadUploadVehicleImageDraft,
  clearUploadVehicleImageDraft
} from "../js/uploadVehicleImageStore.js";

// Vehicle catalogue is now loaded from the database.

/* =========================================================
  🔁 SHARED VEHICLE FORM (CREATE + EDIT)
========================================================= */

let selectedFiles = [];
let existingImages = []; // for edit mode
let isEdit = false;
let editId = null;

let FEATURE_OPTIONS = [];

let selectedFeatures = [];

let activeFeatureCategory = "";

let publishInProgress = false;

let cachedDraftUserId = null;

let uploadDraftSaveTimer = null;

let uploadDraftRestoring = false;

/* =========================================================
HUFA CATALOGUE VARIANT SELECTION (ISOLATED UI STATE)
---------------------------------------------------------
selectedHufaCatalog holds the ONE exact catalogue row the
seller picked via SELECT (never invented, always the DB row).
hufaCatalogYears caches catalogue years for make+model so the
year select never invents years. hufaCatalogRequestSeq guards
against stale async catalogue responses overwriting fresh UI.
The legacy #variant dropdown + OTHER/manual route stay intact
and are only hidden while exact catalogue results are shown.
Persistence boundary (no schema change): the SELECTED identity
(id + vehicle_code + variant + year) lives in this page state and
is mirrored into hidden inputs so the SAME text draft restores
it. `vehicles` has NO catalogue-identity column, so nothing
catalogue-specific is written to the database — the selection's
outcome is persisted through the EXISTING columns the form
already submits (variant, year, body_type, fuel_type,
transmission, drive_type, doors, seats).

========================================================= */
let selectedHufaCatalog = null;
/* Values written by the last catalogue selection. A later selection
can replace/clear these only while the seller has left them unchanged. */
const hufaCatalogFormWrites = new Map();
let hufaCatalogYears = [];
let hufaCatalogRows = [];
let hufaCatalogRequestSeq = 0;
let hufaYearMode = "manual";
/* Seller picked "enter the variant manually instead" for the
current Make + Model: the catalogue block steps aside and the
legacy Variant + manual Year fields come back until the next
Make/Model change (which resets this in hufaCatalogRefreshYears). */
let hufaCatalogManualOverride = false;
/* PHASE 2 FINAL REFINEMENT — catalogue presentation option.
"DETAILED VIEW" is the DEFAULT (full catalogue table, seller identity
first: SELECT + VARIANT stay pinned on the left and the HUFA Vehicle
Code closes the row) and "CARD VIEW"
is the SECOND option (the existing responsive cards). Presentation
only: both views are rendered from the SAME hufaCatalogRows array,
share ONE shared result-count element and ONE SELECT handler, and
switching views never re-queries the catalogue and never touches
the selected record. */
let hufaCatalogView = "detailed";

/* PHASE 4 — image draft state. scheduleUploadImageDraftSave
debounces IndexedDB writes; uploadImageDraftRestoring
suppresses saves while a restore is being applied (the
same guard pattern as the text draft). */
let uploadImageDraftSaveTimer = null;

let uploadImageDraftRestoring = false;

/* PHASE 4 — duplicate-restore protection (Part 15): an
in-flight guard so a remount racing an unfinished restore
can never append the same persisted images twice. */
let uploadImageDraftRestoreInFlight = false;

/* PHASE 4 — set after a successful restore so a synchronous
renderPreview() from later initialization never overwrites
the restored selection with an empty persist. */
let uploadImageDraftRestoredThisMount = false;

const UPLOAD_DRAFT_WORKFLOW = "uploadVehicle";

/* Explicit allowlist of non-file Upload Vehicle draft fields,
verified against the CURRENT form template: there are no
"type", "mileageUnit", "engineCapacity", "engineSize", "powerKw"
or finance-input ids in the page (finance amounts are engine-
calculated, EV uses the battery and charging selects, motorcycles
use engineCapacityCc). province/city are the only location selects;
year/mileage/price are plain inputs; trans/drive/doors/seats/
owners are plain selects; seller is the readonly profile-derived
input; location is a hidden derived field. No file/blob/token
keys. */
const UPLOAD_TEXT_DRAFT_IDS = [
  "vehicleCategory",
  "commercialCategory",
  "cabConfiguration",
  "payloadCapacityKg",
  "towingCapacityKg",
  "condition",
  "trans",
  "drive",
  "seller",
  "make",
  "model",
  "variant",
  "year",
  "mileage",
  "body",
  "color",
  "fuel",
  "batteryCapacity",
  "batteryRange",
  "chargingTime",
  "motorcycleType",
  "engineCapacityCc",
  "province",
  "city",
  "price",
  "description",
  "doors",
  "seats",
  "owners",
  "warrantyExpiry",
  "servicePlanExpiry",
  "maintenancePlanExpiry",
  /* PHASE 5 — existing template inputs consumed by the publish
  flow when "Other / Not Listed" is selected. Plain text only. */
  "customModel",
  "customVariant",
  /* HUFA catalogue selection identity (hidden inputs created at
  runtime beside #variant; persisted through the SAME text draft
  so refresh keeps the exact selected catalogue row). The year is
  stored as hufaCatalogYearValue because #hufaCatalogYear is the
  VISIBLE catalogue-year <select> — a hidden input must never
  share that id. */
  "hufaCatalogId",
  "hufaCatalogCode",
  "hufaCatalogVariant",
  "hufaCatalogYearValue",
  /* The VISIBLE catalogue-year dropdown is drafted too, so a year
  the seller picked without pressing SELECT survives a refresh.
  Its options are rebuilt on restore before the value is applied
  (a select with no matching option silently ignores .value). */
  "hufaCatalogYear",
  "hufaCatalogView",
  "hufaSpec_cc",
  "hufaSpec_engine_size_l",
  "hufaSpec_kw",
  "hufaSpec_torque_nm",
  "hufaSpec_cylinders",
  "hufaSpec_fuel_consumption_l100",
  "hufaSpec_co2_emissions_gkm",
  "hufaSpec_electric_range_km",
  /* "Enter the variant manually instead" override: persisted so a
  seller who abandoned the catalogue for this Make + Model still
  sees the plain Variant + Year fields after a page reload. */
  "hufaCatalogManual",
  /* PHASE 5 — #vehicleSearch (Search Vehicle helper input).
  Persisted with the SAME draft and restored by the SAME text
  loop; restoring only writes the value (no input event is
  dispatched), so the lookup dropdown cannot re-open on load. */
  "vehicleSearch"
];

const UPLOAD_CHECKBOX_DRAFT_IDS = [
  "financeAvailable",
  "vatIncluded",
  "priceNegotiable",
  "serviceHistory",
  "ownershipVerified",
  "accidentFree",
  "roadworthyCertificate",
  "certifiedPreOwned",
  "warrantyIncluded",
  "servicePlanIncluded",
  "maintenancePlanIncluded"
];

function uploadDraftEl(id){
  return document.getElementById(id);
}

/* Resolves the current authenticated user id for the draft key.
Result is cached per page session. Returns "" when signed out
so no shared/anonymous draft can leak between users. */
async function resolveUploadDraftUserId(){

  if(typeof cachedDraftUserId === "string" && cachedDraftUserId){
    return cachedDraftUserId;
  }

  try{

    const { data } = await supabase.auth.getUser();

    const id = data?.user?.id;

    if(typeof id === "string" && id){
      cachedDraftUserId = id;
      return id;
    }

  }catch(e){}

  return "";

}

function collectUploadDraft(){

  const draft = {};

  for(const id of UPLOAD_TEXT_DRAFT_IDS){

    draft[id] =
      typeof uploadDraftEl(id)?.value === "string"
        ? uploadDraftEl(id).value
        : "";

  }

  for(const id of UPLOAD_CHECKBOX_DRAFT_IDS){

    draft[id] = uploadDraftEl(id)
      ? uploadDraftEl(id).checked === true
      : false;

  }

  draft.hufaCatalogBooleanSpecs = {};
  for(const key of ["turbocharged", "fast_charging"]){
    const field = uploadDraftEl(`hufaSpec_${key}`);
    if(field){ draft.hufaCatalogBooleanSpecs[key] = field.checked === true; }
  }

  draft.selectedFeatures = [...selectedFeatures];

  return draft;

}

function isSafeUploadDraft(value){

  if(!value || typeof value !== "object" || Array.isArray(value)){
    return false;
  }

  const allowed = new Set([
    ...UPLOAD_TEXT_DRAFT_IDS,
    ...UPLOAD_CHECKBOX_DRAFT_IDS,
    "selectedFeatures",
    "activeFeatureCategory",
    "featureSearch",
    "hufaCatalogBooleanSpecs"
  ]);

  for(const key of Object.keys(value)){

    if(!allowed.has(key)){
      return false;
    }

    if(key === "selectedFeatures"){

      if(!Array.isArray(value[key])){
        return false;
      }

      for(const item of value[key]){

        if(typeof item !== "string"){
          return false;
        }

      }

      continue;

    }

    if(key === "hufaCatalogBooleanSpecs"){
      if(!value[key] || typeof value[key] !== "object" || Array.isArray(value[key])) return false;
      if(Object.keys(value[key]).some((specKey)=>!["turbocharged", "fast_charging"].includes(specKey) || typeof value[key][specKey] !== "boolean")) return false;
      continue;
    }

    if(UPLOAD_CHECKBOX_DRAFT_IDS.includes(key)){

      if(typeof value[key] !== "boolean"){
        return false;
      }

      continue;

    }

    if(typeof value[key] !== "string"){
      return false;
    }

  }

  return true;

}

/* PHASE 5 — synchronous text-draft write. Safe to call during
pagehide because it never awaits: it reads the CURRENT DOM and
writes sessionStorage immediately. The caller must have a
known user id (cachedDraftUserId). Returns true when written. */
function writeUploadTextDraft(){

  if(typeof cachedDraftUserId !== "string" || !cachedDraftUserId){
    return false;
  }

  const draft = collectUploadDraft();

  /* PHASE 5 — blank-overwrite guard: if EVERY persisted field
  is empty (typically because the timer fired after SPA
  navigation replaced the form DOM), keep the existing draft
  instead of destroying it with empty values. A real
  all-blank form state is still written whenever at least one
  checkbox/feature remains, and the publish flow clears the
  draft explicitly on success. */
  const anyText =
  UPLOAD_TEXT_DRAFT_IDS.some(
    (id) => (draft[id] || "").trim().length > 0
  );

  const anyChecked =
  UPLOAD_CHECKBOX_DRAFT_IDS.some(
    (id) => draft[id] === true
  );

  const anyCatalogBooleanChecked = Object.values(draft.hufaCatalogBooleanSpecs).some(Boolean);

  if(
    !anyText &&
    !anyChecked &&
    !anyCatalogBooleanChecked &&
    !draft.selectedFeatures.length
  ){
    return false;
  }

  saveUploadDraftRecord(
    UPLOAD_DRAFT_WORKFLOW,
    cachedDraftUserId,
    {
      ...draft,
      activeFeatureCategory,
      featureSearch: uploadDraftEl("featureSearch")?.value || ""
    },
    /* Account/seller type metadata mirrors the visible
    seller control; no new account behaviour is invented. */
    { accountType: draft.seller || "" }
  );

  return true;

}

/* PHASE 5 — immediate (non-debounced) text-draft write. Used
by the debounced scheduler; the pagehide flush uses the
synchronous writeUploadTextDraft() fast path instead, because
an awaited auth call can never complete during page unload. */
async function saveUploadTextDraftNow(){

  if(isEdit){
    return;
  }

  if(uploadDraftRestoring){
    return;
  }

  const userId = await resolveUploadDraftUserId();

  if(!userId){
    return;
  }

  writeUploadTextDraft();

}

function scheduleUploadDraftSave(){

  if(isEdit){
    return;
  }

  if(uploadDraftRestoring){
    return;
  }

  if(uploadDraftSaveTimer){
    clearTimeout(uploadDraftSaveTimer);
  }

  uploadDraftSaveTimer = setTimeout(()=>{

    uploadDraftSaveTimer = null;

    saveUploadTextDraftNow();

  }, 400);

}

/* PHASE 5 — flush a pending text-draft write immediately
(pagehide / SPA-nav click). When the user id is already cached
(the normal case after restore) the write is done
SYNCHRONOUSLY so it always lands inside pagehide; otherwise it
falls back to the async path. */
function flushUploadTextDraftNow(){

  if(isEdit){
    return;
  }

  if(!uploadDraftSaveTimer){
    return;
  }

  clearTimeout(uploadDraftSaveTimer);

  uploadDraftSaveTimer = null;

  if(typeof cachedDraftUserId === "string" && cachedDraftUserId){

    try{
      writeUploadTextDraft();
    }catch(e){}

    return;

  }

  saveUploadTextDraftNow().catch(()=>{});

}

/* PHASE 5 — one pagehide listener per MODULE LIFETIME: a
pending debounced text-draft write is flushed on refresh, tab
close and SPA navigation away, so the last typed values can
never be lost inside the un-fired 400ms timer. */
window.addEventListener(
  "pagehide",
  ()=>{
    flushUploadTextDraftNow();
  }
);

/* PHASE 5 — SPA navigation does NOT fire pagehide (no document
unload on pushState navigation), so a click on any in-app
navigation control flushes the pending draft first, in the
capture phase, BEFORE the router unmounts the form DOM.
Matching is deliberately narrow: real anchors with data-link /
href, and elements whose inline onclick starts a navigate()/
loadView()/goDashboardView() call. Ordinary form clicks are
untouched. */
document.addEventListener(
  "click",
  (e)=>{

    if(isEdit){
      return;
    }

    if(!uploadDraftSaveTimer){
      return;
    }

    const target = e.target;

    if(!(target instanceof Element)){
      return;
    }

    const navEl =
    target.closest(
      "a[href], a[data-link], [data-link], " +
      "[onclick*='navigate('], " +
      "[onclick*='loadView('], " +
      "[onclick*='goDashboardView(']"
    );

    if(navEl){
      flushUploadTextDraftNow();
    }

  },
  true
);

function setUploadDraftText(id, value){

  if(typeof value !== "string"){
    return;
  }

  const el = uploadDraftEl(id);

  if(!el || typeof el.value === "undefined"){
    return;
  }

  el.value = value;

}

function setUploadDraftCheckbox(id, value){

  const el = uploadDraftEl(id);

  if(!el || typeof el.checked === "undefined"){
    return;
  }

  el.checked = value === true;

}

function setUploadDraftSelect(id, value){

  if(typeof value !== "string" || !value){
    return;
  }

  const el = uploadDraftEl(id);

  if(!el || !el.options){
    return;
  }

  for(const opt of el.options){

    if(opt.value === value){
      el.value = value;
      return;
    }

  }

}

async function restoreUploadDraft(){

  /* Edit mode never consumes the create draft. */
  if(isEdit){
    return;
  }

  const userId = await resolveUploadDraftUserId();

  if(!userId){
    return;
  }

  const draft = loadUploadDraftRecord(
    UPLOAD_DRAFT_WORKFLOW,
    userId
  );

  if(!draft || !isSafeUploadDraft(draft)){
    return;
  }

  /* Suppress debounced saves while values are applied. */
  uploadDraftRestoring = true;

  try{

    /* 1. Controlling fields first. vehicleCategory drives the
    make catalogue (fillMakes filters by category), so re-fill
    make options for the restored category before selecting. */
    setUploadDraftSelect("vehicleCategory", draft.vehicleCategory);

    /* PHASE 5 — AWAITED: the toggle repopulates the make
    catalogue for the restored category, so Make/Model/Variant
    below are applied against a POPULATED option list in strict
    dependency order (Vehicle Type → Make → Model → Variant).
    (The old standalone fillMakes() immediately before this call
    was PROVABLY redundant — the toggle clears #make and awaits
    its own fillMakes() for the same live category — so one
    duplicate catalogue round-trip per init was removed here.) */
    await toggleVehicleCategory();

    /* Commercial cascade: commercialCategory rebuilds the cab
    option set (updateCabConfigurations), then cab determines
    the payload/towing option sets. Restore in that order. */
    setUploadDraftSelect("commercialCategory", draft.commercialCategory);

    updateCabConfigurations();

    setUploadDraftSelect("cabConfiguration", draft.cabConfiguration);

    updatePayloadOptions(
      uploadDraftEl("commercialCategory")?.value || "",
      uploadDraftEl("cabConfiguration")?.value || ""
    );
    updateTowingOptions(
      uploadDraftEl("commercialCategory")?.value || "",
      uploadDraftEl("cabConfiguration")?.value || ""
    );

    setUploadDraftSelect("payloadCapacityKg", draft.payloadCapacityKg);
    setUploadDraftSelect("towingCapacityKg", draft.towingCapacityKg);

    /* Selects populated by catalogue init; set only when the
    option already exists to avoid clobbering init. seller is
    NOT restored here: it is the readonly profile-derived input
    prefilled from the account profile at init. */
    setUploadDraftSelect("condition", draft.condition);
    toggleMileageField();
    setUploadDraftSelect("trans", draft.trans);
    setUploadDraftSelect("drive", draft.drive);
    setUploadDraftSelect("body", draft.body);
    setUploadDraftSelect("color", draft.color);
    setUploadDraftSelect("fuel", draft.fuel);

    toggleEVFields();
    toggleMotorcycleFields();

    setUploadDraftSelect("motorcycleType", draft.motorcycleType);
    setUploadDraftSelect("engineCapacityCc", draft.engineCapacityCc);

    /* 2. Cascading selects in dependency order. PHASE 5 — the
    cascade now reuses the SAME live-path populators the change
    handlers use (fillModels / fillVariants read the DOM values
    set immediately above), so the "Other / Not Listed" options
    exist and a restored __OTHER_MODEL__ / __OTHER__ selection
    can actually be applied — the previous populate*Options path
    never appended those options and silently dropped the value. */
    setUploadDraftSelect("make", draft.make);

    if(draft.make){
      await fillModels();
    }

    setUploadDraftSelect("model", draft.model);

    if(draft.make && draft.model){
      await fillVariants();
    }

    setUploadDraftSelect("variant", draft.variant);

    /* HUFA catalogue: hidden identity inputs are created lazily,
    so ensure they exist before the generic text-restore loop
    writes the persisted selection into them. They are plain
    hidden inputs (no .options), so setUploadDraftSelect() above
    ignores them and they are restored via setUploadDraftText(). */
    hufaCatalogHiddenId("hufaCatalogId");
    hufaCatalogHiddenId("hufaCatalogCode");
    hufaCatalogHiddenId("hufaCatalogVariant");
    hufaCatalogHiddenId("hufaCatalogYearValue");

    setUploadDraftSelect("province", draft.province);

    if(draft.province){
      await populateCityOptions(draft.province);
    }

    setUploadDraftSelect("city", draft.city);

    /* 3. Remaining text/number/date fields. seller is skipped:
    it is readonly and profile-derived (re-prefilled at init). */
    for(const id of UPLOAD_TEXT_DRAFT_IDS){

      if(
        id === "make" ||
        id === "model" ||
        id === "variant" ||
        id === "province" ||
        id === "city" ||
        id === "seller"
      ){
        continue;
      }

      setUploadDraftText(id, draft[id]);

    }

    /* 4. Checkboxes as booleans. */
    for(const id of UPLOAD_CHECKBOX_DRAFT_IDS){
      setUploadDraftCheckbox(id, draft[id]);
    }

    /* 5. Conditional visibility from restored controllers. */
    toggleEVFields();
    toggleMotorcycleFields();
    toggleFinanceFields();

    /* PHASE 5 — custom model/variant visibility. These two
    free-text inputs are part of the CURRENT form (used by the
    publish flow when "Other / Not Listed" is selected) and are
    persisted with the text allowlist; their show/hide state is
    derived, so re-run the exact existing toggles here. */
    toggleCustomModel();
    toggleCustomVariant();

    /* PHASE 5 — warranty/service/maintenance enable sync. A
    programmatic .checked assignment fires no change event, so
    the existing initForm sync (which disables/clears the expiry
    input) would leave a restored "Included" checkbox with a
    disabled date field. Re-dispatch the existing change event
    for checked boxes only; uploadDraftRestoring suppresses any
    draft save this would otherwise trigger. */
    [
      "warrantyIncluded",
      "servicePlanIncluded",
      "maintenancePlanIncluded"
    ].forEach((cbId)=>{

      const cb = uploadDraftEl(cbId);

      if(cb && cb.checked){
        cb.dispatchEvent(new Event("change"));
      }

    });

    /* 5b. trans/drive/doors/seats/owners are plain template
    selects (already set above); seller is readonly/profile-
    derived and intentionally not re-applied from the draft. */

    /* 6. Features: only values present in the catalogue. */
    if(Array.isArray(draft.selectedFeatures) && FEATURE_OPTIONS.length){

      const valid = new Set(FEATURE_OPTIONS.map((f) => f.value));

      selectedFeatures = draft.selectedFeatures.filter((v) => valid.has(v));

    } else if(Array.isArray(draft.selectedFeatures)){

      selectedFeatures = [...draft.selectedFeatures];

    }

    if(typeof draft.activeFeatureCategory === "string" && draft.activeFeatureCategory){
      activeFeatureCategory = draft.activeFeatureCategory;
    }

    const searchEl = uploadDraftEl("featureSearch");

    if(searchEl && typeof draft.featureSearch === "string"){
      searchEl.value = draft.featureSearch;
    }

    renderFeatureChips();

    const hidden = uploadDraftEl("features");

    if(hidden){
      hidden.value = JSON.stringify(selectedFeatures);
    }

    const countEl = uploadDraftEl("featureCount");

    if(countEl){
      countEl.textContent = `${selectedFeatures.length} selected`;
    }

    /* 7. Description counter refresh. */
    initDescriptionCounter();

    /* HUFA catalogue: after the generic restore, rebuild the
    Catalogue Year options for the restored Make + Model and, if
    the draft held a catalogue selection, re-fetch that Year's
    rows and re-apply the same catalogue id (fresh DB row wins).
    Never invents codes: if the row is gone, identity clears and
    the manual Variant/OTHER route remains. Runs while
    uploadDraftRestoring is still true, so the spec fields applied
    by a re-selected catalogue row cannot trigger a draft save. */
    try{
      await hufaCatalogRestoreFromDraft(draft);
    }catch(e){}

  }finally{

    uploadDraftRestoring = false;

  }

}

function bindUploadDraftListeners(){

  /* Edit mode values must never feed the create draft. */
  if(isEdit){
    return;
  }

  const ids = new Set([
    ...UPLOAD_TEXT_DRAFT_IDS,
    ...UPLOAD_CHECKBOX_DRAFT_IDS,
    "featureSearch",
    "features"
  ]);

  for(const id of ids){

    const el = uploadDraftEl(id);

    if(!el || el.dataset.draftBound === "1"){
      continue;
    }

    el.dataset.draftBound = "1";

    el.addEventListener("input", scheduleUploadDraftSave);
    el.addEventListener("change", scheduleUploadDraftSave);

  }

  /* Feature picker interactions re-render via renderFeatureChips
  and update the hidden #features input; that input is already
  bound above, but its value is changed programmatically (not by
  user input events), so also listen on the picker containers. */
  const chipContainers = [
    "featureChips",
    "selectedFeatureChips"
  ];

  for(const cid of chipContainers){

    const c = uploadDraftEl(cid);

    if(!c || c.dataset.draftBound === "1"){
      continue;
    }

    c.dataset.draftBound = "1";

    c.addEventListener("click", scheduleUploadDraftSave);
    c.addEventListener("change", scheduleUploadDraftSave);

  }

}

/* PHASE 2 — create-mode draft restore. Runs once per page
session after catalogue options exist, so cascading selects
(province→city, make→model→variant) restore in order and
conditional sections/features/counter refresh correctly.
Edit mode (?id=) never restores; failures are silent. */
let uploadDraftRestoredThisSession = false;

async function maybeRestoreUploadDraftOnce(){

  if(uploadDraftRestoredThisSession){
    return;
  }

  uploadDraftRestoredThisSession = true;

  if(isEdit){
    return;
  }

  try{
    await restoreUploadDraft();
  }catch(e){
    bindUploadDraftListeners();
    return;
  }

  bindUploadDraftListeners();

  /* Draft restore rewrote #location from province/city, so
  refresh the derived display in case it lagged. */
  updateLocation();

}

/* =========================================================
UPLOAD SESSION
========================================= */

/* PHASE 4 — IMAGE DRAFT PERSISTENCE.
Persist the current selectedFiles list (exact array order)
to the dedicated IndexedDB store so images survive refresh,
SPA navigation away/back and back/forward remounts.
Create mode only, authenticated user only, and never while
a restore is being applied. All failures are silent and
never block the in-memory image flow. */
function scheduleUploadImageDraftSave(){

  if(isEdit){
    return;
  }

  if(uploadImageDraftRestoring){
    return;
  }

  if(uploadImageDraftSaveTimer){
    clearTimeout(uploadImageDraftSaveTimer);
  }

  /* Debounced: rapid move/cover operations coalesce into one
  IndexedDB transaction instead of one per click. */
  uploadImageDraftSaveTimer = setTimeout(async ()=>{

    uploadImageDraftSaveTimer = null;

    const userId =
    await resolveUploadDraftUserId();

    if(!userId){
      return;
    }

    await saveUploadVehicleImageDraft(
      userId,
      [...selectedFiles]
    );

  }, 300);

}

/* PHASE 4 — restore the persisted image draft on a create-mode
mount. Rebuilds REAL File objects (name/type/lastModified +
bytes) so the existing renderPreview/replace/remove/move/
publish pipeline consumes them unchanged. Enforces the
existing MAX_IMAGES limit, skips invalid/corrupt entries and
fails safely (a broken record can never crash the page). */
async function restoreUploadImageDraft(){

  if(isEdit){
    return;
  }

  if(uploadImageDraftRestoreInFlight){
    return;
  }

  /* Something was already added this mount (or a previous
  restore landed) — never double-load or overwrite it. */
  if(
    selectedFiles.length ||
    uploadImageDraftRestoredThisMount
  ){
    return;
  }

  uploadImageDraftRestoreInFlight = true;

  uploadImageDraftRestoring = true;

  try{

    const userId =
    await resolveUploadDraftUserId();

    if(!userId){
      return;
    }

    const images =
    await loadUploadVehicleImageDraft(userId);

    if(
      !Array.isArray(images) ||
      !images.length
    ){
      return;
    }

    if(
      selectedFiles.length ||
      uploadImageDraftRestoredThisMount
    ){
      return;
    }

    const rebuilt = [];

    for(const image of images){

      /* MAX_IMAGES remains absolute: never restore more
      than the existing pipeline would accept. */
      if(rebuilt.length >= MAX_IMAGES){
        break;
      }

      try{

        if(
          !image ||
          typeof image !== "object" ||
          !(image.bytes instanceof ArrayBuffer) ||
          !image.bytes.byteLength
        ){
          continue;
        }

        rebuilt.push(
          new File(
            [image.bytes],
            typeof image.name === "string" && image.name
              ? image.name
              : "image",
            {
              type:
                typeof image.type === "string"
                  ? image.type
                  : "",
              lastModified:
                typeof image.lastModified === "number" &&
                image.lastModified > 0
                  ? image.lastModified
                  : Date.now()
            }
          )
        );

      }catch(e){
        /* Corrupt entry: skip it, keep the rest. */
        continue;
      }

    }

    if(
      !rebuilt.length ||
      selectedFiles.length ||
      uploadImageDraftRestoredThisMount
    ){
      return;
    }

    selectedFiles = rebuilt;

    uploadImageDraftRestoredThisMount = true;

    renderPreview();

  }catch(e){

    /* Restoration is best-effort only: any failure leaves the
    in-memory flow fully usable with an empty selection. */
    console.warn(
      "Upload image draft restore failed",
      e
    );

  }finally{

    uploadImageDraftRestoring = false;

    uploadImageDraftRestoreInFlight = false;

  }

}

/* PHASE 4 — clear ONLY the current authenticated user's
Upload Vehicle image draft. Used after successful publish
(alongside the Phase 2 text-draft clear; failures return
before it, so failed publishes keep the draft). */
function clearUploadImageDraftForCurrentUser(){

  resolveUploadDraftUserId()
    .then((draftUserId)=>{
      if(draftUserId){
        clearUploadVehicleImageDraft(draftUserId);
      }
    })
    .catch(()=>{});

}

/* PHASE 5 — IMMEDIATE (non-debounced) image-draft save.
Used by the pagehide flush: a debounced save still sitting in
its 300ms timer would never fire on refresh/navigation, which
is the actual reason images vanished between "add image" and
"refresh". Runs only in create mode, never during a restore,
and cancels any pending debounced write so the final state is
always the one that lands.

IMPORTANT — this flush must NEVER run against a selection that
has not been initialised yet: if the page is refreshed while
initForm is still restoring, selectedFiles is still empty and
a naive save would DELETE the stored image record before the
restore ever ran. The guard below only allows an empty write
when THIS mount actually restored images first (i.e. the user
then removed them all — a real, intended empty list). */
async function flushUploadImageDraftNow(){

  if(isEdit){
    return;
  }

  if(uploadImageDraftRestoring){
    return;
  }

  if(
    !selectedFiles.length &&
    !uploadImageDraftRestoredThisMount
  ){
    return;
  }

  if(uploadImageDraftSaveTimer){
    clearTimeout(uploadImageDraftSaveTimer);
    uploadImageDraftSaveTimer = null;
  }

  const userId =
  await resolveUploadDraftUserId();

  if(!userId){
    return;
  }

  await saveUploadVehicleImageDraft(
    userId,
    [...selectedFiles]
  );

}

/* PHASE 5 — one pagehide listener per MODULE LIFETIME (the
module survives SPA navigation; the listener is a stable
singleton, never re-registered per mount). Refresh, tab close
and SPA navigation away all flush the pending image draft so
nothing added/reordered/removed in the last 300ms is lost. */
window.addEventListener(
  "pagehide",
  ()=>{
    flushUploadImageDraftNow().catch(()=>{});
  }
);

function resetUploadSession(){

  /* Release any lingering submission lock so that returning to the
     page (SPA re-entry) always starts from a clean, submittable
     state. Location/photo/description are reset here. The persisted
     text draft in draftStore is NOT deleted here — restoration
     happens after initForm() so remounts keep unfinished work. */
  publishInProgress = false;

  selectedFiles = [];

  existingImages = [];

  selectedFeatures = [];

  FEATURE_OPTIONS = [];

  galleryIndex = 0;

  isEdit = false;

  editId = null;

  cachedDraftUserId = null;

  uploadDraftRestoring = false;

  /* PHASE 4 — image draft state resets per mount so every
  create-mode remount gets a fresh, single restore pass. */
  uploadImageDraftRestoring = false;

  uploadImageDraftRestoreInFlight = false;

  uploadImageDraftRestoredThisMount = false;

  /* PHASE 5 — the text draft restore must also re-arm per
  mount. Previously uploadDraftRestoredThisSession stayed true
  for the whole module lifetime, so after ANY SPA navigation
  away and back, maybeRestoreUploadDraftOnce() early-returned:
  the draft was neither restored nor were the draft listeners
  rebound on the fresh DOM — the reported "draft failed to
  restore" symptom. Resetting it here makes restore + listener
  binding happen on every create-mode mount (refresh, SPA
  return and back/forward), while edit mode keeps never
  touching the create draft. */
  uploadDraftRestoredThisSession = false;

  if(uploadImageDraftSaveTimer){
    clearTimeout(uploadImageDraftSaveTimer);
    uploadImageDraftSaveTimer = null;
  }

  if(uploadDraftSaveTimer){
    clearTimeout(uploadDraftSaveTimer);
    uploadDraftSaveTimer = null;
  }

  /* HUFA catalogue selection is per-mount UI state. */
  selectedHufaCatalog = null;
  hufaCatalogYears = [];
  hufaCatalogRows = [];
  hufaCatalogFormWrites.clear();
  hufaYearMode = "manual";
  hufaCatalogManualOverride = false;

}

/* =========================================
IMAGE SECURITY
========================================= */

const MAX_IMAGES = 5;

const MAX_FILE_SIZE =
5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/tiff"
];

// Provinces and cities are now loaded from the shared database catalogue.

/* ============================================
PHASE 4 FINAL — LOADING STATE (body-mounted)
============================================
The previous in-template overlay used Tailwind arbitrary
classes (z-[60], border-t-[#E48A2F]) that do NOT exist in the
precompiled css/tailwind.css build, so it had no z-index and
painted UNDER the opaque form (the .fade-in entrance transform
also creates a containing block — the exact issue the existing
showPublishOverlay() solves by reparenting to <body>). This
uses the ALREADY-COMPILED hufa-publish overlay/center/card/
spinner classes and mounts directly on <body> so it is visible
immediately and cannot be covered. It is removed by the
existing initForm().finally() in the page mounts. */
let uploadBootSeq = 0;

function mountUploadLoadingOverlay(){

  /* Each mount supersedes any previous in-flight boot. */
  uploadBootSeq++;

  /* Idempotent: if an overlay already covers an in-flight init it
  is KEPT (never removed/re-added — no flicker, no reveal gap). */
  if(!document.getElementById("uploadVehicleLoading")){

    const overlay = document.createElement("div");
    overlay.id = "uploadVehicleLoading";
    overlay.className = "hufa-publish-overlay hufa-publish-visible";
    overlay.setAttribute("role","status");
    overlay.setAttribute("aria-live","polite");
    overlay.innerHTML = `
      <div class="hufa-publish-backdrop"></div>
      <div class="hufa-publish-center">
        <div class="hufa-publish-card bg-white">
          <div class="hufa-publish-spinner"></div>
          <p class="hufa-publish-brand">HUFA</p>
          <p class="hufa-publish-title">Loading Upload Vehicle</p>
          <p class="hufa-publish-subtitle">Preparing your vehicle listing...</p>
        </div>
      </div>`;

    document.body.appendChild(overlay);

  }

  /* Kill the refresh scroll jump: lock scrolling while loading and
  snap to top, so browser scroll restoration cannot reveal or jump
  to the bottom of the uninitialized form (requirement D). */
  document.documentElement.style.overflow = "hidden";
  window.scrollTo(0, 0);

  return uploadBootSeq;

}

function unmountUploadLoadingOverlay(){

  document.getElementById("uploadVehicleLoading")?.remove();

  document.documentElement.style.overflow = "";

}

/* ============================================
PHASE 4 FINAL — CLEAR NOW (CREATE MODE ONLY)
============================================
Opens a confirmation step before discarding the current
new-vehicle draft. Uses only EXISTING store APIs:
- clearUploadDraftRecord()        → sessionStorage text draft
- clearUploadVehicleImageDraft()  → IndexedDB images/order/cover
No new storage system; published vehicles, edit mode and all
other user data are untouched (create-only button + guard). */

window.openClearDraftConfirm = function(){

  /* Never operable in Edit Vehicle mode. */
  if(isEdit){ return; }
  if(document.getElementById("clearDraftConfirm")){ return; }

  const overlay = document.createElement("div");
  overlay.id = "clearDraftConfirm";
  overlay.className = "hufa-publish-overlay hufa-publish-visible";
  overlay.setAttribute("role","alertdialog");
  overlay.setAttribute("aria-live","assertive");
  overlay.innerHTML = `
    <div class="hufa-publish-backdrop"></div>
    <div class="hufa-publish-center">
      <div class="hufa-publish-card bg-white">
        <p class="hufa-publish-title">Clear this vehicle draft?</p>
        <p class="hufa-publish-subtitle">This will remove the information and images currently entered.</p>
        <div style="margin-top:24px; display:flex; gap:10px; justify-content:center;">
          <button
            type="button"
            id="clearDraftCancelBtn"
            class="px-6 py-3 rounded-xl font-bold tracking-wide transition-all duration-300 text-base"
            style="background:#FFFFFF; color:#08111F; border:1px solid #E2E8F0;"
          >
            Cancel
          </button>
          <button
            type="button"
            id="clearDraftConfirmBtn"
            class="px-6 py-3 rounded-xl font-bold tracking-wide transition-all duration-300 text-base"
            style="background:#E48A2F; color:#08111F;"
          >
            Clear Now
          </button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById("clearDraftCancelBtn")
    ?.addEventListener("click", ()=>{
      overlay.remove();
    });

  document.getElementById("clearDraftConfirmBtn")
    ?.addEventListener("click", ()=>{
      overlay.remove();
      window.confirmClearUploadDraft();
    });

};

window.closeClearDraftConfirm = function(){
  document.getElementById("clearDraftConfirm")?.remove();
};

window.confirmClearUploadDraft = async function(){

  /* CREATE/NEW VEHICLE MODE ONLY — hard guard. */
  if(isEdit){ return; }

  window.closeClearDraftConfirm();

  try{

    /* Resolve the SAME user id both stores were keyed by,
    BEFORE resetUploadSession() clears the cache. */
    const draftUserId = await resolveUploadDraftUserId();

    if(draftUserId){

      /* 1. TEXT draft → sessionStorage (existing Phase 2 API). */
      clearUploadDraftRecord(
        UPLOAD_DRAFT_WORKFLOW,
        draftUserId
      );

      /* 2. IMAGES + image order + cover → IndexedDB (existing
      Phase 4 API; no manual IndexedDB manipulation). */
      await clearUploadVehicleImageDraft(draftUserId);

    }

    /* 3. In-memory/session state: selectedFiles (order/cover),
    debounced timers, restore guards, cached user id. */
    resetUploadSession();

    /* 4. Form back to its new-vehicle defaults. */
    document.querySelector("form")?.reset();

    selectedFiles = [];
    selectedFeatures = [];
    activeFeatureCategory = "";

    valSet("features","");
    valSet("featureSearch","");
    valSet("location","");

    /* Re-apply the readonly profile-derived seller value the
    same way initForm() does (form.reset() blanks it). */
    getUserProfile().then((sellerProfile)=>{

      if(sellerProfile?.account_type){
        valSet("seller", sellerProfile.account_type);
      }

    }).catch(()=>{});

    const searchResults =
    document.getElementById("vehicleSearchResults");

    if(searchResults){
      searchResults.innerHTML = "";
      searchResults.classList.add("hidden");
    }

    /* 5. Dependent controls: the (now async) category toggle
    clears + repopulates Make and clears Model/Variant; the
    remaining toggles restore their normal defaults. */
    toggleVehicleCategory().catch(()=>{});
    resetModels();
    resetVariants();
    toggleMileageField();
    toggleEVFields();
    toggleMotorcycleFields();
    toggleFinanceFields();
    updateLocation();

    const warranty = document.getElementById("warrantyIncluded");

    if(warranty){
      warranty.dispatchEvent(new Event("change"));
    }

    /* 6. Feature chips: resetUploadSession() emptied
    FEATURE_OPTIONS, so reload it via the SAME getFeatures()
    contract initForm() uses — without it renderFeatureChips()
    renders with zero categories and throws on the empty group
    (the exact source of "Could not clear the draft"). */
    FEATURE_OPTIONS = await getFeatures();
    renderFeatureChips();
    initDescriptionCounter();
    renderPreview();

    toast("Vehicle draft cleared — ready for a new vehicle");

    /* Small UX: after a SUCCESSFUL clear, take the user back to
    the top of the fresh form. Runs only here — after the clear,
    resets and success toast completed, and after the loading
    scroll-lock has already been released (post-init). No reload,
    no persistence/state changes. */
    window.scrollTo({ top: 0, behavior: "smooth" });

  }catch(e){
    toast("Could not clear the draft. Please try again.");
  }

};

export function UploadVehiclePage(){

  /* Show the loading state FIRST, before any page work. */
  const boot = mountUploadLoadingOverlay();

  resetUploadSession();

  setTimeout(()=>{

    /* A NEWER mount (authChanged-driven re-render) supersedes this
    one: skip stale init so the full catalogue/draft/image init
    runs only for the LATEST mount — removes duplicate init work. */
    if(boot !== uploadBootSeq){ return; }

    initForm()
      .catch((initError)=>{
        console.warn("Upload Vehicle init failed", initError);
      })
      .finally(()=>{
        /* Only the CURRENT boot may take the overlay down — a stale
        init finishing late must never reveal the newer mount's
        uninitialized form. Init failure still removes the overlay
        (never an infinite loading screen). */
        if(boot === uploadBootSeq){
          unmountUploadLoadingOverlay();
        }
      });

  });

  return renderPage(
    "Add Vehicle"
  );

}

export function EditVehiclePage(){
  isEdit = true;
  const params = new URLSearchParams(window.location.search);
  editId = params.get("id");
  setTimeout(()=>{

    initForm()
      .catch((initError)=>{
        console.warn("Edit Vehicle init failed", initError);
      })
      .finally(()=>{
        unmountUploadLoadingOverlay();
      });

  });
  return renderPage("Edit Vehicle");
}

/* ================= UI ================= */

function renderPage(title){
  return renderDashboardShell({
    activeNav: "upload",
    mobileTitle: title,
    content: `

  <div class="container-main fade-in hufa-form max-w-6xl mx-auto space-y-8">

    ${renderDashboardPageHeading(title === "Add Vehicle" ? "addvehicle" : "editvehicle")}

<!-- IMAGES -->
<div class="card p-8 mb-8 border border-slate-200 rounded-2xl shadow-sm bg-white">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#F28C28]
mb-2
">
Image Manager
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-2
">
Vehicle Images
</h2>

<p class="
text-[#64748B]
mb-6
">
Upload a cover image and additional photos. The first image becomes the primary listing image displayed throughout the marketplace.
</p>

      <div
        id="dropZone"
        class="hufa-dropzone border border-dashed p-8 text-center cursor-pointer rounded-xl transition hover:bg-orange-50/60"
      >

        <div class="text-base font-semibold text-[#08111F]">
          Upload Vehicle Images
        </div>

        <div class="text-sm text-slate-500 mt-1.5">
          Click or drag images here
        </div>

        <div class="text-xs text-slate-400 mt-2">
          Maximum 5 images • JPG • PNG • WEBP
        </div>

        <input
          type="file"
          id="images"
          multiple
          accept="image/*"
          hidden
        >

      </div>

      <div
        id="imageCounter"
        class="text-sm text-slate-500 mt-3"
      >
        0 / 5 Images Selected
      </div>

      <div
        id="imageLimitMessage"
        class="hidden text-sm font-medium text-green-600 mt-3"
      >
        Maximum images reached. Remove or replace an image to continue.
      </div>

      <div
        id="remainingImages"
        class="text-sm text-slate-500 mt-2"
      >
        5 image slots remaining
      </div>

      <div id="preview" class="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4"></div>
    </div>

<!-- BASIC INFO -->
<div class="card p-8 mb-8 border border-slate-200 rounded-2xl shadow-sm bg-white">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#F28C28]
mb-2
">
Basic Information
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-2
">
Vehicle Details
</h2>

<p class="
text-[#64748B]
mb-6
">
Enter the core information that identifies your vehicle and helps buyers find it through search and filters.
</p>

      <div class="grid md:grid-cols-2 gap-6">

<div class="md:col-span-2">

<label class="block text-sm font-semibold text-slate-700 mb-2">
Search Vehicle
</label>

<div class="relative">

<input
id="vehicleSearch"
type="text"
class="input-light"
placeholder="Search by make, model or variant..."
autocomplete="off"
>

<div
id="vehicleSearchResults"
class="hidden absolute left-0 right-0 top-full mt-2 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50 max-h-80 overflow-y-auto"
></div>

</div>

<p class="text-xs text-slate-500 mt-2">
Start typing to quickly locate a vehicle before selecting its details below.
</p>

</div>

<!-- =========================================================
     HUFA CATALOGUE VARIANT SELECTION (isolated, additive)
     ---------------------------------------------------------
     PHASE 1 — placement only: this block sits directly below the
     Search Vehicle field so the seller sees the catalogue as soon
     as a search result is picked. Markup, ids, classes and every
     JS hook are unchanged from the previous position (inside the
     same grid, below Year).

     Manufacturer → Model → Year → exact catalogue records
     (public.hufa_vehicle_catalogue) with their own SELECT
     buttons. Hidden until catalogue years exist for the chosen
     Make + Model. While it is shown it REPLACES the legacy
     #variant dropdown + manual #year input (those two stay in
     the DOM and come straight back whenever there is no
     catalogue year / no matching rows, or when the seller picks
     "enter the variant manually" below — so the OTHER/manual
     route is never lost). JS hooks: hufaCatalogSetYearMode /
     hufaCatalogApplyFieldVisibility / hufaCatalogRenderRows.

     PHASE 2 FINAL REFINEMENT — TWO PRESENTATION OPTIONS over the
     ONE identical result set:
       DEFAULT   : DETAILED VIEW (full catalogue table, SELECT +
                   VARIANT pinned left, HUFA Vehicle Code last)
       SECOND    : CARD VIEW (existing responsive cards)
     Switching views only toggles the two containers — the query,
     the Year workflow, the selection state and the spec population
     logic are untouched.
     ========================================================= -->
<style>
/* =========================================================
   HUFA CATALOGUE — PHASE 2 FINAL REFINEMENT (view switcher +
   detailed table). Scoped to .hufa-cat-* / #hufaCatalog* so no
   other section of this page (or any other page) is affected.
   Uses the existing HUFA palette only (#08111F / #F28C28).
   ========================================================= */

/* ---------- VIEW SWITCHER ---------- */
.hufa-cat-switcher{
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:4px;
  border:1px solid #E2E8F0;
  border-radius:12px;
  background:#F8FAFC
}
.hufa-cat-switch-btn{
  appearance:none;
  border:0;
  border-radius:9px;
  padding:7px 14px;
  font-size:10.5px;
  font-weight:800;
  letter-spacing:0.14em;
  text-transform:uppercase;
  color:#475569;
  background:transparent;
  cursor:pointer;
  transition:background 0.18s ease, color 0.18s ease
}
.hufa-cat-switch-btn:hover{
  color:#08111F;
  background:#EAF1FA
}
.hufa-cat-switch-btn.is-active{
  background:#08111F;
  color:#FFFFFF;
  box-shadow:0 6px 16px rgba(8,17,31,0.25)
}
.hufa-cat-switch-btn:focus-visible{
  outline:2px solid #F28C28;
  outline-offset:2px
}

/* ---------- DETAILED VIEW (DEFAULT) ---------- */
.hufa-cat-table-wrap{
  width:100%;
  max-width:100%;
  overflow-x:auto;
  overflow-y:auto;
  max-height:72vh;
  border:1px solid #E2E8F0;
  border-radius:12px;
  background:#FFFFFF;
  -webkit-overflow-scrolling:touch;
  overscroll-behavior-x:contain;
  --hufa-cat-lead-w:88px
}
.hufa-cat-table{
  border-collapse:separate;
  border-spacing:0;
  width:max-content;
  min-width:max(100%, 1440px);
  table-layout:auto;
  font-size:12px;
  color:#0F172A
}
.hufa-cat-mobile-label{ display:none }
.hufa-cat-caption{
  caption-side:top;
  text-align:left;
  padding:8px 12px;
  font-size:11px;
  color:#64748B
}
.hufa-cat-table th,
.hufa-cat-table td{
  padding:9px 8px;
  text-align:left;
  vertical-align:top;
  white-space:normal;
  overflow-wrap:normal;
  word-break:normal;
  border-bottom:1px solid #EEF2F7
}
.hufa-cat-table thead th{
  position:sticky;
  top:0;
  z-index:1;
  background:#F8FAFC;
  color:#64748B;
  font-size:10px;
  font-weight:900;
  letter-spacing:0.1em;
  text-transform:uppercase;
  border-bottom:1px solid #E2E8F0
}
.hufa-cat-table tbody tr:nth-child(even) td{ background-color:#FCFDFE }
.hufa-cat-table tbody tr:hover td{ background-color:#F5F9FF }
/* PHASE 2.1 — SELECT + VARIANT stay pinned while the specs scroll,
so the seller always sees WHICH variant the SELECT belongs to.
The HUFA Vehicle Code is NOT pinned (it is the final, internal
reference column). */
.hufa-cat-table td.hufa-cat-col-select,
.hufa-cat-table th.hufa-cat-col-select{
  position:sticky;
  left:0;
  width:88px;
  min-width:88px;
  max-width:88px;
  background-color:#FFFFFF
}
.hufa-cat-table td.hufa-cat-col-variant,
.hufa-cat-table th.hufa-cat-col-variant{
  position:sticky;
  left:var(--hufa-cat-lead-w, 92px);
  width:240px;
  min-width:200px;
  max-width:300px;
  background-color:#FFFFFF;
  border-right:1px solid #E2E8F0;
  box-shadow:8px 0 10px -10px rgba(15,23,42,0.35)
}
.hufa-cat-table thead th.hufa-cat-col-select,
.hufa-cat-table thead th.hufa-cat-col-variant{ z-index:3 }
.hufa-cat-table tbody td.hufa-cat-col-select,
.hufa-cat-table tbody td.hufa-cat-col-variant{ z-index:2 }
/* HUFA Vehicle Code = FINAL, administrative reference column:
never pinned, never visually dominant (the orange value itself is
styled by .hufa-cat-code below). */
.hufa-cat-table td.hufa-cat-col-code,
.hufa-cat-table th.hufa-cat-col-code{
  width:150px;
  min-width:130px;
  white-space:nowrap;
  border-left:1px solid #EEF2F7
}
/* Selected record — same selection in BOTH views. */
.hufa-cat-table tbody tr.hufa-cat-row-selected td{ background-color:#ECFDF5 }
.hufa-cat-table tbody tr.hufa-cat-row-selected td.hufa-cat-col-select{
  box-shadow:inset 3px 0 0 #10B981
}
.hufa-cat-table .hufa-cat-code{
  font-weight:900;
  color:#F28C28;
  letter-spacing:0.04em;
  overflow-wrap:anywhere
}
.hufa-cat-table .hufa-cat-empty{ color:#CBD5E1 }
.hufa-cat-table .hufa-cat-cell-wrap{
  white-space:normal;
  overflow-wrap:break-word;
  min-width:220px;
  max-width:300px
}
.hufa-cat-select-btn{
  appearance:none;
  border:0;
  width:100%;
  border-radius:8px;
  background:#08111F;
  color:#FFFFFF;
  padding:6px 5px;
  font-size:9px;
  font-weight:900;
  letter-spacing:0.12em;
  text-transform:uppercase;
  cursor:pointer;
  transition:background 0.18s ease
}
.hufa-cat-select-btn:hover{ background:#F28C28 }
.hufa-cat-select-btn:focus-visible{ outline:2px solid #F28C28; outline-offset:2px }
.hufa-cat-card{
  display:flex;
  flex-direction:column;
  height:100%;
  min-width:0
}
@media (max-width:767px){
  .hufa-cat-table-wrap{
    overflow-x:auto;
    overflow-y:visible;
    max-height:none;
    -webkit-overflow-scrolling:touch
  }
}
/* Card view keeps its existing design — this only adds the same
"this row is selected" affordance the detailed table rows get. */
.hufa-cat-card.hufa-cat-row-selected{
  border-color:#34D399;
  box-shadow:0 0 0 2px rgba(52,211,153,0.22)
}
</style>
<div id="hufaCatalogBlock" class="hidden md:col-span-2 rounded-xl border border-slate-200 bg-white p-4">
<!-- PHASE 2.1: intermediate catalogue/year heading removed. Search Vehicle flows
directly into count + view switcher + existing results table. The catalogue Year
remains a DATA COLUMN in the table; the selector is hidden but retained so
existing catalogue JS/draft logic keeps working with zero behaviour change. -->
<select id="hufaCatalogYear" class="hidden" style="display:none" aria-hidden="true" tabindex="-1">
<option value=""></option>
</select>

<!-- Result count (ONE shared element, never duplicated) + the view
     switcher. The count lives OUTSIDE both view containers so it
     stays visible when Detailed View is active, when Card View is
     active and while switching between them. -->
<div id="hufaCatalogMeta" class="mt-4 hidden">
<p id="hufaCatalogCount" class="text-xs font-semibold text-slate-600"></p>
<div class="mt-2">
<div id="hufaCatalogViewSwitcher" class="hufa-cat-switcher" role="group" aria-label="Catalogue view">
<button type="button" class="hufa-cat-switch-btn is-active" data-hufa-view="detailed" aria-pressed="true">Detailed View</button>
<button type="button" class="hufa-cat-switch-btn" data-hufa-view="card" aria-pressed="false">Card View</button>
</div>
</div>
</div>

<!-- Messages / empty states only (loading / no rows / lookup
     failure). Catalogue rows are rendered into the two view
     containers below. -->
<div id="hufaCatalogResults" class="mt-3"></div>

<!-- DEFAULT VIEW: full catalogue detail table. -->
<div id="hufaCatalogDetailedView" class="mt-3 hidden"></div>
<!-- SECOND OPTION: existing responsive cards. -->
<div id="hufaCatalogCardView" class="mt-3 hidden"></div>

<div id="hufaCatalogSelected" class="mt-3 hidden rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"></div>

<p class="text-xs text-slate-500 mt-3">Vehicle not listed?
<button type="button" id="hufaCatalogUseManual" class="font-semibold" style="color:#005BBF;text-decoration:underline">Enter the variant manually instead</button>
</p>
<!-- Persisted "manual override" flag (draft text loop). Lives in
     the block so it exists even while the block is hidden. -->
<input type="hidden" id="hufaCatalogManual" value="">
<input type="hidden" id="hufaCatalogView" value="detailed">
</div>

<div class="md:col-span-2">

<label class="block text-sm font-semibold text-slate-700 mb-2">
Vehicle Type
</label>

<select
id="vehicleCategory"
class="input-light"
>
<option value="Passenger Vehicle">
Passenger Vehicle
</option>

<option value="Commercial Vehicle">
Commercial Vehicle
</option>

<option value="Motorcycle">
Motorcycle
</option>

<option value="Quad Bike">
Quad Bike
</option>

<option value="ATV">
ATV
</option>

<option value="Side-by-Side">
Side-by-Side
</option>
</select>

<p class="text-xs text-slate-500 mt-2">
Choose the type of vehicle first. The available makes, models and variants will automatically be filtered.
</p>

</div>

<div>

<label class="block text-sm font-semibold text-slate-700 mb-2">
Make
</label>

<select id="make" class="input-light">
<option value="">Select Make</option>
</select>

<p class="text-xs text-slate-500 mt-2">
Select the manufacturer exactly as shown on the vehicle registration documents.
</p>

</div>

<div>

<label class="block text-sm font-semibold text-slate-700 mb-2">
Model
</label>

<select id="model" class="input-light">
<option value="">Select Model</option>
</select>

<input
id="customModel"
class="input-light hidden mt-3"
placeholder="Enter Model Name"
>

<p class="text-xs text-slate-500 mt-2">
If your exact model is unavailable, choose "Other / Not Listed".
</p>

</div>

<div id="variantField">

<label class="block text-sm font-semibold text-slate-700 mb-2">
Variant
</label>

<select
id="variant"
class="input-light"
>
<option value="">
Select Variant (Optional)
</option>
</select>

<input
id="customVariant"
class="input-light hidden mt-3"
placeholder="Enter Variant"
>

<p class="text-xs text-slate-500 mt-2">
Selecting the correct variant improves search accuracy and finance estimates.
</p>

</div>

<div>

<label class="block text-sm font-semibold text-slate-700 mb-2">
Condition
</label>

<select
id="condition"
class="input-light"
>
<option value="">
Condition
</option>
</select>

</div>

<div id="yearField">

<label class="block text-sm font-semibold text-slate-700 mb-2">
Year
</label>

<input
id="year"
placeholder="Year"
class="input-light"
>

<p class="text-xs text-slate-500 mt-2">
Use the model year shown on the registration certificate.
</p>

</div>



<div>

<label class="block text-sm font-semibold text-slate-700 mb-2">
Mileage
</label>

<input
id="mileage"
placeholder="Mileage"
class="input-light"
>

<p class="text-xs text-slate-500 mt-2">
Enter the current odometer reading in kilometres.
</p>

</div>

</div>
    </div>

<!-- SPECIFICATIONS -->
<div class="card p-8 mb-8 border border-slate-200 rounded-2xl shadow-sm bg-white">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#F28C28]
mb-2
">
Specifications
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-2
">
Vehicle Specifications
</h2>

<p class="
text-[#64748B]
mb-6
">
Provide the technical specifications of the vehicle to improve search accuracy and finance calculations.
</p>

      <div class="grid md:grid-cols-2 gap-6">
<div id="bodyField">

<select id="body" class="input-light">
  <option value="">Body Type</option>
</select>

<p class="text-xs text-slate-500 mt-2">
Choose the body style that best matches the vehicle.
</p>

</div>

<select id="fuel" class="input-light">
  <option value="">Fuel Type</option>
</select>

<p class="text-xs text-slate-500 mt-2">
Electric and hybrid vehicles will automatically display additional specifications.
</p>

       <div
  id="evFields"
  class="hidden md:col-span-2 grid md:grid-cols-3 gap-6"
>

  <select
    id="batteryCapacity"
    class="input-light"
  >
    <option value="">
      Battery Capacity (kWh)
    </option>
  </select>

  <select
    id="batteryRange"
    class="input-light"
  >
    <option value="">
      Battery Range (km)
    </option>
  </select>

  <select
    id="chargingTime"
    class="input-light"
  >
    <option value="">
      Charging Time (Hours)
    </option>
  </select>

</div>

<div
  id="motorcycleFields"
  class="hidden md:col-span-2 grid md:grid-cols-2 gap-6"
>

<select
  id="motorcycleType"
  class="input-light"
>
  <option value="">
    Motorcycle Type
  </option>

  <option>Sport Bike</option>
  <option>Naked Bike</option>
  <option>Adventure Bike</option>
  <option>Cruiser</option>
  <option>Touring</option>
  <option>Dual Sport</option>
  <option>Off-Road</option>
  <option>Scooter</option>
  <option>Moped</option>
  <option>Motocross</option>
  <option>Enduro</option>
  <option>Supermoto</option>
</select>

<select
  id="engineCapacityCc"
  class="input-light"
>
  <option value="">
    Engine Capacity (cc)
  </option>
</select>

</div>

<select id="trans" class="input-light">
  <option value="">Transmission</option>
</select>
<select id="drive" class="input-light">
  <option value="">Drive</option>
</select>

<select id="color" class="input-light">
  <option value="">Colour</option>
</select>
<div id="hufaCatalogAdditionalSpecs" class="hidden md:col-span-2 grid md:grid-cols-2 gap-6"></div>
      </div>
    </div>

<!-- COMMERCIAL SPECIFICATIONS -->

<div
      id="commercialFields"
      class="card p-8 mb-8 border border-slate-200 rounded-2xl shadow-sm bg-white hidden"
    >

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#F28C28]
mb-2
">
Commercial
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-2
">
Commercial Specifications
</h2>

<p class="
text-[#64748B]
mb-6
">
Complete these fields for commercial vehicles to improve buyer search results and finance accuracy.
</p>
      <div class="grid md:grid-cols-2 gap-6">

        <select
          id="commercialCategory"
          class="input-light"
        >
          <option value="">
            Commercial Category
          </option>
        </select>

       <select
  id="cabConfiguration"
  class="input-light hidden"
>
  <option value="">
    Cab Configuration
  </option>
</select>
       <select
  id="payloadCapacityKg"
  class="input-light"
>

  <option value="">
    Payload Capacity
  </option>

</select>

        <select
          id="towingCapacityKg"
          class="input-light"
        >

          <option value="">
            Towing Capacity
          </option>

          <option value="500">500 kg</option>
          <option value="750">750 kg</option>
          <option value="1000">1 Ton</option>
          <option value="1500">1.5 Tons</option>
          <option value="2000">2 Tons</option>
          <option value="2500">2.5 Tons</option>
          <option value="3000">3 Tons</option>
          <option value="3500">3.5 Tons</option>
          <option value="5000">5 Tons+</option>

        </select>

      </div>

    </div>

<!-- SELLER -->
<div class="card p-8 mb-8 border border-slate-200 rounded-2xl shadow-sm bg-white">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#F28C28]
mb-2
">
Seller Information
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-2
">
Seller Details
</h2>

<p class="
text-[#64748B]
mb-6
">
Select the location where this vehicle is available for viewing and collection.
</p>

      <div class="grid md:grid-cols-2 gap-6">
      <input
id="seller"
type="hidden"
>

        <select
          id="province"
          class="input-light"
        >
          <option value="">
            Select Province
          </option>
        </select>

        <select
          id="city"
          class="input-light"
        >
          <option value="">
            Select City
          </option>
        </select>

        <input
          id="location"
          type="hidden"
        >
      </div>
    </div>

<!-- EXTRA -->
<div class="card p-8 mb-8 border border-slate-200 rounded-2xl shadow-sm bg-white">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#F28C28]
mb-2
">
Vehicle Extras
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-2
">
Features & History
</h2>

<p class="
text-[#64748B]
mb-6
">
Add the equipment, ownership history and verification information that helps buyers compare vehicles.
</p>

      <div class="grid md:grid-cols-2 gap-6">

<div id="doorsField">

<select
  id="doors"
  class="input-light"
>
  <option value="">
    Doors
  </option>
  <option value="2">2 Doors</option>
  <option value="3">3 Doors</option>
  <option value="4">4 Doors</option>
  <option value="5">5 Doors</option>
  <option value="6">6 Doors</option>
</select>

</div>

        <div id="seatsField">

<select
          id="seats"
          class="input-light"
        >
          <option value="">
            Seats
          </option>
          <option value="1">1 Seat</option>
          <option value="2">2 Seats</option>
          <option value="3">3 Seats</option>
          <option value="4">4 Seats</option>
          <option value="5">5 Seats</option>
          <option value="6">6 Seats</option>
          <option value="7">7 Seats</option>
          <option value="8">8 Seats</option>
          <option value="9">9 Seats</option>
          <option value="10">10 Seats</option>
          <option value="11">11 Seats</option>
          <option value="12">12 Seats</option>
          <option value="13">13 Seats</option>
          <option value="14">14 Seats</option>
          <option value="15">15 Seats</option>
          <option value="22">22 Seats</option>
          <option value="30">30 Seats</option>
        </select>

</div>

        <select
          id="owners"
          class="input-light"
        >
          <option value="">
            Previous Owners
          </option>
          <option value="0">0 (New Vehicle)</option>
          <option value="1">1 Previous Owner</option>
          <option value="2">2 Previous Owners</option>
          <option value="3">3 Previous Owners</option>
          <option value="4">4 Previous Owners</option>
          <option value="5">5 Previous Owners</option>
          <option value="6">6 Previous Owners</option>
          <option value="7">7 Previous Owners</option>
          <option value="8">8 Previous Owners</option>
          <option value="9">9 Previous Owners</option>
          <option value="10">10+ Previous Owners</option>
        </select>

<div class="md:col-span-2 border rounded-xl p-4 bg-slate-50">

<input
  id="featureSearch"
  type="text"
  class="input-light mb-3"
  placeholder="Search vehicle features..."
  autocomplete="off"
>

<div
  id="selectedFeatureChips"
  class="hidden flex flex-wrap gap-2 mb-5 pb-4 border-b border-slate-200"
></div>

<div
  id="featureChips"
  class="space-y-4"
></div>

<input
  id="features"
  type="hidden"
>

<div
  class="flex items-center justify-between mt-4"
>

  <div
    class="text-xs text-slate-500"
  >
    Select all features fitted to this vehicle.
  </div>

  <div
    id="featureCount"
    class="text-xs font-medium text-slate-600"
  >
    0 selected
  </div>

</div>
</div>

<div class="md:col-span-2 border-t pt-6">

<h4 class="text-lg font-semibold mb-4">
Vehicle History
</h4>

<div class="grid md:grid-cols-2 gap-6">

<label class="flex items-center gap-2">
<input
type="checkbox"
id="serviceHistory"
>
Full Service History
</label>

<label class="flex items-center gap-2">
<input
type="checkbox"
id="certifiedPreOwned"
>
Certified Pre-Owned
</label>

<label class="flex items-center gap-2">
<input
type="checkbox"
id="accidentFree"
>
Accident Free
</label>

</div>

</div>

<div class="md:col-span-2 border-t pt-6">

<h4 class="text-lg font-semibold mb-4">
Verification & Compliance
</h4>

<div class="grid md:grid-cols-2 gap-6">

<label class="flex items-center gap-2">
<input
type="checkbox"
id="ownershipVerified"
>
Ownership Verified
</label>

<label class="flex items-center gap-2">
<input
type="checkbox"
id="roadworthyCertificate"
>
Roadworthy Certificate
</label>

</div>

<div
class="text-xs text-slate-500 mt-4"
>
These items help buyers verify the history, ownership and legal status of the vehicle.
</div>

</div>




      </div>
    </div>

<!-- PLANS & PROTECTION -->

<div class="card p-8 mb-8 border border-slate-200 rounded-2xl shadow-sm bg-white">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#F28C28]
mb-2
">
Protection
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-2
">
Plans & Protection
</h2>

<p class="
text-[#64748B]
mb-6
">
Indicate any active warranties, service plans or maintenance plans included with the vehicle.
</p>

      <div class="grid md:grid-cols-2 gap-6">

        <label class="flex items-center gap-2">
          <input type="checkbox" id="warrantyIncluded">
          Warranty Included
        </label>

        <input
          id="warrantyExpiry"
          type="date"
          class="input-light"
          placeholder="Warranty Expiry"
        >

        <label class="flex items-center gap-2">
          <input type="checkbox" id="servicePlanIncluded">
          Service Plan Included
        </label>

        <input
          id="servicePlanExpiry"
          type="date"
          class="input-light"
          placeholder="Service Plan Expiry"
        >

        <label class="flex items-center gap-2">
          <input type="checkbox" id="maintenancePlanIncluded">
          Maintenance Plan Included
        </label>

        <input
          id="maintenancePlanExpiry"
          type="date"
          class="input-light"
          placeholder="Maintenance Plan Expiry"
        >

        <div
          class="md:col-span-2 text-xs text-slate-500 border-t pt-3"
        >
          Only complete plan expiry dates when the associated plan is included with the vehicle.
        </div>

      </div>
    </div>

<!-- PRICING -->

<div class="card p-8 mb-8 border border-slate-200 rounded-2xl shadow-sm bg-white">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#F28C28]
mb-2
">
Pricing
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-2
">
Vehicle Pricing
</h2>

<p class="
text-[#64748B]
mb-6
">
Enter the advertised selling price and choose the finance options available to buyers.
</p>

      <div class="grid md:grid-cols-2 gap-6">

<input
id="price"
type="number"
placeholder="Vehicle Price (Required)"
class="input-light text-lg font-semibold"
>

<p class="text-xs text-slate-500 mt-2">
Enter the total advertised selling price. Do not include spaces or the currency symbol.
</p>
        <div
          class="md:col-span-2 text-xs text-slate-500"
        >
          Enter the advertised selling price of the vehicle in South African Rand.
        </div>

        <label class="flex items-center gap-2 md:col-span-2">
          <input type="checkbox" id="financeAvailable">
          Finance Available
        </label>

        <div
          id="financeFields"
          class="hidden md:col-span-2"
        >

          <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-4">

            <h4 class="font-semibold text-emerald-900 mb-2">
              Finance Available
            </h4>

            <p class="text-sm text-emerald-700">
              By selecting this option, your vehicle will display an
              <strong>Apply for Finance</strong> button. Buyers will calculate
              repayments using the Helpufin finance calculator based on their
              own deposit, repayment period and credit profile.
            </p>

          </div>

        </div>

        <div class="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">

          <label class="flex items-center gap-2">
            <input type="checkbox" id="vatIncluded">
            VAT Included
          </label>

          <label class="flex items-center gap-2">
            <input type="checkbox" id="priceNegotiable">
            Price Negotiable
          </label>

        </div>

        <div
          class="md:col-span-2 text-xs text-slate-500 border-t pt-3"
        >
          Finance calculations are optional and only displayed when finance is available.
        </div>

      </div>
    </div>

<!-- DESCRIPTION -->

<div class="card p-8 mb-8 border border-slate-200 rounded-2xl shadow-sm bg-white">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#F28C28]
mb-2
">
Description
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-2
">
Vehicle Description
</h2>

<p class="
text-[#64748B]
mb-6
">
Provide buyers with a detailed overview of the vehicle's condition, history and notable features.
</p>

<textarea
id="description"
rows="8"
maxlength="5000"
class="input-light w-full"
placeholder="Describe the vehicle's condition, service history, accident history, extras, modifications, finance options or anything a buyer should know."
></textarea>

<p class="text-xs text-slate-500 mt-2">
Include important information such as optional extras, recent maintenance, modifications, remaining plans or warranties, and any known defects.
</p>

<div class="flex justify-between mt-2">

  <p class="text-xs text-slate-500">
    A detailed description helps buyers make informed decisions.
  </p>

  <span
    id="descriptionCounter"
    class="text-xs text-slate-500"
  >
    0 / 5000
  </span>

</div>

    </div>

<!-- IMPORTANT DISCLOSURES -->

<div class="card p-8 mb-8 border border-slate-200 rounded-2xl shadow-sm bg-white">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#F28C28]
mb-2
">
Declaration
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-2
">
Seller Declaration
</h2>

<p class="
text-[#64748B]
mb-6
">
Please confirm that the information and images provided accurately represent the vehicle being advertised.
</p>
      <div class="space-y-4">

        <label class="flex items-start gap-3">

          <input
            id="confirmOwnership"
            type="checkbox"
            class="mt-1"
          >

          <span class="text-sm text-slate-700">
            I confirm that I am authorised to advertise and sell this vehicle.
          </span>

        </label>

        <label class="flex items-start gap-3">

          <input
            id="confirmAccuracy"
            type="checkbox"
            class="mt-1"
          >

          <span class="text-sm text-slate-700">
            I confirm that all information provided is accurate to the best of my knowledge.
          </span>

        </label>

        <label class="flex items-start gap-3">

          <input
            id="confirmImages"
            type="checkbox"
            class="mt-1"
          >

          <span class="text-sm text-slate-700">
            I confirm that the uploaded images accurately represent this vehicle.
          </span>

        </label>

        <div class="border-t pt-4">

          <p class="text-xs text-slate-500 leading-6">
            By publishing this listing you acknowledge that HUFA may moderate, edit,
            reject or remove listings that violate marketplace policies, contain false
            information, duplicate listings, misleading pricing or prohibited content.
          </p>

        </div>

      </div>

    </div>

    <button
id="submitBtn"
class="hufa-submit w-full px-6 py-3 rounded-xl bg-[#E48A2F] text-[#08111F] font-bold tracking-wide shadow-sm transition-all duration-300 hover:bg-[#08111F] hover:text-white hover:shadow-md active:scale-[0.98] text-base"
>
      ${isEdit ? "Save Changes" : "Publish Vehicle"}
    </button>

${!isEdit ? `
    <!-- PHASE 4 FINAL — Clear Now: create/new-vehicle mode only,
    NEVER rendered in Edit Vehicle mode. Opens the existing
    confirmation overlay (window.openClearDraftConfirm()). -->
    <button
      type="button"
      id="clearDraftBtn"
      class="w-full mt-3 px-6 py-3 rounded-xl border border-slate-200 bg-white text-slate-600 font-bold tracking-wide transition-all duration-300 hover:bg-red-50 hover:text-red-600 hover:border-red-200 active:scale-[0.98] text-base"
      onclick="window.openClearDraftConfirm()"
    >
      Clear Now
    </button>
` : ""}

<div
id="publishOverlay"
class="hufa-publish-overlay hidden"
role="alertdialog"
aria-live="assertive"
aria-busy="true"
>

<div
class="hufa-publish-backdrop"
></div>

<div
class="hufa-publish-center"
>

<div
class="hufa-publish-card bg-white"
>

<div
id="publishSpinner"
class="hufa-publish-spinner"
></div>

<p
class="hufa-publish-brand"
>HUFA</p>

<h2
id="publishTitle"
class="hufa-publish-title"
>
Adding Your Vehicle
</h2>

<p
class="hufa-publish-subtitle"
>We're securely processing your vehicle listing. Please keep this window open.</p>

<ul
id="publishStages"
class="hufa-publish-stages"
>

<li data-stage="1">
<span class="hufa-stage-dot"></span>
<span>Preparing vehicle details</span>
</li>

<li data-stage="2">
<span class="hufa-stage-dot"></span>
<span>Uploading vehicle images</span>
</li>

<li data-stage="3">
<span class="hufa-stage-dot"></span>
<span>Saving vehicle listing</span>
</li>

<li data-stage="4">
<span class="hufa-stage-dot"></span>
<span id="publishStageFourLabel">Publishing vehicle</span>
</li>

<li data-stage="5">
<span class="hufa-stage-dot"></span>
<span>Finalising</span>
</li>

</ul>

<div
class="hufa-publish-bar"
>

<div
id="publishProgressBar"
class="hufa-publish-bar-fill"
></div>

</div>

<div
id="publishStep"
class="hufa-publish-step"
>
Step 1 of 5
</div>

<p
id="publishStatus"
class="hufa-publish-status"
>
Preparing vehicle information...
</p>

<p
class="hufa-publish-note"
>Please keep this window open. Do not close or refresh the page.</p>

</div>

</div>

</div>

  </div>
    `
  });
}

/* ================= INIT ================= */

async function initForm(){

if(!isEdit){

  resetUploadSession();

  document
    .querySelector("form")
    ?.reset();

}

/* PHASE 5 — independent catalogue loads run CONCURRENTLY:
   each call populates its OWN select and none depends on
   another's result, so the ~13 sequential network round-trips
   collapse into one parallel batch. Dependent cascades
   (province→city, make→model→variant) are NOT moved — they
   stay sequential inside restoreUploadDraft() and the change
   handlers, exactly as before. */
await Promise.all([
  fillMakes(),
  fillProvinces(),
  fillBodyTypes(),
  fillFuelTypes(),
  fillTransmissionTypes(),
  fillDriveTypes(),
  fillBatteryCapacities(),
  fillBatteryRanges(),
  fillChargingTimes(),
  fillEngineCapacities(),
  fillColours(),
  fillConditions(),
  fillCommercialCategories()
]);

resetModels();

initImageUpload();
/* HUFA catalogue: create hidden identity inputs BEFORE draft
listeners bind, so the SAME text-draft loop captures them. */
hufaCatalogHiddenId("hufaCatalogId");
hufaCatalogHiddenId("hufaCatalogCode");
hufaCatalogHiddenId("hufaCatalogVariant");
hufaCatalogHiddenId("hufaCatalogYearValue");
/* PHASE 5 — bind text-draft save listeners EARLY: previously
   they bound only at the tail of initForm (inside
   maybeRestoreUploadDraftOnce), so text typed during the long
   catalogue/auth cascade window was never captured by the
   draft. The dataset guard inside bindUploadDraftListeners
   keeps the later call there a harmless no-op. */
  bindUploadDraftListeners();


FEATURE_OPTIONS =
await getFeatures();

document
.getElementById(
  "featureSearch"
)
?.addEventListener(
  "input",
  renderFeatureChips
);

const vehicleSearch =
document.getElementById(
  "vehicleSearch"
);

const vehicleSearchResults =
document.getElementById(
  "vehicleSearchResults"
);

if(vehicleSearch){

  vehicleSearch.addEventListener(
    "input",
    handleVehicleSearch
  );

  vehicleSearch.addEventListener(
    "focus",
    handleVehicleSearch
  );

  vehicleSearch.addEventListener(
    "keydown",
    e=>{

      if(e.key === "Escape"){

        vehicleSearch.value = "";

        vehicleSearchResults
          ?.classList.add(
            "hidden"
          );

        vehicleSearchResults.innerHTML = "";

      }

    }
  );

  document.addEventListener(
    "click",
    e=>{

      if(
        !vehicleSearch.contains(e.target) &&
        !vehicleSearchResults?.contains(e.target)
      ){

        vehicleSearchResults
          ?.classList.add(
            "hidden"
          );

      }

    }
  );

}

await renderFeatureChips();
  document
    .getElementById("fuel")
    ?.addEventListener(
      "change",
      toggleEVFields
    );

  toggleEVFields();

toggleMotorcycleFields();

  document
    .getElementById("make")
    .addEventListener(
      "change",
      async ()=>{

        await fillModels();

        resetVariants();

        await fillVariants();

        /* HUFA catalogue: Make change clears Year/results/selection. */
        await hufaCatalogRefreshYears();

      }
    );

document
  .getElementById("model")
  .addEventListener(
    "change",
    async ()=>{

      toggleCustomModel();

      resetVariants();

      await fillVariants();

      /* HUFA catalogue: Model change clears Year/results/selection. */
      await hufaCatalogRefreshYears();

    }
  );

document
  .getElementById("variant")
  ?.addEventListener(
    "change",
    toggleCustomVariant
  );

document
  .getElementById("hufaCatalogYear")
  ?.addEventListener(
    "change",
    async ()=>{
      /* HUFA catalogue: Catalogue-Year change refreshes results
      and clears any previous SELECT. The mirrored #year input is
      set inside hufaCatalogRefreshRows(). */
      await hufaCatalogRefreshRows();
    }
  );

/* HUFA catalogue escape hatch: a seller whose exact car is not in
the table asks for the plain manual fields. The catalogue block
steps aside, the legacy Variant dropdown + manual Year input come
back, and the override is dropped on the next Make/Model change. */
document
  .getElementById("hufaCatalogUseManual")
  ?.addEventListener("click", ()=>{
    hufaCatalogManualOverride = true;
    /* Persist the choice in the same text draft (see the
    hufaCatalogManual entry in UPLOAD_TEXT_DRAFT_IDS). */
    const flag = document.getElementById("hufaCatalogManual");
    if(flag){ flag.value = "1"; }
    hufaCatalogSetResultsMessage("");
    hufaCatalogApplyFieldVisibility();
    scheduleUploadDraftSave();
  });

/* PHASE 2 FINAL REFINEMENT — view switcher. DETAILED VIEW is the
DEFAULT; CARD VIEW is the SECOND option. Switching only toggles the
two already-rendered containers (same dataset, same shared count
element, same SELECT handler), so the catalogue is never re-loaded
and the selected record is never lost. */
document
  .querySelectorAll("#hufaCatalogViewSwitcher [data-hufa-view]")
  .forEach((btn)=>{
    btn.addEventListener("click", ()=>{
      const view = btn.getAttribute("data-hufa-view");
      hufaCatalogApplyView(view);
      const viewInput = document.getElementById("hufaCatalogView");
      if(viewInput){ viewInput.value = hufaCatalogView; }
      scheduleUploadDraftSave();
    });
  });

document
  .getElementById("condition")
  ?.addEventListener(
    "change",
    toggleMileageField
  );

toggleMileageField();

document
  .getElementById("financeAvailable")
  ?.addEventListener(
    "change",
    toggleFinanceFields
  );

toggleFinanceFields();

initDescriptionCounter();

document
  .getElementById("vehicleCategory")
  ?.addEventListener(
    "change",
    async ()=>{

await fillMakes();

toggleVehicleCategory();

await fillCommercialCategories();

valSet("commercialCategory", "");
valSet("cabConfiguration", "");
valSet("payloadCapacityKg", "");
valSet("towingCapacityKg", "");

updateCabConfigurations();

    }
  );

document
  .getElementById("commercialCategory")
  ?.addEventListener(
    "change",
    updateCabConfigurations
  );

document
  .getElementById("cabConfiguration")
  ?.addEventListener(
    "change",
    updateCabConfigurations
  );

[
  [
    "warrantyIncluded",
    "warrantyExpiry"
  ],
  [
    "servicePlanIncluded",
    "servicePlanExpiry"
  ],
  [
    "maintenancePlanIncluded",
    "maintenancePlanExpiry"
  ]
].forEach(([checkboxId,inputId])=>{

  const checkbox =
    document.getElementById(checkboxId);

  const input =
    document.getElementById(inputId);

  if(!checkbox || !input) return;

  const sync = ()=>{

    input.disabled = !checkbox.checked;

    if(!checkbox.checked){

      input.value = "";

    }

  };

  checkbox.addEventListener(
    "change",
    sync
  );

  sync();

});

toggleVehicleCategory();

toggleMotorcycleFields();

updateCabConfigurations();

toggleCustomModel();

const { data:userData } =
await supabase.auth.getUser();

if(!userData.user){

  navigate("/login");
  return;

}
/* PHASE 4/5 — eager draft-user-ID resolution: populate
   cachedDraftUserId immediately (fire-and-forget) so the
   existing pagehide text/image flush functions always find
   the user id already cached and can write synchronously
   before unload. No draft store or restore logic changes. */
  resolveUploadDraftUserId();


/* =====================================
UPLOAD LIMIT REMOVED
===================================== */

/*
Unlimited vehicle uploads enabled.
Package restrictions disabled.
*/

/* PHASE 4 — the SOLE authoritative profile loader/creator
   (js/api.js getUserProfile). A brand-new account can reach this
   page before any dashboard visit, while the lazy profiles row
   does not exist yet: the previous raw .single() query returned
   no row, left the profile-derived seller field empty (so
   seller_type was persisted as "") and never created the
   account's profile row. Reusing the existing loader creates the
   row here through the SAME path every other page already uses,
   so the seller type is always prefilled and the account-type
   keyed package limits (and the server-side featured-limit
   trigger) resolve against a real profile. Failures degrade to
   the previous behaviour: the seller field simply stays empty. */
const sellerProfile =
await getUserProfile();

if(
  sellerProfile?.account_type
){

  valSet(
    "seller",
    sellerProfile.account_type
  );

}

if(isEdit && editId){
  await loadVehicle(editId);
}

/* PHASE 2 — create-mode draft restore. Runs once after the
catalogue options and profile prefill exist, so cascading
selects (province→city, make→model→variant) restore in
dependency order and conditional sections/features/counter
refresh correctly. Edit mode (?id=) never restores. */
await maybeRestoreUploadDraftOnce();

/* PHASE 4 — image draft restore (create mode only). Runs
after the text draft restore, AFTER initImageUpload() has
initialized the image state, once per mount. Create mode
only: edit mode (?id=) never loads create-mode images. */
await restoreUploadImageDraft();

  document.getElementById("submitBtn").onclick = submitVehicle;
}

/* ================= LOAD (EDIT MODE) ================= */

async function loadVehicle(id){

  const { data:userData } =
  await supabase.auth.getUser();

  if(!userData?.user){
    toast("Login required");
    navigate("/login");
    return;
  }

  const user = userData.user;

  const { data, error } = await supabase
    .from("vehicles")
    .select("*")
    .eq("id", id)
    .eq("seller_id", user.id)
    .single();

  if(error || !data){
    toast("Unauthorized vehicle access");
    navigate("/dashboard");
    return;
  }

  valSet("make", data.make);
  valSet("model", data.model);

  valSet(
    "variant",
    data.variant
  );

  valSet("year", data.year);
  valSet("price", data.price);
  valSet("mileage", data.mileage);

  valSet("body", data.body_type);
  valSet("fuel", data.fuel_type);

  valSet(
    "batteryCapacity",
    data.battery_capacity_kwh
  );

  valSet(
    "batteryRange",
    data.battery_range_km
  );

  valSet(
    "chargingTime",
    data.charging_time_hours
  );

toggleEVFields();

valSet(
  "motorcycleType",
  data.motorcycle_type
);

valSet(
  "engineCapacityCc",
  data.engine_capacity_cc
);

toggleMotorcycleFields();

valSet("trans", data.transmission);
  valSet("drive", data.drive_type);

  valSet("seller", data.seller_type);
  valSet("condition", data.condition);

  valSet("color", data.color);
  valSet("location", data.location);

  valSet("doors", data.doors);
  valSet("seats", data.seats);
  valSet("owners", data.owners);

if (
  Array.isArray(data.features) &&
  data.features.length
) {

  selectedFeatures =
  [...data.features];

  document.getElementById(
    "features"
  ).value =
  JSON.stringify(
    selectedFeatures
  );

  renderFeatureChips();

}

  valSet(
    "description",
    data.description
  );

  initDescriptionCounter();

  document.getElementById("serviceHistory").checked =
    data.service_history || false;

document.getElementById("ownershipVerified").checked =
  data.ownership_verified || false;

document.getElementById("accidentFree").checked =
  data.accident_free || false;

document.getElementById("roadworthyCertificate").checked =
  data.roadworthy_certificate || false;

document.getElementById("certifiedPreOwned").checked =
  data.certified_pre_owned || false;


valSet(
  "vehicleCategory",
  data.vehicle_category ||
  (
    data.commercial_vehicle
      ? "Commercial Vehicle"
      : "Passenger Vehicle"
  )
);

valSet(
  "commercialCategory",
  data.commercial_category
);

valSet(
  "cabConfiguration",
  data.cab_configuration
);

valSet(
  "payloadCapacityKg",
  data.payload_capacity_kg
);

valSet(
  "towingCapacityKg",
  data.towing_capacity_kg
);

toggleVehicleCategory();
hufaCatalogRenderExtraSpecs(data, true);

  document.getElementById("warrantyIncluded").checked =
    data.warranty_included || false;

  valSet(
    "warrantyExpiry",
    data.warranty_expiry_date
  );

  document.getElementById("servicePlanIncluded").checked =
    data.service_plan_included || false;

  valSet(
    "servicePlanExpiry",
    data.service_plan_expiry_date
  );

  document.getElementById("maintenancePlanIncluded").checked =
    data.maintenance_plan_included || false;

  valSet(
    "maintenancePlanExpiry",
    data.maintenance_plan_expiry_date
  );

  valSet("price", data.price);

  /*
  Monthly repayment, deposit amount and balloon payment
  are calculated by the Helpufin finance engine and are
  no longer entered by sellers.
  */

  document.getElementById("financeAvailable").checked =
    data.finance_available || false;

  toggleFinanceFields();

  document.getElementById("vatIncluded").checked =
    data.vat_included || false;

  document.getElementById("priceNegotiable").checked =
    data.price_negotiable || false;

  /*
  Featured listings removed.
  */

  existingImages = data.images || (data.image_url ? [data.image_url] : []);
  renderExistingImages();

  await fillModels();

  valSet(
    "model",
    data.model
  );

  toggleCustomModel();

  await fillVariants();

  valSet(
    "variant",
    data.variant
  );

  toggleCustomVariant();
}

/* ================= SUBMIT ================= */

async function submitVehicle(){

if(publishInProgress){

  return;

}

/* SINGLE-SUBMISSION LOCK — set IMMEDIATELY before any await so that
   rapid/duplicate clicks (or any re-entrant invocation while the
   first is still mid-flight) cannot pass the guard above and start a
   second vehicle creation. Without this, the window between the guard
   check and the first await (supabase.auth.getUser) is exploitable:
   a second click during that await sees publishInProgress === false
   and proceeds to a second INSERT. */
publishInProgress = true;

  const { data:userData } = await supabase.auth.getUser();
  const user = userData.user;

const make =
val("make")
.trim()
.slice(0,50);

const model =
val("model") === "__OTHER_MODEL__"
  ? val("customModel")
      .trim()
      .replace(/\s+/g," ")
      .slice(0,50)
  : val("model")
      .trim()
      .slice(0,50);
  const price = parseFloat(val("price"));

if(!make){

  failField("make", "Please select a vehicle make");
  return;

}

if(!model){

  failField(
    model === "" && !val("customModel") ? "model" : "customModel",
    "Please select a vehicle model"
  );
  return;

}

if(

  ![
    "Motorcycle",
    "Quad Bike",
    "ATV",
    "Side-by-Side"
  ].includes(
    val("vehicleCategory")
  ) &&

  !val("body")

){

  failField("body", "Please select a body type");
  return;

}

if(!val("fuel")){

  failField("fuel", "Please select a fuel type");
  return;

}

if(!val("trans")){

  failField("trans", "Please select a transmission");
  return;

}

if(!val("province")){

  failField("province", "Please select a province");
  return;

}

if(!val("city")){

  failField("city", "Please select a city");
  return;

}

if(!price || price <= 0){

  failField("price", "Enter a valid vehicle price");
  return;

}

if(price > 50000000){

  failField("price", "Vehicle price appears too high");
  return;

}

const year = parseInt(val("year"));

if(!year){

  failField("year", "Please enter a vehicle year");
  return;

}

if(
  year < 1980 ||
  year > new Date().getFullYear()
){

  failField("year", "Enter a valid year");
  return;

}

const mileage = parseInt(val("mileage"));

if(
  val("condition") !== "new" &&
  !mileage
){

  failField("mileage", "Please enter mileage");
  return;

}

if(
  mileage &&
  mileage < 0
){

  failField("mileage", "Mileage cannot be negative");
  return;

}

if(
  mileage > 2000000
){

  failField("mileage", "Mileage appears too high");
  return;

}

const owners = parseInt(val("owners"));

if(
  owners &&
  owners < 0
){
  failField("owners", "Owners cannot be negative");
  return;
}

if(
  owners > 20
){
  failField("owners", "Owners value appears too high");
  return;
}

if(
  val("fuel") === "Electric" &&
  !val("batteryCapacity")
){
  failField(
    "batteryCapacity",
    "Battery capacity is required for electric vehicles"
  );
  return;
}

if(
  val("fuel") === "Electric" &&
  !val("batteryRange")
){
  failField(
    "batteryRange",
    "Battery range is required for electric vehicles"
  );
  return;
}

if(
  [
    "Motorcycle",
    "Quad Bike",
    "ATV",
    "Side-by-Side"
    ].includes(
      val("vehicleCategory")
    ) &&
  !val("motorcycleType")
){
  failField("motorcycleType", "Please select a vehicle type");
  return;
}

if(
  val("vehicleCategory") === "Commercial Vehicle"
){

  if(!val("commercialCategory")){

    failField("commercialCategory", "Please select a commercial category");
    return;

  }

  const cabRequired = [
    "Utility Vehicle",
    "Chassis Cab",
    "Light Truck",
    "Medium Truck",
    "Heavy Truck"
  ];

  if(
    cabRequired.includes(
      val("commercialCategory")
    ) &&
    !val("cabConfiguration")
  ){

    failField("cabConfiguration", "Please select a cab configuration");
    return;

  }

  if(!val("payloadCapacityKg")){

    failField("payloadCapacityKg", "Please select a payload capacity");
    return;

  }

  const towingRequired = ![
    "Panel Van",
    "Cargo Van",
    "Bus",
    "Minibus"
  ].includes(
    val("commercialCategory")
  );

  if(
    towingRequired &&
    !val("towingCapacityKg")
  ){

    failField("towingCapacityKg", "Please select a towing capacity");
    return;

  }

}

if(
  [
    "Motorcycle",
    "Quad Bike",
    "ATV",
    "Side-by-Side"
    ].includes(
      val("vehicleCategory")
    )
){

  const cc =
    parseInt(
      val("engineCapacityCc")
    );

  if(!cc){
    failField("engineCapacityCc", "Please enter engine capacity");
    return;
  }

  if(cc < 50 || cc > 3000){
    failField("engineCapacityCc", "Engine capacity appears invalid");
    return;
  }

}

if(
  document.getElementById("warrantyIncluded").checked &&
  !val("warrantyExpiry")
){
  failField("warrantyExpiry", "Please enter the warranty expiry date.");
  return;
}

if(
  document.getElementById("servicePlanIncluded").checked &&
  !val("servicePlanExpiry")
){
  failField("servicePlanExpiry", "Please enter the service plan expiry date.");
  return;
}

if(
  document.getElementById("maintenancePlanIncluded").checked &&
  !val("maintenancePlanExpiry")
){
  failField("maintenancePlanExpiry", "Please enter the maintenance plan expiry date.");
  return;
}

if(
  !document.getElementById("confirmOwnership").checked
){
  failField("confirmOwnership", "Please confirm that you are authorised to sell this vehicle.");
  return;
}

if(
  !document.getElementById("confirmAccuracy").checked
){
  failField("confirmAccuracy", "Please confirm that the vehicle information is accurate.");
  return;
}

if(
  !document.getElementById("confirmImages").checked
){
  failField("confirmImages", "Please confirm that the uploaded images represent this vehicle.");
  return;
}

let urls = [...existingImages];

/* PHASE 7A — image-count validation runs BEFORE the upload
   overlay appears so a failed validation never flashes the
   processing screen at the user. */

if(
  !urls.length &&
  !selectedFiles.length
){

  failField("dropZone", "Please upload at least one vehicle image");

  return;

}

if(
  selectedFiles.length +
  urls.length >
  MAX_IMAGES
){

  failField("dropZone", `Maximum ${MAX_IMAGES} images allowed`);

  return;

}

/* =====================================
LAUNCH PROMOTION — ACTIVE LISTING LIMIT
===================================== */
if(
  !isEdit
){

  /* Only a brand-new upload (not an edit) consumes an active
     listing slot, so the limit is enforced here rather than
     on updates. Reuses the shared package-limit helper from
     ./dashboard.js — no parallel limit system. */

  const activeLimit =
  await getActiveListLimit();

  if(
    activeLimit !== Infinity
  ){

    const { count } =
    await supabase
      .from("vehicles")
      .select("*",{
        count:"exact",
        head:true
      })
      .eq("seller_id", user.id)
      .or(
        "status.eq.active,status.is.null"
      );

    if(
      (count || 0) >=
      activeLimit
    ){

      /* Release the submission lock — this is a validation-style
         rejection, not a failure mid-creation. The user must be
         able to adjust their listings and retry. */
      publishInProgress = false;

      toast(
        `Your package allows up to ${activeLimit} active listings. Please deactivate or remove a listing before adding another.`
      );

      window.scrollTo({
        top: 0,
        left: 0,
        behavior: "smooth"
      });

      return;

    }

  }

}

/* The single-submission lock is already set at the top of
   submitVehicle() — before any await — so it is NOT repeated here. */

/* PHASE 6 — hard-disable the submit control for the entire
   upload so rapid/duplicate clicks can never fire a second
   submission (belt-and-braces with the publishInProgress guard). */

setSubmitDisabled(true);

window.scrollTo({
  top: 0,
  left: 0,
  behavior: "instant"
});

showPublishOverlay(
  isEdit
    ? "Updating Your Vehicle"
    : "Adding Your Vehicle",
  "Preparing vehicle details"
);

updatePublishStatus(
  1,
  "Preparing vehicle details"
);

/* PHASE 7A — paint boundary. Give the browser two animation
   frames to actually paint the full-screen overlay BEFORE any
   expensive asynchronous/upload work begins. This guarantees:

   Click Publish -> Overlay visibly painted -> Upload starts.

   (A single rAF only schedules a callback before the next
   paint; nesting it twice guarantees at least one completed
   frame with the overlay on screen.) No artificial delays. */

await new Promise(resolve =>
  requestAnimationFrame(() =>
    requestAnimationFrame(resolve)
  )
);

updatePublishStatus(
  2,
  "Uploading vehicle images"
);

  for(let f of selectedFiles){

    /* PHASE 1 — final guard before Supabase
       Storage: reject ZIPs and non-image files. */

    const guard =
    await validateImageFile(
      f,
      {
        maxSize: MAX_FILE_SIZE,
        allowedTypes: ALLOWED_IMAGE_TYPES
      }
    );

    if(!guard.ok){

      publishInProgress = false;

      hidePublishOverlay();

      toast(guard.error);

      return;

    }

    /* PERFORMANCE 
-
   Optimize the image IN THE BROWSER before it reaches Storage:
   oversized photos are downscaled (longest edge 1600px) and
   re-encoded as WebP (JPEG fallback). Fail-safe: if optimization
   is not possible or not smaller, the ORIGINAL file is uploaded.
   Same bucket, same upload call, same URL pattern. */

    const optimized =
    await optimizeVehicleImage(f);

    if(optimized){

      f = optimized;

    }

const safeName =
f.name
.replace(/[^a-zA-Z0-9.\-_]/g, "_");

const name =
`${Date.now()}_${crypto.randomUUID()}_${safeName}`;

    const { error: uploadError } =
await supabase.storage.from("vehicle-images").upload(name, f);

if(uploadError){

  console.error(
    "UPLOAD FAILURE:",
    uploadError
  );

  publishInProgress = false;

  hidePublishOverlay();

  toast(
    "Image upload failed"
  );

  return;

}

    const { data } = supabase.storage
      .from("vehicle-images")
      .getPublicUrl(name);

    urls.push(data.publicUrl);
  }

const variant =
val("variant") === "__OTHER__"
  ? val("customVariant")
      .trim()
      .replace(/\s+/g," ")
      .slice(0,120)
  : val("variant")
      .trim();

let catalogRequestNeeded =
false;

let requestType =
null;

if(
  val("model") === "__OTHER_MODEL__" &&
  model
){

  catalogRequestNeeded =
  true;

  requestType =
  "new_model";

}
else if(
  val("variant") === "__OTHER__" &&
  variant
){

  catalogRequestNeeded =
  true;

  requestType =
  "new_variant";

}

/*
Vehicle description is optional.
Users may enter any amount of text or leave it blank.
*/

updatePublishStatus(
  3,
  "Saving vehicle information..."
);

const payload = {

    title: `${make} ${model}`,

    make,
    model,

    variant:
      variant,

    year: parseInt(val("year")) || null,

    price,

    mileage:
      parseInt(val("mileage")) || null,

    body_type: val("body"),

    fuel_type: val("fuel"),

    transmission: val("trans"),

    drive_type: val("drive"),

seller_type: val("seller"),

vehicle_category:
  val("vehicleCategory"),

condition: val("condition"),

    color:
      val("color")
      .trim()
      .replace(/\s+/g," ")
      .slice(0,40),

    province:
      val("province")
      .trim()
      .slice(0,60),

    city:
      val("city")
      .trim()
      .slice(0,80),

    location:
      val("location")
      .trim()
      .slice(0,120),

    doors:
      parseInt(val("doors")) || null,

    seats:
      parseInt(val("seats")) || null,

    owners:
      parseInt(val("owners")) || null,

features:
  [...new Set(
    selectedFeatures
  )],

description:
  val("description")
    .trim()
    .replace(/\s+/g," ")
    .slice(0,5000),

    

    service_history:
      document.getElementById("serviceHistory").checked,

   ownership_verified:
  document.getElementById("ownershipVerified").checked,

accident_free:
  document.getElementById("accidentFree").checked,

roadworthy_certificate:
  document.getElementById("roadworthyCertificate").checked,

certified_pre_owned:
  document.getElementById("certifiedPreOwned").checked,

verified_dealer: false,

franchise_dealer: false,

independent_dealer: false,

premium_dealer: false,

commercial_vehicle:
  val("vehicleCategory") === "Commercial Vehicle",

commercial_category:
  val("commercialCategory"),

cab_configuration:
  val("cabConfiguration"),

payload_capacity_kg:
  parseInt(
    val("payloadCapacityKg")
  ) || null,

towing_capacity_kg:
  parseInt(
    val("towingCapacityKg")
  ) || null,
    warranty_included:
      document.getElementById("warrantyIncluded").checked,

    warranty_expiry_date:
      document.getElementById("warrantyIncluded").checked
        ? val("warrantyExpiry") || null
        : null,

    service_plan_included:
      document.getElementById("servicePlanIncluded").checked,

    service_plan_expiry_date:
      document.getElementById("servicePlanIncluded").checked
        ? val("servicePlanExpiry") || null
        : null,

    maintenance_plan_included:
      document.getElementById("maintenancePlanIncluded").checked,

    maintenance_plan_expiry_date:
      document.getElementById("maintenancePlanIncluded").checked
        ? val("maintenancePlanExpiry") || null
        : null,

    price:
      Number(val("price")) || null,

    monthly_repayment: null,

    deposit_amount: null,

    balloon_payment: null,

    finance_available:
      document.getElementById("financeAvailable").checked,

    vat_included:
      document.getElementById("vatIncluded").checked,

    price_negotiable:
      document.getElementById("priceNegotiable").checked,

    is_featured: false,

    image_url:
      urls[0] || null,

    images:
      urls,

    is_electric:
      val("fuel") === "Electric",

    is_hybrid:
      val("fuel") === "Hybrid",

    is_plugin_hybrid:
      val("fuel") === "Plug-In Hybrid",

motorcycle_type:
      [
        "Motorcycle",
        "Quad Bike",
        "ATV",
        "Side-by-Side"
      ].includes(
        val("vehicleCategory")
      )
        ? val("motorcycleType")
        : null,

engine_capacity_cc:
      [
        "Motorcycle",
        "Quad Bike",
        "ATV",
        "Side-by-Side"
      ].includes(
        val("vehicleCategory")
      )
        ? (hufaCatalogExtraNumber("cc") ?? (parseInt(val("engineCapacityCc")) || null))
        : hufaCatalogExtraNumber("cc"),

    engine_size_l: hufaCatalogExtraNumber("engine_size_l"),
    power_kw: hufaCatalogExtraNumber("kw"),
    torque_nm: hufaCatalogExtraNumber("torque_nm"),
    cylinders: hufaCatalogExtraNumber("cylinders"),
    turbocharged: Boolean(document.getElementById("hufaSpec_turbocharged")?.checked),
    fuel_consumption_l100: hufaCatalogExtraNumber("fuel_consumption_l100"),
    co2_emissions_gkm: hufaCatalogExtraNumber("co2_emissions_gkm"),
    electric_range_km: hufaCatalogExtraNumber("electric_range_km"),
    fast_charge: Boolean(document.getElementById("hufaSpec_fast_charging")?.checked),

    battery_capacity_kwh:
      parseFloat(
        val("batteryCapacity")
      ) || null,

    battery_range_km:
      parseInt(
        val("batteryRange")
      ) || null,

    charging_time_hours:
      parseFloat(
        val("chargingTime")
      ) || null,

    seller_id:
      user.id

};
  let error;

updatePublishStatus(
  4,
  isEdit
    ? "Updating your listing..."
    : "Publishing your vehicle..."
);

if(isEdit){
  ({ error } = await supabase
    .from("vehicles")
    .update(payload)
    .eq("id", editId));
} else {
  ({ error } = await supabase
    .from("vehicles")
    .insert(payload));
}

if(error){

  console.error("UPLOAD ERROR:", error);

  publishInProgress = false;

  showPublishFailure(
    error.message || "An unexpected error occurred while saving your vehicle."
  );

  setTimeout(()=>{

    hidePublishOverlay();

    toast("Vehicle could not be uploaded. Please try again.");

  },2500);

  return;

}

if(
  catalogRequestNeeded &&
  !isEdit
){

  const {
    data: createdVehicle
  } =
  await supabase
    .from("vehicles")
    .select("id")
    .eq(
      "seller_id",
      user.id
    )
    .order(
      "created_at",
      {
        ascending:false
      }
    )
    .limit(1)
    .single();

  await supabase
    .from(
      "vehicle_catalog_requests"
    )
    .insert({

      user_id:
        user.id,

      vehicle_id:
        createdVehicle?.id || null,

      make,

      model,

      variant:
  requestType === "new_model"
    ? "Base"
    : variant,

request_type:
  requestType,

      status:
        "pending"

    });

}

updatePublishStatus(
  5,
  "Finalising..."
);

showPublishSuccess(

  isEdit
    ? "Your vehicle has been updated in your inventory."
    : "Your vehicle has been added to your inventory."

);

setTimeout(()=>{

  publishInProgress = false;

  hidePublishOverlay();

  toast(
    isEdit
      ? "Vehicle updated"
      : "Vehicle uploaded"
  );

  /* PHASE 2 — clear ONLY the current user's Upload Vehicle
  create draft after a successful publish. Edit mode never
  uses the create draft; failures return before this point
  so the draft is retained for retry. */
  if(!isEdit){
    resolveUploadDraftUserId().then((draftUserId)=>{
      if(draftUserId){
        clearUploadDraftRecord(UPLOAD_DRAFT_WORKFLOW, draftUserId);
      }
    }).catch(()=>{});
  }

  /* PHASE 4 — clear ONLY the current user's Upload Vehicle
  IMAGE draft on the same successful-publish lifecycle
  (validation/upload/network failures all return earlier and
  keep the image draft for retry). */
  if(!isEdit){
    clearUploadImageDraftForCurrentUser();
  }

  /* PHASE 3 — post-upload destination is DASHBOARD → INVENTORY.
     Seed the dashboard's persisted view as "inventory" so
     DashboardPage boots straight into the Inventory view
     (same page reached via Dashboard sidebar → Inventory),
     which reloads inventory data on mount — so the newly
     uploaded vehicle appears. Never navigate to My Vehicles. */
  try{
    sessionStorage.setItem("dashboardView", "inventory");
  }catch(err){}

  navigate("/dashboard/dealer");

},1800);
}

/* ================= IMAGES ================= */

function initImageUpload(){

  const drop =
  document.getElementById(
    "dropZone"
  );

  const input =
  document.getElementById(
    "images"
  );

  input.value = "";

  renderPreview();

  /* A. CLICK — existing file-picker behaviour (unchanged). */

  drop.onclick =
  ()=> input.click();

  input.onchange =
  e => handleFiles(
    e.target.files
  );

  /* PHASE 3 — B. DRAG AND DROP.
     Dropped files enter the SAME handleFiles() pipeline used
     by the file picker, so the existing MAX_IMAGES limit,
     ALLOWED_IMAGE_TYPES MIME policy, validateImageFile content
     validation, 5MB size check and duplicate detection all
     apply identically. preventDefault() on every event stops
     the browser from opening the file itself, and stopping
     propagation on dragover/drop keeps the page from reacting
     (navigating) to an unhandled drop. */

  const stopDefault =
  e => {
    e.preventDefault();
    e.stopPropagation();
  };

  const dragVisualOn =
  () => drop.classList.add(
    "hufa-dropzone--dragover"
  );

  const dragVisualOff =
  () => drop.classList.remove(
    "hufa-dropzone--dragover"
  );

  /* dragover fires continuously while hovering and must both
     preventDefault (allow the drop) and re-affirm the visual. */

  drop.addEventListener(
    "dragover",
    e => {
      stopDefault(e);
      dragVisualOn();
    }
  );

  /* dragenter/dragleave only toggle the highlight — file
     filtering happens once, on drop. dragleave also fires when
     the pointer crosses onto a child element, but re-adding the
     class on the next dragover makes the visual self-healing. */

  drop.addEventListener(
    "dragenter",
    e => {
      stopDefault(e);
      dragVisualOn();
    }
  );

  drop.addEventListener(
    "dragleave",
    e => {
      stopDefault(e);
      dragVisualOff();
    }
  );

  /* dragend fires when the drag operation is cancelled
     (e.g. Escape) with no drop occurring. */

  drop.addEventListener(
    "dragend",
    dragVisualOff
  );

  drop.addEventListener(
    "drop",
    e => {
      stopDefault(e);
      dragVisualOff();
      handleFiles(
        e.dataTransfer?.files
      );
    }
  );

}

async function handleFiles(files){

  const incoming =
  Array.from(files || []);

  for(const f of incoming){

    /* =========================
    MAX IMAGE LIMIT
    ========================= */

    if(
      selectedFiles.length +
      existingImages.length
      >=
      MAX_IMAGES
    ){

      toast(
        `Maximum ${MAX_IMAGES} images allowed`
      );

      break;
    }

    /* =========================
    MIME VALIDATION
    ========================= */

    if(
      !ALLOWED_IMAGE_TYPES.includes(
        f.type
      )
    ){

      toast(
        `${f.name} is not a supported image`
      );

      continue;
    }

    /* =========================
    PHASE 1 — CONTENT VALIDATION
    Validates the ACTUAL file content, not just
    the browser-reported MIME type. Rejects ZIPs
    renamed to .jpg/.png, documents, executables
    and other non-image files.
    ========================= */

    const validation =
    await validateImageFile(
      f,
      {
        maxSize: MAX_FILE_SIZE,
        allowedTypes: ALLOWED_IMAGE_TYPES
      }
    );

    if(!validation.ok){

      toast(validation.error);

      continue;
    }

    /* =========================
    FILE SIZE VALIDATION
    ========================= */

    if(
      f.size > MAX_FILE_SIZE
    ){

      toast(
        `${f.name} exceeds 5MB limit`
      );

      continue;
    }

    /* =========================
    DUPLICATE DETECTION
    ========================= */

    const duplicate =
    selectedFiles.some(existing =>
      existing.name === f.name &&
      existing.size === f.size
    );

    if(duplicate){

      toast(
        `${f.name} already added`
      );

      continue;
    }

    selectedFiles.push(f);

  }

  renderPreview();

  /* PHASE 4 — persist the accepted files (validated by the
  EXISTING pipeline above; no second validation pass). This
  covers both the file-picker and drag/drop paths, since
  dropped files enter this same handleFiles(). */
  scheduleUploadImageDraftSave();

}

/* =========================================================
PHASE 5 — IMAGE ORDER OPERATIONS (defined ONCE at module
scope; renderPreview only RENDERS, it never re-creates these
handlers, so there can be no duplicate definitions or
duplicate drag/drop listeners).

Array order IS the displayed order AND the published order:
selectedFiles[0] is always the cover. Every operation ends
with renderPreview() + a persisted image-draft save.
========================================================= */

/* Generic reorder used by drag-and-drop: take the image at
`from` and insert it at slot `to` (0-based within
selectedFiles). Guards keep out-of-range drags harmless. */
function setNewImagePosition(from, to){

  if(from === to){
    return;
  }

  if(
    from < 0 ||
    from >= selectedFiles.length ||
    to < 0 ||
    to >= selectedFiles.length
  ){
    return;
  }

  const [file] =
  selectedFiles.splice(from, 1);

  selectedFiles.splice(to, 0, file);

  renderPreview();

  /* Persist the new order (array order IS the persisted
  order; cover/#1 follows automatically). */
  scheduleUploadImageDraftSave();

}

/* Manage-Vehicle interaction concept: adjacent-swap move
buttons (‹ / ›). Plain punctuation characters, not emoji. */
window.moveNew = (i,dir)=>{

  const target = i + dir;

  if(
    target < 0 ||
    target >= selectedFiles.length
  ){
    return;
  }

  [
    selectedFiles[target],
    selectedFiles[i]
  ] =
  [
    selectedFiles[i],
    selectedFiles[target]
  ];

  renderPreview();

  scheduleUploadImageDraftSave();

};

/* Same concept as Manage Vehicle's setCoverImage:
   splice the image to the front of the array. Index 0 of
   the publish array is the cover, so the moved image
   becomes position 1 / Cover and the previous cover
   drops to 2. */

window.makeNewCover = i=>{

  if(i <= 0 || i >= selectedFiles.length){
    return;
  }

  const [file] =
  selectedFiles.splice(i,1);

  selectedFiles.unshift(file);

  renderPreview();

  scheduleUploadImageDraftSave();

};

/* PHASE 5 — drag-and-drop reordering between image cards.
Bound ONCE per #preview element (the element is recreated on
each page mount, so the dataset guard correctly re-arms per
mount without ever stacking listeners on one element).

- Cards carry draggable="true" + data-new-image-index.
- Events are delegated on the container: exactly one
  dragstart/dragover/drop/dragend listener set regardless of
  how many images exist or how often they re-render.
- stopPropagation keeps card drags completely away from the
  separate dropzone file-drop system and away from the
  dropzone click handler, so dragging can never open the
  file picker.
- Touch/mobile has no HTML5 drag: the always-visible ‹ / ›
  move buttons and Make Cover remain the touch path. */
function bindPreviewDragDrop(box){

  if(!box || box.dataset.dndBound === "1"){
    return;
  }

  box.dataset.dndBound = "1";

  let dragFromIndex = null;

  const clearDropTarget = ()=>{
    box
      .querySelectorAll(".hufa-image-slot--drop-target")
      .forEach((el)=>{
        el.classList.remove(
          "hufa-image-slot--drop-target"
        );
      });
  };

  const clearDragging = ()=>{
    box
      .querySelectorAll(".hufa-image-slot--dragging")
      .forEach((el)=>{
        el.classList.remove(
          "hufa-image-slot--dragging"
        );
      });
  };

  box.addEventListener(
    "dragstart",
    (e)=>{
      const card =
      e.target.closest("[data-new-image-index]");

      if(!card){
        return;
      }

      dragFromIndex =
      Number(card.dataset.newImageIndex);

      if(!Number.isInteger(dragFromIndex)){
        dragFromIndex = null;
        return;
      }

      e.stopPropagation();

      e.dataTransfer.effectAllowed = "move";

      /* setData is required for Firefox to start the drag. */
      e.dataTransfer.setData(
        "text/plain",
        String(dragFromIndex)
      );

      card.classList.add(
        "hufa-image-slot--dragging"
      );

    }
  );

  box.addEventListener(
    "dragover",
    (e)=>{
      const card =
      e.target.closest("[data-new-image-index]");

      if(
        dragFromIndex !== null &&
        card
      ){
        e.preventDefault();

        e.stopPropagation();

        e.dataTransfer.dropEffect = "move";

        clearDropTarget();

        card.classList.add(
          "hufa-image-slot--drop-target"
        );

        return;
      }

      /* PHASE 5 — GUARD: a file drag hovering over the preview
      (not a card reorder drag) must never reach the browser's
      default drop behaviour, which would navigate the page away
      and destroy the draft. preventDefault here cancels the
      default drop-navigation and hands the drop to the handler
      below, which safely ignores it. */
      if(
        e.dataTransfer &&
        Array.from(e.dataTransfer.types || []).includes("Files")
      ){
        e.preventDefault();

        e.stopPropagation();
      }

    }
  );

  box.addEventListener(
    "drop",
    (e)=>{

      const card =
      e.target.closest("[data-new-image-index]");

      if(
        dragFromIndex !== null &&
        card
      ){

        e.preventDefault();

        e.stopPropagation();

        clearDropTarget();

        const to =
        Number(card.dataset.newImageIndex);

        if(Number.isInteger(to)){
          setNewImagePosition(
            dragFromIndex,
            to
          );
        }

        dragFromIndex = null;

        return;

      }

      /* PHASE 5 — any other drop over the preview (OS files,
      text, another card's cancelled drag) is swallowed: no
      navigation, no file-picker, no state change. */
      e.preventDefault();

      e.stopPropagation();

      clearDropTarget();

      clearDragging();

      dragFromIndex = null;

    }
  );

  const endDrag = ()=>{

    dragFromIndex = null;

    clearDropTarget();

    clearDragging();

  };

  box.addEventListener(
    "dragend",
    endDrag
  );

  box.addEventListener(
    "dragleave",
    (e)=>{
      if(
        dragFromIndex !== null &&
        !box.contains(e.relatedTarget)
      ){
        clearDropTarget();
      }
    }
  );

}

function renderPreview(){

  const box =
  document.getElementById(
    "preview"
  );

  box.innerHTML = "";

  if(
    !existingImages.length &&
    !selectedFiles.length
  ){

    box.innerHTML = `
      <div class="hufa-empty-images col-span-full text-center text-slate-400 py-8 rounded-xl border border-dashed border-slate-200">
        No images uploaded yet
      </div>
    `;

  }

  const counter =
  document.getElementById(
    "imageCounter"
  );

  if(counter){

    counter.textContent =
      `${
        existingImages.length +
        selectedFiles.length
      } / ${MAX_IMAGES} Images Selected`;

  }

  const dropZone =
  document.getElementById(
    "dropZone"
  );

  const totalImages =
    existingImages.length +
    selectedFiles.length;

  const limitMessage =
  document.getElementById(
    "imageLimitMessage"
  );

  const remainingImages =
  document.getElementById(
    "remainingImages"
  );

  if(
    remainingImages
  ){

    remainingImages.textContent =
    `${
      MAX_IMAGES - totalImages
    } image slots remaining`;

  }

  if(dropZone){

    if(
      totalImages >= MAX_IMAGES
    ){

      dropZone.classList.add(
        "hidden"
      );

      limitMessage
        ?.classList.remove(
          "hidden"
        );

    }else{

      dropZone.classList.remove(
        "hidden"
      );

      limitMessage
        ?.classList.add(
          "hidden"
        );

    }

  }

 /* PHASE 3 — each card is numbered from the CURRENT combined
 order (existing images first, then new files), so the number
 and the Cover label are always generated from the real
 underlying arrays and update automatically after any
 add/remove/replace/reorder. Position 1 is the cover:
 no emoji, no star — a plain numeric badge plus the word
 "Cover". Reordering reuses the Manage Vehicle interaction
 concept: adjacent-swap move buttons (‹ / ›) plus a
 "Make Cover" action, applied purely to selectedFiles so
 existing stored URLs are never rewritten. The move/cover
 handlers themselves are defined ONCE at module scope
 (PHASE 5) — this function only renders. */

 existingImages.forEach((url,i)=>{

  const overallIndex = i;

  box.innerHTML += `
    <div class="hufa-image-slot border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">

      <div class="relative hufa-image-frame">

        <img
          src="${url}"
          loading="lazy"
          class="w-full h-40 object-cover cursor-pointer"
          onclick="openGallery(${overallIndex})"
        >

        <span class="hufa-image-position" aria-hidden="true">${overallIndex + 1}</span>

        ${overallIndex === 0
          ? `<span class="hufa-image-cover">Cover</span>`
          : ""
        }

      </div>

      <div class="grid grid-cols-2 gap-2 p-2.5 bg-white border-t border-slate-100">

        <button
          type="button"
          class="btn btn-clean btn-sm !py-1.5"
          onclick="replaceExisting(${i})"
        >
          Replace
        </button>

        <button
          type="button"
          class="btn btn-sm !py-1.5 text-red-600 bg-white border border-red-200 hover:bg-red-50"
          onclick="removeExisting(${i})"
        >
          Remove
        </button>

      </div>

    </div>
  `;

});

selectedFiles.forEach((f,i)=>{

  const url =
  URL.createObjectURL(f);

  const overallIndex =
  existingImages.length + i;

  const isFirst =
  overallIndex === 0;

  box.innerHTML += `
    <div class="hufa-image-slot border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">

      <div class="relative hufa-image-frame">

        <img
          src="${url}"
          loading="lazy"
          class="w-full h-40 object-cover cursor-pointer"
          onclick="openGallery(${overallIndex})"
        >

        <span class="hufa-image-position" aria-hidden="true">${overallIndex + 1}</span>

        ${isFirst
          ? `<span class="hufa-image-cover">Cover</span>`
          : ""
        }

        ${i > 0
          ? `
            <button
              type="button"
              class="hufa-image-move hufa-image-move-left"
              aria-label="Move image ${overallIndex + 1} left"
              onclick="moveNew(${i},-1)"
            >&#8249;</button>
          `
          : ""
        }

        ${i < selectedFiles.length - 1
          ? `
            <button
              type="button"
              class="hufa-image-move hufa-image-move-right"
              aria-label="Move image ${overallIndex + 1} right"
              onclick="moveNew(${i},1)"
            >&#8250;</button>
          `
          : ""
        }

      </div>

      <div class="p-2.5 bg-white border-t border-slate-100">

        ${isFirst
          ? `<span class="btn btn-sm !py-1.5 btn-clean w-full hufa-image-cover-static" aria-label="Image ${overallIndex + 1} is the cover image">Cover</span>`
          : `
            <button
              type="button"
              class="btn btn-clean btn-sm !py-1.5 w-full"
              aria-label="Set image ${overallIndex + 1} as cover"
              onclick="makeNewCover(${i})"
            >
              Make Cover
            </button>
          `
        }

      </div>

      <div class="grid grid-cols-2 gap-2 px-2.5 pb-2.5 bg-white">

        <button
          type="button"
          class="btn btn-clean btn-sm !py-1.5"
          aria-label="Replace image ${overallIndex + 1}"
          onclick="replaceNew(${i})"
        >
          Replace
        </button>

        <button
          type="button"
          class="btn btn-sm !py-1.5 text-red-600 bg-white border border-red-200 hover:bg-red-50"
          onclick="removeNew(${i})"
        >
          Remove
        </button>

      </div>

    </div>
  `;

});

/* PHASE 5 — tag the rendered new-image cards for the delegated
drag-and-drop system, then bind the container listeners ONCE.
DOM order is guaranteed: existingImages render first, then
selectedFiles, so the selectedFiles index is the slot index
minus the existing-image count. Doing this in JS (not in the
template) keeps the two render loops identical and avoids any
chance of duplicated markup handling. */
const renderedSlots =
box.querySelectorAll(".hufa-image-slot");

renderedSlots.forEach((slot, slotOrder)=>{

  const newIdx = slotOrder - existingImages.length;

  if(newIdx < 0){
    return;
  }

  slot.setAttribute("draggable", "true");

  slot.setAttribute(
    "data-new-image-index",
    String(newIdx)
  );

  const img = slot.querySelector("img");

  /* The native <img> drag (which drags the image URL) must
  never hijack the reorder drag. */
  if(img){
    img.setAttribute("draggable", "false");
  }

});

bindPreviewDragDrop(box);

}

function renderExistingImages(){
  renderPreview();
}

window.removeExisting = i=>{

  const confirmed =
  confirm(
    "Remove this image?"
  );

  if(!confirmed) return;

  existingImages.splice(i,1);

  renderPreview();

};

window.removeNew = i=>{

  const confirmed =
  confirm(
    "Remove this image?"
  );

  if(!confirmed) return;

  selectedFiles.splice(i,1);

  renderPreview();

  /* PHASE 4 — removed image must never come back after a
  refresh: persist the remaining list. */
  scheduleUploadImageDraftSave();

};

window.replaceNew = i=>{

  const input =
  document.createElement("input");

  input.type = "file";

  input.accept =
  "image/*";

  input.onchange = async e=>{

    const file =
    e.target.files?.[0];

    if(!file) return;

    /* PHASE 1 — validate actual content
       before accepting the replacement. */

    const validation =
    await validateImageFile(
      file,
      {
        maxSize: MAX_FILE_SIZE,
        allowedTypes: ALLOWED_IMAGE_TYPES
      }
    );

    if(!validation.ok){

      toast(validation.error);

      return;

    }

    selectedFiles[i] = file;

    renderPreview();

    /* PHASE 4 — replacement keeps its position; persist the
    updated list so the same position survives a refresh. */
    scheduleUploadImageDraftSave();

  };

  input.click();

};

window.replaceExisting = i=>{

  const input =
  document.createElement("input");

  input.type = "file";

  input.accept =
  "image/*";

  input.onchange = async e=>{

    const file =
    e.target.files?.[0];

    if(!file) return;

    /* PHASE 1 — validate actual content
       before accepting the replacement. */

    const validation =
    await validateImageFile(
      file,
      {
        maxSize: MAX_FILE_SIZE,
        allowedTypes: ALLOWED_IMAGE_TYPES
      }
    );

    if(!validation.ok){

      toast(validation.error);

      return;

    }

    existingImages.splice(i,1);

    selectedFiles.push(file);

    renderPreview();

    /* PHASE 5 — an existing-image replacement re-enters the
    new selection, so the current selectedFiles order must be
    persisted too (create mode; edit mode is a no-op guard). */
    scheduleUploadImageDraftSave();

  };

  input.click();

};

/* ================= MAKE + MODEL ================= */

/* PHASE 2 — shared cascade populators reused by both the
change handlers and draft restoration. */

async function populateModelOptions(make){

  resetModels();
  resetHufaCatalogStateOnly();

  if(!make){
    return [];
  }

  const vehicleCategory = val("vehicleCategory");

  const models = await getModels(make, vehicleCategory);

  const list = document.getElementById("model");

  if(list){

    models.forEach(model=>{

      const option = document.createElement("option");

      option.value = model;

      option.textContent = model;

      list.appendChild(option);

    });

  }

  return models;

}

async function populateVariantOptions(make, model){

  /* HUFA catalogue block must be reset without calling
  resetVariants() (which calls hufaCatalogSetHidden() and the
  hidden-id creator). resetHufaCatalogStateOnly() is safe here
  because it only touches the catalogue block/results nodes. */
  resetHufaCatalogStateOnly();

  if(!make || !model){
    return [];
  }

  const vehicleCategory = val("vehicleCategory");

  const variants = await getVariants(make, model, vehicleCategory);

  const list = document.getElementById("variant");

  if(list){

    variants.forEach(variant=>{

      const option = document.createElement("option");

      option.value = variant;

      option.textContent = variant;

      list.appendChild(option);

    });

  }

  toggleCustomVariant(variants);

  return variants;

}

async function populateCityOptions(province){

  const city =
  document.getElementById(
    "city"
  );

  if(!city) return [];

  city.innerHTML =
  `<option value="">
    Select City
  </option>`;

  if(!province){
    return [];
  }

  const cities =
  await getCities(province);

  cities.forEach(name=>{

    const option =
    document.createElement("option");

    option.value = name;

    option.textContent = name;

    city.appendChild(option);

  });

  city.onchange =
  updateLocation;

  return cities;

}

async function fillMakes(){

  const list =
  document.getElementById("make");

  if(!list) return;

  list.innerHTML = `
    <option value="">
      Select Make
    </option>
  `;

  const vehicleCategory =
    val("vehicleCategory");

  const makes =
    await getMakes(vehicleCategory);

  makes.forEach(make=>{

    const option =
      document.createElement("option");

    option.value = make;

    option.textContent = make;

    list.appendChild(option);

  });

}

function resetModels(){

  const list =
  document.getElementById(
    "model"
  );

  if(!list) return;

  list.innerHTML = `
    <option value="">
      Select Model
    </option>
  `;

}

function resetHufaCatalogStateOnly(){
selectedHufaCatalog = null;
hufaCatalogRows = [];
hufaCatalogYears = [];
hufaCatalogRequestSeq++;
hufaYearMode = "manual";
hufaCatalogManualOverride = false;
/* A fresh Make/Model (or a full reset) always returns to the
DEFAULT view and drops both rendered presentations. */
hufaCatalogView = "detailed";
hufaCatalogClearViews();
const selectedBox = document.getElementById("hufaCatalogSelected");
if(selectedBox){
selectedBox.classList.add("hidden");
selectedBox.innerHTML = "";
}
const resultsBox = document.getElementById("hufaCatalogResults");
if(resultsBox){ resultsBox.innerHTML = ""; }
const block = document.getElementById("hufaCatalogBlock");
if(block){ block.classList.add("hidden"); }
const yearSelect = document.getElementById("hufaCatalogYear");
if(yearSelect){ yearSelect.innerHTML = `<option value="">Select Catalogue Year</option>`; }
/* Manual mode: put the legacy Variant + manual Year fields back. */
hufaCatalogApplyFieldVisibility();
}

function resetVariants(){

  const list =
  document.getElementById(
    "variant"
  );

  if(!list) return;

  list.innerHTML = `
    <option value="">
      Select Variant (Optional)
    </option>
  `;

  const custom =
  document.getElementById(
    "customVariant"
  );

  if(custom){

    custom.value = "";

    custom.classList.add(
      "hidden"
    );

  }

  /* HUFA catalogue selection never survives a variant reset.
  Direct DOM reset only (no function call) to avoid recursion:
  populateVariantOptions() calls resetHufaCatalogStateOnly()
  above, so resetVariants() must not call back into it. */
  selectedHufaCatalog = null;
  hufaCatalogRows = [];
  hufaCatalogRequestSeq++;
  const hufaSelectedBox = document.getElementById("hufaCatalogSelected");
  if(hufaSelectedBox){
    hufaSelectedBox.classList.add("hidden");
    hufaSelectedBox.innerHTML = "";
  }
  const hufaResultsBox = document.getElementById("hufaCatalogResults");
  if(hufaResultsBox){ hufaResultsBox.innerHTML = ""; }
  /* Both rendered presentations (and the default-view choice) go
  with the cleared selection/rows. */
  hufaCatalogView = "detailed";
  hufaCatalogClearViews();

}

function hufaCatalogText(value){
if(value === null || value === undefined){ return ""; }
const text = String(value).trim();
if(!text){ return ""; }
if(/^null$/i.test(text) || /^undefined$/i.test(text) || /^nan$/i.test(text)){ return ""; }
return text;
}

function hufaEscapeHtml(value){
return hufaCatalogText(value)
.replace(/&/g, "&amp;")
.replace(/</g, "&lt;")
.replace(/>/g, "&gt;")
.replace(/"/g, "&quot;")
.replace(/'/g, "&#39;");
}

function hufaCatalogHiddenId(id){
let el = document.getElementById(id);
if(el){ return el; }
/* Hidden identity inputs live beside #variant (never in a select)
so the SAME text-draft loop can persist them, and the generic
setUploadDraftSelect() (options-only) can never touch them. */
const anchor = document.getElementById("hufaCatalogBlock") || document.getElementById("variant");
if(!anchor || !anchor.parentNode){ return null; }
el = document.createElement("input");
el.type = "hidden";
el.id = id;
anchor.parentNode.appendChild(el);
return el;
}

function hufaCatalogSetHidden(){
const idEl = hufaCatalogHiddenId("hufaCatalogId");
const codeEl = hufaCatalogHiddenId("hufaCatalogCode");
const variantEl = hufaCatalogHiddenId("hufaCatalogVariant");
const yearEl = hufaCatalogHiddenId("hufaCatalogYearValue");
if(idEl){ idEl.value = selectedHufaCatalog?.id || ""; }
if(codeEl){ codeEl.value = selectedHufaCatalog?.vehicle_code || ""; }
if(variantEl){ variantEl.value = selectedHufaCatalog?.variant || ""; }
if(yearEl){
yearEl.value =
selectedHufaCatalog?.year_active === null ||
selectedHufaCatalog?.year_active === undefined
? ""
: String(selectedHufaCatalog.year_active);
}
}

/* Small null-safe toggler (same .hidden utility the rest of the
page uses — verified present in the frozen Tailwind bundle). */
function hufaCatalogSetFieldVisible(id, visible){
const el = document.getElementById(id);
if(!el){ return; }
if(visible){
el.classList.remove("hidden");
}else{
el.classList.add("hidden");
}
}

/* Single source of truth for the Make → Model → Year → results
layout.

  catalogue mode ON  : #hufaCatalogBlock (its own Year step) is the
                       primary UI, so the legacy #variant dropdown
                       and the manual #year input step aside.
  catalogue mode OFF : both legacy fields are the whole UI (today's
                       original behaviour).
  fallback           : as soon as there is nothing selectable in the
                       catalogue (no rows for the chosen year) OR the
                       seller asks for manual entry, BOTH legacy
                       fields reappear — the manual/OTHER route is
                       therefore never removed, only deferred. */
function hufaCatalogApplyFieldVisibility(){
const catalogMode = hufaYearMode === "catalog" && !hufaCatalogManualOverride;
const yearChosen = String(document.getElementById("hufaCatalogYear")?.value || "").trim();
const noRowsForYear = catalogMode && !!yearChosen && !hufaCatalogRows.length;
const legacyVisible = !catalogMode || noRowsForYear;
hufaCatalogSetFieldVisible("hufaCatalogBlock", catalogMode);
hufaCatalogSetFieldVisible("yearField", legacyVisible);
hufaCatalogSetFieldVisible("variantField", legacyVisible);
}

function hufaCatalogSetYearMode(mode){
hufaYearMode = (mode === "catalog") ? "catalog" : "manual";
hufaCatalogApplyFieldVisibility();
}

function hufaCatalogSetResultsMessage(message){
const box = document.getElementById("hufaCatalogResults");
if(!box){ return; }
if(!message){ box.innerHTML = ""; return; }
box.textContent = message;
}

function hufaCatalogDetail(label, value){
const text = hufaEscapeHtml(value);
if(!text){ return ""; }
return `<div><span class="font-semibold text-slate-700">${label}:</span> ${text}</div>`;
}

/* PHASE 2 — card presentation helpers. Every helper returns ""
for a missing value (hufaCatalogText already filters null /
undefined / NaN / blank), so empty fields are never rendered. */

/* Numeric column with a unit suffix ("999" -> "999 cc"). A value
that already carries letters is shown verbatim (never double-unit). */
function hufaCatalogUnit(value, unit){
const text = hufaEscapeHtml(value);
if(!text){ return ""; }
return /[a-z]/i.test(text) ? text : `${text} ${unit}`;
}

/* Joins the present parts of one spec line with a light pipe. */
function hufaCatalogJoin(parts){
return parts.filter(Boolean).join(` <span class="text-slate-400">|</span> `);
}

/* Small rounded chip for the top-level record facts (already
escaped by the caller — the chip never re-escapes). */
function hufaCatalogChip(html){
if(!html){ return ""; }
return `<span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600">${html}</span>`;
}

/* One "Label: value" fact for the details grid. Returns "" when
the record has no value for that column. */
function hufaCatalogField(label, value, nice){
const text = nice ? hufaCatalogNiceText(value) : hufaEscapeHtml(value);
if(!text){ return ""; }
return `<div class="min-w-0 text-xs"><span class="text-slate-400">${label}</span> <span class="font-semibold text-slate-700 break-words">${text}</span></div>`;
}

/* PHASE 2 — ONE exact catalogue record = ONE self-contained,
responsive card (replaces the old 17-column table that forced
horizontal scrolling). PHASE 2.1 seller-facing hierarchy:
1) Manufacturer / Model (identity, biggest)  2) Variant
3) Year + Vehicle Type + Body Style chips  4) Engine / Transmission /
Drive Type sections  5) Doors / Seats / Fuel / Introduced / Terminated
6) its own always-visible SELECT button
7) HUFA Vehicle Code as an ADMINISTRATIVE REFERENCE at the bottom.
The card keeps data-hufa-row (existing selection highlight in
hufaCatalogMarkSelected) and the button keeps data-hufa-select
(the existing click binding), so NO selection logic changes. */
function hufaCatalogCard(row, index){
const code = hufaEscapeHtml(row.vehicle_code);
const manufacturer = hufaEscapeHtml(row.manufacturer);
const model = hufaEscapeHtml(row.model);
const variant = hufaEscapeHtml(row.variant);
const title = [manufacturer, model].filter(Boolean).join(" ");
const yearText = hufaEscapeHtml(row.year_active);
const engineLine = hufaCatalogJoin([
hufaCatalogUnit(row.cc, "cc"),
hufaCatalogUnit(row.kw, "kW"),
hufaCatalogUnit(row.cylinders, "Cylinders")
]);
const transmissionText = hufaCatalogNiceText(row.transmission);
const driveText = hufaCatalogNiceText(row.drive_type);
const vehicleTypeText = hufaCatalogNiceText(row.vehicle_type);
const bodyStyleText = hufaCatalogNiceText(row.body_style);
const chips = [
hufaCatalogChip(yearText ? `Year ${yearText}` : ""),
hufaCatalogChip(vehicleTypeText ? `Type: ${vehicleTypeText}` : ""),
hufaCatalogChip(bodyStyleText ? `Body: ${bodyStyleText}` : "")
].filter(Boolean).join("");
const fields = [
hufaCatalogField("Doors:", row.doors),
hufaCatalogField("Seats:", row.seats),
hufaCatalogField("Fuel:", row.fuel_type, true),
hufaCatalogField("Introduced:", row.introduced),
hufaCatalogField("Terminated:", row.terminated)
].filter(Boolean);
const specSection = (label, valueHtml)=>
`<div class="min-w-0 rounded-lg border border-slate-100 bg-slate-50 p-2">`
+ `<p class="text-[10px] font-black uppercase tracking-wider text-slate-400">${label}</p>`
+ `<p class="mt-0.5 text-sm font-bold text-slate-800 break-words">${valueHtml}</p>`
+ `</div>`;
return `<div data-hufa-row="${index}" class="hufa-cat-card rounded-xl border border-slate-200 bg-white p-3 sm:p-4">`
/* 1) VEHICLE IDENTITY FIRST — the seller identifies the car here. */
+ `<div class="flex flex-wrap items-start justify-between gap-2">`
+ `<div class="min-w-0">`
+ (variant
   ? `<h4 class="text-lg font-bold text-slate-900 break-words">${variant}</h4>`
   : (title ? `<h4 class="text-lg font-bold text-slate-900 break-words">${title}</h4>` : ""))
+ (variant && title ? `<p class="mt-0.5 text-xs font-semibold text-slate-500 break-words">${title}</p>` : "")
+ `</div>`
+ (chips ? `<div class="flex flex-wrap justify-end gap-1.5">${chips}</div>` : "")
+ `</div>`
+ (engineLine || transmissionText || driveText
? `<div class="mt-2 grid grid-cols-2 gap-2">`
+ (engineLine ? specSection("Engine", engineLine) : "")
+ (transmissionText ? specSection("Transmission", transmissionText) : "")
+ (driveText ? specSection("Drive Type", driveText) : "")
+ `</div>`
: "")
+ (fields.length
? `<div class="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">${fields.join("")}</div>`
: "")
+ `<div class="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-3">`
+ (code
   ? `<p class="min-w-0 text-[10px] text-slate-400 break-words"><span class="font-black tracking-[0.1em]">HUFA Vehicle Code</span>: <span class="font-black text-xs text-[#F28C28]">${code}</span></p>`
   : `<span></span>`)
+ `<button type="button" data-hufa-select="${index}" class="min-h-10 flex-none rounded-lg bg-[#08111F] px-5 py-2.5 text-xs font-black uppercase tracking-wider text-white">Select</button>`
+ `</div>`
/* 7) PHASE 2.1 — HUFA Vehicle Code demoted to an administrative
reference at the BOTTOM of the card (existing orange value styling). */
+ `</div>`;
}

/* =========================================================
   PHASE 2 FINAL REFINEMENT — DETAILED VIEW (DEFAULT)
   PHASE 2.1 — seller-facing information hierarchy.
   ---------------------------------------------------------
   ONE exact catalogue record = ONE table row. The detailed view
   exposes the FULL catalogue information: every required column plus
   any optional catalogue column that actually carries a value in
   this result set.
   PHASE 2.1 ordering: seller-relevant vehicle identity first
   (Manufacturer -> Model -> Variant -> Year -> Type -> specs) and the
   HUFA Vehicle Code LAST, because it is an internal/admin reference.
   SELECT and the VARIANT are pinned to the left, so a seller can
   scroll the wide specification while always seeing WHICH variant
   the SELECT button belongs to.
   Values come straight from the catalogue row; a missing value is a
   neutral dash — never "null" / "undefined" / "NaN" and never an
   invented value.
   ========================================================= */

/* Required columns — PHASE 2.1 SELLER-FIRST ORDER:
Manufacturer, Model, Variant, Year Active, Vehicle Type, CC, kW,
Doors, Seats, Body Style, Fuel Type, Transmission, Drive Type,
Introduced, Terminated. The HUFA Vehicle Code is NOT in this list:
it is appended as the FINAL column by hufaCatalogDetailedTable().
`sticky: "pin"` pins VARIANT beside SELECT, `nice` pretty-prints
enum text, `unit` appends a unit to a bare number, `wrap` lets long
text wrap. */
const HUFA_CAT_DETAILED_COLUMNS = [
{ key: "manufacturer", label: "Manufacturer" },
{ key: "model", label: "Model" },
{ key: "variant", label: "Variant", wrap: true, sticky: "pin" },
{ key: "year_active", label: "Year Active" },
{ key: "vehicle_type", label: "Vehicle Type", nice: true },
{ key: "cc", label: "CC", unit: "cc" },
{ key: "kw", label: "kW", unit: "kW" },
{ key: "doors", label: "Doors" },
{ key: "seats", label: "Seats" },
{ key: "body_style", label: "Body Style", nice: true },
{ key: "fuel_type", label: "Fuel Type", nice: true },
{ key: "transmission", label: "Transmission", nice: true },
{ key: "drive_type", label: "Drive Type", nice: true },
{ key: "introduced", label: "Introduced" },
{ key: "terminated", label: "Terminated" }
];

/* PHASE 2.1 — the internal/admin reference always renders as the
LAST column of the row (after the data-driven extras below) and is
never pinned. The header is uppercased by the table styles, so the
seller reads it exactly as "HUFA VEHICLE CODE". The value keeps the
existing orange HUFA reference styling (.hufa-cat-code). */
const HUFA_CAT_DETAILED_CODE_COLUMN = { key: "vehicle_code", label: "HUFA Vehicle Code", code: true };

/* Additional EXISTING catalogue information. A column is only shown
when at least one row in the current result set carries a value, so
the detailed view adds real detail without padding empty columns. */
const HUFA_CAT_DETAILED_EXTRA_COLUMNS = [
{ key: "engine_size_l", label: "Engine Size (L)", unit: "L" },
{ key: "cylinders", label: "Cylinders" },
{ key: "torque_nm", label: "Torque (Nm)" },
{ key: "turbocharged", label: "Turbocharged" },
{ key: "fuel_consumption_l100", label: "Fuel Use (l/100km)" },
{ key: "co2_emissions_gkm", label: "CO2 (g/km)" },
{ key: "commercial_vehicle", label: "Commercial" },
{ key: "commercial_category", label: "Commercial Category", nice: true },
{ key: "cab_configuration", label: "Cab Configuration", nice: true },
{ key: "payload_capacity_kg", label: "Payload (kg)" },
{ key: "towing_capacity_kg", label: "Towing (kg)" },
{ key: "is_electric", label: "Electric" },
{ key: "is_hybrid", label: "Hybrid" },
{ key: "is_plugin_hybrid", label: "Plug-In Hybrid" },
{ key: "battery_capacity_kwh", label: "Battery (kWh)" },
{ key: "battery_range_km", label: "Battery Range (km)" },
{ key: "electric_range_km", label: "Electric Range (km)" },
{ key: "charging_time_hours", label: "Charging Time (h)" },
{ key: "fast_charging", label: "Fast Charging" },
{ key: "charge_port", label: "Charge Port", nice: true },
{ key: "charge_port_location", label: "Charge Port Location", nice: true },
{ key: "powertrain_type", label: "Powertrain", nice: true }
];

/* Display-ready, HTML-escaped cell text for one catalogue column.
A real boolean renders as Yes / No (a stored false is real data,
never the word "false"); every other missing value returns "". */
function hufaCatalogCellValue(row, column){
const raw = row ? row[column.key] : null;
if(typeof raw === "boolean"){ return raw ? "Yes" : "No"; }
if(column.unit){ return hufaCatalogUnit(raw, column.unit); }
return column.nice ? hufaCatalogNiceText(raw) : hufaEscapeHtml(raw);
}

function hufaCatalogDetailedRow(row, index, columns){
const cells = columns.map((column)=>{
if(column.select){
return `<td class="hufa-cat-col-select" data-label="Select">`
+ `<span class="hufa-cat-mobile-label">Select</span>`
+ `<button type="button" data-hufa-select="${index}" class="hufa-cat-select-btn">Select</button>`
+ `</td>`;
}
const value = hufaCatalogCellValue(row, column);
const classes = [];
/* PHASE 2.1 — VARIANT is the pinned companion of SELECT. */
if(column.sticky === "pin"){ classes.push("hufa-cat-col-variant"); }
if(column.code){ classes.push("hufa-cat-col-code"); }
if(column.wrap){ classes.push("hufa-cat-cell-wrap"); }
const body = value
? (column.code ? `<span class="hufa-cat-code">${value}</span>` : value)
: `<span class="hufa-cat-empty" title="Not recorded">&#8211;</span>`;
return `<td${classes.length ? ` class="${classes.join(" ")}"` : ""} data-label="${hufaEscapeHtml(column.label)}">`
+ `<span class="hufa-cat-mobile-label">${hufaEscapeHtml(column.label)}</span>${body}</td>`;
}).join("");
return `<tr data-hufa-row="${index}">${cells}</tr>`;
}

function hufaCatalogDetailedTable(rows){
/* A column is only added when the CURRENT result set really carries
it: boolean flag columns need at least one true value, every other
column needs at least one non-empty value. Nothing is padded. */
const extras = HUFA_CAT_DETAILED_EXTRA_COLUMNS.filter((column)=>rows.some((row)=>{
const raw = row ? row[column.key] : null;
if(typeof raw === "boolean"){ return raw === true; }
return hufaCatalogCellValue(row, column) !== "";
}));
/* PHASE 2.1 — the HUFA Vehicle Code column is appended LAST, after
the data-driven extras, so the internal reference can never sit in
the middle of the seller-facing specification. */
const columns = [{ key: "__select__", label: "Select", select: true }]
.concat(HUFA_CAT_DETAILED_COLUMNS, extras, [HUFA_CAT_DETAILED_CODE_COLUMN]);
const head = columns.map((column)=>{
const classes = column.select
? "hufa-cat-col-select"
: (column.sticky === "pin"
? "hufa-cat-col-variant"
: (column.code ? "hufa-cat-col-code" : ""));
return `<th scope="col"${classes ? ` class="${classes}"` : ""}>${hufaEscapeHtml(column.label)}</th>`;
}).join("");
const body = rows.map((row, index)=>hufaCatalogDetailedRow(row, index, columns)).join("");
return `<div class="hufa-cat-table-wrap">`
+ `<table class="hufa-cat-table">`
+ `<caption class="hufa-cat-caption">Full catalogue detail &mdash; every available field is shown for each vehicle. Select stays easy to find and the HUFA Vehicle Code is included.</caption>`
+ `<thead><tr>${head}</tr></thead>`
+ `<tbody>${body}</tbody>`
+ `</table>`
+ `</div>`;
}

/* =========================================================
   PHASE 2 FINAL REFINEMENT — VIEW STATE + SHARED HOOKS
   Presentation only. DETAILED VIEW is the default, CARD VIEW is the
   second option; both read the SAME hufaCatalogRows array and use
   the SAME SELECT logic + selection state.
   ========================================================= */

/* Clears both rendered presentations and the shared count. Called
wherever the result set is reset/replaced, so no stale view (and no
stale count) can ever survive into a new search. */
function hufaCatalogClearViews(){
const meta = document.getElementById("hufaCatalogMeta");
if(meta){ meta.classList.add("hidden"); }
const count = document.getElementById("hufaCatalogCount");
if(count){ count.textContent = ""; }
const detailed = document.getElementById("hufaCatalogDetailedView");
if(detailed){ detailed.innerHTML = ""; detailed.classList.add("hidden"); }
const cards = document.getElementById("hufaCatalogCardView");
if(cards){ cards.innerHTML = ""; cards.classList.add("hidden"); }
}

/* Keeps the pinned VARIANT column flush against the SELECT
column: the lead column width is measured from the rendered table.
A hidden container reports 0px, so this also re-runs every time the
detailed view becomes visible. */
function hufaCatalogAlignDetailedTable(){
const table = document.querySelector("#hufaCatalogDetailedView .hufa-cat-table");
if(!table){ return; }
const lead = table.querySelector("thead .hufa-cat-col-select");
if(!lead){ return; }
const width = Math.round(lead.getBoundingClientRect().width);
if(width > 0){ table.style.setProperty("--hufa-cat-lead-w", width + "px"); }
}

/* DETAILED VIEW (default) <-> CARD VIEW. Only the visibility of the
two already-rendered containers changes: no catalogue query, no
re-render, no selection change. */
function hufaCatalogApplyView(view){
hufaCatalogView = (view === "card") ? "card" : "detailed";
const viewInput = document.getElementById("hufaCatalogView");
if(viewInput){ viewInput.value = hufaCatalogView; }
const detailed = document.getElementById("hufaCatalogDetailedView");
const cards = document.getElementById("hufaCatalogCardView");
if(detailed){ detailed.classList.toggle("hidden", hufaCatalogView !== "detailed"); }
if(cards){ cards.classList.toggle("hidden", hufaCatalogView !== "card"); }
document
.querySelectorAll("#hufaCatalogViewSwitcher [data-hufa-view]")
.forEach((btn)=>{
const active = btn.getAttribute("data-hufa-view") === hufaCatalogView;
btn.classList.toggle("is-active", active);
btn.setAttribute("aria-pressed", active ? "true" : "false");
});
if(hufaCatalogView === "detailed"){ hufaCatalogAlignDetailedTable(); }
}

/* ONE SELECT binding for BOTH views — identical handler, identical
row indexes into the SAME hufaCatalogRows array. */
function hufaCatalogBindSelectButtons(){
document
.querySelectorAll("#hufaCatalogDetailedView [data-hufa-select], #hufaCatalogCardView [data-hufa-select]")
.forEach((btn)=>{
btn.addEventListener("click", ()=>{
const index = Number(btn.getAttribute("data-hufa-select"));
if(Number.isFinite(index)){ hufaCatalogSelectRow(index); }
});
});
}

/* ONE highlight routine for BOTH views: the same selected catalogue
record is tinted in the detailed table rows and in the card list
(the table needs the class as well, because its pinned cells carry
their own opaque background). */
function hufaCatalogHighlightRows(index){
document
.querySelectorAll("#hufaCatalogDetailedView [data-hufa-row], #hufaCatalogCardView [data-hufa-row]")
.forEach((rowEl)=>{
const isActive = Number(rowEl.getAttribute("data-hufa-row")) === index;
rowEl.style.backgroundColor = isActive ? "#ecfdf5" : "";
rowEl.classList.toggle("hufa-cat-row-selected", isActive);
});
}

function hufaCatalogRenderRows(){
const box = document.getElementById("hufaCatalogResults");
if(!box){ return; }
if(!hufaCatalogRows.length){
/* Wording fixed by the UX spec; the legacy Variant dropdown +
manual Year reappear beside it through
hufaCatalogApplyFieldVisibility() below. */
box.innerHTML = `<p class="text-xs text-slate-500">No catalogue variants found.</p>`;
hufaCatalogClearViews();
hufaCatalogApplyFieldVisibility();
return;
}
/* ONE shared result-count element (#hufaCatalogCount) drives BOTH
views. It lives OUTSIDE the two view containers, so the count can
never be duplicated, can never disappear while switching views and
is always rebuilt from the CURRENT result set. */
const countBox = document.getElementById("hufaCatalogCount");
if(countBox){
const makeText = hufaCatalogText(val("make"));
const modelText = hufaCatalogText(val("model"));
const yearText = hufaCatalogText(document.getElementById("hufaCatalogYear")?.value || "");
countBox.textContent =
`${hufaCatalogRows.length} catalogue record${hufaCatalogRows.length === 1 ? "" : "s"} for `
+ [makeText, modelText, yearText].filter(Boolean).join(" ");
}
const meta = document.getElementById("hufaCatalogMeta");
if(meta){ meta.classList.remove("hidden"); }
/* BOTH views render from the SAME hufaCatalogRows array: the
detailed table (DEFAULT) and the existing responsive cards. */
const detailedBox = document.getElementById("hufaCatalogDetailedView");
if(detailedBox){ detailedBox.innerHTML = hufaCatalogDetailedTable(hufaCatalogRows); }
const cardBox = document.getElementById("hufaCatalogCardView");
if(cardBox){ cardBox.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 items-stretch gap-3">${hufaCatalogRows.map((row, index)=>hufaCatalogCard(row, index)).join("")}</div>`; }
/* The message area is empty while catalogue rows exist. */
box.innerHTML = "";
hufaCatalogBindSelectButtons();
/* DEFAULT = DETAILED VIEW. */
hufaCatalogApplyView(hufaCatalogView);
/* A re-render must never lose an already-selected record. */
const selectedIndex = selectedHufaCatalog ? hufaCatalogRows.indexOf(selectedHufaCatalog) : -1;
if(selectedIndex >= 0){ hufaCatalogHighlightRows(selectedIndex); }
hufaCatalogApplyFieldVisibility();
}

/* Normalized comparison key: lower-case, alphanumerics only. Used
ONLY to choose between options that ALREADY exist in the form. */
function hufaCatalogNorm(value){
return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* Finds the existing option that best matches a catalogue value.
Never creates an option. Order:
1. Exact value/text match (the legacy behaviour).
2. Normalized match ("petrol" -> "Petrol", "minibus" -> "Mini Bus").
3. Longest existing option contained in the catalogue value
   ("Double Cab Bakkie" -> "Double Cab"). Body styles only, where
   containment is semantically safe. */
function hufaCatalogFindOption(select, value, allowContains){
const text = hufaCatalogText(value);
if(!select || !text){ return null; }
const options = Array.from(select.options || []);
const exact = options.find((opt)=>String(opt.value).trim() === text || String(opt.textContent || "").trim() === text);
if(exact){ return exact; }
const target = hufaCatalogNorm(text);
if(!target){ return null; }
const normalized = options.find((opt)=>hufaCatalogNorm(opt.value) === target || hufaCatalogNorm(opt.textContent) === target);
if(normalized){ return normalized; }
if(!allowContains){ return null; }
let best = null;
for(const opt of options){
const key = hufaCatalogNorm(opt.value);
if(!key || key.length < 3){ continue; }
if(target.indexOf(key) === -1){ continue; }
if(!best || key.length > best.length){ best = { length: key.length, opt: opt }; }
}
return best ? best.opt : null;
}

/* Keyword fallback for the columns whose form options are coarser
than the catalogue text (the Transmission dropdown only offers
Automatic / Manual, the catalogue says "5-speed manual", "CVT",
"7DCT", ...). Still picks an EXISTING option only, and the exact
catalogue string is always shown verbatim on the result card and
kept in the hidden catalogue identity fields. */
function hufaCatalogKeywordOption(select, value, kind){
const text = hufaCatalogText(value).toLowerCase();
if(!select || !text){ return null; }
const options = Array.from(select.options || []);
const findKey = (key)=>options.find((opt)=>hufaCatalogNorm(opt.value) === key);
if(kind === "transmission"){
if(/amt|automatic|auto|cvt|dct|dsg|dht|at$/.test(text)){ return findKey("automatic"); }
if(/manual|mt$/.test(text)){ return findKey("manual"); }
return null;
}
if(kind === "fuel"){
/* hybrid first: a petrol-electric plug-in hybrid must never be
misread as a full Electric vehicle. */
if(text.indexOf("hybrid") !== -1){ return findKey("hybrid"); }
if(text.indexOf("electric") !== -1){ return findKey("electric"); }
if(text.indexOf("diesel") !== -1){ return findKey("diesel"); }
if(text.indexOf("petrol") !== -1 || text.indexOf("gasoline") !== -1){ return findKey("petrol"); }
return null;
}
return null;
}

function hufaCatalogCaptureManualEdits(){
const protectedFields = new Map();
for(const [id, writtenValue] of hufaCatalogFormWrites){
const field = document.getElementById(id);
if(!field){ hufaCatalogFormWrites.delete(id); continue; }
const currentValue = field.type === "checkbox" ? String(field.checked) : String(field.value);
if(currentValue !== writtenValue){
protectedFields.set(id, currentValue);
hufaCatalogFormWrites.delete(id);
}
}
return protectedFields;
}

function hufaCatalogPrepareFormWrite(selectId, value, protectedFields, dispatchChange = true){
const field = document.getElementById(selectId);
if(!field || protectedFields.has(selectId)){ return null; }
const writtenValue = hufaCatalogFormWrites.get(selectId);
if(writtenValue !== undefined && String(field.value) !== writtenValue){
protectedFields.set(selectId, String(field.value));
hufaCatalogFormWrites.delete(selectId);
return null;
}
const text = hufaCatalogText(value);
if(!text){
if(writtenValue !== undefined){
const changed = String(field.value) !== "";
field.value = "";
hufaCatalogFormWrites.delete(selectId);
if(changed && dispatchChange && field.tagName === "SELECT"){
field.dispatchEvent(new Event("change"));
}
if(selectId === "variant"){ toggleCustomVariant(); }
}
return null;
}
return { field, text, writtenValue };
}

function hufaCatalogRejectFormWrite(selectId, prepared, dispatchChange = true){
if(!prepared || prepared.writtenValue === undefined){ return false; }
const { field } = prepared;
const changed = String(field.value) !== "";
field.value = "";
hufaCatalogFormWrites.delete(selectId);
if(changed && dispatchChange && field.tagName === "SELECT"){
field.dispatchEvent(new Event("change"));
}
if(selectId === "variant"){ toggleCustomVariant(); }
return false;
}

function hufaCatalogCommitFormWrite(selectId, prepared){
hufaCatalogFormWrites.set(selectId, String(prepared.field.value));
return true;
}

function hufaCatalogClearTrackedField(selectId, protectedFields, dispatchChange = true){
const field = document.getElementById(selectId);
if(!field || protectedFields.has(selectId)){ return false; }
const writtenValue = hufaCatalogFormWrites.get(selectId);
if(writtenValue === undefined || String(field.value) !== writtenValue){
hufaCatalogFormWrites.delete(selectId);
return false;
}
const changed = String(field.value) !== "";
field.value = "";
hufaCatalogFormWrites.delete(selectId);
if(changed && dispatchChange && field.tagName === "SELECT"){
field.dispatchEvent(new Event("change"));
}
return true;
}

function hufaCatalogSetSelectIfOption(selectId, value, kind, protectedFields, dispatchChange = true, allowCatalogueOption = false){
const prepared = hufaCatalogPrepareFormWrite(selectId, value, protectedFields, dispatchChange);
if(!prepared){ return false; }
const { field: select, text } = prepared;
let match =
hufaCatalogFindOption(select, text, kind === "body") ||
hufaCatalogKeywordOption(select, text, kind);
/* Variant options can be added from this actual selected record.
Other fields only use options already defined by the form. */
if(!match && allowCatalogueOption){
match = document.createElement("option");
match.value = text;
match.textContent = text + " (Catalogue)";
select.appendChild(match);
}
if(!match){ return hufaCatalogRejectFormWrite(selectId, prepared, dispatchChange); }
const changed = String(select.value) !== String(match.value);
select.value = match.value;
if(changed && dispatchChange){ select.dispatchEvent(new Event("change")); }
hufaCatalogCommitFormWrite(selectId, prepared);
return true;
}

/* Value-only columns (doors/seats) are set only when the exact
option exists, so a catalogue number can never blank the field. */
function hufaCatalogSetValueIfOption(selectId, value, protectedFields){
const prepared = hufaCatalogPrepareFormWrite(selectId, value, protectedFields);
if(!prepared){ return false; }
const { field: select, text } = prepared;
const number = Number(text);
if(!Number.isInteger(number) || number < 0){
return hufaCatalogRejectFormWrite(selectId, prepared);
}
const match = Array.from(select.options || []).find((opt)=>String(opt.value).trim() === String(number));
if(!match){ return hufaCatalogRejectFormWrite(selectId, prepared); }
const changed = String(select.value) !== String(match.value);
select.value = match.value;
if(changed){ select.dispatchEvent(new Event("change")); }
hufaCatalogCommitFormWrite(selectId, prepared);
return true;
}

function hufaCatalogSetIntegerInputIfValid(inputId, value, protectedFields, min, max){
const prepared = hufaCatalogPrepareFormWrite(inputId, value, protectedFields);
if(!prepared){ return false; }
const number = Number(prepared.text);
if(!Number.isInteger(number) || number < min || number > max){
return hufaCatalogRejectFormWrite(inputId, prepared);
}
prepared.field.value = String(number);
hufaCatalogCommitFormWrite(inputId, prepared);
return true;
}

/* Nearest-number option matching for the catalogue's numeric
columns (cc, battery capacity/range, charging time, payload,
towing). Picks the CLOSEST option that already exists and only
accepts it when the distance is inside the given tolerance, so a
catalogue figure is rounded to the form's own scale (999cc ->
"1000 cc", 1.5h -> "1.5") instead of ever inventing an option.
A failed match leaves the seller's value completely untouched. */
function hufaCatalogSetNumberIfOption(selectId, value, ratioTolerance, absTolerance, protectedFields){
const prepared = hufaCatalogPrepareFormWrite(selectId, value, protectedFields);
if(!prepared){ return false; }
const { field: select, text } = prepared;
if(!select.options || !select.options.length){ return hufaCatalogRejectFormWrite(selectId, prepared); }
const numericText = text.replace(/[^0-9.]/g, "");
const target = Number(numericText);
if(!/[0-9]/.test(numericText) || !Number.isFinite(target) || target < 0){ return hufaCatalogRejectFormWrite(selectId, prepared); }
let best = null;
for(const opt of select.options){
const raw = String(opt.value !== undefined && opt.value !== null ? opt.value : (opt.textContent || ""));
if(!/[0-9]/.test(raw)){ continue; }
const num = Number(raw.replace(/[^0-9.]/g, ""));
if(!Number.isFinite(num)){ continue; }
const diff = Math.abs(num - target);
if(!best || diff < best.diff){ best = { diff: diff, opt: opt }; }
}
if(!best){ return hufaCatalogRejectFormWrite(selectId, prepared); }
const allowed = target === 0
? 0
: Math.max(Number(absTolerance) || 0, target * (Number(ratioTolerance) || 0));
if(best.diff > allowed){ return hufaCatalogRejectFormWrite(selectId, prepared); }
const changed = String(select.value) !== String(best.opt.value);
select.value = best.opt.value;
hufaCatalogCommitFormWrite(selectId, prepared);
if(changed){ select.dispatchEvent(new Event("change")); }
return true;
}

/* Human readable label for catalogue enums stored as snake_case /
kebab-case ("passenger_car" -> "Passenger Car"). Pretty-printed
first, then HTML-escaped so it is safe inside the table cell. */
function hufaCatalogNiceText(value){
const text = hufaCatalogText(value);
if(!text){ return ""; }
const pretty = text
.replace(/[_\-]+/g, " ")
.replace(/\s+/g, " ")
.trim()
.replace(/\b[a-z]/g, (ch)=>ch.toUpperCase());
return hufaEscapeHtml(pretty);
}

function hufaCatalogApplyCategoryVisibility(category){
const motorcycleCategories = ["Motorcycle", "ATV", "Quad Bike", "Side-by-Side"];
const isMotorcycle = motorcycleCategories.includes(category);
document.getElementById("commercialFields")?.classList.toggle("hidden", category !== "Commercial Vehicle");
document.getElementById("motorcycleFields")?.classList.toggle("hidden", !isMotorcycle);
document.getElementById("bodyField")?.classList.toggle("hidden", isMotorcycle);
document.getElementById("doorsField")?.classList.toggle("hidden", isMotorcycle);
document.getElementById("seatsField")?.classList.toggle("hidden", isMotorcycle);
}

const HUFA_EXTRA_SPEC_FIELDS = [
  ["engine_size_l", "Engine Size (L)", "engine_size_l"],
  ["kw", "Power Output (kW)", "power_kw"],
  ["torque_nm", "Torque (Nm)", "torque_nm"],
  ["cylinders", "Cylinders", "cylinders"],
  ["turbocharged", "Turbocharged", "turbocharged"],
  ["fuel_consumption_l100", "Fuel Consumption (L/100 km)", "fuel_consumption_l100"],
  ["co2_emissions_gkm", "CO₂ Emissions (g/km)", "co2_emissions_gkm"],
  ["electric_range_km", "Electric Range (km)", "electric_range_km"],
  ["fast_charging", "Fast Charging", "fast_charge"]
];

function hufaCatalogRenderExtraSpecs(record, isSavedRecord = false, protectedFields = new Map()){
  const container = document.getElementById("hufaCatalogAdditionalSpecs");
  if(!container){ return; }
  const existingFields = Array.from(container.querySelectorAll("input[id^='hufaSpec_']"));
  for(const field of existingFields){
    if(protectedFields.has(field.id) || hufaCatalogFormWrites.has(field.id)) continue;
    const id = field.id.slice("hufaSpec_".length);
    const catalogKey = id === "cc" ? "cc" : id;
    const dbKey = id === "cc" ? "engine_capacity_cc" : HUFA_EXTRA_SPEC_FIELDS.find(([key]) => key === id)?.[2];
    const sourceValue = isSavedRecord ? record?.[dbKey] : record?.[catalogKey];
    const hasSourceValue = field.type === "checkbox" ? sourceValue === true : hufaCatalogHasValue(sourceValue);
    const currentValue = field.type === "checkbox" ? String(field.checked) : String(field.value);
    if(!hasSourceValue && currentValue !== "" && currentValue !== "false") protectedFields.set(field.id, currentValue);
  }
  for(const booleanId of ["turbocharged", "fast_charging"]){
    const existing = document.getElementById(`hufaSpec_${booleanId}`);
    if(existing?.checked && record?.[booleanId] !== true){
      protectedFields.set(`hufaSpec_${booleanId}`, "true");
    }
  }
  const electricVehicle = /electric|hybrid/i.test(String(record?.fuel_type || ""));
  const specs = [];
  const ccValue = isSavedRecord ? record?.engine_capacity_cc : record?.cc;
  if(hufaCatalogHasValue(ccValue)){
    specs.push({ id: "cc", label: "Engine Capacity (cc)", value: ccValue, db: "engine_capacity_cc" });
  }
  for(const [key, label, db] of HUFA_EXTRA_SPEC_FIELDS){
    if(["electric_range_km", "fast_charging"].includes(key) && !electricVehicle) continue;
    const value = record?.[isSavedRecord ? db : key];
    const valid = key === "turbocharged" || key === "fast_charging"
      ? value === true || (isSavedRecord && typeof value === "boolean")
      : hufaCatalogHasValue(value);
    if(valid){ specs.push({ id: key, label, value, db, boolean: key === "turbocharged" || key === "fast_charging" }); }
  }
  for(const [fieldId, value] of protectedFields){
    if(!fieldId.startsWith("hufaSpec_") || value === "") continue;
    const id = fieldId.slice("hufaSpec_".length);
    if(specs.some(spec => spec.id === id)) continue;
    const definition = id === "cc"
      ? { label: "Engine Capacity (cc)", db: "engine_capacity_cc" }
      : HUFA_EXTRA_SPEC_FIELDS.find(([key]) => key === id)
        ? { label: HUFA_EXTRA_SPEC_FIELDS.find(([key]) => key === id)[1], db: HUFA_EXTRA_SPEC_FIELDS.find(([key]) => key === id)[2] }
        : null;
    if(definition){
      const boolean = id === "turbocharged" || id === "fast_charging";
      specs.push({ id, label: definition.label, db: definition.db, boolean, value: boolean ? value === "true" : value });
    }
  }
  container.innerHTML = "";
  for(const spec of specs){
    const fieldId = `hufaSpec_${spec.id}`;
    const manuallySet = protectedFields.has(fieldId);
    const value = manuallySet ? protectedFields.get(fieldId) : spec.value;
    const wrapper = document.createElement("div");
    if(spec.boolean){
      wrapper.innerHTML = `<label class="flex items-center gap-2 text-sm font-semibold"><input id="${fieldId}" type="checkbox" class="h-4 w-4"> ${hufaEscapeHtml(spec.label)}</label>`;
      wrapper.querySelector("input").checked = manuallySet ? value === "true" : value === true;
    }else{
      wrapper.innerHTML = `<label class="block mb-1 text-sm font-semibold" for="${fieldId}">${hufaEscapeHtml(spec.label)}</label><input id="${fieldId}" type="number" min="0" step="any" class="input-light" value="">`;
      wrapper.querySelector("input").value = String(value ?? "");
    }
    container.appendChild(wrapper);
    const field = wrapper.querySelector("input");
    field.addEventListener(field.type === "checkbox" ? "change" : "input", scheduleUploadDraftSave);
    if(!manuallySet && !isSavedRecord){ hufaCatalogFormWrites.set(fieldId, field.type === "checkbox" ? String(field.checked) : String(field.value)); }
  }
  container.classList.toggle("hidden", specs.length === 0);
}

function hufaCatalogHasValue(value){
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function hufaCatalogExtraNumber(id){
  const field = document.getElementById(`hufaSpec_${id}`);
  if(!field || field.value === "") return null;
  const value = Number(field.value);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function hufaCatalogRestoreProtectedFields(protectedFields){
for(const [id, value] of protectedFields){
const field = document.getElementById(id);
if(!field){ continue; }
if(field.type === "checkbox"){
field.checked = value === "true";
continue;
}
if(field.tagName === "SELECT"){
const optionExists = Array.from(field.options || []).some((option)=>String(option.value) === value);
if(optionExists){ field.value = value; }
}else{
field.value = value;
}
}
}

function hufaCatalogApplyToForm(row){
if(!row){ return; }
const protectedFields = hufaCatalogCaptureManualEdits();
hufaCatalogRenderExtraSpecs(row, false, protectedFields);
const motorcycleCategories = ["Motorcycle", "ATV", "Quad Bike", "Side-by-Side"];
const batteryFieldIds = ["batteryCapacity", "batteryRange", "chargingTime"];
const electricFuel = /electric|hybrid/.test(hufaCatalogText(row.fuel_type).toLowerCase());
if(!electricFuel){
for(const id of batteryFieldIds){
const field = document.getElementById(id);
if(field && String(field.value) && !hufaCatalogFormWrites.has(id)){
protectedFields.set(id, String(field.value));
}
}
}
/* Set a category only when the catalogue value exactly resolves to an
existing broad form option. Avoid its change listener, which clears the
active catalogue selection and reloads the make/model cascade. */
hufaCatalogSetSelectIfOption("vehicleCategory", row.vehicle_type, "option", protectedFields, false);
const selectedCategory = val("vehicleCategory");
hufaCatalogApplyCategoryVisibility(selectedCategory);
/* Search Vehicle already establishes this identity. Match the actual
existing Make/Model options without firing their reset/reload events. */
hufaCatalogSetSelectIfOption("make", row.manufacturer, "option", protectedFields, false);
hufaCatalogSetSelectIfOption("model", row.model, "option", protectedFields, false);
/* Match the upload form's integer year validation range. */
hufaCatalogSetIntegerInputIfValid("year", row.year_active, protectedFields, 1980, new Date().getFullYear());
hufaCatalogSetSelectIfOption("variant", row.variant, "option", protectedFields, false, true);
toggleCustomVariant();
hufaCatalogSetSelectIfOption("body", motorcycleCategories.includes(selectedCategory) ? null : row.body_style, "body", protectedFields);
hufaCatalogSetSelectIfOption("fuel", row.fuel_type, "fuel", protectedFields);
hufaCatalogSetSelectIfOption("trans", row.transmission, "transmission", protectedFields);
hufaCatalogSetSelectIfOption("drive", row.drive_type, "drive", protectedFields);
hufaCatalogSetValueIfOption("doors", motorcycleCategories.includes(selectedCategory) ? null : row.doors, protectedFields);
hufaCatalogSetValueIfOption("seats", motorcycleCategories.includes(selectedCategory) ? null : row.seats, protectedFields);
const fuelNowBeforeEvToggle = val("fuel").toLowerCase();
const selectedFuelIsElectric = /electric|hybrid/.test(fuelNowBeforeEvToggle);
if(!selectedFuelIsElectric){
for(const id of batteryFieldIds){
hufaCatalogClearTrackedField(id, protectedFields, false);
}
}
toggleEVFields();
/* Commercial cascade FIRST: setting commercialCategory dispatches
its change listener (updateCabConfigurations), which rebuilds the
cab list and then the payload/towing option lists — and rebuilding
CLEARS those selections. So category -> cab -> payload/towing must
run in exactly this order, otherwise the numbers below would be
matched against (and then wiped by) the previous option set. */
if(selectedCategory === "Commercial Vehicle"){
const commercialDependents = ["cabConfiguration", "payloadCapacityKg", "towingCapacityKg"];
const previousCommercialCategory = val("commercialCategory");
const categoryMatch = hufaCatalogFindOption(document.getElementById("commercialCategory"), row.commercial_category, false);
const categoryWouldChange = categoryMatch
? String(categoryMatch.value) !== String(previousCommercialCategory)
: (!hufaCatalogText(row.commercial_category) && hufaCatalogFormWrites.has("commercialCategory"));
const previousCabConfiguration = val("cabConfiguration");
const cabMatch = hufaCatalogFindOption(document.getElementById("cabConfiguration"), row.cab_configuration, false);
const cabWouldChange = !!cabMatch && String(cabMatch.value) !== String(previousCabConfiguration);
const commercialCascadeWouldReset = categoryWouldChange || cabWouldChange;
if(commercialCascadeWouldReset){
/* Preserve existing manual commercial values if changing either
parent select would rebuild and erase their option lists. */
for(const id of commercialDependents){
const field = document.getElementById(id);
if(field && String(field.value) && !hufaCatalogFormWrites.has(id)){
protectedFields.set(id, String(field.value));
}
}
}
const hasManuallyChangedCommercialDependent = commercialDependents.some((id)=>protectedFields.has(id));
const mayChangeCommercialCategory = !(categoryWouldChange && hasManuallyChangedCommercialDependent);
if(!mayChangeCommercialCategory){
/* A different category would invalidate this manually edited
commercial specification group, so keep the complete group intact. */
for(const id of commercialDependents){
protectedFields.set(id, String(val(id)));
}
}
let commercialCategoryWasChanged = false;
if(mayChangeCommercialCategory){
hufaCatalogSetSelectIfOption("commercialCategory", row.commercial_category, "option", protectedFields);
commercialCategoryWasChanged = String(val("commercialCategory")) !== String(previousCommercialCategory);
}
if(commercialCategoryWasChanged){
/* The category cascade rebuilt these options. Clear the previous
catalogue-derived values before applying this record's values. */
for(const id of commercialDependents){
hufaCatalogFormWrites.delete(id);
const field = document.getElementById(id);
if(field && !protectedFields.has(id)){ field.value = ""; }
}
}
if(!hasManuallyChangedCommercialDependent){
hufaCatalogSetSelectIfOption("cabConfiguration", row.cab_configuration, "option", protectedFields);
if(String(val("cabConfiguration")) !== String(previousCabConfiguration)){
/* Changing the cab rebuilds payload/towing choices; discard the
prior catalogue ownership before applying this row's numbers. */
for(const id of ["payloadCapacityKg", "towingCapacityKg"]){
hufaCatalogFormWrites.delete(id);
const field = document.getElementById(id);
if(field){ field.value = ""; }
}
}
}
}else{
for(const id of ["commercialCategory", "cabConfiguration", "payloadCapacityKg", "towingCapacityKg"]){
hufaCatalogClearTrackedField(id, protectedFields, false);
}
}
/* Numeric columns: rounded to the closest option the form already
has (and only when it is within tolerance). Tolerance = the larger
of 5% and the absolute floor, which covers every engine size the
form can express (999cc -> "1000 cc", 1462cc -> "1500 cc",
2393cc -> "2300 cc"); an outlier like 2755cc (nothing within 5%)
stays untouched instead of being rounded ~9% the wrong way. kW has
no input field in this form, so it stays display-only on the
result table. Payload/towing are only present on commercial rows;
passenger rows leave those fields exactly as the seller had them. */
hufaCatalogSetNumberIfOption("engineCapacityCc", motorcycleCategories.includes(selectedCategory) ? row.cc : null, 0.05, 50, protectedFields);
hufaCatalogSetNumberIfOption("batteryCapacity", selectedFuelIsElectric ? row.battery_capacity_kwh : null, 0.05, 2, protectedFields);
hufaCatalogSetNumberIfOption("batteryRange", selectedFuelIsElectric ? row.battery_range_km : null, 0.05, 25, protectedFields);
hufaCatalogSetNumberIfOption("chargingTime", selectedFuelIsElectric ? row.charging_time_hours : null, 0.1, 0.25, protectedFields);
hufaCatalogSetNumberIfOption("payloadCapacityKg", selectedCategory === "Commercial Vehicle" ? row.payload_capacity_kg : null, 0.05, 50, protectedFields);
hufaCatalogSetNumberIfOption("towingCapacityKg", selectedCategory === "Commercial Vehicle" ? row.towing_capacity_kg : null, 0.05, 50, protectedFields);
/* The existing fuel/category visibility rules can clear dependent
controls; restore fields that were manually changed after selection. */
hufaCatalogRestoreProtectedFields(protectedFields);
scheduleUploadDraftSave();
}

function hufaCatalogMarkSelected(index, applyToForm){
const row = hufaCatalogRows[index];
if(!row){ return; }
selectedHufaCatalog = row;
hufaCatalogSetHidden();
if(applyToForm !== false){
hufaCatalogApplyToForm(row);
}
const selectedBox = document.getElementById("hufaCatalogSelected");
if(selectedBox){
const code = hufaCatalogText(row.vehicle_code) || "-";
const variantName = hufaCatalogText(row.variant) || "Selected variant";
const yearText = hufaCatalogText(row.year_active);
selectedBox.classList.remove("hidden");
selectedBox.innerHTML = `<span>Selected: ${hufaEscapeHtml(variantName)} - HUFA ${hufaEscapeHtml(code)}${yearText ? ` - ${hufaEscapeHtml(yearText)}` : ""}</span> <button type="button" id="hufaCatalogDeselect" class="ml-3 inline-flex min-h-8 items-center rounded-lg border border-emerald-300 bg-white px-3 py-1 font-semibold text-emerald-900 hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" aria-label="Remove selected catalogue vehicle">Remove selection</button>`;
document.getElementById("hufaCatalogDeselect")?.addEventListener("click", hufaCatalogDeselectSelection);
}
/* ONE highlight routine for BOTH views — the same catalogue record
is tinted in the detailed table and in the card list, so switching
views always shows the SAME selection. */
hufaCatalogHighlightRows(index);
scheduleUploadDraftSave();
}

function hufaCatalogSelectRow(index){
hufaCatalogMarkSelected(index, true);
}

function hufaCatalogDeselectSelection(){
if(!selectedHufaCatalog){ return; }
const protectedFields = hufaCatalogCaptureManualEdits();
const extraContainer = document.getElementById("hufaCatalogAdditionalSpecs");
for(const field of Array.from(extraContainer?.querySelectorAll("input[id^='hufaSpec_']") || [])){
  const id = field.id;
  const current = field.type === "checkbox" ? String(field.checked) : String(field.value);
  if(!hufaCatalogFormWrites.has(id) && current !== "" && current !== "false") protectedFields.set(id, current);
}
for(const id of ["year", "variant", "body", "fuel", "trans", "drive", "doors", "seats", "engineCapacityCc", "batteryCapacity", "batteryRange", "chargingTime", "commercialCategory", "cabConfiguration", "payloadCapacityKg", "towingCapacityKg"]){
  hufaCatalogClearTrackedField(id, protectedFields, false);
}
for(const field of Array.from(extraContainer?.querySelectorAll("input[id^='hufaSpec_']") || [])){
  const id = field.id;
  if(protectedFields.has(id)){
    hufaCatalogFormWrites.delete(id);
    continue;
  }
  hufaCatalogFormWrites.delete(id);
  field.parentElement?.remove();
}
if(extraContainer){ extraContainer.classList.toggle("hidden", !extraContainer.children.length); }
selectedHufaCatalog = null;
hufaCatalogSetHidden();
hufaCatalogHighlightRows(-1);
const selectedBox = document.getElementById("hufaCatalogSelected");
if(selectedBox){ selectedBox.classList.add("hidden"); selectedBox.innerHTML = ""; }
scheduleUploadDraftSave();
}

/* =========================================================
PHASE 2 (HUFA VEHICLE SEARCH) - SEARCH IDENTITY -> DIRECT TABLE LOAD
---------------------------------------------------------
Clicking a Search Vehicle suggestion loads ALL catalogue
records for that Make + Model straight into the EXISTING
detailed results table. Reuses ONLY the existing catalogue
getters (getHufaCatalogYears / getHufaCatalogVariants) and
the existing render path (hufaCatalogRows +
hufaCatalogRenderRows + hufaCatalogApplyFieldVisibility).
No new table, component, columns, styling, SELECT logic or
catalog.js change. PHASE 2.1: the visible Year selector was removed;
its element is hidden but retained for existing JS/draft logic. The
table renders WITHOUT requiring a Year choice. Year filtering (Phase 3) is untouched
- picking a Year afterwards still runs the existing
hufaCatalogRefreshRows() path. */
async function hufaSearchDirectLoadCatalogue(make, model, knownYears){
if(isEdit){ return; }
const cleanMake = String(make ?? "").trim();
const cleanModel = String(model ?? "").trim();
if(!cleanMake || !cleanModel || cleanModel === "__OTHER_MODEL__"){
await hufaCatalogRefreshYears();
return;
}
/* New Make/Model search re-enables the catalogue path (same
rule as hufaCatalogRefreshYears). */
hufaCatalogManualOverride = false;
const manualFlag = document.getElementById("hufaCatalogManual");
if(manualFlag){ manualFlag.value = ""; }
selectedHufaCatalog = null;
hufaCatalogRows = [];
hufaCatalogSetHidden();
const selectedBox = document.getElementById("hufaCatalogSelected");
if(selectedBox){ selectedBox.classList.add("hidden"); selectedBox.innerHTML = ""; }
const yearSelect = document.getElementById("hufaCatalogYear");
if(yearSelect){ yearSelect.innerHTML = `<option value="">Loading years...</option>`; }
const requestId = ++hufaCatalogRequestSeq;
let years = Array.isArray(knownYears) ? knownYears : [];
if(!Array.isArray(knownYears)){
try{ years = await getHufaCatalogYears(cleanMake, cleanModel); }catch(e){ years = []; }
}
if(requestId !== hufaCatalogRequestSeq){ return; }
hufaCatalogYears = Array.isArray(years) ? years : [];
if(!hufaCatalogYears.length){
hufaCatalogSetYearMode("manual");
hufaCatalogSetResultsMessage("");
return;
}
/* Year selector stays intact for reference (Phase 3 owns it),
but NO year is pre-selected: the table below loads directly. */
hufaCatalogSetYearMode("catalog");
if(yearSelect){
yearSelect.innerHTML = `<option value="">Select Catalogue Year</option>` + hufaCatalogYears.map((year)=>`<option value="${year}">${year}</option>`).join("");
}
hufaCatalogSetResultsMessage("Loading catalogue variants...");
let combined = [];
try{
for(const year of hufaCatalogYears){
if(requestId !== hufaCatalogRequestSeq){ return; }
let rowsForYear = [];
try{ rowsForYear = await getHufaCatalogVariants(cleanMake, cleanModel, year); }catch(e){ rowsForYear = []; }
if(Array.isArray(rowsForYear) && rowsForYear.length){
combined.push(...rowsForYear);
}
}
}catch(e){ combined = []; }
if(requestId !== hufaCatalogRequestSeq){ return; }
/* Newest year first, then variant A-Z (same ordering the
per-year path uses, extended across years). */
combined.sort((a, b)=>{
const yearA = Number(a?.year_active);
const yearB = Number(b?.year_active);
const safeA = Number.isFinite(yearA) ? yearA : -Infinity;
const safeB = Number.isFinite(yearB) ? yearB : -Infinity;
if(safeB !== safeA){ return safeB - safeA; }
return String(a?.variant || "").localeCompare(String(b?.variant || ""));
});
hufaCatalogRows = combined;
if(!hufaCatalogRows.length){
hufaCatalogRenderRows();
return;
}
hufaCatalogRenderRows();
}

async function hufaCatalogRefreshYears(){
/* Create mode only: the Edit Vehicle route keeps its legacy form
untouched (same rule the text/image drafts already follow). */
if(isEdit){ return; }
/* A new Make/Model search always re-enables the catalogue path —
"enter the variant manually instead" is per-selection only. The
persisted flag is cleared with it; hufaCatalogRestoreFromDraft
captures the draft value before calling this and re-applies it. */
hufaCatalogManualOverride = false;
const manualFlag = document.getElementById("hufaCatalogManual");
if(manualFlag){ manualFlag.value = ""; }
const make = val("make").trim();
const model = val("model").trim();
const yearSelect = document.getElementById("hufaCatalogYear");
selectedHufaCatalog = null;
hufaCatalogRows = [];
hufaCatalogSetHidden();
const selectedBox = document.getElementById("hufaCatalogSelected");
if(selectedBox){ selectedBox.classList.add("hidden"); selectedBox.innerHTML = ""; }
if(yearSelect){ yearSelect.innerHTML = `<option value="">Select Catalogue Year</option>`; }
if(!make || !model || model === "__OTHER_MODEL__"){
hufaCatalogSetYearMode("manual");
hufaCatalogSetResultsMessage("");
return;
}
if(yearSelect){ yearSelect.innerHTML = `<option value="">Loading years...</option>`; }
const requestId = ++hufaCatalogRequestSeq;
let years = [];
try{ years = await getHufaCatalogYears(make, model); }catch(e){ years = []; }
if(requestId !== hufaCatalogRequestSeq){ return; }
hufaCatalogYears = Array.isArray(years) ? years : [];
if(!hufaCatalogYears.length){
hufaCatalogSetYearMode("manual");
hufaCatalogSetResultsMessage("");
return;
}
hufaCatalogSetYearMode("catalog");
if(yearSelect){
yearSelect.innerHTML = `<option value="">Select Catalogue Year</option>` + hufaCatalogYears.map((year)=>`<option value="${year}">${year}</option>`).join("");
}
hufaCatalogSetResultsMessage("Select a catalogue year to view the exact matching variants.");
}

async function hufaCatalogRefreshRows(){
/* Create mode only (see hufaCatalogRefreshYears). */
if(isEdit){ return; }
const make = val("make").trim();
const model = val("model").trim();
const yearValue = document.getElementById("hufaCatalogYear")?.value || "";
/* The catalogue Year IS the vehicle's Year: mirror it into #year
(which sits in a field the catalogue UI currently hides) so the
submit validation always has a real value, and a seller never has
to type the year while catalogue years exist. */
if(yearValue){ valSet("year", yearValue); }
selectedHufaCatalog = null;
hufaCatalogSetHidden();
const selectedBox = document.getElementById("hufaCatalogSelected");
if(selectedBox){ selectedBox.classList.add("hidden"); selectedBox.innerHTML = ""; }
/* A new result set always starts in the DEFAULT view; the previous
rendered presentations go with the cleared rows. */
hufaCatalogView = "detailed";
hufaCatalogClearViews();
if(!make || !model || !yearValue){
hufaCatalogRows = [];
if(hufaYearMode === "catalog" && !yearValue){
hufaCatalogSetResultsMessage("Select a catalogue year to view the exact matching variants.");
}else{
hufaCatalogSetResultsMessage("");
}
hufaCatalogApplyFieldVisibility();
return;
}
const requestId = ++hufaCatalogRequestSeq;
hufaCatalogSetResultsMessage("Loading catalogue variants...");
let rows = [];
let catalogFailed = false;
try{
rows = await getHufaCatalogVariants(make, model, yearValue);
catalogFailed = (isHufaCatalogAvailable() === false);
}catch(e){ rows = []; catalogFailed = true; }
if(requestId !== hufaCatalogRequestSeq){ return; }
hufaCatalogRows = Array.isArray(rows) ? rows : [];
if(!hufaCatalogRows.length && catalogFailed){
hufaCatalogSetResultsMessage("Catalogue lookup failed. You can continue with the Variant dropdown below or choose Other / Not Listed for manual entry.");
hufaCatalogApplyFieldVisibility();
return;
}
hufaCatalogRenderRows();
}

async function hufaCatalogRestoreFromDraft(draft){
const make = val("make").trim();
const model = val("model").trim();
const requestedView = draft?.hufaCatalogView === "card" ? "card" : "detailed";
hufaCatalogView = requestedView;
const viewInput = document.getElementById("hufaCatalogView");
if(viewInput){ viewInput.value = requestedView; }
/* Capture the persisted manual-override flag BEFORE refreshYears
clears it (the generic draft text loop has already written it
into #hufaCatalogManual by the time this function runs). */
const manualWanted = String(
draft?.hufaCatalogManual || document.getElementById("hufaCatalogManual")?.value || ""
).trim();
if(!make || !model || model === "__OTHER_MODEL__"){
hufaCatalogSetYearMode("manual");
hufaCatalogSetResultsMessage("");
hufaCatalogRenderExtraSpecs(null, false, hufaCatalogExtraDraftValues(draft));
hufaCatalogApplyView(requestedView);
return;
}
await hufaCatalogRefreshYears();
if(manualWanted === "1" || manualWanted === "true"){
/* The seller had abandoned the catalogue for this Make + Model:
keep the plain Variant + Year fields (with the draft-restored
values) exactly as they were. The next Make/Model change
re-enables the catalogue path. */
hufaCatalogManualOverride = true;
const flag = document.getElementById("hufaCatalogManual");
if(flag){ flag.value = "1"; }
hufaCatalogApplyFieldVisibility();
hufaCatalogRenderExtraSpecs(null, false, hufaCatalogExtraDraftValues(draft));
hufaCatalogApplyView(requestedView);
return;
}
if(hufaYearMode !== "catalog"){
hufaCatalogRenderExtraSpecs(null, false, hufaCatalogExtraDraftValues(draft));
hufaCatalogApplyView(requestedView);
return;
}
/* Hidden year = year of the SELECTED catalogue row; visible
drop-down year = the year whose rows were last displayed. Either
one is enough to rebuild the exact same result list. */
const selectedYear = String(draft?.hufaCatalogYearValue || "").trim();
const listedYear = String(draft?.hufaCatalogYear || "").trim();
const wantedYear = selectedYear || listedYear;
const draftId = String(draft?.hufaCatalogId || "").trim();
const yearSelect = document.getElementById("hufaCatalogYear");
let restoredRows = false;
if(wantedYear && yearSelect){
const hasYear = Array.from(yearSelect.options || []).some((opt)=>String(opt.value) === wantedYear);
if(hasYear){
yearSelect.value = wantedYear;
await hufaCatalogRefreshRows();
restoredRows = true;
}
}
if(!restoredRows){
/* Search Vehicle loads all matching years. Its result rows are
tab-local and cannot be inferred from the restored input values,
so rebuild them even when no catalogue year was selected. */
await hufaSearchDirectLoadCatalogue(make, model, hufaCatalogYears);
}
if(draftId){
const index = hufaCatalogRows.findIndex((row)=>String(row?.id ?? "") === draftId);
if(index >= 0){
/* Fresh catalogue data restores the selected row; persisted seller
edits are applied only to its dynamic spec controls below. */
hufaCatalogMarkSelected(index, false);
hufaCatalogRenderExtraSpecs(hufaCatalogRows[index], false, hufaCatalogExtraDraftValues(draft, hufaCatalogRows[index]));
hufaCatalogRestoreExtraSpecDraft(draft, hufaCatalogRows[index]);
}else{
selectedHufaCatalog = null;
hufaCatalogSetHidden();
hufaCatalogRenderExtraSpecs(null, false, hufaCatalogExtraDraftValues(draft));
}
}else{
hufaCatalogRenderExtraSpecs(null, false, hufaCatalogExtraDraftValues(draft));
}
hufaCatalogApplyView(requestedView);
}

function hufaCatalogExtraDraftValues(draft, row = null){
const values = new Map();
const numberSources = {
  hufaSpec_cc: row?.cc,
  hufaSpec_engine_size_l: row?.engine_size_l,
  hufaSpec_kw: row?.kw,
  hufaSpec_torque_nm: row?.torque_nm,
  hufaSpec_cylinders: row?.cylinders,
  hufaSpec_fuel_consumption_l100: row?.fuel_consumption_l100,
  hufaSpec_co2_emissions_gkm: row?.co2_emissions_gkm,
  hufaSpec_electric_range_km: row?.electric_range_km
};
for(const [id, source] of Object.entries(numberSources)){
  if(typeof draft?.[id] === "string" && draft[id] !== "" && (!row || String(draft[id]) !== String(source ?? ""))) values.set(id, draft[id]);
}
for(const [id, key, source] of [["hufaSpec_turbocharged", "turbocharged", row?.turbocharged], ["hufaSpec_fast_charging", "fast_charging", row?.fast_charging]]){
  const saved = draft?.hufaCatalogBooleanSpecs?.[key];
  if(typeof saved === "boolean" && (!row || saved !== (source === true))) values.set(id, String(saved));
}
return values;
}

function hufaCatalogRestoreExtraSpecDraft(draft, row){
const textIds = ["hufaSpec_cc", "hufaSpec_engine_size_l", "hufaSpec_kw", "hufaSpec_torque_nm", "hufaSpec_cylinders", "hufaSpec_fuel_consumption_l100", "hufaSpec_co2_emissions_gkm", "hufaSpec_electric_range_km"];
const numberSources = {
  hufaSpec_cc: row?.cc,
  hufaSpec_engine_size_l: row?.engine_size_l,
  hufaSpec_kw: row?.kw,
  hufaSpec_torque_nm: row?.torque_nm,
  hufaSpec_cylinders: row?.cylinders,
  hufaSpec_fuel_consumption_l100: row?.fuel_consumption_l100,
  hufaSpec_co2_emissions_gkm: row?.co2_emissions_gkm,
  hufaSpec_electric_range_km: row?.electric_range_km
};
for(const id of textIds){
  const field = document.getElementById(id);
  if(!field || typeof draft?.[id] !== "string") continue;
  field.value = draft[id];
  if(String(draft[id]) !== String(numberSources[id] ?? "")) hufaCatalogFormWrites.delete(id);
}
for(const [id, key, source] of [["hufaSpec_turbocharged", "turbocharged", row?.turbocharged], ["hufaSpec_fast_charging", "fast_charging", row?.fast_charging]]){
  const field = document.getElementById(id);
  const saved = draft?.hufaCatalogBooleanSpecs?.[key];
  if(!field || typeof saved !== "boolean") continue;
  field.checked = saved;
  if(saved !== (source === true)) hufaCatalogFormWrites.delete(id);
}
}

async function fillModels(){

  const make =
  document.getElementById(
    "make"
  ).value;

  await populateModelOptions(make);

  const list =
  document.getElementById(
    "model"
  );

  if(!make || !list){
    return;
  }

  const otherOption =
  document.createElement(
    "option"
  );

  otherOption.value =
  "__OTHER_MODEL__";

  otherOption.textContent =
  "Other / Not Listed";

  list.appendChild(
    otherOption
  );

}

async function fillVariants(){

  const make =
  val("make").trim();

  const model =
  val("model").trim();

  if(!make || !model){
    resetVariants();
    return;
  }

  if(model === "__OTHER_MODEL__"){
    resetVariants();
    return;
  }

  await populateVariantOptions(make, model);

  const list =
  document.getElementById(
    "variant"
  );

  if(!list){
    return;
  }

  const otherOption =
  document.createElement(
    "option"
  );

  otherOption.value =
  "__OTHER__";

  otherOption.textContent =
  "Other / Not Listed";

  list.appendChild(
    otherOption
  );

}

function toggleCustomModel(){

  const model =
  val("model");

  const custom =
  document.getElementById(
    "customModel"
  );

  if(!custom) return;

  if(
    model === "__OTHER_MODEL__"
  ){

    custom.classList.remove(
      "hidden"
    );

  }else{

    custom.classList.add(
      "hidden"
    );

    custom.value = "";

  }

}

function toggleCustomVariant(){

  const variant =
  val("variant");

  const custom =
  document.getElementById(
    "customVariant"
  );

  if(!custom) return;

  if(
    variant === "__OTHER__"
  ){

    custom.classList.remove(
      "hidden"
    );

  }else{

    custom.classList.add(
      "hidden"
    );

    custom.value = "";

  }

}

function toggleEVFields(){

  const fuel =
  val("fuel");

  const box =
  document.getElementById(
    "evFields"
  );

  if(!box) return;

  if(
    fuel === "Electric" ||
    fuel === "Hybrid" ||
    fuel === "Plug-In Hybrid"
  ){

    box.classList.remove(
      "hidden"
    );

  }else{

    box.classList.add(
      "hidden"
    );

    valSet(
      "batteryCapacity",
      ""
    );

    valSet(
      "batteryRange",
      ""
    );

    valSet(
      "chargingTime",
      ""
    );

  }

}

function toggleMotorcycleFields(){

  const category =
    val("vehicleCategory");

  const section =
    document.getElementById("motorcycleFields");

  const body =
    document.getElementById("body");

  const bodyField =
    document.getElementById("bodyField");

  const doorsField =
    document.getElementById("doorsField");

  const seatsField =
    document.getElementById("seatsField");

  const motorcycleCategories = [
    "Motorcycle",
    "ATV",
    "Quad Bike",
    "Side-by-Side"
  ];

  const showMotorcycleFields =
    motorcycleCategories.includes(category);

  if(section){

    section.classList.toggle(
      "hidden",
      !showMotorcycleFields
    );

  }

  if(bodyField){

    bodyField.classList.toggle(
      "hidden",
      showMotorcycleFields
    );

  }

  if(doorsField){

    doorsField.classList.toggle(
      "hidden",
      showMotorcycleFields
    );

  }

  if(seatsField){

    seatsField.classList.toggle(
      "hidden",
      showMotorcycleFields
    );

  }

  if(body && showMotorcycleFields){

    body.value = "";

  }

  if(showMotorcycleFields){

    valSet("doors","");
    valSet("seats","");

  }

  if(!showMotorcycleFields){

    valSet(
      "motorcycleType",
      ""
    );

    valSet(
      "engineCapacityCc",
      ""
    );

  }

}

function toggleMileageField(){

  const condition =
  val("condition");

  const mileage =
  document.getElementById(
    "mileage"
  );

  if(!mileage) return;

  if(condition === "new"){

    mileage.value = "0";

    mileage.disabled = true;

    mileage.placeholder =
    "New Vehicle";

  }else{

    mileage.disabled = false;

    if(
      mileage.value === "0"
    ){
      mileage.value = "";
    }

    mileage.placeholder =
    "Mileage";

  }

}

function initDescriptionCounter(){

  const textarea =
  document.getElementById(
    "description"
  );

  const counter =
  document.getElementById(
    "descriptionCounter"
  );

  if(
    !textarea ||
    !counter
  ) return;

  const update = ()=>{

    counter.textContent =
      `${textarea.value.length} / 5000`;

  };

  textarea.addEventListener(
    "input",
    update
  );

  update();

}

function toggleFinanceFields(){

  const enabled =
  document.getElementById(
    "financeAvailable"
  )?.checked;

  const box =
  document.getElementById(
    "financeFields"
  );

  if(!box) return;

  if(enabled){

    box.classList.remove(
      "hidden"
    );

  }else{

    box.classList.add(
      "hidden"
    );

    /*
    Seller finance values removed.
    Helpufin calculates finance automatically.
    */

  }

}

async function toggleVehicleCategory(){

  const category =
    val("vehicleCategory");

  const commercial =
    document.getElementById("commercialFields");

  const ev =
    document.getElementById("evFields");

  const motorcycleCategories = [
    "Motorcycle",
    "ATV",
    "Quad Bike",
    "Side-by-Side"
  ];

  const isMotorcycleCategory =
    motorcycleCategories.includes(category);

  if(commercial){

    commercial.classList.toggle(
      "hidden",
      category !== "Commercial Vehicle"
    );

  }

  if(category !== "Commercial Vehicle"){

    valSet("commercialCategory","");
    valSet("cabConfiguration","");
    valSet("payloadCapacityKg","");
    valSet("towingCapacityKg","");

  }

  if(!isMotorcycleCategory){

    valSet("motorcycleType","");
    valSet("engineCapacityCc","");

  }

  toggleMotorcycleFields();

  /* Reset catalogue selections whenever the vehicle category changes */

  valSet("make","");

  resetModels();

  resetVariants();

  /* HUFA catalogue: category change hides the catalogue block too
  (resetVariants only clears selection/rows to avoid recursion). */
  resetHufaCatalogStateOnly();

  toggleCustomModel();

  toggleCustomVariant();

  /* Reload catalogue for the selected vehicle type. AWAITED so
  callers that wait on this toggle (the draft restore) can rely
  on the make options existing BEFORE Make/Model/Variant are
  applied. Fire-and-forget callers are unaffected. */

  await fillMakes();

  if(ev){

    toggleEVFields();

  }

}

async function fillProvinces(){

  const province =
  document.getElementById(
    "province"
  );

  if(!province) return;

  province.innerHTML =
  `<option value="">
    Select Province
  </option>`;

const provinces =
await getProvinces();

console.log("HUFA Provinces:", provinces);
  provinces.forEach(name=>{

    const option =
    document.createElement(
      "option"
    );

    option.value = name;

    option.textContent = name;

    province.appendChild(option);

  });

  province.addEventListener(
    "change",
    async ()=>{

      await fillCities();

      updateLocation();

    }
  );

}

async function fillCities(){

  const province =
  val("province");

  const city =
  document.getElementById(
    "city"
  );

  if(!city) return;

  city.innerHTML =
  `<option value="">
    Select City
  </option>`;

  if(!province){
    return;
  }

  const cities =
  await getCities(province);

  cities.forEach(name=>{

    const option =
      document.createElement("option");

    option.value = name;

    option.textContent = name;

    city.appendChild(option);

  });

  city.onchange =
  updateLocation;

}

/* ================= HELPERS ================= */

async function handleVehicleSearch(){

  const input =
    document.getElementById(
      "vehicleSearch"
    );

  const results =
    document.getElementById(
      "vehicleSearchResults"
    );

  if(
    !input ||
    !results
  ){
    return;
  }

  const search =
    input.value
      .trim()
      .toLowerCase();

  if(search.length < 2){

    results.innerHTML = "";

    results.classList.add(
      "hidden"
    );

    return;

  }

  /* HUFA VEHICLE SEARCH PHASE 3 — Search Vehicle must not depend on
  the Vehicle Type selected in the form: pass null (unfiltered) so
  getMakes/getModels/getVariants search across ALL vehicle identities.
  Manual Make/Model/Variant cascade (fillMakes/populateModelOptions/
  populateVariantOptions) keeps its existing Vehicle Type filter. */
  const vehicleCategory = null;

  const makes =
    await getMakes(
      vehicleCategory
    );

  const matches = [];

  for(const make of makes){

    if(
      make
      .toLowerCase()
      .includes(search)
    ){

      matches.push({

        make,

        model: "",

        variant: ""

      });

    }

    const models =
      await getModels(
        make,
        vehicleCategory
      );

    for(const model of models){

      if(
        model
        .toLowerCase()
        .includes(search)
      ){

        matches.push({

          make,

          model,

          variant: ""

        });

      }

      const variants =
        await getVariants(
          make,
          model,
          vehicleCategory
        );

      variants.forEach(
        variant=>{

          if(

            variant
            .toLowerCase()
            .includes(search)

          ){

            matches.push({

              make,

              model,

              variant

            });

          }

        }

      );

    }

  }

  /* =========================================================
  PHASE 1 - SEARCH SELECTION -> CATALOGUE TRIGGER
  ---------------------------------------------------------
  The matcher ABOVE tests the query against make, model and
  variant INDEPENDENTLY, so a query that spans two fields
  (e.g. "renault kwid", "bmw i4") matched nothing and no
  suggestion could be produced to click - which means the
  catalogue could never be reached from Search Vehicle.
  This pass is purely ADDITIVE and runs ONLY for multi-token
  queries: it matches the SAME query text against the
  COMBINED identity string, so the combined suggestion
  ("Renault Kwid") is produced. Clicking that suggestion
  fills Make = Renault / Model = Kwid and then calls the
  EXISTING hufaCatalogRefreshYears() in the click handler
  above - the catalogue refresh already wired to this search
  path - so the existing HUFA Catalogue refreshes for
  Renault/Kwid.
  A single-token query skips this block entirely, so the
  existing single-token search behaviour is unchanged.
  No existing field is renamed, no query is added, no
  database/SQL change, and the legacy Make/Model/Variant
  dropdown fallback is untouched. */
  if(search.indexOf(" ") !== -1){

    const phraseTokens =
      search
        .split(/\s+/)
        .filter(Boolean);

    /* Dedupe against the results the field-wise matcher above
    already produced (a model such as "Grand Vitara" can still
    match the whole phrase on its own). Key format is identical
    on both sides so the same identity can never be listed twice. */
    const phraseKey =
      (make, model, variant)=>
        [make, model, variant]
          .join("|")
          .toLowerCase();

    const phraseSeen =
      new Set(
        matches.map(item=>
          phraseKey(
            item.make,
            item.model,
            item.variant
          )
        )
      );

    const addPhraseMatch =
      (make, model, variant)=>{

        const identity =
          [make, model, variant]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        if(!identity){ return; }

        for(const token of phraseTokens){

          if(!identity.includes(token)){

            return;

          }

        }

        const key =
          phraseKey(make, model, variant);

        if(phraseSeen.has(key)){ return; }

        phraseSeen.add(key);

        matches.push({

          make,

          model: model || "",

          variant: variant || ""

        });

      };

    for(const make of makes){

      addPhraseMatch(make, "", "");

      const models =
        await getModels(
          make,
          vehicleCategory
        );

      for(const model of models){

        addPhraseMatch(make, model, "");

        const variants =
          await getVariants(
            make,
            model,
            vehicleCategory
          );

        variants.forEach(
          variant=>
            addPhraseMatch(
              make,
              model,
              variant
            )
        );

      }

    }

  }

  /* =========================================================
  PHASE 2 (HUFA VEHICLE SEARCH) - SUGGESTIONS ARE VEHICLE IDENTITIES
  ---------------------------------------------------------
  The Phase 1 matcher ABOVE is preserved unchanged: field-wise
  matching plus the additive multi-token phrase pass still build
  `matches` (Make / Make+Model / Make+Model+Variant rows). What
  changes is ONLY the presentation/selection below:
  - variant-level rows collapse to their Make + Model identity,
    so "Renault Kwid 1.0 Climber 5MT" never appears in the
    dropdown - it belongs in the results table;
  - a make-only row (e.g. typing "Toyota") expands to that
    make's matching Model identities (Toyota Hilux, ...), so the
    suggestion is still a clickable vehicle identity;
  - clicking an identity fills Make + Model and calls
    hufaSearchDirectLoadCatalogue(), which loads ALL catalogue
    records for that identity into the EXISTING detailed table
    with NO Year choice required.
  Single-token behaviour and the 25-result cap below apply to the
  collapsed identities. HUFA VEHICLE SEARCH PHASE 3: identity search
  is unfiltered by Vehicle Type (null category); the manual
  Make/Model/Variant cascade keeps its Vehicle Type filter. Variant-specific
  phrase matches still collapse to the same identity (the full
  rows reach the table after the click). */
  const identitySeen = new Set();
  const identities = [];
  const identityKey = (make, model)=>
    [String(make ?? "").trim().toLowerCase(), String(model ?? "").trim().toLowerCase()].join("|");
  const pushIdentity = (make, model)=>{
    const cleanMake = String(make ?? "").trim();
    const cleanModel = String(model ?? "").trim();
    if(!cleanMake || !cleanModel){ return; }
    if(cleanModel === "__OTHER_MODEL__" || cleanModel === "__OTHER__"){ return; }
    const key = identityKey(cleanMake, cleanModel);
    if(identitySeen.has(key)){ return; }
    identitySeen.add(key);
    identities.push({ make: cleanMake, model: cleanModel });
  };
  for(const item of matches){
    if(item && item.model){
      pushIdentity(item.make, item.model);
    }
  }
  /* Make-only rows become identities: if the query already named
  models for that make they are above; otherwise expand the make
  to its matching models so "Toyota" still offers vehicles. */
  for(const item of matches){
    if(!item || item.model){ continue; }
    if(!item.make){ continue; }
    let modelsForMake = [];
    try{ modelsForMake = await getModels(item.make, vehicleCategory); }catch(e){ modelsForMake = []; }
    if(!Array.isArray(modelsForMake) || !modelsForMake.length){ continue; }
    const matchingModels = modelsForMake.filter((modelName)=>{
      const identity = (String(item.make) + " " + String(modelName)).toLowerCase();
      return phraseTokensEverywhere(search, identity);
    });
    const modelsToOffer = matchingModels.length ? matchingModels : modelsForMake.slice(0, 25);
    for(const modelName of modelsToOffer){
      pushIdentity(item.make, modelName);
      if(identities.length >= 25){ break; }
    }
    if(identities.length >= 25){ break; }
  }
  function phraseTokensEverywhere(queryText, identityText){
    const tokens = String(queryText || "").toLowerCase().split(/\s+/).filter(Boolean);
    const hay = String(identityText || "").toLowerCase();
    for(const token of tokens){
      if(!hay.includes(token)){ return false; }
    }
    return true;
  }

  console.log(
    "Vehicle Search Matches",
    matches
  );

  console.log(
    "Vehicle Search Identities",
    identities
  );

  results.innerHTML = "";

  if(!identities.length){

    results.innerHTML = `
      <div class="px-4 py-3 text-sm text-slate-500">
        No matching vehicles found.
      </div>
    `;

    results.classList.remove(
      "hidden"
    );

    return;

  }

  identities
    .slice(0,25)
    .forEach(item=>{

      const row =
        document.createElement("button");

      row.type = "button";

      row.className =
        "w-full text-left px-4 py-3 hover:bg-slate-100 border-b border-slate-100 transition";

      const title =
        `${item.make} ${item.model}`;

      row.innerHTML = `

        <div class="font-medium text-slate-800">
          ${title}
        </div>

        <div class="text-xs text-slate-500 mt-1">
          ${item.make}
          ${item.model ? "• " + item.model : ""}
        </div>

      `;

      row.dataset.make =
        item.make;

      row.dataset.model =
        item.model;

      row.dataset.variant =
        "";

      row.onclick = async ()=>{

        results.classList.add(
          "hidden"
        );

        input.value = [
          item.make,
          item.model
        ]
        .filter(Boolean)
        .join(" ");

        results.innerHTML = "";

        /* HUFA VEHICLE SEARCH PHASE 3 — the Make dropdown is still
        filtered by the form's Vehicle Type, so a cross-category
        identity (e.g. BYD found while Commercial is selected) may
        have no <option> yet. Pin the searched make as a real option
        first so the existing valSet below cannot silently fail;
        manual cascade filtering is otherwise untouched. */
        const makeSelect = document.getElementById("make");
        if(makeSelect && item.make){
          const hasMake = Array.from(makeSelect.options || []).some((opt)=>String(opt.value).trim() === String(item.make).trim() || String(opt.textContent || "").trim() === String(item.make).trim());
          if(!hasMake){
            const opt = document.createElement("option");
            opt.value = item.make;
            opt.textContent = item.make;
            makeSelect.appendChild(opt);
          }
        }

        valSet(
          "make",
          item.make
        );

        await fillModels();

        /* HUFA VEHICLE SEARCH PHASE 3 — same gate for Model:
        fillModels() above rebuilds #model from the currently
        selected Vehicle Type, so append the searched model when the
        filter excluded it. */
        const modelSelect = document.getElementById("model");
        if(modelSelect && item.model){
          const hasModel = Array.from(modelSelect.options || []).some((opt)=>String(opt.value).trim() === String(item.model).trim() || String(opt.textContent || "").trim() === String(item.model).trim());
          if(!hasModel){
            const opt = document.createElement("option");
            opt.value = item.model;
            opt.textContent = item.model;
            const otherOpt = Array.from(modelSelect.options || []).find((opt)=>opt.value === "__OTHER_MODEL__");
            if(otherOpt){
              modelSelect.insertBefore(opt, otherOpt);
            }else{
              modelSelect.appendChild(opt);
            }
          }
        }

        valSet(
          "model",
          item.model
        );

        await fillVariants();

        valSet(
          "variant",
          ""
        );

        toggleCustomModel();

        toggleCustomVariant();

        /* PHASE 2 direct load: vehicle identity -> EXISTING
        detailed results table, no Year choice required. The
        legacy #variant value is cleared above (no invented
        variant); the catalogue rows carry the real variants. */
        await hufaSearchDirectLoadCatalogue(item.make, item.model);

      };

      results.appendChild(
        row
      );

    });

  results.classList.remove(
    "hidden"
  );

}

let galleryIndex = 0;

window.openGallery = index=>{

  galleryIndex = index;

  const images = [
    ...existingImages,
    ...selectedFiles.map(
      f=>URL.createObjectURL(f)
    )
  ];

  const overlay =
  document.createElement("div");

  overlay.id =
  "galleryOverlay";

  overlay.className =
  "fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center p-8";

  overlay.innerHTML = `
    <button
      id="galleryClose"
      class="absolute top-4 right-4 px-6 py-3 rounded-none bg-white text-[#08111F] font-semibold tracking-[0.01em] border-0 border-r-[2.5px] border-b-[2.5px] border-r-[#163A70] border-b-[#163A70] shadow-none transition-all duration-200 hover:text-[#163A70] hover:border-r-[#F28C28] hover:border-b-[#F28C28]"
    >
      Close
    </button>

    <button
      id="galleryPrev"
      class="absolute left-4 top-1/2 -translate-y-1/2 w-14 h-14 bg-white text-[#08111F] text-2xl font-semibold border-0 border-r-[2.5px] border-b-[2.5px] border-r-[#163A70] border-b-[#163A70] transition-all duration-200 hover:text-[#163A70] hover:border-r-[#F28C28] hover:border-b-[#F28C28]"
    >
      ‹
    </button>

    <div class="flex flex-col items-center gap-4">

      <img
        id="galleryImage"
        src="${images[galleryIndex]}"
        class="max-h-[75vh] max-w-[75vw] object-contain rounded-lg"
      >

    </div>

    <button
      id="galleryNext"
      class="absolute right-4 top-1/2 -translate-y-1/2 w-14 h-14 bg-white text-[#08111F] text-2xl font-semibold border-0 border-r-[2.5px] border-b-[2.5px] border-r-[#163A70] border-b-[#163A70] transition-all duration-200 hover:text-[#163A70] hover:border-r-[#F28C28] hover:border-b-[#F28C28]"
    >
      ›
    </button>
  `;

  document.body.appendChild(
    overlay
  );

  const image =
  document.getElementById(
    "galleryImage"
  );

  const updateGallery = ()=>{

    image.src =
    images[galleryIndex];

  };

  document.getElementById(
    "galleryPrev"
  ).onclick = e=>{

    e.preventDefault();

    e.stopPropagation();

    galleryIndex =
      galleryIndex <= 0
      ? images.length - 1
      : galleryIndex - 1;

    updateGallery();

  };

  document.getElementById(
    "galleryNext"
  ).onclick = e=>{

    e.preventDefault();

    e.stopPropagation();

    galleryIndex =
      galleryIndex >= images.length - 1
      ? 0
      : galleryIndex + 1;

    updateGallery();

  };

  window.onkeydown = e=>{

    if(
      !document.getElementById(
        "galleryOverlay"
      )
    ) return;

    if(
      e.key === "ArrowLeft"
    ){

      e.preventDefault();

      galleryIndex =
        galleryIndex <= 0
        ? images.length - 1
        : galleryIndex - 1;

      updateGallery();

    }

    if(
      e.key === "ArrowRight"
    ){

      e.preventDefault();

      galleryIndex =
        galleryIndex >= images.length - 1
        ? 0
        : galleryIndex + 1;

      updateGallery();

    }

    if(
      e.key === "Escape"
    ){

      e.preventDefault();

      overlay.remove();

      window.onkeydown =
      null;

    }

  };

  document.getElementById(
    "galleryClose"
  ).onclick = ()=>{

    overlay.remove();

    window.onkeydown =
    null;

  };

  overlay.onclick = e=>{

    if(
      e.target === overlay
    ){

      overlay.remove();

      window.onkeydown =
      null;

    }

  };

};

function renderFeatureChips(){

  const container =
  document.getElementById(
    "featureChips"
  );

  if(!container) return;

  container.innerHTML = "";

const selectedContainer =
document.getElementById(
  "selectedFeatureChips"
);

if(selectedContainer){

  selectedContainer.innerHTML = "";

  if(selectedFeatures.length){

    selectedContainer.classList.remove(
      "hidden"
    );

    selectedFeatures
      .slice()
      .sort()
      .forEach(feature=>{

        const chip =
        document.createElement(
          "button"
        );

        chip.type =
        "button";

        chip.className =
"hufa-chip-selected inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#005BBF] text-white text-xs font-semibold shadow-sm hover:bg-[#004FA8] transition";

        chip.innerHTML =
        `
          <span>${feature}</span>
          <span class="text-base leading-none">&times;</span>
        `;

        chip.onclick = ()=>{

          selectedFeatures =
          selectedFeatures.filter(
            item=>item!==feature
          );

          document.getElementById(
            "features"
          ).value =
          JSON.stringify(
            selectedFeatures
          );

          const countElement =
          document.getElementById(
            "featureCount"
          );

          if(countElement){

            countElement.textContent =
            `${selectedFeatures.length} selected`;

          }

          renderFeatureChips();

        };

        selectedContainer.appendChild(
          chip
        );

      });

  }else{

    selectedContainer.classList.add(
      "hidden"
    );

  }

}

const searchTerm =
document
.getElementById(
  "featureSearch"
)
?.value
.toLowerCase()
.trim() || "";

const groups = {};

FEATURE_OPTIONS.forEach(feature=>{

    const category =
      feature.parent ||
      "Other";

    if(!groups[category]){

      groups[category] = [];

    }

    groups[category].push(feature);

  });

const categories =
Object.keys(groups);

/* PHASE 8 — mobile only: arrange the feature category tabs in
   alphabetical (A→Z) display order. The sort is gated to ≤767.98px
   so the desktop/tablet tab strip keeps its existing order. */
if(
  (window.matchMedia &&
    window.matchMedia(
      "(max-width: 767.98px)"
    ).matches)
){
  categories.sort(
    (a,b)=>a.localeCompare(b)
  );
}

if(
  !activeFeatureCategory ||
  !groups[activeFeatureCategory]
){

  activeFeatureCategory =
  categories[0];

}

const navigation =
document.createElement("div");

/* PHASE 1 UI FIX — feature category selector:
   - each tab is shrink-0 so labels can never be compressed or clipped
     (the .hufa-form * { min-width:0 } rule previously let flex shrink
     squeeze the button text);
   - clean intentional horizontal scroller (hidden scrollbar + edge
     fade handled via .hufa-feature-nav styles);
   - active tab is scrolled fully into view after render so a partially
     clipped category is never the resting state. */
navigation.className =
"hufa-feature-nav w-full flex overflow-x-auto gap-2 pb-3 mb-5 border-b border-slate-200";

navigation.setAttribute("role", "tablist");

categories.forEach(category=>{

  const tab =
  document.createElement("button");

  tab.type = "button";

  const isActive =
  category === activeFeatureCategory;

  tab.className =
  isActive
  ? "hufa-tab-active hufa-feature-tab shrink-0 whitespace-nowrap px-5 py-2 rounded-full bg-[#005BBF] text-white text-sm font-semibold shadow-sm ring-2 ring-[#E48A2F]/60"
  : "hufa-tab hufa-feature-tab shrink-0 whitespace-nowrap px-5 py-2 rounded-full border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:border-[#E48A2F] hover:text-[#08111F] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E48A2F]/60";

  tab.textContent =
  category;

  if(isActive){
    tab.setAttribute("aria-selected", "true");
  }

  tab.onclick = ()=>{

    activeFeatureCategory =
    category;

    renderFeatureChips();

  };

  navigation.appendChild(tab);

});

/* keep the active category completely visible — never rest on a
   half-clipped tab.
   NOTE: this must scroll ONLY the tab strip itself. The original
   scrollIntoView() call also scrolled every vertical ancestor,
   including the window, which yanked the page down to the Features
   section on initial load. Scrolling the .hufa-feature-nav element
   itself centers the active tab with zero effect on page scroll. */
requestAnimationFrame(()=>{

  const activeTab =
  navigation.querySelector(".hufa-tab-active");

  if(activeTab && typeof navigation.scrollTo === "function"){

    try{
      navigation.scrollTo({
        left: Math.max(
          0,
          activeTab.offsetLeft -
          (navigation.clientWidth - activeTab.offsetWidth) / 2
        ),
        behavior: "smooth"
      });
    }catch(e){
      try{ navigation.scrollLeft = activeTab.offsetLeft; }catch(_){ /* no-op */ }
    }

  }

});

const navigationWrapper =
document.createElement("div");

navigationWrapper.className =
"w-full";

navigationWrapper.appendChild(
  navigation
);

container.appendChild(
  navigationWrapper
);

const categoriesToRender =
searchTerm
  ? categories
  : [activeFeatureCategory];

categoriesToRender.forEach(category=>{

  const matchingFeatures =
  groups[category].filter(feature=>{

    if(!searchTerm){

      return true;

    }

    return feature.value
      .toLowerCase()
      .includes(searchTerm);

  });

  if(
    searchTerm &&
    !matchingFeatures.length
  ){
    return;
  }

  const wrapper =
  document.createElement("div");

  wrapper.className =
  "w-full";

  if(searchTerm){

    const heading =
    document.createElement("h4");

    heading.className =
    "text-sm font-semibold text-slate-600 mb-3";

    heading.textContent =
    category;

    wrapper.appendChild(
      heading
    );

  }

  const grid =
  document.createElement("div");

  grid.className =
  "grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3";

  matchingFeatures.forEach(feature=>{

    const featureName =
    feature.value;

    const selected =
    selectedFeatures.includes(
      featureName
    );

    const button =
    document.createElement(
      "button"
    );

    button.type = "button";

    button.className =
      selected
      ? "hufa-feature-selected w-full px-4 py-2.5 rounded-lg bg-[#E48A2F] text-[#08111F] text-sm font-semibold text-center transition hover:bg-[#d97e22]"
      : "hufa-feature w-full px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium text-center transition hover:border-[#E48A2F] hover:text-[#08111F] hover:bg-orange-50/50";

    button.textContent =
    featureName;

    button.onclick = ()=>{

      if(selected){

        selectedFeatures =
        selectedFeatures.filter(
          item=>item!==featureName
        );

      }else{

        selectedFeatures.push(
          featureName
        );

      }

      selectedFeatures =
      [...new Set(
        selectedFeatures
      )];

      document.getElementById(
        "features"
      ).value =
      JSON.stringify(
        selectedFeatures
      );

      const countElement =
      document.getElementById(
        "featureCount"
      );

      if(countElement){

        countElement.textContent =
        `${selectedFeatures.length} selected`;

      }

      renderFeatureChips();

    };

    grid.appendChild(
      button
    );

  });

  wrapper.appendChild(
    grid
  );

  container.appendChild(
    wrapper
  );

});

if(
  searchTerm &&
  !container.querySelector("button")
){

  const empty =
  document.createElement("div");

  empty.className =
  "py-10 text-center text-slate-400";

  empty.textContent =
  "No matching features found.";

  container.appendChild(
    empty
  );

}

}

async function fillBodyTypes(){

  const select =
  document.getElementById(
    "body"
  );

  if(!select) return;

  select.innerHTML =
  `<option value="">
    Body Type
  </option>`;

  const bodyTypes =
  await getBodyTypes();

  bodyTypes.forEach(type=>{

    const option =
    document.createElement(
      "option"
    );

    option.value = type;
    option.textContent = type;

    select.appendChild(option);

  });

}

async function fillFuelTypes(){

  const select =
  document.getElementById("fuel");

  if(!select) return;

  select.innerHTML =
  `<option value="">Fuel Type</option>`;

  const items =
  await getFuelTypes();

  items.forEach(item=>{

    const option =
    document.createElement("option");

    option.value = item;
    option.textContent = item;

    select.appendChild(option);

  });

}

async function fillTransmissionTypes(){

  const select =
  document.getElementById("trans");

  if(!select) return;

  select.innerHTML =
  `<option value="">Transmission</option>`;

  const items =
  await getTransmissionTypes();

  items.forEach(item=>{

    const option =
    document.createElement("option");

    option.value = item;
    option.textContent = item;

    select.appendChild(option);

  });

}

async function fillDriveTypes(){

  const select =
  document.getElementById("drive");

  if(!select) return;

  select.innerHTML =
  `<option value="">Drive</option>`;

  const items =
  await getDriveTypes();

  items.forEach(item=>{

    const option =
    document.createElement("option");

    option.value = item;
    option.textContent = item;

    select.appendChild(option);

  });

}

async function fillBatteryCapacities(){

  const select =
  document.getElementById(
    "batteryCapacity"
  );

  if(!select) return;

  select.innerHTML =
  `<option value="">
    Battery Capacity (kWh)
  </option>`;

  const items =
  await getBatteryCapacities();

  items.forEach(item=>{

    const option =
    document.createElement("option");

    option.value = item;

    option.textContent = item;

    select.appendChild(option);

  });

}

async function fillBatteryRanges(){

  const select =
  document.getElementById(
    "batteryRange"
  );

  if(!select) return;

  select.innerHTML =
  `<option value="">
    Battery Range (km)
  </option>`;

  const items =
  await getBatteryRanges();

  items.forEach(item=>{

    const option =
    document.createElement("option");

    option.value = item;

    option.textContent = item;

    select.appendChild(option);

  });

}

async function fillChargingTimes(){

  const select =
  document.getElementById(
    "chargingTime"
  );

  if(!select) return;

  select.innerHTML =
  `<option value="">
    Charging Time (Hours)
  </option>`;

  const items =
  await getChargingTimes();

  items.forEach(item=>{

    const option =
    document.createElement("option");

    option.value = item;

    option.textContent = item;

    select.appendChild(option);

  });

}

async function fillEngineCapacities(){

  const select =
  document.getElementById(
    "engineCapacityCc"
  );

  if(!select) return;

  select.innerHTML =
  `<option value="">
    Engine Capacity (cc)
  </option>`;

  const items =
  await getEngineCapacities();

  items.forEach(item=>{

    const option =
    document.createElement("option");

    option.value =
      parseInt(item);

    option.textContent =
      item;

    select.appendChild(option);

  });

}

async function fillColours(){

  const select =
  document.getElementById("color");

  if(!select) return;

  select.innerHTML =
  `<option value="">Colour</option>`;

  const items =
  await getColours();

  items.forEach(item=>{

    const option =
    document.createElement("option");

    option.value = item;
    option.textContent = item;

    select.appendChild(option);

  });

}

async function fillConditions(){

  const select =
  document.getElementById("condition");

  if(!select) return;

  select.innerHTML =
  `<option value="">Condition</option>`;

  const items =
    (await getConditions())
      .filter(item =>
        item &&
        item.toLowerCase() !== "used"
      );

  items.forEach(item=>{

    const option =
    document.createElement("option");

    option.value = item;
    option.textContent = item;

    select.appendChild(option);

  });

}

async function fillCommercialCategories(){

  const select =
  document.getElementById(
    "commercialCategory"
  );

  if(!select) return;

  select.innerHTML =
  `<option value="">
    Commercial Category
  </option>`;

const items =
(await getCommercialCategories()).filter(
  item => ![
    "Single Cab",
    "Space Cab",
    "Extended Cab",
    "Double Cab",
    "Crew Cab",
    "Chassis Cab"
  ].includes(item)
);

items.forEach(item=>{

  const option =
  document.createElement(
    "option"
  );

  option.value = item;
  option.textContent = item;

  select.appendChild(option);

});
}

function updateCabConfigurations(){

const category =
  val("commercialCategory");

const payloadSelect =
document.getElementById(
  "payloadCapacityKg"
);

const towingSelect =
document.getElementById(
  "towingCapacityKg"
);

const cabSelect =
document.getElementById(
  "cabConfiguration"
);

  if(
    !cabSelect ||
    !payloadSelect ||
    !towingSelect
  ) return;

const pickupCategories = [
  "Utility Vehicle"
];

const truckCategories = [
  "Chassis Cab",
  "Light Truck",
  "Medium Truck",
  "Heavy Truck",
  "Tipper",
  "Dropside",
  "Flatbed",
  "Refrigerated Truck",
  "Horse & Livestock",
  "Tow Truck"
];

const vanCategories = [
  "Panel Van",
  "Cargo Van",
  "Minibus",
  "Bus"
];

const noTowingCategories = [
  "Panel Van",
  "Cargo Van",
  "Bus",
  "Minibus"
];

let cabOptions = [];

switch(category){

  case "Utility Vehicle":

    cabOptions = [
      "Single Cab",
      "Space Cab",
      "Extended Cab",
      "Extra Cab",
      "King Cab",
      "Club Cab",
      "Double Cab"
    ];

    break;

  case "Chassis Cab":

    cabOptions = [
      "Day Cab",
      "Crew Cab"
    ];

    break;

  case "Light Truck":
  case "Medium Truck":
  case "Heavy Truck":

    cabOptions = [
      "Day Cab",
      "Sleeper Cab",
      "Crew Cab"
    ];

    break;

  default:

    cabOptions = [];

}

const previousCab =
cabSelect.value;

cabSelect.innerHTML =
'<option value="">Cab Configuration</option>';

cabOptions.forEach(item=>{

  const option =
  document.createElement("option");

  option.value = item;

  option.textContent = item;

  cabSelect.appendChild(option);

});

if(
  previousCab &&
  cabOptions.includes(previousCab)
){

  cabSelect.value =
  previousCab;

}

cabSelect.classList.toggle(
  "hidden",
  cabOptions.length === 0
);

cabSelect.onchange = ()=>{

  updatePayloadOptions(
    category,
    cabSelect.value
  );

  updateTowingOptions(
    category,
    cabSelect.value
  );

};

updatePayloadOptions(
  category,
  cabSelect.value
);

updateTowingOptions(
  category,
  cabSelect.value
);

payloadSelect.classList.toggle(
  "hidden",
  false
);

towingSelect.classList.toggle(
  "hidden",
  noTowingCategories.includes(category)
);

if(cabOptions.length === 0){

  cabSelect.value = "";

}

if(vanCategories.includes(category)){

  payloadSelect.value = "";

}

if(
  !(
    pickupCategories.includes(category) ||
    truckCategories.includes(category)
  )
){

  towingSelect.value = "";

}

}

function updatePayloadOptions(category, cab = ""){

  const select =
  document.getElementById(
    "payloadCapacityKg"
  );

  if(!select) return;

  let values = [];

  console.log("Payload Category:", category);
console.log("Payload Cab:", cab);

if(category === "Utility Vehicle"){

  switch(cab){

    case "Single Cab":

      values = [
        ["750","750 kg"],
        ["1000","1 Ton"],
        ["1200","1.2 Tons"],
        ["1500","1.5 Tons"]
      ];

      break;

    case "Space Cab":
    case "Extended Cab":
    case "Extra Cab":
    case "King Cab":
    case "Club Cab":

      values = [
        ["500","Up to 500 kg"],
        ["750","750 kg"],
        ["1000","1 Ton"],
        ["1200","1.2 Tons"]
      ];

      break;

    case "Double Cab":

      values = [
        ["500","Up to 500 kg"],
        ["750","750 kg"],
        ["1000","1 Ton"]
      ];

      break;

    default:

      values = [
        ["500","Up to 500 kg"],
        ["750","750 kg"],
        ["1000","1 Ton"],
        ["1200","1.2 Tons"],
        ["1500","1.5 Tons"]
      ];

  }

  }else if(
    [
      "Chassis Cab",
      "Light Truck",
      "Medium Truck"
    ].includes(category)
  ){

    values = [
      ["1500","1.5 Tons"],
      ["2000","2 Tons"],
      ["2500","2.5 Tons"],
      ["3000","3 Tons"],
      ["3500","3.5 Tons"]
    ];

  }else if(
    [
      "Refrigerated Truck"
    ].includes(category)
  ){

    values = [
      ["1000","1 Ton"],
      ["1500","1.5 Tons"],
      ["2000","2 Tons"],
      ["2500","2.5 Tons"],
      ["3000","3 Tons"],
      ["3500","3.5 Tons"],
      ["5000","5 Tons"],
      ["7500","7.5 Tons"],
      ["10000","10 Tons"],
      ["15000","15 Tons"],
      ["20000","20 Tons"],
      ["30000","30 Tons+"]
    ];

  }else if(
    [
      "Heavy Truck",
      "Tipper",
      "Dropside",
      "Flatbed",
      "Tow Truck",
      "Horse & Livestock"
    ].includes(category)
  ){

    values = [
      ["3000","3 Tons"],
      ["3500","3.5 Tons"],
      ["5000","5 Tons"],
      ["7500","7.5 Tons"],
      ["10000","10 Tons"],
      ["15000","15 Tons"],
      ["20000","20 Tons"],
      ["30000","30 Tons+"]
    ];

  }else if(category === "Panel Van"){

    values = [
      ["500","Up to 500 kg"],
      ["750","750 kg"],
      ["1000","1 Ton"],
      ["1500","1.5 Tons"],
      ["2000","2 Tons"]
    ];

  }else if(category === "Cargo Van"){

    values = [
      ["750","750 kg"],
      ["1000","1 Ton"],
      ["1500","1.5 Tons"],
      ["2000","2 Tons"],
      ["2500","2.5 Tons"]
    ];

  }else if(category === "Bus"){

    values = [
      ["500","Up to 500 kg"],
      ["750","750 kg"],
      ["1000","1 Ton"],
      ["1500","1.5 Tons"]
    ];

  }else if(category === "Minibus"){

    values = [
      ["500","Up to 500 kg"],
      ["750","750 kg"],
      ["1000","1 Ton"]
    ];

  }else{

    values = [];

  }

  select.innerHTML =
    '<option value="">Payload Capacity</option>';

  values.forEach(([value,label])=>{

    const option =
    document.createElement("option");

    option.value = value;

    option.textContent = label;

    select.appendChild(option);

  });

}

function updateTowingOptions(category, cab = ""){

  const select =
  document.getElementById(
    "towingCapacityKg"
  );

  if(!select) return;

  let values = [];

if(category === "Utility Vehicle"){

  switch(cab){

    case "Single Cab":

      values = [
        ["1500","1.5 Tons"],
        ["2000","2 Tons"],
        ["2500","2.5 Tons"],
        ["3000","3 Tons"],
        ["3500","3.5 Tons"]
      ];

      break;

    case "Space Cab":
    case "Extended Cab":
    case "Extra Cab":
    case "King Cab":
    case "Club Cab":

      values = [
        ["1000","1 Ton"],
        ["1500","1.5 Tons"],
        ["2000","2 Tons"],
        ["2500","2.5 Tons"],
        ["3000","3 Tons"],
        ["3500","3.5 Tons"]
      ];

      break;

    case "Double Cab":

      values = [
        ["750","750 kg"],
        ["1000","1 Ton"],
        ["1500","1.5 Tons"],
        ["2000","2 Tons"],
        ["2500","2.5 Tons"],
        ["3000","3 Tons"]
      ];

      break;

    default:

      values = [
        ["750","750 kg"],
        ["1000","1 Ton"],
        ["1500","1.5 Tons"],
        ["2000","2 Tons"],
        ["2500","2.5 Tons"],
        ["3000","3 Tons"],
        ["3500","3.5 Tons"]
      ];

  }

  }else if(
    [
      "Light Truck",
      "Medium Truck"
    ].includes(category)
  ){

    values = [
      ["1000","1 Ton"],
      ["1500","1.5 Tons"],
      ["2000","2 Tons"],
      ["2500","2.5 Tons"],
      ["3000","3 Tons"]
    ];

  }else if(
    [
      "Heavy Truck",
      "Tipper",
      "Dropside",
      "Flatbed",
      "Refrigerated Truck",
      "Tow Truck",
      "Horse & Livestock"
    ].includes(category)
  ){

    values = [
      ["3000","3 Tons"],
      ["3500","3.5 Tons"],
      ["5000","5 Tons"],
      ["7500","7.5 Tons"],
      ["10000","10 Tons"],
      ["15000","15 Tons"],
      ["20000","20 Tons"],
      ["30000","30 Tons+"]
    ];

  }else if(
    [
      "Panel Van",
      "Cargo Van",
      "Bus",
      "Minibus"
    ].includes(category)
  ){

    values = [];

  }else{

    values = [];

  }

  select.innerHTML =
    '<option value="">Towing Capacity</option>';

  values.forEach(([value,label])=>{

    const option =
    document.createElement("option");

    option.value = value;

    option.textContent = label;

    select.appendChild(option);

  });

}

function updateLocation(){

  const province =
  val("province");

  const city =
  val("city");

  const location =
  document.getElementById(
    "location"
  );

  if(!location) return;

  location.value =
  city && province
    ? `${city}, ${province}`
    : "";
}

/* =========================================
PHASE 7C — AUTO-NAVIGATE TO FIRST MISSING FIELD
Called by every failed validation check BEFORE
the upload overlay is shown. Scrolls the first
missing/invalid required field into view (safe
against fixed headers on mobile via block:center),
focuses the actual control (works for inputs,
native selects and custom controls), and flashes
the existing validation highlight styling.
========================================= */
function failField(id, message){

  publishInProgress = false;

  const el = document.getElementById(id);

  if(el){

    try{
      el.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }catch(err){
      try{ el.scrollIntoView(true); }catch(_){}
    }

    /* focus the real control — handles native
       inputs/selects and custom wrapper controls */

    let control = el;

    if(
      el.tagName &&
      !["INPUT","SELECT","TEXTAREA","BUTTON"].includes(el.tagName)
    ){
      control =
        el.querySelector("input, select, textarea, button") || el;
    }

    setTimeout(() => {
      try{ control.focus({ preventScroll: true }); }
      catch(err){ try{ control.focus(); }catch(_){} }
    }, 400);

    /* reuse a visible invalid state without changing
       any existing validation rules or mappings */

    el.classList.add("hufa-field-invalid");

    setTimeout(() => {
      el.classList.remove("hufa-field-invalid");
    }, 3000);

  }

  toast(message);

}

function setSubmitDisabled(disabled){

  const btn =
    document.getElementById("submitBtn");

  if(!btn) return;

  btn.disabled = disabled;

  btn.classList.toggle(
    "hufa-submit-disabled",
    disabled
  );

}

function showPublishOverlay(title,status){

  let overlay =
    document.getElementById("publishOverlay");

  /* PHASE 7 FIX — reparent the overlay to <body>. If any
     ancestor creates a containing block for position:fixed
     (transform/filter/backdrop-filter, e.g. the .fade-in
     entrance animation), a fixed overlay inside it would be
     positioned against that ancestor instead of the viewport
     and never be seen. Direct child of <body> is immune. */

  if(overlay && overlay.parentElement !== document.body){
    document.body.appendChild(overlay);
  }

  if(!overlay){

    /* belt-and-braces: if the markup is missing, build it */

    overlay = document.createElement("div");
    overlay.id = "publishOverlay";
    overlay.className = "hufa-publish-overlay";
    overlay.setAttribute("role","alertdialog");
    overlay.setAttribute("aria-live","assertive");
    overlay.setAttribute("aria-busy","true");
    overlay.innerHTML = `
      <div class="hufa-publish-backdrop"></div>
      <div class="hufa-publish-center">
        <div class="hufa-publish-card bg-white">
          <div id="publishSpinner" class="hufa-publish-spinner"></div>
          <p class="hufa-publish-brand">HUFA</p>
          <h2 id="publishTitle" class="hufa-publish-title"></h2>
          <p class="hufa-publish-subtitle">We're securely processing your vehicle listing. Please keep this window open.</p>
          <ul id="publishStages" class="hufa-publish-stages">
            <li data-stage="1"><span class="hufa-stage-dot"></span><span>Preparing vehicle details</span></li>
            <li data-stage="2"><span class="hufa-stage-dot"></span><span>Uploading vehicle images</span></li>
            <li data-stage="3"><span class="hufa-stage-dot"></span><span>Saving vehicle listing</span></li>
            <li data-stage="4"><span class="hufa-stage-dot"></span><span id="publishStageFourLabel">Publishing vehicle</span></li>
            <li data-stage="5"><span class="hufa-stage-dot"></span><span>Finalising</span></li>
          </ul>
          <div class="hufa-publish-bar"><div id="publishProgressBar" class="hufa-publish-bar-fill"></div></div>
          <div id="publishStep" class="hufa-publish-step">Step 1 of 5</div>
          <p id="publishStatus" class="hufa-publish-status"></p>
          <p class="hufa-publish-note">Please keep this window open. Do not close or refresh the page.</p>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

  }

  const progressBar =
    document.getElementById("publishProgressBar");

  const spinner =
    document.getElementById("publishSpinner");

  if(progressBar){

    progressBar.style.width = "0%";

  }

  if(spinner){

    /* restore the animated loading ring state */

    spinner.classList.remove(
      "hufa-publish-spinner-done",
      "hufa-publish-spinner-failed"
    );

    spinner.innerHTML = "";

  }

  /* sync the stage-4 checklist label with the
     existing create vs edit behaviour */

  const stageFourLabel =
    document.getElementById("publishStageFourLabel");

  if(stageFourLabel){

    stageFourLabel.textContent =
      isEdit
        ? "Updating your listing..."
        : "Publishing your vehicle...";

  }

  if(!overlay) return;

  document.getElementById("publishTitle").textContent =
    title;

  document.getElementById("publishStatus").textContent =
    status;

document.body.style.overflow = "hidden";

overlay.classList.remove("hidden");
overlay.classList.add("hufa-publish-visible");

}

function updatePublishStatus(step,status){

  const stepLabel =
    document.getElementById("publishStep");

  const statusLabel =
    document.getElementById("publishStatus");

  const progressBar =
    document.getElementById("publishProgressBar");

  const stages =
    document.querySelectorAll("#publishStages li");

  if(stepLabel){

    stepLabel.textContent =
      `Step ${step} of 5`;

  }

  if(statusLabel){

    statusLabel.textContent =
      status;

  }

  if(progressBar){

    progressBar.style.width =
      `${step * 20}%`;

  }

  /* highlight the active stage and mark
     completed stages with a check state */

  stages.forEach(li => {

    const stageNumber =
      parseInt(li.dataset.stage);

    li.classList.toggle(
      "is-active",
      stageNumber === step
    );

    li.classList.toggle(
      "is-done",
      stageNumber < step
    );

  });

}

function showPublishSuccess(message){

  const overlay =
    document.getElementById("publishOverlay");

  if(!overlay) return;

  const spinner =
    document.getElementById("publishSpinner");

  if(spinner){

    spinner.classList.add(
      "hufa-publish-spinner-done"
    );

    spinner.innerHTML = `
      <svg
        class="hufa-publish-result-icon"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M5 13l4 4L19 7"
        />
      </svg>
    `;

  }

  const title =
    document.getElementById("publishTitle");

  const status =
    document.getElementById("publishStatus");

  const step =
    document.getElementById("publishStep");

  if(title){

    title.textContent =
      isEdit
        ? "Vehicle Updated Successfully"
        : "Vehicle Added Successfully";

  }

  if(status){

    status.textContent = message;

  }

  if(step){

    step.textContent = "Complete";

  }

  /* all stages done */

  document
    .querySelectorAll("#publishStages li")
    .forEach(li => {

      li.classList.remove("is-active");

      li.classList.add("is-done");

    });

}

function showPublishFailure(message){

  const overlay =
    document.getElementById("publishOverlay");

  if(!overlay) return;

  const spinner =
    document.getElementById("publishSpinner");

  if(spinner){

    spinner.classList.add(
      "hufa-publish-spinner-failed"
    );

    spinner.innerHTML = `
      <svg
        class="hufa-publish-result-icon"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M6 6l12 12M18 6L6 18"
        />
      </svg>
    `;

  }

  const title =
    document.getElementById("publishTitle");

  const status =
    document.getElementById("publishStatus");

  const step =
    document.getElementById("publishStep");

  if(title){

    title.textContent = "Upload Failed";

  }

  if(status){

    status.textContent = message;

  }

  if(step){

    step.textContent = "";

  }

}

function hidePublishOverlay(){

  /* PHASE 6 — restore the submit control so the user can
     retry after a failure (form state is preserved). */

  setSubmitDisabled(false);

  const overlay =
    document.getElementById("publishOverlay");

  if(!overlay) return;

document.body.style.overflow = "";

overlay.classList.remove("hufa-publish-visible");
overlay.classList.add("hidden");
}

function val(id){
  return document.getElementById(id)?.value || "";
}

function valSet(id, value){
  const el = document.getElementById(id);
  if(el) el.value = value || "";
}
