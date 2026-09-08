const num=v=>Number.isFinite(Number(v))?Number(v):0;
const isoDay=v=>{const d=v instanceof Date?v:new Date(v);if(Number.isNaN(d.getTime()))throw new Error('invalid_snapshot_date');return d.toISOString().slice(0,10)};
const daysBetween=(a,b)=>Math.floor((new Date(`${a}T00:00:00Z`)-new Date(`${b}T00:00:00Z`))/86400000);
const money=v=>Math.round(num(v)*100)/100;
const bucketFor=days=>days<0?'expired':days<=30?'0_30':days<=60?'31_60':'61_plus';
export function buildCommercialSnapshot(input={},options={}){
  const today=isoDay(options.now||new Date());
  const lots=Array.isArray(input.lots)?input.lots:[];
  const products=Array.isArray(input.products)?input.products:[];
  const delivered=Array.isArray(input.delivered_items)?input.delivered_items:[];
  const marginEvents=Array.isArray(input.margin_events)?input.margin_events:[];
  const expiry={expired:{lots:0,units:0},'0_30':{lots:0,units:0},'31_60':{lots:0,units:0},'61_plus':{lots:0,units:0},missing:{lots:0,units:0}};
  const freeByProduct=new Map();
  for(const l of lots){
    const free=Math.max(0,num(l.quantity_available)-num(l.quantity_reserved));
    if(l.product_id)freeByProduct.set(String(l.product_id),(freeByProduct.get(String(l.product_id))||0)+free);
    if(!l.expires_at){expiry.missing.lots++;expiry.missing.units+=free;continue}
    const days=daysBetween(String(l.expires_at).slice(0,10),today),key=bucketFor(days);expiry[key].lots++;expiry[key].units+=free;
  }
  const rupture=[];for(const p of products){const id=String(p.id||''),free=freeByProduct.has(id)?freeByProduct.get(id):Math.max(0,num(p.stock));const min=Math.max(0,num(p.minimum_stock??p.min_stock??0));if(free<=0||free<min)rupture.push({product_id:id,sku:p.sku||null,name:p.name||null,free_quantity:free,minimum_stock:min,severity:free<=0?'stockout':'below_minimum'});}
  const deliveredByProduct=new Map();for(const d of delivered){if(!d.product_id)continue;const id=String(d.product_id);deliveredByProduct.set(id,(deliveredByProduct.get(id)||0)+Math.max(0,num(d.quantity)));}
  const turnover=[...deliveredByProduct.entries()].map(([product_id,delivered_quantity])=>({product_id,delivered_quantity,current_free_quantity:freeByProduct.get(product_id)||0,turnover_proxy:delivered_quantity>0?Number((delivered_quantity/Math.max(1,delivered_quantity+(freeByProduct.get(product_id)||0))).toFixed(4)):0})).sort((a,b)=>b.turnover_proxy-a.turnover_proxy||b.delivered_quantity-a.delivered_quantity);
  let gross=0,cost=0,discount=0,known=0,incomplete=0;for(const e of marginEvents){const g=num(e.gross_revenue),d=num(e.discount),c=e.known_cost==null&&e.estimated_cost==null?null:num(e.known_cost??e.estimated_cost);gross+=g;discount+=d;if(c==null){incomplete++;continue}cost+=c;known++;}
  const net=gross-discount,margin=net-cost;
  return {version:'stage12-commercial-snapshot-v1',generated_for:today,external_side_effect:false,expiry,rupture:{count:rupture.length,items:rupture.slice(0,200)},turnover:{count:turnover.length,items:turnover.slice(0,200)},margin:{known_events:known,incomplete_events:incomplete,gross_revenue:money(gross),discount:money(discount),known_cost:money(cost),net_revenue:money(net),known_margin:money(margin),known_margin_percent:net>0?Number(((margin/net)*100).toFixed(2)):null,complete:incomplete===0}};
}
