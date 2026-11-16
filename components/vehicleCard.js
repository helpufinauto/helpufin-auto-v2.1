import { asset } from "../js/basePath.js";

const PLACEHOLDER = asset("/placeholder.png");

import { getCompare, toggleCompare } from "../js/ui.js";
import { calculateMonthly } from "../js/financeEngine.js";
import { CARD_DETAIL_CHANGE_EVENT } from "../js/cardDetailPreference.js";

/* =========================================
SHARED VEHICLE CARD — SINGLE SOURCE OF TRUTH
========================================= */

/* ---------- SHARED HELPERS ---------- */

export function formatPrice(price) {
  return `R ${Number(price || 0).toLocaleString()}`;
}

export function formatMileage(mileage) {
  return `${Number(mileage || 0).toLocaleString()} km`;
}

export function getSellerType(v) {
  if (v.verified_dealer) return "Verified Dealer";
  if (v.franchise_dealer) return "Franchise Dealer";
  if (v.independent_dealer) return "Independent Dealer";
  if (v.premium_dealer) return "Premium Dealer";
  if (String(v.seller_type || "").toLowerCase().includes("dealer")) return "Dealer";
  return "Private Seller";
}

export function getLocation(v) {
  return v.city || v.location || "South Africa";
}

export function getImage(v) {
  return v.image_url || PLACEHOLDER;
}

/* ---------- FINANCE ESTIMATE ---------- */

export function getFinanceEstimate(v) {
  const price = Number(v.price || 0);
  if (!price) return null;
  const monthly = calculateMonthly(price, 0, 10.25, 72);
  return monthly;
}

/* ---------- PRICE REDUCTION BLOCK ---------- */

function priceReductionBlock(v) {
  const hasReduction =
    Number(v.price_reduction_amount || 0) > 0 &&
    Number(v.original_price || v.previous_price || 0) > Number(v.price || 0);

  if (!hasReduction) return "";

  const original =
    Number(v.original_price || v.previous_price || 0);

  const reduction =
    Number(v.price_reduction_amount || 0) ||
    (original - Number(v.price || 0));

  const pct = Math.round(
    ((original - Number(v.price || 0)) / (original || 1)) * 100
  );

  return `
<div class="text-[11px] text-slate-400 line-through font-medium">
${formatPrice(original)}
</div>
<div class="flex flex-wrap items-center gap-1">
<span class="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-semibold">
Save ${formatPrice(reduction)}
</span>
<span class="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold">
${pct}% OFF
</span>
</div>
`;
}

/* ---------- BADGES ---------- */

function badgeBlock(v) {
  const badges = [];

  if (v.is_featured) {
    badges.push(`
<div class="px-3 py-1 rounded-full bg-[#E48A2F] text-white text-[11px] font-semibold uppercase tracking-wide">
FEATURED
</div>
`);
  }

  if (v.is_sponsored) {
    badges.push(`
<div class="px-3 py-1 rounded-full bg-[#0B1D3A] text-white text-[11px] font-semibold uppercase tracking-wide">
SPONSORED
</div>
`);
  }

  if (v.is_special) {
    badges.push(`
<div class="px-3 py-1 rounded-full bg-purple-600 text-white text-[11px] font-semibold uppercase tracking-wide">
SPECIAL
</div>
`);
  }

  if (String(v.fuel_type || "").toLowerCase().includes("electric")) {
    badges.push(`
<div class="px-3 py-1 rounded-full bg-green-600 text-white text-[11px] font-semibold uppercase tracking-wide">
EV
</div>
`);
  } else if (String(v.fuel_type || "").toLowerCase().includes("hybrid")) {
    badges.push(`
<div class="px-3 py-1 rounded-full bg-teal-600 text-white text-[11px] font-semibold uppercase tracking-wide">
HYBRID
</div>
`);
  }

  if (v.roadworthy_certificate) {
    badges.push(`
<div class="px-3 py-1 rounded-full bg-[#3B82F6] text-white text-[11px] font-semibold uppercase tracking-wide">
ROADWORTHY
</div>
`);
  }

  if (v.certified_pre_owned) {
    badges.push(`
<div class="px-3 py-1 rounded-full bg-indigo-600 text-white text-[11px] font-semibold uppercase tracking-wide">
CERTIFIED
</div>
`);
  }

  if (!badges.length) return "";
  return `<div class="absolute top-3 left-3 z-10 flex gap-2">${badges.join("")}</div>`;
}

/* Badges for list view (inline chips, not absolutely positioned).
   Returns ONLY the chip spans — callers supply a flex-wrap container
   so the chips can sit alongside the seller badge without overflow. */

function badgeBlockInline(v) {
  const badges = [];

  if (v.is_featured) {
    badges.push(`
<span class="px-2.5 py-0.5 rounded-full bg-[#E48A2F] text-white text-[10px] font-semibold uppercase tracking-wide">
FEATURED
</span>
`);
  }

  if (v.is_sponsored) {
    badges.push(`
<span class="px-2.5 py-0.5 rounded-full bg-[#0B1D3A] text-white text-[10px] font-semibold uppercase tracking-wide">
SPONSORED
</span>
`);
  }

  if (v.is_special) {
    badges.push(`
<span class="px-2.5 py-0.5 rounded-full bg-purple-600 text-white text-[10px] font-semibold uppercase tracking-wide">
SPECIAL
</span>
`);
  }

  if (String(v.fuel_type || "").toLowerCase().includes("electric")) {
    badges.push(`
<span class="px-2.5 py-0.5 rounded-full bg-green-600 text-white text-[10px] font-semibold uppercase tracking-wide">
EV
</span>
`);
  } else if (String(v.fuel_type || "").toLowerCase().includes("hybrid")) {
    badges.push(`
<span class="px-2.5 py-0.5 rounded-full bg-teal-600 text-white text-[10px] font-semibold uppercase tracking-wide">
HYBRID
</span>
`);
  }

  if (v.roadworthy_certificate) {
    badges.push(`
<span class="px-2.5 py-0.5 rounded-full bg-[#3B82F6] text-white text-[10px] font-semibold uppercase tracking-wide">
ROADWORTHY
</span>
`);
  }

  if (v.certified_pre_owned) {
    badges.push(`
<span class="px-2.5 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-semibold uppercase tracking-wide">
CERTIFIED
</span>
`);
  }

  if (!badges.length) return "";
  return badges.join("");
}

function sellerBadge(v) {
  return `
<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E48A2F]/10 text-[#E48A2F] border border-[#E48A2F]/20 text-[11px] font-semibold">
<svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true">
<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
</svg>
${getSellerType(v)}
</span>
`;
}

/* ---------- SPEC GRID (GRID LAYOUT) ---------- */

function fuelIcon(v) {
  if (String(v.fuel_type || "").toLowerCase().includes("electric")) {
    return `<svg class="w-3.5 h-3.5 mx-auto mb-0.5 text-black" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 2L6 13h5l-1 9 8-12h-5l0-8z"/></svg>`;
  }
  return `<svg class="w-4 h-4 mx-auto mb-1 text-black" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 7h8l2 4v6a1 1 0 01-1 1h-1v-2H9v2H8a1 1 0 01-1-1v-6l2-4z"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/></svg>`;
}

function specGrid(v) {
  return `
<div class="grid grid-cols-3 gap-1 mt-1.5">

  <div class="bg-slate-50 border border-slate-100 rounded-lg p-1 text-center">
    ${fuelIcon(v)}
    <div class="text-[9px] uppercase tracking-wider text-slate-500 mb-0.5">Fuel</div>
    <div class="text-[11px] font-semibold text-slate-900">${v.fuel_type || "-"}</div>
  </div>

  <div class="bg-slate-50 border border-slate-100 rounded-lg p-1 text-center">
    <svg class="w-4 h-4 mx-auto mb-1 text-black" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5v14"/><path stroke-linecap="round" stroke-linejoin="round" d="M16 7v10"/><circle cx="8" cy="8" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="16" r="1.5"/></svg>
    <div class="text-[9px] uppercase tracking-wider text-slate-500 mb-0.5">Transmission</div>
    <div class="text-[11px] font-semibold text-slate-900">${v.transmission || "-"}</div>
  </div>

  <div class="bg-slate-50 border border-slate-100 rounded-lg p-1 text-center">
    <svg class="w-3.5 h-3.5 mx-auto mb-0.5 text-black" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14"/><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14"/></svg>
    <div class="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Drive</div>
    <div class="text-xs font-semibold text-slate-900">${v.drive_type || "-"}</div>
  </div>

</div>
`;
}

function detailText(value){
  if(value === null || value === undefined) return "";
  if(typeof value !== "string" && typeof value !== "number") return "";
  const text = String(value).trim();
  if(!text || /^(unknown|n\/?a|not applicable|-)$/i.test(text)) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function detailNumber(value, unit = "", allowZero = false){
  if(value === null || value === undefined || value === "" || typeof value === "boolean") return "";
  if(typeof value === "string" && !value.trim()) return "";
  const n = Number(value);
  if(!Number.isFinite(n) || n < 0 || (n === 0 && !allowZero)) return "";
  return `${detailText(n.toLocaleString())}${unit ? ` ${unit}` : ""}`;
}

function detailFeatures(value){
  if(Array.isArray(value)) return value.filter((item)=>typeof item === "string" || typeof item === "number");
  if(typeof value !== "string" || !value.trim()) return [];
  try{
    const parsed = JSON.parse(value);
    if(Array.isArray(parsed)) return parsed.filter((item)=>typeof item === "string" || typeof item === "number");
    if(parsed && typeof parsed === "object") return [];
  }catch(e){}
  return value.split(/[,;\n]/);
}

export function renderVehicleDetails(v, { complete = false } = {}){
  const category = String(v.vehicle_category || "").toLowerCase();
  const fuel = String(v.fuel_type || "").toLowerCase();
  const motorcycle = /motorcycle|motorbike|quad bike|\batv\b|side.by.side/.test(category);
  const commercial = v.commercial_vehicle === true || /commercial/.test(category);
  const fuelHybrid = fuel.includes("hybrid");
  const fuelElectric = fuel.includes("electric") && !fuelHybrid;
  const hybrid = fuelHybrid || (!fuelElectric && (v.is_hybrid === true || v.is_plugin_hybrid === true));
  const electric = fuelElectric || (!hybrid && v.is_electric === true);
  const isCombustion = hybrid || /petrol|gasoline|diesel/.test(fuel);
  const groups = [];

  const row = (label, value) => {
    const safe = detailText(value);
    return safe ? `<div class="flex min-w-0 items-start justify-between gap-2 border-b border-slate-100 py-1 last:border-0"><span class="shrink-0 text-slate-500">${label}</span><span class="min-w-0 break-words text-right font-medium text-slate-800">${safe}</span></div>` : "";
  };
  const numberRow = (label, value, unit, allowZero = false) => row(label, detailNumber(value, unit, allowZero));
  const group = (title, rows) => {
    const content = rows.filter(Boolean).join("");
    return content ? `<section class="mt-2 min-w-0 rounded-lg border border-slate-100 bg-white p-2 text-[11px] leading-snug"><h4 class="mb-1 font-bold text-slate-700">${title}</h4>${content}</section>` : "";
  };

  groups.push(group("General specifications", [
    complete ? row("Vehicle category", v.vehicle_category) : "",
    row("Variant", v.variant),
    row("Condition", v.condition),
    row("Colour", v.color),
    row("Body type", v.body_type),
    row("Fuel type", v.fuel_type),
    row("Transmission", v.transmission),
    row("Drive type", v.drive_type),
    !motorcycle ? numberRow("Seats", v.seats) : "",
    !motorcycle ? numberRow("Doors", v.doors) : "",
    motorcycle ? row("Motorcycle type", v.motorcycle_type) : ""
  ]));

  const performanceRows = [
    numberRow("Power", v.power_kw, "kW"),
    numberRow("Torque", v.torque_nm, "Nm")
  ];
  if(isCombustion){
    performanceRows.unshift(
      numberRow("Engine capacity", v.engine_capacity_cc, "cc"),
      numberRow("Engine size", v.engine_size_l, "L")
    );
    performanceRows.push(
      numberRow("Cylinders", v.cylinders),
      numberRow("Fuel consumption", v.fuel_consumption_l100, "L/100 km"),
      numberRow("CO₂ emissions", v.co2_emissions_gkm, "g/km")
    );
  }
  groups.push(group(electric && !hybrid ? "Performance" : "Engine and performance", performanceRows));

  if(electric || hybrid){
    groups.push(group("Electric vehicle specifications", [
      numberRow("Battery capacity", v.battery_capacity_kwh, "kWh"),
      numberRow("Battery range", v.battery_range_km, "km"),
      complete ? numberRow("Electric range", v.electric_range_km, "km") : "",
      numberRow("Charging time", v.charging_time_hours, "hours"),
      complete && (v.fast_charging === true || v.fast_charge === true) ? row("Fast charging", "Supported") : "",
      electric && !hybrid ? numberRow("CO₂ emissions", v.co2_emissions_gkm, "g/km", true) : ""
    ]));
  }

  if(commercial){
    groups.push(group("Commercial specifications", [
      row("Commercial category", v.commercial_category),
      row("Cab configuration", v.cab_configuration),
      numberRow("Payload capacity", v.payload_capacity_kg, "kg", true),
      numberRow("Towing capacity", v.towing_capacity_kg, "kg", true)
    ]));
  }

  const features = detailFeatures(v.features)
    .map(detailText)
    .filter(Boolean);
  if(features.length){
    groups.push(group("Features", [`<ul class="flex min-w-0 flex-wrap gap-1.5">${features.map((feature)=>`<li class="max-w-full break-words rounded-full bg-slate-50 px-2 py-1 text-slate-700">${feature}</li>`).join("")}</ul>`]));
  }

  const output = groups.filter(Boolean).join("");
  return output ? `<div class="vehicle-card-details mt-1 min-w-0">${output}</div>` : "";
}

export function renderVehicleCardDetails(v, detailLevel = "simple"){
  const standard = renderVehicleDetails(v);
  const complete = renderVehicleDetails(v, { complete: true });
  if(!standard && !complete) return "";

  return `
    <div data-card-standard-details class="${detailLevel === "detailed" ? "" : "hidden"}">${standard}</div>
    <div data-card-expanded-details class="hidden">${complete}</div>
    ${complete ? `
      <button
        type="button"
        data-card-details-toggle
        aria-expanded="false"
        onclick="window.toggleVehicleCardDetails(event,this)"
        class="mt-2 inline-flex min-h-9 max-w-full items-center rounded-lg border border-[#3B82F6]/30 bg-white px-3 py-1.5 text-left text-xs font-semibold text-[#005BBF] transition hover:bg-[#3B82F6]/5 focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
      >View All Details</button>
    ` : ""}
  `;
}

function syncVehicleCardDetailView(card, detailLevel){
  card.dataset.cardDetailLevel = detailLevel;
  const expanded = card.dataset.expanded === "true";
  card.querySelector("[data-card-standard-details]")?.classList.toggle(
    "hidden",
    expanded || detailLevel !== "detailed"
  );
  card.querySelector("[data-card-expanded-details]")?.classList.toggle("hidden", !expanded);
  const button = card.querySelector("[data-card-details-toggle]");
  if(button){
    button.textContent = expanded ? "Show Less" : "View All Details";
    button.setAttribute("aria-expanded", String(expanded));
  }
}

window.toggleVehicleCardDetails = function(event, button){
  event?.stopPropagation?.();
  const card = button?.closest("[data-expandable-vehicle-card]");
  if(!card) return;
  card.dataset.expanded = card.dataset.expanded === "true" ? "false" : "true";
  syncVehicleCardDetailView(card, card.dataset.cardDetailLevel || "simple");
};

window.addEventListener(CARD_DETAIL_CHANGE_EVENT, (event)=>{
  const level = event.detail?.level === "detailed" ? "detailed" : "simple";
  document.querySelectorAll("[data-expandable-vehicle-card]").forEach((card)=>{
    syncVehicleCardDetailView(card, level);
  });
});

/* ---------- ACTION AREAS (CONFIGURABLE) ---------- */

export const vehicleActions = {

  /* Browse — Save + Compare icons */
  browse: (v, { saved = false } = {}) => `
<button
onclick="event.stopPropagation(); window.toggleSave && toggleSave('${v.id}')"
class="w-8 h-8 rounded-full border flex items-center justify-center transition-all ${saved ? 'border-[#3B82F6] bg-[#3B82F6]/10' : 'border-slate-200 bg-white hover:border-[#3B82F6]'}"
title="Save Vehicle"
>
<svg class="w-6 h-6 transition-all ${saved ? 'text-[#3B82F6]' : 'text-slate-700'}" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
<path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z"/>
</svg>
</button>

<label
onclick="event.stopPropagation()"
class="w-8 h-8 rounded-full border flex items-center justify-center cursor-pointer transition-all ${getCompare().includes(v.id) ? 'border-[#3B82F6] bg-[#3B82F6]/10' : 'border-slate-200 bg-white hover:border-[#3B82F6]'}"
title="Compare Vehicle"
>
<input type="checkbox" data-compare="${v.id}" ${getCompare().includes(v.id) ? "checked" : ""} onchange="toggleCompare('${v.id}')" class="hidden"/>
<svg class="w-6 h-6 ${getCompare().includes(v.id) ? 'text-[#3B82F6]' : 'text-slate-700'}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
<path stroke-linecap="round" stroke-linejoin="round" d="M4 7h7"/><path stroke-linecap="round" stroke-linejoin="round" d="M4 17h7"/><path stroke-linecap="round" stroke-linejoin="round" d="M13 7h7"/><path stroke-linecap="round" stroke-linejoin="round" d="M13 17h7"/><circle cx="10" cy="7" r="2"/><circle cx="14" cy="17" r="2"/>
</svg>
</label>
`,

  /* Saved — Remove only. The card's large bottom
     "View Vehicle" CTA handles navigation, so no
     duplicate View Vehicle button is rendered here. */
  saved: (v) => `
<button
onclick="event.stopPropagation(); removeSaved('${v.id}')"
class="h-10 px-4 rounded-[12px] border border-slate-200 text-[#3B82F6] hover:border-[#3B82F6] font-semibold text-[13px] transition-all duration-300"
>
Remove
</button>
`,

  /* Compare / Home — View Vehicle only */
  view: (v) => `
<button
onclick="event.stopPropagation(); viewVehicle('${v.id}')"
class="w-full h-10 rounded-[12px] ${v.is_featured ? 'bg-[#E48A2F] hover:bg-[#D67E2C]' : 'bg-[#005BBF] hover:bg-[#004FA8]'} text-white font-semibold text-[13px] transition-all duration-300"
>
View Vehicle
</button>
`,

  /* None */
  none: () => ""
};

/* ---------- LIST VIEW ACTIONS (compact secondary) ---------- */

export const vehicleActionsList = {

  browse: (v, { saved = false } = {}) => `
<button
onclick="event.stopPropagation(); window.toggleSave && toggleSave('${v.id}')"
class="w-7 h-7 rounded-full border flex items-center justify-center transition-all ${saved ? 'border-[#3B82F6] bg-[#3B82F6]/10' : 'border-slate-200 bg-white hover:border-[#3B82F6]'}"
aria-label="Save Vehicle"
title="Save Vehicle"
>
<svg class="w-5 h-5 transition-all ${saved ? 'text-[#3B82F6]' : 'text-slate-700'}" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
<path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z"/>
</svg>
</button>

<label
onclick="event.stopPropagation()"
class="w-7 h-7 rounded-full border flex items-center justify-center cursor-pointer transition-all ${getCompare().includes(v.id) ? 'border-[#3B82F6] bg-[#3B82F6]/10' : 'border-slate-200 bg-white hover:border-[#3B82F6]'}"
aria-label="Compare Vehicle"
title="Compare Vehicle"
>
<input type="checkbox" data-compare="${v.id}" ${getCompare().includes(v.id) ? "checked" : ""} onchange="toggleCompare('${v.id}')" class="hidden"/>
<svg class="w-5 h-5 ${getCompare().includes(v.id) ? 'text-[#3B82F6]' : 'text-slate-700'}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
<path stroke-linecap="round" stroke-linejoin="round" d="M4 7h7"/><path stroke-linecap="round" stroke-linejoin="round" d="M4 17h7"/><path stroke-linecap="round" stroke-linejoin="round" d="M13 7h7"/><path stroke-linecap="round" stroke-linejoin="round" d="M13 17h7"/><circle cx="10" cy="7" r="2"/><circle cx="14" cy="17" r="2"/>
</svg>
</label>
`,

  view: (v) => `
<button
onclick="event.stopPropagation(); viewVehicle('${v.id}')"
class="h-9 px-4 rounded-[10px] ${v.is_featured ? 'bg-[#E48A2F] hover:bg-[#D67E2C]' : 'bg-[#005BBF] hover:bg-[#004FA8]'} text-white font-semibold text-[12px] transition-all duration-300"
>
View Vehicle
</button>
`
};

/* ---------- COMPARE SELECTED-STATE SYNC ----------
   Keeps every circular card Compare control visually
   in sync with the actual comparison list (localStorage
   via getCompare). setCompare() dispatches the global
   "compareUpdated" event after every add/remove, so this
   reflects real state — no timeouts, no fake highlight. */

function syncCompareButtons(){

const compare = getCompare();

document
.querySelectorAll("input[data-compare]")
.forEach(input=>{

  const label = input.parentElement;

  if(!label) return;

  const selected =
  compare.includes(input.dataset.compare);

  label.classList.toggle("border-[#3B82F6]", selected);
  label.classList.toggle("bg-[#3B82F6]/10", selected);
  label.classList.toggle("border-slate-200", !selected);
  label.classList.toggle("bg-white", !selected);

  const svg = label.querySelector("svg");

  if(svg){
    svg.classList.toggle("text-[#3B82F6]", selected);
    svg.classList.toggle("text-slate-700", !selected);
  }

});

}

window.addEventListener("compareUpdated", syncCompareButtons);

/* ---------- SHARED VEHICLE CARD SKELETON ----------
   Mirrors the production grid vehicle card layout
   exactly — same dimensions, spacing and structure —
   with shimmer placeholders (same skeleton language
   as the Browse / Homepage loading states).
   Reuses .skeleton-image / .skeleton-shimmer from
   css/styles.css. */

export function renderVehicleCardSkeletons(count = 6) {

  const skeletonCard = () => `
<div class="
vehicle-card
bg-white
rounded-xl
overflow-hidden
border
border-slate-200
shadow-sm
h-full
flex
flex-col
">

  <!-- IMAGE PLACEHOLDER (premium light sweep) -->
  <div class="
  relative
  overflow-hidden
  h-[130px]
  skeleton-image
  ">
  </div>

  <!-- BODY -->
  <div class="vehicle-card-body px-1 py-0.5 flex flex-col flex-1">

    <!-- TITLE (min-h matches production 2-line title) -->
    <div class="min-h-[32px] flex items-start w-full">
      <div class="skeleton-shimmer h-3.5 w-3/4 rounded-md"></div>
    </div>

    <!-- PRICE -->
    <div class="mt-1 flex flex-col gap-0.5">
      <div class="skeleton-shimmer h-4 w-1/3 rounded-md"></div>
    </div>

    <!-- META ROW 1 (Year • Mileage) -->
    <div class="vehicle-meta mt-1.5">
      <div class="skeleton-shimmer h-3 w-8 rounded"></div>
      <span class="vehicle-dot"></span>
      <div class="skeleton-shimmer h-3 w-14 rounded"></div>
    </div>

    <!-- META ROW 2 (Body • Fuel) -->
    <div class="vehicle-meta mt-1.5">
      <div class="skeleton-shimmer h-3 w-12 rounded"></div>
      <span class="vehicle-dot"></span>
      <div class="skeleton-shimmer h-3 w-10 rounded"></div>
    </div>

    <!-- SPEC GRID (icon + label + value) -->
    <div class="grid grid-cols-3 gap-1 mt-1.5">
      <div class="bg-slate-50 border border-slate-100 rounded-lg p-1 text-center">
        <div class="skeleton-shimmer h-4 w-4 mx-auto rounded mb-1"></div>
        <div class="skeleton-shimmer h-2 w-8 mx-auto rounded mb-0.5"></div>
        <div class="skeleton-shimmer h-2.5 w-10 mx-auto rounded"></div>
      </div>
      <div class="bg-slate-50 border border-slate-100 rounded-lg p-1 text-center">
        <div class="skeleton-shimmer h-4 w-4 mx-auto rounded mb-1"></div>
        <div class="skeleton-shimmer h-2 w-8 mx-auto rounded mb-0.5"></div>
        <div class="skeleton-shimmer h-2.5 w-10 mx-auto rounded"></div>
      </div>
      <div class="bg-slate-50 border border-slate-100 rounded-lg p-1 text-center">
        <div class="skeleton-shimmer h-4 w-4 mx-auto rounded mb-1"></div>
        <div class="skeleton-shimmer h-2 w-8 mx-auto rounded mb-0.5"></div>
        <div class="skeleton-shimmer h-2.5 w-10 mx-auto rounded"></div>
      </div>
    </div>

    <!-- DEALER BADGE -->
    <div class="mt-2">
      <div class="skeleton-shimmer h-6 w-28 rounded-full"></div>
    </div>

    <!-- FOOTER (location + action pills) -->
    <div class="mt-1.5 pt-1.5 border-t border-slate-100 flex items-center justify-between">
      <div class="skeleton-shimmer h-3 w-16 rounded"></div>
      <div class="flex items-center gap-2">
        <div class="skeleton-shimmer w-8 h-8 rounded-full border border-slate-200"></div>
        <div class="skeleton-shimmer w-8 h-8 rounded-full border border-slate-200"></div>
      </div>
    </div>

  </div>

</div>
`;

  return Array(count).fill(0).map(() => skeletonCard()).join("");
}

/* ---------- SHARED VEHICLE CARD ---------- */

/**
 * renderVehicleCard — the ONE vehicle card used across the entire platform.
 *
 * @param {Object} v            vehicle record
 * @param {Object} opts
 * @param {string}  [opts.layout]       "grid" | "list"  (default: "grid")
 * @param {string|function} opts.actions   Action area. One of vehicleActions keys,
 *                                         a custom function (v) => html, or null.
 * @param {boolean} opts.saved             Whether vehicle is saved (browse actions)
 * @param {string}  [opts.extraBadge]      Optional HTML inserted above the title
 * @param {string}  [opts.overlayRight]    Optional HTML placed absolute top-right over image
 * @param {function} [opts.highlight]      Optional text highlighter (browse search)
 * @param {boolean} opts.compact           Force compact image height (for hero contexts)
 * @param {string}  [opts.detailLevel]     "simple" | "detailed" (default: "simple")
 */
export function renderVehicleCard(v, opts = {}) {

  const {
    layout = "grid",
    actions = "browse",
    saved = false,
    extraBadge = "",
    overlayRight = "",
    highlight = (t) => t,
    compact = false,
    detailLevel = "simple",
    imageFallback = PLACEHOLDER
  } = opts;

  const detailHtml = renderVehicleCardDetails(v, detailLevel);

  const actionHtml =
    typeof actions === "function"
      ? actions(v, { saved })
      : vehicleActions[actions]
        ? vehicleActions[actions](v, { saved })
        : "";

  const title = highlight(`${v.make || ""} ${v.model || ""}`.trim());

  /* ---- LIST LAYOUT ---- */

  if (layout === "list") {

    const financeEstimate = getFinanceEstimate(v);

    const listActions =
      typeof actions === "function"
        ? actions(v, { saved })
        : vehicleActionsList[actions]
          ? vehicleActionsList[actions](v, { saved })
          : vehicleActions[actions]
            ? vehicleActions[actions](v, { saved })
            : "";

    return `
<div class="
vehicle-card
vehicle-card-list
compare-fade
bg-white
rounded-xl
overflow-hidden
border
border-slate-300
shadow-sm
hover:shadow-xl
transition-all
duration-300
w-full
flex
items-center
gap-4
p-3
"
data-expandable-vehicle-card
data-card-detail-level="${detailLevel === "detailed" ? "detailed" : "simple"}"
data-expanded="false"
onclick="viewVehicle('${v.id}')">

  <!-- IMAGE -->
  <div class="
  relative
  flex-shrink-0
  w-[260px]
  h-[170px]
  bg-slate-100
  rounded-lg
  overflow-hidden
  ">
    <img
      src="${v.image_url || imageFallback}"
      width="200"
      height="130"
      loading="lazy"
      decoding="async"
      alt="${v.make} ${v.model}"
      onerror="this.onerror=null;this.src='${imageFallback}'"
      class="w-full h-full object-cover transition-transform duration-500"
    >
  </div>

  <!-- BODY -->
  <div class="flex-1 min-w-0 flex flex-col items-start min-w-0 flex-1">

    ${extraBadge}

    <div class="text-sm font-semibold text-slate-900 leading-tight min-h-[32px] flex items-start">
      ${title}
    </div>

    <div class="mt-1 flex flex-col gap-0.5">
      <div class="text-base font-bold ${v.is_featured ? 'text-[#E48A2F]' : 'text-[#3B82F6]'} tracking-tight">
        ${formatPrice(v.price)}
      </div>
      ${priceReductionBlock(v)}
    </div>

    ${financeEstimate ? `
    <div class="mt-1 text-xs text-slate-500">
      <span class="font-medium">Estimated:</span> ${formatPrice(financeEstimate)}/month
    </div>
    ` : ""}

    <!-- SPEC ROW -->
    <div class="vehicle-meta mt-1.5">
      <span>${v.year || "-"}</span>
      <span class="vehicle-dot"></span>
      <span>${formatMileage(v.mileage)}</span>
      <span class="vehicle-dot"></span>
      <span>${v.fuel_type || "Petrol"}</span>
      <span class="vehicle-dot"></span>
      <span>${v.transmission || "-"}</span>
      <span class="vehicle-dot"></span>
      <span>${v.drive_type || "-"}</span>
      <span class="vehicle-dot"></span>
      <span>${v.body_type || "Vehicle"}</span>
    </div>

    ${detailHtml}

    <!-- BADGE ROW (seller + status chips, wraps cleanly) -->
    <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
      ${sellerBadge(v)}
      ${badgeBlockInline(v)}
    </div>

    <div class="mt-1.5 flex items-center justify-between text-sm">
      <span class="text-slate-500 truncate max-w-[200px]">${getLocation(v)}</span>
    </div>

  </div>

  <!-- ACTIONS (right side) -->
  <div class="
  flex-shrink-0
  flex
  items-center
  gap-2
  ">
    ${listActions}
  </div>

</div>
`;
  }

  /* ---- GRID LAYOUT (unchanged) ---- */

  return `
<div class="
vehicle-card
compare-fade
bg-white
rounded-xl
overflow-hidden
border
border-slate-300
shadow-sm
hover:shadow-xl
transition-all
duration-300
h-full
w-full
flex
flex-col
${v.is_sponsored ? 'sponsored-card' : ''}
${v.premium_dealer ? 'premium-dealer-card' : ''}
"
data-expandable-vehicle-card
data-card-detail-level="${detailLevel === "detailed" ? "detailed" : "simple"}"
data-expanded="false"
onclick="viewVehicle('${v.id}')">

  <!-- IMAGE -->
  <div class="relative overflow-hidden aspect-[4/3] bg-slate-100">
    <img
      src="${v.image_url || imageFallback}"
      width="400"
      height="300"
      loading="lazy"
      decoding="async"
      alt="${v.make} ${v.model}"
      onerror="this.onerror=null;this.src='${imageFallback}'"
      class="w-full h-full object-contain transition-transform duration-500 hover:scale-105"
    >

    ${overlayRight ? `<div class="absolute top-3 right-3 z-20">${overlayRight}</div>` : ""}
  </div>

  <!-- BODY -->
  <div class="vehicle-card-body px-1 py-0.5 flex flex-col flex-1">

    ${extraBadge}

    <div class="text-sm font-semibold text-slate-900 leading-tight min-h-[32px] flex items-start">
      ${title}
    </div>

    <div class="mt-1 flex flex-col gap-0.5">
      <div class="text-base font-bold ${v.is_featured ? 'text-[#E48A2F]' : 'text-[#3B82F6]'} tracking-tight">
        ${formatPrice(v.price)}
      </div>
      ${priceReductionBlock(v)}
    </div>

    <!-- YEAR / MILEAGE -->
    <div class="vehicle-meta mt-1.5">
      <span>${v.year || "-"}</span>
      <span class="vehicle-dot"></span>
      <span>${formatMileage(v.mileage)}</span>
    </div>

    <div class="vehicle-meta mt-1.5">
      <span>${v.body_type || "Vehicle"}</span>
      <span class="vehicle-dot"></span>
      <span>${v.fuel_type || "Petrol"}</span>
    </div>

    ${specGrid(v)}

    ${detailHtml}

    <div class="mt-2 flex flex-wrap items-center gap-1.5">
      ${sellerBadge(v)}
      ${badgeBlockInline(v)}
    </div>

    <div class="mt-1.5 pt-1.5 border-t border-slate-100 flex items-center justify-between text-sm">
      <span class="text-slate-500 truncate">${getLocation(v)}</span>
      <div class="flex items-center gap-2">
        ${actionHtml}
      </div>
    </div>

    <!-- VIEW VEHICLE CTA (anchored to card bottom) -->
    <div class="mt-auto pt-2">
      <button
        onclick="event.stopPropagation(); viewVehicle('${v.id}')"
        class="w-full h-10 group cursor-pointer flex items-center justify-center gap-3 rounded-[12px] font-semibold text-[13px] transition-all duration-300 ${v.is_featured ? 'bg-[#E48A2F] hover:bg-[#D67E2C] text-white' : 'bg-[#005BBF] hover:bg-[#004FA8] text-white'}"
      >
        <span class="
          relative
          after:absolute
          after:left-0
          after:bottom-[-4px]
          after:h-[2px]
          after:w-0
          after:bg-current
          after:transition-all
          after:duration-300
          group-hover:after:w-full
        ">
          View Vehicle
        </span>
      </button>
    </div>

  </div>

</div>
`;
}
