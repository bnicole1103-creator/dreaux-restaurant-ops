const allowedPaths = new Set(['/tasks','/quizzes','/preshift','/closeout','/settings']);
function safePath(value) {
 return typeof value === 'string' && allowedPaths.has(value) ? value : '/tasks';
}
self.addEventListener('push',event=>{
 let data={title:'JusTini’s',body:'Open the app to view your notifications.',url:'/tasks',tag:'staff'};
 try{data={...data,...event.data.json()}}catch{}
 event.waitUntil(self.registration.showNotification(data.title,{
  body:data.body,tag:data.tag,data:{url:safePath(data.url)}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=safePath(event.notification.data?.url);
 event.waitUntil((async()=>{
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const client=clients.find(c=>new URL(c.url).origin===self.location.origin);
  if(client){await client.navigate(url);return client.focus()}
  return self.clients.openWindow(url);
 })());
});
