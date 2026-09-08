const text=(v,max=1000)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const arr=v=>Array.isArray(v)?v:[];
const req=(v,name,max=1000)=>{const out=text(v,max);if(!out)throw new Error(`${name}_required`);return out;};

export const INSTAGRAM_SEND_CONTRACT_V2=Object.freeze({
  transportReleased:false,
  quickReplies:Object.freeze({maxItems:13,titleMaxChars:20}),
  buttons:Object.freeze({maxItems:3}),
});

export function buildInstagramTextPayloadV2({recipientId,message}={}){
  return {recipient:{id:req(recipientId,'recipient_id',200)},messaging_type:'RESPONSE',message:{text:req(message,'message',1000)}};
}

export function buildInstagramPrivateReplyPayloadV2({commentId,message}={}){
  return {recipient:{comment_id:req(commentId,'comment_id',500)},message:{text:req(message,'message',1000)}};
}

export function buildInstagramQuickRepliesPayloadV2({recipientId,message,items=[]}={}){
  const quick=arr(items).slice(0,13).map((item,index)=>({
    content_type:'text',
    title:req(item?.title??item?.label,`quick_reply_${index}_title`,20),
    payload:req(item?.payload??item?.value??item?.title??item?.label,`quick_reply_${index}_payload`,1000),
  }));
  if(!quick.length)throw new Error('quick_replies_required');
  return {recipient:{id:req(recipientId,'recipient_id',200)},messaging_type:'RESPONSE',message:{text:req(message,'message',1000),quick_replies:quick}};
}

function button(item,index){
  const type=String(item?.type??'postback').toLowerCase();
  const title=req(item?.title??item?.label,`button_${index}_title`,80);
  if(type==='postback')return {type:'postback',title,payload:req(item?.payload??item?.value,`button_${index}_payload`,1000)};
  if(type==='web_url')return {type:'web_url',title,url:req(item?.url,`button_${index}_url`,2048)};
  throw new Error(`button_${index}_type_unsupported`);
}

export function buildInstagramGenericTemplatePayloadV2({recipientId,elements=[]}={}){
  const normalized=arr(elements).slice(0,10).map((item,index)=>{
    const out={title:req(item?.title,`element_${index}_title`,80)};
    const subtitle=text(item?.subtitle??item?.body,80);if(subtitle)out.subtitle=subtitle;
    const image=text(item?.image_url,2048);if(image)out.image_url=image;
    const buttons=arr(item?.buttons).slice(0,3).map((b,i)=>button(b,`${index}_${i}`));if(buttons.length)out.buttons=buttons;
    if(item?.default_action?.url)out.default_action={type:'web_url',url:req(item.default_action.url,`element_${index}_default_url`,2048)};
    return out;
  });
  if(!normalized.length)throw new Error('template_elements_required');
  return {recipient:{id:req(recipientId,'recipient_id',200)},messaging_type:'RESPONSE',message:{attachment:{type:'template',payload:{template_type:'generic',elements:normalized}}}};
}

export function buildInstagramPublishedPostPayloadV2({recipientId,mediaId,ownedByProfessionalAccount=false}={}){
  if(ownedByProfessionalAccount!==true)throw new Error('professional_account_media_ownership_required');
  return {recipient:{id:req(recipientId,'recipient_id',200)},messaging_type:'RESPONSE',message:{attachment:{type:'MEDIA_SHARE',payload:{id:req(mediaId,'media_id',500)}}}};
}

export function assertInstagramTransportDormantV2(){
  if(INSTAGRAM_SEND_CONTRACT_V2.transportReleased!==false)throw new Error('instagram_transport_must_remain_dormant');
  return true;
}
