// Run from the repository root. Existing keys are preserved on reruns.
const fs=require('node:fs'),crypto=require('node:crypto');
const path='.push-secrets.env';let token;
if(fs.existsSync(path)){
 token=fs.readFileSync(path,'utf8').match(/^PUSH_DISPATCH_TOKEN=([a-f0-9]{64})$/m)?.[1];
 if(!token)throw Error('Existing secret file is incomplete. Preserve it and check its values; no keys were changed.');
 console.log('Existing push keys preserved.');
}else{
 const key=crypto.createECDH('prime256v1');key.generateKeys();token=crypto.randomBytes(32).toString('hex');
 fs.writeFileSync(path,`VAPID_PUBLIC_KEY=${key.getPublicKey().toString('base64url')}\nVAPID_PRIVATE_KEY=${key.getPrivateKey().toString('base64url')}\nVAPID_SUBJECT=https://justinis-nola.vercel.app\nPUSH_DISPATCH_TOKEN=${token}\n`,{mode:0o600});
}
const template=fs.readFileSync('supabase/migrations/20261007_push_schedule.sql','utf8');
fs.writeFileSync('.push-cron-setup.sql',template.replace('PASTE_PUSH_DISPATCH_TOKEN_HERE',token),{mode:0o600});
console.log('Private keys ready in .push-secrets.env; generated .push-cron-setup.sql. Upload the secret file with the provided command, then paste .push-cron-setup.sql into Supabase SQL Editor. Do not commit either private file.');
