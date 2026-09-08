const num=v=>Number(v);
const text=v=>String(v??'').trim();
export function buildPickingPlan(items=[]){
  if(!Array.isArray(items)||!items.length)return {ok:false,reason:'items_required',stops:[]};
  const normalized=items.map((item,index)=>({
    id:text(item.id||index),
    product_id:text(item.product_id),
    name:text(item.name),
    gtin:text(item.gtin),
    quantity:num(item.quantity),
    location_code:text(item.location_code),
    gondola_code:text(item.gondola_code),
    shelf_code:text(item.shelf_code),
    pick_sequence:Number.isFinite(num(item.pick_sequence))?num(item.pick_sequence):1000,
    expires_on:text(item.expires_on),
    lot_code:text(item.lot_code),
  }));
  if(normalized.some(i=>!i.product_id||!Number.isFinite(i.quantity)||i.quantity<=0))return {ok:false,reason:'invalid_item',stops:[]};
  if(normalized.some(i=>!i.location_code))return {ok:false,reason:'location_required',stops:[]};
  normalized.sort((a,b)=>a.pick_sequence-b.pick_sequence||a.location_code.localeCompare(b.location_code)||a.name.localeCompare(b.name));
  return {ok:true,strategy:'deterministic_location_sequence',external_side_effect:false,stops:normalized};
}
export function chooseFefoLot(lots=[],deliveryDate=new Date().toISOString().slice(0,10)){
  const valid=(Array.isArray(lots)?lots:[]).filter(l=>text(l.status)==='available'&&num(l.quantity_on_hand)>num(l.quantity_reserved)&&(!text(l.expires_on)||text(l.expires_on)>=deliveryDate));
  valid.sort((a,b)=>text(a.expires_on||'9999-12-31').localeCompare(text(b.expires_on||'9999-12-31'))||text(a.received_on||'9999-12-31').localeCompare(text(b.received_on||'9999-12-31'))||text(a.lot_code).localeCompare(text(b.lot_code)));
  return valid[0]||null;
}
export function validateScan({expectedBarcode,scannedBarcode,currentQuantity=0,expectedQuantity=0}){
  const expected=text(expectedBarcode),scanned=text(scannedBarcode);
  if(!expected||!scanned)return {ok:false,reason:'barcode_required'};
  if(scanned!==expected)return {ok:false,reason:'wrong_item'};
  if(num(currentQuantity)>=num(expectedQuantity))return {ok:false,reason:'quantity_already_complete'};
  return {ok:true,nextQuantity:num(currentQuantity)+1,complete:num(currentQuantity)+1>=num(expectedQuantity)};
}
