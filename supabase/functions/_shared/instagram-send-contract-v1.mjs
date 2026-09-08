const text=(v,max=1000)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const arr=v=>Array.isArray(v)?v:[];

const requireText=(v,name,max=1000)=>{
  const out=text(v,max);
  if(!out) throw new Error(`${name}_required`);
  return out;
};

export const INSTAGRAM_SEND_CONTRACT_V1=Object.freeze({
  quickReplies:Object.freeze({maxItems:13,titleMaxChars:20}),
  buttons:Object.freeze({maxItems:3}),
  transportReleased:false,
});

export function buildInstagramTextPayloadV1({recipientId,message}={}){
  return {
    recipient:{id:requireText(recipientId,'recipient_id',200)},
    messaging_type:'RESPONSE',
    message:{text:requireText(message,'message',1000)},
  };
}

export function buildInstagramPrivateReplyPayloadV1({commentId,message}={}){
  return {
    recipient:{comment_id:requireText(commentId,'comment_id',500)},
    message:{text:requireText(message,'message',1000)},
  };
}

export function buildInstagramQuickRepliesPayloadV1({recipientId,message,items=[]}={}){
  const quick=arr(items).slice(0,INSTAGRAM_SEND_CONTRACT_V1.quickReplies.maxItems).map((item,index)=>{
    const title=requireText(item?.title??item?.label,`quick_reply_${index}_title`,INSTAGRAM_SEND_CONTRACT_V1.quickReplies.titleMaxChars);
    const payload=requireText(item?.payload??item?.value??title,`quick_reply_${index}_payload`,1000);
    return {content_type:'text',title,payload};
  });
  if(!quick.length) throw new Error('quick_replies_required');
  return {
    recipient:{id:requireText(recipientId,'recipient_id',200)},
    messaging_type:'RESPONSE',
    message:{text:requireText(message,'message',1000),quick_replies:quick},
  };
}

function normalizeButton(button,index){
  const type=String(button?.type??'postback').toLowerCase();
  const title=requireText(button?.title??button?.label,`button_${index}_title`,80);
  if(type==='web_url') return {type:'web_url',url:requireText(button?.url,`button_${index}_url`,2048),title};
  if(type==='postback') return {type:'postback',title,payload:requireText(button?.payload??button?.value,`button_${index}_payload`,1000)};
  throw new Error(`button_${index}_type_unsupported`);
}

export function buildInstagramGenericTemplatePayloadV1({recipientId,elements=[]}={}){
  const normalized=arr(elements).slice(0,10).map((element,index)=>{
    const out={
      title:requireText(element?.title,`element_${index}_title`,80),
      subtitle:text(element?.subtitle??element?.body,80)||undefined,
      image_url:text(element?.image_url,2048)||undefined,
      buttons:arr(element?.buttons).slice(0,INSTAGRAM_SEND_CONTRACT_V1.buttons.maxItems).map((b,i)=>normalizeButton(b,`${index}_${i}`)),
    };
    if(!out.subtitle) delete out.subtitle;
    if(!out.image_url) delete out.image_url;
    if(!out.buttons.length) delete out.buttons;
    if(element?.default_action?.url){
      out.default_action={type:'web_url',url:requireText(element.default_action.url,`element_${index}_default_url`,2048)};
    }
    return out;
  });
  if(!normalized.length) throw new Error('template_elements_required');
  return {
    recipient:{id:requireText(recipientId,'recipient_id',200)},
    messaging_type:'RESPONSE',
    message:{attachment:{type:'template',payload:{template_type:'generic',elements:normalized}}},
  };
}

export function buildInstagramPublishedPostPayloadV1({recipientId,mediaId,ownedByProfessionalAccount=false}={}){
  if(ownedByProfessionalAccount!==true) throw new Error('professional_account_media_ownership_required');
  return {
    recipient:{id:requireText(recipientId,'recipient_id',200)},
    messaging_type:'RESPONSE',
    message:{attachment:{type:'MEDIA_SHARE',payload:{id:requireText(mediaId,'media_id',500)}}},
  };
}

export function assertInstagramTransportDormantV1(){
  if(INSTAGRAM_SEND_CONTRACT_V1.transportReleased!==false) throw new Error('instagram_transport_must_remain_dormant');
  return true;
}
