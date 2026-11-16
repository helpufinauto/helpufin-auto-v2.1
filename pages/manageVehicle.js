import { asset } from "../js/basePath.js";

const PLACEHOLDER = asset("/placeholder.png");

import {
supabase,
getAuthUser
} from "../js/api.js";

import {
navigate
} from "../js/router.js";

import {
validateImageFile
} from "../js/fileValidation.js";

/* Shared Dashboard shell — provides the same mobile topbar
   (Dashboard burger -> toggleDashboardSidebar), sidebar and
   overlay used by every other Dashboard page. */
import {
renderDashboardShell
} from "./dashboard.js";


import {
getMakes,
getModels,
getVariants,
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
getEvRanges,
getChargingTimes,
} from "../js/catalog.js";

/* PHASE 5 — temporary EDIT draft persistence for Manage Vehicle.
Uses the SAME shared draft store as Upload Vehicle and Messages
(read-only import: js/draftStore.js is NOT modified), but with its
own workflow + user+vehicle key, so create drafts, signup drafts
and message drafts can never collide with an edit draft. */
import {
saveDraft as saveManageVehicleEditDraftRecord,
loadDraft as loadManageVehicleEditDraftRecord,
clearDraft as clearManageVehicleEditDraftRecord
} from "../js/draftStore.js";

/* =========================================================
PHASE 5 — MANAGE VEHICLE / EDIT VEHICLE TEMPORARY DRAFT
=========================================================
A Manage Vehicle (Edit Vehicle) workspace edits an EXISTING,
already published vehicle row. Two things stay strictly separate:

1. the PUBLISHED vehicle row (Supabase) — only ever written by the
   existing saveVehicleChanges() / image actions;
2. the TEMPORARY edit draft (sessionStorage) — unfinished form
   values only, never written to Supabase until the user presses
   the existing "Save Changes" action.

Storage: js/draftStore.js
  key  hufa:draft:manageVehicleEdit:u_<userId>_v_<vehicleId>
Scoping: authenticated user AND vehicle, so two different vehicles
(or two different users) never share an edit draft.
Lifecycle:
  • values are collected from the live workspace form, debounced,
    and written after typing stops;
  • a pending write is flushed synchronously on pagehide (refresh /
    tab close) and on in-app navigation clicks (SPA pushState does
    not fire pagehide);
  • the draft is re-applied after the workspace has been fully
    initialized (all cascade option lists present) on every mount,
    so refresh / route change / remount restores unfinished values;
  • the draft is cleared ONLY after a successful Save Changes.
No image state is stored here: Manage Vehicle image actions
(upload / reorder / cover / replace / delete) already persist
immediately through their existing functions.
========================================================= */

const MANAGE_VEHICLE_EDIT_DRAFT_WORKFLOW = "manageVehicleEdit";

/* Same debounce feel as the other draft-enabled workflows. */
const MANAGE_VEHICLE_EDIT_DRAFT_SAVE_DELAY_MS = 500;

/* Every editable control that belongs to the Manage Vehicle /
Edit Vehicle workspace form. Used for BOTH collection and the
restore allowlist, so no field is silently omitted. */
const MANAGE_VEHICLE_EDIT_DRAFT_FIELD_IDS = [
  "vehicle_title",
  "vehicle_price",
  "vehicle_year",
  "vehicle_mileage",
  "vehicle_finance_available",
  "vehicle_price_negotiable",
  "vehicle_vat_included",
  "vehicle_status",
  "vehicle_province",
  "vehicle_city",
  "vehicle_category",
  "vehicle_commercial_category",
  "vehicle_cab_configuration",
  "vehicle_payload_capacity",
  "vehicle_towing_capacity",
  "vehicle_motorcycle_type",
  "vehicle_make",
  "vehicle_model",
  "vehicle_variant",
  "vehicle_owners",
  "vehicle_description",
  "vehicle_note_input",
  "spec_fuel_type",
  "spec_transmission",
  "spec_drive_type",
  "spec_body_type",
  "spec_color",
  "spec_engine_capacity_cc",
  "spec_power_kw",
  "spec_engine_size_l",
  "spec_torque_nm",
  "spec_cylinders",
  "spec_turbocharged",
  "spec_fuel_consumption_l100",
  "spec_co2_emissions_gkm",
  "spec_electric_range_km",
  "spec_fast_charge",
  "spec_seats",
  "spec_doors",
  "spec_condition",
  "ev_battery_capacity",
  "ev_range",
  "ev_charging_time"
];

const MANAGE_VEHICLE_EDIT_DRAFT_FIELD_ID_SET =
new Set(MANAGE_VEHICLE_EDIT_DRAFT_FIELD_IDS);

/* Fields whose value depends on another control's option list:
they are applied AFTER the plain fields, in cascade order
(category → commercial cascade, fuel type → EV fields,
make → model → variant, province → city). */
const MANAGE_VEHICLE_EDIT_DRAFT_CASCADE_IDS = new Set([
  "vehicle_make",
  "vehicle_model",
  "vehicle_variant",
  "vehicle_province",
  "vehicle_city",
  "vehicle_category",
  "vehicle_commercial_category",
  "vehicle_cab_configuration",
  "vehicle_payload_capacity",
  "vehicle_towing_capacity",
  "vehicle_motorcycle_type",
  "spec_fuel_type",
  "ev_battery_capacity",
  "ev_range",
  "ev_charging_time"
]);

const MANAGE_VEHICLE_EDIT_DRAFT_PLAIN_IDS =
MANAGE_VEHICLE_EDIT_DRAFT_FIELD_IDS.filter(
  id => !MANAGE_VEHICLE_EDIT_DRAFT_CASCADE_IDS.has(id)
);

/* ---------- module state (one Manage Vehicle session) ---------- */

let manageVehicleBootSeq = 0;

let manageVehicleDraftVehicleId = "";
let manageVehicleDraftUserIdCache = "";
let manageVehicleDraftSaveTimer = null;
let manageVehicleDraftPendingVehicleId = "";
let manageVehicleDraftRestoring = false;


/* Same sanitization contract as draftStore's internal
sanitizeKeyPart (identity parts used inside one key). */
function sanitizeManageVehicleDraftKeyPart(value){
  const raw = String(value || "").trim();
  if(!raw){ return ""; }
  const cleaned = raw.replace(/[^A-Za-z0-9-_]/g, "_").slice(0, 80);
  return cleaned.replace(/^_+|_+$/g, "") || "";
}

/* Stable draft identity: authenticated user + vehicle being
edited. Returns null when either part is unknown, so a draft can
never be written under a shared/anonymous key. */
function manageVehicleDraftKeyParts(vehicleId){
  const userKey =
  sanitizeManageVehicleDraftKeyPart(manageVehicleDraftUserIdCache);
  const vehicleKey =
  sanitizeManageVehicleDraftKeyPart(
    vehicleId || manageVehicleDraftVehicleId
  );
  if(!userKey || !vehicleKey){ return null; }
  return {
    workflow: MANAGE_VEHICLE_EDIT_DRAFT_WORKFLOW,
    userKey: `u_${userKey}_v_${vehicleKey}`
  };
}

/* The draft may only be written while the workspace of the SAME
vehicle is actually mounted (never from another route). */
function manageVehicleDraftDomIsLive(vehicleId){
  if(!vehicleId || vehicleId !== manageVehicleDraftVehicleId){
    return false;
  }
  const root = document.getElementById("manageVehicleRoot");
  if(!root){ return false; }
  return !!(document.getElementById("vehicle_title") ||
    document.getElementById("vehicle_description"));
}

/* ---------- collect / validate ---------- */

function collectManageVehicleEditDraftFeatures(){
  const container =
  document.getElementById("vehicle_features_container");
  if(!container){ return []; }
  return [
    ...new Set(
      Array.from(
        container.querySelectorAll("input[type='checkbox']:checked")
      )
      .map(item=>String(item.value).trim())
      .filter(Boolean)
    )
  ];
}

function collectManageVehicleEditDraft(){
  const fields = {};
  for(const id of MANAGE_VEHICLE_EDIT_DRAFT_FIELD_IDS){
    const el = document.getElementById(id);
    /* A field that is not in the DOM is SKIPPED (never recorded as
       ""), so restore can never blank a published value it could
       not read. */
    if(!el || typeof el.value !== "string"){ continue; }
    fields[id] = el.value;
  }
  return {
    fields,
    features: collectManageVehicleEditDraftFeatures()
  };
}

/* Allowlist guard: only known field ids with string values and a
string feature list may be applied to the form. Anything else is
rejected outright so no unsafe data can reach the DOM. */
function isSafeManageVehicleEditDraft(value){
  if(!value || typeof value !== "object" || Array.isArray(value)){
    return false;
  }
  const fields = value.fields;
  if(!fields || typeof fields !== "object" || Array.isArray(fields)){
    return false;
  }
  for(const key of Object.keys(fields)){
    if(!MANAGE_VEHICLE_EDIT_DRAFT_FIELD_ID_SET.has(key)){
      return false;
    }
    if(typeof fields[key] !== "string"){ return false; }
  }
  if(!Array.isArray(value.features)){ return false; }
  for(const feature of value.features){
    if(typeof feature !== "string"){ return false; }
  }
  return true;
}


/* ---------- write (debounced + flushable) ---------- */

function writeManageVehicleEditDraftNow(vehicleId){
  const target = vehicleId || manageVehicleDraftPendingVehicleId;
  if(!target){ return false; }
  if(!manageVehicleDraftDomIsLive(target)){ return false; }
  const parts = manageVehicleDraftKeyParts(target);
  if(!parts){ return false; }
  return saveManageVehicleEditDraftRecord(
    parts.workflow,
    parts.userKey,
    collectManageVehicleEditDraft()
  );
}

async function resolveManageVehicleDraftUserId(){
  if(manageVehicleDraftUserIdCache){
    return manageVehicleDraftUserIdCache;
  }
  try{
    const user = await getAuthUser();
    const id = user?.id;
    if(typeof id === "string" && id){
      manageVehicleDraftUserIdCache = id;
      return id;
    }
  }catch(e){}
  return "";
}

async function saveManageVehicleEditDraftNow(){
  if(manageVehicleDraftRestoring){ return; }
  const vehicleId =
  manageVehicleDraftPendingVehicleId || manageVehicleDraftVehicleId;
  if(!vehicleId){ return; }
  /* Synchronous when the user id is already known (the normal
     case: the workspace resolved it during load). */
  if(manageVehicleDraftUserIdCache){
    writeManageVehicleEditDraftNow(vehicleId);
    return;
  }
  const userId = await resolveManageVehicleDraftUserId();
  if(!userId){ return; }
  writeManageVehicleEditDraftNow(vehicleId);
}

function scheduleManageVehicleEditDraftSave(){
  if(manageVehicleDraftRestoring){ return; }
  if(!manageVehicleDraftVehicleId){ return; }
  if(!document.getElementById("manageVehicleRoot")){ return; }
  manageVehicleDraftPendingVehicleId = manageVehicleDraftVehicleId;
  if(manageVehicleDraftSaveTimer){
    clearTimeout(manageVehicleDraftSaveTimer);
  }
  manageVehicleDraftSaveTimer = setTimeout(()=>{
    manageVehicleDraftSaveTimer = null;
    saveManageVehicleEditDraftNow();
  }, MANAGE_VEHICLE_EDIT_DRAFT_SAVE_DELAY_MS);
}

/* Flush a pending debounced write immediately (pagehide / SPA nav
click). Writes SYNCHRONOUSLY when the user id is cached so the
value always lands before the form DOM disappears. */
function flushManageVehicleEditDraftNow(){
  if(!manageVehicleDraftSaveTimer){ return; }
  clearTimeout(manageVehicleDraftSaveTimer);
  manageVehicleDraftSaveTimer = null;
  const vehicleId =
  manageVehicleDraftPendingVehicleId || manageVehicleDraftVehicleId;
  if(manageVehicleDraftUserIdCache){
    writeManageVehicleEditDraftNow(vehicleId);
    return;
  }
  saveManageVehicleEditDraftNow();
}

/* Cancels any pending write first, so nothing can re-save the
draft after it has been cleared (successful save). */
function clearManageVehicleEditDraft(vehicleId){
  if(manageVehicleDraftSaveTimer){
    clearTimeout(manageVehicleDraftSaveTimer);
    manageVehicleDraftSaveTimer = null;
  }
  manageVehicleDraftPendingVehicleId = "";
  const userId = sanitizeManageVehicleDraftKeyPart(
    manageVehicleDraftUserIdCache
  );
  const target = sanitizeManageVehicleDraftKeyPart(
    vehicleId || manageVehicleDraftVehicleId
  );
  if(!userId || !target){ return; }
  clearManageVehicleEditDraftRecord(
    MANAGE_VEHICLE_EDIT_DRAFT_WORKFLOW,
    `u_${userId}_v_${target}`
  );
}


/* ---------- restore ---------- */

function manageVehicleDraftSelectHasOption(select, value){
  if(!select || !select.options){ return false; }
  for(const option of select.options){
    if(option.value === value){ return true; }
  }
  return false;
}

/* Applies one field value. Selects only accept a value whose
option actually exists, so a restored value can never silently
blank a select whose option list does not contain it. */
function setManageVehicleDraftValue(id, value){
  if(typeof value !== "string"){ return; }
  const el = document.getElementById(id);
  if(!el){ return; }
  if(el.options){
    if(manageVehicleDraftSelectHasOption(el, value)){
      el.value = value;
    }
    return;
  }
  if(typeof el.value === "undefined"){ return; }
  el.value = value;
}

/* Re-runs the page's OWN change-driven behaviour (commercial /
motorcycle wrapper visibility, EV wrapper visibility) for a
restored value. */
function dispatchManageVehicleDraftChange(id){
  const el = document.getElementById(id);
  if(!el){ return; }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function rebuildManageVehicleDraftModels(makeValue){
  const modelSelect = document.getElementById("vehicle_model");
  if(!modelSelect){ return; }
  const models = await getModels(makeValue || "");
  modelSelect.innerHTML =
  `
  <option value="">
  Select Model
  </option>
  `;
  models.forEach(model=>{
    const modelValue =
    typeof model === "string" ? model : model.value;
    const option = document.createElement("option");
    option.value = modelValue;
    option.textContent = modelValue;
    modelSelect.appendChild(option);
  });
}

async function rebuildManageVehicleDraftVariants(makeValue, modelValue){
  const variantSelect = document.getElementById("vehicle_variant");
  if(!variantSelect){ return; }
  const variants = await getVariants(
    makeValue || "",
    modelValue || ""
  );
  variantSelect.innerHTML =
  `
  <option value="">
  Select Variant (Optional)
  </option>
  `;
  variants.forEach(variant=>{
    const value = typeof variant === "string" ? variant : variant.value;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    variantSelect.appendChild(option);
  });
}

/* make → model → variant, rebuilding each dependent option list
for the restored parent (exactly what the page's own change
listeners do). */
async function restoreManageVehicleEditDraftMakeModelVariant(fields){
  const makeSelect = document.getElementById("vehicle_make");
  const modelSelect = document.getElementById("vehicle_model");
  const variantSelect = document.getElementById("vehicle_variant");
  if(!makeSelect || !modelSelect || !variantSelect){ return; }

  const draftMake =
  typeof fields.vehicle_make === "string" ? fields.vehicle_make : "";
  const draftModel =
  typeof fields.vehicle_model === "string" ? fields.vehicle_model : "";
  const draftVariant =
  typeof fields.vehicle_variant === "string" ? fields.vehicle_variant : "";

  if(
    draftMake &&
    draftMake !== makeSelect.value &&
    manageVehicleDraftSelectHasOption(makeSelect, draftMake)
  ){
    makeSelect.value = draftMake;
    await rebuildManageVehicleDraftModels(makeSelect.value);
    modelSelect.value = "";
    variantSelect.value = "";
  }

  if(
    draftModel &&
    draftModel !== modelSelect.value &&
    manageVehicleDraftSelectHasOption(modelSelect, draftModel)
  ){
    modelSelect.value = draftModel;
    await rebuildManageVehicleDraftVariants(
      makeSelect.value,
      modelSelect.value
    );
    variantSelect.value = "";
  }

  if(
    draftVariant &&
    manageVehicleDraftSelectHasOption(variantSelect, draftVariant)
  ){
    variantSelect.value = draftVariant;
  }
}

/* province → city, rebuilding the city option list for the
restored province (the same catalogue call the existing province
change listener uses). */
async function restoreManageVehicleEditDraftProvinceCity(fields){
  const provinceSelect = document.getElementById("vehicle_province");
  const citySelect = document.getElementById("vehicle_city");
  if(!provinceSelect || !citySelect){ return; }

  const draftProvince =
  typeof fields.vehicle_province === "string"
    ? fields.vehicle_province
    : "";
  const draftCity =
  typeof fields.vehicle_city === "string" ? fields.vehicle_city : "";

  if(
    draftProvince &&
    draftProvince !== provinceSelect.value &&
    manageVehicleDraftSelectHasOption(provinceSelect, draftProvince)
  ){
    provinceSelect.value = draftProvince;
    const cities = await getCities(provinceSelect.value);
    citySelect.innerHTML =
    `
    <option value="">
    Select City
    </option>
    `;
    cities.forEach(city=>{
      const cityValue = typeof city === "string" ? city : city.value;
      const option = document.createElement("option");
      option.value = cityValue;
      option.textContent = cityValue;
      citySelect.appendChild(option);
    });
    citySelect.value = "";
  }

  if(
    draftCity &&
    manageVehicleDraftSelectHasOption(citySelect, draftCity)
  ){
    citySelect.value = draftCity;
  }
}

function applyManageVehicleEditDraftFeatures(features){
  const container =
  document.getElementById("vehicle_features_container");
  if(!container || !Array.isArray(features)){ return; }
  const wanted = new Set(
    features.map(feature=>String(feature).trim())
  );
  Array.from(
    container.querySelectorAll("input[type='checkbox']")
  ).forEach(checkbox=>{
    const next = wanted.has(String(checkbox.value).trim());
    if(checkbox.checked === next){ return; }
    checkbox.checked = next;
    /* Reuses the picker's own change listener for chip styling. */
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  });
  syncMvSelected();
}


/* Applies the temporary edit draft to the FULLY INITIALIZED
workspace (called after every option list exists), so cascading
selects restore in dependency order. */
async function restoreManageVehicleEditDraft(){
  if(manageVehicleDraftRestoring){ return; }
  const vehicleId = manageVehicleDraftVehicleId;
  if(!vehicleId){ return; }

  const userId = await resolveManageVehicleDraftUserId();
  if(!userId){ return; }

  /* The route may have moved on while resolving the user, or the
  workspace may have been replaced by another vehicle. */
  if(vehicleId !== manageVehicleDraftVehicleId){ return; }
  if(!manageVehicleDraftDomIsLive(vehicleId)){ return; }

  const parts = manageVehicleDraftKeyParts(vehicleId);
  if(!parts){ return; }

  const draft = loadManageVehicleEditDraftRecord(
    parts.workflow,
    parts.userKey
  );
  if(!isSafeManageVehicleEditDraft(draft)){ return; }

  /* Suppress debounced writes while draft values are applied. */
  manageVehicleDraftRestoring = true;

  try{

    const fields = draft.fields || {};

    /* 1. Plain fields (text / number / textarea / static select). */
    for(const id of MANAGE_VEHICLE_EDIT_DRAFT_PLAIN_IDS){
      setManageVehicleDraftValue(id, fields[id]);
    }

    /* 2. Vehicle category first: its change handler sets the
    commercial / motorcycle wrapper visibility AND clears the
    dependent commercial values for non-commercial categories. */
    setManageVehicleDraftValue(
      "vehicle_category",
      fields.vehicle_category
    );
    dispatchManageVehicleDraftChange("vehicle_category");

    /* 3. Commercial / motorcycle cascade (option lists already
    built by initialiseManageVehicleSelectors). */
    setManageVehicleDraftValue(
      "vehicle_commercial_category",
      fields.vehicle_commercial_category
    );
    setManageVehicleDraftValue(
      "vehicle_cab_configuration",
      fields.vehicle_cab_configuration
    );
    setManageVehicleDraftValue(
      "vehicle_payload_capacity",
      fields.vehicle_payload_capacity
    );
    setManageVehicleDraftValue(
      "vehicle_towing_capacity",
      fields.vehicle_towing_capacity
    );
    setManageVehicleDraftValue(
      "vehicle_motorcycle_type",
      fields.vehicle_motorcycle_type
    );

    /* 4. Fuel type drives the EV wrapper visibility. */
    setManageVehicleDraftValue(
      "spec_fuel_type",
      fields.spec_fuel_type
    );
    dispatchManageVehicleDraftChange("spec_fuel_type");

    setManageVehicleDraftValue(
      "ev_battery_capacity",
      fields.ev_battery_capacity
    );
    setManageVehicleDraftValue("ev_range", fields.ev_range);
    setManageVehicleDraftValue(
      "ev_charging_time",
      fields.ev_charging_time
    );

    /* 5. Catalogue cascades. */
    await restoreManageVehicleEditDraftMakeModelVariant(fields);
    await restoreManageVehicleEditDraftProvinceCity(fields);

    /* 6. Feature checkboxes. */
    applyManageVehicleEditDraftFeatures(draft.features);

  }catch(e){

    console.warn("Manage Vehicle draft restore failed", e);

  }finally{

    manageVehicleDraftRestoring = false;

  }

}


/* ---------- listeners (registered ONCE per module lifetime) ---------- */

/* Delegated capture-phase binding: the workspace re-renders its
whole form after several existing actions (save, note, image
operations), so per-element listeners would be lost. Matching is
deliberately narrow: allowlisted form controls only. */
function manageVehicleDraftEventTargetsField(target){
  if(!(target instanceof Element)){ return false; }
  const id = typeof target.id === "string" ? target.id : "";
  if(id && MANAGE_VEHICLE_EDIT_DRAFT_FIELD_ID_SET.has(id)){
    return true;
  }
  return target.matches(
    "#vehicle_features_container input[type='checkbox']"
  );
}

function handleManageVehicleDraftFieldEvent(e){
  if(manageVehicleDraftRestoring){ return; }
  if(!manageVehicleDraftVehicleId){ return; }
  if(!manageVehicleDraftEventTargetsField(e.target)){ return; }
  scheduleManageVehicleEditDraftSave();
}

document.addEventListener(
  "input",
  handleManageVehicleDraftFieldEvent,
  true
);

document.addEventListener(
  "change",
  handleManageVehicleDraftFieldEvent,
  true
);

/* Refresh / tab close. */
window.addEventListener(
  "pagehide",
  ()=>{
    flushManageVehicleEditDraftNow();
  }
);

/* SPA navigation does NOT fire pagehide, so a click on any in-app
navigation control flushes the pending write in the capture phase,
BEFORE the router unmounts the workspace form. */
document.addEventListener(
  "click",
  (e)=>{

    if(!manageVehicleDraftSaveTimer){ return; }

    const target = e.target;

    if(!(target instanceof Element)){ return; }

    const navEl =
    target.closest(
      "a[href], a[data-link], [data-link], " +
      "[onclick*='navigate('], " +
      "[onclick*='loadView('], " +
      "[onclick*='goDashboardView('], " +
      "[onclick*='previewVehicle(']"
    );

    if(navEl){
      flushManageVehicleEditDraftNow();
    }

  },
  true
);


/* ---------- loading state (same principle as Upload Vehicle) ---------- */

/* The workspace is initialized asynchronously (vehicle row +
catalogue option lists + draft restore). This overlay reuses the
EXISTING publish-overlay markup/classes already used by the publish
flow and Upload Vehicle, so the unfinished form is never shown
uninitialized and no page design is changed. */
function mountManageVehicleLoadingOverlay(){

  manageVehicleBootSeq++;

  if(!document.getElementById("manageVehicleLoading")){

    const overlay = document.createElement("div");
    overlay.id = "manageVehicleLoading";
    overlay.className = "hufa-publish-overlay hufa-publish-visible";
    overlay.setAttribute("role","status");
    overlay.setAttribute("aria-live","polite");
    overlay.innerHTML = `
      <div class="hufa-publish-backdrop"></div>
      <div class="hufa-publish-center">
        <div class="hufa-publish-card bg-white">
          <div class="hufa-publish-spinner"></div>
          <p class="hufa-publish-brand">HUFA</p>
          <p class="hufa-publish-title">Loading Manage Vehicle</p>
          <p class="hufa-publish-subtitle">Restoring your vehicle workspace...</p>
        </div>
      </div>`;

    document.body.appendChild(overlay);

  }

  document.documentElement.style.overflow = "hidden";
  window.scrollTo(0, 0);

  return manageVehicleBootSeq;

}

function unmountManageVehicleLoadingOverlay(){

  document.getElementById("manageVehicleLoading")?.remove();

  document.documentElement.style.overflow = "";

}


export async function ManageVehiclePage(){

const params =
new URLSearchParams(
window.location.search
);

const vehicleId =
params.get("id");

if(!vehicleId){

return `

<div class="
max-w-7xl
mx-auto
p-4
">

<div class="
rounded-[32px]
bg-white
border
border-red-200
p-8
">

<h1 class="
text-xl
font-black
text-red-600
">
Vehicle Not Found
</h1>

<p class="mt-3 text-gray-500">
Missing vehicle id.
</p>

</div>

</div>

`;

}

/* PHASE 5 — show the loading state FIRST, before any page work,
and register this workspace as the active draft context. */
const manageVehicleBoot = mountManageVehicleLoadingOverlay();

manageVehicleDraftVehicleId = vehicleId;

/* Any pending write from the previous workspace belongs to that
vehicle and has already been flushed on the navigation click;
never carry it into this one. */
manageVehicleDraftPendingVehicleId = "";
if(manageVehicleDraftSaveTimer){
  clearTimeout(manageVehicleDraftSaveTimer);
  manageVehicleDraftSaveTimer = null;
}

/* Eager draft-user-ID resolution (fire-and-forget) so the
pagehide / SPA-nav flush functions always find the user id
already cached and can write synchronously before unload.
The cache is invalidated first so a sign-out/sign-in without a
full reload can never write a draft under the previous user. */
manageVehicleDraftUserIdCache = "";

resolveManageVehicleDraftUserId();

setTimeout(
() => {

/* A NEWER mount supersedes this one: skip stale init so the
full load (which ends with the draft restore) runs only for
the LATEST mount. */
if(manageVehicleBoot !== manageVehicleBootSeq){ return; }

loadVehicleWorkspace(vehicleId)
.catch((loadError)=>{
console.warn("Manage Vehicle init failed", loadError);
})
.finally(()=>{
/* Only the CURRENT boot may take the overlay down — a stale
init finishing late must never reveal the newer mount's
uninitialized form. When the workspace DOM is already gone
(route changed while loading) the overlay must never stay
stuck, so it is removed as well. */
if(
manageVehicleBoot === manageVehicleBootSeq ||
!document.getElementById("manageVehicleRoot")
){
unmountManageVehicleLoadingOverlay();
}
});

},
0
);

return renderDashboardShell({
activeNav: "inventory",
mobileTitle: "Manage Vehicle",
content: `

<div id="manageVehicleRoot">

<div class="
rounded-[20px]
bg-white
border
border-[#E2E8F0]
p-4
shadow-[0_25px_70px_rgba(15,23,42,0.08)]
">

Loading Vehicle...

</div>

</div>

`
});

}

async function loadVehicleWorkspace(id){

const root =
document.getElementById(
"manageVehicleRoot"
);

const user =
await getAuthUser();

if(!user){

navigate("/login");
return;

}

/* PHASE 5 — cache the authenticated user id for the draft key
(user + vehicle scoping) as early as possible. */
const userId =
typeof user.id === "string" ? user.id : "";

if(userId){
manageVehicleDraftUserIdCache = userId;
}

const {
data:vehicle,
error
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",id)
.eq("seller_id",user.id)
.single();

if(error || !vehicle){

root.innerHTML = `

<div class="
rounded-[32px]
bg-white
border
border-red-200
p-4
">

<h2 class="
text-xl
font-black
text-red-600
">
Vehicle Not Found
</h2>

</div>

`;

return;

}

renderOverview(vehicle);
renderImageManager(vehicle);
renderVehicleDetails(vehicle);
renderVehicleLocation(vehicle);
renderVehicleClassification(vehicle);
renderVehicleHistory(vehicle);
renderVehicleDescription(vehicle);
renderVehicleSpecifications(vehicle);
renderVehicleFeatures(vehicle);

await initialiseManageVehicleSelectors(
vehicle
);

await renderPerformance(vehicle);
await renderEnquiries(vehicle);
await renderFinanceApplications(vehicle);
await renderVehicleNotes(vehicle);

renderBottomActionBar(vehicle);

/* PHASE 5 — the workspace is now fully rendered (details, location,
classification, history, description, specifications, feature
checkboxes, notes) and every cascade option list exists, so the
temporary edit draft can be re-applied over the published values.
Nothing is written to Supabase here: the published row is only
changed by the existing Save Changes action. */
await restoreManageVehicleEditDraft();

}

function renderImageManager(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

const existingSection =
document.getElementById(
"imageManagerSection"
);

if(existingSection){
existingSection.remove();
}

const images = [
...(vehicle.images || [])
];

if(
vehicle.image_url &&
!images.includes(
vehicle.image_url
)
){
images.unshift(
vehicle.image_url
);
}

const totalImages =
images.length;

root.insertAdjacentHTML(
"beforeend",
`

<div
id="imageManagerSection"
class="
rounded-[20px]
bg-white
border
border-[#E2E8F0]
shadow-[0_25px_70px_rgba(15,23,42,0.08)]
overflow-hidden
">

<div class="p-4">

<div class="
flex
flex-col
sm:flex-row
sm:items-center
sm:justify-between
gap-4
mb-4
">

<div>

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#E48A2F]
mb-2
">
Image Manager
</p>

<h2 class="
text-xl
font-bold
tracking-[-0.03em]
text-[#08111F]
leading-tight
">
Vehicle Images
</h2>

<p class="mt-1 text-xs text-[#64748B]">
Manage how buyers see and order your vehicle photos.
</p>

</div>

<div class="
flex
items-center
gap-3
flex-wrap
">



<div
class="
inline-flex
items-center
gap-1.5
px-3
py-1.5
rounded-full
bg-[#E48A2F]/10
text-[#E48A2F]
border
border-[#E48A2F]/20
text-xs
font-bold
">

<i class="material-symbols-outlined text-[14px] leading-none">photo_library</i>
${totalImages} ${totalImages === 1 ? "Image" : "Images"}

</div>

<button
onclick="uploadVehicleImages('${vehicle.id}')"
class="
inline-flex
items-center
gap-1.5
px-4
py-2
rounded-lg
bg-[#005BBF]
text-white
text-sm
font-semibold
shadow-[0_8px_20px_rgba(8,17,31,0.18)]
hover:bg-[#004FA8]
transition-all
duration-200
">

<i class="material-symbols-outlined text-[16px] leading-none">upload</i>
Upload Images

</button>

<input
id="vehicleImageInput"
type="file"
multiple
accept="image/jpeg,image/jpg,image/png,image/webp"
class="hidden"
/>

<input
id="replaceVehicleImageInput"
type="file"
accept="image/jpeg,image/jpg,image/png,image/webp"
class="hidden"
/>

</div>

</div>

<div class="
grid
grid-cols-2
sm:grid-cols-3
lg:grid-cols-4
xl:grid-cols-5
gap-3
sm:gap-4
items-start
mt-4
">

${images.map((img,index)=>`

<div class="
group relative flex flex-col
rounded-[16px]
overflow-hidden
border border-[#E2E8F0]
bg-white
shadow-sm
transition-all duration-200
hover:shadow-md
">

<div class="relative overflow-hidden bg-[#F8FAFC]">

<img
src="${img}"
class="
w-full aspect-[4/3] ${index === 0 ? "object-contain" : "object-cover"}
transition-transform duration-300
group-hover:scale-[1.02]
"
/>

${
index === 0
?
`
<span class="
absolute top-2 right-2 inline-flex items-center gap-1
px-2 py-1 rounded-md bg-[#08111F]/90 text-white
text-[11px] font-semibold shadow-sm
">
<i class="material-symbols-outlined text-[13px] leading-none">star</i>
Cover
</span>
`
: ""
}

${
index > 0
?
`
<button
onclick="moveVehicleImageLeft('${vehicle.id}','${img}')"
class="
absolute left-2 top-1/2 -translate-y-1/2
flex items-center justify-center w-7 h-7 rounded-full
bg-white/95 border border-[#E2E8F0] shadow-sm
text-[17px] leading-none text-[#08111F]
hover:bg-[#E48A2F] hover:text-white transition-colors
"
>
‹
</button>
`
: ""
}

${
index < totalImages - 1
?
`
<button
onclick="moveVehicleImageRight('${vehicle.id}','${img}')"
class="
absolute right-2 top-1/2 -translate-y-1/2
flex items-center justify-center w-7 h-7 rounded-full
bg-white/95 border border-[#E2E8F0] shadow-sm
text-[17px] leading-none text-[#08111F]
hover:bg-[#E48A2F] hover:text-white transition-colors
"
>
›
</button>
`
: ""
}


</div>

<div class="
p-3 flex flex-col gap-2.5
border-t border-[#F1F5F9]
">

${
index === 0
?
`
<span class="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#E48A2F]">
<i class="material-symbols-outlined text-[14px] leading-none">star</i>
Cover Image
</span>
`
:
`
<button
onclick="setCoverImage('${vehicle.id}','${img}')"
class="
w-full inline-flex items-center justify-center gap-1.5
py-1.5 rounded-lg text-xs font-semibold
text-[#08111F] bg-[#F8FAFC] border border-[#E2E8F0]
hover:border-[#E48A2F] hover:text-[#E48A2F] hover:bg-[#E48A2F]/5
transition-colors
"
>
<i class="material-symbols-outlined text-[14px] leading-none">star_border</i>
Make Cover
</button>
`
}

<div class="grid grid-cols-2 gap-2">

<button
onclick="replaceVehicleImage('${vehicle.id}','${img}')"
class="
py-1.5 rounded-lg text-xs font-semibold
bg-[#E48A2F]/10 text-[#E48A2F] hover:bg-[#E48A2F]/20 transition-colors
"
>
Replace
</button>

<button
onclick="deleteVehicleImage('${vehicle.id}','${img}')"
class="
py-1.5 rounded-lg text-xs font-semibold
bg-red-50 text-red-600 hover:bg-red-100 transition-colors
"
>
Delete
</button>

</div>

</div>

</div>

`).join("")}

</div>

</div>

</div>

`
);

}

function renderVehicleDetails(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

root.insertAdjacentHTML(
"beforeend",
`

<div class="
rounded-[20px]
bg-white
border
border-[#E2E8F0]
shadow-[0_25px_70px_rgba(15,23,42,0.08)]
overflow-hidden
">

<div class="p-4">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#E48A2F]
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
mb-2
">
Edit the core information used to identify and display your vehicle throughout the marketplace.
</p>

<div class="space-y-4">

<div>

<div class="
grid
grid-cols-1
md:grid-cols-2
gap-4
">

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">
Title
</label>

<input
id="vehicle_title"
value="${vehicle.make || ""} ${vehicle.model || ""}"
readonly
class="
w-full
rounded-xl
border
border-[#E2E8F0]
bg-[#F8FAFC]
text-[#64748B]
py-3 px-4
cursor-not-allowed
"
/>

</div>

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">
Price
</label>

<input
id="vehicle_price"
type="number"
inputmode="numeric"
min="0"
step="1000"
placeholder="Enter Vehicle Price"
value="${vehicle.price ?? ""}"
class="
rounded-xl
border
border-[#E2E8F0]
bg-white
py-2.5 px-4
text-[#08111F]
focus:border-[#E48A2F]
focus:ring-2 focus:ring-[#E48A2F]/20
transition-colors
outline-none
"
/>

</div>

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">
Make
</label>

<select
id="vehicle_make"
class="
rounded-xl
border
border-[#E2E8F0]
bg-white
py-2.5 px-4
text-[#08111F]
focus:border-[#E48A2F]
focus:ring-2 focus:ring-[#E48A2F]/20
transition-colors
outline-none
">

<option value="">
Select Make
</option>

</select>

</div>

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">
Model
</label>

<select
id="vehicle_model"
class="
rounded-xl
border
border-[#E2E8F0]
bg-white
py-2.5 px-4
text-[#08111F]
focus:border-[#E48A2F]
focus:ring-2 focus:ring-[#E48A2F]/20
transition-colors
outline-none
">

<option value="">
Select Model
</option>

</select>

</div>

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">
Variant
</label>

<select
id="vehicle_variant"
class="
rounded-xl
border
border-[#E2E8F0]
bg-white
py-2.5 px-4
text-[#08111F]
focus:border-[#E48A2F]
focus:ring-2 focus:ring-[#E48A2F]/20
transition-colors
outline-none
">

<option value="">
Select Variant (Optional)
</option>

</select>

</div>

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">
Year
</label>

<input
id="vehicle_year"
value="${vehicle.year || ""}"
type="number"
class="
rounded-xl
border
border-[#E2E8F0]
bg-white
py-2.5 px-4
text-[#08111F]
focus:border-[#E48A2F]
focus:ring-2 focus:ring-[#E48A2F]/20
transition-colors
outline-none
"
/>

</div>

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">
Mileage
</label>

<input
id="vehicle_mileage"
value="${vehicle.mileage || ""}"
type="number"
class="
rounded-xl
border
border-[#E2E8F0]
bg-white
py-2.5 px-4
text-[#08111F]
focus:border-[#E48A2F]
focus:ring-2 focus:ring-[#E48A2F]/20
transition-colors
outline-none
"
/>

</div>

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">
Finance Available
</label>

<select
id="vehicle_finance_available"
class="
rounded-xl
border
border-[#E2E8F0]
bg-white
py-2.5 px-4
text-[#08111F]
focus:border-[#E48A2F]
focus:ring-2 focus:ring-[#E48A2F]/20
transition-colors
outline-none
">

<option value="true">Yes</option>
<option value="false">No</option>

</select>

</div>

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">
Price Negotiable
</label>

<select
id="vehicle_price_negotiable"
class="
rounded-xl
border
border-[#E2E8F0]
bg-white
py-2.5 px-4
text-[#08111F]
focus:border-[#E48A2F]
focus:ring-2 focus:ring-[#E48A2F]/20
transition-colors
outline-none
">

<option value="true">Yes</option>
<option value="false">No</option>

</select>

</div>

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">
VAT Included
</label>

<select
id="vehicle_vat_included"
class="
rounded-xl
border
border-[#E2E8F0]
bg-white
py-2.5 px-4
text-[#08111F]
focus:border-[#E48A2F]
focus:ring-2 focus:ring-[#E48A2F]/20
transition-colors
outline-none
">

<option value="true">Yes</option>
<option value="false">No</option>

</select>

</div>

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">
Status
</label>

<select
id="vehicle_status"
class="
rounded-xl
border
border-[#E2E8F0]
bg-white
py-2.5 px-4
text-[#08111F]
focus:border-[#E48A2F]
focus:ring-2 focus:ring-[#E48A2F]/20
transition-colors
outline-none
">

<option value="active" ${(vehicle.status || "active") === "active" ? "selected" : ""}>Active</option>
<option value="pending" ${(vehicle.status || "active") === "pending" ? "selected" : ""}>Pending</option>
<option value="sold" ${(vehicle.status || "active") === "sold" ? "selected" : ""}>Sold</option>
<option value="draft" ${(vehicle.status || "active") === "draft" ? "selected" : ""}>Draft</option>

</select>

</div>

</div>

</div>

</div>

</div>

`
);

}

function renderVehicleLocation(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

const sectionBody =
root.lastElementChild?.querySelector(
".p-4"
);

if(!sectionBody){
return;
}

sectionBody.insertAdjacentHTML(
"beforeend",
`
<div class="mt-8">

<div class="
flex
items-center
gap-2
mb-1
">

<span class="block w-2 h-2 rounded-full bg-[#E48A2F]"></span>
<h3 class="
text-lg
font-black
tracking-[-0.03em]
text-[#08111F]
">
Location
</h3>

</div>

<p class="
mt-1
text-sm
text-[#64748B]
mb-5
leading-relaxed
">
Choose where this vehicle is located so buyers can find listings near them.
</p>

<div class="h-px w-full bg-[#E2E8F0]"></div>

<div class="
pt-5
grid
grid-cols-1
md:grid-cols-2
gap-4
sm:gap-5
">

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">

Province

</label>

<select
id="vehicle_province"
class="
rounded-xl
border
border-[#E2E8F0]
bg-white
py-2.5 px-4
text-[#08111F]
focus:border-[#E48A2F]
focus:ring-2 focus:ring-[#E48A2F]/20
transition-colors
outline-none
"
>

<option value="">

Select Province

</option>

</select>

</div>

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">

City

</label>

<select
id="vehicle_city"
class="
rounded-xl
border
border-[#E2E8F0]
bg-white
py-2.5 px-4
text-[#08111F]
focus:border-[#E48A2F]
focus:ring-2 focus:ring-[#E48A2F]/20
transition-colors
outline-none
"
>

<option value="">

Select City

</option>

</select>

</div>

</div>

</div>
`
);

}

function renderVehicleClassification(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

const sectionBody =
root.lastElementChild?.querySelector(
".p-4"
);

if(!sectionBody){
return;
}

sectionBody.insertAdjacentHTML(
"beforeend",
`
<div class="mt-8">

<div class="
flex
items-center
justify-center
my-6
">

<div class="
w-full
max-w-[220px]
h-[2px]
rounded-full
bg-gradient-to-r
from-transparent
via-[#163A70]
to-transparent
"></div>

</div>

<h3 class="
text-xl
font-black
text-[#08111F]
mb-2
">
Vehicle Category
</h3>

<p class="
text-sm
text-[#64748B]
mb-6
leading-relaxed
">
Specify the vehicle category and commercial type where applicable.
</p>

<div class="
grid
grid-cols-1
md:grid-cols-2
gap-3
">

<div>

<label class="block mb-1 text-sm font-semibold">
Vehicle Category
</label>

<select
id="vehicle_category"
class="
w-full
rounded-xl
border
border-[#E2E8F0]
py-3 px-4
">

<option value="">
Select Vehicle Category
</option>

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

</div>

<div
id="commercial_category_wrapper"
>

<label class="block mb-1 text-sm font-semibold">
Commercial Category
</label>

<select
id="vehicle_commercial_category"
class="
w-full
rounded-xl
border
border-[#E2E8F0]
py-3 px-4
">

<option value="">
Select Category
</option>

</select>

</div>

<div
id="cab_configuration_wrapper"
style="display:none;"
>

<label class="block mb-1 text-sm font-semibold">
Cab Configuration
</label>

<select
id="vehicle_cab_configuration"
class="
w-full
rounded-xl
border
border-[#E2E8F0]
py-3 px-4
">

<option value="">
Select Cab Configuration
</option>

</select>

</div>

<div
id="payload_capacity_wrapper"
style="display:none;"
>

<label class="block mb-1 text-sm font-semibold">
Payload Capacity (kg)
</label>

<select
id="vehicle_payload_capacity"
class="
w-full
rounded-xl
border
border-[#E2E8F0]
py-3 px-4
">

<option value="">
Select Payload Capacity
</option>

</select>

</div>
<div
id="towing_capacity_wrapper"
style="display:none;"
>

<label class="block mb-1 text-sm font-semibold">
Towing Capacity (kg)
</label>

<select
id="vehicle_towing_capacity"
class="
w-full
rounded-xl
border
border-[#E2E8F0]
py-3 px-4
">

<option value="">
Select Towing Capacity
</option>

</select>

</div>

<div
id="motorcycle_type_wrapper"
style="display:none;"
>

<label class="block mb-1 text-sm font-semibold">
Motorcycle Type
</label>

<select
id="vehicle_motorcycle_type"
class="
w-full
rounded-xl
border
border-[#E2E8F0]
py-3 px-4
">

<option value="">
Select Motorcycle Type
</option>

</select>

</div>

</div>

</div>
`
);

}

function renderVehicleHistory(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

const sectionBody =
root.lastElementChild?.querySelector(
".p-4"
);

if(!sectionBody){
return;
}

sectionBody.insertAdjacentHTML(
"beforeend",
`
<div class="mt-8">

<div class="
flex
items-center
gap-2
mb-1
">

<span class="block w-2 h-2 rounded-full bg-[#E48A2F]"></span>
<h3 class="
text-lg
font-black
tracking-[-0.03em]
text-[#08111F]
">
Vehicle History & Verification
</h3>

</div>

<p class="
mt-1
text-sm
text-[#64748B]
mb-5
leading-relaxed
">
Review ownership and verification information that builds buyer confidence.
</p>

<div class="h-px w-full bg-[#E2E8F0]"></div>

<div class="
pt-5
grid
grid-cols-1
md:grid-cols-2
gap-4
mb-3
">

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">
Previous Owners
</label>

<input
id="vehicle_owners"
type="number"
value="${vehicle.owners || ""}"
class="
rounded-xl
border
border-[#E2E8F0]
bg-white
py-2.5 px-4
text-[#08111F]
focus:border-[#E48A2F]
focus:ring-2 focus:ring-[#E48A2F]/20
transition-colors
outline-none
"
/>

</div>

</div>

<div class="
grid
grid-cols-1
sm:grid-cols-2
md:grid-cols-3
xl:grid-cols-4
gap-3
mb-3
">

${overviewChip(
"Previous Owners",
vehicle.owners ?? "-"
)}

${overviewChip(
"Accident Free",
vehicle.accident_free ? "Yes" : "No"
)}

${overviewChip(
"Full Service History",
vehicle.service_history ? "Yes" : "No"
)}

${overviewChip(
"Roadworthy Certificate",
vehicle.roadworthy_certificate ? "Yes" : "No"
)}

${overviewChip(
"Ownership Verified",
vehicle.ownership_verified ? "Yes" : "No"
)}

${overviewChip(
"Certified Pre-Owned",
vehicle.certified_pre_owned ? "Yes" : "No"
)}

${overviewChip(
"Demo Vehicle",
vehicle.demo_vehicle ? "Yes" : "No"
)}

${overviewChip(
"Imported Vehicle",
vehicle.imported_vehicle ? "Yes" : "No"
)}

${overviewChip(
"Last Updated",
vehicle.updated_at
? new Date(vehicle.updated_at).toLocaleDateString()
: "-"
)}

</div>

</div>
`
);

}

function renderVehicleDescription(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

const sectionBody =
root.lastElementChild?.querySelector(
".p-4"
);

if(!sectionBody){
return;
}

sectionBody.insertAdjacentHTML(
"beforeend",
`
<div class="mt-8">

<div class="
flex
items-center
gap-2
mb-1
">

<span class="block w-2 h-2 rounded-full bg-[#E48A2F]"></span>
<h3 class="
text-lg
font-black
tracking-[-0.03em]
text-[#08111F]
">
Vehicle Description
</h3>

</div>

<p class="
mt-1
text-sm
text-[#64748B]
mb-5
leading-relaxed
">
Describe the vehicle's condition, features and anything buyers should know before enquiring.
</p>

<div class="h-px w-full bg-[#E2E8F0]"></div>

<div class="
pt-5
grid
grid-cols-1
gap-4
">

<div>

<label class="block mb-2 text-sm font-semibold text-slate-700">
Description
</label>

<textarea
id="vehicle_description"
rows="6"
class="
rounded-xl
border
border-[#E2E8F0]
bg-white
py-2.5 px-4
text-[#08111F]
focus:border-[#E48A2F]
focus:ring-2 focus:ring-[#E48A2F]/20
transition-colors
outline-none
"
>${vehicle.description || ""}</textarea>

</div>

</div>

</div>
`
);

}

async function initialiseManageVehicleSelectors(
vehicle
){

const makeSelect =
document.getElementById(
"vehicle_make"
);

const modelSelect =
document.getElementById(
"vehicle_model"
);

const variantSelect =
document.getElementById(
"vehicle_variant"
);

const provinceSelect =
document.getElementById(
"vehicle_province"
);

const citySelect =
document.getElementById(
"vehicle_city"
);

const fuelSelect =
document.getElementById(
"spec_fuel_type"
);

const transmissionSelect =
document.getElementById(
"spec_transmission"
);

const driveTypeSelect =
document.getElementById(
"spec_drive_type"
);

const bodyTypeSelect =
document.getElementById(
"spec_body_type"
);

const colourSelect =
document.getElementById(
"spec_color"
);

const conditionSelect =
document.getElementById(
"spec_condition"
);

const vehicleCategorySelect =
document.getElementById(
"vehicle_category"
);

const commercialCategorySelect =
document.getElementById(
"vehicle_commercial_category"
);

const cabConfigurationSelect =
document.getElementById(
"vehicle_cab_configuration"
);

const featuresContainer =
document.getElementById(
"vehicle_features_container"
);

if(!featuresContainer){
return;
}

if(
!makeSelect ||
!modelSelect ||
!variantSelect ||
!provinceSelect ||
!citySelect ||
!vehicleCategorySelect ||
!commercialCategorySelect
){
return;
}

const makes =
await getMakes();


const models =
await getModels(
vehicle.make
);

const vehicleVariants =
await getVariants(
vehicle.make,
vehicle.model
);



console.log("MAKES", makes);
console.log("MODELS", models);
console.log("VARIANTS", vehicleVariants);

console.log(
"MANAGE VARIANTS",
vehicleVariants.length
);

// Loaded from catalog.js

makeSelect.innerHTML =
`
<option value="">
Select Make
</option>
`;

makes.forEach(make=>{

const option =
document.createElement(
"option"
);

option.value =
make;

option.textContent =
make;

if(
make === vehicle.make
){
option.selected = true;
}

makeSelect.appendChild(
option
);

});

// Loaded from catalog.js

modelSelect.innerHTML =
`
<option value="">
Select Model
</option>
`;

models.forEach(model=>{

const option =
document.createElement(
"option"
);

option.value =
model;

option.textContent =
model;

if(
model === vehicle.model
){
option.selected = true;
}

modelSelect.appendChild(
option
);

});

console.log(
"MODELS",
models
);

// Loaded from catalog.js

variantSelect.innerHTML =
`
<option value="">
Select Variant (Optional)
</option>
`;

vehicleVariants.forEach(variant=>{

const option =
document.createElement(
"option"
);

option.value =
variant;

option.textContent =
variant;

if(
variant === vehicle.variant
){
option.selected = true;
}

variantSelect.appendChild(
option
);

});

console.log(
"VEHICLE VARIANTS",
vehicleVariants
);

const provinces =
await getProvinces();

provinceSelect.innerHTML =
`
<option value="">
Select Province
</option>
`;

provinces.forEach(province=>{

const provinceValue =
typeof province === "string"
? province
: province.value;

const option =
document.createElement(
"option"
);

option.value =
provinceValue;

option.textContent =
provinceValue;

if(
provinceValue === vehicle.province
){
option.selected = true;
}

provinceSelect.appendChild(
option);

});

if(vehicle.province){

const cities =
await getCities(
vehicle.province
);

citySelect.innerHTML =
`
<option value="">
Select City
</option>
`;

cities.forEach(city=>{

const cityValue =
typeof city === "string"
? city
: city.value;

const option =
document.createElement(
"option"
);

option.value =
cityValue;

option.textContent =
cityValue;

if(
cityValue === vehicle.city
){
option.selected = true;
}

citySelect.appendChild(
option);

});

}

const supportsEvFields = fuelType =>

[
"Electric",
"Hybrid",
"Plug-in Hybrid"
].includes(fuelType);

const [
fuelTypes,
transmissionTypes,
driveTypes,
bodyTypes,
colours,
conditions,
batteryCapacities,
evRanges,
chargingTimes
] = await Promise.all([

getFuelTypes(),
getTransmissionTypes(),
getDriveTypes(),
getBodyTypes(),
getColours(),
getConditions(),
getBatteryCapacities(),
getEvRanges(),
getChargingTimes()

]);

if(fuelSelect){

fuelSelect.innerHTML =
`<option value="">Fuel Type</option>`;

fuelTypes.forEach(item=>{

const option =
document.createElement("option");

option.value = item;
option.textContent = item;

if(item===vehicle.fuel_type){
option.selected=true;
}

fuelSelect.appendChild(option);

});

fuelSelect.addEventListener(
"change",
()=>{

toggleEvFields(
fuelSelect.value
);

}
);

}

if(transmissionSelect){

transmissionSelect.innerHTML =
`<option value="">Transmission</option>`;

transmissionTypes.forEach(item=>{

const option =
document.createElement("option");

option.value=item;
option.textContent=item;

if(item===vehicle.transmission){
option.selected=true;
}

transmissionSelect.appendChild(option);

});

}

if(driveTypeSelect){

driveTypeSelect.innerHTML =
`<option value="">Drive Type</option>`;

driveTypes.forEach(item=>{

const option =
document.createElement("option");

option.value=item;
option.textContent=item;

if(item===vehicle.drive_type){
option.selected=true;
}

driveTypeSelect.appendChild(option);

});

}

if(bodyTypeSelect){

bodyTypeSelect.innerHTML =
`<option value="">Body Type</option>`;

bodyTypes.forEach(item=>{

const option =
document.createElement("option");

option.value=item;
option.textContent=item;

if(item===vehicle.body_type){
option.selected=true;
}

bodyTypeSelect.appendChild(option);

});

}

if(colourSelect){

colourSelect.innerHTML =
`<option value="">Colour</option>`;

colours.forEach(item=>{

const option =
document.createElement("option");

option.value=item;
option.textContent=item;

if(item===vehicle.color){
option.selected=true;
}

colourSelect.appendChild(option);

});

}

if(conditionSelect){

conditionSelect.innerHTML =
`<option value="">Condition</option>`;

conditions.forEach(item=>{

const option =
document.createElement("option");

option.value = item;
option.textContent = item;

if(item === vehicle.condition){
option.selected = true;
}

conditionSelect.appendChild(option);

});

}

vehicleCategorySelect.value =
vehicle.vehicle_category ||
(
vehicle.commercial_vehicle
? "Commercial Vehicle"
: "Passenger Vehicle"
);

const showCommercialCategory =
vehicleCategorySelect.value ===
"Commercial Vehicle";

const commercialCategories =
await getCommercialCategories();

commercialCategorySelect.innerHTML =
`
<option value="">
Select Category
</option>
`;

commercialCategories.forEach(item=>{

const option =
document.createElement("option");

option.value = item;
option.textContent = item;

if(item === vehicle.commercial_category){
option.selected = true;
}

commercialCategorySelect.appendChild(option);

});

const motorcycleTypeSelect =
document.getElementById(
"vehicle_motorcycle_type"
);

if(motorcycleTypeSelect){

motorcycleTypeSelect.innerHTML =
`
<option value="">
Select Motorcycle Type
</option>
`;

[
"Sport Bike",
"Naked Bike",
"Adventure Bike",
"Cruiser",
"Touring",
"Scooter",
"Off-Road",
"Motocross",
"Enduro",
"Dual Sport",
"ATV",
"Quad Bike",
"Side-by-Side"
].forEach(item=>{

const option =
document.createElement("option");

option.value = item;
option.textContent = item;

if(item === vehicle.motorcycle_type){

option.selected = true;

}

motorcycleTypeSelect.appendChild(option);

});

}

if(cabConfigurationSelect){

cabConfigurationSelect.innerHTML =
`
<option value="">
Select Cab Configuration
</option>
`;

[
"Single Cab",
"Space Cab",
"Extended Cab",
"Double Cab",
"Crew Cab",
"Chassis Cab"
].forEach(item=>{

const option =
document.createElement("option");

option.value = item;
option.textContent = item;

if(item === vehicle.cab_configuration){

option.selected = true;

}

cabConfigurationSelect.appendChild(option);

});

}

const payloadCapacitySelect =
document.getElementById(
"vehicle_payload_capacity"
);

const towingCapacitySelect =
document.getElementById(
"vehicle_towing_capacity"
);

if(payloadCapacitySelect){

payloadCapacitySelect.innerHTML =
`
<option value="">
Select Payload Capacity
</option>
`;

[
250,
500,
750,
1000,
1250,
1500,
1750,
2000,
2500,
3000,
3500,
4000,
4500,
5000,
6000,
7000,
8000,
9000,
10000,
12000,
15000,
18000,
20000,
25000,
30000
].forEach(value=>{

const option =
document.createElement("option");

option.value = value;
option.textContent =
`${value.toLocaleString()} kg`;

if(
Number(vehicle.payload_capacity_kg) === value ||
Number(vehicle.payload_capacity) === value
){

option.selected = true;

}

payloadCapacitySelect.appendChild(option);

});

}

if(towingCapacitySelect){

towingCapacitySelect.innerHTML =
`
<option value="">
Select Towing Capacity
</option>
`;

[
500,
750,
1000,
1250,
1500,
1750,
2000,
2500,
3000,
3500,
4000,
4500,
5000,
6000,
7000,
8000,
9000,
10000,
12000,
15000,
18000,
20000,
25000,
30000,
35000
].forEach(value=>{

const option =
document.createElement("option");

option.value = value;
option.textContent =
`${value.toLocaleString()} kg`;

if(
Number(vehicle.towing_capacity_kg) === value ||
Number(vehicle.towing_capacity) === value
){

option.selected = true;

}

towingCapacitySelect.appendChild(option);

});

}

commercialCategorySelect
.closest("div")
.style.display =
showCommercialCategory
? ""
: "none";

const financeAvailable =
document.getElementById(
"vehicle_finance_available"
);

if(financeAvailable){

financeAvailable.value =
String(vehicle.finance_available);

}

const priceNegotiable =
document.getElementById(
"vehicle_price_negotiable"
);

if(priceNegotiable){

priceNegotiable.value =
String(vehicle.price_negotiable);

}

const vatIncluded =
document.getElementById(
"vehicle_vat_included"
);

if(vatIncluded){

vatIncluded.value =
String(vehicle.vat_included);

}

populateEvSelect(
"ev_battery_capacity",
batteryCapacities,
vehicle.battery_capacity_kwh
);

populateEvSelect(
"ev_range",
evRanges,
vehicle.battery_range_km
);

populateEvSelect(
"ev_charging_time",
chargingTimes,
vehicle.charging_time_hours
);

const toggleEvFields = fuelType => {

const showEvFields =
supportsEvFields(fuelType);

document.querySelectorAll(
"[id^='ev_']"
).forEach(field=>{

const wrapper =
field.closest("div");

if(wrapper){

wrapper.style.display =
showEvFields
? ""
: "none";

}

});

};

toggleEvFields(
vehicle.fuel_type
);

const features =
await getFeatures();

let selectedFeatures = [];

if(Array.isArray(vehicle.features)){

selectedFeatures = vehicle.features;

}
else if(typeof vehicle.features === "string"){

try{

selectedFeatures =
JSON.parse(vehicle.features);

}
catch{

selectedFeatures =
vehicle.features
.split(",")
.map(item=>item.trim())
.filter(Boolean);

}

}

selectedFeatures =
selectedFeatures.map(
item=>String(item).trim()
);

featuresContainer.innerHTML = "";

const groupedFeatures = {};

const featureCategoryOrder = [];

features.forEach(feature=>{

const featureValue =
typeof feature === "string"
? feature
: feature.value;

let category = "General";

if(
typeof feature === "object" &&
feature !== null
){

category =
feature.category ||
feature.parent ||
"General";

}

if(!groupedFeatures[category]){

groupedFeatures[category] = [];

featureCategoryOrder.push(category);

}

groupedFeatures[category].push(featureValue);

});

featureCategoryOrder.forEach(category=>{

featuresContainer.insertAdjacentHTML(
"beforeend",
`
<div class="col-span-full mt-6 mv-col" data-mv-category="${category}">

<h4 class="
text-sm
font-black
uppercase
tracking-[0.12em]
text-[#163A70]
mb-3
">
${category}
</h4>

<div
class="
grid
grid-cols-2
md:grid-cols-3
xl:grid-cols-4
gap-3
"
id="feature_group_${category.replace(/\s+/g,'_')}"
>

</div>

</div>
`
);

const group =
document.getElementById(
`feature_group_${category.replace(/\s+/g,'_')}`
);

groupedFeatures[category].forEach(featureValue=>{

const id =
`feature_${featureValue
.replace(/\s+/g,"_")
.toLowerCase()}`;

const checked =
selectedFeatures.includes(
String(featureValue).trim()
);

group.insertAdjacentHTML(
"beforeend",
`

<label
class="
flex
items-center
gap-3
rounded-xl
border
border-[#E2E8F0]
p-3
cursor-pointer
hover:bg-[#F8FAFC]
"
data-mv-name="${featureValue.toLowerCase()}"
>

<input
type="checkbox"
id="${id}"
value="${featureValue}"
${checked ? "checked" : ""}
/>

<span>${featureValue}</span>

</label>

`
);

});

});

mvFeatureGroups = groupedFeatures;
mvFeatureCategories = [...featureCategoryOrder].sort((a,b)=>a.localeCompare(b));
mvActiveCategory = featureCategoryOrder.length
? featureCategoryOrder[0]
: "";
mvSelected = new Set(
selectedFeatures.map(
item=>String(item).trim()
)
);

initManageFeaturePicker();

provinceSelect.addEventListener(
"change",
async ()=>{

const cities =
await getCities(
provinceSelect.value
);

citySelect.innerHTML =
`
<option value="">
Select City
</option>
`;

cities.forEach(city=>{

const cityValue =
typeof city === "string"
? city
: city.value;

const option =
document.createElement(
"option"
);

option.value =
cityValue;

option.textContent =
cityValue;

citySelect.appendChild(
option);

});

});

const updateCommercialCategoryVisibility = ()=>{

const commercialSection =
document.getElementById(
"commercial_category_wrapper"
);

const cabConfigurationSection =
document.getElementById(
"cab_configuration_wrapper"
);

const payloadCapacitySection =
document.getElementById(
"payload_capacity_wrapper"
);

const towingCapacitySection =
document.getElementById(
"towing_capacity_wrapper"
);

const motorcycleTypeSection =
document.getElementById(
"motorcycle_type_wrapper"
);

const engineCapacitySection =
document.getElementById(
"engine_capacity_wrapper"
);

const isCommercial =
vehicleCategorySelect.value ===
"Commercial Vehicle";

if(commercialSection){

commercialSection.style.display =
isCommercial
? ""
: "none";

}

if(cabConfigurationSection){

cabConfigurationSection.style.display =
isCommercial
? ""
: "none";

}

if(payloadCapacitySection){

payloadCapacitySection.style.display =
isCommercial
? ""
: "none";

}

if(towingCapacitySection){

towingCapacitySection.style.display =
isCommercial
? ""
: "none";

}

const isMotorcycleCategory =
[
"Motorcycle",
"ATV",
"Quad Bike",
"Side-by-Side"
].includes(
vehicleCategorySelect.value
);

if(motorcycleTypeSection){

motorcycleTypeSection.style.display =
isMotorcycleCategory
? ""
: "none";

}

if(engineCapacitySection){

engineCapacitySection.style.display =
isMotorcycleCategory
? ""
: "none";

}

if(!isCommercial){

commercialCategorySelect.value = "";

const cabConfiguration =
document.getElementById(
"vehicle_cab_configuration"
);

if(cabConfiguration){

cabConfiguration.value = "";

}

const payloadCapacity =
document.getElementById(
"vehicle_payload_capacity"
);

if(payloadCapacity){

payloadCapacity.value = "";

}

const towingCapacity =
document.getElementById(
"vehicle_towing_capacity"
);

if(towingCapacity){

towingCapacity.value = "";

}

}

};

updateCommercialCategoryVisibility();

vehicleCategorySelect.addEventListener(
"change",
updateCommercialCategoryVisibility
);

makeSelect.addEventListener(
"change",
async ()=>{

const selectedMake =
makeSelect.value;

const selectedModel =
modelSelect.value;

const titleInput =
document.getElementById(
"vehicle_title"
);

if(titleInput){

titleInput.value =
[
selectedMake,
selectedModel
]
.filter(Boolean)
.join(" ");

}

const models =
await getModels(
selectedMake
);

modelSelect.innerHTML =
`
<option value="">
Select Model
</option>
`;

variantSelect.innerHTML =
`
<option value="">
Select Variant (Optional)
</option>
`;

models.forEach(model=>{

const modelValue =
typeof model === "string"
? model
: model.value;

const option =
document.createElement(
"option"
);

option.value =
modelValue;

option.textContent =
modelValue;

modelSelect.appendChild(
option
);

});

variantSelect.innerHTML =
`
<option value="">
Select Variant (Optional)
</option>
`;

variantSelect.value = "";

}
);

modelSelect.addEventListener(
"change",
async ()=>{

const selectedMake =
makeSelect.value;

const selectedModel =
modelSelect.value;

const titleInput =
document.getElementById(
"vehicle_title"
);

if(titleInput){

titleInput.value =
[
selectedMake,
selectedModel
]
.filter(Boolean)
.join(" ");

}

const vehicleVariants =
await getVariants(
selectedMake,
selectedModel
);

variantSelect.innerHTML =
`
<option value="">
Select Variant (Optional)
</option>
`;

variantSelect.value = "";

vehicleVariants.forEach(variant=>{

const variantValue =
typeof variant === "string"
? variant
: variant.value;

const option =
document.createElement(
"option"
);

option.value =
variantValue;

option.textContent =
variantValue;

variantSelect.appendChild(
option
);

});

}
);

}

function populateEvSelect(id, options, selected){

const select =
document.getElementById(id);

if(!select){
return;
}

const firstOption =
select.options[0]?.outerHTML ||
'<option value="">Select</option>';

select.innerHTML =
firstOption;

const selectedValue =
selected == null
? ""
: String(selected).trim().toLowerCase();

options.forEach(option=>{

const element =
document.createElement("option");

element.value = option;
element.textContent = option;

const optionValue =
String(option)
.trim()
.toLowerCase();

if(
optionValue === selectedValue ||
optionValue.includes(selectedValue) ||
selectedValue.includes(optionValue)
){
element.selected = true;
}

select.appendChild(element);

});

}

function renderVehicleSpecifications(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

root.insertAdjacentHTML(
"beforeend",
`

<div class="
rounded-[20px]
bg-white
border
border-[#E2E8F0]
shadow-[0_25px_70px_rgba(15,23,42,0.08)]
overflow-hidden
">

<div class="p-4">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#E48A2F]
mb-2
">
Specifications
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-3
">
Vehicle Specifications
</h2>

<div class="
grid
grid-cols-1
md:grid-cols-2
gap-3
">

<div>
<label class="block mb-1 text-sm font-semibold">
Fuel Type
</label>
<select
id="spec_fuel_type"
class="w-full rounded-xl border border-[#E2E8F0] py-3 px-4"
>
<option value="">
Fuel Type
</option>
</select>
</div>

<div>
<label class="block mb-1 text-sm font-semibold">
Transmission
</label>
<select
id="spec_transmission"
class="w-full rounded-xl border border-[#E2E8F0] py-3 px-4"
>
<option value="">
Transmission
</option>
</select>
</div>

<div>
<label class="block mb-1 text-sm font-semibold">
Drive Type
</label>
<select
id="spec_drive_type"
class="w-full rounded-xl border border-[#E2E8F0] py-3 px-4"
>
<option value="">
Drive Type
</option>
</select>
</div>

<div>
<label class="block mb-1 text-sm font-semibold">
Body Type
</label>
<select
id="spec_body_type"
class="w-full rounded-xl border border-[#E2E8F0] py-3 px-4"
>
<option value="">
Body Type
</option>
</select>
</div>

<div>
<label class="block mb-1 text-sm font-semibold">
Color
</label>
<select
id="spec_color"
class="w-full rounded-xl border border-[#E2E8F0] py-3 px-4"
>
<option value="">
Colour
</option>
</select>
</div>

<div
id="engine_capacity_wrapper"
>

<label class="block mb-1 text-sm font-semibold">
Engine Capacity (cc)
</label>

<input
id="spec_engine_capacity_cc"
value="${vehicle.engine_capacity_cc || ""}"
type="number"
class="
w-full
rounded-xl
border
border-[#E2E8F0]
py-3 px-4
"
/>

</div>

<div>

<label class="block mb-1 text-sm font-semibold">
Power Output (kW)
</label>

<input
id="spec_power_kw"
value="${vehicle.power_kw || ""}"
type="number"
class="
w-full
rounded-xl
border
border-[#E2E8F0]
py-3 px-4
"
/>

</div>

${[
  ["engine_size_l", "Engine Size (L)"], ["torque_nm", "Torque (Nm)"],
  ["cylinders", "Cylinders"], ["fuel_consumption_l100", "Fuel Consumption (L/100 km)"],
  ["co2_emissions_gkm", "CO₂ Emissions (g/km)"], ["electric_range_km", "Electric Range (km)"]
].filter(([key]) => vehicle[key] !== null && vehicle[key] !== undefined && vehicle[key] !== "" && Number.isFinite(Number(vehicle[key])) && Number(vehicle[key]) >= 0).map(([key, label]) => `<div><label class="block mb-1 text-sm font-semibold" for="spec_${key}">${label}</label><input id="spec_${key}" type="number" min="0" step="any" value="${vehicle[key]}" class="w-full rounded-xl border border-[#E2E8F0] py-3 px-4" /></div>`).join("")}

${vehicle.turbocharged === true ? '<label class="flex items-center gap-2 text-sm font-semibold"><input id="spec_turbocharged" type="checkbox" checked /> Turbocharged</label>' : ""}
${vehicle.fast_charge === true ? '<label class="flex items-center gap-2 text-sm font-semibold"><input id="spec_fast_charge" type="checkbox" checked /> Fast Charging</label>' : ""}

<div>

<label class="block mb-1 text-sm font-semibold">
Seats
</label>
<input
id="spec_seats"
value="${vehicle.seats || ""}"
type="number"
class="w-full rounded-xl border border-[#E2E8F0] py-3 px-4"
/>
</div>

<div>
<label class="block mb-1 text-sm font-semibold">
Doors
</label>
<input
id="spec_doors"
value="${vehicle.doors || ""}"
type="number"
class="w-full rounded-xl border border-[#E2E8F0] py-3 px-4"
/>
</div>

<div>

<label class="block mb-1 text-sm font-semibold">
Condition
</label>

<select
id="spec_condition"
class="w-full rounded-xl border border-[#E2E8F0] py-3 px-4"
>

<option value="">
Condition
</option>

</select>

</div>



<div class="md:col-span-2 mt-8">

<div class="
flex
items-center
justify-center
my-6
">

<div class="
w-full
max-w-[220px]
h-[2px]
rounded-full
bg-gradient-to-r
from-transparent
via-[#163A70]
to-transparent
"></div>

</div>

<h3 class="
text-xl
font-black
text-[#08111F]
mb-2
">
Electric Vehicle Specifications
</h3>

<p class="
text-sm
text-[#64748B]
mb-6
leading-relaxed
">
These fields are only displayed for Electric, Hybrid and Plug-in Hybrid vehicles.
</p>

</div>

<div>

<label class="block mb-1 text-sm font-semibold">
Battery Capacity
</label>

<select
id="ev_battery_capacity"
class="w-full rounded-xl border border-[#E2E8F0] py-3 px-4">

<option value="">
Select Battery Capacity
</option>

</select>

</div>

<div>

<label class="block mb-1 text-sm font-semibold">
Battery Range
</label>

<select
id="ev_range"
class="w-full rounded-xl border border-[#E2E8F0] py-3 px-4">

<option value="">
Select Battery Range
</option>

</select>

</div>

<div>

<label class="block mb-1 text-sm font-semibold">
Charging Time
</label>

<select
id="ev_charging_time"
class="w-full rounded-xl border border-[#E2E8F0] py-3 px-4">

<option value="">
Select Charging Time
</option>

</select>

</div>



</div>

</div>

</div>

`
);

}

function renderVehicleFeatures(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

const specificationsGrid =
root.lastElementChild?.querySelector(
".grid"
);

if(!specificationsGrid){
return;
}

specificationsGrid.insertAdjacentHTML(
"beforeend",
`
<div class="md:col-span-2 mt-8">

<div class="
flex
items-center
justify-center
my-6
">

<div class="
w-full
max-w-[220px]
h-[2px]
rounded-full
bg-gradient-to-r
from-transparent
via-[#163A70]
to-transparent
"></div>

</div>

<h3 class="
text-xl
font-black
text-[#08111F]
mb-2
">
Vehicle Features
</h3>

<p class="
text-sm
text-[#64748B]
mb-6
leading-relaxed
">
Select all factory and optional features available on this vehicle.
</p>

<!-- Feature picker (shared across mobile AND desktop — category tabs + search) -->
<div
id="mvFeaturePicker"
class="
mv-feature-picker
"
>

<div class="mv-feature-search">
<input
id="mvFeatureSearch"
type="text"
autocomplete="off"
placeholder="Search vehicle features..."
aria-label="Search vehicle features"
>
</div>

<div
id="mvFeatureNav"
class="mv-feature-nav"
role="tablist"
aria-label="Feature categories"
></div>

</div>

<div
id="vehicle_features_container"
class="
grid
grid-cols-2
md:grid-cols-3
xl:grid-cols-4
gap-3
"
>

</div>

</div>
`
);

}

/* =========================================================
   VEHICLE FEATURES PICKER — Manage Vehicle (ALL VIEWPORTS)
   Pure presentation layer. Reuses the existing checkbox inputs
   already rendered inside #vehicle_features_container (so the
   existing save logic that reads
     "#vehicle_features_container input[type='checkbox']:checked"
   keeps working untouched). It only toggles the VISIBILITY of the
   pre-built category blocks + feature labels plus the active
   category navigation, and never alters feature data, ids, values
   or selection state. Mobile stacks the tabs one per row; desktop
   wraps them horizontally (see styles.css DESKTOP/TABLET block).
   ========================================================= */

let mvFeatureGroups = {};
let mvFeatureCategories = [];
let mvSelected = new Set();
let mvActiveCategory = "";

/* Attach change listeners to every rendered feature checkbox so the
   selected chip styling stays in sync, then build the category nav
   and apply the current view. */
function initManageFeaturePicker(){

const container =
document.getElementById(
"vehicle_features_container"
);

if(!container){
return;
}

Array.from(
container.querySelectorAll(
"input[type='checkbox']"
)
).forEach(checkbox=>{

checkbox.addEventListener(
"change",
()=>{

const label =
checkbox.closest(
"label"
);

if(label){
label.classList.toggle(
"mv-checked",
checkbox.checked
);
}

syncMvSelected();

}
);

});

const searchInput =
document.getElementById(
"mvFeatureSearch"
);

if(searchInput){

searchInput.addEventListener(
"input",
()=>{

applyManageFeatureView();

}
);

}

renderMobileFeatureNav();

applyManageFeatureView();

}

/* Keep module-level selection set in sync with the DOM checkboxes.
   Not used for saving (save reads the DOM directly) — used only to
   preserve selected styling across view toggles. */
function syncMvSelected(){

const container =
document.getElementById(
"vehicle_features_container"
);

if(!container){
return;
}

mvSelected = new Set(
Array.from(
container.querySelectorAll(
"#vehicle_features_container input[type='checkbox']:checked"
)
)
.map(
item=>String(item.value).trim()
)
);

}

/* Build the horizontally-scrollable category navigation (mobile only)
   using the SAME visual classes the Upload Vehicle page uses, so the
   category-selection experience is identical. */
function renderMobileFeatureNav(){

const nav =
document.getElementById(
"mvFeatureNav"
);

if(!nav || !mvFeatureCategories.length){
return;
}

nav.innerHTML = "";

mvFeatureCategories.forEach(category=>{

const tab =
document.createElement(
"button"
);

tab.type = "button";

const isActive =
category === mvActiveCategory;

tab.className =
(
isActive
? "hufa-tab-active hufa-feature-tab shrink-0 whitespace-nowrap px-4 py-2.5 rounded-full bg-[#005BBF] text-white text-sm font-semibold shadow-sm ring-2 ring-[#E48A2F]/60 "
: "hufa-tab hufa-feature-tab shrink-0 whitespace-nowrap px-4 py-2.5 rounded-full border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:border-[#E48A2F] hover:text-[#08111F] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E48A2F]/60 "
);

if(isActive){
tab.setAttribute(
"aria-selected",
"true"
);
}

tab.textContent =
category;

tab.onclick =
()=>{

mvActiveCategory =
category;

renderMobileFeatureNav();

applyManageFeatureView();

};

nav.appendChild(
tab
);

});

/* keep the active tab visible after render */
const activeTab =
Array.from(
nav.querySelectorAll(
".hufa-feature-tab"
)
).find(
tab=>tab.textContent === mvActiveCategory
);

if(
activeTab &&
typeof nav.scrollTo === "function"
){

try{

nav.scrollTo({
left: Math.max(
0,
activeTab.offsetLeft -
(nav.clientWidth - activeTab.offsetWidth) / 2
),
behavior: "smooth"
});

}
catch(e){

try{
nav.scrollLeft = activeTab.offsetLeft;
}
catch(_){
/* no-op */
}

}

}

}

/* Apply the mobile presentation to the static feature markup:
   - no search  -> show only the active category's feature block
   - searching  -> show matches across ALL categories (the Upload
                   Vehicle behaviour) with category headings visible
   - preserving every checkbox's selected state.
   Never re-creates feature inputs, so nothing about saving/data
   changes. */
function applyManageFeatureView(){

const container =
document.getElementById(
"vehicle_features_container"
);

if(!container){
return;
}

const searchInput =
document.getElementById(
"mvFeatureSearch"
);

const searchTerm =
(searchInput?.value || "")
.toLowerCase()
.trim();

const searching =
searchTerm.length > 0;

if(searching){
container.classList.add("mv-searching");
}
else{
container.classList.remove("mv-searching");
}

Array.from(
container.querySelectorAll(
":scope > .mv-col"
)
).forEach(wrapper=>{

const category =
wrapper.getAttribute(
"data-mv-category"
) || "";

const labels =
Array.from(
wrapper.querySelectorAll(
"label[data-mv-name]"
)
);

let wrapperVisible = false;

labels.forEach(label=>{

const name =
label.getAttribute(
"data-mv-name"
) || "";

const matches =
searching
? name.includes(searchTerm)
: true;

if(searching && !matches){
label.setAttribute("data-mv-hidden","true");
}
else{
label.setAttribute("data-mv-hidden","false");
}

if(
name.length >= 22 &&
matches
){
label.classList.add("mv-full");
}
else{
label.classList.remove("mv-full");
}

const checkbox =
label.querySelector(
"input[type='checkbox']"
);

if(checkbox?.checked){
label.classList.add("mv-checked");
}
else{
label.classList.remove("mv-checked");
}

if(matches){
wrapperVisible = true;
}

});

wrapper.setAttribute(
"data-mv-visible",
(
!searching
? category === mvActiveCategory
: wrapperVisible
)
? "true"
: "false"
);

});

}



async function renderPerformance(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

const [
viewsResult,
savedResult,
enquiriesResult,
financeResult
] = await Promise.all([

supabase
.from("vehicle_views")
.select("*",{count:"exact",head:true})
.eq("vehicle_id",vehicle.id),

supabase
.from("saved_vehicles")
.select("*",{count:"exact",head:true})
.eq("vehicle_id",vehicle.id),

supabase
.from("enquiries")
.select("*",{count:"exact",head:true})
.eq("vehicle_id",vehicle.id),

supabase
.from("finance_applications")
.select("*",{count:"exact",head:true})
.eq("vehicle_id",vehicle.id)

]);

root.insertAdjacentHTML(
"beforeend",
`

<div class="
rounded-[20px]
bg-white
border
border-[#E2E8F0]
shadow-[0_25px_70px_rgba(15,23,42,0.08)]
overflow-hidden
">

<div class="p-4">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#E48A2F]
mb-2
">
Performance
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-3
">
Vehicle Performance
</h2>

<div class="
grid
grid-cols-2
lg:grid-cols-4
gap-3
">

${performanceCard(
"Views",
viewsResult.count || 0
)}

${performanceCard(
"Saved",
savedResult.count || 0
)}

${performanceCard(
"Enquiries",
enquiriesResult.count || 0
)}

${performanceCard(
"Finance",
financeResult.count || 0
)}

</div>

</div>

</div>

`
);

}

function performanceCard(
label,
value
){

return `

<div class="
rounded-[20px]
border
border-[#E2E8F0]
bg-[#F8FAFC]
p-4
">

<p class="
text-xs
uppercase
tracking-[0.14em]
text-[#64748B]
mb-3
">
${label}
</p>

<p class="
text-xl
font-black
text-[#08111F]
">
${value}
</p>

</div>

`;

}

async function renderEnquiries(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

const {
data:enquiries
} =
await supabase
.from("enquiries")
.select("*")
.eq("vehicle_id",vehicle.id)
.order(
"created_at",
{ ascending:false }
);

root.insertAdjacentHTML(
"beforeend",
`

<div class="
rounded-[20px]
bg-white
border
border-[#E2E8F0]
shadow-[0_25px_70px_rgba(15,23,42,0.08)]
overflow-hidden
">

<div class="p-4">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#E48A2F]
mb-2
">
Leads
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-3
">
Vehicle Enquiries
</h2>

${
!enquiries?.length
?
`
<div class="
rounded-xl
border
border-dashed
border-[#CBD5E1]
p-4
text-center
text-[#64748B]
">
No enquiries yet
</div>
`
:
enquiries.map(e => `

<div class="
border
border-[#E2E8F0]
rounded-xl
p-4
mb-2
">

<div class="
flex
items-center
justify-between
mb-2
">

<h3 class="
font-black
text-lg
text-[#08111F]
">
${e.name || "Unknown"}
</h3>

<select
onchange="
updateEnquiryStatus(
'${e.id}',
this.value
)
"
class="
px-3
py-2
rounded-full
bg-[#F8FAFC]
border
border-[#E2E8F0]
text-xs
font-bold
"
>

<option
value="new"
${(e.status || "new") === "new" ? "selected" : ""}
>
New
</option>

<option
value="contacted"
${e.status === "contacted" ? "selected" : ""}
>
Contacted
</option>

<option
value="interested"
${e.status === "interested" ? "selected" : ""}
>
Interested
</option>

<option
value="test_drive_booked"
${e.status === "test_drive_booked" ? "selected" : ""}
>
Test Drive Booked
</option>

<option
value="negotiating"
${e.status === "negotiating" ? "selected" : ""}
>
Negotiating
</option>

<option
value="closed_won"
${e.status === "closed_won" ? "selected" : ""}
>
Closed Won
</option>

<option
value="closed_lost"
${e.status === "closed_lost" ? "selected" : ""}
>
Closed Lost
</option>

</select>

</div>

<div class="space-y-2">

<p>
<strong>Email:</strong>
${e.email || "-"}
</p>

<p>
<strong>Phone:</strong>
${e.phone || "-"}
</p>

<p>
<strong>Message:</strong>
</p>

<div class="
bg-[#F8FAFC]
rounded-xl
py-3 px-4
">
${e.message || "-"}
</div>

</div>

</div>

`).join("")
}

</div>

</div>

`
);

}

async function renderFinanceApplications(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

const {
data:applications
}
=
await supabase
.from("finance_applications")
.select("*")
.eq("vehicle_id",vehicle.id)
.order(
"created_at",
{ ascending:false }
);

root.insertAdjacentHTML(
"beforeend",
`

<div class="
rounded-[20px]
bg-white
border
border-[#E2E8F0]
shadow-[0_25px_70px_rgba(15,23,42,0.08)]
overflow-hidden
">

<div class="p-4">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#E48A2F]
mb-2
">
Finance
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-3
">
Finance Applications
</h2>

${
!applications?.length
?
`
<div class="
rounded-xl
border
border-dashed
border-[#CBD5E1]
p-4
text-center
text-[#64748B]
">
No finance applications yet
</div>
`
:
applications.map(app => `

<div class="
border
border-[#E2E8F0]
rounded-xl
p-4
mb-2
">

<div class="
flex
items-center
justify-between
mb-2
">

<h3 class="
font-black
text-lg
text-[#08111F]
">
${app.name || ""} ${app.surname || ""}
</h3>

<select
onchange="
updateFinanceStatus(
'${app.id}',
this.value
)
"
class="
px-3
py-2
rounded-full
bg-[#F8FAFC]
border
border-[#E2E8F0]
text-xs
font-bold
"
>

<option
value="pending"
${(app.status || "pending") === "pending" ? "selected" : ""}
>
Pending
</option>

<option
value="reviewing"
${app.status === "reviewing" ? "selected" : ""}
>
Reviewing
</option>

<option
value="documents_requested"
${app.status === "documents_requested" ? "selected" : ""}
>
Documents Requested
</option>

<option
value="approved"
${app.status === "approved" ? "selected" : ""}
>
Approved
</option>

<option
value="declined"
${app.status === "declined" ? "selected" : ""}
>
Declined
</option>

<option
value="funded"
${app.status === "funded" ? "selected" : ""}
>
Funded
</option>

</select>

</div>

<div class="
grid
grid-cols-1
md:grid-cols-2
gap-3
">

<div>
<strong>Email:</strong>
${app.email || "-"}
</div>

<div>
<strong>Contact:</strong>
${app.phone || "-"}
</div>

<div>
<strong>Credit Score:</strong>
${app.credit_score || "-"}
</div>

<div>
<strong>Income:</strong>
R ${Number(
app.income || 0
).toLocaleString()}
</div>

<div>
<strong>Employment:</strong>
${app.employment_status || "-"}
</div>

<div>
<strong>Account Type:</strong>
${app.account_type || "-"}
</div>

<div>
<strong>Date:</strong>
${new Date(
app.created_at
).toLocaleDateString()}
</div>

</div>

</div>

`).join("")
}

</div>

</div>

`
);

}

async function renderVehicleNotes(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

const {
data:notes
}
=
await supabase
.from("vehicle_notes")
.select("*")
.eq(
"vehicle_id",
vehicle.id
)
.order(
"created_at",
{
ascending:false
}
);

root.insertAdjacentHTML(
"beforeend",
`

<div class="
rounded-[20px]
bg-white
border
border-[#E2E8F0]
shadow-[0_25px_70px_rgba(15,23,42,0.08)]
overflow-hidden
">

<div class="p-4">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#E48A2F]
mb-2
">
Notes
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-3
">
Vehicle Notes
</h2>

<div class="mb-2">

<textarea
id="vehicle_note_input"
rows="3"
placeholder="Add a note..."
class="
w-full
rounded-xl
border
border-[#E2E8F0]
py-3 px-4
"
></textarea>

<button
onclick="
addVehicleNote(
'${vehicle.id}'
)
"
class="
mt-4
px-5
py-2.5
rounded-xl
dashboard-primary-btn
"
>
Add Note
</button>

</div>

<div class="space-y-4">

${
(notes || [])
.map(note => `

<div class="
rounded-xl
border
border-[#E2E8F0]
py-3 px-4
">

<div class="
text-xs
text-[#64748B]
mb-2
">
${new Date(
note.created_at
).toLocaleString()}
</div>

<div>
${note.note}
</div>

</div>

`)
.join("")
}

</div>

</div>

</div>

`
);

}

async function renderActivityTimeline(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

const {
data:activities
}
=
await supabase
.from("vehicle_activity")
.select("*")
.eq(
"vehicle_id",
vehicle.id
)
.order(
"created_at",
{
ascending:false
}
);

root.insertAdjacentHTML(
"beforeend",
`

<div class="
rounded-[20px]
bg-white
border
border-[#E2E8F0]
shadow-[0_25px_70px_rgba(15,23,42,0.08)]
overflow-hidden
">

<div class="p-4">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#E48A2F]
mb-2
">
Timeline
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-3
">
Vehicle Activity
</h2>

<div class="space-y-4">

${
(activities || [])
.map(item => `

<div class="
rounded-xl
border
border-[#E2E8F0]
py-3 px-4
">

<div class="
text-xs
text-[#64748B]
mb-2
">
${new Date(
item.created_at
).toLocaleString()}
</div>

<div class="
font-semibold
">
${item.activity_text}
</div>

</div>

`)
.join("")
}

</div>

</div>

</div>

`
);

}

function renderDangerZone(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

root.insertAdjacentHTML(
"beforeend",
`

<div class="
rounded-[20px]
bg-white
border
border-red-200
shadow-[0_25px_70px_rgba(15,23,42,0.08)]
overflow-hidden
">

<div class="p-4">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-red-500
mb-2
">
Danger Zone
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-3
">
Vehicle Management
</h2>

<div class="
flex
flex-wrap
gap-3
">

<button
onclick="markVehicleSold()"
class="
px-6
py-2.5
rounded-xl
bg-[#E48A2F]
text-[#08111F]
font-bold
shadow-[0_8px_20px_rgba(228,138,47,0.28)]
">
Mark Sold
</button>

<button
onclick="activateVehicle()"
class="
px-5
py-2
rounded-xl
bg-green-100
text-green-700
font-bold
">
Activate
</button>

<button
onclick="archiveVehicle()"
class="
px-5
py-2
rounded-xl
bg-slate-100
text-slate-700
font-bold
">
Archive
</button>

<button
onclick="deleteVehicle()"
class="
px-5
py-2
rounded-xl
bg-red-100
text-red-600
font-bold
">
Delete Vehicle
</button>

</div>

</div>

</div>

`
);

}

function renderPromotionControls(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

root.insertAdjacentHTML(
"beforeend",
`

<div class="
rounded-[20px]
bg-white
border
border-[#E2E8F0]
shadow-[0_25px_70px_rgba(15,23,42,0.08)]
overflow-hidden
">

<div class="p-4">

<p class="
uppercase
tracking-[0.18em]
text-[12px]
font-black
text-[#E48A2F]
mb-2
">
Promotion
</p>

<h2 class="
text-xl
font-black
tracking-[-0.04em]
text-[#08111F]
mb-3
">
Promotion Controls
</h2>

<div class="
grid
grid-cols-1
md:grid-cols-3
gap-3
">

${overviewChip(
"Featured",
vehicle.is_featured ? "Enabled" : "Disabled"
)}

${overviewChip(
"Sponsored",
vehicle.is_sponsored ? "Enabled" : "Disabled"
)}

${overviewChip(
"Homepage Boost",
vehicle.homepage_boost ? "Enabled" : "Disabled"
)}

</div>

</div>

</div>

`
);

}

function renderOverview(v){

const root =
document.getElementById(
"manageVehicleRoot"
);

root.innerHTML = `

<div class="space-y-6">

<!-- HEADER -->
<div class="
flex
flex-col
lg:flex-row
lg:items-end
lg:justify-between
gap-5
">

<div class="min-w-0">

<p class="
dashboard-page-label
uppercase
tracking-[0.18em]
text-xs
font-black
text-[#E48A2F]
mb-3
">
Vehicle Workspace
</p>

<h1 class="
dashboard-page-title
text-2xl
sm:text-3xl
font-black
tracking-[-0.04em]
leading-none
text-[#08111F]
">
${[
v.make,
v.model,
v.variant
]
.filter(Boolean)
.join(" ")}
</h1>

<p class="
mt-4
text-2xl
font-black
tracking-[-0.02em]
text-[#08111F]
">
R ${Number(
v.price || 0
).toLocaleString()}
</p>

<div class="
mt-2
text-sm
leading-relaxed
text-[#64748B]
flex
flex-wrap
items-center
gap-x-3
gap-y-1
">
<span>${v.year || "-"}</span>
<span class="opacity-50">•</span>
<span>${Number(
v.mileage || 0
).toLocaleString()} km</span>
<span class="opacity-50">•</span>
<span>${v.fuel_type || "-"}</span>
<span class="opacity-50">•</span>
<span>${v.transmission || "-"}</span>
<span class="opacity-50">•</span>
<span>${v.drive_type || "-"}</span>
</div>

</div>

<div class="flex lg:items-end">

<button
onclick="previewVehicle('${v.id}')"
class="
self-start
lg:self-auto
inline-flex
items-center
gap-2
px-6
py-3
rounded-xl
bg-[#005BBF]
text-white
text-sm
font-semibold
shadow-[0_12px_30px_rgba(8,17,31,0.22)]
hover:bg-[#004FA8]
hover:-translate-y-[1px]
transition-all
duration-200
">

Preview Listing

</button>

</div>

</div>

<!-- SUMMARY CARD -->

<div class="
rounded-[20px]
overflow-hidden
bg-white
border
border-[#E2E8F0]
shadow-[0_25px_70px_rgba(15,23,42,0.08)]
">

<div class="
grid
grid-cols-1
xl:grid-cols-[400px_1fr]
">

<div class="
relative
min-h-[220px]
xl:min-h-[320px]
bg-[#F8FAFC]
">

<img
src="${
v.image_url ||
PLACEHOLDER
}"
class="
absolute
inset-0
w-full
h-full
object-contain
"
/>

</div>

<div class="
p-4
md:p-6
lg:p-8
space-y-6
">

<div class="
flex
flex-wrap
items-baseline
justify-between
gap-3
">

<h2 class="
text-2xl
font-bold
tracking-[-0.03em]
text-[#08111F]
">
R ${Number(
v.price || 0
).toLocaleString()}
</h2>

<p class="
text-sm
text-[#64748B]
">
${v.year || ""} &nbsp;•&nbsp; ${v.mileage || 0} km
</p>

</div>

<!-- LISTING -->
<div>

<p class="
text-xs
uppercase
tracking-[0.16em]
font-black
text-[#E48A2F]
mb-3
">
Listing
</p>

<div class="
grid
grid-cols-2
md:grid-cols-4
gap-3
">

${overviewChip(
"Status",
(v.status || "active").toUpperCase()
)}

${overviewChip(
"Featured",
v.is_featured
? "Yes"
: "No"
)}

${overviewChip(
"Vehicle Category",
v.vehicle_category || "-"
)}

${overviewChip(
"Condition",
v.condition || "-"
)}

</div>

</div>

<!-- PRICING -->
<div>

<p class="
text-xs
uppercase
tracking-[0.16em]
font-black
text-[#E48A2F]
mb-3
">
Pricing
</p>

<div class="
grid
grid-cols-2
md:grid-cols-4
gap-3
">

${overviewChip(
"Price",
`R ${Number(v.price || 0).toLocaleString()}`
)}

${overviewChip(
"Original Price",
v.original_price
? `R ${Number(v.original_price).toLocaleString()}`
: "-"
)}

${overviewChip(
"Price Reduced",
v.is_price_reduced ? "Yes" : "No"
)}

${overviewChip(
"Reduction Count",
v.reduction_count || 0
)}

</div>

</div>

<!-- LOCATION & FUEL -->
<div>

<p class="
uppercase
text-xs
tracking-[0.16em]
font-black
text-[#E48A2F]
mb-3
">
Location &amp; Fuel
</p>

<div class="
grid
grid-cols-1
sm:grid-cols-2
gap-3
">

${overviewChip(
"Location",
[
v.city,
v.province
]
.filter(Boolean)
.join(", ") || "-"
)}

${overviewChip(
"Fuel Type",
v.fuel_type || "-"
)}

</div>

</div>

</div>

</div>

</div>

</div>

`;

}

function renderBottomActionBar(vehicle){

const root =
document.getElementById(
"manageVehicleRoot"
);

root.insertAdjacentHTML(
"beforeend",
`

<div
class="
mt-10
mb-10
flex
flex-wrap
items-center
justify-end
gap-3
"
>

<!-- PHASE 5 — explicit discard for the temporary edit draft.
Existing bottom action bar only: discards the unsaved edit draft
for THIS user + vehicle and reloads the workspace from the
published row. Published vehicle data is never touched. -->
<button
type="button"
onclick="discardVehicleDraftChanges()"
class="
px-6
py-3
rounded-xl
border
border-slate-200
bg-white
text-slate-600
font-bold
transition-all
duration-300
hover:bg-red-50
hover:text-red-600
hover:border-red-200
active:scale-[0.98]
"
>

Discard Unsaved Changes

</button>

<button
onclick="saveVehicleChanges()"
class="
px-8
py-3
rounded-xl
bg-[#005BBF]
text-white
font-bold
shadow-[0_14px_35px_rgba(8,17,31,0.25)]
hover:bg-[#004FA8]
hover:-translate-y-[1px]
transition-all
duration-300
"
>

Save Changes

</button>

</div>

`
);

}

/* PHASE 5 — discard the temporary edit draft (explicit user
cancel/discard). Clears ONLY the draft for this user + vehicle and
re-renders the workspace from the published row, so the user is
returned to the normal saved vehicle state. */
window.discardVehicleDraftChanges =
async function(){

const params =
new URLSearchParams(
window.location.search
);

const vehicleId =
params.get("id");

if(!vehicleId){ return; }

const confirmed =
confirm(
"Discard unsaved changes and restore the saved vehicle details?"
);

if(!confirmed){ return; }

await resolveManageVehicleDraftUserId();

clearManageVehicleEditDraft(vehicleId);

const boot =
mountManageVehicleLoadingOverlay();

try{

await loadVehicleWorkspace(vehicleId);

}catch(e){

console.warn("Manage Vehicle reload failed", e);

}finally{

if(boot === manageVehicleBootSeq){
unmountManageVehicleLoadingOverlay();
}

}

};

function overviewChip(
label,
value
){

return `

<div class="
rounded-xl
border
border-[#E2E8F0]
bg-[#F8FAFC]
py-3 px-4
">

<p class="
text-xs
uppercase
tracking-[0.12em]
text-[#64748B]
mb-2
">
${label}
</p>

<p class="
font-black
text-[#08111F]
">
${value}
</p>

</div>

`;

}

window.previewVehicle =
function(id){

navigate(
"/vehicle?id="+id
);

};

function manageVehicleOptionalNumber(id){
const raw = document.getElementById(id)?.value;
if(raw === undefined || raw === "") return null;
const value = Number(raw);
return Number.isFinite(value) && value >= 0 ? value : null;
}

window.saveVehicleChanges =
async function(){

const params =
new URLSearchParams(
window.location.search
);

const vehicleId =
params.get("id");

const user =
await getAuthUser();

if(!user){
return;
}

const {
data:existingVehicle
}
=
await supabase
.from("vehicles")
.select(`
title,
make,
model,
variant,
province,
city,
price,
original_price,
is_price_reduced,
reduction_count,
last_reduction_date
`)
.eq("id",vehicleId)
.single();

const currentPrice =
Number(
existingVehicle?.price || 0
);

const newPrice =
Number(
document.getElementById(
"vehicle_price"
)?.value || 0
);

const priceChanged =
newPrice !== currentPrice;

const priceReduced =
newPrice < currentPrice;

const originalPrice =
existingVehicle?.original_price ??
currentPrice;

const payload = {

title:
(
[
document.getElementById(
"vehicle_make"
)?.value,

document.getElementById(
"vehicle_model"
)?.value
]
.filter(Boolean)
.join(" ")
||
existingVehicle?.title
||
""
),

price:
parseFloat(
document.getElementById(
"vehicle_price"
)?.value
) || 0,

year:
Number(
document.getElementById(
"vehicle_year"
)?.value || 0
),

mileage:
Number(
document.getElementById(
"vehicle_mileage"
)?.value || 0
),

make:
document.getElementById(
"vehicle_make"
)?.value
?.trim()
||
existingVehicle?.make
||
"",

model:
document.getElementById(
"vehicle_model"
)?.value
||
existingVehicle?.model
||
"",

variant:
document.getElementById(
"vehicle_variant"
)?.value
||
existingVehicle?.variant
||
"",

province:
document.getElementById(
"vehicle_province"
)?.value
||
existingVehicle?.province
||
"",

city:
document.getElementById(
"vehicle_city"
)?.value
||
existingVehicle?.city
||
"",

location:
[
document.getElementById(
"vehicle_city"
)?.value,

document.getElementById(
"vehicle_province"
)?.value

]
.filter(Boolean)
.join(", "),

vehicle_category:
document.getElementById(
"vehicle_category"
)?.value || "",

motorcycle_type:
[
"Motorcycle",
"ATV",
"Quad Bike",
"Side-by-Side"
].includes(
document.getElementById(
"vehicle_category"
)?.value || ""
)
? document.getElementById(
"vehicle_motorcycle_type"
)?.value || ""
: "",

commercial_vehicle:
document.getElementById(
"vehicle_category"
)?.value === "Commercial Vehicle",

commercial_category:
document.getElementById(
"vehicle_category"
)?.value === "Commercial Vehicle"
? document.getElementById(
"vehicle_commercial_category"
)?.value || ""
: "",

cab_configuration:
document.getElementById(
"vehicle_category"
)?.value === "Commercial Vehicle"
? document.getElementById(
"vehicle_cab_configuration"
)?.value || ""
: "",

payload_capacity_kg:
document.getElementById(
"vehicle_category"
)?.value === "Commercial Vehicle"
? (
parseInt(
document.getElementById(
"vehicle_payload_capacity"
)?.value
) || null
)
: null,

towing_capacity_kg:
document.getElementById(
"vehicle_category"
)?.value === "Commercial Vehicle"
? (
parseInt(
document.getElementById(
"vehicle_towing_capacity"
)?.value
) || null
)
: null,

description:
document.getElementById(
"vehicle_description"
)?.value || "",

fuel_type:
document.getElementById(
"spec_fuel_type"
)?.value || "",

transmission:
document.getElementById(
"spec_transmission"
)?.value || "",

drive_type:
document.getElementById(
"spec_drive_type"
)?.value || "",

body_type:
document.getElementById(
"spec_body_type"
)?.value || "",

color:
document.getElementById(
"spec_color"
)?.value || "",

seats:
parseInt(
document.getElementById(
"spec_seats"
)?.value
) || null,

doors:
parseInt(
document.getElementById(
"spec_doors"
)?.value
) || null,

condition:
document.getElementById(
"spec_condition"
)?.value || "",

engine_capacity_cc:
parseInt(
document.getElementById(
"spec_engine_capacity_cc"
)?.value
) || null,

power_kw:
parseInt(
document.getElementById(
"spec_power_kw"
)?.value
) || null,

engine_size_l: manageVehicleOptionalNumber("spec_engine_size_l"),
torque_nm: manageVehicleOptionalNumber("spec_torque_nm"),
cylinders: manageVehicleOptionalNumber("spec_cylinders"),
turbocharged: document.getElementById("spec_turbocharged")?.checked === true,
fuel_consumption_l100: manageVehicleOptionalNumber("spec_fuel_consumption_l100"),
co2_emissions_gkm: manageVehicleOptionalNumber("spec_co2_emissions_gkm"),
electric_range_km: manageVehicleOptionalNumber("spec_electric_range_km"),
fast_charge: document.getElementById("spec_fast_charge")?.checked === true,

vin:
document.getElementById(
"spec_vin"
)?.value || "",

owners:
parseInt(
document.getElementById(
"vehicle_owners"
)?.value
) || null,

finance_available:
document.getElementById(
"vehicle_finance_available"
)?.value === "true",

price_negotiable:
document.getElementById(
"vehicle_price_negotiable"
)?.value === "true",

vat_included:
document.getElementById(
"vehicle_vat_included"
)?.value === "true",

status:
(
document.getElementById(
"vehicle_status"
)?.value
||
existingVehicle?.status
||
"active"
),

battery_capacity_kwh:
parseFloat(
(
document.getElementById(
"ev_battery_capacity"
)?.value || ""
).replace(/[^\d.]/g,"")
) || null,

battery_range_km:
parseFloat(
(
document.getElementById(
"ev_range"
)?.value || ""
).replace(/[^\d.]/g,"")
) || null,

charging_time_hours:
parseFloat(
(
document.getElementById(
"ev_charging_time"
)?.value || ""
).replace(/[^\d.]/g,"")
) || null,

is_electric:
document.getElementById(
"spec_fuel_type"
)?.value === "Electric",

is_hybrid:
[
"Hybrid",
"Plug-in Hybrid"
].includes(
document.getElementById(
"spec_fuel_type"
)?.value || ""
),

is_plugin_hybrid:
document.getElementById(
"spec_fuel_type"
)?.value === "Plug-in Hybrid",

vehicle_category:
document.getElementById(
"vehicle_category"
)?.value || "",

features:
[
...new Set(

Array.from(

document.querySelectorAll(
"#vehicle_features_container input[type='checkbox']:checked"
)

)

.map(
item=>String(item.value).trim()
)

.filter(Boolean)

)
],

original_price:
priceReduced
? originalPrice
: existingVehicle?.original_price,

previous_price:
priceChanged
? currentPrice
: existingVehicle?.previous_price,

price_reduction_amount:
priceReduced
? currentPrice - newPrice
: (
existingVehicle?.price_reduction_amount || 0
),

is_price_reduced:
priceReduced
? true
: existingVehicle?.is_price_reduced,

reduction_count:
priceReduced
? (
existingVehicle?.reduction_count || 0
) + 1
: (
existingVehicle?.reduction_count || 0
),

last_reduction_date:
priceReduced
? new Date().toISOString()
: existingVehicle?.last_reduction_date

};

const { error } =
await supabase
.from("vehicles")
.update(payload)
.eq("id",vehicleId)
.eq("seller_id",user.id);

if(error){

alert(error.message);
return;

}

/* PHASE 5 — the user's edits are now saved to the published
vehicle row, so the temporary edit draft for THIS user + vehicle
is no longer needed. Cleared immediately (and only) on success;
a failed update above keeps the draft intact. */
clearManageVehicleEditDraft(vehicleId);

const {
data:updatedVehicle,
error:refreshError
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",vehicleId)
.eq("seller_id",user.id)
.single();

if(refreshError){

alert(refreshError.message);
return;

}

renderOverview(updatedVehicle);
renderImageManager(updatedVehicle);
renderVehicleDetails(updatedVehicle);
renderVehicleLocation(updatedVehicle);
renderVehicleClassification(updatedVehicle);
renderVehicleHistory(updatedVehicle);
renderVehicleDescription(updatedVehicle);
renderVehicleSpecifications(updatedVehicle);
renderVehicleFeatures(updatedVehicle);

await initialiseManageVehicleSelectors(
updatedVehicle
);

await renderPerformance(updatedVehicle);
await renderEnquiries(updatedVehicle);
await renderFinanceApplications(updatedVehicle);
await renderVehicleNotes(updatedVehicle);

renderBottomActionBar(updatedVehicle);

alert(
"Vehicle updated successfully"
);

};

window.uploadVehicleImages =
async function(vehicleId){

const input =
document.getElementById(
"vehicleImageInput"
);

if(!input){
return;
}

input.click();

input.onchange =
async ()=>{

const files =
Array.from(
input.files || []
);

if(!files.length){
return;
}

const {
data:user
}
=
await supabase.auth.getUser();

if(!user?.user){
return;
}

const {
data:vehicle,
error:vehicleError
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",vehicleId)
.eq("seller_id",user.user.id)
.single();

if(vehicleError){

alert(vehicleError.message);
return;

}

const existingImages =
vehicle.images || [];

const uploadedUrls = [];

for(const file of files){

/* PHASE 1 — strict validation before upload.
   Only real JPG/PNG/WEBP images; ZIPs (even
   renamed ones) and documents are rejected. */

const validation =
await validateImageFile(file);

if(!validation.ok){

alert(validation.error);

continue;

}

const extension =
file.name.split(".").pop();

const fileName =
`${vehicleId}/${Date.now()}-${Math.random()
.toString(36)
.substring(2)}.${extension}`;

const {
error:uploadError
}
=
await supabase
.storage
.from("vehicle-images")
.upload(
fileName,
file
);

if(uploadError){

alert(uploadError.message);
continue;

}

const {
data:urlData
}
=
supabase
.storage
.from("vehicle-images")
.getPublicUrl(
fileName
);

uploadedUrls.push(
urlData.publicUrl
);

}

const updatedImages = [

...existingImages,
...uploadedUrls

];

const {
error:updateError
}
=
await supabase
.from("vehicles")
.update({

images:updatedImages,
image_url:
vehicle.image_url ||
updatedImages[0] ||
null

})
.eq("id",vehicleId)
.eq("seller_id",user.user.id);

if(updateError){

alert(updateError.message);
return;

}

const {
data:updatedVehicle,
error:refreshError
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",vehicleId)
.eq("seller_id",user.user.id)
.single();

if(refreshError){

alert(refreshError.message);
return;

}

renderOverview(updatedVehicle);
renderImageManager(updatedVehicle);
renderVehicleDetails(updatedVehicle);
renderVehicleLocation(updatedVehicle);
renderVehicleClassification(updatedVehicle);
renderVehicleHistory(updatedVehicle);
renderVehicleDescription(updatedVehicle);
renderVehicleSpecifications(updatedVehicle);
renderVehicleFeatures(updatedVehicle);

await initialiseManageVehicleSelectors(
updatedVehicle
);

await renderPerformance(updatedVehicle);
await renderEnquiries(updatedVehicle);
await renderFinanceApplications(updatedVehicle);
await renderVehicleNotes(updatedVehicle);

renderBottomActionBar(updatedVehicle);

};

};

window.setCoverImage =
async function(
vehicleId,
imageUrl
){

const {
data:user
}
=
await supabase.auth.getUser();

if(!user?.user){
return;
}

const {
data:vehicle,
error:loadError
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",vehicleId)
.eq("seller_id",user.user.id)
.single();

if(loadError){

alert(loadError.message);
return;

}

const images =
[...(vehicle.images || [])];

const filtered =
images.filter(
img => img !== imageUrl
);

filtered.unshift(imageUrl);

const {
error:updateError
}
=
await supabase
.from("vehicles")
.update({

images:filtered,
image_url:filtered[0] || null

})
.eq("id",vehicleId)
.eq("seller_id",user.user.id);

if(updateError){

alert(updateError.message);
return;

}

const {
data:updatedVehicle,
error:refreshError
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",vehicleId)
.eq("seller_id",user.user.id)
.single();

if(refreshError){

alert(refreshError.message);
return;

}

renderOverview(updatedVehicle);
renderImageManager(updatedVehicle);
renderVehicleDetails(updatedVehicle);
renderVehicleLocation(updatedVehicle);
renderVehicleClassification(updatedVehicle);
renderVehicleHistory(updatedVehicle);
renderVehicleDescription(updatedVehicle);
renderVehicleSpecifications(updatedVehicle);
renderVehicleFeatures(updatedVehicle);

await initialiseManageVehicleSelectors(
updatedVehicle
);

await renderPerformance(updatedVehicle);
await renderEnquiries(updatedVehicle);
await renderFinanceApplications(updatedVehicle);
await renderVehicleNotes(updatedVehicle);
await renderActivityTimeline(updatedVehicle);

renderPromotionControls(updatedVehicle);
renderDangerZone(updatedVehicle);

renderBottomActionBar(updatedVehicle);

};

window.replaceVehicleImage =
async function(
vehicleId,
imageUrl
){

const input =
document.getElementById(
"replaceVehicleImageInput"
);

if(!input){
return;
}

input.click();

input.onchange =
async ()=>{

const file =
input.files?.[0];

if(!file){
return;
}

/* PHASE 1 — strict validation before upload.
   Only real JPG/PNG/WEBP images; ZIPs (even
   renamed ones) and documents are rejected. */

const validation =
await validateImageFile(file);

if(!validation.ok){

alert(validation.error);

input.value = "";

return;

}

const {
data:user
}
=
await supabase.auth.getUser();

if(!user?.user){
return;
}

const {
data:vehicle
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",vehicleId)
.eq("seller_id",user.user.id)
.single();

const extension =
file.name.split(".").pop();

const fileName =
`${vehicleId}/${Date.now()}-${Math.random()
.toString(36)
.substring(2)}.${extension}`;

const {
error:uploadError
}
=
await supabase
.storage
.from("vehicle-images")
.upload(
fileName,
file
);

if(uploadError){

alert(uploadError.message);
return;

}

const {
data:urlData
}
=
supabase
.storage
.from("vehicle-images")
.getPublicUrl(
fileName
);

const images =
(vehicle.images || []).map(
img =>
img === imageUrl
? urlData.publicUrl
: img
);

const coverImage =
vehicle.image_url === imageUrl
? urlData.publicUrl
: vehicle.image_url;

const {
error:updateError
}
=
await supabase
.from("vehicles")
.update({

images,
image_url:coverImage

})
.eq("id",vehicleId)
.eq("seller_id",user.user.id);

if(updateError){

alert(updateError.message);
return;

}

const {
data:updatedVehicle
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",vehicleId)
.eq("seller_id",user.user.id)
.single();

renderOverview(updatedVehicle);
renderImageManager(updatedVehicle);
renderVehicleDetails(updatedVehicle);
renderVehicleLocation(updatedVehicle);
renderVehicleClassification(updatedVehicle);
renderVehicleHistory(updatedVehicle);
renderVehicleDescription(updatedVehicle);
renderVehicleSpecifications(updatedVehicle);
renderVehicleFeatures(updatedVehicle);

await initialiseManageVehicleSelectors(
updatedVehicle
);

await renderPerformance(updatedVehicle);
await renderEnquiries(updatedVehicle);
await renderFinanceApplications(updatedVehicle);
await renderVehicleNotes(updatedVehicle);
await renderActivityTimeline(updatedVehicle);

renderPromotionControls(updatedVehicle);
renderDangerZone(updatedVehicle);

renderBottomActionBar(updatedVehicle);

};

};

window.deleteVehicleImage =
async function(
vehicleId,
imageUrl
){

const confirmDelete =
confirm(
"Delete this image?"
);

if(!confirmDelete){
return;
}

const {
data:user
}
=
await supabase.auth.getUser();

if(!user?.user){
return;
}

const {
data:vehicle,
error:loadError
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",vehicleId)
.eq("seller_id",user.user.id)
.single();

if(loadError){

alert(loadError.message);
return;

}

const updatedImages =
(vehicle.images || [])
.filter(
img => img !== imageUrl
);

const newCover =
updatedImages[0] || null;

const {
error:updateError
}
=
await supabase
.from("vehicles")
.update({

images:updatedImages,
image_url:newCover

})
.eq("id",vehicleId)
.eq("seller_id",user.user.id);

if(updateError){

alert(updateError.message);
return;

}

const {
data:updatedVehicle,
error:refreshError
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",vehicleId)
.eq("seller_id",user.user.id)
.single();

if(refreshError){

alert(refreshError.message);
return;

}

renderOverview(updatedVehicle);
renderImageManager(updatedVehicle);
renderVehicleDetails(updatedVehicle);
renderVehicleLocation(updatedVehicle);
renderVehicleClassification(updatedVehicle);
renderVehicleHistory(updatedVehicle);
renderVehicleDescription(updatedVehicle);
renderVehicleSpecifications(updatedVehicle);
renderVehicleFeatures(updatedVehicle);

await initialiseManageVehicleSelectors(
updatedVehicle
);

await renderPerformance(updatedVehicle);
await renderEnquiries(updatedVehicle);
await renderFinanceApplications(updatedVehicle);
await renderVehicleNotes(updatedVehicle);
await renderActivityTimeline(updatedVehicle);

renderPromotionControls(updatedVehicle);
renderDangerZone(updatedVehicle);

renderBottomActionBar(updatedVehicle);

};

window.markVehicleSold =
async function(){

const confirmed =
confirm(
"Mark this vehicle as sold?"
);

if(!confirmed){
return;
}

const vehicleId =
new URLSearchParams(
window.location.search
).get("id");

const user =
await getAuthUser();

if(!user){
return;
}

const { error } =
await supabase
.from("vehicles")
.update({
status:"sold"
})
.eq("id",vehicleId)
.eq("seller_id",user.id);

if(error){

alert(error.message);
return;

}

location.reload();

};

window.archiveVehicle =
async function(){

const confirmed =
confirm(
"Archive this vehicle?"
);

if(!confirmed){
return;
}

const vehicleId =
new URLSearchParams(
window.location.search
).get("id");

const user =
await getAuthUser();

if(!user){
return;
}

const { error } =
await supabase
.from("vehicles")
.update({
status:"archived"
})
.eq("id",vehicleId)
.eq("seller_id",user.id);

if(error){

alert(error.message);
return;

}

location.reload();

};

window.activateVehicle =
async function(){

const vehicleId =
new URLSearchParams(
window.location.search
).get("id");

const user =
await getAuthUser();

if(!user){
return;
}

const { error } =
await supabase
.from("vehicles")
.update({
status:"active"
})
.eq("id",vehicleId)
.eq("seller_id",user.id);

if(error){

alert(error.message);
return;

}

location.reload();

};

window.updateEnquiryStatus =
async function(
enquiryId,
status
){

const { error } =
await supabase
.from("enquiries")
.update({
status
})
.eq(
"id",
enquiryId
);

if(error){

alert(error.message);
return;

}

};

window.updateFinanceStatus =
async function(
applicationId,
status
){

const { error } =
await supabase
.from("finance_applications")
.update({
status
})
.eq(
"id",
applicationId
);

if(error){

alert(error.message);
return;

}

};

window.addVehicleNote =
async function(
vehicleId
){

const input =
document.getElementById(
"vehicle_note_input"
);

if(!input){
return;
}

const note =
input.value.trim();

if(!note){
return;
}

const user =
await getAuthUser();

if(!user){
return;
}

const { error } =
await supabase
.from("vehicle_notes")
.insert({

vehicle_id:
vehicleId,

user_id:
user.id,

note

});

if(!error){

const {
error:activityError
}
=
await supabase
.from("vehicle_activity")
.insert({

vehicle_id:
vehicleId,

activity_type:
"note",

activity_text:
"Vehicle note added"

});

console.log(
"Activity Error:",
activityError
);

}

if(error){

alert(error.message);
return;

}

const params =
new URLSearchParams(
window.location.search
);

const currentVehicleId =
params.get("id");

const {
data:updatedVehicle,
error:reloadError
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",currentVehicleId)
.eq("seller_id",user.id)
.single();

if(reloadError){

alert(reloadError.message);
return;

}

renderOverview(updatedVehicle);
renderImageManager(updatedVehicle);
renderVehicleDetails(updatedVehicle);
renderVehicleLocation(updatedVehicle);
renderVehicleClassification(updatedVehicle);
renderVehicleHistory(updatedVehicle);
renderVehicleDescription(updatedVehicle);
renderVehicleSpecifications(updatedVehicle);
renderVehicleFeatures(updatedVehicle);

await initialiseManageVehicleSelectors(
updatedVehicle
);

await renderPerformance(updatedVehicle);
await renderEnquiries(updatedVehicle);
await renderFinanceApplications(updatedVehicle);
await renderVehicleNotes(updatedVehicle);

renderBottomActionBar(updatedVehicle);

};

window.moveVehicleImageLeft =
async function(
vehicleId,
imageUrl
){

const {
data:user
}
=
await supabase.auth.getUser();

if(!user?.user){
return;
}

const {
data:vehicle,
error:loadError
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",vehicleId)
.eq("seller_id",user.user.id)
.single();

if(loadError){

alert(loadError.message);
return;

}

const images =
[...(vehicle.images || [])];

const index =
images.indexOf(imageUrl);

if(
index === -1 ||
index <= 0
){
return;
}

[
images[index - 1],
images[index]
]
=
[
images[index],
images[index - 1]
];

const {
error:updateError
}
=
await supabase
.from("vehicles")
.update({

images,
image_url:images[0] || null

})
.eq("id",vehicleId)
.eq("seller_id",user.user.id);

if(updateError){

alert(updateError.message);
return;

}

const {
data:updatedVehicle,
error:refreshError
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",vehicleId)
.eq("seller_id",user.user.id)
.single();

if(refreshError){

alert(refreshError.message);
return;

}

renderOverview(updatedVehicle);
renderImageManager(updatedVehicle);
renderVehicleDetails(updatedVehicle);
renderVehicleLocation(updatedVehicle);
renderVehicleClassification(updatedVehicle);
renderVehicleHistory(updatedVehicle);
renderVehicleDescription(updatedVehicle);
renderVehicleSpecifications(updatedVehicle);
renderVehicleFeatures(updatedVehicle);

await initialiseManageVehicleSelectors(
updatedVehicle
);

await renderPerformance(updatedVehicle);
await renderEnquiries(updatedVehicle);
await renderFinanceApplications(updatedVehicle);
await renderVehicleNotes(updatedVehicle);
await renderActivityTimeline(updatedVehicle);

renderPromotionControls(updatedVehicle);
renderDangerZone(updatedVehicle);

renderBottomActionBar(updatedVehicle);

};

window.moveVehicleImageRight =
async function(
vehicleId,
imageUrl
){

const {
data:user
}
=
await supabase.auth.getUser();

if(!user?.user){
return;
}

const {
data:vehicle,
error:loadError
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",vehicleId)
.eq("seller_id",user.user.id)
.single();

if(loadError){

alert(loadError.message);
return;

}

const images =
[...(vehicle.images || [])];

const index =
images.indexOf(imageUrl);

if(
index === -1 ||
index >= images.length - 1
){
return;
}

[
images[index],
images[index + 1]
]
=
[
images[index + 1],
images[index]
];

const {
error:updateError
}
=
await supabase
.from("vehicles")
.update({

images,
image_url:images[0] || null

})
.eq("id",vehicleId)
.eq("seller_id",user.user.id);

if(updateError){

alert(updateError.message);
return;

}

const {
data:updatedVehicle,
error:refreshError
}
=
await supabase
.from("vehicles")
.select("*")
.eq("id",vehicleId)
.eq("seller_id",user.user.id)
.single();

if(refreshError){

alert(refreshError.message);
return;

}

renderOverview(updatedVehicle);
renderImageManager(updatedVehicle);
renderVehicleDetails(updatedVehicle);
renderVehicleLocation(updatedVehicle);
renderVehicleClassification(updatedVehicle);
renderVehicleHistory(updatedVehicle);
renderVehicleDescription(updatedVehicle);
renderVehicleSpecifications(updatedVehicle);
renderVehicleFeatures(updatedVehicle);

await initialiseManageVehicleSelectors(
updatedVehicle
);

await renderPerformance(updatedVehicle);
await renderEnquiries(updatedVehicle);
await renderFinanceApplications(updatedVehicle);
await renderVehicleNotes(updatedVehicle);
await renderActivityTimeline(updatedVehicle);

renderPromotionControls(updatedVehicle);
renderDangerZone(updatedVehicle);

renderBottomActionBar(updatedVehicle);

};

window.deleteVehicle =
async function(){

const confirmed =
confirm(
"This will permanently delete the vehicle. Continue?"
);

if(!confirmed){
return;
}

const vehicleId =
new URLSearchParams(
window.location.search
).get("id");

const user =
await getAuthUser();

if(!user){
return;
}

const { error } =
await supabase
.from("vehicles")
.delete()
.eq("id",vehicleId)
.eq("seller_id",user.id);

if(error){

alert(error.message);
return;

}

navigate("/dashboard");

};
