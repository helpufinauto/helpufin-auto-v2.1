/* =========================================================
HUFA UPLOAD VEHICLE IMAGE DRAFT STORE — PHASE 4
Small dedicated IndexedDB store for the Upload Vehicle
create-mode image draft ONLY. It exists because File/Blob
bytes cannot live in sessionStorage and the Phase 2
draftStore is deliberately text-only. This is NOT a general
application database — one record per user, one workflow.

DB:      hufa-upload-vehicle-image-drafts
STORE:   uploadVehicleDrafts (keyPath: userId)
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
resolve to false/null and the in-memory Upload Vehicle
flow continues to work unchanged.
========================================================= */

const IMAGE_DRAFT_DB_NAME =
"hufa-upload-vehicle-image-drafts";

const IMAGE_DRAFT_DB_VERSION = 1;

const IMAGE_DRAFT_STORE =
"uploadVehicleDrafts";

const IMAGE_DRAFT_VERSION = 1;

const IMAGE_DRAFT_WORKFLOW =
"uploadVehicle";

/* Matches the draftStore text-draft TTL (7 days) so an
abandoned image draft cannot linger indefinitely. */
const IMAGE_DRAFT_TTL_MS =
7 * 24 * 60 * 60 * 1000;

let imageDraftDbPromise = null;

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

function openImageDraftDb(){

  if(imageDraftDbPromise){
    return imageDraftDbPromise;
  }

  if(!idbAvailable()){
    return null;
  }

  try{

    imageDraftDbPromise = new Promise((resolve, reject)=>{

      const request =
      indexedDB.open(
        IMAGE_DRAFT_DB_NAME,
        IMAGE_DRAFT_DB_VERSION
      );

      request.onupgradeneeded = ()=>{

        const db =
        request.result;

        if(
          !db.objectStoreNames.contains(
            IMAGE_DRAFT_STORE
          )
        ){

          db.createObjectStore(
            IMAGE_DRAFT_STORE,
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

          imageDraftDbPromise = null;

        };

        resolve(db);

      };

      request.onerror = ()=>{

        imageDraftDbPromise = null;

        reject(
          request.error ||
          new Error("IndexedDB open failed")
        );

      };

      request.onblocked = ()=>{

        imageDraftDbPromise = null;

        reject(
          new Error("IndexedDB open blocked")
        );

      };

    });

    return imageDraftDbPromise;

  }catch(e){

    imageDraftDbPromise = null;

    return null;

  }

}

/* Runs one transaction against the draft store. Resolves
with the request result, or null on ANY failure (quota,
privacy restrictions, corruption, unavailable IndexedDB).
Never throws. */
async function withImageDraftStore(mode, run){

  if(!idbAvailable()){
    return null;
  }

  try{

    const db =
    await openImageDraftDb();

    if(!db){
      return null;
    }

    return await new Promise((resolve, reject)=>{

      let result = null;

      const tx =
      db.transaction(
        IMAGE_DRAFT_STORE,
        mode
      );

      const store =
      tx.objectStore(IMAGE_DRAFT_STORE);

      const request =
      run(store);

      /* PHASE 5 — capture the request result whenever a request
      is returned. The previous guard
      (`typeof request.onsuccess === "function"`) could never
      pass: a fresh IDBRequest's onsuccess handler is null until
      something assigns it, so the result was NEVER captured.
      get() therefore resolved null on every load — the image
      draft restore could never succeed even though the record
      was correctly written by put() (writes commit at the
      transaction level, which is why the save path appeared to
      work while loads always returned null). */
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
      "Upload image draft store failed",
      e
    );

    /* Drop the cached connection so a later call can retry
    with a fresh open instead of reusing a broken one. */
    imageDraftDbPromise = null;

    return null;

  }

}

function isImageDraftRecordValid(record){

  return !!(
    record &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    record.version === IMAGE_DRAFT_VERSION &&
    record.workflow === IMAGE_DRAFT_WORKFLOW &&
    typeof record.userId === "string" &&
    record.userId &&
    Array.isArray(record.images)
  );

}

function isImageDraftExpired(record, nowMs){

  try{

    const updated =
    Date.parse(record.updatedAt);

    if(Number.isNaN(updated)){
      return true;
    }

    return (nowMs - updated) > IMAGE_DRAFT_TTL_MS;

  }catch(e){
    return true;
  }

}

/* Converts one validated user-picked File into a plain
structured-clone-safe record. Rejects (returns null) anything
without readable bytes so a broken object can never poison
the stored record. */
async function fileToImageRecord(file){

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

/* Persists the CURRENT Upload Vehicle image list (in exact
array order) for one authenticated user. An empty list
deletes the stored record so removed images can never
resurrect after a refresh. Returns true on success. */
export async function saveUploadVehicleImageDraft(userId, files){

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
      await fileToImageRecord(file);

      /* One unreadable file aborts the whole save so the
      previous complete record stays untouched. */
      if(!record){
        return false;
      }

      images.push(record);

    }

    if(!images.length){

      await withImageDraftStore(
        "readwrite",
        (store)=> store.delete(userId)
      );

      return true;

    }

    const draft = {
      version: IMAGE_DRAFT_VERSION,
      workflow: IMAGE_DRAFT_WORKFLOW,
      userId,
      updatedAt: new Date().toISOString(),
      images
    };

    const result =
    await withImageDraftStore(
      "readwrite",
      (store)=> store.put(draft)
    );

    return result !== null && result !== undefined;

  }catch(e){

    console.warn(
      "Upload image draft save failed",
      e
    );

    return false;

  }

}

/* Loads the ordered image records for one authenticated
user, or null when none/expired/invalid. Expired records are
removed. Never throws; never returns another user's data
(the key IS the user id). */
export async function loadUploadVehicleImageDraft(userId){

  try{

    if(typeof userId !== "string" || !userId){
      return null;
    }

    const record =
    await withImageDraftStore(
      "readonly",
      (store)=> store.get(userId)
    );

    if(!isImageDraftRecordValid(record)){
      return null;
    }

    if(isImageDraftExpired(record, Date.now())){

      await withImageDraftStore(
        "readwrite",
        (store)=> store.delete(userId)
      );

      return null;

    }

    return record.images;

  }catch(e){

    console.warn(
      "Upload image draft load failed",
      e
    );

    return null;

  }

}

/* Deletes ONLY the given user's Upload Vehicle image draft
record. Used by the successful-publish lifecycle and by the
user-scoped logout purge. Never touches other users, other
workflows or any other storage. */
export async function clearUploadVehicleImageDraft(userId){

  try{

    if(typeof userId !== "string" || !userId){
      return false;
    }

    await withImageDraftStore(
      "readwrite",
      (store)=> store.delete(userId)
    );

    return true;

  }catch(e){

    console.warn(
      "Upload image draft clear failed",
      e
    );

    return false;

  }

}
