/*
=========================================================
HUFA SHARED CATALOGUE SERVICE
=========================================================
*/

import { supabase } from "./api.js";
import { MAKES } from "./searchData.js";

/* =========================================================
SESSION CACHE
========================================================= */

let catalogLoaded = false;

/* In-flight loader — prevents duplicate catalogue downloads
   when several components call loadCatalog() simultaneously. */

let catalogLoadPromise = null;

const cache = {

makes: [],

models: [],

variants: [],

categories: {}

};

/* =========================================================
CLEAR CACHE
========================================================= */

export function refreshCatalog(){

catalogLoaded = false;

catalogLoadPromise = null;

cache.makes = [];
cache.models = [];
cache.variants = [];
cache.categories = {};

}

/* =========================================================
LOAD CATALOGUE
========================================================= */

export async function loadCatalog(){

if(catalogLoaded){

return cache;

}

/* 🔥 PERFORMANCE FIX — SINGLE FETCH
   Previously loadMakes(), loadModels() and loadVariants()
   EACH downloaded the entire variants table (3 identical
   full-table requests). One request now populates all three
   caches, and concurrent callers share a single in-flight
   promise instead of issuing duplicate downloads. */

if(!catalogLoadPromise){

catalogLoadPromise =
loadAllVariants()
.then(rows=>{

cache.variants = rows;

cache.models = rows;

cache.makes =

[

...new Set(

rows

.map(item=>item.make?.trim())

.filter(value=>value)

)

]

.sort((a,b)=>a.localeCompare(b));

catalogLoaded = true;

return cache;

})

.catch(error=>{

console.error(

"Catalogue load failed:",

error

);

/* Allow a retry on the next call after a failure */

catalogLoadPromise = null;

return cache;

});

}

await catalogLoadPromise;

return cache;

}

/* =========================================================
LOAD ALL VARIANTS (PAGED)
========================================================= */

async function loadAllVariants(){

const pageSize = 500;

let from = 0;

let rows = [];

while(true){

const {

data,

error

} = await supabase

.from("variants")

.select(`

make,
model,
variant,
vehicle_category

`)

.range(

from,

from + pageSize - 1

);

if(error){

throw error;

}

rows.push(

...(data || [])

);

if(!data || data.length < pageSize){

break;

}

from += pageSize;

}

return rows;

}

/* =========================================================
LOAD GENERIC CATEGORY
========================================================= */

async function loadCategory(category){

if(cache.categories[category]){
return;
}

const {

data,

error

} = await supabase

.from("vehicle_catalog")

.select("value,parent")

.eq("category", category)

.eq("active", true)

.order("display_order",{
ascending:true
});

if(error){

console.error(
    "CATEGORY ERROR:",
    category,
    error
);

cache.categories[category] = [];

return;

}

if(category === "city"){

cache.categories[category] =
(data || []).map(item=>({

value:item.value,

parent:item.parent

}));

}else if(category === "feature"){

cache.categories[category] =
(data || [])
.filter(item=>item.value)
.map(item=>({

value:item.value,

parent:item.parent,

display_order:item.display_order ?? 999

}))
.sort((a,b)=>{

if(a.parent !== b.parent){

return a.parent.localeCompare(b.parent);

}

return a.display_order - b.display_order;

});

}else{

cache.categories[category] =
(data || [])
.map(item=>item.value)
.filter(Boolean);

}

}

export async function getVehicleMakeCounts(options = {}){
  const scope = options.scope || "public";
  const sellerId = options.sellerId || null;
  const freq = {}; // lower -> Map(display -> count)
  const totals = {}; // lower -> total
  try{
    const pageSize = 1000;
    let from = 0;
    while(true){
      let q = supabase.from("vehicles").select("make,seller_id").eq("status","active");
      if(scope === "user" && sellerId){ q = q.eq("seller_id", sellerId); }
      const { data, error } = await q.range(from, from + pageSize - 1);
      if(error){ throw error; }
      (data || []).forEach(row => {
        const raw = String(row?.make || "").trim();
        if(!raw) return;
        const key = raw.toLowerCase();
        if(!freq[key]) freq[key] = {};
        freq[key][raw] = (freq[key][raw] || 0) + 1;
        totals[key] = (totals[key] || 0) + 1;
      });
      if(!data || data.length < pageSize) break;
      from += pageSize;
    }
  }catch(e){
    console.error("Make counts failed:", e);
  }
  // canonical display
  const counts = {};
  Object.keys(totals).forEach(key => {
    let canonical = null;
    const known = MAKES.find(m => String(m).trim().toLowerCase() === key);
    if(known) canonical = known;
    else {
      const entries = Object.entries(freq[key]);
      entries.sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]));
      canonical = entries.length ? entries[0][0] : key;
    }
    counts[canonical] = totals[key];
  });
  return counts;
}


export async function getVehicleBodyCounts(options = {}){
  const scope = options.scope || "public";
  const sellerId = options.sellerId || null;
  const totals = {};
  const freq = {};
  try{
    const bodyTypes = await getBodyTypes();
    const pageSize = 1000;
    let from = 0;
    while(true){
      let q = supabase.from("vehicles").select("body_type,seller_id").eq("status","active");
      if(scope === "user" && sellerId){ q = q.eq("seller_id", sellerId); }
      const { data, error } = await q.range(from, from + pageSize - 1);
      if(error){ throw error; }
      (data || []).forEach(row => {
        const raw = String(row?.body_type || "").trim();
        if(!raw) return;
        const key = raw.toLowerCase();
        if(!freq[key]) freq[key] = {};
        freq[key][raw] = (freq[key][raw] || 0) + 1;
        totals[key] = (totals[key] || 0) + 1;
      });
      if(!data || data.length < pageSize) break;
      from += pageSize;
    }
    const counts = {};
    Object.keys(totals).forEach(key => {
      const known = (bodyTypes || []).find(t => String(t).trim().toLowerCase() === key);
      const canonical = known ? String(known).trim() : (Object.entries(freq[key] || {}).sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]))[0]?.[0] || key);
      counts[canonical] = totals[key];
    });
    return counts;
  }catch(e){
    console.error("Body counts failed:", e);
    return {};
  }
}
export async function getMakes(vehicleCategory = null){

if(!catalogLoaded){

await loadCatalog();

}

if(!vehicleCategory){

return cache.makes;

}

return [

...new Set(

cache.models

.filter(item=>

item.vehicle_category === vehicleCategory &&

item.make?.trim()

)

.map(item=>item.make.trim())

)

]

.sort((a,b)=>a.localeCompare(b));

}

export async function getModels(

make,

vehicleCategory = null

){

if(!catalogLoaded){

await loadCatalog();

}

if(!make){

return [];

}

return cache.models

.filter(item=>{

if(item.make !== make){

return false;

}

if(vehicleCategory){

if(item.vehicle_category !== vehicleCategory){

return false;

}

}

return (

item.model &&

item.model.trim() !== ""

);

})

.map(

item=>item.model.trim()

)

.filter(

(value,index,array)=>

value &&

array.indexOf(value)===index

)

.sort(

(a,b)=>a.localeCompare(b)

);

}

export async function getVariants(

make,

model,

vehicleCategory = null

){

if(!catalogLoaded){

await loadCatalog();

}

if(

!make ||

!model

){

return [];

}

return cache.variants

.filter(item=>{

if(item.make !== make){

return false;

}

if(item.model !== model){

return false;

}

if(

vehicleCategory &&

item.vehicle_category !== vehicleCategory

){

return false;

}

return (

item.variant &&

item.variant.trim() !== ""

);

})

.map(

item=>item.variant.trim()

)

.filter(

(value,index,array)=>

value &&

array.indexOf(value)===index

)

.sort(

(a,b)=>a.localeCompare(b)

);

}

export async function getCategory(category){

await loadCategory(category);

return cache.categories[category] || [];

}

/* =========================================================
CATEGORY HELPERS
========================================================= */

export async function getBodyTypes(){

return getCategory("body_type");

}

export async function getFuelTypes(){

return getCategory("fuel_type");

}

export async function getTransmissionTypes(){

return getCategory("transmission");

}

export async function getDriveTypes(){

return getCategory("drive_type");

}

export async function getColours(){

return getCategory("colour");

}

export async function getConditions(){

return getCategory("condition");

}

export async function getSellerTypes(){

return getCategory("seller_type");

}

export async function getCommercialCategories(){

return getCategory("commercial_category");

}

export async function getFeatures(){

return getCategory("feature");

}

export async function getProvinces(){

return getCategory("province");

}

export async function getCities(province){

await loadCategory("city");

const cities =
cache.categories["city"] || [];

if(!province){

return cities.map(city=>city.value);

}

return cities
.filter(city=>city.parent === province)
.map(city=>city.value);

}

/* =========================================================
EV CATEGORY HELPERS
========================================================= */

export async function getBatteryCapacities(){

return getCategory("battery_capacity");

}

export async function getBatteryRanges(){

return getCategory("battery_range");

}

export async function getChargingTimes(){

return getCategory("charging_time");

}

export async function getEngineCapacities(){

return getCategory("engine_capacity_cc");

}

export async function getBatteryChemistries(){

return getCategory("battery_chemistry");

}

export async function getAcChargingOptions(){

return getCategory("ac_charging");

}

export async function getDcFastChargingOptions(){

return getCategory("dc_fast_charging");

}

export async function getEvRanges(){

return getCategory("ev_range");

}

export async function getChargePorts(){

return getCategory("charge_port");

}

export async function getChargePortLocations(){

return getCategory("charge_port_location");

}

export async function getHeatPumpOptions(){

return getCategory("heat_pump");

}

export async function getBatteryPreconditioningOptions(){

return getCategory("battery_preconditioning");

}

export async function getVehicleToLoadOptions(){

return getCategory("vehicle_to_load");

}

export async function getVehicleToHomeOptions(){

return getCategory("vehicle_to_home");

}

export async function getOnePedalDrivingOptions(){

return getCategory("one_pedal_driving");

}

export async function getRegenerativeBrakingOptions(){

return getCategory("regenerative_braking");

}

/* =========================================================
INITIALIZATION
========================================================= */

export async function initializeCatalog(){

if(catalogLoaded){

return true;

}

await loadCatalog();

return catalogLoaded;

}

/* =========================================================
CACHE STATUS
========================================================= */

export function isCatalogLoaded(){

return catalogLoaded;

}

/* =========================================================
CACHE INSPECTION
========================================================= */

export function getCatalogCache(){

console.log("HUFA CATALOG CACHE", cache);

return cache;

}

/* =========================================================
HUFA VEHICLE CATALOGUE VARIANT SELECTION (ISOLATED EXTENSION)
---------------------------------------------------------
Authoritative table: public.hufa_vehicle_catalogue.
This block is ADDITIVE ONLY: it never touches the existing
variants/vehicle_catalog caches or their return shapes.
All functions fail soft (return []) when the table is absent
or unreachable, so the legacy Make→Model→Variant flow and the
OTHER/manual fallback always keep working.
No vehicle_code is ever invented — vehicle_code is only ever
read from the database row.
========================================================= */

const HUFA_CATALOG_TABLE = "hufa_vehicle_catalogue";

const HUFA_CATALOG_COLUMNS = [
"id",
"variant_id",
"vehicle_code",
"year_active",
"introduced",
"terminated",
"vehicle_type",
"manufacturer",
"model",
"variant",
"cc",
"kw",
"doors",
"seats",
"body_style",
"fuel_type",
"transmission",
"drive_type",
"engine_size_l",
"torque_nm",
"cylinders",
"turbocharged",
"fuel_consumption_l100",
"co2_emissions_gkm",
"commercial_vehicle",
"commercial_category",
"cab_configuration",
"payload_capacity_kg",
"towing_capacity_kg",
"is_electric",
"is_hybrid",
"is_plugin_hybrid",
"battery_capacity_kwh",
"battery_range_km",
"charging_time_hours",
"fast_charging",
"charge_port",
"charge_port_location",
"powertrain_type",
"electric_range_km",
"active"
].join(",");

/* Null when unknown, false when the table is proven unreachable,
true once a query has succeeded. Lets Upload Vehicle decide
whether to show a year dropdown (catalogue years) or keep the
plain year input + legacy variant dropdown. */
let hufaCatalogAvailable = null;

export function isHufaCatalogAvailable(){
return hufaCatalogAvailable;
}

function hufaCatalogRowIsUsable(row){
if(!row || typeof row !== "object"){ return false; }
if(!row.manufacturer || !row.model){ return false; }
return true;
}

function hufaCatalogEq(query, column, value){
/* Exact match on trimmed text — mirrors existing data
conventions (makes/models are matched exactly elsewhere). */
const v = String(value ?? "").trim();
if(!v){ return query; }
return query.eq(column, v);
}

/* Distinct active year_active values for a manufacturer+model,
newest first. Never invents years. */
export async function getHufaCatalogYears(manufacturer, model){
const make = String(manufacturer ?? "").trim();
const mdl = String(model ?? "").trim();
if(!make || !mdl){ return []; }
try{
const { data, error } = await supabase
.from(HUFA_CATALOG_TABLE)
.select("year_active")
.eq("active", true)
.eq("manufacturer", make)
.eq("model", mdl)
.order("year_active", { ascending: false })
.limit(200);
if(error){ throw error; }
hufaCatalogAvailable = true;
const years = [];
for(const row of (data || [])){
const y = Number(row?.year_active);
if(!Number.isFinite(y)){ continue; }
if(!years.includes(y)){ years.push(y); }
}
return years.sort((a, b)=>b - a);
}catch(e){
/* Table missing / RLS denial / network: legacy flow continues. */
hufaCatalogAvailable = false;
return [];
}
}

/* Active catalogue records for manufacturer+model+year_active,
ordered by variant name. Only existing fields are selected. */
export async function getHufaCatalogVariants(manufacturer, model, yearActive){
const make = String(manufacturer ?? "").trim();
const mdl = String(model ?? "").trim();
const yearNum = Number(yearActive);
if(!make || !mdl || !Number.isFinite(yearNum)){ return []; }
try{
let query = supabase
.from(HUFA_CATALOG_TABLE)
.select(HUFA_CATALOG_COLUMNS)
.eq("active", true)
.eq("year_active", yearNum)
.order("variant", { ascending: true })
.limit(200);
query = hufaCatalogEq(query, "manufacturer", make);
query = hufaCatalogEq(query, "model", mdl);
const { data, error } = await query;
if(error){ throw error; }
hufaCatalogAvailable = true;
return (data || []).filter(hufaCatalogRowIsUsable);
}catch(e){
hufaCatalogAvailable = false;
return [];
}
}
