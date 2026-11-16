/* =========================================================
HUFA DRAFT STORE — PHASE 1 FOUNDATION
Small sessionStorage-backed helper for unfinished-form
drafts. Same style as js/stateManager.js.
KEYS: hufa:draft:<workflow>:<userKey>
RECORD: version/workflow/userKey/accountType/updatedAt/data
TTL removes ONLY the expired key. Never clear() storage.
========================================================= */

export const DRAFT_VERSION = 1;

/* Reasonable TTL for unfinished drafts: 7 days. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DRAFT_KEY_PREFIX = "hufa:draft:";
const ANON_ID_STORAGE_KEY = "hufa:anon-id";

function sanitizeKeyPart(value){
  const raw = String(value || "").trim();
  if(!raw){ return ""; }
  const cleaned = raw.replace(/[^A-Za-z0-9-_]/g, "_").slice(0, 80);
  return cleaned.replace(/^_+|_+$/g, "") || "";
}

export function buildDraftKey(workflow, userKey){
  const safeWorkflow = sanitizeKeyPart(workflow);
  const safeUserKey = sanitizeKeyPart(userKey);
  if(!safeWorkflow || !safeUserKey){ return null; }
  return `${DRAFT_KEY_PREFIX}${safeWorkflow}:${safeUserKey}`;
}

function safeStorage(){
  try{
    if(typeof sessionStorage === "undefined"){ return null; }
    return sessionStorage;
  }catch(e){ return null; }
}

function generateAnonId(){
  try{
    if(typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"){
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      let out = "";
      for(const b of bytes){ out += b.toString(16).padStart(2, "0"); }
      return out.slice(0, 32);
    }
  }catch(e){}
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 18)).slice(0, 32);
}

/* Per-tab anonymous id. Same-tab refresh/navigation keeps
it; a new tab gets a new id so anonymous users never share
a signup draft. Only this random id is persisted. */
export function getOrCreateAnonDraftId(){
  const store = safeStorage();
  if(!store){ return null; }
  try{
    const existing = store.getItem(ANON_ID_STORAGE_KEY);
    if(typeof existing === "string" && /^[A-Za-z0-9-_]{8,64}$/.test(existing)){
      return existing;
    }
    const next = generateAnonId();
    store.setItem(ANON_ID_STORAGE_KEY, next);
    return next;
  }catch(e){
    console.warn("Anon draft id failed", e);
    return null;
  }
}
export function isDraftExpired(record, nowMs, ttlMs){
  const ttl = typeof ttlMs === "number" && ttlMs > 0 ? ttlMs : DRAFT_TTL_MS;
  const now = typeof nowMs === "number" && nowMs > 0 ? nowMs : Date.now();
  if(!record || typeof record !== "object" || Array.isArray(record)){ return true; }
  if(record.version !== DRAFT_VERSION){ return true; }
  const updated = Date.parse(record.updatedAt);
  if(Number.isNaN(updated)){ return true; }
  return (now - updated) > ttl;
}

export function saveDraft(workflow, userKey, data, options){
  try{
    const key = buildDraftKey(workflow, userKey);
    if(!key){ return false; }
    const store = safeStorage();
    if(!store){ return false; }
    if(!data || typeof data !== "object" || Array.isArray(data)){ return false; }
    const accountType = options && typeof options.accountType === "string"
      ? options.accountType
      : (typeof data.accountType === "string" ? data.accountType : "");
    const record = {
      version: DRAFT_VERSION,
      workflow: sanitizeKeyPart(workflow),
      userKey: sanitizeKeyPart(userKey),
      accountType,
      updatedAt: new Date().toISOString(),
      data
    };
    store.setItem(key, JSON.stringify(record));
    return true;
  }catch(e){
    console.warn("Draft save failed", e);
    return false;
  }
}

export function loadDraft(workflow, userKey){
  try{
    const key = buildDraftKey(workflow, userKey);
    if(!key){ return null; }
    const store = safeStorage();
    if(!store){ return null; }
    const raw = store.getItem(key);
    if(!raw){ return null; }
    let record = null;
    try{ record = JSON.parse(raw); }
    catch(e){ store.removeItem(key); return null; }
    if(
      !record || typeof record !== "object" || Array.isArray(record) ||
      record.version !== DRAFT_VERSION ||
      sanitizeKeyPart(record.workflow) !== sanitizeKeyPart(workflow) ||
      sanitizeKeyPart(record.userKey) !== sanitizeKeyPart(userKey) ||
      !record.data || typeof record.data !== "object" || Array.isArray(record.data)
    ){ store.removeItem(key); return null; }
    if(isDraftExpired(record)){ store.removeItem(key); return null; }
    return record.data;
  }catch(e){
    console.warn("Draft load failed", e);
    return null;
  }
}

export function clearDraft(workflow, userKey){
  try{
    const key = buildDraftKey(workflow, userKey);
    if(!key){ return; }
    const store = safeStorage();
    if(!store){ return; }
    store.removeItem(key);
  }catch(e){ console.warn("Draft clear failed", e); }
}

/* Removes ONLY hufa:draft:*:<userKey> for the signed-out
user. Never touches browse/router/consent/pending UI keys. */
export function purgeUserDrafts(userKey){
  try{
    const safeUser = sanitizeKeyPart(userKey);
    if(!safeUser){ return 0; }
    const store = safeStorage();
    if(!store){ return 0; }
    const suffix = `:${safeUser}`;
    const doomed = [];
    for(let i = 0; i < store.length; i++){
      const k = store.key(i);
      if(
        typeof k === "string" &&
        k.indexOf(DRAFT_KEY_PREFIX) === 0 &&
        k.slice(k.lastIndexOf(":")) === suffix
      ){ doomed.push(k); }
    }
    for(const k of doomed){ store.removeItem(k); }
    return doomed.length;
  }catch(e){
    console.warn("Draft purge failed", e);
    return 0;
  }
}

