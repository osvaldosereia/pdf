import {decryptFlowRequest,encryptFlowResponse,FlowCryptoError,generateFlowKeyPair} from "./crypto.ts";

const enc=new TextEncoder(),dec=new TextDecoder();
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message)};
const b64=(bytes:Uint8Array)=>{let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)};
const fromPem=(pem:string)=>{const raw=atob(pem.replace(/-----[^-]+-----/g,"").replace(/\s+/g,""));const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out};
const ab=(bytes:Uint8Array)=>{const out=new ArrayBuffer(bytes.byteLength);new Uint8Array(out).set(bytes);return out};

async function makeEnvelope(publicKeyPem:string,body:Record<string,unknown>){
  const publicKey=await crypto.subtle.importKey("spki",ab(fromPem(publicKeyPem)),{name:"RSA-OAEP",hash:"SHA-256"},false,["encrypt"]);
  const aes=new Uint8Array(16);crypto.getRandomValues(aes);
  const iv=new Uint8Array(16);crypto.getRandomValues(iv);
  const aesKey=await crypto.subtle.importKey("raw",ab(aes),{name:"AES-GCM"},false,["encrypt","decrypt"]);
  const encryptedData=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:ab(iv),tagLength:128},aesKey,ab(enc.encode(JSON.stringify(body)))));
  const encryptedKey=new Uint8Array(await crypto.subtle.encrypt({name:"RSA-OAEP"},publicKey,ab(aes)));
  return {envelope:{encrypted_aes_key:b64(encryptedKey),encrypted_flow_data:b64(encryptedData),initial_vector:b64(iv)},aes,iv};
}

Deno.test("WhatsApp Flow crypto round-trip follows Meta Data Exchange contract",async()=>{
  const pair=await generateFlowKeyPair();
  const original={version:"3.0",action:"INIT",flow_token:"fixture-token-12345678901234567890123456789012",data:{basket_id:"fixture"}};
  const fixture=await makeEnvelope(pair.publicKeyPem,original);
  const decrypted=await decryptFlowRequest(fixture.envelope,pair.privateKeyPem);
  assert(decrypted.decryptedBody.action==="INIT","request action mismatch");
  assert(decrypted.decryptedBody.flow_token===original.flow_token,"request flow token mismatch");
  assert(decrypted.aesKeyBytes.length===16,"AES-128 key expected");

  const response={screen:"BASKET_EDIT",data:{status:"ok"}};
  const encryptedResponse=await encryptFlowResponse(response,decrypted.aesKeyBytes,decrypted.initialVectorBytes);
  const flipped=new Uint8Array(fixture.iv.length);for(let i=0;i<fixture.iv.length;i++)flipped[i]=(~fixture.iv[i])&0xff;
  const aesKey=await crypto.subtle.importKey("raw",ab(fixture.aes),{name:"AES-GCM"},false,["decrypt"]);
  const raw=atob(encryptedResponse);const cipher=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)cipher[i]=raw.charCodeAt(i);
  const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:ab(flipped),tagLength:128},aesKey,ab(cipher));
  const decoded=JSON.parse(dec.decode(plaintext));
  assert(decoded.screen==="BASKET_EDIT","response screen mismatch");
  assert(decoded.data.status==="ok","response data mismatch");
});

Deno.test("wrong private key fails with HTTP 421 semantics",async()=>{
  const sender=await generateFlowKeyPair();
  const receiver=await generateFlowKeyPair();
  const fixture=await makeEnvelope(sender.publicKeyPem,{action:"ping",data:{}});
  let caught:unknown=null;
  try{await decryptFlowRequest(fixture.envelope,receiver.privateKeyPem)}catch(error){caught=error}
  assert(caught instanceof FlowCryptoError,"FlowCryptoError expected");
  assert((caught as FlowCryptoError).statusCode===421,"wrong key must request public-key refresh with 421");
});
