import {
renderVehicleCard,
renderVehicleCardSkeletons
} from "../components/vehicleCard.js";



import { formatPrice, formatMileage, getLocation } from "../components/vehicleCard.js";
import { getCardDetailLevel } from "../js/cardDetailPreference.js";
import { supabase } from "../js/api.js";
import { navigate } from "../js/router.js";
import {
toast,
clearCompare,
getCompare,
setCompare,
toggleCompare
} from "../js/ui.js";

let vehicles = [];
let compareRequestSeq = 0;
let compareSearchSeq = 0;
let compareSearchTimer = null;
let compareSortMode = "default";
let compareOutsideClickBound = false;
let compareLoading = false;
const compareExpandedIds = new Set();
const COMPARE_IMAGE_FALLBACK = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22%3E%3Crect width=%22400%22 height=%22300%22 fill=%22%23f1f5f9%22/%3E%3Cpath d=%22M84 190h232l-20-58a20 20 0 0 0-19-14H123a20 20 0 0 0-19 14zM70 190v38h26a25 25 0 0 1 50 0h108a25 25 0 0 1 50 0h26v-38z%22 fill=%22%2394a3b8%22/%3E%3Ccircle cx=%22121%22 cy=%22228%22 r=%2215%22 fill=%22%23475569%22/%3E%3Ccircle cx=%22279%22 cy=%22228%22 r=%2215%22 fill=%22%23475569%22/%3E%3C/svg%3E";

function compareEscape(value){
  return String(value ?? "").replace(/[&<>"']/g, (char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}

/* ========================================= */

export function ComparePage(){

setTimeout(init, 0);

return `

<div class="
compare-page
max-w-[1240px]
mx-auto
px-4
sm:px-6
xl:px-8
pt-6
md:pt-8
pb-10
min-h-screen
">

  <!-- HEADER -->
  <div class="
compare-page-header
flex
items-start
justify-between
gap-4
flex-wrap
mb-4
">

    <div class="compare-page-heading">

      <h1 class="
compare-page-title
text-[#081120]
font-black
tracking-[-0.03em]
leading-[1.05]
text-[clamp(1.35rem,3.2vw,1.7rem)]
">
        Compare Vehicles
      </h1>

      <p class="
compare-page-description
mt-2
text-slate-500
text-[12px]
sm:text-[12.5px]
leading-relaxed
max-w-[430px]
">
        Compare pricing, specifications, and features side-by-side.
      </p>

    </div>

    <div class="compare-page-header-actions flex gap-2 flex-wrap">

      <button
        onclick="clearCompare()"
        class="
compare-action-btn
h-[42px]
rounded-[10px]
border
border-red-200/70
bg-white
hover:bg-red-50
text-red-500
px-4
font-semibold
text-[12px]
transition-all
duration-300
">
        Clear Compare
      </button>

      <button
        onclick="goBrowse()"
        class="
compare-action-btn
h-[42px]
rounded-[10px]
bg-[#005BBF]
hover:bg-[#004FA8]
text-white
px-4
font-semibold
text-[12px]
transition-all
duration-300
">
        Browse Vehicles
      </button>

    </div>

  </div>

  <section class="compare-tools" aria-label="Search and sort compared vehicles">
    <div class="compare-search-wrap">
      <div class="compare-search-input-wrap">
        <svg class="compare-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
        <input id="compareVehicleSearch" type="search" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="compareVehicleSuggestions" placeholder="Search make, model, variant or year" class="compare-search-input">
      </div>
      <div id="compareVehicleSuggestions" class="compare-suggestions hidden" role="listbox" aria-label="Vehicle suggestions"></div>
    </div>
    <div class="compare-sort-wrap">
      <label for="compareSort" class="compare-control-label">Sort compared vehicles</label>
      <select id="compareSort" class="compare-sort-select">
        <option value="default">Default order</option>
        <option value="price-low">Price: Low to High</option>
        <option value="price-high">Price: High to Low</option>
        <option value="year-new">Newest Year</option>
        <option value="year-old">Oldest Year</option>
        <option value="mileage-low">Lowest Mileage</option>
        <option value="mileage-high">Highest Mileage</option>
        <option value="make-model">Make/Model A to Z</option>
      </select>
    </div>
  </section>

  <!-- CONTENT -->
  <div id="compareBox">

    <!-- Initial skeleton state: shown immediately on first paint so the
         page never displays an empty area before the compared vehicles
         load. init() replaces this with the real previews + comparison
         table, the existing empty state, or the existing error state. -->
    ${renderCompareSkeleton()}

  </div>

</div>

`;

}

/* ========================================= */
/* LOADING SKELETON (PHASE 10)
   Mirrors the eventual content — preview cards
   (image + name + price + meta + actions) and the
   at-a-glance comparison table — using the shared
   .skeleton-shimmer language from css/styles.css.
   Replaced by render()/renderEmpty()/showError(). */

function renderCompareSkeleton(cardCount = 2){

/* Previews mirror the real content — the shared Browse
   vehicle card (renderVehicleCardSkeletons) inside the
   .compare-grid container — so the loading state never
   flashes a different card design than the one that
   replaces it. */

const tableRow = () => `
<div class="
compare-table-row
">

  <div class="compare-table-spec-label">
    <div class="skeleton-shimmer h-3 w-16 rounded"></div>
  </div>

  ${Array.from({length: Math.max(1, cardCount)}, ()=>`<div class="compare-table-value"><div class="skeleton-shimmer h-3 w-16 mx-auto rounded"></div></div>`).join("")}

</div>
`;

return `

<div class="compare-previews-section">

  <h2 class="
  compare-previews-title
  text-[#081120]
  font-black
  tracking-[-0.02em]
  text-[17px]
  sm:text-[19px]
  mb-3
  ">
    Your comparison
  </h2>

  <div class="compare-grid">
  ${renderVehicleCardSkeletons(Math.max(1, cardCount))}
  </div>

</div>

<div class="compare-glance-section">

  <h2 class="
  compare-glance-title
  text-[#081120]
  font-black
  tracking-[-0.02em]
  text-[17px]
  sm:text-[19px]
  mb-3
  ">
    Compare the key differences
  </h2>

  <div class="compare-mobile-summary compare-mobile-summary-skeleton" aria-label="Vehicle comparison loading">
    ${Array.from({length: 5}, ()=>`<article class="compare-mobile-spec-card"><div class="skeleton-shimmer h-3 w-20 rounded"></div><div class="compare-mobile-spec-columns">${Array.from({length: Math.max(1, cardCount)}, ()=>`<div class="compare-mobile-spec-vehicle"><span class="skeleton-shimmer block h-3 w-24 rounded"></span><span class="skeleton-shimmer mt-2 block h-3 w-16 rounded"></span></div>`).join("")}</div></article>`).join("")}
  </div>

  <div class="compare-table-scroll compare-desktop-summary-table" aria-label="Vehicle comparison loading">
    <div class="compare-table">
    <div class="compare-table-head"><div class="compare-table-spec-label">Specification</div>${Array.from({length: Math.max(1, cardCount)}, ()=>`<div class="compare-table-vehicle-name"><div class="skeleton-shimmer h-3 w-20 mx-auto rounded"></div></div>`).join("")}</div>
    ${Array.from({length: 5}, tableRow).join("")}
    </div>
  </div>

</div>

${renderDetailedComparisonSkeleton(cardCount)}

`;

}

function renderDetailedComparisonSkeleton(cardCount = 2){
  const count = Math.max(1, cardCount);
  const columns = `180px repeat(${count}, minmax(170px, 1fr))`;
  const group = (label, rowCount) => `
    <section class="compare-detail-group">
      <h3 class="compare-detail-group-title">${label}</h3>
      ${Array.from({length: rowCount}, ()=>`
        <div class="compare-detail-row" style="grid-template-columns:${columns}">
          <div class="compare-detail-spec"><span class="skeleton-shimmer block h-3 w-28 rounded"></span></div>
          ${Array.from({length: count}, ()=>`<div class="compare-detail-value"><span class="skeleton-shimmer mx-auto block h-3 w-20 rounded"></span></div>`).join("")}
        </div>
      `).join("")}
    </section>`;
  return `
    <section class="compare-detailed-section" aria-label="Detailed vehicle comparison loading">
      <h2 class="compare-glance-title">Detailed Vehicle Comparison</h2>
      <div class="compare-table-scroll compare-detail-scroll compare-desktop-detailed">
        <div class="compare-detailed-table">
          <div class="compare-detail-header" style="grid-template-columns:${columns}">
            <div class="compare-detail-spec">Specification</div>
            ${Array.from({length: count}, ()=>`<div class="compare-detail-vehicle"><span class="skeleton-shimmer mx-auto block h-3 w-28 rounded"></span></div>`).join("")}
          </div>
          ${group("Engine and performance", 8)}
          ${group("Dimensions and capacity", 6)}
          ${group("Electric and hybrid specifications", 5)}
          ${group("Vehicle information", 4)}
          ${group("Features", 4)}
        </div>
      </div>
      <div class="compare-mobile-detailed-skeleton" aria-label="Detailed vehicle comparison loading">
        ${["Engine and Performance", "Transmission and Drivetrain", "Dimensions and Capacity", "Electric and Hybrid", "Vehicle Information", "Features"].map((label)=>`<div class="compare-mobile-accordion-skeleton"><span>${label}</span><span class="skeleton-shimmer h-3 w-3 rounded"></span></div>`).join("")}
      </div>
    </section>
  `;
}

/* ========================================= */

async function init(){

const box = document.getElementById("compareBox");
if(!box || !document.body.contains(box)){ return; }
const requestId = ++compareRequestSeq;
compareLoading = true;

try{

const ids = getCompare();

function bindCompareControls(){
const input = document.getElementById("compareVehicleSearch");
const sort = document.getElementById("compareSort");
if(input && input.dataset.compareBound !== "true"){
  input.dataset.compareBound = "true";
  input.addEventListener("input", ()=>{
    if(compareSearchTimer) clearTimeout(compareSearchTimer);
    const value = input.value.trim();
    if(value.length < 2){
      compareSearchSeq++;
      renderCompareSuggestionsMessage(value ? "Type at least 2 characters to search." : "");
      return;
    }
    compareSearchTimer = setTimeout(()=>searchCompareVehicles(value), 180);
  });
  input.addEventListener("keydown", handleCompareSearchKeydown);
  input.addEventListener("focus", ()=>{
    if(input.value.trim().length >= 2 && document.getElementById("compareVehicleSuggestions")?.dataset.query !== input.value.trim()){
      if(compareSearchTimer) clearTimeout(compareSearchTimer);
      compareSearchTimer = setTimeout(()=>searchCompareVehicles(input.value.trim()), 0);
    }
  });
}
if(sort && sort.dataset.compareBound !== "true"){
  sort.dataset.compareBound = "true";
  sort.value = compareSortMode;
  sort.addEventListener("change", ()=>{
    compareSortMode = sort.value;
    if(compareLoading || !vehicles.length) return;
    vehicles = sortCompareVehicles(vehicles, compareSortMode);
    render();
  });
}
const compareBox = document.getElementById("compareBox");
if(compareBox && compareBox.dataset.expansionBound !== "true"){
  compareBox.dataset.expansionBound = "true";
  compareBox.addEventListener("click", (event)=>{
    if(!event.target.closest("[data-card-details-toggle]")) return;
    const shell = event.target.closest("[data-compare-vehicle-id]");
    if(!shell) return;
    Promise.resolve().then(()=>{
      const card = shell.querySelector("[data-expandable-vehicle-card]");
      const id = shell.getAttribute("data-compare-vehicle-id");
      if(!id || !card) return;
      if(card.dataset.expanded === "true") compareExpandedIds.add(String(id));
      else compareExpandedIds.delete(String(id));
    });
  }, true);
}
if(!compareOutsideClickBound){
  compareOutsideClickBound = true;
  document.addEventListener("click", (event)=>{
    const wrap = document.querySelector(".compare-search-wrap");
    if(wrap && !wrap.contains(event.target)) closeCompareSuggestions();
  });
}
}

function renderCompareSuggestionsMessage(message){
const box = document.getElementById("compareVehicleSuggestions");
const input = document.getElementById("compareVehicleSearch");
if(!box || !input) return;
box.dataset.query = input.value.trim();
box.innerHTML = message ? `<div class="compare-suggestion-message" role="status">${compareEscape(message)}</div>` : "";
box.dataset.activeIndex = "-1";
box.classList.toggle("hidden", !message);
input.setAttribute("aria-expanded", String(Boolean(message)));
input.removeAttribute("aria-activedescendant");
}

function closeCompareSuggestions(){
const box = document.getElementById("compareVehicleSuggestions");
const input = document.getElementById("compareVehicleSearch");
box?.classList.add("hidden");
input?.setAttribute("aria-expanded", "false");
input?.removeAttribute("aria-activedescendant");
}

function compareSearchSkeleton(){
const box = document.getElementById("compareVehicleSuggestions");
if(!box) return;
box.innerHTML = Array.from({length: 3}, ()=>`<div class="compare-suggestion-skeleton"><span class="skeleton-shimmer h-10 w-14 rounded-lg"></span><span class="min-w-0 flex-1"><span class="skeleton-shimmer block h-3 w-2/3 rounded"></span><span class="skeleton-shimmer mt-2 block h-2.5 w-1/2 rounded"></span></span></div>`).join("");
box.dataset.activeIndex = "-1";
box.classList.remove("hidden");
document.getElementById("compareVehicleSearch")?.setAttribute("aria-expanded", "true");
}

async function searchCompareVehicles(rawQuery){
const input = document.getElementById("compareVehicleSearch");
const box = document.getElementById("compareVehicleSuggestions");
if(!input || !box) return;
const queryText = input.value.trim();
if(queryText !== rawQuery || rawQuery.length < 2) return;
const requestId = ++compareSearchSeq;
const tokens = rawQuery.replace(/[(),.%_*\\]/g, " ").split(/\s+/).map((token)=>token.trim()).filter(Boolean).slice(0, 6);
if(!tokens.length){ renderCompareSuggestionsMessage("Enter a make, model, variant or year."); return; }
box.dataset.query = rawQuery;
compareSearchSkeleton();
const clauses = tokens.flatMap((token)=>{
  const safe = token.replace(/[^\p{L}\p{N}-]/gu, "");
  if(!safe) return [];
  const fields = ["make", "model", "variant", "title"].map((field)=>`${field}.ilike.%${safe}%`);
  if(/^\d{4}$/.test(safe)) fields.push(`year.eq.${safe}`);
  return fields;
});
if(!clauses.length){ renderCompareSuggestionsMessage("Enter a make, model, variant or year."); return; }
try{
  const {data, error} = await supabase
    .from("vehicles")
    .select("*")
    .or(clauses.join(","))
    .order("created_at", {ascending:false})
    .limit(60);
  if(requestId !== compareSearchSeq || !document.body.contains(box) || input.value.trim() !== rawQuery) return;
  if(error) throw error;
  const foldedTokens = tokens.map((token)=>token.toLocaleLowerCase());
  const results = (Array.isArray(data) ? data : []).filter((vehicle)=>{
    const text = [vehicle.make, vehicle.model, vehicle.variant, vehicle.year].filter((value)=>value !== null && value !== undefined).join(" ").toLocaleLowerCase();
    return foldedTokens.every((token)=>text.includes(token));
  }).slice(0, 8);
  renderCompareSuggestions(results, rawQuery);
}catch(error){
  if(requestId !== compareSearchSeq || !document.body.contains(box)) return;
  console.warn("Compare vehicle search failed:", error);
  renderCompareSuggestionsMessage("Vehicle search is unavailable right now. Please try again.");
}
}

function renderCompareSuggestions(results, query){
const box = document.getElementById("compareVehicleSuggestions");
const input = document.getElementById("compareVehicleSearch");
if(!box || !input) return;
box.dataset.query = query;
box.dataset.activeIndex = "-1";
if(!results.length){
  box.innerHTML = `<div class="compare-suggestion-message" role="status">No matching vehicles found.</div>`;
  box.classList.remove("hidden");
  input.setAttribute("aria-expanded", "true");
  return;
}
const ids = getCompare().map(String);
box.innerHTML = results.map((vehicle, index)=>{
  const name = [vehicle.make, vehicle.model, vehicle.variant].filter(Boolean).join(" ") || "Vehicle listing";
  const detail = [vehicle.year, vehicle.price != null ? formatPrice(vehicle.price) : ""].filter(Boolean).join(" · ");
  const already = ids.includes(String(vehicle.id));
  const image = vehicle.image_url ? `<img src="${compareEscape(vehicle.image_url)}" alt="" loading="lazy" onerror="this.style.display='none'">` : `<span class="compare-suggestion-image-fallback">${compareEscape(String(vehicle.make || "V").slice(0,1).toUpperCase())}</span>`;
  return `<button type="button" class="compare-suggestion${already ? " is-compared" : ""}" role="option" aria-selected="false" data-compare-result="${compareEscape(vehicle.id)}" data-index="${index}"><span class="compare-suggestion-image">${image}</span><span class="min-w-0 flex-1"><span class="compare-suggestion-name">${compareEscape(name)}</span><span class="compare-suggestion-meta">${compareEscape(detail)}</span></span><span class="compare-suggestion-status">${already ? "Already comparing" : "Add"}</span></button>`;
}).join("");
box.classList.remove("hidden");
input.setAttribute("aria-expanded", "true");
box.querySelectorAll("[data-compare-result]").forEach((button)=>button.addEventListener("click", ()=>addCompareSearchResult(button.getAttribute("data-compare-result"))));
}

function handleCompareSearchKeydown(event){
const box = document.getElementById("compareVehicleSuggestions");
if(!box || box.classList.contains("hidden")) return;
const items = Array.from(box.querySelectorAll("[data-compare-result]"));
if(event.key === "Escape"){
  closeCompareSuggestions();
  return;
}
if(!items.length) return;
const active = Number(box.dataset.activeIndex ?? -1);
if(event.key === "ArrowDown" || event.key === "ArrowUp"){
  event.preventDefault();
  const delta = event.key === "ArrowDown" ? 1 : -1;
  const next = (active + delta + items.length) % items.length;
  box.dataset.activeIndex = String(next);
  items.forEach((item, index)=>item.setAttribute("aria-selected", String(index === next)));
  document.getElementById("compareVehicleSearch")?.setAttribute("aria-activedescendant", items[next].id || (items[next].id = `compare-suggestion-${next}`));
  items[next].scrollIntoView({block:"nearest"});
}else if(event.key === "Enter" && active >= 0){
  event.preventDefault();
  items[active].click();
}
}

function addCompareSearchResult(vehicleId){
if(!vehicleId) return;
if(getCompare().some((id)=>String(id) === String(vehicleId))){
  toast("That vehicle is already in your comparison.");
  closeCompareSuggestions();
  return;
}
const added = toggleCompare(vehicleId);
if(added){
  const input = document.getElementById("compareVehicleSearch");
  if(input) input.value = "";
  compareSearchSeq++;
  closeCompareSuggestions();
}
}

function sortCompareVehicles(list, mode){
if(mode === "default"){
  const order = new Map(getCompare().map((id, index)=>[String(id), index]));
  return [...list].sort((a,b)=>(order.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) - (order.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER));
}
const comparators = {
  "price-low": (a,b)=>compareNumeric(a.price,b.price,1),
  "price-high": (a,b)=>compareNumeric(a.price,b.price,-1),
  "year-new": (a,b)=>compareNumeric(a.year,b.year,-1),
  "year-old": (a,b)=>compareNumeric(a.year,b.year,1),
  "mileage-low": (a,b)=>compareNumeric(a.mileage,b.mileage,1),
  "mileage-high": (a,b)=>compareNumeric(a.mileage,b.mileage,-1),
  "make-model": (a,b)=>`${a.make || ""} ${a.model || ""}`.localeCompare(`${b.make || ""} ${b.model || ""}`, undefined, {sensitivity:"base"})
};
return [...list].sort(comparators[mode] || (()=>0));
}

function compareNumeric(a, b, direction){
const av = a === null || a === undefined || a === "" ? null : Number(a);
const bv = b === null || b === undefined || b === "" ? null : Number(b);
const aValid = av !== null && Number.isFinite(av);
const bValid = bv !== null && Number.isFinite(bv);
if(!aValid && !bValid) return 0;
if(!aValid) return 1;
if(!bValid) return -1;
return (av - bv) * direction;
}

/* Bind controls only after their handlers are in scope. Keeping the controls
   bound even for an empty comparison lets users search from the empty state. */
bindCompareControls();

const cleanIds =
(Array.isArray(ids) ? ids : []).filter(Boolean);

if(!cleanIds.length){
compareLoading = false;
vehicles = [];
compareExpandedIds.clear();
renderEmpty();
return;

}

box.innerHTML = renderCompareSkeleton(cleanIds.length);

const {
data,
error
} =
await supabase
.from("vehicles")
.select("*")
.in("id", cleanIds);

if(error){

if(requestId !== compareRequestSeq || !document.body.contains(box)) return;
compareLoading = false;
vehicles = [];

console.error(
"Compare load error:",
error
);

showError(
"Error loading compare vehicles"
);

return;

}

vehicles =
cleanIds.map((id)=>{
  const wanted = String(id);
  return (Array.isArray(data) ? data : []).find((vehicle)=>String(vehicle?.id) === wanted);
}).filter(Boolean);

if(requestId !== compareRequestSeq || !document.body.contains(box)){ return; }
compareLoading = false;

vehicles = sortCompareVehicles(vehicles, compareSortMode);
const liveIds = new Set(vehicles.map((vehicle)=>String(vehicle.id)));
for(const id of compareExpandedIds){ if(!liveIds.has(id)) compareExpandedIds.delete(id); }

if(!vehicles.length){

renderEmpty();
return;

}

render();

}catch(err){

if(requestId !== compareRequestSeq || !document.body.contains(box)){ return; }
compareLoading = false;
vehicles = [];

console.error(
"Compare init error:",
err
);

showError(
"Unexpected error loading compare vehicles"
);

}

}

/* ========================================= */

function renderEmpty(){

const box =
document.getElementById("compareBox");

if(!box) return;

box.innerHTML = `

<div class="
rounded-[18px]
border
border-dashed
border-slate-200
bg-white
p-8
text-center
shadow-sm
">

  <h2 class="
text-xl
font-bold
mb-2
text-[#08111F]
">
    No vehicles selected
  </h2>

  <p class="
text-[#64748B]
text-[13px]
leading-relaxed
max-w-xl
mx-auto
">
    Add vehicles to compare specifications side-by-side.
  </p>

  <button
    onclick="goBrowse()"
    class="
mt-4
h-10
rounded-lg
    bg-[#E48A2F]
    hover:bg-[#D67E2C]
    text-[#08111F]
px-4
font-bold
text-[13px]
transition-all
duration-300
">
    Browse Vehicles
  </button>

</div>

`;

}

/* ========================================= */

function render(){

const box =
document.getElementById("compareBox");

if(
!box ||
!document.body.contains(box)
){
return;
}

box.innerHTML = `

${renderVehiclePreviews()}

${renderComparison()}

${renderDetailedComparison()}

`;

restoreExpandedCompareCards();

}

function restoreExpandedCompareCards(){
for(const shell of document.querySelectorAll("#compareBox [data-compare-vehicle-id]")){
  const id = shell.getAttribute("data-compare-vehicle-id");
  if(!compareExpandedIds.has(String(id))) continue;
  const card = shell.querySelector("[data-expandable-vehicle-card]");
  if(!card) continue;
  card.dataset.expanded = "true";
  card.querySelector("[data-card-standard-details]")?.classList.add("hidden");
  card.querySelector("[data-card-expanded-details]")?.classList.remove("hidden");
  const button = card.querySelector("[data-card-details-toggle]");
  if(button){ button.textContent = "Show Less"; button.setAttribute("aria-expanded", "true"); }
}
}

/* ========================================= */
/* VEHICLES BEING COMPARED — PREVIEWS (3.7C) */
/* ========================================= */

function renderVehiclePreviews(){

if(
!vehicles ||
!vehicles.length
){
return "";
}

/* Reuse the shared HUFA vehicle card from Browse
   (components/vehicleCard.js → renderVehicleCard) so the
   Compare page shows the exact same card markup, badges,
   typography, image treatment, spec grid and "View Vehicle"
   CTA as Browse. The ONLY compare-specific addition is the
   Remove control, wired to the existing removeCompare(). */
const compareRemove = (vehicle) => `
<button
  onclick="event.stopPropagation(); removeCompare('${vehicle.id}')"
  class="inline-flex items-center gap-1.5 h-10 px-4 rounded-[12px] border border-slate-200 text-[#3B82F6] hover:border-[#3B82F6] font-semibold text-[13px] transition-all duration-300"
  aria-label="Remove from compare"
  title="Remove from compare"
>
  <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 18L18 6M6 6l12 12"/>
  </svg>
  Remove
</button>
`;

const previewCards =
vehicles.map((v)=>

  `<div class="compare-card-shell" data-compare-vehicle-id="${compareEscape(v.id)}">${renderVehicleCard(v, {
    layout: "grid",
    actions: compareRemove,
    detailLevel: getCardDetailLevel(),
    imageFallback: COMPARE_IMAGE_FALLBACK
  })}</div>`

).join("");

return `

<div class="compare-previews-section compare-fade">

  <h2 class="
  compare-previews-title
  text-[#081120]
  font-black
  tracking-[-0.02em]
  text-[17px]
  sm:text-[19px]
  mb-3
  ">
    Your comparison
  </h2>

  <div class="compare-grid">
    ${previewCards}
  </div>

</div>

`;

}

/* ========================================= */
/* AT A GLANCE — COMPACT COMPARISON (3.7D) */
/* ========================================= */

function renderComparison(){

if(
!vehicles ||
!vehicles.length
){
return "";
}

const specs = [
  { label: "Price", get: (v) => formatPrice(v.price) },
  { label: "Year", get: (v) => v.year || "-" },
  { label: "Mileage", get: (v) => formatMileage(v.mileage) },
  { label: "Fuel", get: (v) => v.fuel_type || "-" },
  { label: "Transmission", get: (v) => v.transmission || "-" },
  { label: "Drive", get: (v) => v.drive_type || "-" },
  { label: "Body", get: (v) => v.body_type || "-" },
  { label: "Location", get: (v) => getLocation(v) }
];

/* Determine which specs differ across vehicles */
const differing = {};

specs.forEach((s)=>{
  const values =
  new Set(
    vehicles.map((v)=>
      String(s.get(v) || "").trim().toLowerCase()
    )
  );
  differing[s.label] = values.size > 1;
});

/* ---- HEADER ROW: vehicle names as columns ---- */

const headerRow = `
<div class="compare-table-head">
  <div class="compare-table-spec-label">Specification</div>
  ${vehicles.map((v)=>`
  <div class="compare-table-vehicle-name">
    ${v.make || ""} ${v.model || ""}
  </div>
  `).join("")}
</div>
`;

/* ---- SPEC ROWS: label + values per vehicle ---- */

const specRows =
specs.map((s)=>{

  const isDiff = differing[s.label];

  return `
<div class="
compare-table-row
${isDiff ? 'compare-table-diff' : ''}
">
  <div class="compare-table-spec-label">${s.label}</div>
  ${vehicles.map((v)=>`
  <div class="compare-table-value">${s.get(v)}</div>
  `).join("")}
</div>
`;

}).join("");

/* ---- ACTION ROW: View Vehicle buttons ---- */

const actionRow = `
<div class="compare-table-row compare-table-actions">
  <div class="compare-table-spec-label"></div>
  ${vehicles.map((v)=>`
  <div class="compare-table-value">
    <button
      onclick="viewVehicle('${v.id}')"
      class="compare-table-view${v.is_featured ? ' compare-table-view-featured' : ''}"
      aria-label="View Vehicle"
      title="View Vehicle"
    >
      View Vehicle
    </button>
  </div>
  `).join("")}
</div>
`;

const mobileSpecCards = specs.map((spec)=>`
  <article class="compare-mobile-spec-card">
    <h3>${compareEscape(spec.label)}</h3>
    <div class="compare-mobile-spec-columns">
      ${vehicles.map((vehicle)=>{
        let value = spec.get(vehicle);
        if(spec.label === "Price" && !(Number(vehicle.price) > 0)) value = "Not specified";
        else if(spec.label === "Year" && !compareDetailText(vehicle.year)) value = "Not specified";
        else if(spec.label === "Mileage" && (vehicle.mileage === null || vehicle.mileage === undefined || vehicle.mileage === "" || !Number.isFinite(Number(vehicle.mileage)))) value = "Not specified";
        else if(spec.label === "Fuel" && !compareDetailText(vehicle.fuel_type)) value = "Not specified";
        else if(spec.label === "Transmission" && !compareDetailText(vehicle.transmission)) value = "Not specified";
        else if(spec.label === "Drive" && !compareDetailText(vehicle.drive_type)) value = "Not specified";
        else if(spec.label === "Body" && !compareDetailText(vehicle.body_type)) value = "Not specified";
        else if(spec.label === "Location" && !compareDetailText(vehicle.city || vehicle.location)) value = "Not specified";
        return `<div class="compare-mobile-spec-vehicle"><span class="compare-mobile-spec-vehicle-name">${compareEscape(compareDetailVehicleName(vehicle))}</span><span class="compare-mobile-spec-vehicle-value">${compareEscape(value ?? "Not specified")}</span></div>`;
      }).join("")}
    </div>
  </article>
`).join("");

return `

<div class="compare-glance-section compare-fade">

  <h2 class="
  compare-glance-title
  text-[#081120]
  font-black
  tracking-[-0.02em]
  text-[17px]
  sm:text-[19px]
  mb-3
  ">
    Compare the key differences
  </h2>

  <!-- COMPACT COMPARISON TABLE -->
  <div class="compare-mobile-summary" aria-label="Vehicle comparison specifications">
    ${mobileSpecCards}
  </div>

  <div class="compare-table-scroll compare-desktop-summary-table" aria-label="Vehicle comparison table">
    <div class="compare-table">
      ${headerRow}
      ${specRows}
      ${actionRow}
    </div>
  </div>

</div>

`;

}

function compareDetailText(value){
  if(value === null || value === undefined || typeof value === "boolean") return "";
  const text = String(value).trim();
  return text ? text : "";
}

function compareDetailNumber(value, unit = "", allowZero = false){
  if(value === null || value === undefined || value === "" || typeof value === "boolean") return "";
  const number = Number(value);
  if(!Number.isFinite(number) || number < 0 || (!allowZero && number === 0)) return "";
  return `${number.toLocaleString()}${unit ? ` ${unit}` : ""}`;
}

function compareDetailFeatures(value){
  let items = [];
  if(Array.isArray(value)) items = value;
  else if(typeof value === "string" && value.trim()){
    try{
      const parsed = JSON.parse(value);
      items = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === "object" ? [] : value.split(/[,;\n]/));
    }catch(error){
      items = value.split(/[,;\n]/);
    }
  }
  const seen = new Set();
  return items.map((item)=>String(item ?? "").trim()).filter((item)=>{
    const key = item.toLocaleLowerCase();
    if(!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareDetailVehicleName(vehicle){
  return [vehicle.make, vehicle.model, vehicle.variant].map(compareDetailText).filter(Boolean).join(" ") || "Vehicle";
}

function renderDetailedComparison(){
  if(!vehicles.length) return "";
  const columns = `180px repeat(${vehicles.length}, minmax(170px, 1fr))`;
  const isMotorcycle = vehicles.some((vehicle)=>/motorcycle|motorbike|quad bike|\batv\b|side.by.side/i.test(String(vehicle.vehicle_category || "")) || compareDetailText(vehicle.motorcycle_type));
  const isElectricOrHybrid = vehicles.some((vehicle)=>{
    const fuel = String(vehicle.fuel_type || "").toLowerCase();
    const hasElectricSpecification = [vehicle.battery_capacity_kwh, vehicle.battery_range_km, vehicle.electric_range_km, vehicle.charging_time_hours].some((value)=>value !== null && value !== undefined && value !== "");
    return fuel.includes("electric") || fuel.includes("hybrid") || vehicle.is_electric === true || vehicle.is_hybrid === true || vehicle.is_plugin_hybrid === true || vehicle.fast_charging === true || vehicle.fast_charge === true || hasElectricSpecification;
  });
  const hasNonMotorcycle = vehicles.some((vehicle)=>!(/motorcycle|motorbike|quad bike|\batv\b|side.by.side/i.test(String(vehicle.vehicle_category || "")) || compareDetailText(vehicle.motorcycle_type)));

  const groups = [
    {
      title: "Engine and performance",
      rows: [
        {label:"Engine capacity", value:(v)=>compareDetailNumber(v.engine_capacity_cc,"cc")},
        {label:"Engine size", value:(v)=>compareDetailNumber(v.engine_size_l,"L")},
        {label:"Power", value:(v)=>compareDetailNumber(v.power_kw,"kW")},
        {label:"Torque", value:(v)=>compareDetailNumber(v.torque_nm,"Nm")},
        {label:"Cylinders", value:(v)=>compareDetailNumber(v.cylinders)},
        {label:"Turbocharged", value:(v)=>v.turbocharged === true ? "Yes" : ""},
        {label:"Fuel consumption", value:(v)=>compareDetailNumber(v.fuel_consumption_l100,"L/100 km")},
        {label:"CO₂ emissions", value:(v)=>compareDetailNumber(v.co2_emissions_gkm,"g/km",true)}
      ]
    },
    {
      title: "Transmission and Drivetrain",
      rows: [
        {label:"Transmission", summaryDuplicate:true, value:(v)=>compareDetailText(v.transmission)},
        {label:"Drive type", summaryDuplicate:true, value:(v)=>compareDetailText(v.drive_type)},
        {label:"Fuel type", summaryDuplicate:true, value:(v)=>compareDetailText(v.fuel_type)}
      ]
    },
    {
      title: "Dimensions and capacity",
      rows: [
        {label:"Body type", summaryDuplicate:true, value:(v)=>compareDetailText(v.body_type)},
        ...(hasNonMotorcycle ? [
          {label:"Doors", value:(v)=>compareDetailNumber(v.doors)},
          {label:"Seats", value:(v)=>compareDetailNumber(v.seats)}
        ] : []),
        {label:"Towing capacity", value:(v)=>compareDetailNumber(v.towing_capacity_kg,"kg",true)},
        {label:"Payload capacity", value:(v)=>compareDetailNumber(v.payload_capacity_kg,"kg",true)},
        {label:"Cab configuration", value:(v)=>compareDetailText(v.cab_configuration)}
      ]
    },
    ...(isElectricOrHybrid ? [{
      title: "Electric and hybrid specifications",
      rows: [
        {label:"Battery capacity", value:(v)=>compareDetailNumber(v.battery_capacity_kwh,"kWh")},
        {label:"Battery range", value:(v)=>compareDetailNumber(v.battery_range_km,"km")},
        {label:"Electric range", value:(v)=>compareDetailNumber(v.electric_range_km,"km")},
        {label:"Charging time", value:(v)=>compareDetailNumber(v.charging_time_hours,"hours")},
        {label:"Fast charging", value:(v)=>v.fast_charging === true || v.fast_charge === true ? "Supported" : ""}
      ]
    }] : []),
    {
      title: "Vehicle information",
      rows: [
        {label:"Year", summaryDuplicate:true, value:(v)=>compareDetailText(v.year)},
        {label:"Mileage", summaryDuplicate:true, value:(v)=>compareDetailNumber(v.mileage,"km",true)},
        {label:"Condition", value:(v)=>compareDetailText(v.condition)},
        {label:"Colour", value:(v)=>compareDetailText(v.color)},
        {label:"Vehicle category", value:(v)=>compareDetailText(v.vehicle_category)},
        ...(isMotorcycle ? [{label:"Motorcycle type", value:(v)=>compareDetailText(v.motorcycle_type)}] : [])
      ]
    }
  ];

  const populatedGroups = groups.map((group)=>({
    ...group,
    rows: group.rows.filter((row)=>vehicles.some((vehicle)=>Boolean(row.value(vehicle))))
  })).filter((group)=>group.rows.length);

  const featureLists = vehicles.map((vehicle)=>compareDetailFeatures(vehicle.features));
  const featureNames = [...new Map(featureLists.flat().map((feature)=>[feature.toLocaleLowerCase(), feature])).values()];
  if(featureNames.length){
    populatedGroups.push({
      title:"Features",
      rows:featureNames.map((feature)=>({
        label:feature,
        value:(vehicle)=>featureLists[vehicles.indexOf(vehicle)]?.some((item)=>item.toLocaleLowerCase() === feature.toLocaleLowerCase()) ? "Available" : ""
      }))
    });
  }

  const renderDesktopGroup = (group) => {
    const desktopRows = group.rows.filter((row)=>!row.summaryDuplicate);
    if(!desktopRows.length) return "";
    return `<section class="compare-detail-group"><h3 class="compare-detail-group-title">${compareEscape(group.title)}</h3>${desktopRows.map((row)=>`
      <div class="compare-detail-row" style="grid-template-columns:${columns}">
        <div class="compare-detail-spec">${compareEscape(row.label)}</div>
        ${vehicles.map((vehicle)=>`<div class="compare-detail-value">${compareEscape(row.value(vehicle) || "Not specified")}</div>`).join("")}
      </div>`).join("")}</section>`;
  };
  const mobileGroupTitles = {
    "Engine and performance": "Engine and Performance",
    "Transmission and Drivetrain": "Transmission and Drivetrain",
    "Dimensions and capacity": "Dimensions and Capacity",
    "Electric and hybrid specifications": "Electric and Hybrid",
    "Vehicle information": "Vehicle Information"
  };
  const renderMobileGroup = (group) => `
    <details class="compare-mobile-detail-accordion">
      <summary><span>${compareEscape(mobileGroupTitles[group.title] || group.title)}</span><span class="compare-mobile-accordion-icon" aria-hidden="true"></span></summary>
      <div class="compare-mobile-detail-rows">
        ${group.rows.map((row)=>`
          <article class="compare-mobile-detail-row">
            <h3>${compareEscape(row.label)}</h3>
            <div class="compare-mobile-detail-values">
              ${vehicles.map((vehicle)=>`<div class="compare-mobile-detail-value"><span class="compare-mobile-spec-vehicle-name">${compareEscape(compareDetailVehicleName(vehicle))}</span><span>${compareEscape(row.value(vehicle) || "Not specified")}</span></div>`).join("")}
            </div>
          </article>
        `).join("")}
      </div>
    </details>`;
  const desktopGroups = populatedGroups.map(renderDesktopGroup).join("");
  const mobileGroups = populatedGroups.map(renderMobileGroup).join("");

  return `
    <section class="compare-detailed-section compare-fade">
      <h2 class="compare-glance-title">Detailed Vehicle Comparison</h2>
      <div class="compare-table-scroll compare-detail-scroll compare-desktop-detailed" aria-label="Detailed vehicle comparison table">
        <div class="compare-detailed-table">
          <div class="compare-detail-header" style="grid-template-columns:${columns}">
            <div class="compare-detail-spec">Specification</div>
            ${vehicles.map((vehicle)=>`<div class="compare-detail-vehicle">${compareEscape(compareDetailVehicleName(vehicle))}</div>`).join("")}
          </div>
          ${desktopGroups || `<p class="compare-detail-empty">No additional specifications are available for these vehicles.</p>`}
        </div>
      </div>
      <div class="compare-mobile-detailed" aria-label="Detailed vehicle comparison categories">
        ${mobileGroups || `<p class="compare-detail-empty">No additional specifications are available for these vehicles.</p>`}
      </div>
    </section>
  `;
}

/* ========================================= */

function specRow(label, value){

return `

<div class="
flex
items-center
justify-between
gap-3
border-b
border-slate-100
h-9
">

  <span class="
text-slate-500
shrink-0
text-[12px]
">
    ${label}
  </span>

  <span class="
font-bold
text-[#08111F]
text-right
break-words
text-[12px]
">
    ${value}
  </span>

</div>

`;

}

/* ========================================= */

function showError(message){

const box =
document.getElementById("compareBox");

if(!box) return;

box.innerHTML = `

<div class="
rounded-[28px]
border
border-red-500/20
bg-red-500/5
text-red-400
p-10
text-center
">

${message}

</div>

`;

}

/* ========================================= */

window.viewVehicle = function(id){

if(!id) return;

navigate("/vehicle?id=" + id);

};

/* ========================== */
/* ðŸ”¥ GLOBAL CLEAR */
/* ========================== */

window.clearCompare = function(){

clearCompare();

toast("Compare cleared");

renderEmpty();

};



/* ========================== */
/* ðŸ”¥ REMOVE SINGLE */
/* ========================== */

window.removeCompare = function(vehicleId){

compareExpandedIds.delete(String(vehicleId));

let compare =
getCompare();

compare =
compare.filter(id => id !== vehicleId);

setCompare(compare);

vehicles =
vehicles.filter(v => v.id !== vehicleId);

toast("Vehicle removed");

if(!vehicles.length){

renderEmpty();
return;

}

render();

};



/* ========================== */
/* ðŸ”¥ NAVIGATION */
/* ========================== */

window.goBrowse = function(){

navigate("/browse");

};



/* ========================== */
/* ðŸ”¥ LIVE SYNC */
/* ========================== */

window.addEventListener(
"compareUpdated",
()=>{

init();

}
);
