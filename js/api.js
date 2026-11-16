import { route } from "./basePath.js";

/*
====================================================
SUPABASE CONNECTION
====================================================
*/

const SUPABASE_URL = "https://wkmsibpenpllkkjlidgu.supabase.co";

const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrbXNpYnBlbnBsbGtramxpZGd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NDA0NDcsImV4cCI6MjA4OTIxNjQ0N30.Z3OHNLueU4HcFm3WrgG6oaexmOgQbPfYNjc2_WdxDZY";

export const supabase = window.supabase.createClient(
SUPABASE_URL,
SUPABASE_KEY
);

/* ====================================================
PHASE 1 — SITE-WIDE ZIP RESTRICTION
Every storage upload passes through the shared
file validation helpers. ZIP/archive files are
rejected by extension, MIME type AND content.
==================================================== */

import {
rejectZipFile
} from "./fileValidation.js";

import { purgeUserDrafts } from "./draftStore.js";

/* PHASE 4 — user-scoped IndexedDB purge for the Upload
Vehicle image draft on sign-out (same contract as the
sessionStorage draft purge; no other data is touched). */
import { clearUploadVehicleImageDraft } from "./uploadVehicleImageStore.js";

/* PHASE 6B — user-scoped IndexedDB purge for the Trade-In
image draft on sign-out (same contract as the Upload
Vehicle image purge; no other data is touched). */
import { clearTradeInImageDraft } from "./tradeInImageStore.js";



/* ====================================================
🔥 SELLER PROFILE + LIMIT SYSTEM
==================================================== */

/* GET USER PROFILE — PHASE 2 FIX: the SOLE authoritative
   profiles loader/creator. getAuthUser() below reads auth only
   and never inserts a profiles row, so no minimal-row race is
   possible. Existing rows with missing fields are safely
   backfilled from user_metadata (missing-only; established
   values including an already-set province are never changed). */
export async function getUserProfile(){

  if(cachedProfile){
    return cachedProfile;
  }

  const user =
  await getAuthUser();

  if(!user){
    return null;
  }

  const {
    data,
    error
  } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

if(error || !data){

if(window.DEBUG_AUTH){

console.log(
    "Creating missing profile"
);

}

  const insertPayload =
    buildAuthoritativeProfileInsert(user);

  if(!insertPayload){
    return null;
  }

  insertPayload.role = "user";

  const {
    data:newProfile,
    error:createError
  } = await supabase
    .from("profiles")
    .insert(insertPayload)
    .select()
    .single();

  if(createError){

    /* PHASE 4 — PostgREST code/message only;
       never the full object (may embed row
       data such as the user id). */
    console.error(
      "Profile creation failed",
      {
        code: createError?.code,
        message: createError?.message
      }
    );

    return null;

  }

  cachedProfile =
  newProfile;

  return newProfile;

}

  /* PHASE 2 FIX — safe backfill for rows created by the old
     minimal fallback. Only missing/empty columns with meaningful
     metadata are patched; nothing established is overwritten and
     an already-set province is never changed. */
  const backfillPatch =
    buildProfileBackfillPatch(data, user);

  if(backfillPatch){

    const {
      data:repairedProfile,
      error:repairError
    } = await supabase
      .from("profiles")
      .update(backfillPatch)
      .eq("id", user.id)
      .select()
      .single();

    if(!repairError && repairedProfile){
      cachedProfile = repairedProfile;
      return repairedProfile;
    }

    if(window.DEBUG_AUTH){
      console.log(
        "Profile backfill skipped",
        repairError?.code || repairError?.message || ""
      );
    }

  }

  cachedProfile = data;

  return data;

}

/* GET USER LIMIT */
export async function getUserLimit(){

  const sub = await getUserSubscription();

  return sub?.vehicle_limit ?? 1;
}
/* CHECK IF USER CAN UPLOAD */
export async function canUploadVehicle(){

  const { data:userData } = await supabase.auth.getUser();

  if(!userData.user) return false;

  const userId = userData.user.id;

  /* GET CURRENT COUNT */
  const { count } = await supabase
    .from("vehicles")
    .select("*",{ count:"exact", head:true })
    .eq("seller_id", userId);

  const limit = await getUserLimit();

  return (count || 0) < limit;
}

window.sb = supabase;

/* PHASE 2 FIX (persistence) — ONE authoritative profile builder.
   Builds the full profiles INSERT payload from auth user_metadata.
   getUserProfile() is the ONLY profiles creator; getAuthUser()
   never inserts a profiles row (it reads auth only). Returns null
   when there is no authenticated user. No passwords, tokens,
   session data or File objects are ever included. */
function buildAuthoritativeProfileInsert(user){

  if(!user || !user.id){
    return null;
  }

  const meta = user.user_metadata || {};

  const metaSocialLinks =
    meta.social_links &&
    typeof meta.social_links === "object" &&
    !Array.isArray(meta.social_links)
      ? meta.social_links
      : {};

  const pickText = (key) =>
    typeof meta[key] === "string" && meta[key].trim()
      ? meta[key].trim()
      : null;

  /* PHASE 4 — canonical name alias. Historic signup metadata may carry
     the given name under alternate keys; profiles.name is written from
     either one so legacy readers always have a value. */
  const givenName =
    pickText("first_name") ||
    pickText("name");

  /* PHASE 2 (NEW-DEALERSHIP CONTINUITY) — the payload is restricted to
     columns that ACTUALLY EXIST on the live public.profiles table
     (verified against the live schema cache). PostgREST validates the
     insert payload against the schema cache BEFORE RLS, so ONE unknown
     column makes the whole INSERT fail with PGRST204
     ("Could not find the 'first_name' column of 'profiles' in the schema
     cache") and NO profile row is ever created. That is exactly why a new
     dealership account never reached the dealer dashboard, never showed
     "Edit Dealership Page" and never appeared in the public /dealerships
     directory, while existing dealerships (whose rows already exist) were
     unaffected.

     first_name / mobile_number / whatsapp_number / bio / location / city /
     website are NOT columns of public.profiles. Those signup values stay
     in auth user_metadata (schemaless — no data loss, no duplication, and
     province/city are not re-collected or duplicated anywhere) and are no
     longer written to a non-existent column.

     suspended:false is set explicitly because EVERY existing profiles row
     (including every working dealership) carries suspended = false and the
     public directory filters on it (neq true). Writing the same explicit
     value keeps a new dealership in exactly the same state as the working
     reference dealership instead of relying on NULL comparison
     semantics. No schema change, no package/limit change, no vehicle
     logic touched. */
  return {
    id: user.id,
    name: givenName,
    surname: pickText("surname"),
    email: user.email || null,
    account_type:
      meta.account_type === "dealer" ||
      meta.account_type === "private"
        ? meta.account_type
        : "private",
    dealership_name: pickText("dealership_name"),
    dealership_logo: pickText("dealership_logo"),
    dealership_email: pickText("dealership_email"),
    phone: pickText("phone"),
    dealership_address: pickText("dealership_address"),
    social_links: metaSocialLinks,
    province: pickText("province"),
    avatar_url: pickText("avatar_url"),
    suspended: false
  };

}

/* PHASE 2 FIX — canonical province allowlist for backfill guard.
   Mirrors SIGNUP_PROVINCES in pages/signup.js so only a valid
   canonical metadata value may set an empty profiles.province. */
const AUTHORITATIVE_PROVINCES = [
  "Gauteng",
  "Western Cape",
  "KwaZulu-Natal",
  "Eastern Cape",
  "Free State",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape"
];

function isCanonicalProvince(value){
  const raw = String(value || "").trim().toLowerCase();
  if(!raw){
    return false;
  }
  return AUTHORITATIVE_PROVINCES.some(
    (name) => name.toLowerCase() === raw
  );
}

function canonicalProvince(value){
  const raw = String(value || "").trim().toLowerCase();
  return AUTHORITATIVE_PROVINCES.find(
    (name) => name.toLowerCase() === raw
  ) || String(value || "").trim();
}

/* PHASE 2 FIX — missing-value helper for safe backfill.
   Only genuinely missing profile fields are repaired; real user
   edits are never overwritten by stale metadata. */
function isMissingProfileValue(value){
  if(value === null || value === undefined){
    return true;
  }
  if(typeof value === "string"){
    return value.trim() === "";
  }
  if(typeof value === "object" && !Array.isArray(value)){
    return Object.keys(value).length === 0;
  }
  return false;
}

/* PHASE 4 — safe metadata to profiles backfill patch builder.
   Returns null when nothing needs repair. Established values,
   including an already-set profiles.province, are never touched.
   PHASE 4 — probe BOTH name aliases when deciding whether the legacy
   name column needs repair, so first_name-only rows are not left with
   a blank name that Edit Profile older readers display. */
function buildProfileBackfillPatch(profile, user){
  if(!profile || !user){
    return null;
  }
  const meta = user.user_metadata || {};
  const patch = {};
  const considerText = (column, metaKey) => {
    const current = profile[column];
    const incoming = meta[metaKey];
    if(
      isMissingProfileValue(current) &&
      typeof incoming === "string" &&
      incoming.trim() !== ""
    ){
      patch[column] = incoming.trim();
    }
  };
  const considerName = (column) => {
    const current = profile[column];
    const incoming =
      typeof meta.first_name === "string" && meta.first_name.trim() !== ""
        ? meta.first_name.trim()
        : (
          typeof meta.name === "string" && meta.name.trim() !== ""
            ? meta.name.trim()
            : ""
        );
    if(isMissingProfileValue(current) && incoming){
      patch[column] = incoming;
    }
  };
  /* PHASE 2 (NEW-DEALERSHIP CONTINUITY) — only REAL public.profiles
     columns participate in the repair. The payload keys are filtered
     against this allowlist before the UPDATE is sent, so a single
     unknown/non-existent column can never make the whole backfill fail
     with PGRST204 (PostgREST validates keys against the schema cache
     before RLS) and leave a brand-new dealership row half-populated.
     profiles.first_name, mobile_number, whatsapp_number, bio, location,
     city and website do not exist in the live schema — those signup
     values remain in auth user_metadata and are simply not mirrored. */
  const PROFILE_REPAIR_COLUMNS = [
    "name",
    "surname",
    "dealership_name",
    "dealership_email",
    "phone",
    "dealership_address",
    "dealership_logo",
    "avatar_url",
    "social_links",
    "province"
  ];
  considerName("name");
  considerText("surname", "surname");
  considerText("dealership_name", "dealership_name");
  considerText("dealership_email", "dealership_email");
  considerText("phone", "phone");
  considerText("dealership_address", "dealership_address");
  considerText("avatar_url", "avatar_url");
  considerText("dealership_logo", "dealership_logo");
  if(
    isMissingProfileValue(profile.social_links) &&
    meta.social_links &&
    typeof meta.social_links === "object" &&
    !Array.isArray(meta.social_links) &&
    Object.keys(meta.social_links).length > 0
  ){
    patch.social_links = meta.social_links;
  }
  if(
    isMissingProfileValue(profile.province) &&
    typeof meta.province === "string" &&
    meta.province.trim() !== "" &&
    isCanonicalProvince(meta.province)
  ){
    patch.province = canonicalProvince(meta.province);
  }
  for(const key of Object.keys(patch)){
    if(!PROFILE_REPAIR_COLUMNS.includes(key)){
      delete patch[key];
    }
  }
  if(Object.keys(patch).length === 0){
    return null;
  }
  return patch;
}

/* =========================================
🔥 CENTRAL AUTH CACHE
========================================= */

let cachedUser = null;
let cachedProfile = null;

/* GET AUTH USER — PHASE 2 FIX: auth only. Never creates a
   profiles row (getUserProfile() is the sole creator), so no
   minimal-row race is possible. Public behavior preserved:
   returns the cached Supabase auth user or fetches it fresh. */
export async function getAuthUser(){

  if(cachedUser){
    return cachedUser;
  }

  const {
  data:{ user }
} = await supabase.auth.getUser();

cachedUser =
user || null;

  return cachedUser;

}

/* CLEAR AUTH CACHE */
export function clearAuthCache(){

  cachedUser = null;
  cachedProfile = null;
  cachedSubscription = null;

}

/* =========================================
🔥 ROLE HELPERS
========================================= */

export async function isAuthenticated(){

  const user =
  await getAuthUser();

  return !!user;

}

export async function isDealer(){

  const profile =
  await getUserProfile();

  return (
    profile?.account_type ===
    "dealer"
  );

}

export async function isPrivateSeller(){

  const profile =
  await getUserProfile();

  return (
    profile?.account_type ===
    "private"
  );

}

export async function isAdmin(){

  const profile =
  await getUserProfile();

  return (
    profile?.role ===
    "admin"
  );

}

let cachedSubscription = null;

export async function getUserSubscription(){

  if(cachedSubscription){
    return cachedSubscription;
  }

  const profile = await getUserProfile();
  if(!profile) return null;

  if(!profile.subscription_id){

    /* PHASE 4 — the SIGNUP-SELECTED package drives this fallback.
       Signup tags every new account with its chosen plan in auth
       user_metadata (selected_plan — "Launch Promotion" is the only
       package currently offered). Accounts created without an
       explicit subscription therefore resolve to THAT package so
       the existing per-account-type limits (private 5 active /
       2 featured, dealer 50 / 15) apply. Accounts predating the
       signup tag — and any blank metadata value — keep resolving
       to Launch Promotion, so no existing account changes
       behaviour. vehicle_limit is a fallback baseline only; the
       active-listing limit is resolved by account type in the
       dashboard package-limit logic. */
    const user =
    await getAuthUser();

    const metaSelectedPlan =
    typeof user?.user_metadata?.selected_plan === "string"
      ? user.user_metadata.selected_plan.trim()
      : "";

    return {
      name: metaSelectedPlan || "Launch Promotion",
      vehicle_limit: 5
    };
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("id", profile.subscription_id)
    .single();

  if(error || !data){
    if(window.DEBUG_AUTH){

console.warn(
"Subscription fetch failed"
);

}
    return {
      name: "Private Basic",
      vehicle_limit: 1
    };
  }

  cachedSubscription = data;

  return data;
}

/* =========================================
🔥 AUTH STATE CONTROL (STRICT MODE - FIXED)
========================================= */

/* PHASE 1 — last authenticated user id for surgical draft
isolation. Captured on SIGNED_IN so SIGNED_OUT can purge
ONLY that user's hufa:draft:* keys. */
let lastAuthUserId = null;


supabase.auth.onAuthStateChange(
async (event, session) => {

if(window.DEBUG_AUTH){

console.log(
    "AUTH EVENT:",
    event
);

}

  /* =====================================
  UPDATE AUTH CACHE
  ===================================== */

  cachedUser =
  session?.user || null;

if(!session?.user){
    cachedProfile = null;
    cachedSubscription = null;
}

  /* PHASE 1 — capture id on sign-in; purge ONLY that
  user's hufa:draft:* keys on sign-out. */
  if(session?.user?.id){
    lastAuthUserId = session.user.id;
  }

  if(event === "SIGNED_OUT" && lastAuthUserId){
    purgeUserDrafts(lastAuthUserId);
    /* PHASE 4 — also purge ONLY that user's IndexedDB
    Upload Vehicle image draft. Same surgical scope: the
    record key IS the user id, so no other user's data and
    no other database is ever touched. */
    await clearUploadVehicleImageDraft(lastAuthUserId);
    /* PHASE 6B — also purge ONLY that user's IndexedDB
    Trade-In image draft. Same surgical scope: the record
    key IS the user id, so no other user's data and no other
    database is ever touched. */
    await clearTradeInImageDraft(lastAuthUserId);
    lastAuthUserId = null;
  }


  /* =====================================
  EMAIL VERIFICATION DETECTION
  ===================================== */

  if(event === "SIGNED_IN"){

    const fullUrl =
    window.location.href;

    const isVerification =
      fullUrl.includes("access_token") &&
      fullUrl.includes("type=signup");

    if(isVerification){

      if(window.DEBUG_AUTH){

console.log(
"Email verification detected → forcing login"
);

}

      await supabase.auth.signOut();

      if(window.navigate){
        window.navigate("/login");
      }else{
        window.location.replace(
          route("/login")
        );
      }

      return;

    }

  }

  /* =====================================
  PASSWORD RECOVERY DETECTION (PHASE 11)
  ===================================== */

  if(event === "PASSWORD_RECOVERY"){

    /* A recovery link signed the user in through
       Supabase Auth. Only a boolean marker is
       kept — the session, its tokens and any
       credentials are never read or logged. The
       /reset-password page picks the flow up
       through the normal session state. */

    window.__HUFA_PASSWORD_RECOVERY__ = true;

  }

  /* =====================================
  FORCE NAVBAR REFRESH
  ===================================== */

  window.dispatchEvent(
    new CustomEvent(
      "authChanged",
      { detail: { event, authenticated: Boolean(session?.user) } }
    )
  );

});

/* =========================================
🔥 PHASE 3 — MFA (TOTP) HELPERS
Thin helpers over the EXISTING Supabase Auth
MFA APIs (supabase.auth.mfa.*). No custom TOTP
logic is implemented here and no client-side
"MFA passed" boolean exists — the Supabase
Authenticator Assurance Level (AAL) is the
single source of truth.

Nothing in this section is cached: factor state
is always read fresh so a factor enrolled or
removed in another tab is reflected immediately.
No factor ids, secrets, codes or challenge ids
are ever logged or stored.
========================================= */

/* CURRENT vs NEXT ASSURANCE LEVEL
   Returns { currentLevel, nextLevel,
   currentLevelCandidates } for the signed-in
   session, or null when unavailable. */
export async function getMfaAssurance(){

  try{

    const { data, error } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if(error){
      return null;
    }

    return data || null;

  }catch(err){
    return null;
  }

}

/* MFA OWED?
   True when password authentication succeeded
   (currentLevel "aal1") but a VERIFIED second
   factor is still owed (nextLevel "aal2").
   This is the exact signal used by BOTH the
   centralized router guard and the login flow.
   nextLevel only reports "aal2" for factors with
   status "verified" — an unverified enrollment
   can never trigger it. */
export async function needsMfaVerification(){

  const user =
  await getAuthUser();

  if(!user){
    return false;
  }

  const assurance =
  await getMfaAssurance();

  if(!assurance){
    return false;
  }

  return (
    assurance.currentLevel === "aal1" &&
    assurance.nextLevel === "aal2"
  );

}

/* VERIFIED TOTP FACTOR
   Returns the user's verified TOTP factor, or
   null. Unverified enrollments are deliberately
   ignored — only "verified" factors count as
   enabled MFA. */
export async function getVerifiedTotpFactor(){

  try{

    const { data, error } =
      await supabase.auth.mfa.listFactors();

    if(error || !data){
      return null;
    }

    const factors =
    Array.isArray(data.totp) ? data.totp : [];

    return (
      factors.find(
        (f) => f?.status === "verified"
      ) || null
    );

  }catch(err){
    return null;
  }

}

/* GENERIC MFA ERROR MESSAGE
   Maps a Supabase MFA failure to a short,
   user-facing message. Raw Supabase internals,
   tokens, codes and challenge ids are never
   surfaced, logged or stored. */
export function describeMfaError(error){

  const status =
  error?.status;

  const code =
  String(error?.code || "").toLowerCase();

  const message =
  String(error?.message || "").toLowerCase();

  if(
    status === 429 ||
    code.includes("rate") ||
    message.includes("too many") ||
    message.includes("rate limit")
  ){
    return "Too many attempts. Please wait a moment and try again.";
  }

  if(
    status === 400 ||
    status === 403 ||
    status === 422 ||
    code.includes("totp") ||
    code.includes("invalid") ||
    message.includes("totp") ||
    message.includes("invalid") ||
    message.includes("expired")
  ){
    return "That code is incorrect or has expired. Please try again.";
  }

  return "Something went wrong. Please try again.";

}

/* PHASE 4 — GENERIC AUTH ERROR MESSAGE
   Maps a Supabase Auth failure to a short,
   security-safe, user-facing message. Raw
   Supabase internals are never shown to users
   and never logged.

   The password-recovery pages keep their own
   generic messaging (account enumeration must
   stay impossible); this helper is used by the
   login, signup and reset-password error paths. */
export function describeAuthError(error, context){

  const code =
  String(error?.code || "").toLowerCase();

  const status =
  error?.status;

  const message =
  String(error?.message || "").toLowerCase();

  const ctx =
  String(context || "").toLowerCase();

  if(
    status === 429 ||
    code.includes("rate") ||
    message.includes("too many") ||
    message.includes("rate limit")
  ){
    return "Too many attempts. Please wait a moment and try again.";
  }

  if(
    code.includes("invalid_credentials") ||
    message.includes("invalid login credentials") ||
    message.includes("invalid email or password")
  ){
    return ctx === "signup"
      ? "Could not create your account. Please check your details and try again."
      : "Invalid email or password. Please try again.";
  }

  if(
    code.includes("email_not_confirmed") ||
    message.includes("email not confirmed")
  ){
    return "Please confirm your email address first — check your inbox for the verification link.";
  }

  if(
    code.includes("user_already_exists") ||
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("user already exists")
  ){
    return "An account with this email address already exists. Try logging in instead.";
  }

  if(
    code.includes("weak_password") ||
    code.includes("password_too_short") ||
    message.includes("password should be at least") ||
    message.includes("password is too weak")
  ){
    return "That password is too weak. Please choose a stronger one.";
  }

  if(
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("failed to fetch") ||
    message.includes("connection")
  ){
    return "Connection issue — please check your internet and try again.";
  }

  if(ctx === "resetPassword"){
    return "Could not update your password. Please try again.";
  }

  if(ctx === "signup"){
    return "Could not create your account. Please try again.";
  }

  return "Something went wrong. Please try again.";

}

/* =========================================
🔥 VEHICLE INTEREST + LEAD SYSTEM
========================================= */

export async function createVehicleInterest({

  vehicleId,
  sellerId,
  buyerFirstName,
  buyerName,
  buyerEmail,
  buyerPhone,
  buyerSurname,
  buyerMessage

}){

  /* =====================================
  CONFIRM THE LIVE SESSION BEFORE INSERT

  getUser() alone can report a user while the
  underlying access token attached to REST
  requests is missing or expired — PostgREST
  then evaluates the INSERT as "anon", no
  INSERT RLS policy applies, and the database
  returns 42501 "new row violates row-level
  security policy". Reading the actual session
  (and refreshing it when stale) guarantees
  supabase-js sends a current authenticated
  JWT with the insert.
  ===================================== */

  let { data:sessionData } =
  await supabase.auth.getSession();

  if(!sessionData?.session){
    return {
      error: "LOGIN_REQUIRED"
    };
  }

  /* Refresh proactively if the token is expired
     or expiring within 60 seconds */
  const expiresAtMs =
  sessionData.session.expires_at
    ? sessionData.session.expires_at * 1000
    : null;

  if(
    expiresAtMs &&
    Date.now() > expiresAtMs - 60000
  ){

    const { data:refreshed } =
    await supabase.auth.refreshSession();

    if(!refreshed?.session){
      return {
        error: "LOGIN_REQUIRED"
      };
    }

    sessionData = refreshed;

  }

  /* buyer_id always comes from the SAME live
     session that signs the INSERT request, so
     it is guaranteed to equal auth.uid()
     inside the existing RLS policy */
  const user = sessionData.session.user;

  /* =====================================
  PREVENT DUPLICATES
  ===================================== */

  const { data:existing } =
  await supabase
    .from("vehicle_interest")
    .select("id")
    .eq("vehicle_id", vehicleId)
    .eq("buyer_id", user.id)
    .maybeSingle();

  if(existing){

    return {
      error: "ALREADY_INTERESTED"
    };

  }

  /* =====================================
  CREATE INTEREST
  ===================================== */

  /* Single contact detail is stored in buyer_name for
     backward-compatibility; surname + message are persisted
     in the newer buyer_surname / buyer_message columns when
     the migration has been applied. */
  const basePayload = {

    vehicle_id: vehicleId,
    seller_id: sellerId,
    buyer_id: user.id,

    buyer_name: buyerName,
    buyer_email: buyerEmail,
    buyer_phone: buyerPhone

  };

  if(buyerSurname != null){
    basePayload.buyer_surname = buyerSurname;
  }

  if(buyerMessage != null){
    basePayload.buyer_message = buyerMessage;
  }

  let { error } =
  await supabase
    .from("vehicle_interest")
    .insert(basePayload);

  /* Fallback: if the extended columns don't exist yet
     (migration not applied), retry with only the original
     columns so interest still registers.
     PostgREST reports unknown insert payload columns as
     PGRST204 ("Could not find the 'x' column ... schema
     cache"); 42703 is the raw Postgres SQLSTATE. */
  if(
    error &&
    (String(error.code) === "PGRST204" ||
     String(error.code) === "42703")
  ){

    const { error: fallbackError } =
    await supabase
      .from("vehicle_interest")
      .insert({

        vehicle_id: vehicleId,
        seller_id: sellerId,
        buyer_id: user.id,

        buyer_name: buyerName,
        buyer_email: buyerEmail,
        buyer_phone: buyerPhone

      });

    error = fallbackError;

  }

  if(error){

    /* Structured console output for debugging.
       Supabase PostgREST errors contain only
       code/message/details/hint — never tokens. */
    console.error("Vehicle interest failed:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint
    });

    return {
      error: "INSERT_FAILED",
      code: error.code || null
    };

  }

  /* =====================================
  CREATE CRM LEAD (enquiries)
  The existing CRM/lead system is the
  `enquiries` table (the same table the
  Contact Seller flow and the CRM dashboard
  use). Writing here surfaces the interest as
  a real CRM lead with status "interested",
  linked to the vehicle + dealer, and carrying
  the buyer's details. We reuse that structure
  instead of building a parallel CRM.
  ===================================== */

  const { data:veh } =
  await supabase
    .from("vehicles")
    .select("make,model,year")
    .eq("id", vehicleId)
    .single();

  const vehicleTitle =
  veh
  ? [veh.year, veh.make, veh.model]
    .filter(Boolean)
    .join(" ")
  : "";

  const enquiryPayload = {

    user_id: user.id,
    seller_id: sellerId,
    vehicle_id: vehicleId,

    vehicle_title: vehicleTitle,

    lead_source: "vehicle_interest",

    name: buyerFirstName || buyerName || "",
    surname: buyerSurname || "",
    email: buyerEmail || "",
    phone: buyerPhone || "",

    /* Default message makes the purchase intent explicit */
    message:
    (buyerMessage || "").trim()
    || `Interested in purchasing this ${vehicleTitle || "vehicle"}.`,

    status: "interested"

  };

  let enquiryResult =
  await supabase
    .from("enquiries")
    .insert(enquiryPayload)
    .select("id")
    .single();

  let enquiryError = enquiryResult.error;
  let enquiryLeadId = enquiryResult.data?.id || null;

  /* Fallback: drop the newer columns if they haven't been
     migrated yet so the lead still registers. PostgREST
     reports unknown insert payload columns as PGRST204;
     42703 is the raw Postgres SQLSTATE. */
  if(
    enquiryError &&
    (String(enquiryError.code) === "PGRST204" ||
     String(enquiryError.code) === "42703")
  ){

    const { error: fb, data: fbData } =
    await supabase
      .from("enquiries")
      .insert({

        user_id: user.id,
        seller_id: sellerId,
        vehicle_id: vehicleId,

        name: buyerFirstName || buyerName || "",
        email: buyerEmail || "",
        phone: buyerPhone || "",

        message:
        (buyerMessage || "").trim()
        || `Interested in purchasing this vehicle.`,

        status: "interested"

      })
      .select("id")
      .single();

    enquiryError = fb;
    enquiryLeadId = fbData?.id || enquiryLeadId;

  }

  if(enquiryError){

    console.error("CRM lead (enquiries) write failed:", {
      code: enquiryError.code,
      message: enquiryError.message,
      details: enquiryError.details,
      hint: enquiryError.hint
    });

    /* The interest was still recorded in vehicle_interest;
       surface a soft warning so the caller knows. */
    return {
      error: "ENQUIRY_WRITE_FAILED",
      code: enquiryError.code || null
    };

  }

  /* =====================================
  CREATE DEALER NOTIFICATION
  ===================================== */

  await supabase
    .from("notifications")
    .insert({

      user_id: sellerId,

      title: "New Interested Buyer",

      message:
      `${buyerName || "A buyer"} is interested in your vehicle. Contact them at ${buyerEmail || "their email"}${buyerPhone ? ` or ${buyerPhone}` : ""}.${buyerSurname ? ` (${buyerSurname})` : ""}${buyerMessage ? ` Details: ${buyerMessage}` : ""}`

    });

  /* =====================================
  CRM NOTIFICATION — surfaces immediately in
  the dealer's CRM notification panel + badge.
  Best-effort: the preceding `notifications`
  insert is the guaranteed path; if the CRM
  notification can't be written (e.g. RLS
  scoping this request to the buyer), the
  interest submission still succeeds.
  ===================================== */

  if(enquiryLeadId){

    try{

      await supabase
        .from("crm_notifications")
        .insert({

          lead_id: enquiryLeadId,
          dealer_id: sellerId,

          title: "New Vehicle Interest",

          message:
          `${buyerFirstName || buyerName || "A buyer"}${buyerSurname ? ` ${buyerSurname}` : ""} is interested in ${vehicleTitle || "your vehicle"}. Please follow up.`

        });

    }catch(crmNotifError){

      console.warn(
        "CRM notification insert skipped:",
        crmNotifError
      );

    }

  }

  return {
    success: true
  };

}

/* =========================================
   PHASE 1 — FINANCE APPLICATION TRACKING
   Records the vehicle page "Apply for Finance"
   action against the dealership that owns the
   vehicle.

   - Authenticated buyer: uses the details HUFA
     already has on the account (name, surname,
     email, contact number) — nothing is asked.
   - Guest: the caller passes the minimum contact
     details collected in the existing HUFA modal
     (name, surname, email, contact number);
     user_id stays NULL.

   The dealership ALWAYS comes from the existing
   vehicle -> seller relationship (vehicles.seller_id),
   never guessed by the caller.
   ========================================= */

/* Vehicle lookup used by createFinanceApplication:
   extended columns first (Phase 1 snapshot fields),
   base columns as a fallback so a missing optional
   column can never block recording the application. */

async function loadFinanceVehicle(vehicleId){

  const EXTENDED =
  "id, seller_id, make, model, variant, year, price, title";

  const BASE =
  "id, seller_id, make, model, year, price, title";

  async function fetchVehicle(columns){

    try{

      const { data, error } =
      await supabase
        .from("vehicles")
        .select(columns)
        .eq("id", vehicleId)
        .single();

      if(error){
        return null;
      }

      return data;

    }catch(err){
      return null;
    }

  }

  const vehicle = await fetchVehicle(EXTENDED);

  if(vehicle){
    return vehicle;
  }

  return await fetchVehicle(BASE);

}

export async function createFinanceApplication({

  vehicleId,
  userId,
  name,
  surname,
  email,
  phone,
  accountType,
  dealershipName

}){

  /* =====================================
     SESSION (authenticated submissions only)
     Same guard as createVehicleInterest: a stale
     access token would make PostgREST evaluate the
     INSERT as anon and the row would be rejected by
     the buyer INSERT policy (42501). Guests have no
     session and are covered by the guest INSERT
     policy from the Phase 1 migration instead.
     ===================================== */

  if(userId){

    let { data:sessionData } =
    await supabase.auth.getSession();

    if(!sessionData?.session){

      return { error: "LOGIN_REQUIRED" };

    }

    const expiresAtMs =
    sessionData.session.expires_at
      ? sessionData.session.expires_at * 1000
      : null;

    if(
      expiresAtMs &&
      Date.now() > expiresAtMs - 60000
    ){

      const { data:refreshed } =
      await supabase.auth.refreshSession();

      if(!refreshed?.session){

        return { error: "LOGIN_REQUIRED" };

      }

    }

  }

  /* =====================================
     VEHICLE — single source of truth for the
     dealership link AND the recorded vehicle
     details (make / model / variant / year / price).
     ===================================== */

  const vehicle =
  await loadFinanceVehicle(vehicleId);

  if(!vehicle?.seller_id){

    return { error: "VEHICLE_NOT_FOUND" };

  }

  /* =====================================
     PREVENT DUPLICATES (authenticated)
     One application per (buyer, vehicle) — the
     same rule pages/apply.js already uses, checked
     BEFORE the insert so a re-render or second
     click can never create a second row. The
     (user_id, vehicle_id) unique constraint from
     the migration backstops any race.
     ===================================== */

  if(userId){

    const { data:existing } =
    await supabase
      .from("finance_applications")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .eq("user_id", userId)
      .limit(1);

    if(existing?.length){

      return { error: "ALREADY_APPLIED" };

    }

  }

  /* =====================================
     INSERT — the dealership is always copied
     from vehicles.seller_id (also enforced by
     the Phase 1 INSERT policies in SQL).
     ===================================== */

  const payload = {

    user_id: userId || null,

    seller_id: vehicle.seller_id,
    vehicle_id: vehicle.id,

    vehicle_make: vehicle.make || "",
    vehicle_model: vehicle.model || "",

    vehicle_title:
      vehicle.title ||
      [
        vehicle.year,
        vehicle.make,
        vehicle.model
      ].filter(Boolean).join(" "),

    vehicle_year: Number(vehicle.year) || null,
    vehicle_variant: vehicle.variant || null,

    name: name || "",
    surname: surname || "",
    email: email || "",
    phone: phone || "",

    account_type:
      accountType || (userId ? null : "guest"),

    price: vehicle.price ?? null

  };

  if(dealershipName){

    payload.dealership_name = dealershipName;

  }

  const { error } =
  await supabase
    .from("finance_applications")
    .insert(payload);

  if(error){

    /* Unique (user_id, vehicle_id) backstop — a lost
       race reads as an already-submitted application. */
    if(String(error.code) === "23505"){

      return { error: "ALREADY_APPLIED" };

    }

    if(
      String(error.code) === "PGRST204" ||
      String(error.code) === "42703"
    ){

      /* The Phase 1 migration has not been applied yet:
         the dealership link column (seller_id) does not
         exist, so this record could never reach the
         correct dealership. Fail loudly instead of
         storing a row the dashboard cannot show. */
      console.error(
        "finance_applications is missing the Phase 1 columns. " +
        "Apply supabase/migrations/phase1_finance_application_tracking.sql —",
        error
      );

      return { error: "MIGRATION_REQUIRED" };

    }

    console.error("Finance application insert failed:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint
    });

    return {
      error: "INSERT_FAILED",
      code: error.code || null
    };

  }

  /* =====================================
     DEALER NOTIFICATION (existing pattern —
     the same notifications insert pages/apply.js
     writes). Best-effort: the application record
     above is already saved, and the notifications
     INSERT policy is authenticated-only, so guest
     submissions deliberately skip it.
     ===================================== */

  if(userId){

    const { error:notifError } =
    await supabase
      .from("notifications")
      .insert({

        user_id: vehicle.seller_id,

        title: "New Finance Application",

        message:
        `${name || "A buyer"}${surname ? " " + surname : ""} applied for financing on ${
          [
            vehicle.year,
            vehicle.make,
            vehicle.model
          ].filter(Boolean).join(" ") || "a vehicle"
        }.`

      });

    if(notifError){

      console.warn(
        "Finance application notification skipped:",
        notifError
      );

    }

  }

  return {
    success: true
  };

}

/* =========================================
🔥 MESSAGING HELPERS
========================================= */

export async function getInboxConversations(){

const user =
await getAuthUser();

if(!user){
return [];
}

const { data:messages, error } =
await supabase
.from("messages")
.select("*")
.or(
`sender_id.eq.${user.id},receiver_id.eq.${user.id}`
)
.order("created_at", {
ascending:false
});

if(error){

console.error(
"Inbox fetch failed:",
error
);

return [];

}

if(!messages?.length){
return [];
}

/* =====================================
SAFE VEHICLE IDS
===================================== */

const vehicleIds =
[
...new Set(
(messages || [])
.map(m => m.vehicle_id)
.filter(v => !!v)
)
];

/* =====================================
LOAD VEHICLES
===================================== */

let vehicleMap = {};

if(vehicleIds.length){

const { data:vehicles } =
await supabase
.from("vehicles")
.select(`
id,
make,
model,
year,
price,
image_url
`)
.in("id", vehicleIds);

(vehicles || []).forEach(v=>{

vehicleMap[v.id] = v;

});

}

/* =====================================
GROUP CONVERSATIONS
===================================== */

const grouped = {};

(messages || []).forEach(m=>{

const otherUser =
m.sender_id === user.id
? m.receiver_id
: m.sender_id;

/* =====================================
SAFE KEY
===================================== */

const key =
`${otherUser}_${m.vehicle_id || "general"}`;

if(!grouped[key]){

grouped[key] = {

vehicle:
vehicleMap[m.vehicle_id] || {

make:"General",
model:"Conversation",
year:"",
price:0

},

messages: [],

latest: m,

unread: 0,

otherUser

};

}

grouped[key].messages.push(m);

if(
!m.is_read &&
m.receiver_id === user.id
){
grouped[key].unread++;
}

});

/* =====================================
SORT
===================================== */

return Object.values(grouped)
.sort((a,b)=>{

const aDate =
new Date(
a.latest?.created_at || 0
).getTime();

const bDate =
new Date(
b.latest?.created_at || 0
).getTime();

return bDate - aDate;

});

}
/* =========================================
GET CONVERSATION THREAD
========================================= */

export async function getConversationThread({

vehicleId,
otherUserId

}){

const user =
await getAuthUser();

if(!user){
return [];
}

const { data, error } =
await supabase
.from("messages")
.select("*")
.eq("vehicle_id", vehicleId)
.order("created_at", {
ascending:true
});

if(error){

console.error(
"Thread fetch failed:",
error
);

return [];

}

return (data || []).filter(m=>

(
m.sender_id === user.id &&
m.receiver_id === otherUserId
)

||

(
m.sender_id === otherUserId &&
m.receiver_id === user.id
)

);

}

/* =========================================
SEND MESSAGE
========================================= */

export async function sendConversationMessage({

receiverId,
vehicleId,
message,
phone=""

}){

const user =
await getAuthUser();

if(!user){

return {
error:"LOGIN_REQUIRED"
};

}

if(!receiverId){

return {
error:"NO_RECEIVER"
};

}

if(!message?.trim()){

return {
error:"EMPTY_MESSAGE"
};

}

/* =====================================
INSERT MESSAGE
===================================== */

const {
data,
error
} = await supabase
.from("messages")
.insert({

sender_id:user.id,

receiver_id:receiverId,

vehicle_id:vehicleId,

message,

phone,

is_read:false

})
.select()
.single();

if(error){

console.error(
"Send message failed:",
error
);

return {
error:error.message
};

}

/* =====================================
NOTIFY RECEIVER
===================================== */

await supabase
.from("notifications")
.insert({

user_id: receiverId,

title:"New Message",

message:
message?.slice(0,80) ||
"New conversation message"

});

return {
success:true,
message:data
};

}
/* =========================================
RESOLVE LEAD CONVERSATION (CRM MESSAGE LEAD)

Resolves an enquiries row to the canonical
buyer + seller + vehicle conversation using
the SAME data model the enquiry flow in
vehicle.js uses (conversations row + messages
row). Idempotent:

- If a messages row already exists for the
  buyer/dealer/vehicle pair, nothing is
  created (resolved only).
- If the enquiry exists but the conversation
  or its initial message does not, the
  legitimate conversation is established from
  the real enquiry data (enquiry text becomes
  the initial buyer message — sent by the
  buyer, exactly as the enquiry flow does).
- If the enquiry itself cannot be found, an
  error is returned so the dealer sees a
  clear message instead of an empty inbox.
========================================= */

export async function resolveLeadConversation(leadId){

const user =
await getAuthUser();

if(!user){
return { error:"LOGIN_REQUIRED" };
}

if(!leadId){
return { error:"NO_LEAD" };
}

/* =====================================
FETCH THE REAL ENQUIRY
===================================== */

const { data:lead, error:leadError } =
await supabase
.from("enquiries")
.select("id,user_id,seller_id,vehicle_id,message,phone")
.eq("id", leadId)
.maybeSingle();

if(leadError){

console.error(
"Lead conversation lookup failed:",
leadError
);

return { error:"LEAD_LOOKUP_FAILED" };

}

if(!lead || !lead.user_id || !lead.vehicle_id){
return { error:"LEAD_NOT_FOUND" };
}

const buyerId = lead.user_id;
const dealerId = lead.seller_id || user.id;
const vehicleId = lead.vehicle_id;

/* =====================================
CHECK EXISTING MESSAGE PAIR
The same buyer + dealer + vehicle must
always resolve to the same conversation.
If any messages row already exists for
this pair/vehicle, resolve only — no
inserts, no duplicates.
===================================== */

const { data:existingMessage } =
await supabase
.from("messages")
.select("id,conversation_id")
.eq("vehicle_id", vehicleId)
.or(
`sender_id.eq.${buyerId},receiver_id.eq.${dealerId}`
)
.limit(1)
.maybeSingle();

if(existingMessage){
return {
success:true,
created:false,
conversationId:
existingMessage.conversation_id || null,
vehicle_id:vehicleId,
user_id:buyerId,
seller_id:dealerId
};
}

/* =====================================
CREATE / GET CONVERSATION
(same mechanism as vehicle.js enquiry flow)
===================================== */

let conversationId = null;

const { data:existingConversation } =
await supabase
.from("conversations")
.select("id")
.eq("buyer_id", buyerId)
.eq("seller_id", dealerId)
.eq("vehicle_id", vehicleId)
.maybeSingle();

if(existingConversation){

conversationId = existingConversation.id;

}else{

const { data:newConversation, error:conversationError } =
await supabase
.from("conversations")
.insert({
buyer_id:buyerId,
seller_id:dealerId,
vehicle_id:vehicleId
})
.select()
.single();

if(conversationError){

console.error(
"Conversation creation failed:",
conversationError
);

return { error:"CONVERSATION_CREATE_FAILED" };

}

conversationId = newConversation.id;

}

/* =====================================
SEED INITIAL MESSAGE FROM THE ENQUIRY
The enquiry text becomes the initial
buyer message — inserted BY the buyer,
exactly as the enquiry flow in
vehicle.js does.
===================================== */

const { error:messageError } =
await supabase
.from("messages")
.insert({
conversation_id:conversationId,
sender_id:buyerId,
receiver_id:dealerId,
vehicle_id:vehicleId,
message:lead.message || "Vehicle enquiry",
phone:lead.phone || ""
});

if(messageError){

console.error(
"Initial message insert failed:",
messageError
);

return { error:"MESSAGE_CREATE_FAILED" };

}

return {
success:true,
created:true,
conversationId,
vehicle_id:vehicleId,
user_id:buyerId,
seller_id:dealerId
};

}

/* =========================================
MARK CONVERSATION READ
========================================= */

export async function markConversationRead({

vehicleId,
otherUserId

}){

const user =
await getAuthUser();

if(!user){
return;
}

await supabase
.from("messages")
.update({
is_read:true
})
.eq("vehicle_id", vehicleId)
.eq("sender_id", otherUserId)
.eq("receiver_id", user.id);

}
/* =========================================
MARK MESSAGE NOTIFICATIONS READ
========================================= */

export async function markMessageNotificationsRead({

otherUserId,
vehicleId

}){

const user =
await getAuthUser();

if(!user){
return;
}

await supabase
.from("notifications")
.update({
is_read:true
})
.eq("user_id", user.id)
.ilike("title","New Message");

}

/* =========================================
TRADE-IN NEGOTIATION MESSAGING (Trade-In Centre only)
-----------------------------------------
Per-valuation thread: (trade_in_id, valuation_id).
Reads filter on BOTH columns, oldest -> newest, so one
valuation's messages never appear in another valuation.
Graceful when the migration has not run yet: every helper
returns { migrated:false } instead of throwing, and the
Trade-In modal shows a notice while offer actions keep
working. Text messages NEVER touch offer status/amount.
========================================= */

const TRADE_IN_NEGOTIATION_TABLE =
"trade_in_negotiation_messages";

function tradeInNegotiationMissingTable(error){

const code = String(error?.code || "");
const text =
String(error?.message || error?.details || "").toLowerCase();

return (
code === "42P01" ||
text.includes("does not exist") ||
text.includes("could not find the table") ||
text.includes("schema cache")
);

}

function tradeInNegotiationRole(accountType){
return accountType === "dealer" ? "dealer" : "seller";
}

export async function getTradeInNegotiationThread({
tradeInId,
valuationId,
markRead = true,
} = {}){

const user = await getAuthUser();
if(!user || !tradeInId || !valuationId){
return { messages: [], migrated: true, unread: 0 };
}

const { data, error } = await supabase
.from(TRADE_IN_NEGOTIATION_TABLE)
.select("*")
.eq("trade_in_id", tradeInId)
.eq("valuation_id", String(valuationId))
.order("created_at", { ascending: true });

if(error){
if(tradeInNegotiationMissingTable(error)){
return { messages: [], migrated: false, unread: 0 };
}
console.error("Trade-in negotiation fetch failed:", error);
return { messages: [], migrated: true, unread: 0 };
}

const messages = Array.isArray(data) ? data : [];
const unread = messages.filter(
m => m.sender_id !== user.id && !m.is_read
).length;

if(markRead && unread){
const ids = messages
.filter(m => m.sender_id !== user.id && !m.is_read && m.id)
.map(m => m.id);
if(ids.length){
await supabase
.from(TRADE_IN_NEGOTIATION_TABLE)
.update({ is_read: true })
.in("id", ids);
messages.forEach(m => {
if(ids.includes(m.id)){ m.is_read = true; }
});
}
}

return { messages, migrated: true, unread };

}

export async function sendTradeInNegotiationMessage({
tradeInId,
valuationId,
dealerId = null,
receiverId = null,
message,
} = {}){

const user = await getAuthUser();
if(!user){
return { error: "LOGIN_REQUIRED" };
}

const text = String(message || "").trim();
if(!text){
return { error: "EMPTY_MESSAGE" };
}
if(!tradeInId || !valuationId){
return { error: "NO_THREAD" };
}

let senderRole = "seller";
try{
const { data: profile } = await supabase
.from("profiles")
.select("account_type")
.eq("id", user.id)
.single();
senderRole = tradeInNegotiationRole(profile?.account_type);
}catch(_){
senderRole = "seller";
}

const { data, error } = await supabase
.from(TRADE_IN_NEGOTIATION_TABLE)
.insert({
trade_in_id: tradeInId,
valuation_id: String(valuationId),
sender_id: user.id,
sender_role: senderRole,
dealer_id: dealerId || null,
message: text.slice(0, 2000),
is_read: false,
})
.select()
.single();

if(error){
if(tradeInNegotiationMissingTable(error)){
return { error: "NOT_MIGRATED" };
}
console.error("Trade-in negotiation send failed:", error);
return { error: error.message || "SEND_FAILED" };
}

if(receiverId && receiverId !== user.id){
try{
await supabase.from("notifications").insert({
user_id: receiverId,
title: "New Trade-In Message",
message: text.slice(0, 80) || "New negotiation message",
type: "tradein_negotiation",
is_read: false,
});
}catch(_){
/* Notifications are best-effort only. */
}
}

return { success: true, message: data, migrated: true };

}

export async function getTradeInNegotiationUnread({
tradeInId,
valuationId,
} = {}){

const user = await getAuthUser();
if(!user || !tradeInId || !valuationId){
return { unread: 0, migrated: true };
}

const { data, error } = await supabase
.from(TRADE_IN_NEGOTIATION_TABLE)
.select("id")
.eq("trade_in_id", tradeInId)
.eq("valuation_id", String(valuationId))
.neq("sender_id", user.id)
.eq("is_read", false);

if(error){
if(tradeInNegotiationMissingTable(error)){
return { unread: 0, migrated: false };
}
return { unread: 0, migrated: true };
}

return { unread: (data || []).length, migrated: true };

}

/* =========================================
CRM PRODUCTIVITY LAYER
========================================= */

/* =====================================
PIN CONVERSATION
===================================== */

export async function pinConversation({

otherUserId,
vehicleId

}){

const user =
await getAuthUser();

if(!user){
return;
}

await supabase
.from("conversation_preferences")
.upsert({

user_id:user.id,

other_user_id:otherUserId,

vehicle_id:vehicleId,

is_pinned:true

});

}

/* =====================================
UNPIN CONVERSATION
===================================== */

export async function unpinConversation({

otherUserId,
vehicleId

}){

const user =
await getAuthUser();

if(!user){
return;
}

await supabase
.from("conversation_preferences")
.delete()
.eq("user_id", user.id)
.eq("other_user_id", otherUserId)
.eq("vehicle_id", vehicleId);

}

/* =====================================
ARCHIVE CONVERSATION
===================================== */

export async function archiveConversation({

otherUserId,
vehicleId

}){

const user =
await getAuthUser();

if(!user){
return;
}

await supabase
.from("conversation_preferences")
.upsert({

user_id:user.id,

other_user_id:otherUserId,

vehicle_id:vehicleId,

is_archived:true

});

}

/* =====================================
GET CONVERSATION PREFERENCES
===================================== */

export async function getConversationPreferences(){

const user =
await getAuthUser();

if(!user){
return [];
}

const { data } =
await supabase
.from("conversation_preferences")
.select("*")
.eq("user_id", user.id);

return data || [];

}

/* =========================================
PRESENCE SYSTEM
========================================= */

export async function updatePresence({

isOnline=true,
isTyping=false

}={}){

const user =
await getAuthUser();

if(!user){
return;
}

await supabase
.from("user_presence")
.upsert({

user_id:user.id,

is_online:isOnline,

is_typing:isTyping,

last_seen:
new Date().toISOString(),

updated_at:
new Date().toISOString()

});

}

/* =========================================
GET USER PRESENCE
========================================= */

export async function getUserPresence(userId){

if(!userId){
return null;
}

const { data } =
await supabase
.from("user_presence")
.select("*")
.eq("user_id", userId)
.maybeSingle();

return data || null;

}

/* =========================================
🔥 MESSAGE ATTACHMENTS
========================================= */

export async function uploadMessageAttachment({

messageId,
file

}){

const user =
await getAuthUser();

if(!user){

return {
error:"LOGIN_REQUIRED"
};

}

if(!file){

return {
error:"NO_FILE"
};

}

/* PHASE 1 — site-wide ZIP restriction.
   Message attachments keep their existing
   open format support (PDF, DOC, images, etc.)
   but ZIP/archive files are always rejected —
   by extension, MIME type AND actual content,
   before any Supabase Storage upload occurs. */

const zipCheck =
await rejectZipFile(file);

if(!zipCheck.ok){

console.error(
"Attachment rejected:",
zipCheck.error
);

return {
error:"ZIP_NOT_ALLOWED",
detail: zipCheck.error
};

}

/* =====================================
SAFE FILE NAME
===================================== */

const extension =
file.name.split(".").pop();

const fileName =
`${Date.now()}-${Math.random()
.toString(36)
.slice(2)}.${extension}`;

/* =====================================
UPLOAD TO STORAGE
===================================== */

const { error:uploadError } =
await supabase.storage
.from("message-files")
.upload(
fileName,
file,
{
cacheControl:"3600",
upsert:false
}
);

if(uploadError){

console.error(
"Attachment upload failed:",
uploadError
);

return {
error:"UPLOAD_FAILED"
};

}

/* =====================================
GET PUBLIC URL
===================================== */

const {
data:urlData
} = supabase.storage
.from("message-files")
.getPublicUrl(fileName);

const fileUrl =
urlData?.publicUrl;

/* =====================================
SAVE DATABASE RECORD
===================================== */

const { error:dbError } =
await supabase
.from("message_attachments")
.insert({

message_id: messageId,

file_url: fileUrl,

file_name: file.name,

file_type: file.type

});

if(dbError){

console.error(
"Attachment DB insert failed:",
dbError
);

return {
error:"DB_INSERT_FAILED"
};

}

return {
success:true,
fileUrl
};

}

/* =========================================
GET MESSAGE ATTACHMENTS
========================================= */

export async function getMessageAttachments(messageIds=[]){

if(!messageIds.length){
return [];
}

const { data, error } =
await supabase
.from("message_attachments")
.select("*")
.in("message_id", messageIds);

if(error){

console.error(
"Attachment fetch failed:",
error
);

return [];

}

return data || [];

}
