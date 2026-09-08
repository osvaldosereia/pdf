export type EncryptedFlowEnvelope={
  encrypted_aes_key:string;
  encrypted_flow_data:string;
  initial_vector:string;
};

export class FlowCryptoError extends Error{
  statusCode:number;
  code:string;
  constructor(statusCode:number,code:string,message:string){super(message);this.name='FlowCryptoError';this.statusCode=statusCode;this.code=code;}
}

const encoder=new TextEncoder();
const decoder=new TextDecoder();

function toArrayBuffer(bytes:Uint8Array):ArrayBuffer{
  const out=new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

function bytesToBase64(bytes:Uint8Array):string{
  let binary='';
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
  return btoa(binary);
}

function base64ToBytes(value:string,maxBytes=1024*1024):Uint8Array{
  const clean=String(value||'').trim();
  if(!clean||clean.length>Math.ceil(maxBytes*4/3)+16)throw new FlowCryptoError(400,'invalid_base64','Invalid base64 payload.');
  try{
    const raw=atob(clean);
    if(raw.length>maxBytes)throw new FlowCryptoError(413,'payload_too_large','Encrypted payload is too large.');
    const out=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
    return out;
  }catch(error){
    if(error instanceof FlowCryptoError)throw error;
    throw new FlowCryptoError(400,'invalid_base64','Invalid base64 payload.');
  }
}

function pemToDer(pem:string,label:'PRIVATE KEY'|'PUBLIC KEY'):Uint8Array{
  const text=String(pem||'').trim();
  const begin=`-----BEGIN ${label}-----`,end=`-----END ${label}-----`;
  if(!text.startsWith(begin)||!text.endsWith(end))throw new FlowCryptoError(500,'invalid_server_key',`Expected ${label} PEM.`);
  const b64=text.slice(begin.length,-end.length).replace(/\s+/g,'');
  return base64ToBytes(b64,16*1024);
}

export function derToPem(bytes:Uint8Array,label:'PRIVATE KEY'|'PUBLIC KEY'):string{
  const b64=bytesToBase64(bytes);
  const lines=b64.match(/.{1,64}/g)||[];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

export async function generateFlowKeyPair():Promise<{privateKeyPem:string;publicKeyPem:string}>{
  const pair=await crypto.subtle.generateKey(
    {name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
    true,
    ['encrypt','decrypt'],
  ) as CryptoKeyPair;
  const privateDer=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
  const publicDer=new Uint8Array(await crypto.subtle.exportKey('spki',pair.publicKey));
  return {privateKeyPem:derToPem(privateDer,'PRIVATE KEY'),publicKeyPem:derToPem(publicDer,'PUBLIC KEY')};
}

export async function importFlowPrivateKey(privateKeyPem:string):Promise<CryptoKey>{
  try{
    return await crypto.subtle.importKey(
      'pkcs8',
      toArrayBuffer(pemToDer(privateKeyPem,'PRIVATE KEY')),
      {name:'RSA-OAEP',hash:'SHA-256'},
      false,
      ['decrypt'],
    );
  }catch{
    throw new FlowCryptoError(500,'invalid_server_key','Unable to import Flow private key.');
  }
}

export async function decryptFlowRequest(
  envelope:EncryptedFlowEnvelope,
  privateKeyPem:string,
):Promise<{decryptedBody:Record<string,unknown>;aesKeyBytes:Uint8Array;initialVectorBytes:Uint8Array}>{
  const encryptedKey=base64ToBytes(envelope?.encrypted_aes_key,1024);
  const encryptedData=base64ToBytes(envelope?.encrypted_flow_data,1024*1024);
  const iv=base64ToBytes(envelope?.initial_vector,64);
  if(iv.length<12||iv.length>16)throw new FlowCryptoError(400,'invalid_initial_vector','Invalid Flow initial vector.');

  const privateKey=await importFlowPrivateKey(privateKeyPem);
  let aesKeyBytes:Uint8Array;
  try{
    aesKeyBytes=new Uint8Array(await crypto.subtle.decrypt({name:'RSA-OAEP'},privateKey,toArrayBuffer(encryptedKey)));
  }catch{
    // Meta reference implementation uses 421 so the client refreshes the business public key.
    throw new FlowCryptoError(421,'flow_key_decrypt_failed','Unable to decrypt Flow AES key.');
  }
  if(aesKeyBytes.length!==16)throw new FlowCryptoError(400,'invalid_aes_key','Expected AES-128 key.');

  let aesKey:CryptoKey;
  try{aesKey=await crypto.subtle.importKey('raw',toArrayBuffer(aesKeyBytes),{name:'AES-GCM'},false,['decrypt','encrypt']);}
  catch{throw new FlowCryptoError(400,'invalid_aes_key','Unable to import AES key.');}

  let plaintext:ArrayBuffer;
  try{
    plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:toArrayBuffer(iv),tagLength:128},aesKey,toArrayBuffer(encryptedData));
  }catch{
    throw new FlowCryptoError(400,'flow_data_decrypt_failed','Unable to decrypt Flow payload.');
  }

  let body:unknown;
  try{body=JSON.parse(decoder.decode(plaintext));}
  catch{throw new FlowCryptoError(400,'invalid_flow_json','Decrypted Flow payload is not valid JSON.');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new FlowCryptoError(400,'invalid_flow_body','Decrypted Flow payload must be an object.');
  return {decryptedBody:body as Record<string,unknown>,aesKeyBytes,initialVectorBytes:iv};
}

export async function encryptFlowResponse(
  response:unknown,
  aesKeyBytes:Uint8Array,
  initialVectorBytes:Uint8Array,
):Promise<string>{
  if(aesKeyBytes.length!==16)throw new FlowCryptoError(500,'invalid_aes_key','Expected AES-128 key.');
  const flippedIv=new Uint8Array(initialVectorBytes.length);
  for(let i=0;i<initialVectorBytes.length;i++)flippedIv[i]=(~initialVectorBytes[i])&0xff;
  const aesKey=await crypto.subtle.importKey('raw',toArrayBuffer(aesKeyBytes),{name:'AES-GCM'},false,['encrypt']);
  const plaintext=encoder.encode(JSON.stringify(response));
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:toArrayBuffer(flippedIv),tagLength:128},aesKey,toArrayBuffer(plaintext)));
  return bytesToBase64(encrypted);
}

export async function sha256Hex(value:string):Promise<string>{
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',toArrayBuffer(encoder.encode(value))));
  return [...digest].map(v=>v.toString(16).padStart(2,'0')).join('');
}
