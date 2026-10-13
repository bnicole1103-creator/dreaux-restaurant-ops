self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
 let data={};try{data=event.data?.json()??{}}catch{}
 event.waitUntil(self.registration.showNotification(data.title||'JusTini’s',{
  body:data.body||'There is an update in your staff app.',
  icon:'/push-icon-192.png',badge:'/push-icon-192.png',
  tag:data.tag||'justinis-update',data:{url:data.url||'/'},
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  let target=new URL(event.notification.data?.url||'/',self.location.origin);
  if(target.origin!==self.location.origin)target=new URL('/',self.location.origin);
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){if(new URL(client.url).origin===self.location.origin){await client.navigate(target.href);return client.focus()}}
  return self.clients.openWindow(target.href);
 })());
});
