/* =========================================================
HUFA TRADE-IN IMAGE DRAFT STORE — PHASE 6B
Small dedicated IndexedDB store for the Trade-In Request
modal's pending image Files ONLY. It exists because File
bytes cannot live in the Phase 6A sessionStorage text draft
(draftStore is deliberately text-only). This is NOT a
general application database — one record per user,
one workflow.

DB:      hufa-trade-in-image-drafts
STORE:   tradeInImageDrafts (keyPath: userId)
RECORD:  version / workflow / userId / updatedAt / images[]

Identity is the Supabase authenticated user id — never an
email, name or dealership — so User A can never load
User B's pending images. With no authenticated user there
is NO save and NO load: no shared anonymous bucket exists.

Each image entry keeps only what a real File needs:
name, type, lastModified and the raw bytes (ArrayBuffer).
No object URLs, no tokens, no passwords, no MFA or session
data is ever written here.

Every operation is fail-safe and silent: if IndexedDB is
unavailable, blocked, full or corrupted, the functions
resolve to false/null and the in-memory Trade-In flow
continues to work unchanged.
========================================================= */

const TRADE_IN_IMAGE_DRAFT_DB_NAME =
"hufa-trade-in-image-drafts";

const TRADE_IN_IMAGE_DRAFT_DB_VERSION = 1;

const TRADE_IN_IMAGE_DRAFT_STORE =
"tradeInImageDrafts";

const TRADE_IN_IMAGE_DRAFT_VERSION = 1;

const TRADE_IN_IMAGE_DRAFT_WORKFLOW =
"tradeIn";

/* Matches the draftStore text-draft TTL (7 days) and the
Upload Vehicle image-store TTL so an abandoned image draft
cannot linger indefinitely. */
const TRADE_IN_IMAGE_DRAFT_TTL_MS =
7 * 24 * 60 * 60 * 1000;

let tradeInImageDraftDbPromise = null;

function idbAvailable(){

  try{
    return (
      typeof indexedDB !== "undefined" &&
      indexedDB !== null
    );
  }catch(e){
    return false;
  }

}

function openTradeInImageDraftDb(){

  if(tradeInImageDraftDbPromise){
    return tradeInImageDraftDbPromise;
  }

  if(!idbAvailable()){
    return null;
  }

  try{

    tradeInImageDraftDbPromise = new Promise((resolve, reject)=>{

      const request =
      indexedDB.open(
        TRADE_IN_IMAGE_DRAFT_DB_NAME,
        TRADE_IN_IMAGE_DRAFT_DB_VERSION
      );

      request.onupgradeneeded = ()=>{

        const db =
        request.result;

        if(
          !db.objectStoreNames.contains(
            TRADE_IN_IMAGE_DRAFT_STORE
          )
        ){

          db.createObjectStore(
            TRADE_IN_IMAGE_DRAFT_STORE,
            { keyPath: "userId" }
          );

        }

      };

      request.onsuccess = ()=>{

        const db =
        request.result;

        /* A version upgrade opened elsewhere must not wedge
        this connection; drop the cache so a later call can
        reopen cleanly. */
        db.onversionchange = ()=>{

          try{
            db.close();
          }catch(e){}

          tradeInImageDraftDbPromise = null;

        };

        resolve(db);

      };

      request.onerror = ()=>{

        tradeInImageDraftDbPromise = null;

        reject(
          request.error ||
          new Error("IndexedDB open failed")
        );

      };

      request.onblocked = ()=>{

        tradeInImageDraftDbPromise = null;

        reject(
          new Error("IndexedDB open blocked")
        );

      };

    });

    return tradeInImageDraftDbPromise;

  }catch(e){

    tradeInImageDraftDbPromise = null;

    return null;

  }

}

/* Runs one transaction against the draft store. Resolves
with the request result, or null on ANY failure (quota,
privacy restrictions, corruption, unavailable IndexedDB).
Never throws. */
async function withTradeInImageDraftStore(mode, run){

  if(!idbAvailable()){
    return null;
  }

  try{

    const db =
    await openTradeInImageDraftDb();

    if(!db){
      return null;
    }

    return await new Promise((resolve, reject)=>{

      let result = null;

      const tx =
      db.transaction(
        TRADE_IN_IMAGE_DRAFT_STORE,
        mode
      );

      const store =
      tx.objectStore(TRADE_IN_IMAGE_DRAFT_STORE);

      const request =
      run(store);

      /* Capture the get/put request result for the transaction.
         IDBRequest.onsuccess is initially null, so checking it
         before assigning the handler skips every fresh request
         and causes restore reads to resolve null. */
      if(request){

        request.onsuccess = ()=>{

          result =
          request.result;

        };

      }

      tx.oncomplete = ()=>{
        resolve(result);
      };

      tx.onerror = ()=>{
        reject(
          tx.error ||
          new Error("IndexedDB transaction failed")
        );
      };

      tx.onabort = ()=>{
        reject(
          tx.error ||
          new Error("IndexedDB transaction aborted")
        );
      };

    });

  }catch(e){

    console.warn(
      "Trade-In image draft store failed",
      e
    );

    /* Drop the cached connection so a later call can retry
    with a fresh open instead of reusing a broken one. */
    tradeInImageDraftDbPromise = null;

    return null;

  }

}

function isTradeInImageDraftRecordValid(record){

  return !!(
    record &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    record.version === TRADE_IN_IMAGE_DRAFT_VERSION &&
    record.workflow === TRADE_IN_IMAGE_DRAFT_WORKFLOW &&
    typeof record.userId === "string" &&
    record.userId &&
    Array.isArray(record.images)
  );

}

function isTradeInImageDraftExpired(record, nowMs){

  try{

    const updated =
    Date.parse(record.updatedAt);

    if(Number.isNaN(updated)){
      return true;
    }

    return (nowMs - updated) > TRADE_IN_IMAGE_DRAFT_TTL_MS;

  }catch(e){
    return true;
  }

}

/* Converts one validated user-picked File into a plain
structured-clone-safe record. Rejects (returns null) anything
without readable bytes so a broken object can never poison
the stored record. */
async function tradeInFileToImageRecord(file){

  try{

    if(
      !file ||
      typeof file.arrayBuffer !== "function"
    ){
      return null;
    }

    const bytes =
    await file.arrayBuffer();

    if(!bytes || !bytes.byteLength){
      return null;
    }

    return {
      name:
        typeof file.name === "string" && file.name
          ? file.name
          : "image",
      type:
        typeof file.type === "string"
          ? file.type
          : "",
      lastModified:
        typeof file.lastModified === "number" &&
        file.lastModified > 0
          ? file.lastModified
          : Date.now(),
      bytes
    };

  }catch(e){
    return null;
  }

}

/* Persists the CURRENT Trade-In image list (in exact array
order) for one authenticated user. An empty list deletes the
stored record so removed images can never resurrect after a
refresh. Returns true on success. */
export async function saveTradeInImageDraft(userId, files){

  try{

    if(typeof userId !== "string" || !userId){
      return false;
    }

    if(!Array.isArray(files)){
      return false;
    }

    const images = [];

    for(const file of files){

      const record =
      await tradeInFileToImageRecord(file);

      /* One unreadable file aborts the whole save so the
      previous complete record stays untouched. */
      if(!record){
        return false;
      }

      images.push(record);

    }

    if(!images.length){

      await withTradeInImageDraftStore(
        "readwrite",
        (store)=> store.delete(userId)
      );

      return true;

    }

    const draft = {
      version: TRADE_IN_IMAGE_DRAFT_VERSION,
      workflow: TRADE_IN_IMAGE_DRAFT_WORKFLOW,
      userId,
      updatedAt: new Date().toISOString(),
      images
    };

    const result =
    await withTradeInImageDraftStore(
      "readwrite",
      (store)=> store.put(draft)
    );

    return result !== null && result !== undefined;

  }catch(e){

    console.warn(
      "Trade-In image draft save failed",
      e
    );

    return false;

  }

}

/* Loads the ordered image records for one authenticated
user, or null when none/expired/invalid. Expired records are
removed. Never throws; never returns another user's data
(the key IS the user id). */
export async function loadTradeInImageDraft(userId){

  try{

    if(typeof userId !== "string" || !userId){
      return null;
    }

    const record =
    await withTradeInImageDraftStore(
      "readonly",
      (store)=> store.get(userId)
    );

    if(!isTradeInImageDraftRecordValid(record)){
      return null;
    }

    if(isTradeInImageDraftExpired(record, Date.now())){

      await withTradeInImageDraftStore(
        "readwrite",
        (store)=> store.delete(userId)
      );

      return null;

    }

    return record.images;

  }catch(e){

    console.warn(
      "Trade-In image draft load failed",
      e
    );

    return null;

  }

}

/* Deletes ONLY the given user's Trade-In image draft
record. Used by the successful-submission lifecycle and by
the user-scoped logout purge. Never touches other users,
other workflows (including the Upload Vehicle store) or any
other storage. */
export async function clearTradeInImageDraft(userId){

  try{

    if(typeof userId !== "string" || !userId){
      return false;
    }

    await withTradeInImageDraftStore(
      "readwrite",
      (store)=> store.delete(userId)
    );

    return true;

  }catch(e){

    console.warn(
      "Trade-In image draft clear failed",
      e
    );

    return false;

  }

}
