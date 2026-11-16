import {
  renderVehicleCard,
  renderVehicleCardSkeletons
} from "../components/vehicleCard.js";
import {
  supabase,
  getAuthUser
} from "../js/api.js";
import { navigate } from "../js/router.js";
import { asset } from "../js/basePath.js";
import {
  getGuestSaved,
  removeGuestSaved
} from "../js/guestStore.js";
import { renderViewToggle } from "../components/viewToggle.js";
import { getCardDetailLevel } from "../js/cardDetailPreference.js";
import { toast, getCompare, toggleCompare } from "../js/ui.js";

let currentViewMode = "grid";
let allSavedVehicles = [];
let searchQuery = "";
let sortOption = "newest-saved";
let savedFilters = createEmptySavedFilters();
let draftSavedFilters = createEmptySavedFilters();
const SAVED_IMAGE_FALLBACK = asset("/assets/hero-mobile.jpg");

const SAVED_SORT_OPTIONS = [
  {id:"newest-saved", label:"Newest Saved First"},
  {id:"oldest-saved", label:"Oldest Saved First"},
  {id:"price-low", label:"Price: Low to High"},
  {id:"price-high", label:"Price: High to Low"},
  {id:"year-new", label:"Newest Vehicle Year"},
  {id:"year-old", label:"Oldest Vehicle Year"},
  {id:"mileage-low", label:"Lowest Mileage"},
  {id:"mileage-high", label:"Highest Mileage"},
  {id:"make-az", label:"Make: A to Z"},
  {id:"make-za", label:"Make: Z to A"}
];

function createEmptySavedFilters(){
  return {make:"", body_type:"", fuel_type:"", transmission:"", location:"", minPrice:"", maxPrice:"", minYear:"", maxYear:""};
}

/* Preditive search seed state — no DOM requirements at module scope */
let suggestionActive = false;
let highlightedIndex = 0;
let suggestionDebounceTimer = null;
let suggestionPanelReady = false;
let suggestionLifecycle = 0;
let suggestionOutsideClickHandler = null;

/* DOM references (assigned during initialization) */
let savedFilterToolbar;
let savedSearchWrap;
let searchInput;
let suggestionBox;

export function SavedPage(){

setTimeout(() => {
  renderViewToggle("savedViewToggle", {
    persistentKey: "saved_view",
    onToggle: (mode) => {
      currentViewMode = mode;
      // Re-render filtered/sorted vehicles with new layout
      const box = document.getElementById("savedList");
      if(!box) return;
      box.innerHTML = "";
      // Switch between grid and list layout based on view mode
      if(currentViewMode === "list") {
        // List layout: stack vehicles vertically, each as a horizontal row
        box.classList.add("flex", "flex-col", "gap-3");
        box.classList.remove("saved-grid", "grid", "grid-cols-1", "sm:grid-cols-2", "md:grid-cols-3", "lg:grid-cols-4", "xl:grid-cols-5", "items-stretch");
      } else {
        // Grid layout: responsive grid of cards
        box.classList.add("saved-grid", "grid", "grid-cols-2", "sm:grid-cols-2", "md:grid-cols-3", "lg:grid-cols-4", "xl:grid-cols-5", "gap-3", "items-stretch");
        box.classList.remove("flex", "flex-col", "gap-3", "saved-list");
      }
      render(filterAndSort());
    }
  });
  loadSaved();
}, 0);

return `

<div class="
saved-page
min-h-screen
overflow-x-hidden
">

  <div class="
  max-w-[1240px]
  mx-auto
  px-4
  sm:px-6
  xl:px-8
  pt-8
  md:pt-10
  pb-10
  md:pb-12
  ">

    <!-- One saved count, paired with the page heading. -->
    <div class="saved-page-heading mb-5">
      <div>
        <h1 class="saved-page-title text-[#081120] font-black tracking-[-0.03em] leading-[1.05] text-[clamp(1.35rem,3.2vw,1.7rem)]">Saved Vehicles</h1>
        <p class="mt-2 text-slate-500 text-[12px] sm:text-[12.5px] leading-relaxed max-w-[430px]">Keep the vehicles you're interested in one place and compare your favourites before making a decision.</p>
      </div>
      <div id="savedSummary" class="saved-summary hidden items-center gap-2">
        <div class="saved-summary-icon" aria-hidden="true"><svg style="width:18px;height:18px" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z" /></svg></div>
        <div class="flex items-baseline gap-1.5"><span id="savedCount" class="saved-summary-count">0</span><span class="saved-summary-label">saved</span></div>
      </div>
    </div>

<!-- ==============================
     SEARCH + SORT TOOLBAR
     ============================== -->
    <section id="savedFilterToolbar" class="compare-tools saved-tools-panel" aria-label="Search and sort saved vehicles">
        <div class="compare-search-wrap saved-search-wrap">
          <div class="compare-search-input-wrap">
            <svg class="compare-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
          <input
            id="savedSearchInput"
            type="search"
            placeholder="Make, model, year, price, location..."
            autocomplete="off"
            aria-label="Search your saved vehicles"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="false"
            aria-controls="savedSuggestionBox"
            class="compare-search-input saved-search-input"
          />
          <button
            id="savedClearSearch"
            type="button"
            class="saved-search-clear hidden"
            aria-label="Clear search"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
          </div>
        </div>

        <div class="compare-sort-wrap saved-sort-wrap">
          <label class="compare-control-label" for="savedSortSelect">Sort saved vehicles</label>
          <select
            id="savedSortSelect"
            aria-label="Sort saved vehicles"
            class="compare-sort-select saved-sort-select"
          >
          </select>
          <span class="saved-sort-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 10 5 5 5-5"/></svg></span>
        </div>
    </section>
    <div class="saved-results-toolbar">
      <div class="saved-filterbar">
        <button id="savedFilterButton" type="button" class="saved-filter-trigger" aria-expanded="false" aria-controls="savedFilterPanel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>
          <span>Filters</span><span id="savedActiveFilterCount" class="saved-filter-count hidden">0</span>
          <svg class="saved-filter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>
        </button>
        <div id="savedFilterBackdrop" class="saved-filter-backdrop hidden" aria-hidden="true"></div>
        <section id="savedFilterPanel" class="saved-filter-panel hidden" aria-labelledby="savedFilterHeading">
          <header class="saved-filter-panel-header"><h2 id="savedFilterHeading">Filter Saved Vehicles</h2><button id="savedFilterClose" class="saved-filter-close" type="button" aria-label="Close filters">&times;</button></header>
          <div class="saved-filter-grid">
            <fieldset class="saved-filter-group saved-filter-vehicle"><legend>Vehicle filters</legend>
              <label>Make<select id="savedFilterMake" data-saved-filter="make"><option value="">All makes</option></select></label>
              <label>Body type<select id="savedFilterBody" data-saved-filter="body_type"><option value="">All body types</option></select></label>
              <label>Fuel type<select id="savedFilterFuel" data-saved-filter="fuel_type"><option value="">All fuel types</option></select></label>
              <label>Transmission<select id="savedFilterTransmission" data-saved-filter="transmission"><option value="">All transmissions</option></select></label>
            </fieldset>
            <fieldset class="saved-filter-group saved-filter-price-year"><legend>Price and year</legend>
              <label>Minimum price<input id="savedMinPrice" type="number" min="0" inputmode="numeric" placeholder="No minimum"></label>
              <label>Maximum price<input id="savedMaxPrice" type="number" min="0" inputmode="numeric" placeholder="No maximum"></label>
              <label>Year from<input id="savedMinYear" type="number" min="1900" max="2100" inputmode="numeric" placeholder="Any year"></label>
              <label>Year to<input id="savedMaxYear" type="number" min="1900" max="2100" inputmode="numeric" placeholder="Any year"></label>
            </fieldset>
            <fieldset class="saved-filter-group saved-filter-location"><legend>Location</legend><label>Location<select id="savedFilterLocation" data-saved-filter="location"><option value="">All locations</option></select></label></fieldset>
          </div>
          <footer class="saved-filter-panel-actions"><button id="savedFilterReset" type="button" class="saved-filter-reset">Reset</button><button id="savedFilterApply" type="button" class="saved-filter-apply"><span class="saved-filter-apply-desktop">Apply Filters</span><span class="saved-filter-apply-mobile">Show <span id="savedFilterMatchCount">0</span> Saved Vehicles</span></button></footer>
        </section>
      </div>
      <div id="savedViewToggle" class="flex items-center gap-2"></div>
    </div>
    <div id="savedActiveChips" class="saved-active-chips hidden" aria-live="polite"></div>

    <!-- ==============================
    SAVED VEHICLE CARDS
    ============================== -->
    <div
      id="savedList"
      class="
      saved-grid
      grid
      grid-cols-2
      sm:grid-cols-2
      md:grid-cols-3
      lg:grid-cols-4
      xl:grid-cols-5
      gap-3
      md:gap-4
      items-stretch
      "
    >

      <!-- Initial skeleton state: shown immediately on first paint so the
           page never displays an empty area before the saved vehicles load.
           loadSaved() replaces this with real vehicle cards, the existing
           empty state, or the existing error state. -->
      ${renderVehicleCardSkeletons(6)}

    </div>

  </div>

</div>

`;
}

/* ========================================= */

async function loadSaved(){

try{

const user =
await getAuthUser();

/* =========================================
   GUEST — resolve the visitor's OWN locally
   saved vehicles (max 2). Never reads another
   user's records and never touches the
   saved_vehicles table.
========================================= */

if(!user){

const guestIds = getGuestSaved();

if(!guestIds.length){

showEmptyState();
return;

}

await renderVehicles(guestIds, []);

return;

}

/* =========================================
   GET SAVED IDS
========================================= */

const {
data:saved,
error:savedError
} =
await supabase
.from("saved_vehicles")
.select("*")
.eq("user_id", user.id);

if(savedError){

console.error(
"Saved fetch error:",
savedError
);

showError(
"Error loading saved vehicles"
);

return;

}

if(!saved || !saved.length){

showEmptyState();
return;

}

/* =========================================
   VEHICLE IDS
========================================= */

const ids =
(saved || [])
.map((s)=>s.vehicle_id)
.filter(Boolean);

if(!ids.length){

showEmptyState();
return;

}

await renderVehicles(ids, saved);

}catch(err){

console.error(
"loadSaved error:",
err
);

showError(
"Unexpected error loading saved vehicles"
);

}

}

/* =========================================
   RESOLVE VEHICLES FROM IDS
   Shared by the guest and authenticated paths —
   both use the existing HUFA vehicle retrieval.
========================================= */

async function renderVehicles(ids, savedRows = []){

if(!Array.isArray(ids) || !ids.length){

showEmptyState();
return;

}

const {
data:vehicles,
error:vehicleError
} =
await supabase
.from("vehicles")
.select("*")
.in("id", ids);

if(vehicleError){

console.error(
"Vehicle fetch error:",
vehicleError
);

showError(
"Error loading vehicles"
);

return;

}

const vehicleById = new Map((Array.isArray(vehicles) ? vehicles : []).map((vehicle)=>[String(vehicle.id), vehicle]));
const savedAtById = new Map((Array.isArray(savedRows) ? savedRows : []).map((row)=>[
  String(row.vehicle_id),
  row.saved_at || row.created_at || null
]));

/* Keep only records reached through this user's saved IDs and carry saved-row
   timestamps/order as transient UI metadata; nothing is written back. */
allSavedVehicles = ids.map((id, index)=>{
  const vehicle = vehicleById.get(String(id));
  if(!vehicle) return null;
  return {
    ...vehicle,
    __savedAt: savedAtById.get(String(id)) || null,
    __savedOrder: index
  };
}).filter(Boolean);

    /* Initialize search + sort controls once vehicles are loaded */
    populateSortDropdown();
    initSavedFilterControls();

    /* Initialize suggestions after vehicle data is available */
    initSavedSearchSuggestions();

    /* Apply default sort + any existing search query */
    renderFiltered();


}

/* ========================================= */

function render(list = []){

const box =
document.getElementById("savedList");

if(
!box ||
!document.body.contains(box)
){
return;
}

box.innerHTML = "";
const safeList = Array.isArray(list) ? list : [];
const totalCount = allSavedVehicles.length;

const summary =
document.getElementById("savedSummary");

  if(summary && totalCount){
summary.classList.remove("hidden");
summary.classList.add("flex");
}else if(summary){
summary.classList.add("hidden");
summary.classList.remove("flex");
}

const countEl =
document.getElementById("savedCount");

if(countEl){
countEl.textContent = String(totalCount);
}

updateSavedFilterControls();

if(!safeList.length){
  showEmptyState(totalCount > 0 ? "no-matches" : "no-saves");
  return;
}

(safeList || []).forEach((v)=>{

  box.insertAdjacentHTML("beforeend", renderVehicleCard(v, {
    actions: renderSavedCardActions,
    layout: currentViewMode,
    detailLevel: getCardDetailLevel(),
    imageFallback: SAVED_IMAGE_FALLBACK
  }));

});

bindSavedCompareActions();
}

/* =========================================
   SEARCH + SORT LOGIC
   Operates on allSavedVehicles (the original
   collection) without modifying it.
========================================= */

/* Normalise text for case-insensitive, spacing-tolerant matching */
function normalizeSaved(text){
  return String(text || "")
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* Check if a vehicle matches the current search query across all searchable fields */
function vehicleMatchesSearch(v, query){
  if(!query) return true;

  const tokens = normalizeSaved(query).split(" ").filter(Boolean).map((token)=>/^r\d/.test(token) ? token.slice(1) : token);

  const fields = [
    v.make,
    v.model,
    v.variant,
    v.year,
    v.price,
    v.mileage,
    v.fuel_type,
    v.body_type,
    v.transmission,
    v.province,
    v.city,
    v.location
  ].filter((field)=>field !== null && field !== undefined).map(normalizeSaved).join(" ");

  return tokens.every((token)=>fields.includes(token) || fields.includes(token.replace(/\s+/g,"")) || fields.split(" ").some((field)=>field.includes(token)));
}

function savedNumeric(value){
  if(value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function compareSavedNumeric(a, b, direction){
  const left = savedNumeric(a);
  const right = savedNumeric(b);
  if(left === null && right === null) return 0;
  if(left === null) return 1;
  if(right === null) return -1;
  return (left - right) * direction;
}

function savedTimestamp(vehicle){
  const value = vehicle.__savedAt;
  if(!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function compareSavedVehicles(a, b, mode){
  if(mode === "newest-saved" || mode === "oldest-saved"){
    const aTime = savedTimestamp(a);
    const bTime = savedTimestamp(b);
    if(aTime !== null || bTime !== null){
      if(aTime === null) return 1;
      if(bTime === null) return -1;
      const difference = mode === "newest-saved" ? bTime - aTime : aTime - bTime;
      if(difference) return difference;
    }
    return mode === "newest-saved" ? (b.__savedOrder ?? 0) - (a.__savedOrder ?? 0) : (a.__savedOrder ?? 0) - (b.__savedOrder ?? 0);
  }
  if(mode === "price-low") return compareSavedNumeric(a.price,b.price,1);
  if(mode === "price-high") return compareSavedNumeric(a.price,b.price,-1);
  if(mode === "year-new") return compareSavedNumeric(a.year,b.year,-1);
  if(mode === "year-old") return compareSavedNumeric(a.year,b.year,1);
  if(mode === "mileage-low") return compareSavedNumeric(a.mileage,b.mileage,1);
  if(mode === "mileage-high") return compareSavedNumeric(a.mileage,b.mileage,-1);
  if(mode === "make-az" || mode === "make-za"){
    const left = normalizeSaved(a.make);
    const right = normalizeSaved(b.make);
    if(!left && right) return 1;
    if(left && !right) return -1;
    const order = left.localeCompare(right, undefined, {sensitivity:"base"});
    return mode === "make-za" ? -order : order;
  }
  return 0;
}

function savedFilterValue(vehicle, key){
  if(key === "location") return vehicle.city || vehicle.location || vehicle.province || "";
  return vehicle[key] ?? "";
}

function vehicleMatchesSavedFilters(vehicle, filters = savedFilters){
  for(const key of ["make", "body_type", "fuel_type", "transmission", "location"]){
    const wanted = normalizeSaved(filters[key]);
    if(wanted && normalizeSaved(savedFilterValue(vehicle,key)) !== wanted) return false;
  }
  for(const [key, field, direction] of [
    ["minPrice", "price", "min"], ["maxPrice", "price", "max"],
    ["minYear", "year", "min"], ["maxYear", "year", "max"]
  ]){
    if(filters[key] === "") continue;
    const actual = savedNumeric(vehicle[field]);
    const bound = savedNumeric(filters[key]);
    if(actual === null || bound === null || (direction === "min" ? actual < bound : actual > bound)) return false;
  }
  return true;
}

/* Apply search then sort to a copy of the original collection.
   Returns a new array; does not mutate allSavedVehicles. */
function filterAndSort(){
  return allSavedVehicles
    .filter((vehicle)=>vehicleMatchesSearch(vehicle, searchQuery) && vehicleMatchesSavedFilters(vehicle))
    .sort((a,b)=>compareSavedVehicles(a,b,sortOption));
}

/* Render the current search+sort result set. */
function renderFiltered(){
  const result = filterAndSort();
  render(result);
}

/* Populate the sort dropdown with options from the shared registry. */
function populateSortDropdown(){
  const select = document.getElementById("savedSortSelect");
  if(!select) return;

  select.innerHTML = "";
  SAVED_SORT_OPTIONS.forEach((opt)=>{
    const option = document.createElement("option");
    option.value = opt.id;
    option.textContent = opt.label;
    select.appendChild(option);
  });

  select.value = sortOption;
}

function populateSavedFilterOptions(){
  const optionSets = [
    ["savedFilterMake","make","All makes"],
    ["savedFilterBody","body_type","All body types"],
    ["savedFilterFuel","fuel_type","All fuel types"],
    ["savedFilterTransmission","transmission","All transmissions"],
    ["savedFilterLocation","location","All locations"]
  ];
  for(const [id,key,placeholder] of optionSets){
    const select = document.getElementById(id);
    if(!select) continue;
    const current = draftSavedFilters[key] || "";
    const values = [...new Set(allSavedVehicles.map((vehicle)=>String(savedFilterValue(vehicle,key)).trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
    select.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = placeholder;
    select.appendChild(allOption);
    for(const value of values){
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
    select.value = values.includes(current) ? current : "";
    draftSavedFilters[key] = select.value;
    if(!values.includes(savedFilters[key] || "")) savedFilters[key] = "";
  }
  for(const [id,key] of [["savedMinPrice","minPrice"],["savedMaxPrice","maxPrice"],["savedMinYear","minYear"],["savedMaxYear","maxYear"]]){
    const input = document.getElementById(id);
    if(input) input.value = draftSavedFilters[key] || "";
  }
}

function updateSavedFilterControls(){
  const activeCount = Object.values(savedFilters).filter(Boolean).length;
  const count = document.getElementById("savedActiveFilterCount");
  if(count){
    count.textContent = String(activeCount);
    count.classList.toggle("hidden", activeCount === 0);
  }
  renderSavedFilterChips();
  updateSavedFilterMatchCount();
}

function updateSavedFilterMatchCount(){
  const count = document.getElementById("savedFilterMatchCount");
  if(!count) return;
  const matching = allSavedVehicles.filter((vehicle)=>vehicleMatchesSearch(vehicle, searchQuery) && vehicleMatchesSavedFilters(vehicle, draftSavedFilters)).length;
  count.textContent = String(matching);
}

function savedFilterChips(){
  const labels = {
    make: (value)=>value,
    body_type: (value)=>value,
    fuel_type: (value)=>value,
    transmission: (value)=>value,
    location: (value)=>value,
    minPrice: (value)=>`From R${Number(value).toLocaleString("en-ZA")}`,
    maxPrice: (value)=>`Up to R${Number(value).toLocaleString("en-ZA")}`,
    minYear: (value)=>`${value}+`,
    maxYear: (value)=>`Up to ${value}`
  };
  return Object.entries(savedFilters).filter(([,value])=>Boolean(value)).map(([key,value])=>({key,label:labels[key](value)}));
}

function renderSavedFilterChips(){
  const container = document.getElementById("savedActiveChips");
  if(!container) return;
  container.replaceChildren();
  const chips = savedFilterChips();
  container.classList.toggle("hidden", chips.length === 0);
  for(const chip of chips){
    const button = document.createElement("button");
    button.type = "button";
    button.className = "saved-filter-chip";
    button.dataset.removeSavedFilter = chip.key;
    button.setAttribute("aria-label", `Remove filter ${chip.label}`);
    const label = document.createElement("span");
    label.textContent = chip.label;
    const close = document.createElement("span");
    close.setAttribute("aria-hidden", "true");
    close.textContent = String.fromCharCode(215);
    button.append(label, close);
    container.appendChild(button);
  }
  if(chips.length){
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "saved-filter-clear-all";
    clear.textContent = "Clear All";
    clear.addEventListener("click", clearSavedFilters, {once:true});
    container.appendChild(clear);
  }
}

function writeFilterStateToControls(filters){
  for(const [id,key] of [["savedFilterMake","make"],["savedFilterBody","body_type"],["savedFilterFuel","fuel_type"],["savedFilterTransmission","transmission"],["savedFilterLocation","location"],["savedMinPrice","minPrice"],["savedMaxPrice","maxPrice"],["savedMinYear","minYear"],["savedMaxYear","maxYear"]]){
    const input = document.getElementById(id);
    if(input) input.value = filters[key] || "";
  }
}

function openSavedFilters(){
  const panel = document.getElementById("savedFilterPanel");
  const backdrop = document.getElementById("savedFilterBackdrop");
  if(!panel || !backdrop) return;
  draftSavedFilters = {...savedFilters};
  writeFilterStateToControls(draftSavedFilters);
  updateSavedFilterMatchCount();
  panel.classList.remove("hidden");
  backdrop.classList.remove("hidden");
  document.getElementById("savedFilterButton")?.setAttribute("aria-expanded","true");
  if(window.matchMedia("(max-width: 767px)").matches){
    document.body.classList.add("saved-filter-open");
    panel.setAttribute("role","dialog");
    panel.setAttribute("aria-modal","true");
    document.getElementById("savedFilterClose")?.focus();
  }else{
    panel.removeAttribute("role");
    panel.removeAttribute("aria-modal");
  }
}

function closeSavedFilters(apply = false){
  const panel = document.getElementById("savedFilterPanel");
  const backdrop = document.getElementById("savedFilterBackdrop");
  if(apply){
    savedFilters = {...draftSavedFilters};
    renderFiltered();
  }else{
    draftSavedFilters = {...savedFilters};
    writeFilterStateToControls(draftSavedFilters);
    updateSavedFilterControls();
  }
  panel?.classList.add("hidden");
  backdrop?.classList.add("hidden");
  document.body.classList.remove("saved-filter-open");
  document.getElementById("savedFilterButton")?.setAttribute("aria-expanded","false");
  panel?.removeAttribute("aria-modal");
  panel?.removeAttribute("role");
  document.getElementById("savedFilterButton")?.focus();
}

/* Wire up search input and sort dropdown event listeners. */
function initSavedFilterControls(){
  const searchInput = document.getElementById("savedSearchInput");
  const clearBtn = document.getElementById("savedClearSearch");
  const sortSelect = document.getElementById("savedSortSelect");
  const filterSelects = Array.from(document.querySelectorAll("[data-saved-filter]"));

  draftSavedFilters = {...savedFilters};
  populateSavedFilterOptions();
  if(searchInput){
    searchInput.value = searchQuery;
    clearBtn?.classList.toggle("hidden", !searchQuery);
  }

  if(searchInput && searchInput.dataset.savedSearchBound !== "true"){
    searchInput.dataset.savedSearchBound = "true";
    searchInput.addEventListener("input", (e)=>{
      searchQuery = e.target.value || "";

      const clearBtnEl = document.getElementById("savedClearSearch");
      if(clearBtnEl){
        if(searchQuery){
          clearBtnEl.classList.remove("hidden");
        } else {
          clearBtnEl.classList.add("hidden");
        }
      }

      renderFiltered();
    });
  }

  if(clearBtn && clearBtn.dataset.savedSearchBound !== "true"){
    clearBtn.dataset.savedSearchBound = "true";
    clearBtn.addEventListener("click", ()=>{
      const inputEl = document.getElementById("savedSearchInput");
      if(inputEl){
        inputEl.value = "";
      }
      searchQuery = "";
      clearBtn.classList.add("hidden");
      hideSavedSuggestionPanel();
      renderFiltered();
    });
  }

  if(sortSelect && sortSelect.dataset.savedSortBound !== "true"){
    sortSelect.dataset.savedSortBound = "true";
    sortSelect.addEventListener("change", (e)=>{
      sortOption = e.target.value || "newest-saved";
      renderFiltered();
    });
  }

  for(const select of filterSelects){
    if(select.dataset.savedFilterBound === "true") continue;
    select.dataset.savedFilterBound = "true";
    select.addEventListener("change", ()=>{
      draftSavedFilters[select.dataset.savedFilter] = select.value;
      updateSavedFilterMatchCount();
    });
  }
  for(const [id,key] of [["savedMinPrice","minPrice"],["savedMaxPrice","maxPrice"],["savedMinYear","minYear"],["savedMaxYear","maxYear"]]){
    const input = document.getElementById(id);
    if(!input || input.dataset.savedFilterBound === "true") continue;
    input.dataset.savedFilterBound = "true";
    input.addEventListener("input", ()=>{
      draftSavedFilters[key] = input.value;
      updateSavedFilterMatchCount();
    });
  }
  bindSavedFilterPanelActions();
  updateSavedFilterControls();
}

function bindSavedFilterPanelActions(){
  const button = document.getElementById("savedFilterButton");
  if(button && button.dataset.savedFilterBound !== "true"){
    button.dataset.savedFilterBound = "true";
    button.addEventListener("click", ()=>{
      const panel = document.getElementById("savedFilterPanel");
      panel?.classList.contains("hidden") ? openSavedFilters() : closeSavedFilters(false);
    });
  }
  const apply = document.getElementById("savedFilterApply");
  if(apply && apply.dataset.savedFilterBound !== "true"){
    apply.dataset.savedFilterBound = "true";
    apply.addEventListener("click", ()=>closeSavedFilters(true));
  }
  const reset = document.getElementById("savedFilterReset");
  if(reset && reset.dataset.savedFilterBound !== "true"){
    reset.dataset.savedFilterBound = "true";
    reset.addEventListener("click", clearSavedFilters);
  }
  for(const [id,eventName] of [["savedFilterClose","click"],["savedFilterBackdrop","click"]]){
    const element = document.getElementById(id);
    if(!element || element.dataset.savedFilterBound === "true") continue;
    element.dataset.savedFilterBound = "true";
    element.addEventListener(eventName, ()=>closeSavedFilters(false));
  }
  const chips = document.getElementById("savedActiveChips");
  if(chips && chips.dataset.savedFilterBound !== "true"){
    chips.dataset.savedFilterBound = "true";
    chips.addEventListener("click", (event)=>{
      const chip = event.target.closest("[data-remove-saved-filter]");
      if(!chip) return;
      const key = chip.dataset.removeSavedFilter;
      savedFilters[key] = "";
      draftSavedFilters[key] = "";
      writeFilterStateToControls(draftSavedFilters);
      updateSavedFilterControls();
      renderFiltered();
    });
  }
  if(document.documentElement.dataset.savedFilterEscapeBound !== "true"){
    document.documentElement.dataset.savedFilterEscapeBound = "true";
    document.addEventListener("keydown", (event)=>{
      if(event.key === "Escape" && !document.getElementById("savedFilterPanel")?.classList.contains("hidden")) closeSavedFilters(false);
    });
  }
}

function clearSavedFilters(){
  savedFilters = createEmptySavedFilters();
  draftSavedFilters = createEmptySavedFilters();
  populateSavedFilterOptions();
  updateSavedFilterControls();
  renderFiltered();
  if(window.matchMedia("(max-width: 767px)").matches) closeSavedFilters(true);
}

function escapeSavedAttribute(value){
  return String(value ?? "").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}

function renderSavedCardActions(vehicle){
  const id = escapeSavedAttribute(vehicle.id);
  const compare = `<button type="button" data-saved-compare="${id}" class="saved-card-compare-btn" aria-label="Add ${escapeSavedAttribute([vehicle.make,vehicle.model].filter(Boolean).join(" "))} to comparison">Compare</button>`;
  const remove = `<button type="button" onclick="event.stopPropagation(); removeSaved('${id}')" class="saved-card-remove-btn">Remove</button>`;
  const view = currentViewMode === "list" ? `<button type="button" onclick="event.stopPropagation(); viewVehicle('${id}')" class="saved-card-view-btn">View Vehicle</button>` : "";
  return `<div class="saved-card-actions${currentViewMode === "list" ? " saved-list-actions" : ""}">${compare}${remove}${view}</div>`;
}

function bindSavedCompareActions(){
  const box = document.getElementById("savedList");
  if(!box || box.dataset.compareActionBound === "true") return;
  box.dataset.compareActionBound = "true";
  box.addEventListener("click", (event)=>{
    const button = event.target.closest("[data-saved-compare]");
    if(!button) return;
    event.preventDefault();
    event.stopPropagation();
    addSavedToCompare(button.getAttribute("data-saved-compare"));
  });
}

function addSavedToCompare(vehicleId){
  if(!vehicleId) return;
  if(getCompare().some((id)=>String(id) === String(vehicleId))){
    toast("That vehicle is already in your comparison.");
    return;
  }
  if(toggleCompare(vehicleId)) navigate("/compare");
}

window.addSavedToCompare = addSavedToCompare;

function showEmptyState(reason = "no-saves"){

const box =
document.getElementById("savedList");

if(!box) return;

/* Keep the saved total visible when a search or filter has no matches. */
const summary =
document.getElementById("savedSummary");

if(summary){
  const hasSaved = allSavedVehicles.length > 0;
  summary.classList.toggle("hidden", !hasSaved);
  summary.classList.toggle("flex", hasSaved);
}

box.innerHTML = `

<div class="
saved-empty
col-span-full
rounded-[16px]
border
border-dashed
border-slate-200
bg-white
px-5
py-10
md:py-12
text-center
shadow-sm
">

  <div class="
  saved-empty-icon
  w-12
  h-12
  mx-auto
  rounded-[14px]
  flex
  items-center
  justify-center
  mb-4
  ">
    <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z" />
    </svg>
  </div>

  <h2 class="
  text-[#081120]
  text-[18px]
  font-black
  tracking-[-0.02em]
  mb-1.5
  ">
    ${reason === "no-matches" ? "No matching vehicles" : "No saved vehicles yet"}
  </h2>

  <p class="
  text-[#64748B]
  text-[12.5px]
  leading-relaxed
  max-w-sm
  mx-auto
  ">
    ${reason === "no-matches" ? "Try adjusting your search or sorting." : "Vehicles you save will appear here so you can easily return to them later."}
  </p>

  <button
    onclick="navigate('/browse')"
    class="
    saved-browse-btn
    mt-5
    h-11
    rounded-[10px]
    bg-[#005BBF]
    hover:bg-[#004FA8]
    text-white
    px-5
    font-semibold
    text-[13px]
    shadow-[0_10px_25px_rgba(10,25,47,0.16)]
    transition-all
    duration-300
    hover:-translate-y-[1px]
    hover:shadow-[0_16px_40px_rgba(10,25,47,0.22)]
    touch-manipulation
    "
  >
    Browse Vehicles
  </button>

</div>

`;

}

/* ========================================= */

function showError(message){

const box =
document.getElementById("savedList");

if(!box) return;

box.innerHTML = `

<div class="
col-span-full
rounded-[20px]
border
border-red-500/20
bg-red-500/5
text-red-400
p-8
text-center
">

${message}

</div>

`;

}

/* ========================================= */

window.removeSaved = async function(id){

try{

const user =
await getAuthUser();

/* GUEST — remove the visitor's own local save. */
if(!user){

removeGuestSaved(id);

await loadSaved();

return;

}

const { error } =
await supabase
.from("saved_vehicles")
.delete()
.eq("vehicle_id", id)
.eq("user_id", user.id);

if(error){

console.error(
"Remove saved error:",
error
);

return;

}

await loadSaved();

}catch(err){

console.error(
"removeSaved error:",
err
);

}

};

/* PREDICTIVE SEARCH — SUGGESTION LOGIC */

/* Initialize the suggestion panel after the page markup and vehicle
 * data have been loaded. Called once (idempotent). */
function initSavedSearchSuggestions() {
  if (suggestionPanelReady && savedFilterToolbar && document.body.contains(savedFilterToolbar)) return;
  suggestionPanelReady = false;
  if(suggestionOutsideClickHandler){
    document.removeEventListener("click", suggestionOutsideClickHandler);
    suggestionOutsideClickHandler = null;
  }

  /* Retrieve required DOM elements during initialization, not at import. */
  savedFilterToolbar = document.getElementById("savedFilterToolbar");
  searchInput = document.getElementById("savedSearchInput");
  savedSearchWrap = searchInput?.closest(".saved-search-wrap");
  if (!savedFilterToolbar || !searchInput || !savedSearchWrap) {
    return;
  }
  const lifecycle = ++suggestionLifecycle;
  suggestionPanelReady = true;

  /* Create suggestion panel (hidden by default). */
  suggestionBox = document.createElement("div");
  suggestionBox.id = "savedSuggestionBox";
  suggestionBox.className = "saved-search-suggestions hidden";
  suggestionBox.setAttribute("role","listbox");
  suggestionBox.setAttribute("aria-label","Saved vehicle suggestions");
  const suggestionList = document.createElement("div");
  suggestionList.id = "savedSuggestionList";
  suggestionBox.appendChild(suggestionList);

  /* Keep the popup inside the search wrapper so its CSS anchor is the input. */
  savedSearchWrap.appendChild(suggestionBox);

  suggestionBox.addEventListener("click", (event)=>{
    const item = event.target.closest("[data-suggest-index]");
    if(!item) return;
    event.preventDefault();
    applySuggestion(item.dataset.suggestValue);
  });

  /* Wire up search input events. */
  searchInput.addEventListener("input", function(e) {
    const val = e.target.value;
    searchQuery = val;

    if (val.length < 1) {
      hideSavedSuggestionPanel();
      return;
    }

    clearTimeout(suggestionDebounceTimer);

    suggestionDebounceTimer = setTimeout(() => {
      if(lifecycle !== suggestionLifecycle || !savedSearchWrap?.isConnected) return;
      showSuggestions(val);
    }, 150);
  });

  searchInput.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
      hideSavedSuggestionPanel();
      searchInput.blur();
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!suggestionActive) {
        showSuggestionPanel();
        suggestionActive = true;
        highlightSuggestion(0);
      } else {
        const items = suggestionBox.querySelectorAll("[data-suggest-index]");
        if (items.length === 0) return;
        const current = parseInt(items[highlightedIndex]?.dataset.suggestIndex || "0");
        const next = e.key === "ArrowDown" ? Math.min(current + 1, items.length - 1) : Math.max(current - 1, 0);
        highlightSuggestion(next);
      }
    }

    if (e.key === "Enter") {
      if (suggestionActive) {
        const item = suggestionBox.querySelector("[data-suggest-index='" + highlightedIndex + "']");
        if (item) {
          applySuggestion(item.dataset.suggestValue);
        } else {
          submitSearch();
        }
      } else {
        submitSearch();
      }
    }
  });

  /* Close suggestion panel on outside click. */
  suggestionOutsideClickHandler = function handleClickOutside(e) {
    const target = e.target;
    if (savedSearchWrap.contains(target) || suggestionBox.contains(target)) {
      return;
    }
    clearTimeout(suggestionDebounceTimer);
    hideSavedSuggestionPanel();
  };
  document.addEventListener("click", suggestionOutsideClickHandler);
}

function highlightSuggestion(index) {
  suggestionBox.querySelectorAll("[data-suggest-index]").forEach((el, i) => {
    el.classList.toggle("is-active", i === index);
    el.setAttribute("aria-selected", String(i === index));
  });
  highlightedIndex = index;
}

function showSuggestions(q) {
  if(!suggestionBox) return;
  const list = suggestionBox.querySelector("#savedSuggestionList");
  if(!list) return;
  if (!allSavedVehicles || allSavedVehicles.length === 0) {
    list.replaceChildren(makeSavedSuggestionMessage("No saved vehicles yet"));
    showSuggestionPanel();
    return;
  }

  const qLower = q.toLowerCase();
  const seen = new Set();
  const suggestions = [];

  const addSuggestion = (type, value, label, extra) => {
    if (!seen.has(value)) {
      seen.add(value);
      suggestions.push({ type, value, label, extra });
    }
  };

  const vehicles = allSavedVehicles || [];

  for (const v of vehicles) {
    const make = (v.make || "").toString();
    const model = (v.model || "").toString();
    const year = (v.year || "").toString();
    const variant = (v.variant || "").toString();
    const bodyType = (v.body_type || "").toString();
    const fuelType = (v.fuel_type || "").toString();

    const makeLower = make.toLowerCase();
    const modelLower = model.toLowerCase();
    const yearLower = year.toLowerCase();
    const variantLower = variant.toLowerCase();
    const bodyTypeLower = bodyType.toLowerCase();
    const fuelTypeLower = fuelType.toLowerCase();

    if (makeLower.includes(qLower) && !seen.has("make:" + make)) {
      seen.add("make:" + make);
      addSuggestion("make", make, make, v);
    }

    if (modelLower.includes(qLower) && !seen.has("model:" + model)) {
      seen.add("model:" + model);
      addSuggestion("model", model, model, v);
    }

    if (yearLower.includes(qLower) && !seen.has("year:" + year)) {
      seen.add("year:" + year);
      addSuggestion("year", year, year, v);
    }

    if (variantLower.includes(qLower) && !seen.has("variant:" + variant)) {
      seen.add("variant:" + variant);
      addSuggestion("variant", variant, variant, v);
    }

    if (bodyTypeLower.includes(qLower) && !seen.has("body:" + bodyType)) {
      seen.add("body:" + bodyType);
      addSuggestion("body", bodyType, bodyType, v);
    }

    if (fuelTypeLower.includes(qLower) && !seen.has("fuel:" + fuelType)) {
      seen.add("fuel:" + fuelType);
      addSuggestion("fuel", fuelType, fuelType, v);
    }
  }

  list.replaceChildren();
  if(suggestions.length === 0){
    list.appendChild(makeSavedSuggestionMessage("No matching vehicles"));
  }else{
    for(const [index, suggestion] of suggestions.entries()){
      const item = document.createElement("button");
      item.type = "button";
      item.className = "saved-suggestion-row";
      item.dataset.suggestIndex = String(index);
      item.dataset.suggestValue = suggestion.value;
      item.setAttribute("role","option");
      item.setAttribute("aria-selected","false");

      const content = document.createElement("span");
      content.className = "saved-suggestion-content";
      const title = document.createElement("span");
      title.className = "saved-suggestion-title";
      title.textContent = suggestion.label;
      const subtitle = document.createElement("span");
      subtitle.className = "saved-suggestion-subtitle";
      const details = [
        suggestion.extra?.make,
        suggestion.type === "make" ? "" : suggestion.extra?.model,
        suggestion.extra?.variant,
        suggestion.type === "year" ? "" : suggestion.extra?.year
      ].filter(Boolean);
      subtitle.textContent = details.join(" · ");
      content.append(title, subtitle);

      const category = document.createElement("span");
      category.className = "saved-suggestion-category";
      category.textContent = ({make:"Make",model:"Model",variant:"Variant",year:"Year",body:"Body",fuel:"Fuel"})[suggestion.type] || "Saved vehicle";
      item.append(content, category);
      list.appendChild(item);
    }
  }

  showSuggestionPanel();
}

function makeSavedSuggestionMessage(message){
  const item = document.createElement("div");
  item.className = "saved-suggestion-empty";
  item.textContent = message;
  return item;
}

function showSuggestionPanel() {
  if(!suggestionBox || !searchInput) return;
  if(!savedSearchWrap?.isConnected) return;
  suggestionBox.classList.remove("hidden");
  searchInput.setAttribute("aria-expanded","true");
}

function hideSavedSuggestionPanel(){
  clearTimeout(suggestionDebounceTimer);
  suggestionBox?.classList.add("hidden");
  searchInput?.setAttribute("aria-expanded","false");
  suggestionActive = false;
}

function applySuggestion(value) {
  searchInput.value = value;
  searchQuery = value;
  hideSavedSuggestionPanel();
  highlightSuggestion(0);
  renderFiltered();
  searchInput.focus();
}

function submitSearch() {
  renderFiltered();
  hideSavedSuggestionPanel();
  searchInput.focus();
}
