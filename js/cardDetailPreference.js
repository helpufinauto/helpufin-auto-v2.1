const STORAGE_KEY = "marketplace_card_detail_level";
export const CARD_DETAIL_CHANGE_EVENT = "marketplaceCardDetailChanged";
let sessionPreference = "simple";

export function getCardDetailLevel(){
  try{
    const stored = localStorage.getItem(STORAGE_KEY);
    if(stored === "simple" || stored === "detailed"){
      sessionPreference = stored;
    }
    return sessionPreference;
  }catch(e){
    return sessionPreference;
  }
}

export function setCardDetailLevel(level){
  const value = level === "detailed" ? "detailed" : "simple";
  sessionPreference = value;
  try{
    localStorage.setItem(STORAGE_KEY, value);
  }catch(e){
    /* Keep the current session usable when storage is unavailable. */
  }
  window.dispatchEvent(new CustomEvent(CARD_DETAIL_CHANGE_EVENT, { detail: { level: value } }));
  return value;
}
