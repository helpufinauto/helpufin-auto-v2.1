import { supabase, describeAuthError } from "../js/api.js";
import { navigate } from "../js/router.js";
import { appUrl } from "../js/basePath.js";
import { toast } from "../js/ui.js";
import {
  PHASE2_SOCIAL_PLATFORMS,
  normalizeEditSocialValue
} from "../js/socialProfile.js";
import {
  getProvinces,
  getCities
} from "../js/catalog.js";
import {
  validateImageFile
} from "../js/fileValidation.js";
import {
  bindPasswordRequirements,
  buildPasswordRequirementsMessage,
  getUnmetPasswordRequirements,
  renderPasswordRequirements
} from "../js/passwordPolicy.js";
import { showWelcomeScreen } from "../components/welcomeScreen.js";
import {
  saveDraft as saveDraftRecord,
  loadDraft as loadDraftRecord,
  clearDraft as clearDraftRecord,
  getOrCreateAnonDraftId
} from "../js/draftStore.js";

/* PHASE 7 — Profile card avatar state. Reuses the
   SAME validation rules, "profile-images" bucket,
   per-user path convention and avatar_url field as
   the dashboard Edit Profile system. No new storage. */

const SIGNUP_AVATAR_TYPES =
[
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
];

const SIGNUP_AVATAR_MAX_SIZE =
5 * 1024 * 1024;

let signupAvatarFile = null;

/* PHASE 2 FIX — signup draft persistence (state-loss fix).
   The signup template holds state ONLY in the DOM, and
   router() rewrites #app on authChanged/popstate re-renders.
   This preserves the user's NON-SENSITIVE entries in the
   sessionStorage-backed draft foundation
   (js/draftStore.js) so a same-tab re-render restores them.
   SECURITY: passwords, password confirmation, File objects,
   avatar/image data, tokens and credentials are NEVER stored. */

const SIGNUP_DRAFT_WORKFLOW = "signup";

/* PHASE 1 — signup drafts use the shared draftStore
foundation (hufa:draft:signup:<anonId>). The anon id is a
random per-tab value (never personal data, never a shared
"anon" bucket), so same-tab refresh/navigation restores
the draft while a new tab never inherits it. */
const SIGNUP_LEGACY_STORAGE_KEY = "state:signup";

function signupUserKey(){

  const anonId = getOrCreateAnonDraftId();

  return typeof anonId === "string" && anonId
    ? anonId
    : "anon";

}

/* Existing signup draft allowlist — non-sensitive fields
only. Passwords, avatar File, tokens, MFA are never here. */
const SIGNUP_DRAFT_ALLOWLIST = new Set([
  "name",
  "surname",
  "email",
  "accountType",
  /* PHASE 3 — merged-record aliases. collectSignupDraft() now persists
     the WHOLE form in ONE record; historic per-section drafts may carry
     these snake_case keys. Same draftStore foundation, no second system. */
  "account_type",
  "dealership",
  "dealerEmail",
  "dealer_email",
  "dealerPhone",
  "dealer_phone",
  "dealerAddress",
  "dealer_address",
  "dealerProvince",
    "dealerCity",
  "dealer_city",
  "profileProvince",
  "profileCity",
  "provinceUserSelected",
  "profile_province",
  "profile_city",
  "mobileNumber",
  "phone",
  "whatsappNumber",
  "alternativeContact",
  "profileBio",
  "profileLocation",
  "profileWebsite",
  "socialLinks",
  "socials",
  "package"
]);

function isSafeSignupDraft(value){

  if(
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ){
    return false;
  }

  for(const key of Object.keys(value)){

    if(!SIGNUP_DRAFT_ALLOWLIST.has(key)){
      return false;
    }

    if(key === "socialLinks"){

      if(
        !value[key] ||
        typeof value[key] !== "object" ||
        Array.isArray(value[key])
      ){
        return false;
      }

      for(const sk of Object.keys(value[key])){
        if(typeof value[key][sk] !== "string"){
          return false;
        }
      }

      continue;

    }

    if(typeof value[key] !== "string"){
      return false;
    }

  }

  return true;

}

/* One-time safe migration: read the old state:signup key
once, keep only allowlisted strings, write it to the new
key, then remove the old key only after a successful
write. Never migrates passwords (they were never stored)
or File/Blob data. */
function migrateLegacySignupDraftOnce(){

  let raw = null;

  try{
    raw = sessionStorage.getItem(SIGNUP_LEGACY_STORAGE_KEY);
  }catch(e){
    return;
  }

  if(!raw){
    return;
  }

  let parsed = null;

  try{
    parsed = JSON.parse(raw);
  }catch(e){
    return;
  }

  if(!isSafeSignupDraft(parsed)){
    return;
  }

  const ok = saveDraftRecord(
    SIGNUP_DRAFT_WORKFLOW,
    signupUserKey(),
    parsed,
    { accountType: parsed.accountType || parsed.account_type || "" }
  );

  if(!ok){
    return;
  }

  try{
    sessionStorage.removeItem(SIGNUP_LEGACY_STORAGE_KEY);
  }catch(e){}

}

/* PHASE 2 — Province → City cascading (shared catalogue).
   SAME pattern as Upload Vehicle (fillProvinces/fillCities)
   and Browse (fillProvinces/populateCities): province
   options from getProvinces(); city options for the
   selected province from getCities(province). No hard-coded
   maps. Changing province clears an invalid city and
   repopulates. Normalizer retained ONLY for validating the
   value written to auth metadata. */
const SIGNUP_PROVINCES = [
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

function normalizeProvinceName(value){

  const raw = String(value || "").trim().toLowerCase();

  if(!raw){
    return "";
  }

  for(const name of SIGNUP_PROVINCES){

    if(name.toLowerCase() === raw){
      return name;
    }

  }

  return "";

}

/* PHASE 3 — snake_case aliases accepted by the signup draft
   allowlist, mapped onto their canonical camelCase keys. */
const SIGNUP_DRAFT_KEY_ALIASES = {
  account_type: "accountType",
  dealer_email: "dealerEmail",
  dealer_phone: "dealerPhone",
  dealer_address: "dealerAddress",
  dealer_city: "dealerCity",
  profile_province: "profileProvince",
  profile_city: "profileCity"
};

/* Normalizes legacy snake_case draft keys ONCE at load so every
   reader (static restore, location restore, social restore) uses
   one canonical shape. camelCase wins; an alias only fills a
   canonical key the record does not already carry. */
function normalizeSignupDraftKeys(saved){

  let normalized = null;

  for(const alias of Object.keys(SIGNUP_DRAFT_KEY_ALIASES)){

    const aliasValue = saved[alias];

    if(typeof aliasValue !== "string" || !aliasValue){
      continue;
    }

    normalized = normalized || { ...saved };

    const canonical = SIGNUP_DRAFT_KEY_ALIASES[alias];

    if(
      typeof normalized[canonical] !== "string" ||
      !normalized[canonical]
    ){
      normalized[canonical] = aliasValue;
    }

    delete normalized[alias];

  }

  return normalized || saved;

}

let signupDraftSaveTimer = null;

function loadSignupDraft(){

  migrateLegacySignupDraftOnce();

  const saved = loadDraftRecord(
    SIGNUP_DRAFT_WORKFLOW,
    signupUserKey()
  );

  if(
    !saved ||
    typeof saved !== "object" ||
    Array.isArray(saved)
  ){
    return null;
  }

  return normalizeSignupDraftKeys(saved);

}

function setTextValue(id, value){

  if(typeof value !== "string"){
    return;
  }

  const el = document.getElementById(id);

  if(!el){
    return;
  }

  el.value = value;

}

function setSelectValue(id, value){

  if(typeof value !== "string"){
    return;
  }

  const el = document.getElementById(id);

  if(!el || !el.options){
    return;
  }

  /* Do not overwrite with a stale value whose option
     no longer exists. */
  const exists =
    Array.prototype.some.call(
      el.options,
      (o) => o.value === value
    );

  if(!exists){
    return;
  }

  el.value = value;

}

/* PHASE 2 — Province → City cascading helpers.
   SAME pattern as Upload Vehicle fillProvinces/fillCities
   (pages/uploadVehicle.js): province options from
   getProvinces(); cities for the selected province from
   getCities(province); changing province clears an invalid
   previous city. */

function fillProvinceOptions(select, provinces){

  if(!select){
    return;
  }

  const current = select.value || "";

  select.innerHTML = "";

  const placeholder =
    document.createElement("option");

  placeholder.value = "";

  placeholder.textContent = "Select Province";

  select.appendChild(placeholder);

  (provinces || []).forEach((item)=>{

    const value =
      typeof item === "string"
        ? item
        : item?.value;

    if(!value){
      return;
    }

    const option =
      document.createElement("option");

    option.value = value;

    option.textContent = value;

    select.appendChild(option);

  });

  if(current){
    select.value = current;
  }

}

async function fillCityOptions(citySelect, province, preserveCity){

  if(!citySelect){
    return;
  }

  if(!province){

    citySelect.innerHTML =
      `<option value="">
        Select Province First
      </option>`;

    citySelect.disabled = true;

    return;

  }

  let cities = [];

  try{
    cities = await getCities(province) || [];
  }catch(e){
    cities = [];
  }

  citySelect.innerHTML =
    `<option value="">
      Select City
    </option>`;

  cities.forEach((item)=>{

    const value =
      typeof item === "string"
        ? item
        : item?.value;

    if(!value){
      return;
    }

    const option =
      document.createElement("option");

    option.value = value;

    option.textContent = value;

    citySelect.appendChild(option);

  });

  citySelect.disabled = false;

  /* Preserve only when the saved city is valid for the
     newly selected province; otherwise stay cleared. */
  if(preserveCity){

    const exists =
      cities.some((item)=>{

        const value =
          typeof item === "string"
            ? item
            : item?.value;

        return value === preserveCity;

      });

    if(exists){
      citySelect.value = preserveCity;
    }

  }

}

/* Populates the ONE shared signup province select from the shared
   catalogue, then restores draft province/city WITHOUT loading
   cities twice. Called ONCE per initSignup. */
async function initSignupLocations(saved){

  /* ONE shared location control set for ALL signup accounts
     (Private Seller and Dealership alike) — no dealer/private
     duplicates. */

  const provinceEl =
    document.getElementById("locationProvince");
  const cityEl =
    document.getElementById("locationCity");
  const locationEl =
    document.getElementById("locationText");

  /* EXISTING signup form (used by the draft autosave below). */
  const form =
    document.getElementById("signupForm");

  /* Shared catalogue list — function scoped so it is never an
     implicit global. */
  let provinces = [];

  try{
    provinces = await getProvinces() || [];
  }catch(e){
    provinces = [];
  }

  /* Catalogue failure fallback: keep the minimal valid
     canonical list so the required province value can
     still be chosen. Cities stay catalogue-driven. */
  if(!provinces.length){
    provinces = SIGNUP_PROVINCES.slice();
  }

  /* Populate the ONE shared province select from the shared
     catalogue. */
  fillProvinceOptions(provinceEl, provinces);

  /* Signup default: NO province is auto-selected on initial
     load — the shared Province select shows the "Select
     Province" placeholder until the user chooses one. City
     remains disabled ("Select Province First") until then.
     The Province → City cascade below populates City as soon
     as a province is selected. */

  /* Province first, then cities for that province, then
     the previously saved valid city (draft restore).
     Saved provinces are normalized to the canonical form
     so a draft always matches the catalogue option value. */

  /* Draft restore — the shared Province/City are saved under the
     existing dealer and profile draft keys (both aliases hold the
     SAME shared values), so whichever alias exists is restored. */
  const savedProvince =
    normalizeProvinceName(
      saved?.dealerProvince || saved?.profileProvince || ""
    );
  const savedCity =
    (saved?.dealerCity || saved?.profileCity || "").trim();

  /* Restore the province ONLY if the user genuinely selected
     one (marker written by the province change listener).
     Drafts saved by the legacy build auto-inserted the first
     catalogue province (e.g. Eastern Cape) without any user
     action — those carry no marker and are ignored here, so a
     fresh signup starts at "Select Province". */
  if(savedProvince && provinceEl && saved?.provinceUserSelected === "1"){
    provinceEl.value = savedProvince;
    /* Re-arm the marker so subsequent autosaves keep trusting
       this user-chosen province on later reloads. */
    form.dataset.provinceUserSelected = "1";
  }

  if(provinceEl?.value){
    await fillCityOptions(
      cityEl,
      provinceEl.value,
      savedCity
    );
  }

  /* Wire the EXISTING Province → City cascade ONCE for the shared
     controls. Changing Province clears an invalid City and
     repopulates from the new province's catalogue. */
  if(provinceEl && cityEl){
    provinceEl.addEventListener(
      "change",
      async ()=>{

        /* Trust marker: this event fires ONLY on a genuine
           user selection (programmatic value writes do not
           fire change), so the restored province below is
           provably user-chosen. */
        form.dataset.provinceUserSelected = "1";

        const prevCity = cityEl.value || "";

        await fillCityOptions(
          cityEl,
          provinceEl.value,
          prevCity
        );

        scheduleSignupDraftSave(form);

      }
    );

    cityEl.addEventListener(
      "change",
      () => scheduleSignupDraftSave(form)
    );
  }

  /* Shared Location text — draft autosave on change. */
  if(locationEl){
    locationEl.addEventListener(
      "change",
      () => scheduleSignupDraftSave(form)
    );
  }

}

/* Restores static (non-social, non-location) draft fields.
   Province/City are restored by initSignupLocations AFTER the
   shared-catalogue options exist, so they are SKIPPED here.
   The explicit ?account=private|dealer preset — an intentional
   navigation choice — takes precedence over saved account type. */
function restoreSignupDraft(saved, presetAccount){

  if(!saved){
    return;
  }

  setTextValue("name", saved.name);
  setTextValue("surname", saved.surname);
  setTextValue("email", saved.email);

  if(
    presetAccount !== "private" &&
    presetAccount !== "dealer"
  ){
    setSelectValue("accountType", saved.accountType);
  }

  setTextValue("dealership", saved.dealership);
  setTextValue("dealerEmail", saved.dealerEmail);
  setTextValue("dealerPhone", saved.dealerPhone);

  /* ONE shared location set for ALL account types. The shared
     values are saved under the existing draft keys (dealer* and
     profile* aliases hold the same shared values), so whichever
     alias exists is restored. */
  const savedProvince =
    normalizeProvinceName(
      saved?.dealerProvince || saved?.profileProvince || ""
    );
  const savedCity =
    (saved?.dealerCity || saved?.profileCity || "").trim();
  const savedLocation =
    (saved?.dealerAddress || saved?.profileLocation || "").trim();

  const provinceEl = document.getElementById("locationProvince");
  const cityEl = document.getElementById("locationCity");
  const locationEl = document.getElementById("locationText");

  /* Same trust rule as initSignupLocations: restore the
     province only when the draft proves the user picked it.
     Legacy auto-inserted values (no marker) are ignored. */
  if(provinceEl && savedProvince && saved?.provinceUserSelected === "1"){
    provinceEl.value = savedProvince;
    /* Re-arm the marker (see initSignupLocations) so the next
       autosave does not strip trust from a genuine selection. */
    const signupForm = document.getElementById("signupForm");
    if(signupForm){
      signupForm.dataset.provinceUserSelected = "1";
    }
  }

  if(cityEl && savedCity){
    cityEl.value = savedCity;
  }

  if(locationEl && savedLocation){
    locationEl.value = savedLocation;
  }

  setTextValue("mobileNumber", saved.mobileNumber);
  setTextValue("whatsappNumber", saved.whatsappNumber);

  setTextValue("profileBio", saved.profileBio);
  setTextValue("profileWebsite", saved.profileWebsite);

}

/* Restores social-link draft values AFTER the social inputs
   are built dynamically. Reveals each platform field that
   has a saved value so the restored link is visible. */
function restoreSignupSocialDraft(saved){

  if(
    !saved ||
    !saved.socialLinks ||
    typeof saved.socialLinks !== "object"
  ){
    return;
  }

  for(const p of PHASE2_SOCIAL_PLATFORMS){

    const value = saved.socialLinks[p.id];

    if(
      typeof value !== "string" ||
      !value
    ){
      continue;
    }

    const input =
      document.getElementById(
        `signupSocialInput-${p.id}`
      );

    if(!input){
      continue;
    }

    input.value = value;

    const field =
      document.getElementById(
        `signupSocialField-${p.id}`
      );

    if(field){
      field.classList.remove("hidden");
    }

    const chip =
      document.getElementById(
        `signupSocialChip-${p.id}`
      );

    if(chip){
      chip.classList.add(
        "border-[#3B82F6]",
        "bg-[#3B82F6]/10",
        "text-[#3B82F6]"
      );
    }

  }

}

/* Collects ONLY allowlisted non-sensitive fields.
   password / passwordConfirm / avatar File / tokens are
   deliberately never read here and never passed to
   saveDraftRecord(). */
function collectSignupDraft(){

  const form = document.getElementById("signupForm");

  const read = (id) =>
    document.getElementById(id)?.value ?? "";

  const socialLinks = {};

  for(const p of PHASE2_SOCIAL_PLATFORMS){

    const value =
      document.getElementById(
        `signupSocialInput-${p.id}`
      )?.value?.trim() || "";

    if(value){
      socialLinks[p.id] = value;
    }

  }

  /* The ?account= preset is an intentional navigation choice:
     apply it over any stale saved value and never write it
     back into the draft. */
  const preset =
    form?.dataset?.signupPresetAccount || "";

    return {
    name: read("name"),
    surname: read("surname"),
    email: read("email"),
    accountType:
      preset === "private" || preset === "dealer"
        ? preset
        : read("accountType"),
    dealership: read("dealership"),
    dealerEmail: read("dealerEmail"),
    dealerPhone: read("dealerPhone"),
    dealerAddress: read("locationText"),
    dealerProvince: read("locationProvince"),
    dealerCity: read("locationCity"),
    profileProvince: read("locationProvince"),
    profileCity: read("locationCity"),
    mobileNumber: read("mobileNumber"),
    whatsappNumber: read("whatsappNumber"),
    /* Province trust marker: set ONLY when the user actually
       picks a province in the shared select. Drafts saved by
       the legacy build (which auto-inserted the first catalogue
       province) carry NO marker, so their stale auto-value is
       never restored again. */
    provinceUserSelected:
      form?.dataset?.provinceUserSelected === "1" ? "1" : "",
    profileBio: read("profileBio"),
    profileLocation: read("locationText"),
    profileWebsite: read("profileWebsite"),
    socialLinks
  };

}

function scheduleSignupDraftSave(form){

  if(
    form.dataset.signupComplete === "true"
  ){
    return;
  }

  if(signupDraftSaveTimer){
    clearTimeout(signupDraftSaveTimer);
  }

  signupDraftSaveTimer = setTimeout(() => {

    signupDraftSaveTimer = null;

    if(
      !document.getElementById("signupForm") ||
      form.dataset.signupComplete === "true"
    ){
      return;
    }

    const draft = collectSignupDraft();

    saveDraftRecord(
      SIGNUP_DRAFT_WORKFLOW,
      signupUserKey(),
      draft,
      { accountType: draft.accountType || "" }
    );

  }, 250);

}

/* Clears the draft after a genuinely successful signup so no
   signup information is left in sessionStorage. Also cancels
   any pending debounced write so it cannot re-save after
   the success panel replaces the form. */
function clearSignupDraft(form){

  if(signupDraftSaveTimer){
    clearTimeout(signupDraftSaveTimer);
    signupDraftSaveTimer = null;
  }

  if(form){
    form.dataset.signupComplete = "true";
  }

  clearDraftRecord(SIGNUP_DRAFT_WORKFLOW, signupUserKey());

  try{
    sessionStorage.removeItem(SIGNUP_LEGACY_STORAGE_KEY);
  }catch(e){}

}

function computeSignupAvatarInitials(){

const first =
document.getElementById("name")?.value.trim() || "";

const surname =
document.getElementById("surname")?.value.trim() || "";

const a = first.charAt(0);
const b = surname.charAt(0);

return (
  (a + b)
).toUpperCase() || "HU";

}

function renderSignupAvatarPreview(photoUrl){

const box =
document.getElementById("signupAvatarPreview");

if(!box){
return;
}

const removeBtn =
document.getElementById("signupAvatarRemove");

if(photoUrl){

box.classList.add("has-photo");

box.innerHTML =
`<img
src="${photoUrl}"
alt="Profile photo preview"
class="absolute inset-0 w-full h-full object-cover"
>`;

if(removeBtn){
removeBtn.classList.remove("hidden");
}

}else{

box.classList.remove("has-photo");

box.textContent =
computeSignupAvatarInitials();

if(removeBtn){
removeBtn.classList.add("hidden");
}

}

}

window.onSignupAvatarSelected =
async function(input){

const file =
input?.files?.[0];

if(!file){
return;
}

if(
!SIGNUP_AVATAR_TYPES.includes(
file.type
)
){

toast(
"Only JPG, PNG and WEBP images are allowed"
);

input.value = "";

return;

}

if(
file.size > SIGNUP_AVATAR_MAX_SIZE
){

toast(
"Image must be smaller than 5MB"
);

input.value = "";

return;

}

/* Validate the ACTUAL file content, not just
   the browser-reported MIME type — same guard
   the dashboard avatar upload uses. */

const validation =
await validateImageFile(
file,
{
  maxSize: SIGNUP_AVATAR_MAX_SIZE,
  allowedTypes: SIGNUP_AVATAR_TYPES
}
);

if(!validation.ok){

toast(validation.error);

input.value = "";

return;

}

signupAvatarFile = file;

const reader =
new FileReader();

reader.onload = function(ev){

renderSignupAvatarPreview(
ev.target.result
);

};

reader.readAsDataURL(file);

/* Allow re-selecting the same file later */
input.value = "";

};

window.removeSignupAvatarPhoto =
function(){

signupAvatarFile = null;

renderSignupAvatarPreview(null);

};

function bindSignupAvatar(){

const chooseBtn =
document.getElementById("signupAvatarChoose");

const input =
document.getElementById("signupAvatarInput");

const removeBtn =
document.getElementById("signupAvatarRemove");

if(
chooseBtn &&
!chooseBtn.dataset.bound
){

chooseBtn.dataset.bound = "true";

chooseBtn.addEventListener(
"click",
() => input?.click()
);

}

if(
input &&
!input.dataset.bound
){

input.dataset.bound = "true";

input.addEventListener(
"change",
() => onSignupAvatarSelected(input)
);

}

if(
removeBtn &&
!removeBtn.dataset.bound
){

removeBtn.dataset.bound = "true";

removeBtn.addEventListener(
"click",
() => removeSignupAvatarPhoto()
);

}

/* Initials fallback follows the name fields */
["name","surname"].forEach((id) => {

const el =
document.getElementById(id);

if(
el &&
!el.dataset.avatarBound
){

el.dataset.avatarBound = "true";

el.addEventListener(
"input",
() => {

if(
!signupAvatarFile
){

renderSignupAvatarPreview(null);

}

}
);

}

});

renderSignupAvatarPreview(null);

}

/* PHASE 1 - SIGNUP PASSWORD VISIBILITY TOGGLES
   Wires an eye button to its own password input. Each field
   starts as type="password" (hidden) and the button flips ONLY
   that field between password and text, updating its own
   aria-pressed / aria-label / title so screen readers announce
   the current action (icon swap is CSS-driven via
   [aria-pressed="true"]).

   Purely presentational: password values, validation, the
   shared password policy (js/passwordPolicy.js), signup draft
   storage and Supabase Auth are untouched. The button is a real
   <button type="button">, so it can never submit the form. */

function bindSignupPasswordToggle(inputId, toggleId, noun){

  const input =
  document.getElementById(inputId);

  const toggle =
  document.getElementById(toggleId);

  if(!input || !toggle){
    return;
  }

  if(toggle.dataset.passwordToggleBound){
    return;
  }

  toggle.dataset.passwordToggleBound = "true";

  function applyVisibility(visible){

    /* The ONLY thing that ever changes the field type. */
    input.type =
    visible ? "text" : "password";

    const pressed =
    visible ? "true" : "false";

    toggle.setAttribute(
      "aria-pressed",
      pressed
    );

    const label =
    `${visible ? "Hide" : "Show"} ${noun}`;

    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);

  }

  /* Default state: password hidden. Never auto-revealed. */
  applyVisibility(false);

  toggle.addEventListener("click", ()=>{

    applyVisibility(
      input.type === "password"
    );

  });

}

export function SignupPage(){

setTimeout(initSignup, 0);

return `

<div class="
signup-page
min-h-screen
overflow-x-hidden
bg-gradient-to-b
from-white
via-[#f8fafc]
to-white
py-10
md:py-16
px-4
">

<div
id="signupContent"
class="
max-w-2xl
mx-auto
">

<!-- ==============================================
SIGNUP HEADER
============================================== -->
<div class="
signup-page-header
text-center mb-8 md:mb-10">

<div class="
signup-eyebrow
inline-flex
items-center
gap-2
text-[11px]
font-extrabold
uppercase
tracking-[0.22em]
text-[#0A58FF]
mb-4
">
<span class="w-8 h-[2px] rounded-full bg-[#E48A2F]"></span>
Create Account
<span class="w-8 h-[2px] rounded-full bg-[#E48A2F]"></span>
</div>

<h1 class="
signup-heading
text-3xl
md:text-4xl
font-black
tracking-[-0.04em]
text-[#08111F]
">
Join Helpufin Auto
</h1>

<p class="
signup-sub
text-[#64748B]
mt-3
text-[15px]
md:text-base
">
Set up your marketplace account in a few steps.
</p>

</div>

<!-- ==============================================
ACCOUNT INFORMATION — CARD 1
(hufa-page-heading style: white card, navy title,
orange accent bar, HUFA border + shadow language)
============================================== -->
<section
aria-labelledby="accountInfoHeading"
class="
hufa-form
signup-card
rounded-[24px]
bg-white
border
border-[#0A192F]/10
shadow-[0_18px_50px_rgba(10,25,47,0.08)]
p-6
md:p-8
">

<div class="mb-6 md:mb-8">

<span class="
hufa-page-heading-accent
block
w-10
h-[3px]
rounded-full
bg-[#E48A2F]
mb-3
"></span>

<h2
id="accountInfoHeading"
class="
text-lg
md:text-xl
font-extrabold
tracking-[-0.02em]
text-[#0A192F]
"
>
Account Information
</h2>

<p class="
text-[13px]
text-[#64748B]
mt-1.5
leading-relaxed
">
Tell us who you are and how you want to sell on the marketplace.
</p>

</div>

<form
id="signupForm"
class="space-y-5"
novalidate
>

<div class="grid md:grid-cols-2 gap-4 md:gap-5">

<div>

<label
for="name"
class="
block
text-[12px]
font-bold
uppercase
tracking-[0.08em]
text-[#0A192F]
mb-1.5
"
>
First Name
</label>

<input
id="name"
type="text"
autocomplete="given-name"
placeholder="Your first name"
class="
input-light
"
required
>

</div>

<div>

<label
for="surname"
class="
block
text-[12px]
font-bold
uppercase
tracking-[0.08em]
text-[#0A192F]
mb-1.5
"
>
Surname
</label>

<input
id="surname"
type="text"
autocomplete="family-name"
placeholder="Your surname"
class="
input-light
"
required
>

</div>

</div>

<div>

<label
for="email"
class="
block
text-[12px]
font-bold
uppercase
tracking-[0.08em]
text-[#0A192F]
mb-1.5
"
>
Email Address
</label>

<input
id="email"
type="email"
autocomplete="email"
inputmode="email"
enterkeyhint="next"
autocapitalize="none"
autocorrect="off"
spellcheck="false"
placeholder="you@example.com"
class="
input-light
"
required
>

</div>

<div>

<label
for="password"
class="
block
text-[12px]
font-bold
uppercase
tracking-[0.08em]
text-[#0A192F]
mb-1.5
"
>
Password
</label>

<div class="signup-password-field">

<input
id="password"
type="password"
autocomplete="new-password"
enterkeyhint="next"
placeholder="Create a strong password"
class="
input-light
"
required
>

<!-- PHASE 1 - password visibility (eye) button.
     type="button" so it can never submit the form.
     Inline SVG only (same icon approach as the rest of
     the project) - no icon library. The crossed-eye is
     revealed by [aria-pressed="true"] in css/styles.css. -->
<button
type="button"
id="passwordToggle"
class="signup-password-toggle"
aria-label="Show password"
aria-pressed="false"
aria-controls="password"
title="Show password"
>
<span class="signup-password-icon-show">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
</span>
<span class="signup-password-icon-hide">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
</span>
</button>

</div>

<!-- PHASE 12 — live password requirements
     (shared policy with /reset-password) -->
${renderPasswordRequirements("signupPasswordRequirements")}

</div>

<div>

<label
for="passwordConfirm"
class="
block
text-[12px]
font-bold
uppercase
tracking-[0.08em]
text-[#0A192F]
mb-1.5
"
>
Confirm Password
</label>

<div class="signup-password-field">

<input
id="passwordConfirm"
type="password"
autocomplete="new-password"
enterkeyhint="go"
placeholder="Re-enter your password"
class="
input-light
"
required
>

<!-- PHASE 1 - confirm password visibility (eye) button.
     Independent from the Password field above: each button
     toggles only its OWN input. type="button" so it can
     never submit the form. -->
<button
type="button"
id="passwordConfirmToggle"
class="signup-password-toggle"
aria-label="Show confirm password"
aria-pressed="false"
aria-controls="passwordConfirm"
title="Show confirm password"
>
<span class="signup-password-icon-show">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
</span>
<span class="signup-password-icon-hide">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
</span>
</button>

</div>

</div>

<!-- ==============================================
ACCOUNT TYPE
============================================== -->
<div>

<span
class="
block
text-[12px]
font-bold
uppercase
tracking-[0.08em]
text-[#0A192F]
mb-2
"
>
Account Type
</span>

<select
id="accountType"
class="
input-light
"
required
>
<option value="private">Private Seller</option>
<option value="dealer">Dealership</option>
</select>

</div>

<div id="dealerWrap" class="hidden space-y-5">

<input
id="dealership"
placeholder="Dealership Name"
class="input-light"
>

<input
id="dealerEmail"
type="email"
placeholder="Dealership Email (optional)"
class="input-light"
>

<input
id="dealerPhone"
type="tel"
placeholder="Dealership Phone Number (optional)"
class="input-light"
>

</div>

<!--
SUBSCRIPTION SYSTEM DISABLED

<select
id="subscription"
class="input-light"
required
>
</select>
-->

</form>

</section>

<!-- ==============================================
CONTACT INFORMATION — CARD 2
(All fields optional)
============================================== -->
<section
aria-labelledby="contactInfoHeading"
class="
hufa-form
signup-card
mt-6
rounded-[24px]
bg-white
border
border-[#0A192F]/10
shadow-[0_18px_50px_rgba(10,25,47,0.08)]
p-6
md:p-8
">

<div class="mb-6">

<span class="
hufa-page-heading-accent
block
w-10
h-[3px]
rounded-full
bg-[#E48A2F]
mb-3
"></span>

<div class="flex flex-wrap items-center gap-2 md:gap-3">

<h2
id="contactInfoHeading"
class="
text-lg
md:text-xl
font-extrabold
tracking-[-0.02em]
text-[#0A192F]
"
>
Contact Information
</h2>

<span class="
inline-flex
items-center
rounded-full
border
border-[#E48A2F]/30
bg-[#E48A2F]/10
text-[#B4661A]
text-[10px]
font-bold
uppercase
tracking-[0.14em]
px-3
py-1
"
>
Optional
</span>

</div>

<p class="
text-[13px]
text-[#64748B]
mt-1.5
leading-relaxed
">
These details help buyers reach you. You can leave them blank — you can add them later in your dashboard.
</p>

</div>

<div class="space-y-5">

<div>

<label
for="mobileNumber"
class="
block
text-[12px]
font-bold
uppercase
tracking-[0.08em]
text-[#0A192F]
mb-1.5
"
>
Mobile Number
<span class="
normal-case
font-semibold
text-[#94A3B8]
tracking-normal
"
>
&nbsp;· optional
</span>
</label>

<input
id="mobileNumber"
type="tel"
autocomplete="tel"
inputmode="tel"
placeholder="+27 00 000 0000"
class="input-light"
>

</div>

<div>

<label
for="whatsappNumber"
class="
block
text-[12px]
font-bold
uppercase
tracking-[0.08em]
text-[#0A192F]
mb-1.5
"
>
WhatsApp Number
<span class="
normal-case
font-semibold
text-[#94A3B8]
tracking-normal
"
>
&nbsp;· optional
</span>
</label>

<input
id="whatsappNumber"
type="tel"
autocomplete="tel"
inputmode="tel"
placeholder="+27 00 000 0000"
class="input-light"
>

</div>

<div>

</div>

</div>

</section>
<!-- ==============================================
PROFILE — CARD 3
(All fields optional)
============================================== -->
<section
aria-labelledby="profileHeading"
class="
hufa-form
signup-card
mt-6
rounded-[24px]
bg-white
border
border-[#0A192F]/10
shadow-[0_18px_50px_rgba(10,25,47,0.08)]
p-6
md:p-8
">

<div class="mb-6">

<span class="
hufa-page-heading-accent
block
w-10
h-[3px]
rounded-full
bg-[#E48A2F]
mb-3
"></span>

<div class="flex flex-wrap items-center gap-2 md:gap-3">

<h2
id="profileHeading"
class="
text-lg
md:text-xl
font-extrabold
tracking-[-0.02em]
text-[#0A192F]
"
>
Profile
</h2>

<span class="
inline-flex
items-center
rounded-full
border
border-[#E48A2F]/30
bg-[#E48A2F]/10
text-[#B4661A]
text-[10px]
font-bold
uppercase
tracking-[0.14em]
px-3
py-1
"
>
Optional
</span>

</div>

<p class="
text-[13px]
text-[#64748B]
mt-1.5
leading-relaxed
">
Tell buyers a little about yourself. Everything here is optional — you can update it any time in your dashboard.
</p>

</div>

<div class="space-y-5">

<!-- PROFILE PICTURE — same circular avatar
     treatment as the dashboard Edit Profile
     modal (initials fallback + photo fill) -->

<div class="
flex
flex-col
sm:flex-row
sm:items-center
gap-4
sm:gap-5
">

<div
id="signupAvatarPreview"
class="
edit-profile-avatar-preview
relative
flex
items-center
justify-center
rounded-full
overflow-hidden
shrink-0
select-none
w-20
h-20
sm:w-24
sm:h-24
bg-[linear-gradient(135deg,#08111F,#13233D)]
text-white
text-xl
sm:text-2xl
font-black
tracking-[0.02em]
"
aria-live="polite"
>
</div>

<div class="flex flex-col gap-2">

<div class="flex flex-wrap gap-2.5">

<button
type="button"
id="signupAvatarChoose"
class="
rounded-xl
bg-[#005BBF]
hover:bg-[#004FA8]
text-white
text-[13px]
font-bold
px-4
py-2.5
transition-all
duration-300
hover:-translate-y-[1px]
shadow-[0_10px_25px_rgba(10,25,47,0.18)]
"
>
Choose Photo
</button>

<button
type="button"
id="signupAvatarRemove"
class="
hidden
rounded-xl
border
border-[#0A192F]/15
bg-white
text-[#0A192F]
text-[13px]
font-bold
px-4
py-2.5
transition-all
duration-300
hover:bg-[#f1f5f9]
"
>
Remove Photo
</button>

<input
id="signupAvatarInput"
type="file"
accept="image/jpeg,image/jpg,image/png,image/webp"
class="hidden"
>

</div>

<p class="
text-[11px]
text-[#94A3B8]
leading-relaxed
">
JPG, PNG or WEBP · up to 5MB
</p>

</div>

</div>

<!-- BIO / ABOUT -->

<div>

<label
for="profileBio"
class="
block
text-[12px]
font-bold
uppercase
tracking-[0.08em]
text-[#0A192F]
mb-1.5
"
>
Bio / About
<span class="
normal-case
font-semibold
text-[#94A3B8]
tracking-normal
"
>
&nbsp;· optional
</span>
</label>

<textarea
id="profileBio"
rows="4"
maxlength="1000"
placeholder="Tell buyers about yourself or your dealership…"
class="input-light resize-y"
></textarea>

</div>



<!-- LOCATION / PROVINCE / CITY / WEBSITE -->

<div class="grid grid-cols-1 md:grid-cols-2 gap-5">

  <div>

    <label
      for="locationProvince"
      class="
        block
        text-[12px]
        font-bold
        uppercase
        tracking-[0.08em]
        text-[#0A192F]
        mb-1.5
      "
    >
      Province
      <span class="
        normal-case
        font-semibold
        text-[#94A3B8]
        tracking-normal
      ">
        &nbsp;· optional
      </span>
    </label>

    <select
      id="locationProvince"
      class="input-light"
    >
      <option value="">
        Select Province
      </option>
    </select>

  </div>

  <div>

    <label
      for="locationCity"
      class="
        block
        text-[12px]
        font-bold
        uppercase
        tracking-[0.08em]
        text-[#0A192F]
        mb-1.5
      "
    >
      City
      <span class="
        normal-case
        font-semibold
        text-[#94A3B8]
        tracking-normal
      ">
        &nbsp;· optional
      </span>
    </label>

    <select
      id="locationCity"
      class="input-light"
      disabled
    >
      <option value="">
        Select Province First
      </option>
    </select>

  </div>

</div>

<div>

  <label
    for="locationText"
    class="
      block
      text-[12px]
      font-bold
      uppercase
      tracking-[0.08em]
      text-[#0A192F]
      mb-1.5
    "
  >
    Location
    <span class="
      normal-case
      font-semibold
      text-[#94A3B8]
      tracking-normal
    ">
      &nbsp;· optional
    </span>
  </label>

  <input
    id="locationText"
    type="text"
    autocomplete="street-address"
    placeholder="Street, suburb, city, province"
    class="input-light"
  >

</div>

<div>

  <label
    for="profileWebsite"
    class="
      block
      text-[12px]
      font-bold
      uppercase
      tracking-[0.08em]
      text-[#0A192F]
      mb-1.5
    "
  >
    Website
    <span class="
      normal-case
      font-semibold
      text-[#94A3B8]
      tracking-normal
    ">
      &nbsp;· optional
    </span>
  </label>

  <input
    id="profileWebsite"
    type="url"
    inputmode="url"
    autocomplete="url"
    placeholder="https://www.example.co.za"
    class="input-light"
  >

</div>

</div>

</section>

<!-- ==============================================
SOCIAL PROFILES — CARD 4
(All fields optional, all account types)
Reuses the SHARED social platform system — the
chips and inputs are rendered by initSignup from
PHASE2_SOCIAL_PLATFORMS into these containers.
============================================== -->
<section
id="signupSocialBox"
aria-labelledby="socialHeading"
class="
hufa-form
signup-card
mt-6
rounded-[24px]
bg-white
border
border-[#0A192F]/10
shadow-[0_18px_50px_rgba(10,25,47,0.08)]
p-6
md:p-8
">

<div class="mb-6">

<span class="
hufa-page-heading-accent
block
w-10
h-[3px]
rounded-full
bg-[#E48A2F]
mb-3
"></span>

<div class="flex flex-wrap items-center gap-2 md:gap-3">

<h2
id="socialHeading"
class="
text-lg
md:text-xl
font-extrabold
tracking-[-0.02em]
text-[#0A192F]
"
>
Social Profiles
</h2>

<span class="
inline-flex
items-center
rounded-full
border
border-[#E48A2F]/30
bg-[#E48A2F]/10
text-[#B4661A]
text-[10px]
font-bold
uppercase
tracking-[0.14em]
px-3
py-1
"
>
Optional
</span>

</div>

<p class="
text-[13px]
text-[#64748B]
mt-1.5
leading-relaxed
">
Tap a platform to add its link. Everything is optional — leave any platform blank to skip it.
</p>

</div>

<div id="signupSocialChips" class="flex flex-wrap gap-2 mb-4"></div>

<div id="signupSocialInputs" class="space-y-3"></div>

</section>

<!-- ==============================================
LAUNCH PROMOTION — CARD 5
(The package assigned to the account — already
selected, based on Account Type. No old packages
are offered.)
============================================== -->
<section
aria-labelledby="launchHeading"
class="
signup-card
signup-launch
mt-6
rounded-[24px]
bg-white
border-2
border-[#E48A2F]
shadow-[0_18px_50px_rgba(228,138,47,0.18)]
p-6
md:p-8
relative
overflow-hidden
">

<span
aria-hidden="true"
class="
absolute
top-0
left-0
right-0
h-1.5
bg-[#E48A2F]
"
></span>

<div class="mb-6">

<span class="
hufa-page-heading-accent
block
w-10
h-[3px]
rounded-full
bg-[#E48A2F]
mb-3
"></span>

<div class="flex flex-wrap items-center gap-2 md:gap-3">

<h2
id="launchHeading"
class="
text-lg
md:text-xl
font-extrabold
tracking-[-0.02em]
text-[#0A192F]
"
>
Launch Promotion
</h2>

<span class="
inline-flex
items-center
gap-1.5
rounded-full
bg-[#E48A2F]
text-white
text-[10px]
font-bold
uppercase
tracking-[0.14em]
px-3
py-1
shadow-[0_6px_16px_rgba(228,138,47,0.4)]
"
>
<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="w-3 h-3"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
Selected
</span>

</div>

<p class="
text-[13px]
text-[#64748B]
mt-1.5
leading-relaxed
">
Your account includes our launch offer — automatically applied, nothing to choose.
</p>

</div>

<!-- PRIVATE SELLER LIMITS -->

<div
id="launchPrivateBlock"
class="
rounded-2xl
border
border-[#0A192F]/10
bg-[#f8fafc]
p-4
md:p-5
"
>

<p class="
text-[11px]
font-bold
uppercase
tracking-[0.14em]
text-[#64748B]
mb-3
"
>
Private Seller · Included
</p>

<ul class="space-y-2.5 text-[14px] text-[#08111F] font-semibold">

<li class="flex items-center gap-2.5">
<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="w-[18px] h-[18px] shrink-0 text-[#E48A2F]"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
5 vehicle listings
</li>

<li class="flex items-center gap-2.5">
<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="w-[18px] h-[18px] shrink-0 text-[#E48A2F]"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
2 featured listings
</li>

</ul>

</div>

<!-- DEALERSHIP LIMITS -->

<div
id="launchDealerBlock"
class="
hidden
rounded-2xl
border
border-[#0A192F]/10
bg-[#f8fafc]
p-4
md:p-5
"
>

<p class="
text-[11px]
font-bold
uppercase
tracking-[0.14em]
text-[#64748B]
mb-3
"
>
Dealership · Included
</p>

<ul class="space-y-2.5 text-[14px] text-[#08111F] font-semibold">

<li class="flex items-center gap-2.5">
<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="w-[18px] h-[18px] shrink-0 text-[#E48A2F]"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
50 vehicle listings
</li>

<li class="flex items-center gap-2.5">
<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="w-[18px] h-[18px] shrink-0 text-[#E48A2F]"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
15 featured listings
</li>

</ul>

</div>

<!-- FINAL SUBMIT — associated with the signup
     form above via the form attribute -->

<button
id="signupBtn"
type="submit"
form="signupForm"
class="
signup-submit
mt-6
w-full
rounded-2xl
bg-[#005BBF]
hover:bg-[#004FA8]
text-white
py-4
font-bold
transition-all
duration-300
hover:-translate-y-[2px]
shadow-[0_14px_35px_rgba(10,25,47,0.18)]
"
>
Create Account
</button>

<p class="
signup-terms
text-center
text-[#94A3B8]
mt-3
"
>
By creating an account you agree to the Helpufin Auto terms of use.
</p>

</section>

</div>

</div>

`;

}

function initSignup(){

const form =
document.getElementById(
"signupForm"
);

if(!form || form.dataset.bound){
return;
}

form.dataset.bound = "true";

/* PRIVATE SELLER PACKAGE FLOW — when the user picks the
   Launch Promotion package on /sell/private, they arrive at
   /signup?account=private. Pre-select the Private Seller
   account type (the dropdown still allows switching to
   Dealership). Direct visits without the param are unchanged. */
const presetAccount =
new URLSearchParams(
window.location.search
).get("account");

/* PHASE 2 FIX — restore the saved NON-SENSITIVE draft BEFORE
   wiring dependent UI, so avatar initials (bindSignupAvatar)
   and the dealer/launch blocks (updatePlans) reflect the
   restored values. The ?account= preset wins over saved
   account type inside restoreSignupDraft. */
const signupDraft = loadSignupDraft();

restoreSignupDraft(signupDraft, presetAccount);

/* PHASE 7 — wire the Profile card avatar */
bindSignupAvatar();

/* PHASE 12 — live password requirement
   indicators (shared password policy). */
bindPasswordRequirements(
  document.getElementById("password"),
  document.getElementById(
    "signupPasswordRequirements"
  )
);

/* PHASE 1 - password visibility (eye) buttons.
   Each field is toggled independently; both start hidden. */
bindSignupPasswordToggle(
  "password",
  "passwordToggle",
  "password"
);

bindSignupPasswordToggle(
  "passwordConfirm",
  "passwordConfirmToggle",
  "confirm password"
);

const accountType =
document.getElementById("accountType");

if(
presetAccount === "private" ||
presetAccount === "dealer"
){
accountType.value = presetAccount;
}

const dealerWrap =
document.getElementById("dealerWrap");
const signupSocialBox =
document.getElementById("signupSocialBox");

/*
SUBSCRIPTION SYSTEM DISABLED

const subscription =
document.getElementById("subscription");
*/

function updatePlans(){

const type = accountType.value;

dealerWrap.classList.toggle(
"hidden",
type !== "dealer"
);

/* PHASE 9 — the Launch Promotion card shows the
   limits for the selected account type. */

const launchPrivateBlock =
document.getElementById("launchPrivateBlock");

const launchDealerBlock =
document.getElementById("launchDealerBlock");

if(launchPrivateBlock){
launchPrivateBlock.classList.toggle(
"hidden",
type === "dealer"
);
}

if(launchDealerBlock){
launchDealerBlock.classList.toggle(
"hidden",
type !== "dealer"
);
}

/* PHASE 8 — the Social Profiles card is now a
   separate section shown for ALL account types,
   so it is no longer toggled here. */

}

updatePlans();

accountType.addEventListener(
"change",
updatePlans
);

/* PHASE 2 — Province → City cascading (shared catalogue).
   SAME pattern as Upload Vehicle fillProvinces/fillCities:
   province options come from getProvinces(); the city select
   for that province comes from getCities(province). Changing
   province clears an invalid previous city. Listeners are
   bound ONCE here (initSignup runs once per mount via
   form.dataset.bound). */
initSignupLocations(signupDraft);




/* =========================================
PHASE 3 — DEALERSHIP SOCIAL MEDIA CHIPS
Built from the SHARED social platform
definitions (same icons/validation as the
Edit Profile modal). Inputs start hidden;
tapping a chip reveals it. All optional.
========================================= */

const chipsBox =
document.getElementById(
"signupSocialChips"
);

const inputsBox =
document.getElementById(
"signupSocialInputs"
);

if(chipsBox && inputsBox){

chipsBox.innerHTML =
PHASE2_SOCIAL_PLATFORMS.map(p => `
<button
type="button"
id="signupSocialChip-${p.id}"
data-platform="${p.id}"
title="${p.hint}"
aria-label="${p.label}"
class="
w-11
h-11
rounded-xl
flex
items-center
justify-center
border
border-gray-300
text-gray-500
hover:border-gray-400
hover:text-gray-700
transition
"
>
<span class="w-5 h-5 block">${p.icon}</span>
</button>
`).join("");

inputsBox.innerHTML =
PHASE2_SOCIAL_PLATFORMS.map(p => `
<div
id="signupSocialField-${p.id}"
class="hidden"
>

<label
for="signupSocialInput-${p.id}"
class="block text-xs font-semibold text-[#64748B] mb-1"
>
${p.label} · ${p.hint}
</label>

<input
id="signupSocialInput-${p.id}"
type="text"
maxlength="300"
placeholder="${p.placeholder}"
class="input-light"
/>

</div>
`).join("");

chipsBox.addEventListener(
"click",
(e)=>{

const chip =
e.target?.closest?.(
"[data-platform]"
);

if(!chip){
return;
}

const platform =
chip.dataset.platform;

const field =
document.getElementById(
`signupSocialField-${platform}`
);

if(!field){
return;
}

const isHidden =
field.classList.toggle("hidden");

chip.classList.toggle(
"border-[#3B82F6]",
!isHidden
);

chip.classList.toggle(
"bg-[#3B82F6]/10",
!isHidden
);

chip.classList.toggle(
"text-[#3B82F6]",
!isHidden
);

}
);

}

/* PHASE 2 FIX — restore saved social links AFTER the
   inputs are built (they did not exist at the earlier
   restore step), then persist NON-SENSITIVE draft state. */
restoreSignupSocialDraft(signupDraft);

/* PHASE 2 FIX — persist NON-SENSITIVE draft state on
   input/change. The ?account= preset wins over the saved
   account type: it is applied above by restoreSignupDraft
   and is never written into the saved draft by this
   listener, so a re-render before any keystroke cannot
   overwrite the user's choice with a stale saved value. */
form.dataset.signupPresetAccount = presetAccount || "";

/* PHASE 3 (FULL-PAGE DRAFT PERSISTENCE) — the Contact Info
   (#mobileNumber/#whatsappNumber), Profile (#profileBio/
   #locationText/#profileWebsite) and social cards are rendered
   OUTSIDE the <form> element, so input events in them never bubble to
   the form listeners above and those fields were lost on refresh even
   though collect/restore already support them. The SAME delegated
   listeners are therefore also attached to the signup content
   container that wraps every card (one mechanism, same draftStore
   foundation, same password exclusion — no second draft system). */

const signupDraftScope =
  document.getElementById("signupContent") || form;

const onSignupDraftInput = (e) => {

if(!e.target || e.target === form){
return;
}

/* SECURITY: never persist password material. These
   inputs are excluded even though they fire input
   events on this form. */
if(
e.target.id === "password" ||
e.target.id === "passwordConfirm"
){
return;
}

scheduleSignupDraftSave(form);

};

const onSignupDraftChange = (e) => {

if(!e.target || e.target === form){
return;
}

if(
e.target.id === "password" ||
e.target.id === "passwordConfirm"
){
return;
}

scheduleSignupDraftSave(form);

};

form.addEventListener("input", onSignupDraftInput);

form.addEventListener(
"change",
onSignupDraftChange
);

if(signupDraftScope !== form){

signupDraftScope.addEventListener(
"input",
onSignupDraftInput
);

signupDraftScope.addEventListener(
"change",
onSignupDraftChange
);

}

const socialInputsBox =
document.getElementById("signupSocialInputs");

if(socialInputsBox){
socialInputsBox.addEventListener(
"input",
() => scheduleSignupDraftSave(form)
);
socialInputsBox.addEventListener(
"change",
() => scheduleSignupDraftSave(form)
);
}

/* Immediately persist the restored draft (covers the
   pure re-render case where no input event fires), and
   persist on account-type change so the dealer/profile
   toggle survives a re-render before any keystroke. */
if(signupDraft){
scheduleSignupDraftSave(form);
}

/* Keep a synchronous lock as well as disabling the button. The
   submit event can be dispatched again before the browser paints
   the disabled state (or by another submit control), so the button
   state alone is not a submission guard. */
let signupSubmitting = false;

form.addEventListener("submit", async (e)=>{

e.preventDefault();

if(signupSubmitting){
return;
}

signupSubmitting = true;

const btn =
document.getElementById("signupBtn");

btn.disabled = true;
btn.innerHTML = "Creating Account...";

try{

const name =
document.getElementById("name")
.value
.trim();

const surname =
document.getElementById("surname")
.value
.trim();

const email =
document.getElementById("email")
.value
.trim()
.toLowerCase();

const password =
document.getElementById("password")
.value;

const account_type =
document.getElementById("accountType")
.value;

const dealership_name =
document.getElementById("dealership")
.value
.trim();

/* PHASE 3 — dealership contact + social
   fields (dealer accounts only; the inputs
   exist inside #dealerWrap). */

const dealerEmail =
document.getElementById("dealerEmail")
?.value?.trim() || "";

const dealerPhone =
document.getElementById("dealerPhone")
?.value?.trim() || "";

/* ONE shared location control set for ALL account types
   (#locationText / #locationProvince / #locationCity).
   Dealership accounts map the shared Location to the
   existing dealership_address payload; private sellers map
   the SAME shared Location to the existing location payload. */

const sharedLocation =
document.getElementById("locationText")
?.value?.trim() || "";

/* Existing dealership address payload name — fed by the
   shared Location field. */
const dealership_address = sharedLocation;

const sharedProvinceRaw =
document.getElementById("locationProvince")
?.value?.trim() || "";

/* Shared city comes from the SAME catalogue cascade
   (#locationProvince → #locationCity). Only a city valid
   for the selected province is kept. */
const sharedCityRaw =
document.getElementById("locationCity")
?.value?.trim() || "";

/* ONE validated canonical province value, ONE city value —
   read from the shared controls for BOTH account types.
   Invalid/blank stays null. Never bypasses DB protection. */
const province =
normalizeProvinceName(sharedProvinceRaw);

const city = sharedCityRaw;

const socialLinks = {};

for(const p of PHASE2_SOCIAL_PLATFORMS){

const input =
document.getElementById(
`signupSocialInput-${p.id}`
);

socialLinks[p.id] =
input?.value?.trim() || "";

}

/* GET PLAN — Launch Promotion is the only
   package available during signup. Old
   packages are not offered, so the plan is
   always set to Launch Promotion. */
const plan = "Launch Promotion";

/* VALIDATION */

if(
!name ||
!surname ||
!email ||
!password
){
toast("Please complete all fields");
resetBtn();
return;
}

/* PHASE 12 — full password policy (the SAME
   rules as /reset-password; see
   js/passwordPolicy.js). Every rule must
   pass before Supabase Auth is called. */
const unmetPasswordRules =
getUnmetPasswordRequirements(password);

if(unmetPasswordRules.length > 0){
toast(buildPasswordRequirementsMessage(password));
resetBtn();
return;
}

/* PHASE 5 — confirm password must match */
const passwordConfirm =
document.getElementById("passwordConfirm")
?.value || "";

if(passwordConfirm !== password){
toast("Passwords do not match");
resetBtn();
return;
}

if(
account_type === "dealer" &&
!dealership_name
){
toast("Enter dealership name");
resetBtn();
return;
}

/* PHASE 3 — validate the optional dealership
   contact fields (dealer accounts only). */

let normalizedSocialLinks = null;

if(account_type === "dealer"){

if(
dealerEmail &&
!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dealerEmail)
){
toast("Please enter a valid dealership email address");
resetBtn();
return;
}

if(dealerPhone){

const phoneDigits =
dealerPhone.replace(/[^\d]/g, "");

const phoneAllowed =
/^\+?[\d\s\-()]{7,20}$/.test(dealerPhone);

if(
!phoneAllowed ||
phoneDigits.length < 7 ||
phoneDigits.length > 15
){
toast("Please enter a valid dealership phone number (7–15 digits)");
resetBtn();
return;
}

}

}

/* PHASE 8 — social links are optional for ALL
   account types now (the Social Profiles card
   is shown to everyone), so normalization runs
   for every signup. Blank platforms are simply
   omitted. */

normalizedSocialLinks = {};

for(const p of PHASE2_SOCIAL_PLATFORMS){

const result =
normalizeEditSocialValue(
p.id,
socialLinks[p.id]
);

if(!result.ok){

toast(result.error);

resetBtn();

return;

}

if(result.value){
normalizedSocialLinks[p.id] = result.value;
}

}

/*
PACKAGE VALIDATION DISABLED

if(!plan){
toast("Select a package");
resetBtn();
return;
}
*/

/* GET PLAN */

/*
SUBSCRIPTION LOOKUP DISABLED

const {
data:planData,
error:planError
} = await supabase
.from("subscriptions")
.select("id,name")
.eq("name", plan)
.maybeSingle();
*/

const planData = null;

/* CREATE USER */

const {
data,
error
} = await supabase.auth.signUp({

email,
password,

options:{

/* PHASE 3 — explicit base-path-aware email verification landing.
   emailRedirectTo: appUrl("/dashboard") resolves via the existing
   base-path helper to the dashboard under the local development root
   and under the deployment base on GitHub Pages.
   Same existing appUrl() mechanism as forgot-password
   (appUrl("/reset-password")). No hardcoded origin, no hardcoded
   deployment prefix. All signup metadata below unchanged. */
emailRedirectTo: appUrl("/dashboard"),

data:{

/* PHASE 4 — canonical name key. readMeta() prefers first_name, then
   name, so BOTH are sent and no key ordering can lose the given name.
   PHASE 2 (NEW-DEALERSHIP CONTINUITY) — public.profiles has NO
   first_name column (verified against the live schema); profiles.name
   is the stored column and api.js buildAuthoritativeProfileInsert()
   maps first_name || name into it. first_name therefore stays in auth
   user_metadata only (schemaless) and is never written to a
   non-existent column. Surname already matches (surname). */
first_name: name,
name,
surname,

account_type:

account_type === "dealer"
? "dealer"
: "private",

dealership_name:

account_type === "dealer"
? dealership_name
: null,

/* PHASE 3 — dealership contact + social
   data travels through the EXISTING auth
   user_metadata → profiles fallback path
   (api.js getUserProfile). Private sellers
   carry nulls only. */

dealership_email:

account_type === "dealer"
? dealerEmail || null
: null,

phone:

account_type === "dealer"
? dealerPhone || null
: null,

dealership_address:

account_type === "dealer"
? dealership_address ?? null
: null,

social_links:

/* PHASE 8 — social links apply to ALL account
   types (private sellers included). */

(normalizedSocialLinks || {}),

/* PHASE 6 — optional contact information
   for ALL account types. Read from the new
   Contact Information card; blank fields are
   stored as null. */

mobile_number:
document.getElementById("mobileNumber")?.value.trim() || null,

whatsapp_number:
document.getElementById("whatsappNumber")?.value.trim() || null,

/* PHASE 7 — optional profile information for ALL
   account types. Read from the Profile card;
   blank fields are stored as null. These travel
   through the EXISTING metadata → profiles path
   (api.js getUserProfile fallback).

   The shared Location field (#locationText) feeds the
   existing `location` payload for EVERY account type,
   and the existing `dealership_address` payload for
   dealerships (see above). */

bio:
document.getElementById("profileBio")?.value.trim() || null,

location:
sharedLocation || null,

city:
city || null,

province:

    /* PHASE 2 FIX — ONE validated canonical province value,
       read from the ONE shared Province control
       (#locationProvince) for BOTH account types.
       Invalid/blank stays null. Never two columns; never
       bypasses DB protection. */
    province || null,

website:
document.getElementById("profileWebsite")?.value.trim() || null,

/* PHASE 4 — Launch Promotion is the only
   package available during registration, so
   every new account is tagged with it. */
selected_plan: "Launch Promotion"

}
}

});

if(error){

/* PHASE 4 — security-safe message only. Raw
   Supabase auth internals are never shown. */
toast(describeAuthError(error, "signup"));
resetBtn();
return;

}

const user =
data?.user;

if(!user){

/* PHASE 2 FIX — no user object means signup did NOT
   succeed: keep the saved NON-SENSITIVE draft so the
   user can correct the problem without starting over.
   The draft save uses the EXISTING draftStore foundation
   (the same saveDraftRecord call scheduleSignupDraftSave
   uses) and collectSignupDraft() only reads the
   allowlisted NON-SENSITIVE fields — passwords, password
   confirmation, the avatar File and tokens are never
   included. */

const draft = collectSignupDraft();

saveDraftRecord(
  SIGNUP_DRAFT_WORKFLOW,
  signupUserKey(),
  draft,
  { accountType: draft.accountType || "" }
);

toast("Account created. Check your email.");
resetBtn();
return;

}

/* PHASE 7 — profile photo upload. Reuses the
   EXISTING "profile-images" bucket, the SAME
   `${user.id}/avatar-${Date.now()}.${ext}` path
   convention as the dashboard Edit Profile
   system, and the SAME avatar_url field (carried
   via user_metadata so the existing api.js
   profile fallback persists it). Never blocks
   account creation — any storage/auth hiccup is
   logged and skipped (the user can still upload
   from the dashboard). */

if(
signupAvatarFile &&
data?.session
){

try{

const extension =
(
  signupAvatarFile.name
    .split(".")
    .pop() || "jpg"
)
.toLowerCase()
.replace(/[^a-z0-9]/g, "") || "jpg";

const filePath =
`${user.id}/avatar-${Date.now()}.${extension}`;

const { error:uploadError } =
await supabase.storage
.from("profile-images")
.upload(
filePath,
signupAvatarFile,
{
  cacheControl: "3600",
  upsert: false
}
);

if(!uploadError){

const { data:urlData } =
supabase.storage
.from("profile-images")
.getPublicUrl(filePath);

const publicUrl =
urlData?.publicUrl || null;

if(publicUrl){

await supabase.auth.updateUser(
{
  data:{
    avatar_url: publicUrl
  }
}
);

}

}else{

console.warn(
"Profile photo upload skipped:",
uploadError.message
);

}

}catch(avatarErr){

console.warn(
"Profile photo upload skipped:",
avatarErr
);

}

signupAvatarFile = null;

}

/*
PROFILE CREATION DISABLED

Profiles are created after authentication
through existing api.js fallback logic.

const {
error:profileError
} = await supabase
.from("profiles")
.insert(...);
*/

/* SUCCESS — PHASE 3: present a clean same-route confirmation state.
   Replaces the WHOLE signup content region (#signupContent) — the
   wrapper that contains the header, Account Information, Contact
   Information, Profile, Social Profiles, Launch Promotion, the
   Create Account button and the terms text — so NO signup control
   can remain visible or focusable underneath the confirmation.
   There is deliberately NO form-scoped fallback: swapping only the
   form's contents is what leaves orphaned cards and an orphan
   Create Account button around the panel. Fallbacks replace the
   next-widest signup region (.signup-page, then #app) so every
   path ends in the same confirmation-only state. Same emerald
   panel + HUFA language, no redesign. No routing, no URL change,
   no auth/data-mapping change. */
clearSignupDraft(form);

const successHtml = `

<div class="
max-w-2xl
mx-auto
">

<div class="
rounded-[28px]
border
border-emerald-200
bg-emerald-50
p-8
text-center
">

<h2
id="signupSuccessHeading"
tabindex="-1"
class="
text-2xl
font-black
text-emerald-700
mb-3
outline-none
">
Check Your Email
</h2>

<p class="
text-emerald-600
leading-relaxed
">
Your account has been created successfully.

Please verify your email before logging in.
</p>

</div>

</div>

`;

/* Whole-region replacement only. #signupContent is the existing
   wrapper intended to contain the complete Signup content; the
   two fallbacks exist only so the confirmation can never render
   inside a surviving form. */
const signupRegion =
document.getElementById("signupContent") ||
document.querySelector(".signup-page") ||
document.getElementById("app");

if(signupRegion){

signupRegion.innerHTML = successHtml;

}

/* Position the fresh confirmation state at the top with a SINGLE
   JUMP — never a smooth animation. css/styles.css sets a global
   "* { scroll-behavior: smooth }", and scrollTo's behavior:"auto"
   defers to that CSS, which animates from the previous position
   and can be cancelled by any wheel/touch input, leaving the page
   mid-scroll. behavior:"instant" overrides the CSS and jumps in
   every modern engine; engines without that enum value fall back
   to an inline scroll-behavior override, which also makes the
   two-argument scrollTo a single jump. Runs synchronously after
   the success DOM exists, so the welcome overlay lifts to reveal
   the panel at the top on every viewport. */

try{

window.scrollTo({
top: 0,
left: 0,
behavior: "instant"
});

}catch(scrollErr){

const html = document.documentElement;

html.style.scrollBehavior = "auto";

window.scrollTo(0, 0);

html.style.removeProperty("scroll-behavior");

}

const successHeading =
document.getElementById("signupSuccessHeading");

if(successHeading && typeof successHeading.focus === "function"){

successHeading.focus({ preventScroll: true });

}

/* POST-SIGNUP WELCOME — shown only after the account
   was genuinely created. The full-screen /assets/welcome.png
   artwork (logo, heading and tagline already embedded)
   fades in over the success state, holds briefly, then
   fades out to reveal the existing "Check Your Email"
   panel underneath. No routing, Supabase or email
   confirmation behavior changes. */

showWelcomeScreen();

}catch(err){

/* PHASE 4 — event-level log only. The raw
   exception object (may embed auth payloads)
   is never written to the console. */
console.error("SIGNUP FAILED [unexpected]");

toast("Signup failed");

resetBtn();

}

function resetBtn(){

signupSubmitting = false;

btn.disabled = false;

btn.innerHTML =
"Create Account";

}

});

}
