/* ============================================================
   HUFA GUEST LIBRARY
   ------------------------------------------------------------
   Single source of truth for the GUEST (unauthenticated) Save +
   Compare limits and their browser-side persistence.

   • Guests may save / compare up to 2 vehicles without signing in.
   • Guest selections live ONLY in localStorage (never in Supabase)
     and are identified by the vehicle's existing id/code.
   • Signed-in users keep the existing behaviour untouched:
       - Save    → saved_vehicles database workflow
       - Compare → per-user "compare_<userId>" list (js/ui.js)

   This module deliberately imports nothing from js/ui.js so the
   dependency graph stays acyclic (js/ui.js imports FROM here).
   ============================================================ */

import { supabase, getAuthUser } from "./api.js";

/* ---------- CENTRALISED GUEST LIMITS ----------
   Do not hard-code these numbers anywhere else. */

export const GUEST_SAVE_LIMIT = 2;

export const GUEST_COMPARE_LIMIT = 2;

/* ---------- STORAGE KEYS ---------- */

export const GUEST_SAVED_KEY = "hufa_guest_saved_vehicles";

export const GUEST_COMPARE_KEY = "hufa_guest_compare_vehicles";

/* ---------- LOW-LEVEL STORAGE ---------- */

function readList(key){

  try{

    const parsed = JSON.parse(
      localStorage.getItem(key) || "[]"
    );

    return Array.isArray(parsed)
      ? parsed.filter(Boolean)
      : [];

  }catch(e){

    return [];

  }

}

function writeList(key, ids, limit){

  try{

    localStorage.setItem(
      key,
      JSON.stringify(
        (Array.isArray(ids) ? ids : []).slice(0, limit)
      )
    );

  }catch(e){

    /* storage unavailable — guest state simply will not persist */

  }

}

function dispatchGuestSaved(){

  window.dispatchEvent(
    new CustomEvent("guestSavedUpdated")
  );

}

/* ============================================================
   GUEST SAVED VEHICLES
   ============================================================ */

export function getGuestSaved(){

  return readList(GUEST_SAVED_KEY).slice(0, GUEST_SAVE_LIMIT);

}

export function setGuestSaved(ids){

  writeList(GUEST_SAVED_KEY, ids, GUEST_SAVE_LIMIT);

}

export function isGuestSaved(id){

  return getGuestSaved().includes(id);

}

/* Add a vehicle to the guest saved list.
   Returns { ok:true }                 when added / already saved
           { ok:false, reason:"limit" } when the guest limit blocks it */
export function addGuestSaved(id){

  const list = getGuestSaved();

  if(list.includes(id)){
    return { ok:true, saved:true };
  }

  if(list.length >= GUEST_SAVE_LIMIT){
    return { ok:false, reason:"limit" };
  }

  setGuestSaved([...list, id]);

  dispatchGuestSaved();

  return { ok:true, saved:true };

}

export function removeGuestSaved(id){

  setGuestSaved(
    getGuestSaved().filter(x => x !== id)
  );

  dispatchGuestSaved();

}

export function clearGuestSaved(){

  try{
    localStorage.removeItem(GUEST_SAVED_KEY);
  }catch(e){
    /* ignore */
  }

  dispatchGuestSaved();

}

/* ============================================================
   SIGN-IN TRANSITION (smallest safe migration)
   ------------------------------------------------------------
   Guest selections are NOT thrown away when a guest signs in.
   The locally saved ids are upserted into the existing
   saved_vehicles table for the new user (ON CONFLICT makes this
   idempotent — no duplicate rows), then the guest list is cleared.
   If the write fails the guest list is preserved so nothing is lost.

   The authenticated database design is completely unchanged.
   ============================================================ */

export async function migrateGuestSavedVehicles(){

  const ids = getGuestSaved();

  if(!ids.length){
    return;
  }

  try{

    const user = await getAuthUser();

    if(!user?.id){
      return;
    }

    const rows =
      ids.map(vehicle_id => ({
        user_id: user.id,
        vehicle_id
      }));

    const { error } =
      await supabase
      .from("saved_vehicles")
      .upsert(rows, { onConflict: "user_id,vehicle_id" });

    if(error){
      return;
    }

    clearGuestSaved();

  }catch(e){

    /* silent — the guest list is kept for a later attempt */

  }

}

/* Preserve guest saves on sign-in. Sign-out is a no-op
   (no authenticated user → early return). */
window.addEventListener(
  "authChanged",
  () => { migrateGuestSavedVehicles(); }
);
