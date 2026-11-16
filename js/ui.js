export function toast(msg){

const box =
document.createElement("div");

box.className = "toast";

/* PHASE 4 — announce toasts to assistive
   technology. */
box.setAttribute("role", "status");
box.setAttribute("aria-live", "polite");

box.innerHTML = `

<div
style="
display:flex;
align-items:center;
gap:12px;
"
>

<div
style="
width:42px;
height:42px;
border-radius:9999px;
background:rgba(255,255,255,.25);
display:flex;
align-items:center;
justify-content:center;
flex-shrink:0;
box-shadow:0 4px 12px rgba(0,0,0,.12);
"
>

<svg
width="22"
height="22"
viewBox="0 0 24 24"
fill="none"
stroke="currentColor"
stroke-width="3"
style="color:white;"
>
<path
stroke-linecap="round"
stroke-linejoin="round"
d="M5 13l4 4L19 7"
/>
</svg>

</div>

<div
style="
font-size:16px;
font-weight:800;
line-height:1.3;
color:white;
"
>
${msg}
</div>

</div>

`;

document.body.appendChild(box);

requestAnimationFrame(()=>{

box.classList.add("show");

});

setTimeout(()=>{

box.classList.remove("show");

setTimeout(()=>{

box.remove();

},300);

},5500);

}



/* ========================== */
/* 🔥 MODAL */
/* ========================== */

export function showModal(html){

const m =
document.getElementById("modal");

m.innerHTML = html;

m.classList.remove("hidden");

}



export function closeModal(){

document
.getElementById("modal")
.classList.add("hidden");

}

/* ========================== */
/* 🔥 GUEST LIMIT MESSAGE
   Shared HUFA-style notice shown when a GUEST reaches the
   save / compare limit. Never redirects the user away from
   the page; offers Sign In / Create Account / Cancel. */
/* ========================== */

export function showGuestLimitModal(kind = "save"){

const isCompare =
kind === "compare";

const limit =
isCompare ? GUEST_COMPARE_LIMIT : GUEST_SAVE_LIMIT;

const title =
isCompare
? "Guest Compare Limit Reached"
: "Guest Save Limit Reached";

const verb =
isCompare ? "compare" : "save";

showModal(`

<div class="modal-box text-center space-y-3" style="max-width:420px;">

  <div
  style="
  width:56px;
  height:56px;
  margin:0 auto;
  border-radius:9999px;
  background:rgba(0,91,191,.08);
  display:flex;
  align-items:center;
  justify-content:center;
  "
  >

    <svg
    width="26"
    height="26"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#005BBF"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    >
      <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z"/>
    </svg>

  </div>

  <h2 class="text-xl font-bold text-[#08111F]">
    ${title}
  </h2>

  <p class="text-sm text-slate-500" style="line-height:1.6;">
    You can ${verb} up to ${limit} vehicles as a guest.
    Sign in or create a free account to ${verb} more vehicles.
  </p>

  <div class="flex flex-col gap-2 pt-1">

    <button
      id="guestLimitSignIn"
      type="button"
      class="btn btn-gold w-full"
    >
      Sign In
    </button>

    <button
      id="guestLimitSignUp"
      type="button"
      class="btn btn-dark w-full"
    >
      Create Account
    </button>

    <button
      id="guestLimitCancel"
      type="button"
      class="w-full h-11 rounded-[12px] border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-all"
    >
      Cancel
    </button>

  </div>

</div>

`);

const go = (path)=>{

  closeModal();

  if(typeof window.navigate === "function"){
    window.navigate(path);
    return;
  }

  window.location.href = path;

};

const signIn =
document.getElementById("guestLimitSignIn");

if(signIn){
  signIn.onclick = () => go("/login");
}

const signUp =
document.getElementById("guestLimitSignUp");

if(signUp){
  signUp.onclick = () => go("/signup");
}

const cancel =
document.getElementById("guestLimitCancel");

if(cancel){
  cancel.onclick = () => closeModal();
}

}



/* ========================== */
/* 🔥 SKELETON (UPGRADED) */
/* ========================== */

export function skeleton(n = 6){
  let html = "";

  for(let i = 0; i < n; i++){
    html += `
      <div class="
skeleton-card
animate-pulse
rounded-[28px]
h-[320px]
w-full
bg-[linear-gradient(90deg,#F1F5F9_25%,#FFFFFF_50%,#F1F5F9_75%)]
border
border-white/60
shadow-[0_12px_40px_rgba(15,23,42,0.04)]
"></div>
    `;
  }

  return html;
}



/* ========================== */
/* 🔥 PAGINATION (IMPROVED UX) */
/* ========================== */

export function pager(page,total,cb){

let html="";

for(let i=1;i<=total;i++){

html+=`

<button
class="pageBtn ${i===page ? 'active' : ''}"
data-page="${i}"
>
${i}
</button>

`;

}

setTimeout(()=>{

document
.querySelectorAll(".pageBtn")
.forEach(b=>{

b.onclick=()=>{

cb(
parseInt(
b.dataset.page
)
);

};

});

});

return html;

}



/* ========================== */
/* 🔥 CAROUSEL */
/* ========================== */

export function carousel(images){

let i=0;

function show(){

document.getElementById(
"carImg"
).src = images[i];

}

window.nextImg=function(){

i++;
if(i>=images.length) i=0;

show();

}

window.prevImg=function(){

i--;
if(i<0) i=images.length-1;

show();

}

setTimeout(show);

}



/* ========================== */
/* 🔥 IMAGE MODAL */
/* ========================== */

export function openImage(src){

const m =
document.getElementById("modal");

m.innerHTML = `

<div class="modal-box">

<img src="${src}" class="max-w-full">

<button onclick="closeModal()">
Close
</button>

</div>

`;

m.classList.remove("hidden");

}



/* ========================== */
/* 🔥 REVEAL ANIMATION */
/* ========================== */

export function revealInit(){

const items =
document.querySelectorAll(".reveal");

function show(){

const h =
window.innerHeight;

items.forEach(el=>{

const top =
el.getBoundingClientRect().top;

if(top < h-50){

el.classList.add("show");

}

});

}

window.addEventListener(
"scroll",
show
);

show();

}

/* ========================== */
/* 🔥 GLOBAL COMPARE SYSTEM
   Comparison data is OWNER-SCOPED:
   - Guests           → localStorage key "hufa_guest_compare_vehicles"
     (browser-side only, capped at GUEST_COMPARE_LIMIT). This is the
     SAME UI/data path as signed-in users, just a different key.
   - Logged-in users  → localStorage key "compare_<userId>"
   The legacy shared "compare" key is never read or displayed, so a
   visitor can never see a previous user's list.
   ========================== */

import { getAuthUser } from "./api.js";

import {
  GUEST_COMPARE_KEY,
  GUEST_COMPARE_LIMIT
} from "./guestStore.js";

/* Current compare-list owner: "guest" or a Supabase user id */
let compareOwner = "guest";

/* Existing authenticated compare cap (unchanged). */
const MAX_COMPARE = 2;

function compareKey(){

  /* Owner-scoped storage:
     - Guests          → their own browser-side guest key (never a
       previous user's list, and never the legacy shared "compare").
     - Signed-in users → the existing "compare_<userId>" key. */
  return compareOwner === "guest"
    ? GUEST_COMPARE_KEY
    : `compare_${compareOwner}`;

}

/* The active cap for the current owner. Guests use the centralised
   guest limit; authenticated users keep the existing cap. */
function compareLimit(){

  return compareOwner === "guest"
    ? GUEST_COMPARE_LIMIT
    : MAX_COMPARE;

}

/* Read a compare list straight from storage (no owner logic). */
function readCompareKey(key){

  try{

    const parsed = JSON.parse(
      localStorage.getItem(key) || "[]"
    );

    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];

  }catch(e){

    return [];

  }

}

/* Sync the owner with the authenticated user.
   Runs on load and whenever auth state changes. */
export async function syncCompareOwner(){

  let nextOwner = "guest";

  try{

    const user = await getAuthUser();

    if(user?.id) nextOwner = user.id;

  }catch(e){

    nextOwner = "guest";

  }

  if(nextOwner === compareOwner) return;

  const previousOwner = compareOwner;

  /* SIGN-IN TRANSITION — preserve guest compare selections.
     Merge the guest list into the new user's list (deduped and
     capped) then clear the guest key. No duplicate entries and no
     change to the authenticated storage design. */
  if(previousOwner === "guest" && nextOwner !== "guest"){

    try{

      const guestList = readCompareKey(GUEST_COMPARE_KEY);

      if(guestList.length){

        const userKey = `compare_${nextOwner}`;

        const merged =
          [...new Set([...readCompareKey(userKey), ...guestList])]
          .slice(0, MAX_COMPARE);

        localStorage.setItem(
          userKey,
          JSON.stringify(merged)
        );

        localStorage.removeItem(GUEST_COMPARE_KEY);

      }

    }catch(e){

      /* storage unavailable — ignore */

    }

  }

  compareOwner = nextOwner;

  /* Reload every compare-driven UI with the correct owner's list */
  window.dispatchEvent(new Event("compareUpdated"));

}

syncCompareOwner();

window.addEventListener("authChanged", syncCompareOwner);

export function getCompare(){

  const key = compareKey();

  /* Normalize legacy/oversized lists to the active owner's
     maximum (guest limit or the existing authenticated cap),
     preserving the first entries. */
  return readCompareKey(key).slice(0, compareLimit());

}



export function setCompare(compare){

  const key = compareKey();

  /* Hard cap: never store more than the active owner's maximum */
  localStorage.setItem(
    key,
    JSON.stringify(
      (Array.isArray(compare) ? compare : [])
      .slice(0, compareLimit())
    )
  );

  window.dispatchEvent(
    new Event("compareUpdated")
  );

}



export function inCompare(id){

  const compare = getCompare();

  return compare.includes(id);

}



export function toggleCompare(id){

  let compare = getCompare();

  if(compare.includes(id)){

    compare = compare.filter(v=>v!==id);

    setCompare(compare);

    toast("Removed from compare");

    return false;

  }

  if(compare.length >= compareLimit()){

    /* Compare limit reached. Blocks only NEW additions — removing an
       already-compared vehicle (handled above) still works.
       Guests get the dedicated HUFA guest-limit message; signed-in
       users keep the existing notice. */
    if(compareOwner === "guest"){

      showGuestLimitModal("compare");

    }else{

      toast("Compare is limited to 2 vehicles.");

    }

    return false;

  }

  compare.push(id);

  setCompare(compare);

  toast("Added to compare");

  return true;

}



export function clearCompare(){

  /* Clears ONLY the current owner's list (guest key or user key) */
  const key = compareKey();

  try{
    localStorage.removeItem(key);
  }catch(e){
    /* ignore */
  }

  window.dispatchEvent(
    new Event("compareUpdated")
  );

}


/* ========================== */
/* 🔥 COMPARE HELPERS */
/* ========================== */

window.goComparePage = function(){

if(window.navigate){
window.navigate("/compare");
return;
}

window.location.href =
"/compare";

};

/* ========================== */
/* 🔥 COMPARE BUTTON UI */
/* ========================== */

export function compareButton(vehicleId){

const active =
inCompare(vehicleId);

return `

<button
onclick="event.stopPropagation();toggleVehicleCompare('${vehicleId}')"
class="
compare-card-btn
${active ? 'active' : ''}
"
>

<span class="
material-symbols-outlined
text-[18px]
">

balance

</span>

${active ? 'Added' : 'Compare'}

</button>

`;

}

/* ========================== */
/* 🔥 TOGGLE BUTTON HANDLER */
/* ========================== */

window.toggleVehicleCompare =
function(vehicleId){

toggleCompare(vehicleId);


setTimeout(()=>{

document
.querySelectorAll(
".compare-card-btn"
)
.forEach(btn=>{

btn.classList.remove(
"active"
);

});

const compare =
getCompare();

compare.forEach(id=>{

document
.querySelectorAll(
`[onclick*="${id}"]`
)
.forEach(btn=>{

btn.classList.add(
"active"
);

});

});

},50);

};

